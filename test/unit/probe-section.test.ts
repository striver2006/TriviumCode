/**
 * EV-251：doctor 探针段作用域（预检失败自动校准计划 r2 D3 第 1～4 条；第三节 U1a / U1b / U1c / U5）。
 *
 * 真实进程一律带本次随机标记，`finally` 按组号兜底结束（`test/helpers/proc.ts`）。
 * 「中止派生」按令牌（一次 doctor 一枚），不是进程级全局位，所以 U1c 可以在本测试进程里跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  abortProbeSections, countLiveGroupMembers, groupSnapshotFrom, newProbeAbortToken, newProbeSection, run, terminateProbeSectionGroups, withProbeSection,
} from '../../src/trivium/util/exec.js';
import { killMarked } from '../helpers/proc.js';
import { skipOnWin } from '../helpers/platform.js';

const WIN_SKIP = skipOnWin('POSIX 进程组语义：/bin/sh 的 trap TERM、/bin/ps、shebang 假 CLI；Windows 侧按父链树杀，纯函数快照见 win-section-snapshot.test.ts（双平台统一时补）');

const MARK = `trivium-u-psec-${process.pid}-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GRACE = { graceMs: 300, killWaitMs: 1000 };

function liveMembers(pgid: number): number {
  const r = spawnSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' });
  return countLiveGroupMembers(r.stdout, pgid);
}

async function until(f: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (f()) return true;
    await sleep(50);
  }
  return f();
}

function cleanup(tag: string): void {
  killMarked(`${MARK}-${tag}`);
}

test('U1a 组长服从 SIGTERM、后代忽略：按非僵尸成员数升级 SIGKILL，最终组内无成员（计划三审 CODEX-01）', { skip: WIN_SKIP }, async () => {
  const scope = newProbeSection('u1a');
  try {
    // 组长 sh 前台等 sleep；子 shell 忽略 TERM 并拉起 sleep（被忽略的信号跨 exec 保持忽略）
    const body = `(trap "" TERM; sleep 600; : "${MARK}-u1a") & sleep 600; : "${MARK}-u1a"`;
    const pending = withProbeSection(scope, () => run('/bin/sh', ['-c', body]));
    assert.ok(await until(() => scope.groups.length === 1 && liveMembers(scope.groups[0]!.pgid) >= 3, 5000), '组没起来');
    const pgid = scope.groups[0]!.pgid;
    const t = await terminateProbeSectionGroups([scope], GRACE);
    assert.deepEqual(t.groups, [pgid]);
    assert.deepEqual(t.signals[pgid], ['SIGTERM', 'SIGKILL'], '组长退了而后代还在，必须升级');
    assert.deepEqual(t.remaining, []);
    assert.equal(liveMembers(pgid), 0);
    const r = await pending;
    assert.equal(r.spawned, true, '被杀的调用照常兑现（不冻结），探针得以走到 finally');
  } finally {
    cleanup('u1a');
  }
});

test('U1b 组长在到点前已自然退出、后代仍在：到点时照样按组结束后代', { skip: WIN_SKIP }, async () => {
  const scope = newProbeSection('u1b');
  try {
    const body = `(trap "" TERM; sleep 600; : "${MARK}-u1b") & exit 0`;
    const pending = withProbeSection(scope, () => run('/bin/sh', ['-c', body]));
    assert.ok(await until(() => scope.groups.length === 1 && scope.groups[0]!.child.exitCode !== null, 5000), '组长没退出');
    const pgid = scope.groups[0]!.pgid;
    assert.ok(liveMembers(pgid) >= 1, '后代应还在组里');
    const t = await terminateProbeSectionGroups([scope], GRACE);
    assert.deepEqual(t.groups, [pgid], '组长已退出但成员数大于 0，仍在结束之列');
    assert.deepEqual(t.signals[pgid], ['SIGTERM', 'SIGKILL']);
    assert.equal(liveMembers(pgid), 0);
    await pending;
  } finally {
    cleanup('u1b');
  }
});

test('U1b′ 组内已无成员的组不发信号（组号可能已被复用）', { skip: WIN_SKIP }, async () => {
  const scope = newProbeSection('u1b2');
  await withProbeSection(scope, () => run('/bin/sh', ['-c', `: "${MARK}-u1b2"`]));
  const sent: number[] = [];
  const t = await terminateProbeSectionGroups([scope], { ...GRACE, signal: (p) => (sent.push(p), true) });
  assert.deepEqual(t.groups, []);
  assert.deepEqual(sent, []);
});

test('U1d 组长已退出、而进程表里有 pid 等于组号的活进程：判组号已被复用，不发信号，列进 reused（代码三审 CODEX-01）', { skip: WIN_SKIP }, async () => {
  const scope = newProbeSection('u1d');
  await withProbeSection(scope, () => run('/bin/sh', ['-c', `: "${MARK}-u1d"`]));
  const pgid = scope.groups[0]!.pgid;
  const sent: number[] = [];
  const t = await terminateProbeSectionGroups([scope], {
    ...GRACE,
    // 旧组已清空、同号新组出现：组号下有成员，且有 pid 等于组号的进程（新组的组长）
    snapshot: async () => ({ members: 2, leaderPresent: true }),
    signal: (p) => (sent.push(p), true),
  });
  assert.deepEqual(sent, [], '复用的组号不得发信号');
  assert.deepEqual(t.groups, []);
  assert.deepEqual(t.reused, [pgid]);
  // 组号下只有本组后代（没有 pid 等于组号的进程）：照样在结束之列
  const sent2: number[] = [];
  const t2 = await terminateProbeSectionGroups([scope], {
    ...GRACE, killWaitMs: 0,
    snapshot: async () => ({ members: 1, leaderPresent: false }),
    signal: (p) => (sent2.push(p), true),
  });
  assert.deepEqual(t2.groups, [pgid]);
  assert.ok(sent2.length > 0);
});

test('U1e 快照解析：只数非僵尸成员，组号下有没有 pid 等于组号的进程分开记', () => {
  const ps = ['  100   100 S', '  101   100 S', '  102   100 Z', '  200   100 S', '  300   300 Ss'].join('\n');
  assert.deepEqual(groupSnapshotFrom(ps, 100), { members: 3, leaderPresent: true });
  const noLeader = ['  101   100 S', '  102   100 Z'].join('\n');
  assert.deepEqual(groupSnapshotFrom(noLeader, 100), { members: 1, leaderPresent: false });
});

test('U5 段作用域内不带 killTree 的 run() 也自成一组、进段级记录并计数（计划三审 CODEX-02）', { skip: WIN_SKIP }, async () => {
  const scope = newProbeSection('u5');
  const r = await withProbeSection(scope, () => run('/bin/sh', ['-c', 'ps -o pgid= -p $$']));
  assert.equal(scope.launches, 1);
  assert.equal(scope.groups.length, 1);
  assert.equal(Number(r.stdout.trim()), scope.groups[0]!.pgid, '子进程是自己那一组的组长');
  // 作用域外照旧：不进任何段
  const outside = newProbeSection('u5-out');
  await run('/bin/sh', ['-c', 'true']);
  assert.equal(outside.launches, 0);
});

test('U1c 中止派生之后：同一令牌下的段内 run() 立即兑现合成结果、不派生；段外与别的令牌照常', { skip: WIN_SKIP }, async () => {
  const token = newProbeAbortToken();
  const s = newProbeSection('x', token);
  abortProbeSections(token);
  const a = await withProbeSection(s, () => run('/bin/sh', ['-c', 'echo inside']));
  assert.equal(a.spawned, false);
  assert.equal(a.aborted, true);
  assert.equal(a.code, null);
  assert.equal(a.stdout, '');
  assert.equal(s.launches, 0, '中止之后不计派生');
  assert.equal(s.groups.length, 0);
  const b = await run('/bin/sh', ['-c', 'echo outside']);
  assert.equal(b.stdout.trim(), 'outside', '段外的 run() 不受中止影响（结束进程组时的成员计数靠它）');
  // 令牌按次 doctor 分开：前一次到点不连累后一次（同一进程先后跑几次 doctor 时）
  const other = newProbeSection('y');
  const c = await withProbeSection(other, () => run('/bin/sh', ['-c', 'echo again']));
  assert.equal(c.stdout.trim(), 'again');
  assert.equal(other.launches, 1);
});
