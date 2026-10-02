/**
 * EV-188：run.v2 逐侧 `verification_degraded` 新增的可选属性 `evidence_untrusted` 的契约（计划 r2 §2.6）。
 *
 * 契约变异（`doc/05_testing/evidence/mcp-exec-detect-20261002/contract-mutations.mjs`）改的是构建拷进
 * `dist/test/skills/dual-critic/schema/` 的那份 schema，咬点就是这几条。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRunMeta } from '../../src/trivium/meta.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import { CRITICS, type RunMeta } from '../../src/trivium/types.js';

function metaWith(glm: Record<string, unknown>): RunMeta {
  const m = newRunMeta({
    runId: 'R1', topic: 'MCP检测', stage: 'plan', rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: CRITICS,
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
  });
  (m.guard as Record<string, unknown>)['verification_degraded'] = {
    glm: { readonly: 'ok', path: 'ok', evidence_threshold: 3, ...glm },
  };
  return m;
}

const OK = { cause: 'mcp-call', tools: ['mcp__zread__read_file'] };

test('S1 带 evidence_untrusted 的 run.json 合法；不带也合法（常态与旧留痕）', () => {
  assert.deepEqual(validateRunMeta(metaWith({ evidence_untrusted: OK })), []);
  assert.deepEqual(validateRunMeta(metaWith({})), []);
});

test('S2 tools 为空数组不合法：证据不可信必须点名', () => {
  assert.ok(validateRunMeta(metaWith({ evidence_untrusted: { cause: 'mcp-call', tools: [] } })).length > 0);
});

test('S3 cause 只认 mcp-call、tools 必填', () => {
  assert.ok(validateRunMeta(metaWith({ evidence_untrusted: { cause: 'subagent', tools: ['x'] } })).length > 0);
  assert.ok(validateRunMeta(metaWith({ evidence_untrusted: { cause: 'mcp-call' } })).length > 0);
});

test('S4 evidence_untrusted 里不许多余字段；逐侧对象仍不许未知键', () => {
  assert.ok(validateRunMeta(metaWith({ evidence_untrusted: { ...OK, note: 'x' } })).length > 0);
  assert.ok(validateRunMeta(metaWith({ evidence_untrusted_x: OK })).length > 0);
});
