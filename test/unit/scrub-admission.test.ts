import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  cliGroupsConfirmedGone, judgeCliGroup, newStatus, readStatus, scrubAdmission, scrubHoldWhy, writeStatus, type RunStatus,
} from '../../src/trivium/status.js';
import { pruneRunDirs, scrubAllRunRoot } from '../../src/trivium/retention.js';
import { cancelRun, runDirFor, waitRun, type RecordedCliOutcome } from '../../src/trivium/run-protocol.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { captureStderr, fakeCtx } from '../helpers/run-ctx.js';
import { repoId } from '../../src/trivium/review.js';
import { processGroupMemberCount, processStartTime } from '../../src/trivium/util/exec.js';
import { wiredAdapter } from '../../src/trivium/adapters/index.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { newRunMeta, registerRun, writeRunMeta } from '../../src/trivium/meta.js';
import { metaDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import { groupMemberCount, groupsWithMark, killGroup } from '../helpers/proc.js';
import type { Ctx, RunMeta } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

// WIN_FILE_SKIP（Windows 移植）：活体 POSIX 进程语义（进程组信号/SIGTERM 阶梯/僵尸/ps 形态）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 活体 POSIX 进程语义（进程组信号/SIGTERM 阶梯/僵尸/ps 形态）');
} else {

/**
 * EV-157：凭据抹除的准入与到期整删核审查员 CLI（取消与失联的凭据准入核CLI计划 r2 §4.1 U1～U7）。
 *
 * 五格（计划 r2 §2）：A 仍活着（alive）/ B 已结束（gone 或 reused）/ C 判不了（unverifiable）/ D 读不懂（malformed）/
 * E 没有记录。CLI 组是真实的 detached `sh -c 'sleep 120'`，带用例级唯一标记；worker 用已退出的 pid。
 *
 * 夹具纪律（计划 r2 §4.1，计划双审 r1 CODEX-03 / GLM-04）：只往本用例的 mkdtemp 里写；收尾一律在 finally 里按组结束、
 * 再按标记兜底；`reused` 用「真实组 + 错配启动时刻」的确定形态；`gone` 用已确认组空的组号。
 * `--cancel` / `--wait` 的 Ctx 与 stderr 捕获取自 `test/helpers/run-ctx.ts`（与 run-protocol.test.ts 共用，代码双审 r1 CODEX-07）；
 * 运行目录夹具 `seedDeadRun` 是 worker 已死、带载体与归档的变体（status 为 running、worker_pid 与 worker.pid 指向已退出的 pid），
 * 与 run-protocol.test.ts 起活 worker 的 `seedRun` 语义不同，各留一份。
 */

const MARK = 'trivium-ut-scrub-adm';
const TOPIC = '准入用例';
const DAY = 86_400_000;
const BOGUS_START = 'Thu Jan  1 00:00:00 1970';

interface Group {
  pgid: number;
  startedAt: string | null;
  stop: () => Promise<void>;
}

/** 起一个真实的 CLI 进程组（组长 = sh），标记含 mkdtemp 路径与格名，全局唯一 */
async function liveGroup(tag: string): Promise<Group> {
  const child = spawn('/bin/sh', ['-c', 'sleep 120; : "$0"', `${MARK}:${tag}`], { detached: true, stdio: 'ignore' });
  const exited = new Promise<void>((r) => child.once('exit', () => r()));
  const pgid = child.pid!;
  const startedAt = await processStartTime(pgid, { canonical: true });
  let stopped = false;
  return {
    pgid,
    startedAt,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      killGroup(pgid);
      await exited;
    },
  };
}

/**
 * 一个已结束的组号（`gone` 形态）：**单进程组**——组长就是全部成员、没有子进程，由本进程回收（等到 'exit'）即确定结束。
 *
 * 前提只收窄到「组长已由本进程回收」，不再断言「组空」（实施报告 §8）：r1 用 `sh -c 'sleep …'` 起组、SIGKILL 后按进程表
 * 等组空，verify 那一轮在全量并发下偶发红（组长已不在而组号下还数到 1 个成员、持续约 5 s，成员身份未能确定；
 * 「派生即 SIGKILL 漏掉正在 fork 的子进程」经探针 1600 次未复现）。被测的 `judgeCliGroup` 只看组长：组长不在判 `gone`，
 * 组号恰被别的进程占用判 `reused`，两者都放行，B 格的断言与之无关——所以不需要、也不该依赖组空。
 */
async function goneGroup(tag: string): Promise<{ pgid: number; startedAt: string | null }> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', `${MARK}:${tag}`], {
    detached: true,
    stdio: 'ignore',
  });
  const exited = new Promise<void>((r) => child.once('exit', () => r()));
  const pgid = child.pid!;
  const startedAt = await processStartTime(pgid, { canonical: true });
  killGroup(pgid);
  await exited;
  // started_at 为 null 时组号若被复用会判 unverifiable（挡住），B 格就不成立——这里钉住前提
  assert.ok(startedAt, `组长 ${pgid} 的启动时刻应已取到（用例前提）`);
  return { pgid, startedAt };
}

/**
 * 单 pid（非组）SIGKILL 组长，制造「组长已退、组员仍在」（EV-165）——只杀 `pgid` 这一个进程，不带负号，
 * 不影响同组的其他成员。带上限轮询确认组长确已不在，不做单次断言（计划双审 r1 AGY-05/GLM-04：`goneGroup` 的教训是
 * 组空判定要能容忍系统抖动，组长退出判定同理）。
 */
async function killLeaderOnly(pgid: number): Promise<void> {
  try {
    process.kill(pgid, 'SIGKILL');
  } catch {
    /* 已不在 */
  }
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pgid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`组长 ${pgid} 应已不在（用例前提）`);
}

