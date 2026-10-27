/**
 * EV-251：doctor 的总时限（预检失败自动校准计划 r2 D3；第三节 I2 / I3 / I4 / I6 / I8 / I9）。
 *
 * 零配额：经 `runDoctor` 跑 agy 段，入口是本测试写的假 agy（`--version` / `models` 秒回，模型调用挂住或秒败）。
 * 家目录钉到夹具（agy 的 Agent 文件读 HOME），系统临时目录经 TMPDIR 钉到夹具（数探针临时目录的残留）。
 * 真实进程带本次随机标记，`finally` 按组号兜底结束。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { DOCTOR_RERUN_ENTRY, runDoctor, type DoctorOptions, type DoctorReport } from '../../src/trivium/doctor.js';
import { DeadlineController, sweepDoctorLedgers, unfinishedSectionNote } from '../../src/trivium/doctor-deadline.js';
import { TRIVIUM_DIR, agentConfigOf, defaultConfig } from '../../src/trivium/config.js';
import { runPreflight } from '../../src/trivium/preflight.js';
import { run } from '../../src/trivium/util/exec.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Config, ProbeSection } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';
import { groupsWithMark, killMarked } from '../helpers/proc.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';
import { skipOnWin } from '../helpers/platform.js';

isolateEntryScanHome();

const WIN_SKIP = skipOnWin('POSIX 进程组语义：/bin/sh 的 trap TERM、/bin/ps、shebang 假 CLI；Windows 侧按父链树杀，纯函数快照见 win-section-snapshot.test.ts（双平台统一时补）');

const MARK = `trivium-u-dldl-${process.pid}-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 假 agy：`--version` / `models` 秒回；模型调用按 FAKE_AGY_MODE 挂住（拉起一个忽略 TERM 的后代、吐半截 JSON）或秒败 */
async function fakeAgy(dir: string): Promise<string> {
  const p = path.join(dir, 'agy');
  await fs.writeFile(p, [
    `#!${process.execPath}`,
    "const a = process.argv.slice(2);",
    "if (a[0] === '--version') { console.log('agy 0.0.1'); process.exit(0); }",
    "if (a[0] === 'models') { console.log('gemini-3.8-flash-high'); process.exit(0); }",
    "if (process.env.FAKE_AGY_MODE === 'fail') { console.error('fake model failure'); process.exit(3); }",
    "require('child_process').spawn('/bin/sh', ['-c', 'trap \"\" TERM; sleep 600; : \"$0\"', process.env.FAKE_AGY_MARK], { stdio: 'ignore' });",
    "process.stdout.write('{\"partial\": ');",
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'), { mode: 0o755 });
  return p;
}

interface World {
  root: string;
  triviumDir: string;
  ledgerDir: string;
  tmp: string;
  cfg: Config;
}

async function world(): Promise<World> {
  const root = await scratchDir('trivium-dldl-');
  const triviumDir = path.join(root, TRIVIUM_DIR);
  await fs.mkdir(triviumDir, { recursive: true });
  for (const d of ['bin', 'home', 'ledger', 'tmp']) await fs.mkdir(path.join(root, d));
  const cfg = defaultConfig();
  agentConfigOf(cfg, 'gemini', 'antigravity').bin = await fakeAgy(path.join(root, 'bin'));
  return { root, triviumDir, ledgerDir: path.join(root, 'ledger'), tmp: path.join(root, 'tmp'), cfg };
}

/** HOME、TMPDIR 与假 agy 的模式钉到夹具；结束后恢复，并按标记兜底结束遗留进程组 */
async function pinned<T>(w: World, mode: 'hang' | 'fail', mark: string, fn: () => Promise<T>): Promise<T> {
  const keys = ['HOME', 'TMPDIR', 'FAKE_AGY_MODE', 'FAKE_AGY_MARK'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env['HOME'] = path.join(w.root, 'home');
  process.env['TMPDIR'] = w.tmp;
  process.env['FAKE_AGY_MODE'] = mode;
  process.env['FAKE_AGY_MARK'] = mark;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    killMarked(mark);
  }
}

function doctor(w: World, extra: Partial<DoctorOptions> & { ms?: number; unwindMs?: number } = {}): Promise<DoctorReport> {
  const { ms = 1500, unwindMs, ...rest } = extra;
  return runDoctor({
    config: w.cfg, projectRoot: w.root, triviumDir: w.triviumDir, only: 'agy',
    ledgerDir: w.ledgerDir,
    deadline: { ms, ...(unwindMs !== undefined ? { unwindMs } : {}), graceMs: 300, killWaitMs: 1000, handleSignals: false },
    ...rest,
  });
}

async function untilNoGroups(mark: string, ms: number): Promise<number[]> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const g = groupsWithMark(mark);
    if (g.length === 0) return g;
    await sleep(100);
  }
  return groupsWithMark(mark);
}

