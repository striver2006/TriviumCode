import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { run } from '../../src/trivium/util/exec.js';

/**
 * 工作树哈希排除归档根与 `.trivium/`（EV-221）经真实 CLI 的接线。
 *
 * 夹具在建仓时把全部文件提交，之后一轮审查里只有编排器在写归档（送审包、run.json、task.json）与 `.trivium/`
 * （状态、锁）。送审冻结与跑后复算都传 `diffExcludePrefixes` 的结果，所以两棵 tree 都应等于 HEAD 的 tree；
 * 改前两者都把这些写入收了进去（夹具没有 `.gitignore`），一个都不等。
 * 两主题并发撞上原子临时文件的那一格由 `run-dir-collision.test.ts` 的 I2 守（两轮都要 success）。
 */

const TOPIC = 'EV221接线';
const STUB = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };

test('EV-221 W1：一轮审查收尾后，run.json 的 snapshot.tree_hash 与 after_tree_hash 都等于 HEAD 的 tree，drift 未变', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const head = await run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: fx.root, timeoutMs: 30_000 });
  assert.equal(head.code, 0, head.stderr);
  const headTree = head.stdout.trim();

  const r = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--json'], STUB);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const runId = (JSON.parse(extractJsonCandidate(r.stdout)!.json) as { run_id: string }).run_id;
  let code: number | null = EXIT.STILL_RUNNING;
  let out = '';
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    const w = await cli(fx.root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000);
    code = w.code;
    out = w.stdout + w.stderr;
  }
  assert.equal(code, EXIT.OK, out);

  const meta = JSON.parse(await fs.readFile(path.join(fx.stageDir, '_meta', `run-${runId}.json`), 'utf8')) as {
    status: string;
    snapshot: { tree_hash: string; after_tree_hash?: string; drift: { changed: boolean } };
  };
  assert.equal(meta.status, 'success');
  assert.equal(meta.snapshot.tree_hash, headTree, '送审快照把编排器在归档根 / .trivium 下的写入收进了 tree');
  assert.equal(meta.snapshot.after_tree_hash, headTree, '跑后复算把编排器在归档根 / .trivium 下的写入收进了 tree');
  assert.equal(meta.snapshot.drift.changed, false);
});
