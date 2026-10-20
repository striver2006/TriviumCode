/**
 * EV-154：审查员 CLI 进程组记录（CLI进程组记录计划 r2 §5.1 U10～U13、U15、U16）。
 *
 * 真实进程一律 `detached` 派生、命令行带本次随机标记，`finally` 按组号结束（`test/helpers/proc.ts`）。
 * 不触碰 `shutdownTrackedTrees` 的冻结——那是模块级、不可撤销的，这里的用例都在测试进程内跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  processGroupMemberCount, processStartTime, run, trackedTrees, watchTrackedTrees, withTreeTag, type RunResult, type TrackedTree,
} from '../../src/trivium/util/exec.js';
import {
  cliGroupsConfirmedGone, cliRecordsOf, judgeCliGroup, newStatus, syncCliRecords, type RunStatus,
} from '../../src/trivium/status.js';
import { terminateRecordedCliGroups } from '../../src/trivium/run-protocol.js';
import { groupMemberCount, groupsWithMark, killGroup } from '../helpers/proc.js';

// 2026-10-20 试验后维持 win32 整文件跳过（第三批复盘）：本文件是活体进程组语义族——/bin/sh 硬编码、
// 负 pgid 组信号（process.kill(-pgid)）、SIGTERM→SIGKILL 升级阶梯，win32 需按 §7.1 等价改写
// （taskkill 树杀 + 父链闭包）而非形态适配，属 §3.1-1/6 重改写族，登记后续批次。
if (process.platform === 'win32') {
  console.log('skip（win32）: 活体 POSIX 进程组语义（负 pgid 信号/SIGTERM 升级阶梯），需等价改写非形态适配');
} else {

const MARK = `trivium-u-clirec-${process.pid}-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 以 detached 派生一个 `sh` 组长（带标记）+ `sleep` 组员；返回句柄与退出 Promise */
function spawnGroup(tag: string, body = 'sleep 600'): { child: ChildProcess; pgid: number; exited: Promise<void> } {
  const child = spawn('/bin/sh', ['-c', `${body}; : "$0"`, `${MARK}-${tag}`], { detached: true, stdio: 'ignore' });
  const exited = new Promise<void>((r) => child.once('exit', () => r()));
  return { child, pgid: child.pid!, exited };
}

async function until<T>(f: () => T | Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  let v = await f();
  while (!ok(v) && Date.now() < deadline) {
    await sleep(50);
    v = await f();
  }
  return v;
}

/**
 * 按组结束，并等到组号下没有非僵尸成员（BACKLOG EV-170）。只等组长 exit 不够：按组 SIGKILL 的那一刻 `sh` 若正在派生
 * `sleep`，子进程偶尔漏过信号、留在组里（零配额探针 1000 次 1 次，`doc/05_testing/evidence/scrub-help-main-clause-20260929/`），
 * EV-165 起判据把这种状态判 `orphaned` 而不是 `gone`，用例「这一组已结束」的前提就不成立。
 * 数法与生产判据同源（`processGroupMemberCount`，排除僵尸——满载下孤儿僵尸回收慢，不能拿来当前提）；漏网的成员再补一次 SIGKILL。
 */
async function endGroup(g: { pgid: number; exited: Promise<void> }): Promise<void> {
  killGroup(g.pgid);
  await g.exited;
  const left = await until(
    async () => {
      const n = await processGroupMemberCount(g.pgid);
      if (n !== 0) killGroup(g.pgid);
      return n;
    },
    (n) => n === 0,
    5000,
  );
  assert.equal(left, 0, `组 ${g.pgid} 应已清空（用例前提），非僵尸成员：${left}`);
}

function cleanup(): void {
  for (const g of groupsWithMark(MARK)) killGroup(g);
}

