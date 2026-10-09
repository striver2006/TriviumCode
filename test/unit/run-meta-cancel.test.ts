import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  finalizeCancelledRunMeta, newRunMeta, readTask, registerRun, writeRunMeta, type TaskLock,
} from '../../src/trivium/meta.js';
import { metaDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import type { RunMeta } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

/**
 * EV-128：`review --cancel` 的归档侧收尾（计划 r2 §3.2 / §4.1 R1～R7）。
 *
 * 直测 `finalizeCancelledRunMeta`：四个前提、partial 终态、task.json 登记独立判定、自身不抛。
 * 经 `cancelRun` 的接线与顺序由 `test/integration/run-protocol.test.ts` 的 E1 / E3 / E6 守。
 */

const TOPIC = '取消收尾';
const RUN = '20260926T000000Z';

async function setup(): Promise<{ layout: ArchiveLayout; lock: TaskLock; runJson: string; taskJson: string }> {
  const root = await fs.realpath(await scratchDir('trivium-cancel-'));
  const layout: ArchiveLayout = { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
  const lock: TaskLock = { triviumDir: path.join(root, '.trivium'), heartbeatStaleMs: 120_000 };
  return {
    layout, lock,
    runJson: path.join(metaDir(layout, 'plan'), `run-${RUN}.json`),
    taskJson: path.join(layout.archiveRoot, TOPIC, 'task.json'),
  };
}

function skeleton(): RunMeta {
  const m = newRunMeta({
    runId: RUN, topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'test', promptHint: '焦点', taskGoal: null,
    criticsSelected: ['gemini', 'glm'], treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S',
    denyPaths: [], driftPolicy: 'warn',
  });
  // 骨架期已登记的工件：回写后必须原样
  m.artifacts = [{ path: `${TOPIC}/plan/_meta/brief-glm-${RUN}.md`, sha256: 'a'.repeat(64) }];
  return m;
}

/** 摆骨架 run.json；register 为真时同时登记进 task.json（与 prepareRun 同序） */
async function seed(
  env: Awaited<ReturnType<typeof setup>>,
  over: (m: RunMeta) => void = () => {},
  register = true,
): Promise<RunMeta> {
  const m = skeleton();
  over(m);
  await writeRunMeta(env.layout, 'plan', m);
  if (register) await registerRun(env.layout, m, env.lock);
  return m;
}

const call = (env: Awaited<ReturnType<typeof setup>>, workerGone = true) =>
  finalizeCancelledRunMeta({ layout: env.layout, stage: 'plan', runId: RUN, lock: env.lock, workerGone });

test('R1：v3 骨架 ⇒ 两步都写，取消标记 partial；其余逐键不变且过当前契约校验', async () => {
  const env = await setup();
  const before = await seed(env);
  const r = await call(env);
  assert.deepEqual(r, { runMeta: { kind: 'written' }, task: { kind: 'written' } });

  const after = JSON.parse(await fs.readFile(env.runJson, 'utf8')) as RunMeta;
  assert.deepEqual(validateRunMeta(after), []);
  assert.equal(after.status, 'cancelled');
  assert.equal(after.gate.state, 'cancelled');
  assert.equal(after.review_mode, 'partial');
  assert.match(after.degraded_reason!, /运行被取消/);
  assert.ok(after.finished_at && !Number.isNaN(Date.parse(after.finished_at)));
  // 其余键一个不动（含 artifacts：提交锚对 HEAD 为 running 的版本只查 run_id 与已登记条目）
  const strip = (m: RunMeta) => ({ ...m, status: null, finished_at: null, review_mode: null, degraded_reason: null, gate: { ...m.gate, state: null } });
  assert.deepEqual(strip(after), strip(before));
  assert.deepEqual(after.artifacts, before.artifacts);
});

test('R2：run.json 已是终态（success）⇒ 不追溯改写，文件逐字节不变；task.json 也不改', async () => {
  const env = await setup();
  await seed(env, (m) => { m.status = 'success'; });
  const runBefore = await fs.readFile(env.runJson, 'utf8');
  const taskBefore = await fs.readFile(env.taskJson, 'utf8');
  const r = await call(env);
  assert.equal(r.runMeta.kind, 'skipped');
  assert.match(r.runMeta.kind === 'skipped' ? r.runMeta.why : '', /已是终态（success）/);
  assert.equal(r.task.kind, 'skipped');
  assert.equal(await fs.readFile(env.runJson, 'utf8'), runBefore);
  assert.equal(await fs.readFile(env.taskJson, 'utf8'), taskBefore);
});

test('R3：v1 形状的 running ⇒ 不写（写回会把历史文件改成 v2），文件逐字节不变', async () => {
  const env = await setup();
  await fs.mkdir(path.dirname(env.runJson), { recursive: true });
  const v1 = { ...skeleton(), schema: 'trivium.run.v1', review_mode: 'dual' } as Record<string, unknown>;
  delete v1['driver'];
  delete v1['critics_selected'];
  const text = JSON.stringify(v1, null, 2) + '\n';
  await fs.writeFile(env.runJson, text, 'utf8');
  const r = await call(env);
  assert.equal(r.runMeta.kind, 'skipped');
  assert.match(r.runMeta.kind === 'skipped' ? r.runMeta.why : '', /只收尾 run\.v2 \/ run\.v3/);
  assert.equal(await fs.readFile(env.runJson, 'utf8'), text);
});

test('R4：run.json 不存在 / 不可解析 / 不合契约 ⇒ 跳过、不抛', async () => {
  const env = await setup();
  const missing = await call(env);
  assert.equal(missing.runMeta.kind, 'skipped');
  assert.match(missing.runMeta.kind === 'skipped' ? missing.runMeta.why : '', /没有 run-/);

  await fs.mkdir(path.dirname(env.runJson), { recursive: true });
  await fs.writeFile(env.runJson, '{ 坏掉的', 'utf8');
  const broken = await call(env);
  assert.match(broken.runMeta.kind === 'skipped' ? broken.runMeta.why : '', /不可解析/);

  await fs.writeFile(env.runJson, JSON.stringify({ schema: 'trivium.run.v2', status: 'running' }), 'utf8');
  const invalid = await call(env);
  assert.match(invalid.runMeta.kind === 'skipped' ? invalid.runMeta.why : '', /不合所声明的 run\.v2 \/ run\.v3 契约/);
  assert.equal(await fs.readFile(env.runJson, 'utf8'), JSON.stringify({ schema: 'trivium.run.v2', status: 'running' }));
});

test('R5a：task.json 命中 ⇒ 只改这一条的 status，其它条目与其它键不变', async () => {
  const env = await setup();
  // 另一轮运行的登记：不得被碰
  const other = skeleton();
  other.run_id = '20260925T000000Z';
  other.status = 'success';
  await registerRun(env.layout, other, env.lock);
  await seed(env);
  const before = await readTask(env.layout);

  const r = await call(env);
  assert.equal(r.task.kind, 'written');
  const after = await readTask(env.layout);
  assert.equal(after.runs.length, before.runs.length);
  for (const [i, e] of after.runs.entries()) {
    const b = before.runs[i]!;
    if (e.run_id === RUN) assert.deepEqual({ ...e, status: b.status }, b);
    else assert.deepEqual(e, b);
  }
  assert.equal(after.runs.find((e) => e.run_id === RUN)?.status, 'cancelled');
  assert.equal(after.runs.find((e) => e.run_id === other.run_id)?.status, 'success');
});

test('R5b：task.json 没有这轮的登记 ⇒ 不新建条目、task.json 不写盘', async () => {
  const env = await setup();
  const other = skeleton();
  other.run_id = '20260925T000000Z';
  await registerRun(env.layout, other, env.lock);
  await seed(env, () => {}, false); // prepareRun 写完 run.json、登记之前被打断的形态
  const taskBefore = await fs.readFile(env.taskJson, 'utf8');

  const r = await call(env);
  assert.equal(r.runMeta.kind, 'written');
  assert.equal(r.task.kind, 'skipped');
  assert.match(r.task.kind === 'skipped' ? r.task.why : '', /无此运行的登记/);
  assert.equal(await fs.readFile(env.taskJson, 'utf8'), taskBefore);
});

test('R5c：run.json 已是 cancelled、登记仍 running（上一次在两次写之间被打断）⇒ 第一步跳过、第二步补齐', async () => {
  const env = await setup();
  const m = await seed(env);
  m.status = 'cancelled';
  m.finished_at = new Date().toISOString();
  m.gate.state = 'cancelled';
  await writeRunMeta(env.layout, 'plan', m); // 只改 run.json，登记仍是 running
  assert.equal((await readTask(env.layout)).runs[0]?.status, 'running');

  const r = await call(env);
  assert.equal(r.runMeta.kind, 'skipped');
  assert.equal(r.task.kind, 'written');
  assert.equal((await readTask(env.layout)).runs[0]?.status, 'cancelled');
});

test('R6：工作进程未确认退出 ⇒ 不写 run.json（可能还有写者），原因写明「未确认」', async () => {
  const env = await setup();
  await seed(env);
  const runBefore = await fs.readFile(env.runJson, 'utf8');
  const r = await call(env, false);
  assert.equal(r.runMeta.kind, 'skipped');
  assert.match(r.runMeta.kind === 'skipped' ? r.runMeta.why : '', /未确认退出/);
  assert.equal(await fs.readFile(env.runJson, 'utf8'), runBefore);
  assert.equal(r.task.kind, 'skipped', 'run.json 没变成 cancelled，登记也不能先改');
});

test('R7：写失败（_meta 目录只读）⇒ 函数不抛，第一步转成带异常首行的 skipped', { skip: process.getuid?.() === 0 && 'root 下只读目录拦不住写入' }, async () => {
  const env = await setup();
  await seed(env);
  const dir = path.dirname(env.runJson);
  await fs.chmod(dir, 0o555);
  try {
    const r = await call(env);
    assert.equal(r.runMeta.kind, 'skipped');
    assert.ok(r.runMeta.kind === 'skipped' && r.runMeta.error === true, JSON.stringify(r.runMeta));
    assert.match(r.runMeta.kind === 'skipped' ? r.runMeta.why : '', /回写 run\.json 出错：/);
    assert.equal((JSON.parse(await fs.readFile(env.runJson, 'utf8')) as RunMeta).status, 'running');
  } finally {
    await fs.chmod(dir, 0o755);
  }
});