/** 组号下现有的非僵尸成员数，带上限轮询等待到目标条件（复用 `killLeaderOnly` 同款节奏） */
async function untilMemberCount(pgid: number, ok: (n: number) => boolean, ms = 3000): Promise<number> {
  const deadline = Date.now() + ms;
  let n = (await processGroupMemberCount(pgid)) ?? -1;
  while (!ok(n) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    n = (await processGroupMemberCount(pgid)) ?? -1;
  }
  return n;
}

/**
 * 「组长已退、组员仍在」（EV-165 `orphaned` 格）：复用 `liveGroup`（组长 `sh` + 子进程 `sleep 120`，同组），
 * 单 pid SIGKILL 组长，`sleep` 留在同一个 `pgid` 下继续跑——组号仍然有效，只是组长换了后代占着。
 */
async function orphanedGroup(tag: string): Promise<Group> {
  const g = await liveGroup(tag);
  // sh 派生 sleep 子进程需要时间：太早杀组长会连子进程一起端掉（组还没来得及有第二个成员）
  const before = await untilMemberCount(g.pgid, (x) => x >= 2);
  assert.equal(before, 2, `组 ${g.pgid} 派生 sleep 子进程后应有两个成员（用例前提）：${before}`);
  await killLeaderOnly(g.pgid);
  const n = await untilMemberCount(g.pgid, (x) => x > 0);
  assert.ok(n > 0, `组 ${g.pgid} 应仍有非僵尸成员（用例前提）：${n}`);
  return g;
}

/**
 * 「组长已退、组员也已自然退出」（EV-165 `orphaned` 之后归零，视同 `gone`）：子进程只睡 1 秒，
 * 杀组长之后等它自然结束——不强行构造真实僵尸态（macOS 上窗口短且不确定，见计划 r2 §3.1／§4），
 * 直接让成员计数在真实场景下归零，与「判据只认这个数字，不关心 0 是怎么来的」的设计一致。
 */
async function orphanedThenEmptyGroup(tag: string): Promise<{ pgid: number; startedAt: string | null }> {
  const child = spawn('/bin/sh', ['-c', 'sleep 1; : "$0"', `${MARK}:${tag}`], { detached: true, stdio: 'ignore' });
  const pgid = child.pid!;
  const startedAt = await processStartTime(pgid, { canonical: true });
  // 同 orphanedGroup：先等 sleep 子进程真正派生出来，再杀组长，否则会连子进程一起端掉、测不出「先孤儿、后自然退出」
  const before = await untilMemberCount(pgid, (x) => x >= 2);
  assert.equal(before, 2, `组 ${pgid} 派生 sleep 子进程后应有两个成员（用例前提）：${before}`);
  await killLeaderOnly(pgid);
  const n = await untilMemberCount(pgid, (x) => x === 0, 5000);
  assert.equal(n, 0, `组 ${pgid} 的成员应已自然退出（用例前提）`);
  assert.ok(startedAt, `组长 ${pgid} 的启动时刻应已取到（用例前提）`);
  return { pgid, startedAt };
}

/** 一个已退出的 worker pid，连同它生前的两种启动时刻 */
async function deadWorker(): Promise<{ pid: number; legacy: string | null; canonical: string | null }> {
  const c = spawn('/bin/sh', ['-c', 'sleep 30'], { stdio: 'ignore' });
  const exited = new Promise<void>((r) => c.once('exit', () => r()));
  const pid = c.pid!;
  const legacy = await processStartTime(pid);
  const canonical = await processStartTime(pid, { canonical: true });
  c.kill('SIGKILL');
  await exited;
  return { pid, legacy, canonical };
}

/** 一个活着的 worker（`heartbeat_stale` 那一格用），收尾由调用方结束 */
async function liveWorker(tag: string) {
  const c = spawn('/bin/sh', ['-c', 'sleep 120; : "$0"', `${MARK}:${tag}`], { stdio: 'ignore' });
  const exited = new Promise<void>((r) => c.once('exit', () => r()));
  const pid = c.pid!;
  return {
    pid,
    legacy: await processStartTime(pid),
    canonical: await processStartTime(pid, { canonical: true }),
    stop: async () => {
      try {
        c.kill('SIGKILL');
      } catch {
        /* 已不在 */
      }
      await exited;
    },
  };
}

type CliValue = unknown;
type Cell = 'A' | 'B' | 'Br' | 'C' | 'D' | 'E' | 'H' | 'Hz';

/** 按格造 glm 侧的 cli 记录；返回记录值与需要收尾的组（EV-165 新增 H / Hz 两格） */
async function recordFor(cell: Cell, tag: string): Promise<{ cli: CliValue; group: Group | null; pgid: number | null }> {
  switch (cell) {
    case 'A': {
      const g = await liveGroup(tag);
      return { cli: { pgid: g.pgid, started_at: g.startedAt }, group: g, pgid: g.pgid };
    }
    case 'B': {
      const g = await goneGroup(tag);
      return { cli: { pgid: g.pgid, started_at: g.startedAt }, group: null, pgid: g.pgid };
    }
    case 'Br': {
      const g = await liveGroup(tag);
      return { cli: { pgid: g.pgid, started_at: BOGUS_START }, group: g, pgid: g.pgid };
    }
    case 'C': {
      const g = await liveGroup(tag);
      return { cli: { pgid: g.pgid, started_at: null }, group: g, pgid: g.pgid };
    }
    case 'D':
      return { cli: { pgid: 'not-a-number' }, group: null, pgid: null };
    case 'E':
      return { cli: null, group: null, pgid: null };
    case 'H': {
      const g = await orphanedGroup(tag);
      return { cli: { pgid: g.pgid, started_at: g.startedAt }, group: g, pgid: g.pgid };
    }
    case 'Hz': {
      const g = await orphanedThenEmptyGroup(tag);
      return { cli: { pgid: g.pgid, started_at: g.startedAt }, group: null, pgid: g.pgid };
    }
  }
}