function statusWith(sides: Record<string, unknown>): RunStatus {
  const s = newStatus({ runId: 'R', topic: 't', stage: 'plan', sides: ['gemini', 'glm'], models: {} });
  for (const [k, v] of Object.entries(sides)) (s.sides as Record<string, Record<string, unknown>>)[k]!['cli'] = v;
  return s;
}

test('EV-154 U10：liveTrees 的投影——withTreeTag 标侧、有观察者时派生即通知并补规范化启动时刻、退出时删除并通知；没有观察者不取启动时刻', async () => {
  let calls = 0;
  const unwatch = watchTrackedTrees(() => {
    calls++;
  });
  const pending: Array<Promise<RunResult>> = [];
  try {
    assert.throws(() => watchTrackedTrees(() => {}), /已有观察者/, '只许一个观察者：两个写者就是两份登记');

    await withTreeTag('glm', async () => {
      pending.push(run('/bin/sh', ['-c', 'sleep 600; : "$0"', `${MARK}-u10a`], { killTree: true }));
    });
    pending.push(run('/bin/sh', ['-c', 'sleep 600; : "$0"', `${MARK}-u10b`], { killTree: true }));
    const plain = run('/bin/sh', ['-c', 'sleep 0.3'], {});

    const snap0 = trackedTrees();
    assert.equal(snap0.length, 2, `不带 killTree 的不进登记：${JSON.stringify(snap0)}`);
    assert.deepEqual(snap0.map((t) => t.tag), ['glm', null], 'withTreeTag 之内派生的带侧名、之外的为 null');
    assert.ok(calls >= 2, '派生当时即通知');

    const filled = await until(trackedTrees, (x) => x.every((t) => t.startedAt !== null), 5000);
    assert.ok(filled.every((t) => t.startedAt !== null), `启动时刻应已补上：${JSON.stringify(filled)}`);
    for (const t of filled) {
      assert.equal(t.startedAt, await processStartTime(t.pgid, { canonical: true }), '补的是规范化启动时刻');
    }
    assert.ok(calls >= 4, '取到启动时刻后再通知一次');
    await plain;

    const [a, b] = filled as [TrackedTree, TrackedTree];
    const before = calls;
    killGroup(a.pgid);
    await pending[0];
    assert.deepEqual(trackedTrees().map((t) => t.pgid), [b.pgid], '退出即从登记删除');
    assert.ok(calls > before, '删除时通知');

    unwatch();
    const afterUnwatch = calls;
    killGroup(b.pgid);
    await pending[1];
    assert.equal(calls, afterUnwatch, '卸载后不再通知');

    // 没有观察者：登记照做，但不多一次 ps
    pending.push(run('/bin/sh', ['-c', 'sleep 600; : "$0"', `${MARK}-u10c`], { killTree: true }));
    await sleep(700);
    const snap = trackedTrees();
    assert.equal(snap.length, 1);
    assert.equal(snap[0]!.startedAt, null, '没有观察者时不取启动时刻');
    killGroup(snap[0]!.pgid);
    await pending[2];
  } finally {
    unwatch();
    cleanup();
  }
});

test('EV-154 U11：syncCliRecords 按侧名投影、每侧取最近登记的一个、没有则清成 null', () => {
  const s = statusWith({});
  syncCliRecords(s, [
    { pgid: 101, tag: 'gemini', startedAt: 'A' },
    { pgid: 102, tag: null, startedAt: 'B' },
    { pgid: 103, tag: 'glm', startedAt: null },
    { pgid: 104, tag: 'codex', startedAt: 'C' },
    { pgid: 105, tag: 'gemini', startedAt: 'D' },
  ]);
  assert.deepEqual(s.sides.gemini?.cli, { pgid: 105, started_at: 'D' }, '同一侧两条取后登记的');
  assert.deepEqual(s.sides.glm?.cli, { pgid: 103, started_at: null });
  assert.equal(s.sides.codex, undefined, '不在 sides 里的侧不新增');

  syncCliRecords(s, [{ pgid: 103, tag: 'glm', startedAt: 'E' }]);
  assert.equal(s.sides.gemini?.cli, null, '快照里没有了就清成 null');
  assert.deepEqual(s.sides.glm?.cli, { pgid: 103, started_at: 'E' });

  syncCliRecords(s, []);
  assert.equal(s.sides.gemini?.cli, null);
  assert.equal(s.sides.glm?.cli, null);
});

