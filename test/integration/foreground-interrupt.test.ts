/**
 * 前台中断结束审查员 CLI（EV-155）。
 *
 * - F 系列在独立子进程里直测 `installForegroundInterruptForwarding`（处理器一旦执行就冻结经 `run()` 的链路、不可撤销，
 *   必须在子进程里跑）：有登记树时 SIGINT / SIGTERM ⇒ 按组结束树、以同一信号退出；没有登记树 ⇒ 立即以同一信号退出。
 * - E1 经真实 bundle 跑同步 `review --stage plan`，两侧 `hang_cli` 桩各以 `killTree` 拉起一个带标记的进程组；
 *   向 CLI 进程组发 SIGINT（终端 Ctrl-C 的形态）⇒ CLI 以 SIGINT 退出、两组都结束。改前两组过继给 init 继续活着。
 * - G1 源码护栏：doctor、preflight 的入口与 review 的 worker 分支之后都装了处理器。
 * 子进程一律 detached（组号 = pid），收尾按组 SIGKILL。F 系列的场景子进程 argv 带 `trivium-ev155-test` 标记；E1 的 CLI 不接受
 * 多余位置参数、不带标记，收尾按它的组号结束；树的标记经环境变量传，不进场景子进程自己的 argv。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { ASSET_ROOT, BUNDLE, REPO_ROOT, bundleMissing, bundleSkipReason, makeFixture } from '../helpers/fixture.js';
import { groupsWithMark, killGroup } from '../helpers/proc.js';
import { encodeStubConfig, STUB_ENV_VAR } from '../../src/trivium/adapters/stub.js';
import { stripNonCode } from '../helpers/strip-non-code.js';

const T = { timeout: 120_000 };
const RP = path.join(REPO_ROOT, 'dist/test/src/trivium/run-protocol.js');
const EX = path.join(REPO_ROOT, 'dist/test/src/trivium/util/exec.js');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function exitOf(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
}

/** 带上限地等；超时返回 null（用例据此判红，不挂死） */
async function within<R>(p: Promise<R>, ms: number): Promise<R | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<null>((r) => { timer = setTimeout(() => r(null), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 轮询直到 `groupsWithMark(mark)` 为空（至多 ms）；返回最后一次看到的组 */
async function untilGroupsGone(mark: string, ms: number): Promise<number[]> {
  const deadline = Date.now() + ms;
  let g = groupsWithMark(mark);
  while (g.length > 0 && Date.now() < deadline) {
    await sleep(100);
    g = groupsWithMark(mark);
  }
  return g;
}

/** 子进程：装处理器；`tree` 模式再以 killTree 拉起一个带标记的 sh + sleep 组；登记就绪后打 READY */
function spawnScenario(mode: 'tree' | 'none', mark: string): { child: ChildProcess; ready: Promise<number[]> } {
  const code = `
const rp = await import(${JSON.stringify(RP)});
const ex = await import(${JSON.stringify(EX)});
rp.installForegroundInterruptForwarding();
if (${JSON.stringify(mode)} === 'tree') ex.run('/bin/sh', ['-c', 'sleep 60; : "$0"', process.env.TRIVIUM_EV155_MARK], { killTree: true, timeoutMs: 90000 });
setInterval(() => {}, 1000);
const tick = () => {
  const g = ex.trackedTrees().map((t) => t.pgid);
  if (${JSON.stringify(mode)} === 'none' || g.length > 0) process.stdout.write('READY ' + JSON.stringify(g) + '\\n');
  else setTimeout(tick, 50);
};
tick();
`;
  // 标记经环境变量交给树，不进场景子进程自己的 argv——否则按标记找组会把场景子进程那一组也数进去
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, 'trivium-ev155-test:scenario'], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TRIVIUM_EV155_MARK: mark },
  });
  const ready = new Promise<number[]>((resolve, reject) => {
    let buf = '';
    child.stdout!.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      const m = /READY (\[.*\])/.exec(buf);
      if (m) resolve(JSON.parse(m[1]!) as number[]);
    });
    child.once('exit', (c, s) => reject(new Error(`场景子进程没就绪就退出了（code=${c} signal=${s}）`)));
  });
  return { child, ready };
}

async function scenario(mode: 'tree' | 'none', sig: NodeJS.Signals, tag: string) {
  const mark = `trivium-ev155-tree-${tag}-${process.pid}`;
  const { child, ready } = spawnScenario(mode, mark);
  const exited = exitOf(child);
  let stderr = '';
  child.stderr!.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
  try {
    const groups = await within(ready, 15_000);
    assert.ok(groups, '场景子进程 15 s 内没报就绪（测试环境问题）');
    if (mode === 'tree') assert.equal(groupsWithMark(mark).length, 1, '前提：带标记的组在跑');
    const t0 = Date.now();
    process.kill(-child.pid!, sig);
    const ex = await within(exited, 15_000);
    return { ex, ms: Date.now() - t0, left: mode === 'tree' ? await untilGroupsGone(mark, 3_000) : [], stderr };
  } finally {
    for (const g of groupsWithMark(mark)) killGroup(g);
    killGroup(child.pid!);
  }
}