function statusWith(o: {
  phase?: RunStatus['phase'];
  worker?: { pid: number; legacy: string | null; canonical: string | null } | null;
  cli: Partial<Record<'gemini' | 'glm', CliValue>>;
}): RunStatus {
  const s = newStatus({ runId: 'R', topic: TOPIC, stage: 'plan', sides: ['gemini', 'glm'], models: {} });
  s.phase = o.phase ?? 'running';
  if (o.worker) {
    s.worker_pid = o.worker.pid;
    s.worker_started_at = o.worker.legacy;
    s.worker_started_at_canonical = o.worker.canonical;
  }
  for (const [side, v] of Object.entries(o.cli)) (s.sides[side as 'gemini' | 'glm'] as unknown as Record<string, unknown>)['cli'] = v;
  return s;
}

/** 本用例起的全部组：finally 里按组结束，再按标记兜底 */
function tracker() {
  const groups: Group[] = [];
  return {
    add<T extends { group: Group | null }>(r: T): T {
      if (r.group) groups.push(r.group);
      return r;
    },
    async cleanup(markTag: string) {
      for (const g of groups) await g.stop();
      for (const pg of groupsWithMark(`${MARK}:${markTag}`)) killGroup(pg);
    },
  };
}

const uniq = async (): Promise<string> => fs.realpath(await scratchDir('trivium-scrub-adm-'));

// ─────────────────────────── U0：judgeCliGroup 的三个新分支（EV-165） ───────────────────────────

test('EV-165 U0：judgeCliGroup——组长已退且组里还有非僵尸成员判 orphaned（out 带出成员数）；成员归零判 gone；成员计数取不到判 orphan_unverifiable（依赖注入，零配额）', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const h = t.add({ group: await orphanedGroup(`${tmp}:u0h`) });
    const out: { membersLeft?: number | null } = {};
    const startedAt = h.group!.startedAt;
    const v = await judgeCliGroup({ pgid: h.group!.pgid, started_at: startedAt }, { out });
    assert.equal(v, 'orphaned');
    assert.ok((out.membersLeft ?? 0) > 0, `out.membersLeft 应带出实测成员数：${JSON.stringify(out)}`);

    const hz = await orphanedThenEmptyGroup(`${tmp}:u0hz`);
    const outHz: { membersLeft?: number | null } = {};
    assert.equal(await judgeCliGroup({ pgid: hz.pgid, started_at: hz.startedAt }, { out: outHz }), 'gone', '成员数归零视同已结束');
    assert.equal(outHz.membersLeft, 0);

    // orphan_unverifiable：成员计数取不到（ps 失败），用依赖注入零配额构造——不强行造真实 ps 故障
    const hu = await orphanedGroup(`${tmp}:u0hu`);
    t.add({ group: hu });
    const outHu: { membersLeft?: number | null } = {};
    const vHu = await judgeCliGroup(
      { pgid: hu.pgid, started_at: hu.startedAt },
      { memberCountOf: async () => null, out: outHu },
    );
    assert.equal(vHu, 'orphan_unverifiable');
    assert.equal(outHu.membersLeft, null);

    // now===null 复检分支也要走同一条 leaderGone 路径（AGY-01≡CODEX-05）：用注入的 memberCountOf 直接钉住契约，
    // 不依赖真的让 processStartTime 瞬时失败——那条分支已由既有 U17（ps 瞬时失败但组长仍在）覆盖了「组长仍在」的一半，
    // 这里只需确认「组长确认不在」时，不论从 !alive 分支还是 now===null 分支进来，产出的是同一个 leaderGone 判据。
    const memberCountOf = async (pgid: number): Promise<number | null> => (pgid === hu.pgid ? 3 : null);
    assert.equal(
      await judgeCliGroup({ pgid: hu.pgid, started_at: hu.startedAt }, { memberCountOf }),
      'orphaned',
      '组长确认不在时，注入的成员数直接决定 verdict——与 !alive 分支同一判据',
    );
  } finally {
    await t.cleanup(tmp);
  }
});

// ─────────────────────────── U1 / U2：判据本身 ───────────────────────────

