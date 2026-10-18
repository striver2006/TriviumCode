import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { repoId } from '../../src/trivium/review.js';
import { RUN_DIR_FILES } from '../../src/trivium/run-files.js';
import type { RunMeta } from '../../src/trivium/types.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

/*
 * EV-236 A2（M12 批次 5；计划 r2 §4 I1）：交接文件里冻结补丁只存一份，worker 按引用还原后照常跑完。
 * 只数快照结构里的正文份数（计划双审 CODEX-02：任务书节选在 400 行内就是全文，`brief_text` 本来各有一份，不在去重范围）。
 */

const TOPIC = '交接去重';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

test('交接文件：各侧快照不带补丁正文、frozen_diff 恰一份且等于归档补丁；brief 与归档逐字相同；worker 照常收尾', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC, draft: false });
  const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 4242;\n', 'utf8');

  const started = await cli(fx.root, ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', '看变更', '--json'], STUB);
  assert.equal(started.code, EXIT.OK, `--start 失败：\n${started.stdout}\n${started.stderr}`);
  const cand = extractJsonCandidate(started.stdout);
  assert.ok(cand);
  const runId = (JSON.parse(cand.json) as { run_id: string }).run_id;

  // 先读交接文件：收尾的清扫会就地改写它（脱敏），在它之前取原样
  const handoff = JSON.parse(await fs.readFile(path.join(fx.runRoot, repoId(fx.root), runId, RUN_DIR_FILES.request), 'utf8')) as {
    snapshots: Record<string, { diffText: string | null; subjectSha256: string }>;
    frozen_diff?: { sha256: string; text: string };
    requests: Record<string, { brief_text: string; brief_path: string }>;
  };

  let exitCode: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && exitCode === EXIT.STILL_RUNNING; i++) {
    exitCode = (await cli(fx.root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000)).code ?? EXIT.FAIL;
  }
  assert.equal(exitCode, EXIT.OK, '双审应成功（worker 读回新格式交接文件）');
  const meta = JSON.parse(await fs.readFile(path.join(codeDir, '_meta', `run-${runId}.json`), 'utf8')) as RunMeta;
  assert.equal(meta.status, 'success');

  const diff = await fs.readFile(path.join(codeDir, '_meta', `changes-${runId}.diff`), 'utf8');
  assert.ok(handoff.frozen_diff, '新格式要带 frozen_diff');
  assert.equal(handoff.frozen_diff.text, diff, '那一份就是送审的补丁原文');
  assert.equal(handoff.frozen_diff.sha256, meta.snapshot.subject_sha256);
  const sides = Object.keys(handoff.snapshots);
  assert.equal(sides.length, 2);
  for (const c of sides) {
    assert.equal(handoff.snapshots[c]!.diffText, null, `${c} 侧快照不该再带一份正文`);
    assert.equal(handoff.snapshots[c]!.subjectSha256, meta.snapshot.subject_sha256);
    const onDisk = await fs.readFile(handoff.requests[c]!.brief_path, 'utf8');
    assert.equal(handoff.requests[c]!.brief_text, onDisk, `${c} 侧交给审核者的任务书与归档逐字相同`);
  }
});