test('EV-155 F1：有登记树时收到 SIGINT ⇒ 按组结束树、以 SIGINT 退出，并播报一行', T, async () => {
  const r = await scenario('tree', 'SIGINT', 'f1');
  assert.ok(r.ex, '子进程应在 15 s 内退出');
  assert.equal(r.ex!.signal, 'SIGINT', `应以 SIGINT 退出（退出形态与缺省处置相同）：${JSON.stringify(r.ex)}`);
  assert.deepEqual(r.left, [], '以 killTree 拉起的组应已结束，不被遗弃');
  assert.match(r.stderr, /收到 SIGINT：正在结束本进程拉起的审查员 CLI/);
});

test('EV-155 F2：没有登记树时收到 SIGINT ⇒ 立即以 SIGINT 退出、不播报（等同缺省处置）', T, async () => {
  const r = await scenario('none', 'SIGINT', 'f2');
  assert.ok(r.ex, '子进程应退出');
  assert.equal(r.ex!.signal, 'SIGINT');
  assert.ok(r.ms < 2_000, `应立即退出（${r.ms} ms）`);
  assert.doesNotMatch(r.stderr, /正在结束/);
});

test('EV-155 F3：有登记树时收到 SIGTERM ⇒ 同样结束树、以 SIGTERM 退出', T, async () => {
  const r = await scenario('tree', 'SIGTERM', 'f3');
  assert.ok(r.ex, '子进程应退出');
  assert.equal(r.ex!.signal, 'SIGTERM');
  assert.deepEqual(r.left, []);
});

test('EV-155 E1：同步 review 被 Ctrl-C ⇒ CLI 以 SIGINT 退出，两侧 hang_cli 拉起的组都结束', { ...T, skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: '前台中断' });
  const mark = `trivium-stub-cli:${fx.runRoot}`;
  const child = spawn(process.execPath, [BUNDLE, 'review', '--stage', 'plan', '--topic', '前台中断', '--focus', 'x'], {
    cwd: fx.root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TRIVIUM_ASSET_ROOT: ASSET_ROOT,
      [STUB_ENV_VAR]: encodeStubConfig({ gemini: { mode: 'hang_cli' }, glm: { mode: 'hang_cli' } }),
    },
  });
  const exited = exitOf(child);
  const st = { exited: false };
  void exited.then(() => (st.exited = true));
  let out = '';
  child.stdout!.on('data', (c: Buffer) => (out += c.toString('utf8')));
  child.stderr!.on('data', (c: Buffer) => (out += c.toString('utf8')));
  try {
    const deadline = Date.now() + 60_000;
    while (groupsWithMark(mark).length < 2 && Date.now() < deadline && !st.exited) await sleep(200);
    assert.equal(groupsWithMark(mark).length, 2, `前提：两侧桩各拉起一个组（60 s 内）\n${out}`);
    process.kill(-child.pid!, 'SIGINT');
    const ex = await within(exited, 20_000);
    assert.ok(ex, `CLI 应在 20 s 内退出\n${out}`);
    assert.equal(ex!.signal, 'SIGINT', `应以 SIGINT 退出：${JSON.stringify(ex)}\n${out}`);
    assert.deepEqual(await untilGroupsGone(mark, 5_000), [], `两侧拉起的组都应结束，不被遗弃\n${out}`);
    assert.match(out, /收到 SIGINT：正在结束本进程拉起的审查员 CLI/);
  } finally {
    for (const g of groupsWithMark(mark)) killGroup(g);
    killGroup(child.pid!);
  }
});

test('EV-155 G1（源码护栏）：doctor、preflight 入口与 review 的 worker 分支之后都装了中断转发', async () => {
  const src = stripNonCode(await fs.readFile(path.join(REPO_ROOT, 'src/trivium/cli.ts'), 'utf8'));
  const body = (name: string): string => {
    const at = src.indexOf(`async function ${name}(`);
    assert.ok(at >= 0, `找不到 ${name}`);
    const next = src.indexOf('\nasync function ', at + 1);
    return src.slice(at, next === -1 ? undefined : next);
  };
  for (const name of ['cmdDoctor', 'cmdPreflight']) {
    assert.match(body(name), /installForegroundInterruptForwarding\(\)/, `${name} 应装中断转发`);
  }
  const review = body('cmdReview');
  const install = review.indexOf('installForegroundInterruptForwarding()');
  const worker = review.indexOf('return workerMain(');
  assert.ok(install > worker && worker >= 0, 'cmdReview 应在 worker 分支之后装（worker 有自己的处理器）');
});