test('EV-157 U1：cliGroupsConfirmedGone 五格的 gone 与 blockers；why 逐字保持「第一个阻挡项」的旧文字', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const a = t.add(await recordFor('A', `${tmp}:u1a`));
    const b = t.add(await recordFor('B', `${tmp}:u1b`));
    const br = t.add(await recordFor('Br', `${tmp}:u1br`));
    const c = t.add(await recordFor('C', `${tmp}:u1c`));

    const ra = await cliGroupsConfirmedGone(statusWith({ cli: { glm: a.cli } }));
    assert.equal(ra.gone, false);
    assert.equal(ra.why, `glm 侧审查员 CLI 进程组 ${a.pgid} 仍在`);
    assert.deepEqual(ra.blockers, [{ side: 'glm', pgid: a.pgid, kind: 'alive', detail: `glm 侧审查员 CLI 进程组 ${a.pgid} 仍在` }]);

    for (const x of [b, br]) {
      const r = await cliGroupsConfirmedGone(statusWith({ cli: { glm: x.cli } }));
      assert.deepEqual(r, { gone: true, why: '记录里没有仍在的审查员 CLI', blockers: [] }, 'gone / reused 放行');
    }

    const rc = await cliGroupsConfirmedGone(statusWith({ cli: { glm: c.cli } }));
    assert.equal(rc.gone, false);
    assert.equal(rc.why, `glm 侧审查员 CLI 进程组 ${c.pgid} 仍有活进程、启动时刻没记下：判不了`);
    assert.equal(rc.blockers[0]!.kind, 'unverifiable');

    const rd = await cliGroupsConfirmedGone(statusWith({ cli: { glm: { pgid: 'not-a-number' } } }));
    assert.equal(rd.gone, false);
    assert.equal(rd.why, 'CLI 记录读不懂（glm：{"pgid":"not-a-number"}）：判不了');
    assert.deepEqual(rd.blockers, [
      { side: 'glm', pgid: null, kind: 'malformed', detail: 'glm 侧的 CLI 记录读不懂（{"pgid":"not-a-number"}）：判不了' },
    ]);

    const re = await cliGroupsConfirmedGone(statusWith({ cli: {} }));
    assert.deepEqual(re, { gone: true, why: '记录里没有仍在的审查员 CLI', blockers: [] });

    // 两侧都挡住：blockers 两条（按记录顺序），why 只取第一条——EV-157 之前读到第一个就返回
    const both = await cliGroupsConfirmedGone(statusWith({ cli: { gemini: a.cli, glm: c.cli } }));
    assert.equal(both.why, `gemini 侧审查员 CLI 进程组 ${a.pgid} 仍在`);
    assert.deepEqual(both.blockers.map((x) => [x.side, x.kind]), [['gemini', 'alive'], ['glm', 'unverifiable']]);

    // 形状坏与活组并存：why 是「读不懂」那句（形状坏优先），blockers 形状坏在前
    const mixed = await cliGroupsConfirmedGone(statusWith({ cli: { gemini: a.cli, glm: { pgid: 1 } } }));
    assert.equal(mixed.why, 'CLI 记录读不懂（glm：{"pgid":1}）：判不了');
    assert.deepEqual(mixed.blockers.map((x) => [x.side, x.kind]), [['glm', 'malformed'], ['gemini', 'alive']]);
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-165 U1′：cliGroupsConfirmedGone 新增 H / Hz 两格——组长已退、组员仍在阻挡且带精确成员数；成员归零放行', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const h = t.add(await recordFor('H', `${tmp}:u1h`));
    const hz = await recordFor('Hz', `${tmp}:u1hz`);

    const rh = await cliGroupsConfirmedGone(statusWith({ cli: { glm: h.cli } }));
    assert.equal(rh.gone, false);
    const n = await processGroupMemberCount(h.pgid!);
    assert.equal(rh.why, `glm 侧审查员 CLI 进程组 ${h.pgid} 的组长已退出，组里还有 ${n} 个成员`);
    assert.deepEqual(rh.blockers, [
      { side: 'glm', pgid: h.pgid, kind: 'orphaned', detail: rh.why },
    ]);

    const rhz = await cliGroupsConfirmedGone(statusWith({ cli: { glm: hz.cli } }));
    assert.deepEqual(rhz, { gone: true, why: '记录里没有仍在的审查员 CLI', blockers: [] }, '成员归零视同已结束，放行');

    // orphan_unverifiable：成员计数取不到——真实让 ps 失败不现实（零配额、不影响系统），用 memberCountOf 依赖注入
    // 穿透 cliGroupsConfirmedGone（新增的可选第二参数，只为测试开，生产路径不传）
    const hu = t.add(await recordFor('H', `${tmp}:u1hu`));
    const rhu = await cliGroupsConfirmedGone(statusWith({ cli: { glm: hu.cli } }), { memberCountOf: async () => null });
    assert.equal(rhu.gone, false);
    assert.equal(rhu.why, `glm 侧审查员 CLI 进程组 ${hu.pgid} 的组长已退出，组里的非僵尸成员数取不到：判不了`);
    assert.deepEqual(rhu.blockers, [{ side: 'glm', pgid: hu.pgid, kind: 'unverifiable', detail: rhu.why }]);
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-157 U2：scrubAdmission——worker 已不在 × 五格；worker 仍在时不判 CLI（cli 为 null）；scrubHoldWhy 两种形态', async () => {
  const tmp = await uniq();
  const t = tracker();
  const w = await liveWorker(`${tmp}:u2w`);
  try {
    const dead = await deadWorker();
    const expect: Record<Cell, boolean> = { A: false, B: true, Br: true, C: false, D: false, E: true, H: false, Hz: true };
    for (const cell of Object.keys(expect) as Cell[]) {
      const r = t.add(await recordFor(cell, `${tmp}:u2${cell}`));
      const a = await scrubAdmission(statusWith({ worker: dead, cli: { glm: r.cli } }), null);
      assert.equal(a.admit, expect[cell], `格 ${cell}`);
      assert.deepEqual(a.worker, { gone: true, why: `工作进程 ${dead.pid} 已不存在` });
      assert.ok(a.cli, `格 ${cell}：worker 已不在时要判 CLI`);
    }

    // worker 仍在（heartbeat_stale 写成 failed 的那一格）：CLI 一半不判，形状坏的记录也不看
    const alive = await scrubAdmission(statusWith({ phase: 'failed', worker: w, cli: { glm: { pgid: 'x' } } }), null);
    assert.deepEqual(alive, { admit: false, worker: { gone: false, why: `工作进程 ${w.pid} 仍在` }, cli: null });
    assert.equal(scrubHoldWhy(alive), `工作进程 ${w.pid} 仍在`, 'worker 一半未过时逐字是 worker.why');

    const a = t.add(await recordFor('A', `${tmp}:u2hold`));
    const c = t.add(await recordFor('C', `${tmp}:u2hold2`));
    const held = await scrubAdmission(statusWith({ worker: dead, cli: { gemini: a.cli, glm: c.cli } }), null);
    assert.equal(
      scrubHoldWhy(held),
      `工作进程 ${dead.pid} 已不存在，但审查员 CLI 未确认结束——gemini 侧审查员 CLI 进程组 ${a.pgid} 仍在；` +
        `glm 侧审查员 CLI 进程组 ${c.pgid} 仍有活进程、启动时刻没记下：判不了`,
    );
  } finally {
    await w.stop();
    await t.cleanup(tmp);
  }
});