async function diskProbe(w: World): Promise<Partial<ProbeSection>> {
  const raw = await fs.readFile(path.join(w.triviumDir, 'config.local.yaml'), 'utf8');
  return (YAML.parse(raw) as { probe: Partial<ProbeSection> }).probe;
}

test('I2 模型调用挂住、后代忽略 TERM、吐半截 JSON：到点退 76 的结果，按组结束不留进程、探针临时目录已删、在跑段不落盘；随后重跑预检仍退 69（GLM-02）', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const mark = `${MARK}-i2`;
  /*
   * 预置一份**旧但有效**的 agy 结论（落盘与内存同一份）：若新鲜度改看全局 generated_at（doctor 收尾会刷新它），
   * 这份旧结论就会被当成新鲜、重跑预检随之放行——下面那条「仍退 69」才咬得住这类重构（GLM-02）。
   */
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const seededAgy = {
    entrypoint: agentConfigOf(w.cfg, 'gemini', 'antigravity').bin, version: '0.0.1', probed_at: old,
    models: ['gemini-3.8-flash-high'], headless_read_ok: true, agent: 'trivium-critic',
  };
  Object.assign(w.cfg.probe.cli.agy!, seededAgy);
  w.cfg.probe.generated_at = old;
  await fs.writeFile(path.join(w.triviumDir, 'config.local.yaml'), YAML.stringify({ probe: { generated_at: old, cli: { agy: seededAgy } } }));
  await pinned(w, 'hang', mark, async () => {
    const r = await doctor(w);
    const d = r.deadline!;
    assert.ok(d, 'deadline 段缺席');
    assert.equal(d.hit, true);
    assert.equal(d.reason, 'deadline');
    assert.equal(d.stuck, false, '协作式中止应在兜底之前退出来');
    assert.equal(d.sections.length, 1);
    const s = d.sections[0]!;
    assert.equal(s.only, 'agy');
    assert.equal(s.state, 'in_progress');
    assert.ok(s.launches >= 3, `launches=${s.launches}`);
    assert.equal(s.rerun, `${DOCTOR_RERUN_ENTRY} doctor --only agy`);
    assert.match(s.note!, /EV-243/);
    assert.match(s.note!, new RegExp(`拉起 ${s.launches} 次子进程`));
    assert.deepEqual(d.residue, []);

    assert.deepEqual(await untilNoGroups(mark, 3000), [], '假 agy 拉起的后代应已按组结束');
    const leftTmp = (await fs.readdir(w.tmp)).filter((n) => n.startsWith('trivium-'));
    assert.deepEqual(leftTmp, [], '探针临时目录应已删');
    assert.deepEqual((await fs.readdir(w.ledgerDir)).filter((n) => n.startsWith('doctor-temp-')), [], '台账处理完即删');

    const probe = await diskProbe(w);
    const agyOnDisk = probe.cli?.['agy'] as Record<string, unknown> | undefined;
    for (const [k, v] of Object.entries(seededAgy)) assert.deepEqual(agyOnDisk?.[k], v, `在跑段作废、盘上 agy.${k} 不得被改`);
    assert.ok(probe.host, 'env 段照常落盘');
    assert.ok(probe.generated_at && probe.generated_at !== old, '收尾照常刷新 generated_at');

    // 被作废那一家：新鲜度按各家自己的 probed_at 判，不看刷新过的 generated_at ⇒ 重跑预检仍退 69、点名它
    const cfg = defaultConfig();
    cfg.probe = { ...cfg.probe, ...probe, cli: { ...cfg.probe.cli, ...(probe.cli ?? {}) } } as ProbeSection;
    await initFixtureRepo(w.root).catch(() => undefined);
    const pf = await runPreflight({
      ctx: { config: cfg, projectRoot: w.root, archiveRoot: path.join(w.root, '.reviews'), triviumDir: w.triviumDir, sources: ['<test>'] },
      scope: 'plan', skipAuthCheck: true, critics: ['gemini'],
    });
    assert.equal(pf.exitCode, EXIT.ENV);
    assert.ok(pf.recalibration?.invocations.some((i) => i.only === 'agy'), JSON.stringify(pf.checks.filter((c) => !c.ok)));
  });
});

