import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { defaultConfig, loadCtx } from '../../src/trivium/config.js';
import { validateConfig, validateRunMeta, validateDispositionFrontMatter } from '../../src/trivium/schemas.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { EXIT } from '../../src/trivium/exit-codes.js';

/*
 * 配置原先完全不校验（审核 M12）：写错字段名只会静默落到默认值，写错枚举值
 * 会把闸门悄悄关掉。这里的每条用例都是一种「静默 fail-open」的形状。
 */

async function projectWith(configYaml: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-cfg-'));
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(root, '.trivium/config.yaml'), configYaml, 'utf8');
  return root;
}

test('内置默认配置本身合法', () => {
  assert.deepEqual(validateConfig(defaultConfig()), []);
});

test('gate: "off" 用标量顶掉整个对象 → 退 69 并点名', async () => {
  const root = await projectWith('schema: trivium.config.v1\ngate: "off"\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.ENV);
    assert.match(e.message, /配置不合法/);
    assert.match(e.message, /gate/);
    return true;
  });
});

test('拼错枚举值（approval_lock_scope: sesion）→ 报错列出可选值，而不是反向按 global 加锁', async () => {
  const root = await projectWith('schema: trivium.config.v1\ngate:\n  approval_lock_scope: sesion\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), (e: { message: string }) => {
    assert.match(e.message, /approval_lock_scope/);
    assert.match(e.message, /session/);
    return true;
  });
});

test('stop_hook_max_blocks: 0 会让收工拦截一次都不生效 → 拒绝', async () => {
  const root = await projectWith('schema: trivium.config.v1\ngate:\n  stop_hook_max_blocks: 0\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), /stop_hook_max_blocks/);
});

test('未知顶层字段（gates: 拼错）→ 报「未知字段」，不再静默忽略', async () => {
  const root = await projectWith('schema: trivium.config.v1\ngates:\n  block_commit: false\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), /未知字段「gates」/);
});

test('heartbeat_stale_s 写成字符串 → 拒绝（否则 NaN 让陈旧锁永不回收）', async () => {
  const root = await projectWith('schema: trivium.config.v1\nreview:\n  heartbeat_stale_s: "120"\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), /heartbeat_stale_s/);
});

test('archive_root 逃出项目根 → 拒绝', async () => {
  const root = await projectWith('schema: trivium.config.v1\narchive_root: ../../tmp\n');
  await assert.rejects(loadCtx({ cwd: root, allowUninitialized: true }), /archive_root/);
});

test('合法的覆盖（本项目自己的 config.yaml 形状）照常通过', async () => {
  const root = await projectWith([
    'schema: trivium.config.v1',
    'review:',
    '  timeout_s:',
    '    plan: 1500',
    '    code: 2700',
    '    bug: 1200',
    'profiles:',
    '  hotfix:',
    '    gemini: { plan: a, code: b, bug: c }',
    'verify:',
    '  build: [npm run build]',
    '  test: []',
    '',
  ].join('\n'));
  const ctx = await loadCtx({ cwd: root, allowUninitialized: true });
  assert.equal(ctx.config.review.timeout_s.code, 2700);
});

// ── run.v1 与 disposition.v1 从此真的被加载（审核 M13）──

test('newRunMeta 产出的骨架符合 trivium.run.v1', () => {
  const meta = newRunMeta({
    runId: 'R1', topic: 't', stage: 'plan', rerunIndex: 1, command: 'x', promptHint: null, taskGoal: null,
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
  });
  assert.deepEqual(validateRunMeta(meta), []);
  assert.ok(validateRunMeta({ ...meta, status: 'weird' }).length > 0);
});

test('裁决件 front-matter 按 disposition.v1 校验', () => {
  assert.deepEqual(validateDispositionFrontMatter({
    schema: 'trivium.disposition.v1', topic: 't', stage: 'plan', role: 'claude', kind: 'revised', run_id: 'R1', addresses: ['a'],
  }), []);
  const bad = validateDispositionFrontMatter({ schema: 'trivium.disposition.v1', topic: 't', stage: 'plan', role: 'gemini', kind: 'revised', run_id: 'R1', addresses: [] });
  assert.ok(bad.some((m) => m.includes('role')), JSON.stringify(bad));
  assert.ok(bad.some((m) => m.includes('addresses')), JSON.stringify(bad));
});