// ─────────────────────────── U3 / U4：清扫与到期整删 ───────────────────────────

async function bucket() {
  const runRoot = await uniq();
  const projectRoot = '/tmp/some-project';
  const cfg = defaultConfig();
  cfg.runtime.run_root = runRoot;
  const b = path.join(runRoot, repoId(projectRoot));
  await fs.mkdir(b, { recursive: true });
  return { cfg, projectRoot, b, runRoot };
}

/** 运行目录：status.json + glm 侧一份 zcode 载体 */
async function runDirWith(b: string, name: string, s: RunStatus) {
  const d = path.join(b, name);
  const carrier = path.join(d, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
  await fs.mkdir(path.join(d, 'glm', 'out'), { recursive: true });
  await writeStatus(d, s);
  return { d, carrier };
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

test('EV-157 U3：admitScrub 行为不变——worker 已不在 × 五格的分档与 detail 文字（会话启动清扫与 trivium scrub 两条路径）；worker 仍在而记录形状坏只进 deferred', async () => {
  const tmp = await uniq();
  const t = tracker();
  const w = await liveWorker(`${tmp}:u3w`);
  try {
    const dead = await deadWorker();
    const { cfg, projectRoot, b } = await bucket();
    const dirs: Partial<Record<Cell, { d: string; carrier: string; pgid: number | null }>> = {};
    for (const cell of ['A', 'B', 'Br', 'C', 'D', 'E'] as Cell[]) {
      const r = t.add(await recordFor(cell, `${tmp}:u3${cell}`));
      const x = await runDirWith(b, `R-${cell}`, statusWith({ worker: dead, cli: { glm: r.cli } }));
      dirs[cell] = { ...x, pgid: r.pgid };
    }
    const staleAlive = await runDirWith(b, 'R-stale', statusWith({ phase: 'failed', worker: w, cli: { glm: { pgid: 'x' } } }));

    const held = [dirs.A!.d, dirs.C!.d, dirs.D!.d].sort();
    const detail = {
      [dirs.A!.d]: `glm 侧审查员 CLI 进程组 ${dirs.A!.pgid} 仍在`,
      [dirs.C!.d]: `glm 侧审查员 CLI 进程组 ${dirs.C!.pgid} 仍有活进程、启动时刻没记下：判不了`,
      [dirs.D!.d]: 'CLI 记录读不懂（glm：{"pgid":"not-a-number"}）：判不了',
    };

    const s = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });
    assert.deepEqual([...s.scrubbed].sort(), [dirs.B!.d, dirs.Br!.d, dirs.E!.d].sort());
    assert.deepEqual([...s.deferred].sort(), [...held, staleAlive.d].sort());
    assert.deepEqual(Object.fromEntries(s.deferredCli.map((x) => [x.dir, x.detail])), detail, 'detail 逐字是 why');
    assert.ok(!s.deferredCli.some((x) => x.dir === staleAlive.d), 'worker 仍在：只进 deferred，不判 CLI、不进 deferredCli');
    for (const c of ['A', 'C', 'D'] as Cell[]) assert.ok(await exists(dirs[c]!.carrier), `格 ${c} 不抹`);
    assert.ok(await exists(staleAlive.carrier));

    // 会话启动清扫（未到期）：同一判据、同一分档
    const p = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
    assert.deepEqual(p.removed, []);
    assert.deepEqual([...p.deferred].sort(), [...held, staleAlive.d].sort());
    assert.deepEqual(Object.fromEntries(p.deferredCli.map((x) => [x.dir, x.detail])), detail);
  } finally {
    await w.stop();
    await t.cleanup(tmp);
  }
});