test('I3 不给 --only：第一段到点没探完，后面各段 not_started，且不被说成「尚无探针实现」', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const mark = `${MARK}-i3`;
  await pinned(w, 'hang', mark, async () => {
    const r = await doctor(w, { only: null });
    const states = Object.fromEntries(r.deadline!.sections.map((s) => [s.only, s.state]));
    assert.equal(states['agy'], 'in_progress');
    for (const cli of ['zcode', 'codex', 'claude']) assert.equal(states[cli], 'not_started', cli);
    assert.ok(!r.notes.some((n) => /尚无探针实现/.test(n)), r.notes.join('\n'));
    for (const s of r.deadline!.sections.filter((x) => x.state === 'not_started')) {
      assert.equal(s.launches, 0);
      // 没开始的段不说「配额已花」（代码三审 AGY-02 ≡ GLM-05）
      assert.equal(s.note, unfinishedSectionNote(0));
      assert.match(s.note!, /没有花配额/);
      assert.doesNotMatch(s.note!, /配额已花/);
    }
    assert.deepEqual(await untilNoGroups(mark, 3000), []);
  });
});

test('I4 兜底：段卡在不经 run() 的 await 上，控制器在兜底时长后按已记状态出结果（stuck），不等挂住的 await（AGY-02）', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const mark = `${MARK}-i4`;
  await pinned(w, 'hang', mark, async () => {
    const t0 = Date.now();
    const r = await doctor(w, {
      ms: 300, unwindMs: 300,
      sectionPrelude: (cli) => (cli === 'agy' ? new Promise<void>(() => {}) : Promise.resolve()),
    });
    assert.ok(Date.now() - t0 < 10_000, '应在时限加兜底之内返回');
    assert.equal(r.deadline!.hit, true);
    assert.equal(r.deadline!.stuck, true);
    assert.equal(r.deadline!.sections[0]!.state, 'in_progress');
  });
});

test('I6 段内不带 killTree 的派生（模拟 git 辅助调用）到点也按组结束，按时出结果（CODEX-02）', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const mark = `${MARK}-i6`;
  await pinned(w, 'hang', mark, async () => {
    const r = await doctor(w, {
      ms: 500,
      sectionPrelude: async (cli) => {
        if (cli === 'agy') await run('/bin/sh', ['-c', `trap "" TERM; sleep 600; : "${mark}"`]);
      },
    });
    assert.equal(r.deadline!.hit, true);
    assert.equal(r.deadline!.stuck, false);
    // 中止之后探针是**正常返回**的（不是抛出）：这一支同样要作废，不得记成探完、不得落盘（变异 M2）
    assert.equal(r.deadline!.sections[0]!.state, 'in_progress');
    assert.ok(!(await diskProbe(w)).cli?.['agy']?.probed_at, '作废段不落盘');
    assert.deepEqual(await untilNoGroups(mark, 3000), []);
  });
});