test('EV-154 U12：cliRecordsOf 三态——缺席或 null 是没有记录，形状坏的单列 malformed（计划双审 r1 GLM-02）', () => {
  assert.deepEqual(cliRecordsOf(null), { records: [], malformed: [] });
  assert.deepEqual(cliRecordsOf(newStatus({ runId: 'R', topic: 't', stage: 'plan', sides: ['glm'], models: {} })), {
    records: [], malformed: [],
  }, '旧 worker 写的：键缺席');
  assert.deepEqual(cliRecordsOf(statusWith({ gemini: null, glm: { pgid: 4242, started_at: 'X' } })), {
    records: [{ side: 'glm', pgid: 4242, started_at: 'X' }], malformed: [],
  });
  for (const bad of [{ pgid: '4242', started_at: null }, { pgid: 1, started_at: null }, { pgid: 0, started_at: null },
    { pgid: 42.5, started_at: null }, { pgid: 4242, started_at: 7 }, { started_at: null }, 'x', 42]) {
    assert.deepEqual(cliRecordsOf(statusWith({ glm: bad })), { records: [], malformed: ['glm'] }, JSON.stringify(bad));
  }
});

test('EV-154 U13：judgeCliGroup——组长在且规范化启动时刻相符才是 alive；不符 reused、没记下 unverifiable、不在 gone', async () => {
  const g = spawnGroup('u13');
  try {
    const t = await processStartTime(g.pgid, { canonical: true });
    assert.ok(t, '取得到启动时刻（用例前提）');
    assert.equal(await judgeCliGroup({ pgid: g.pgid, started_at: t }), 'alive');
    assert.equal(await judgeCliGroup({ pgid: g.pgid, started_at: 'Thu Jan  1 00:00:00 1970' }), 'reused');
    assert.equal(await judgeCliGroup({ pgid: g.pgid, started_at: null }), 'unverifiable');
    await endGroup(g);
    assert.equal(await judgeCliGroup({ pgid: g.pgid, started_at: t }), 'gone');
    assert.equal(await judgeCliGroup({ pgid: g.pgid, started_at: null }), 'gone', '没记下启动时刻的，进程不在时照样判 gone（AGY-01）');
  } finally {
    cleanup();
  }
});

test('EV-154 U15：terminateRecordedCliGroups 只对 alive 的组走宽限链（含升级 SIGKILL），各组并行；收尾后数组成员', async () => {
  const a = spawnGroup('u15a');
  const b = spawnGroup('u15b', "trap '' TERM; sleep 600");
  try {
    const s = statusWith({
      gemini: { pgid: a.pgid, started_at: await processStartTime(a.pgid, { canonical: true }) },
      glm: { pgid: b.pgid, started_at: await processStartTime(b.pgid, { canonical: true }) },
    });
    assert.equal((await cliGroupsConfirmedGone(s)).gone, false, '准入侧：两组都活着');
    const t0 = Date.now();
    const r = await terminateRecordedCliGroups(s, { graceMs: 500, killWaitMs: 2000, pollMs: 50 });
    const ms = Date.now() - t0;
    const bySide = Object.fromEntries(r.groups.map((g) => [g.side, g]));
    assert.deepEqual(bySide['gemini']?.signals, ['SIGTERM']);
    assert.deepEqual(bySide['glm']?.signals, ['SIGTERM', 'SIGKILL'], '忽略 SIGTERM 的那组要升级 SIGKILL');
    for (const g of r.groups) {
      assert.equal(g.verdict, 'alive');
      assert.equal(g.gone, true, `${g.side} 应确认退出`);
      assert.equal(g.membersLeft, 0, `${g.side} 组里不该有遗留`);
    }
    await Promise.all([a.exited, b.exited]);
    assert.equal(groupMemberCount(a.pgid) + groupMemberCount(b.pgid), 0, '两组都空了');
    assert.deepEqual(r.malformed, []);
    // 并行：宽限 500 ms，串行时忽略 SIGTERM 的那组要排在后面，这里只防挂住
    assert.ok(ms < 500 + 2000 + 1500, `耗时 ${ms} ms`);
    assert.equal((await cliGroupsConfirmedGone(s)).gone, true, '准入侧：组长都不在了');
  } finally {
    cleanup();
  }
});