test('EV-165 U3′：会话启动清扫 / trivium scrub 新增 H / Hz 两格——H 不抹并进 deferredCli 带精确成员数；Hz 照抹', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const dead = await deadWorker();
    const { cfg, projectRoot, b } = await bucket();
    const h = t.add(await recordFor('H', `${tmp}:u3h`));
    const hz = await recordFor('Hz', `${tmp}:u3hz`);
    const dirH = await runDirWith(b, 'R-H', statusWith({ worker: dead, cli: { glm: h.cli } }));
    const dirHz = await runDirWith(b, 'R-Hz', statusWith({ worker: dead, cli: { glm: hz.cli } }));
    const n = await processGroupMemberCount(h.pgid!);
    const detailH = `glm 侧审查员 CLI 进程组 ${h.pgid} 的组长已退出，组里还有 ${n} 个成员`;

    const s = await scrubAllRunRoot(cfg, { adapters: wiredAdapter });
    assert.ok(s.deferred.includes(dirH.d), 'H 格不抹');
    assert.ok(s.scrubbed.includes(dirHz.d), 'Hz 格照抹');
    assert.equal(s.deferredCli.find((x) => x.dir === dirH.d)?.detail, detailH);
    assert.ok(await exists(dirH.carrier), 'H 格载体应在');
    assert.ok(!(await exists(dirHz.carrier)), 'Hz 格载体应已抹');

    const p = await pruneRunDirs(cfg, projectRoot, { adapters: wiredAdapter });
    assert.ok(p.deferred.includes(dirH.d));
    assert.equal(p.deferredCli.find((x) => x.dir === dirH.d)?.detail, detailH);
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-157 U4：到期整删——A / C / D 格不删、计入 kept 并进 deferredCli；B / E 照删；dry-run 下 A 格不进 removed', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const dead = await deadWorker();
    const { cfg, projectRoot, b } = await bucket();
    const dirs: Partial<Record<Cell, string>> = {};
    for (const cell of ['A', 'B', 'Br', 'C', 'D', 'E'] as Cell[]) {
      const r = t.add(await recordFor(cell, `${tmp}:u4${cell}`));
      dirs[cell] = (await runDirWith(b, `R-${cell}`, statusWith({ worker: dead, cli: { glm: r.cli } }))).d;
    }
    const later = Date.now() + (cfg.retention.run_dir_days + 5) * DAY;

    const dry = await pruneRunDirs(cfg, projectRoot, { now: later, dryRun: true, adapters: wiredAdapter });
    assert.deepEqual([...dry.removed].sort(), [dirs.B!, dirs.Br!, dirs.E!].sort(), 'dry-run 与真跑同判据');
    assert.equal(dry.kept, 3);
    for (const d of Object.values(dirs)) assert.ok(await exists(d!), 'dry-run 不动盘');

    const r = await pruneRunDirs(cfg, projectRoot, { now: later, adapters: wiredAdapter });
    assert.deepEqual([...r.removed].sort(), [dirs.B!, dirs.Br!, dirs.E!].sort());
    assert.equal(r.kept, 3, 'A / C / D 当作仍在用');
    assert.deepEqual([...r.deferredCli.map((x) => x.dir)].sort(), [dirs.A!, dirs.C!, dirs.D!].sort(), '落回未到期路径：第四格如实带出');
    for (const c of ['A', 'C', 'D'] as Cell[]) assert.ok(await exists(dirs[c]!), `格 ${c} 目录在`);
    for (const c of ['B', 'Br', 'E'] as Cell[]) assert.ok(!(await exists(dirs[c]!)), `格 ${c} 目录已删`);
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-165 U4′：到期整删新增 H / Hz 两格——H 不删、计入 kept 并进 deferredCli；Hz 照删', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const dead = await deadWorker();
    const { cfg, projectRoot, b } = await bucket();
    const h = t.add(await recordFor('H', `${tmp}:u4h`));
    const hz = await recordFor('Hz', `${tmp}:u4hz`);
    const dirH = (await runDirWith(b, 'R-H', statusWith({ worker: dead, cli: { glm: h.cli } }))).d;
    const dirHz = (await runDirWith(b, 'R-Hz', statusWith({ worker: dead, cli: { glm: hz.cli } }))).d;
    const later = Date.now() + (cfg.retention.run_dir_days + 5) * DAY;

    const r = await pruneRunDirs(cfg, projectRoot, { now: later, adapters: wiredAdapter });
    assert.ok(r.removed.includes(dirHz), 'Hz 格到期照删');
    assert.ok(!r.removed.includes(dirH), 'H 格到期不删');
    assert.ok(r.deferredCli.some((x) => x.dir === dirH), 'H 格落回未到期路径、第四格带出');
    assert.ok(await exists(dirH), 'H 格目录在');
    assert.ok(!(await exists(dirHz)), 'Hz 格目录已删');
  } finally {
    await t.cleanup(tmp);
  }
});

// ─────────────────────────── U5 / U6 / U7：--cancel 与 --wait ───────────────────────────