test('I9 未到点、模型调用秒败：段 finished、hit false，各段 notes 与 rerun 齐全、不带 note（CODEX-06）', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const mark = `${MARK}-i9`;
  await pinned(w, 'fail', mark, async () => {
    const r = await doctor(w, { ms: 60_000 });
    const d = r.deadline!;
    assert.equal(d.hit, false);
    assert.equal(d.reason, null);
    const s = d.sections[0]!;
    assert.equal(s.state, 'finished');
    assert.equal(s.rerun, `${DOCTOR_RERUN_ENTRY} doctor --only agy`);
    assert.equal(s.note, undefined);
    assert.ok(s.notes.length > 0 && s.notes.every((n) => n.startsWith('[agy] ')), s.notes.join('\n'));
    assert.ok(s.notes.some((n) => /headless_read_ok=false/.test(n)), s.notes.join('\n'));
    assert.ok((await diskProbe(w)).cli?.['agy']?.probed_at, '探完的段照常落盘');
  });
});

test('I10 环境段挂住（第一个探针段之前）：到点照样由兜底按时出结果，residue 说明环境段没跑完（代码三审 CODEX-02）', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const mark = `${MARK}-i10`;
  await pinned(w, 'hang', mark, async () => {
    const t0 = Date.now();
    const r = await doctor(w, {
      ms: 300, unwindMs: 300,
      sectionPrelude: (cli) => (cli === 'env' ? new Promise<void>(() => {}) : Promise.resolve()),
    });
    assert.ok(Date.now() - t0 < 12_000, `应在时限加兜底与收尾下限之内返回，实际 ${Date.now() - t0} ms`);
    assert.equal(r.deadline!.hit, true);
    assert.equal(r.deadline!.stuck, true);
    assert.equal(r.deadline!.sections[0]!.state, 'not_started');
    assert.ok(r.deadline!.residue.some((x) => /环境段在时限内没跑完/.test(x)), r.deadline!.residue.join('\n'));
  });
});

test('U6 控制器：在写的 checkpoint 永不兑现时，兜底照样在到点后的兜底时长内兑现（代码三审 CODEX-03）', async () => {
  const c = new DeadlineController({ ms: 20, unwindMs: 50, graceMs: 0, killWaitMs: 0, handleSignals: false });
  c.track(new Promise(() => {}));
  c.start();
  const fired = await Promise.race([c.stuck.then(() => true), sleep(2000).then(() => false)]);
  c.stop();
  assert.equal(fired, true, '兜底计时器应在到点时即起算，不等按组结束与 checkpoint');
  assert.equal(c.reason, 'deadline');
});

test('U7 收尾的一步已在按长预算等待时收到信号：这一步随兜底放弃，不按旧预算等下去（代码审第 2 轮 CODEX-01）', async () => {
  const c = new DeadlineController({ ms: 600_000, unwindMs: 100, graceMs: 0, killWaitMs: 0, handleSignals: false });
  c.start();
  const t0 = Date.now();
  const step = c.limitStep(new Promise<never>(() => {}));
  setTimeout(() => c.fire('signal'), 50);
  const r = await Promise.race([step, sleep(3000).then(() => 'late' as const)]);
  c.stop();
  assert.deepEqual(r, { ok: false }, '应在兜底触发时放弃，而不是按总时限加兜底的旧预算等');
  assert.ok(Date.now() - t0 < 2000, `实际等了 ${Date.now() - t0} ms`);
  assert.equal(c.stuckFired, true);
  // 兜底之后的各步只给下限：一个马上兑现的步照常返回值
  assert.deepEqual(await c.limitStep(Promise.resolve(7)), { ok: true, value: 7 });
});

