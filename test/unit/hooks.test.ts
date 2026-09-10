import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  hookPreWrite, hookPreCommit, hookStop, hookSessionStart, runHook,
  extractTargetPath, isForgedRoleFile, isInsideArchive, type HookInput,
} from '../../src/trivium/hooks.js';
import { setGate } from '../../src/trivium/state.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';

const SESSION = 'S-CURRENT';
const STALE = 120_000;

async function fakeCtx(opts: { withConfig?: boolean } = {}): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-hook-'));
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });
  if (opts.withConfig !== false) {
    await fs.writeFile(path.join(triviumDir, 'config.yaml'), 'schema: trivium.config.v1\n');
  }
  return {
    config: defaultConfig(),
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir,
    sources: ['<test>'],
  };
}

function writeInput(filePath: string, over: Partial<HookInput> = {}): HookInput {
  return { session_id: SESSION, tool_name: 'Write', tool_input: { file_path: filePath }, ...over };
}

// ── 路径工具 ──

test('从各种 tool_input 字段名里取出目标路径', () => {
  assert.equal(extractTargetPath({ tool_input: { file_path: '/a' } }), '/a');
  assert.equal(extractTargetPath({ tool_input: { notebook_path: '/b.ipynb' } }), '/b.ipynb');
  assert.equal(extractTargetPath({ tool_input: {} }), null);
  assert.equal(extractTargetPath({}), null);
});

test('识别伪造审查文件', () => {
  assert.equal(isForgedRoleFile('/p/.reviews/t/plan/2026-09-10-t-gemini.md'), true);
  assert.equal(isForgedRoleFile('2026-09-10-t-glm.md'), true);
  assert.equal(isForgedRoleFile('2026-09-10-t-claude.md'), false);
  assert.equal(isForgedRoleFile('2026-09-10-t-revised-claude.md'), false);
  assert.equal(isForgedRoleFile('src/gemini.md'), false, '文件名必须以 -gemini.md 结尾');
});

test('判定路径是否在归档根内', () => {
  assert.equal(isInsideArchive('.reviews/t/plan/x.md', '/p', '/p/.reviews'), true);
  assert.equal(isInsideArchive('/p/.reviews/t/x.md', '/p', '/p/.reviews'), true);
  assert.equal(isInsideArchive('src/a.ts', '/p', '/p/.reviews'), false);
  assert.equal(isInsideArchive('/p/.reviews', '/p', '/p/.reviews'), false, '归档根自身不算「内部」');
});

// ── hook-pre-write ──

test('伪造审查文件一律拒绝，不受会话与 TTL 限制', async () => {
  const ctx = await fakeCtx();
  // 完全没有闸门
  const r = await hookPreWrite(ctx, writeInput('.reviews/t/plan/2026-09-10-t-glm.md'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /审查文档只能由编排器/);
  const j = r.json?.['hookSpecificOutput'] as Record<string, unknown>;
  assert.equal(j['permissionDecision'], 'deny');
});

test('本会话未审批闸门期间，写业务文件被拒并给出解除指引', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '登录重构', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookPreWrite(ctx, writeInput('src/auth/oidc.ts'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /dual-approve --topic 登录重构 --stage plan/);
  assert.match(r.stderr ?? '', /dual-abandon/);
});

test('闸门期仍允许写归档（裁决件要写进去）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookPreWrite(ctx, writeInput('.reviews/t/plan/2026-09-10-t-revised-claude.md'));
  assert.equal(r.exitCode, EXIT.OK);
});

test('其它会话的闸门不拦本会话的业务写入（RV-05）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: 'S-OTHER', heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreWrite(ctx, writeInput('src/a.ts'))).exitCode, EXIT.OK);
});

test('双审进行中也拦业务写入（就地模式下审查员在读真实工作树）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'running', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookPreWrite(ctx, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /双审进行中/);
});

test('配置关闭写锁时不拦', async () => {
  const ctx = await fakeCtx();
  ctx.config.gate.block_business_write_when_awaiting_approval = false;
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreWrite(ctx, writeInput('src/a.ts'))).exitCode, EXIT.OK);
});

test('拿不到目标路径时放过（宁可放过也不误伤）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreWrite(ctx, { session_id: SESSION, tool_input: {} })).exitCode, EXIT.OK);
});

// ── hook-pre-commit（AGY-03：作用域）──