/** worker 已死的运行目录（status running），glm 侧一份载体，连同归档骨架 */
async function seedDeadRun(ctx: Ctx, runId: string, cli: Partial<Record<'gemini' | 'glm', CliValue>>) {
  const dead = await deadWorker();
  const runDir = runDirFor(ctx.config, ctx.projectRoot, runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'worker.pid'), `${dead.pid}\n`, 'utf8');
  const s = statusWith({ worker: dead, cli });
  s.run_id = runId;
  await writeStatus(runDir, s);
  const carrier = path.join(runDir, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');

  const layout: ArchiveLayout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  const meta = newRunMeta({
    runId, topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'test', promptHint: '焦点', taskGoal: null,
    criticsSelected: ['gemini', 'glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S',
    denyPaths: [], driftPolicy: 'warn',
  });
  await writeRunMeta(layout, 'plan', meta);
  await registerRun(layout, meta, { triviumDir: ctx.triviumDir, heartbeatStaleMs: 120_000 });
  return { runDir, carrier, dead, runJson: path.join(metaDir(layout, 'plan'), `run-${runId}.json`) };
}

const readRunJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8')) as RunMeta;
const glmCli = async (runDir: string) => ((await readStatus(runDir))?.sides.glm as { cli?: unknown } | undefined)?.cli;

test('EV-157 U5：--cancel（worker 已不在）五格——A / C / D 不抹、告警逐侧带组号与成因、被挡侧记录留存；B / E 照抹；归档在五格里都收尾为 cancelled', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    for (const cell of ['A', 'B', 'Br', 'C', 'D', 'E'] as Cell[]) {
      const ctx = await fakeCtx();
      const r = t.add(await recordFor(cell, `${tmp}:u5${cell}`));
      const runId = `R-CANCEL-${cell}`;
      const x = await seedDeadRun(ctx, runId, { glm: r.cli });
      /*
       * A 格：真实进程在 SIGKILL 之下必死，零配额造不出「按记录结束之后仍活着」——注入「发了信号而未确认退出」、
       * 实际一个信号都不发（计划 r2 §3.8 D6）。其余格走真实的 terminateRecordedCliGroups。
       */
      const o =
        cell === 'A'
          ? {
              terminateCli: async (): Promise<RecordedCliOutcome> => ({
                groups: [{ side: 'glm', pgid: r.pgid!, verdict: 'alive', signals: ['SIGTERM', 'SIGKILL'], gone: false, membersLeft: null }],
                malformed: [], malformedRaw: {},
              }),
            }
          : {};
      const { value: code, err } = await captureStderr(() => cancelRun(ctx, runId, o));
      assert.equal(code, EXIT.OK, `格 ${cell}：${err}`);
      const blocked = cell === 'A' || cell === 'C' || cell === 'D';
      assert.equal(await exists(x.carrier), blocked, `格 ${cell}：载体${blocked ? '应在' : '应已抹'}\n${err}`);
      const line = err.split('\n').find((l) => l.includes('凭据副本未抹'));
      if (!blocked) assert.equal(line, undefined, `格 ${cell}：不该有未抹告警\n${err}`);
      else {
        const why =
          cell === 'A'
            ? `glm 侧审查员 CLI 进程组 ${r.pgid} 仍在`
            : cell === 'C'
              ? `glm 侧审查员 CLI 进程组 ${r.pgid} 仍有活进程、启动时刻没记下：判不了`
              : 'glm 侧的 CLI 记录读不懂（{"pgid":"not-a-number"}）：判不了';
        assert.ok(
          line?.endsWith(`凭据副本未抹：工作进程 ${x.dead.pid} 已不存在，但审查员 CLI 未确认结束——${why}——留给会话启动清扫`),
          `格 ${cell}：告警要带侧、组号与成因\n${err}`,
        );
        // 交接载荷（计划双审 r1 GLM-03）：被挡侧的记录原样留在 status.json 里，会话启动清扫据它重判
        assert.deepEqual(await glmCli(x.runDir), r.cli, `格 ${cell}：被挡侧记录应留存`);
      }
      // 归档收尾只看 worker 一半（D5）：五格都收尾
      assert.equal((await readRunJson(x.runJson)).status, 'cancelled', `格 ${cell}：run.json`);
      assert.equal((await readStatus(x.runDir))?.phase, 'cancelled');
    }
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-165 U5‴（代码双审 r1 GLM-02）：reportRecordedCliGroups 对 orphan_unverifiable 的 warn 文案逐字——仿 U5 A 格用 terminateCli 注入伪造 outcome，不需要真实孤儿组也不需要真实 ps 失败', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const ctx = await fakeCtx();
    const c = t.add(await recordFor('C', `${tmp}:u5trip`));
    const runId = 'R-CANCEL-ORPHAN-UNVERIFIABLE';
    const x = await seedDeadRun(ctx, runId, { glm: c.cli });
    const o = {
      terminateCli: async (): Promise<RecordedCliOutcome> => ({
        groups: [{ side: 'glm', pgid: c.pgid!, verdict: 'orphan_unverifiable', signals: [], gone: false, membersLeft: null }],
        malformed: [], malformedRaw: {},
      }),
    };
    const { value: code, err } = await captureStderr(() => cancelRun(ctx, runId, o));
    assert.equal(code, EXIT.OK, err);
    assert.ok(
      err.includes(`glm 侧审查员 CLI 进程组 ${c.pgid} 的组长已退出，组里的非僵尸成员数取不到，判不了是否还有遗留，不发信号——请用 ps 核对`),
      `应逐字打出 orphan_unverifiable 的 warn 文案（MANUAL v1.0.18 已引用，是契约面文案）：\n${err}`,
    );
    // 准入随后独立复查真实记录（格 C：组长活着、启动时刻未记下，同样阻挡）：副本不抹，与本测试要钉的 warn 文案互不影响
    assert.ok(await exists(x.carrier), '副本不抹');
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-165 U5″：--cancel（worker 已不在）新增 H 格——按组结束组员（组信号打到 pgid 仍有效）之后照抹，记录清 null', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const ctx = await fakeCtx();
    const h = t.add(await recordFor('H', `${tmp}:u5h`));
    const runId = 'R-CANCEL-H';
    const x = await seedDeadRun(ctx, runId, { glm: h.cli });

    const { value: code, err } = await captureStderr(() => cancelRun(ctx, runId));
    assert.equal(code, EXIT.OK, err);
    const line = err.split('\n').find((l) => l.includes('凭据副本未抹'));
    assert.equal(line, undefined, `H 格：--cancel 应已按组结束组员、照抹\n${err}`);
    assert.ok(!(await exists(x.carrier)), 'H 格：--cancel 结束组员之后应照抹');
    const n = await untilMemberCount(h.pgid!, (v) => v === 0);
    assert.equal(n, 0, '组员应已被组信号结束');
    assert.equal(await glmCli(x.runDir), null, 'settledCliSides：组已确认清空，记录应清成 null');
    assert.equal((await readRunJson(x.runJson)).status, 'cancelled');
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-157 U5′：--cancel 两侧都挡住（判不了 + 读不懂）⇒ 一行告警逐侧列出', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const ctx = await fakeCtx();
    const c = t.add(await recordFor('C', `${tmp}:u5both`));
    const x = await seedDeadRun(ctx, 'R-CANCEL-BOTH', { gemini: c.cli, glm: { pgid: 'not-a-number' } });
    const { err } = await captureStderr(() => cancelRun(ctx, 'R-CANCEL-BOTH'));
    assert.ok(await exists(x.carrier));
    const lines = err.split('\n').filter((l) => l.includes('凭据副本未抹'));
    assert.equal(lines.length, 1, err);
    assert.ok(
      lines[0]!.endsWith(
        `凭据副本未抹：工作进程 ${x.dead.pid} 已不存在，但审查员 CLI 未确认结束——glm 侧的 CLI 记录读不懂（{"pgid":"not-a-number"}）：判不了；` +
          `gemini 侧审查员 CLI 进程组 ${c.pgid} 仍有活进程、启动时刻没记下：判不了——留给会话启动清扫`,
      ),
      err,
    );
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-157 U6：--wait 判失联（pid_gone）五格——A / C / D 不抹、正文逐侧说明、不结束进程、记录留存；B / E 照抹；归档在五格里都收尾为 failed', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    for (const cell of ['A', 'B', 'Br', 'C', 'D', 'E'] as Cell[]) {
      const ctx = await fakeCtx();
      const r = t.add(await recordFor(cell, `${tmp}:u6${cell}`));
      const runId = `R-WAIT-${cell}`;
      const x = await seedDeadRun(ctx, runId, { glm: r.cli });
      let message = '';
      await assert.rejects(waitRun(ctx, runId, 10), (e: { code?: number; message: string }) => {
        assert.equal(e.code, EXIT.FAIL);
        message = e.message;
        return true;
      });
      assert.match(message, /失联（pid_gone）/);
      const blocked = cell === 'A' || cell === 'C' || cell === 'D';
      assert.equal(await exists(x.carrier), blocked, `格 ${cell}\n${message}`);
      const line = message.split('\n').find((l) => l.includes('凭据副本未抹'));
      if (!blocked) assert.equal(line, undefined, `格 ${cell}\n${message}`);
      else {
        const why =
          cell === 'A'
            ? `glm 侧审查员 CLI 进程组 ${r.pgid} 仍在`
            : cell === 'C'
              ? `glm 侧审查员 CLI 进程组 ${r.pgid} 仍有活进程、启动时刻没记下：判不了`
              : 'glm 侧的 CLI 记录读不懂（{"pgid":"not-a-number"}）：判不了';
        assert.equal(
          line,
          `  凭据副本未抹：工作进程 ${x.dead.pid} 已不存在，但审查员 CLI 未确认结束——${why}（pid_gone），留给会话启动清扫`,
        );
        assert.deepEqual(await glmCli(x.runDir), r.cli, `格 ${cell}：被挡侧记录应留存（GLM-03）`);
      }
      // 出口（代码双审 r1 CODEX-02）：只在有判「仍在」的组时给——判不了、读不懂的 --cancel 也不发信号
      const exit = message.split('\n').find((l) => l.includes('按记录结束'));
      if (cell === 'A') {
        assert.equal(
          exit,
          `  其中仍在的审查员 CLI 可用 trivium review --cancel ${runId} 按记录结束（本命令不结束任何进程）；结束之后下一次会话启动清扫会重判，放行即抹副本`,
        );
      } else assert.equal(exit, undefined, `格 ${cell}：没有判「仍在」的组，不给 --cancel 出口\n${message}`);
      if (r.group) assert.ok(groupMemberCount(r.pgid!) > 0, `格 ${cell}：--wait 不结束任何进程`);
      assert.equal((await readRunJson(x.runJson)).status, 'failed', `格 ${cell}：run.json`);
    }
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-165 U6′：--wait 判失联新增 H 格——不抹、正文带精确成员数、不结束进程；--cancel 出口对 orphaned 也给出（不只 alive）', async () => {
  const tmp = await uniq();
  const t = tracker();
  try {
    const ctx = await fakeCtx();
    const h = t.add(await recordFor('H', `${tmp}:u6h`));
    const runId = 'R-WAIT-H';
    const x = await seedDeadRun(ctx, runId, { glm: h.cli });
    let message = '';
    await assert.rejects(waitRun(ctx, runId, 10), (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.FAIL);
      message = e.message;
      return true;
    });
    assert.match(message, /失联（pid_gone）/);
    assert.ok(await exists(x.carrier), 'H 格：不抹');
    const n = await processGroupMemberCount(h.pgid!);
    const line = message.split('\n').find((l) => l.includes('凭据副本未抹'));
    assert.equal(
      line,
      `  凭据副本未抹：工作进程 ${x.dead.pid} 已不存在，但审查员 CLI 未确认结束——` +
        `glm 侧审查员 CLI 进程组 ${h.pgid} 的组长已退出，组里还有 ${n} 个成员（pid_gone），留给会话启动清扫`,
    );
    // 出口（EV-165：orphaned 同样给出，不只 alive——terminateRecordedCliGroups 现在也会对它发信号）
    const exit = message.split('\n').find((l) => l.includes('按记录结束'));
    assert.equal(
      exit,
      `  其中仍在的审查员 CLI 可用 trivium review --cancel ${runId} 按记录结束（本命令不结束任何进程）；结束之后下一次会话启动清扫会重判，放行即抹副本`,
    );
    assert.ok(groupMemberCount(h.pgid!) > 0, 'H 格：--wait 不结束任何进程');
    assert.equal((await readRunJson(x.runJson)).status, 'failed');
  } finally {
    await t.cleanup(tmp);
  }
});

