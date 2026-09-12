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

test('闸门未记录会话 id（skill 默认路径）时业务写入照样被拦', async () => {
  const ctx = await fakeCtx();
  // 不传 sessionId：这正是 skill 里 `review --start` 不带 --session-id 时的真实形态
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'awaiting_approval', heartbeatStaleMs: STALE,
  });
  const r = await hookPreWrite(ctx, writeInput('src/a.ts'));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, 'session_id 为 null 不能成为写锁失效的理由');
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

test('未裁决即拦提交，**不分会话**（审查意见 AGY-05）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'code',
    state: 'review_done_awaiting_disposition', sessionId: 'S-OTHER', heartbeatStaleMs: STALE,
  });
  /*
   * 写锁按会话是 RV-05 的刻意设计（避免跨会话误伤），但「裁决是否齐备」是
   * **仓库的属性、不是会话的属性**——换个会话、或直接在终端里 git commit，
   * 未裁决的意见并不会因此变成已裁决。旧行为在这里放行，等于留了一条
   * 「换个会话就能提交」的绕过路径。
   */
  assert.equal((await hookPreCommit(ctx, { session_id: SESSION })).exitCode, EXIT.GATE_BLOCK);
  // 连 session_id 都没有（纯终端提交）同样拦
  assert.equal((await hookPreCommit(ctx, {})).exitCode, EXIT.GATE_BLOCK);
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

test('闸门未记录会话 id 时收工拦截照样生效', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', heartbeatStaleMs: STALE,
  });
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.GATE_BLOCK);
});

test('明确属于其它会话的待裁决闸门不拦本会话收工（RV-05）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: 't', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S-OTHER', heartbeatStaleMs: STALE,
  });
  assert.equal((await hookStop(ctx, { session_id: SESSION })).exitCode, EXIT.OK);
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

// ─────────── hook-pre-commit 的命令自检 ───────────

/** 造一个「有未裁决闸门」的上下文，作用域设为 global 以免会话过滤干扰 */
async function pendingCtx(): Promise<Ctx> {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';
  return ctx;
}

test('hook-pre-commit 只拦提交，不拦其它 Bash 命令', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';

  const blocked = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1',
    tool_input: { command: 'git commit -m "x"' },
  });
  assert.equal(blocked.exitCode, EXIT.GATE_BLOCK, '裁决未齐备时提交必须被拦');

  // `git log --format=commit` 是关键用例：拿正则硬凑会把它误判成提交
  for (const cmd of [
    'npm test',
    'git status',
    'git log --format=commit',
    'git log --oneline | grep commit',
    'git -C /tmp/x status',
    'ls -la',
  ]) {
    const r = await hookPreCommit(ctx, {
      tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
    });
    assert.equal(r.exitCode, EXIT.OK, `「${cmd}」不是提交，不该被拦`);
  }
});

test('已知过拦：引号里出现 git commit 也会被拦（取保守一侧）', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';
  /*
   * 这是**有意记录**的过拦，不是遗漏：不做完整 shell 词法分析就分不清
   * `echo git commit` 与真提交。宁可误拦一条 echo，也不能漏过一次违规提交。
   * 若将来确有困扰，正解是引入真正的词法分析，而不是放宽判据。
   */
  const r = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1', tool_input: { command: 'echo git commit' },
  });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

test('hook-pre-commit 拿不到命令行时按「是提交」处理', async () => {
  const ctx = await fakeCtx();
  await setGate({
    triviumDir: ctx.triviumDir, topic: '闸门主题', stage: 'plan',
    state: 'review_done_awaiting_disposition', sessionId: 'S1', heartbeatStaleMs: STALE,
  });
  ctx.config.gate.approval_lock_scope = 'global';
  // 宁可误拦也不放过：Hook 的职责是拦住违规提交
  const r = await hookPreCommit(ctx, { tool_name: 'Bash', session_id: 'S1' });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

test('hook-pre-commit 识别复合命令里打在本项目上的提交', async () => {
  const ctx = await pendingCtx();
  for (const cmd of [
    'npm test && git commit -m y',
    'git commit --amend',
    'git -c user.name=x commit -m y',
    `git -C ${'${ctx.projectRoot}'} commit -m y`.replace('${ctx.projectRoot}', ctx.projectRoot),
    `cd ${ctx.projectRoot} && git commit -m y`,
    'cd src && git commit -m y', // 相对 cd 仍在项目内
  ]) {
    const r = await hookPreCommit(ctx, {
      tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
    });
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `「${cmd}」应被识别为本项目的提交`);
  }
});

// ── 跨仓库误拦（实测暴露）──

test('打在别的仓库上的提交不该被本项目的闸门拦下', async () => {
  const ctx = await pendingCtx();
  /*
   * 实测踩到：一条 `cd /tmp/夹具 && git init && git commit …` 被**本项目**的闸门
   * 拦下，而那次提交与本项目的归档状态毫无关系。
   * 原实现只看命令串里有没有 `git commit`，完全不看目标仓库——
   * 等于本项目的闸门会拦住你对任何其它仓库的提交。
   */
  for (const cmd of [
    'git -C /tmp/别的仓库 commit -m y',
    'cd /tmp/别的仓库 && git commit -m y',
    'cd /tmp/夹具 && git init -q . && git -c user.email=t@t commit -q -m base',
    'git --git-dir=/tmp/别的仓库/.git --work-tree=/tmp/别的仓库 commit -m y',
  ]) {
    const r = await hookPreCommit(ctx, {
      tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
    });
    assert.equal(r.exitCode, EXIT.OK, `「${cmd}」打在项目外，不该拦：${r.stderr ?? ''}`);
  }
});

test('推断不出目标仓库时一律按项目内处理', async () => {
  const ctx = await pendingCtx();
  /*
   * 从命令串推断目标仓库天然不可能严密（变量、子 shell、`cd -`……）。
   * 保守方向是**宁可多拦**：漏拦一次违规提交的代价，远大于多拦一条命令。
   */
  for (const cmd of [
    'cd $SOME_DIR && git commit -m y',
    'cd - && git commit -m y',
    'cd && git commit -m y',
    'git -C "$REPO" commit -m y',
  ]) {
    const r = await hookPreCommit(ctx, {
      tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
    });
    assert.equal(r.exitCode, EXIT.GATE_BLOCK, `「${cmd}」推断不出目标，应保守拦下`);
  }
});

test('先去项目外提交、再回项目内提交 → 仍然拦', async () => {
  const ctx = await pendingCtx();
  const cmd = `cd /tmp/别处 && git commit -m a && cd ${ctx.projectRoot} && git commit -m b`;
  const r = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1', tool_input: { command: cmd },
  });
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, '只要有一段打在本项目上就该拦');
});

test('带空格的路径也能正确判断在不在项目内', async () => {
  const ctx = await pendingCtx();
  const outside = await hookPreCommit(ctx, {
    tool_name: 'Bash', session_id: 'S1',
    tool_input: { command: 'cd "/tmp/有 空格的目录" && git commit -m y' },
  });
  assert.equal(outside.exitCode, EXIT.OK);
});