test('I11 不带时限的普通 doctor 也补删已退出进程留下的台账（代码三审 CODEX-04 ≡ GLM-03）', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const saved = process.env['TMPDIR'];
  process.env['TMPDIR'] = w.tmp;
  try {
    const victim = path.join(w.tmp, 'trivium-zcode-doctor-Qw3Er4');
    await fs.mkdir(victim);
    const dead = spawnSync('/usr/bin/true').pid!;
    await fs.writeFile(path.join(w.ledgerDir, `doctor-temp-${dead}.json`), JSON.stringify({ pid: dead, dirs: [victim] }));
    const r = await runDoctor({
      config: w.cfg, projectRoot: w.root, triviumDir: w.triviumDir, only: 'env', skipModelCalls: true, ledgerDir: w.ledgerDir,
    });
    assert.equal(r.deadline, undefined);
    await assert.rejects(fs.stat(victim), '遗留的探针临时目录应已删');
    assert.deepEqual((await fs.readdir(w.ledgerDir)).filter((n) => n.startsWith('doctor-temp-')), []);
  } finally {
    if (saved === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = saved;
  }
});

test('不给 deadline：报告不带 deadline 段（行为不变）', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const r = await runDoctor({ config: w.cfg, projectRoot: w.root, triviumDir: w.triviumDir, only: 'env', skipModelCalls: true });
  assert.equal(r.deadline, undefined);
});

// ── I13 台账主人的 pid 被复用（双平台统一时补：Windows 的 pid 复用快，只看 pid 会让旧台账永远被跳过） ──