test('EV-154 U15（不发信号的格）：reused、unverifiable、形状坏、已退出的记录一个信号都不发', async () => {
  const live = spawnGroup('u15c');
  const dead = spawnGroup('u15d');
  try {
    const deadStart = await processStartTime(dead.pgid, { canonical: true });
    await endGroup(dead);
    const sent: Array<[number, string]> = [];
    const count = (pid: number, sig: NodeJS.Signals) => {
      sent.push([pid, sig]);
      return true;
    };
    const s = newStatus({ runId: 'R', topic: 't', stage: 'plan', sides: ['codex', 'gemini', 'glm', 'claude'], models: {} });
    s.sides.codex!.cli = { pgid: live.pgid, started_at: 'Thu Jan  1 00:00:00 1970' };
    s.sides.gemini!.cli = { pgid: live.pgid, started_at: null };
    (s.sides.glm as unknown as Record<string, unknown>)['cli'] = { pgid: 'bad' };
    s.sides.claude!.cli = { pgid: dead.pgid, started_at: deadStart };
    const r = await terminateRecordedCliGroups(s, { signal: count, graceMs: 200, killWaitMs: 200, pollMs: 50 });
    assert.deepEqual(sent, [], `不该发任何信号：${JSON.stringify(sent)}`);
    const v = Object.fromEntries(r.groups.map((g) => [g.side, g.verdict]));
    assert.deepEqual(v, { codex: 'reused', gemini: 'unverifiable', claude: 'gone' });
    assert.deepEqual(r.malformed, ['glm']);
    assert.equal(groupMemberCount(live.pgid), 2, '活着的那组没被碰');
    const adm = await cliGroupsConfirmedGone(s);
    assert.equal(adm.gone, false, '准入侧：形状坏与判不了都不可抹');
  } finally {
    cleanup();
  }
});

test('EV-165 U15 变体（取代 EV-154 版，计划双审 r1 GLM-04）：组长服从 SIGTERM 而组员忽略——升级 SIGKILL 结束残留成员', async () => {
  /*
   * 组长 sh 在 wait 中收到 SIGTERM 即退出；后台子 shell 忽略 TERM 后 exec sleep，sleep 继承忽略。
   * EV-154 时代的契约是「组长一退出就判 gone，isGone 立即为真，不再升级」（旧断言：signals 只有 SIGTERM、
   * membersLeft>=1 且不再处理）。EV-165 起 judgeCliGroup 在组长确认不在时改按非僵尸成员数判——这里成员数 > 0，
   * 判 orphaned 而不是 gone，isGone（只认 gone/reused）持续为假，terminateProcessGroup 会继续升级到 SIGKILL
   * 直至成员归零，这是本主题要改变的确切行为，旧断言与新代码矛盾、不能共存。
   */
  const g = spawnGroup('u15e', `(trap '' TERM; exec sleep 600) & wait`);
  try {
    await until(() => groupMemberCount(g.pgid), (n) => n >= 2, 3000);
    assert.ok(groupMemberCount(g.pgid) >= 2, '组里应有组长与后台子进程（用例前提）');
    const s = statusWith({ glm: { pgid: g.pgid, started_at: await processStartTime(g.pgid, { canonical: true }) } });
    const r = await terminateRecordedCliGroups(s, { graceMs: 300, killWaitMs: 1000, pollMs: 50 });
    const one = r.groups[0]!;
    assert.equal(one.verdict, 'alive', '入判时组长仍活着');
    assert.equal(one.gone, true, '升级 SIGKILL 后组应确认清空');
    assert.deepEqual(one.signals, ['SIGTERM', 'SIGKILL'], '组长退出但成员仍在（判 orphaned）⇒ 继续升级，不再停在 SIGTERM');
    assert.equal(one.membersLeft, 0, 'SIGKILL 后不应再有遗留成员');
  } finally {
    killGroup(g.pgid);
    cleanup();
  }
});

