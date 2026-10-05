import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { newRunId } from '../../src/trivium/meta.js';
import { EXIT } from '../../src/trivium/exit-codes.js';

/**
 * run_id 同秒避让（EV-147）经真实 CLI：同步 `review --stage plan` 分配 run_id 时，要避开本主题里已被占用的 id。
 *
 * run_id 只到秒、生成时刻不可预知，所以照 `gate-loop` 的 `precreateRunDirs` 的办法，把「从现在起 60 秒」每一秒的
 * id 都在 **bug 阶段** `_meta/` 里占上（哨兵内容）。改前 `newRunId()` 不看占用：plan 的新运行必落在窗口里，
 * 与 bug 阶段那份同名、在 task.json 的同一键空间里撞名；改后应抬到窗口之后。60 秒远大于满载下从占位到分配的耗时。
 */

const TOPIC = 'run_id避让';
const WINDOW_S = 60;

test('EV-147 I1：同步 review 避开本主题已占用的 run_id（别的阶段的 _meta 同名也算），占位文件逐字节不动', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const bugMeta = path.join(fx.archiveRoot, TOPIC, 'bug', '_meta');
  await fs.mkdir(bugMeta, { recursive: true });
  const taken = new Set<string>();
  const t0 = Date.now();
  for (let i = 0; i < WINDOW_S; i++) {
    const id = newRunId(new Date(t0 + i * 1000));
    taken.add(id);
    await fs.writeFile(path.join(bugMeta, `run-${id}.json`), `{"sentinel":"${id}"}\n`);
  }

  const stub = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };
  const r = await cli(fx.root, ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'], stub, 180_000);
  assert.equal(r.code, EXIT.OK, `应成功：\n${r.stdout}${r.stderr}`);

  const planIds = (await fs.readdir(path.join(fx.archiveRoot, TOPIC, 'plan', '_meta')))
    .map((f) => /^run-(.+)\.json$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined);
  assert.equal(planIds.length, 1, `plan 阶段应恰有一份 run.json：${planIds.join(', ')}`);
  const id = planIds[0]!;
  assert.ok(!taken.has(id), `新运行的 run_id ${id} 落进了已占用的窗口（同秒撞名没有避开）`);
  assert.match(id, /^\d{8}T\d{6}Z$/, '格式不变');
  assert.ok(id > [...taken].sort().at(-1)!, `应抬到窗口之后：${id}`);

  for (const t of taken) {
    assert.equal(await fs.readFile(path.join(bugMeta, `run-${t}.json`), 'utf8'), `{"sentinel":"${t}"}\n`, `占位 ${t} 不得被改`);
  }
  const task = JSON.parse(await fs.readFile(path.join(fx.archiveRoot, TOPIC, 'task.json'), 'utf8')) as { runs: { run_id: string; stage: string }[] };
  assert.deepEqual(task.runs.filter((x) => x.run_id === id).map((x) => x.stage), ['plan'], 'task.json 里这个 run_id 只登记了 plan 一条');
});
