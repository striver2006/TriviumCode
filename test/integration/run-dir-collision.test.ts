import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, today } from '../helpers/fixture.js';
import { newRunId } from '../../src/trivium/meta.js';
import { repoId } from '../../src/trivium/review.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';

/**
 * 运行目录跨主题同秒避让（EV-218）经真实 CLI。
 *
 * 运行目录是 `<运行根>/<repoId>/<runId>`，按仓库分、不按主题分；改前两个主题同一秒起跑会分到同一个 run_id、共用一个
 * 运行目录，后到的那一轮被静默吞掉（复现读数 `doc/05_testing/evidence/run-dir-collision-20261006/repro-1.json`）。
 * 改后 `allocateRunId` 对运行目录做排他 mkdir、撞了抬一秒；落盘段之前失败由 `prepareRun` 外层删掉这个还空着的目录。
 * 本文件不设 `TRIVIUM_TEST_ADOPT_PRECREATED_RUN_DIR`（那个开关只给 gate-loop 的故障注入用例）。
 */

const A = 'EV218甲';
const B = 'EV218乙';
const STUB = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };
const WINDOW_S = 60;

const startArgs = (topic: string) => ['review', '--start', '--stage', 'plan', '--topic', topic, '--focus', 'x', '--json'];
const runIdOf = (stdout: string): string => (JSON.parse(extractJsonCandidate(stdout)!.json) as { run_id: string }).run_id;

/** 等到运行到终态（桩很快），返回 `--wait` 的退出码与输出 */
async function waitTerminal(root: string, runId: string): Promise<{ code: number | null; out: string }> {
  let code: number | null = EXIT.STILL_RUNNING;
  let out = '';
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000);
    code = w.code;
    out = w.stdout + w.stderr;
  }
  return { code, out };
}

async function waitDone(root: string, runId: string): Promise<void> {
  const { code, out } = await waitTerminal(root, runId);
  assert.equal(code, EXIT.OK, `运行 ${runId} 没有正常结束：\n${out}`);
}

async function addPlanDraft(archiveRoot: string, topic: string): Promise<void> {
  const d = path.join(archiveRoot, topic, 'plan');
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, `${today()}-${topic}-claude.md`), '# 待审计划\n\n## 一、目标\n\n验证编排器行为。\n', 'utf8');
}

const archiveStatus = async (archiveRoot: string, topic: string, runId: string): Promise<string> =>
  (JSON.parse(await fs.readFile(path.join(archiveRoot, topic, 'plan', '_meta', `run-${runId}.json`), 'utf8')) as { status: string }).status;

test('EV-218 I1：别的运行占着「从现在起 60 秒」的运行目录 ⇒ --start 落到窗口之外、用自己新建的目录，占着的目录一个不动', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: A });
  const bucket = path.join(fx.runRoot, repoId(fx.root));
  const taken = new Set<string>();
  const t0 = Date.now();
  for (let i = 0; i < WINDOW_S; i++) {
    const id = newRunId(new Date(t0 + i * 1000));
    taken.add(id);
    await fs.mkdir(path.join(bucket, id), { recursive: true });
  }
  const r = await cli(fx.root, startArgs(A), STUB);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const id = runIdOf(r.stdout);
  assert.ok(!taken.has(id), `run_id ${id} 落在别人占着的窗口里`);
  await waitDone(fx.root, id);
  assert.ok((await fs.readdir(path.join(bucket, id))).includes('status.json'), '本轮写进了自己的运行目录');
  for (const t of taken) assert.deepEqual(await fs.readdir(path.join(bucket, t)), [], `别人占着的 ${t} 被写进了东西`);
  assert.equal(await archiveStatus(fx.archiveRoot, A, id), 'success');
});

test('EV-218 I2：同一仓库两个主题对齐到一秒开头并发 --start ⇒ run_id 不同、各用各的运行目录，两轮都 success（EV-221 起）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: A });
  await addPlanDraft(fx.archiveRoot, B);
  const ms = Date.now() % 1000;
  await new Promise((res) => setTimeout(res, ((1000 - ms) % 1000) + 20));
  const [ra, rb] = await Promise.all([cli(fx.root, startArgs(A), STUB), cli(fx.root, startArgs(B), STUB)]);
  assert.equal(ra.code, EXIT.OK, `${ra.stdout}${ra.stderr}`);
  assert.equal(rb.code, EXIT.OK, `${rb.stdout}${rb.stderr}`);
  const idA = runIdOf(ra.stdout);
  const idB = runIdOf(rb.stdout);
  assert.notEqual(idA, idB, '两个主题分到了同一个 run_id——会共用一个运行目录、后到的那一轮被吞掉');
  /*
   * 两轮都要 success（EV-221 起）：此前一侧工作进程算工作树哈希的 `git add` 可能撞上另一侧正往归档根或 `.trivium/`
   * 原子写的临时文件而整轮判失败，这一格曾放宽为「都收尾即可」；EV-221 让工作树哈希排除这两处、`add` 遇文件中途消失时重试，
   * 收回到 success。不是 success 时断言文案带上运行目录 status.json 的原文，便于分辨是不是又撞上了。
   */
  for (const id of [idA, idB]) await waitTerminal(fx.root, id);
  const bucket = path.join(fx.runRoot, repoId(fx.root));
  for (const [id, topic] of [[idA, A], [idB, B]] as const) {
    const request = JSON.parse(await fs.readFile(path.join(bucket, id, 'request.json'), 'utf8')) as { topic: string };
    assert.equal(request.topic, topic, `运行目录 ${id} 的交接文件属于 ${request.topic}，不是 ${topic}`);
    const status = await archiveStatus(fx.archiveRoot, topic, id);
    const message = status === 'success' ? '' : await fs.readFile(path.join(bucket, id, 'status.json'), 'utf8').catch((e: Error) => e.message);
    assert.equal(status, 'success', `${topic} 那一轮没有 success：${message}`);
  }
});

test('EV-218 I3：分配 run_id 之后、落盘之前失败（被审原稿缺失，退 65）⇒ 运行根里不留下本次占的空目录', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: A, draft: false });
  const r = await cli(fx.root, startArgs(A), STUB);
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `${r.stdout}${r.stderr}`);
  const bucket = path.join(fx.runRoot, repoId(fx.root));
  const left = await fs.readdir(bucket).catch(() => [] as string[]);
  assert.deepEqual(left, [], `运行根里留下了：${left.join(', ')}`);
});