test('I13 台账记了启动时刻：pid 还活着但核对为不同进程 ⇒ 判复用、照常补删；同一进程、判不了、旧台账没记启动时刻 ⇒ 不碰', async () => {
  const w = await world();
  // os.tmpdir()：POSIX 读 TMPDIR，Windows 读 TEMP / TMP——三个都钉住，两平台同一格
  const keys = ['TMPDIR', 'TEMP', 'TMP'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) process.env[k] = w.tmp;
  try {
    const owner = process.ppid; // 活着、又不是本进程
    const ledger = path.join(w.ledgerDir, `doctor-temp-${owner}.json`);
    const seed = async (name: string, started: string | undefined): Promise<string> => {
      const d = path.join(w.tmp, name);
      await fs.mkdir(d);
      await fs.writeFile(ledger, JSON.stringify({ pid: owner, ...(started !== undefined ? { started } : {}), dirs: [d] }));
      return d;
    };
    const asked: string[] = [];
    const matcher = (answer: 'same' | 'different' | 'unverifiable') => async (pid: number, started: string) => {
      asked.push(`${pid}:${started}`);
      return answer;
    };

    for (const answer of ['same', 'unverifiable'] as const) {
      const d = await seed(`trivium-probe-${answer.slice(0, 3)}A1b2`, 'Mon Oct 20 07:43:46 2026');
      assert.deepEqual(await sweepDoctorLedgers(w.ledgerDir, { matchStart: matcher(answer) }), []);
      assert.ok((await fs.stat(d)).isDirectory(), `${answer} ⇒ 当台账主人还在，不碰`);
      assert.ok((await fs.stat(ledger)).isFile());
    }

    asked.length = 0;
    const legacy = await seed('trivium-probe-LeG4cy', undefined);
    await sweepDoctorLedgers(w.ledgerDir, { matchStart: matcher('different') });
    assert.ok((await fs.stat(legacy)).isDirectory(), '旧台账没记启动时刻：只看 pid，活着就不碰');
    assert.deepEqual(asked, [], '没有启动时刻就不做身份核对');

    const reused = await seed('trivium-probe-ReU5ed', 'Mon Oct 20 07:43:46 2026');
    assert.deepEqual(await sweepDoctorLedgers(w.ledgerDir, { matchStart: matcher('different') }), []);
    await assert.rejects(fs.stat(reused), 'pid 被复用：台账主人已不在，形态相符的临时目录照常删');
    await assert.rejects(fs.stat(ledger), '台账随之删掉');
    assert.deepEqual(asked, [`${owner}:Mon Oct 20 07:43:46 2026`]);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('I14 本进程的台账带上规范化启动时刻（供下一次 doctor 识别 pid 复用）', async () => {
  const w = await world();
  const { TempDirLedger } = await import('../../src/trivium/doctor-deadline.js');
  const { makeTempDir, tryRemoveTempDir } = await import('../../src/trivium/util/fsx.js');
  const { processStartTime } = await import('../../src/trivium/util/exec.js');
  const keys = ['TMPDIR', 'TEMP', 'TMP'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) process.env[k] = w.tmp; // 建在夹具私有根下，不落系统临时目录
  const l = new TempDirLedger(w.ledgerDir);
  l.install();
  const d = await makeTempDir('trivium-ledgerstart');
  try {
    const file = path.join(w.ledgerDir, `doctor-temp-${process.pid}.json`);
    let parsed: { pid?: number; started?: string | null; dirs?: string[] } = {};
    for (let i = 0; i < 50 && !(parsed.dirs ?? []).includes(d); i++) {
      await sleep(20);
      parsed = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}')) as typeof parsed;
    }
    assert.equal(parsed.pid, process.pid);
    assert.ok((parsed.dirs ?? []).includes(d));
    assert.equal(parsed.started, await processStartTime(process.pid, { canonical: true }), '与身份核对同一形态（规范化启动时刻）');
    // EV-260：台账落盘改走 writeAtomic 后，台账目录里不该再有任何 tmp 中间态残件（旧手写实现的 `.tmp` 残件面）
    assert.deepEqual(
      (await fs.readdir(w.ledgerDir)).filter((n) => n.includes('.tmp')),
      [],
      '台账落盘后无 .tmp 残件',
    );
  } finally {
    await tryRemoveTempDir(d, []);
    await l.finish();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

// ── I8 台账补删（CODEX-03 / GLM-01） ──

test('I8 台账补删：已退出进程的台账里，系统临时目录下、形态相符的目录删掉；不在临时目录下的不删、列进残留；活进程的台账不碰', { skip: WIN_SKIP }, async () => {
  const w = await world();
  const saved = process.env['TMPDIR'];
  process.env['TMPDIR'] = w.tmp;
  try {
    // 夹具里按 makeTempDir 的产物形态起固定名（w.tmp 在 scratchDir 之下，随夹具一起删）
    const victim = path.join(w.tmp, 'trivium-codexhome-Ab12Cd');
    await fs.mkdir(victim);
    await fs.writeFile(path.join(victim, 'auth.json'), '{}');
    const outside = path.join(w.root, 'trivium-notmp-abcdef');
    await fs.mkdir(outside);
    const dead = spawnSync('/usr/bin/true').pid!;
    await fs.writeFile(path.join(w.ledgerDir, `doctor-temp-${dead}.json`), JSON.stringify({ pid: dead, dirs: [victim, outside] }));
    // 活进程（本进程的父进程）的台账：不碰
    const alive = path.join(w.tmp, 'trivium-probe-Zz9Yy8');
    await fs.mkdir(alive);
    await fs.writeFile(path.join(w.ledgerDir, `doctor-temp-${process.ppid}.json`), JSON.stringify({ pid: process.ppid, dirs: [alive] }));

    const residue = await sweepDoctorLedgers(w.ledgerDir);
    await assert.rejects(fs.stat(victim), '形态相符的临时目录应已删');
    assert.ok((await fs.stat(outside)).isDirectory(), '不在系统临时目录下的不删');
    assert.equal(residue.length, 1);
    assert.match(residue[0]!, /不在系统临时目录下/);
    assert.ok((await fs.stat(alive)).isDirectory(), '活进程的台账不碰');
    const left = (await fs.readdir(w.ledgerDir)).sort();
    assert.deepEqual(left, [`doctor-temp-${process.ppid}.json`]);
  } finally {
    if (saved === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = saved;
  }
});