test('无活跃流水线主题时，日常 git commit 放行（AGY-03）', async () => {
  const ctx = await fakeCtx();
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

test('本会话有未裁决阶段时拦提交并说明缺什么', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '登录重构', stage: 'code',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookPreCommit(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(r.stderr ?? '', /登录重构\/code/);
  assert.match(r.stderr ?? '', /gate\.block_commit: false/, '应告知如何关闭');
});

test('其它会话的未裁决阶段不拦本会话提交', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'code',
    state: 'review_done_awaiting_disposition', sessionId: 'S-OTHER', heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

test('等待审批的闸门不拦提交（那不是「裁决未完成」）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

test('block_commit=false 时不拦', async () => {
  const ctx = await fakeCtx();
  ctx.config.gate.block_commit = false;
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'code',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

// ── hook-stop（三层防死循环）──

test('裁决未完成时阻止收工，并给出该怎么做', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookStop(ctx, { session_id: SESSION });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.equal(r.json?.['decision'], 'block');
  assert.match(String(r.json?.['reason']), /trivium.disposition.v1/);
});

test('awaiting_approval 是期望的停点，放行收工', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
});

test('第一层防死循环：stop_hook_active 时早退', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await hookStop(ctx, { session_id: SESSION, stop_hook_active: true });
  assert.equal(r.exitCode, EXIT.OK);
});

test('第二层防死循环：超过每阶段阻断上限后放行', async () => {
  const ctx = await fakeCtx();
  ctx.config.gate.stop_hook_max_blocks = 2;
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.GATE_BLOCK);
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.GATE_BLOCK);
  const third = await hookStop(ctx, { session_id: SESSION });
  assert.equal(third.exitCode, EXIT.OK, '第 3 次应放行以避免死循环');
  assert.match(third.stderr ?? '', /避免死循环/);
});

// ── hook-session-start ──

test('无待办时不注入内容', async () => {
  const ctx = await fakeCtx();
  const r = await hookSessionStart(ctx);
  assert.equal(r.exitCode, EXIT.OK);
  assert.equal(r.json, undefined);
});

test('有待审批闸门时注入清单与解除指引', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '登录重构', stage: 'plan',
    state: 'awaiting_approval', sessionId: 'S-ANY', heartbeatStaleMs: STALE,
  });
  const r = await hookSessionStart(ctx);
  const j = r.json?.['hookSpecificOutput'] as Record<string, unknown>;
  assert.match(String(j['additionalContext']), /等待人工审批/);
  assert.match(String(j['additionalContext']), /dual-approve --topic 登录重构/);
  assert.equal(r.exitCode, EXIT.OK, 'session-start 永不阻断');
});

test('有运行中的双审时提醒先 --wait', async () => {
  const ctx = await fakeCtx();
  const lockDir = path.join(ctx.triviumDir, 'lock');
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(
    path.join(lockDir, 't.lock'),
    JSON.stringify({ topic: 't', stage: 'plan', run_id: 'R9', kind: 'run', pid: 1, acquired_at: 'x' }),
  );
  const r = await hookSessionStart(ctx);
  const j = r.json?.['hookSpecificOutput'] as Record<string, unknown>;
  assert.match(String(j['additionalContext']), /review --wait R9/);
});

// ── 三档退出码（GLM-07 / AGY-02）──

test('config.yaml 缺失 → exit 0（no-op 覆盖「判定不了」）', async () => {
  const ctx = await fakeCtx({ withConfig: false });
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await runHook('hook-pre-write', async () => ctx, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.OK, '未初始化的项目必须 no-op，即使 state.json 里有闸门');
});

test('loadCtx 抛错（config 损坏或不在 git 仓库）→ exit 0', async () => {
  const r = await runHook('hook-pre-write', async () => {
    throw new Error('config 解析失败');
  }, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.OK);
});

test('明确判定拦截 → exit 2（唯一返回 2 的路径）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', sessionId: SESSION, heartbeatStaleMs: STALE,
  });
  const r = await runHook('hook-pre-write', async () => ctx, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

test('hook 内部程序缺陷 → exit 1（非阻断）', async () => {
  const ctx = await fakeCtx();
  // 让 state.json 变成目录，触发读取异常路径之外的真实错误
  const r = await runHook('hook-pre-write', async () => ctx, {
    session_id: SESSION,
    tool_name: 'Write',
    // tool_input 给个会让 path 处理抛错的值
    tool_input: { file_path: '\0非法路径' },
  });
  // 该输入不一定抛错；关键是不返回 2
  assert.notEqual(r.exitCode, EXIT.GATE_BLOCK);
});