test('EV-157 U7：worker 仍在（heartbeat_stale）时 --wait 的「凭据副本未抹」逐字不变', async () => {
  const tmp = await uniq();
  const w = await liveWorker(`${tmp}:u7w`);
  try {
    const ctx = await fakeCtx();
    const runDir = runDirFor(ctx.config, ctx.projectRoot, 'R-STALE');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'worker.pid'), `${w.pid}\n`, 'utf8');
    const s = statusWith({ worker: w, cli: { glm: { pgid: 'not-a-number' } } });
    s.run_id = 'R-STALE';
    await writeStatus(runDir, s);
    const sp = path.join(runDir, 'status.json');
    const raw = JSON.parse(await fs.readFile(sp, 'utf8')) as Record<string, unknown>;
    raw['heartbeat_at'] = new Date(Date.now() - 3_600_000).toISOString();
    await fs.writeFile(sp, JSON.stringify(raw, null, 2) + '\n', 'utf8');

    let message = '';
    await assert.rejects(waitRun(ctx, 'R-STALE', 10), (e: { message: string }) => {
      message = e.message;
      return true;
    });
    const line = message.split('\n').find((l) => l.includes('凭据副本未抹'));
    assert.equal(line, `  凭据副本未抹：工作进程 ${w.pid} 仍在（heartbeat_stale），留给会话启动清扫`);
  } finally {
    await w.stop();
  }
});

}