test('EV-154 U16（计划双审 r1 CODEX-01）：规范化启动时刻与调用方的 TZ / 区域设置无关；不带选项的则随之变化', async () => {
  /*
   * 改 process.env 能改到 ps 的环境：run() 在**派生时**把 process.env 拷给子进程，所以两次取值的 ps 环境确实不同。
   * 变异 M15（去掉 canonical 的 env）让本用例红，两次取值为 `lun. 28 sept. …` 与 `Sun Sep 27 …`——本用例守得住
   * 「LC_ALL=C、TZ=UTC0 能钉住 ps」这一前提：某版 ps 不再吃这组变量时，两次规范化取值会不同，本用例自己就红
   * （代码双审 r1 CODEX-02 驳回的依据）。
   */
  const g = spawnGroup('u16');
  const saved = { TZ: process.env['TZ'], LANG: process.env['LANG'], LC_ALL: process.env['LC_ALL'], LC_TIME: process.env['LC_TIME'] };
  const setEnv = (e: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(e)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    setEnv({ TZ: 'Asia/Tokyo', LANG: 'fr_FR.UTF-8', LC_ALL: 'fr_FR.UTF-8', LC_TIME: undefined });
    const c1 = await processStartTime(g.pgid, { canonical: true });
    const p1 = await processStartTime(g.pgid);
    setEnv({ TZ: 'America/New_York', LANG: 'C', LC_ALL: undefined, LC_TIME: undefined });
    const c2 = await processStartTime(g.pgid, { canonical: true });
    const p2 = await processStartTime(g.pgid);
    assert.ok(c1 !== null && p1 !== null && p2 !== null);
    assert.notEqual(p1, p2, `前提：不带选项时随环境变（${p1} / ${p2}）`);
    assert.equal(c1, c2, `规范化的两次应相同（${c1} / ${c2}）`);
  } finally {
    setEnv(saved);
    cleanup();
  }
});

test('EV-154 U17（代码双审 r1 GLM-01）：入判 alive 之后轮询中 ps 瞬时失败（判 unverifiable）——继续按原链升级 SIGKILL，不提前收手', async () => {
  const sent: NodeJS.Signals[] = [];
  let killed = false;
  const s = statusWith({ glm: { pgid: 424242, started_at: 'Mon Sep 28 02:00:00 2026' } });
  let calls = 0;
  const judge = async () => {
    calls++;
    if (calls === 1) return 'alive' as const; // 入判：身份已确认
    return killed ? ('gone' as const) : ('unverifiable' as const); // 轮询中 ps 取不到启动时刻，组长仍活
  };
  const r = await terminateRecordedCliGroups(s, {
    judge,
    signal: (_p, sig) => {
      sent.push(sig);
      if (sig === 'SIGKILL') killed = true;
      return true;
    },
    graceMs: 200,
    killWaitMs: 500,
    pollMs: 20,
  });
  assert.deepEqual(sent, ['SIGTERM', 'SIGKILL'], '判不了不是「已不在」：宽限尽头照常升级');
  assert.equal(r.groups[0]!.gone, true);
});

}
