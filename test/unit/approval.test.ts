import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { recordApproval, generateApprovalCode, hashApprovalCode } from '../../src/trivium/approval.js';
import { setGate, getGate } from '../../src/trivium/state.js';
import { readTask } from '../../src/trivium/meta.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';

const TOPIC = '审批';
const STALE = 120_000;

async function fakeCtx(): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-approval-'));
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });
  return { config: defaultConfig(), projectRoot: root, archiveRoot: path.join(root, '.reviews'), triviumDir, sources: ['<test>'] };
}

test('等待审批的闸门可以通过，记录进 task.json 并解除写锁', async () => {
  const ctx = await fakeCtx();
  const code = generateApprovalCode();
  await setGate({
    triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval',
    runId: 'R1', approvalCodeHash: hashApprovalCode(code), heartbeatStaleMs: STALE,
  });
  const out = await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', code, sessionId: 'S-HUMAN' });
  assert.match(out.message, /已通过/);
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'approved');
  const task = await readTask({ archiveRoot: ctx.archiveRoot, topic: TOPIC });
  assert.equal(task.approvals.length, 1);
  assert.equal(task.approvals[0]?.run_id, 'R1');
  // GLM-05：谁解的闸要留痕
  assert.equal(task.approvals[0]?.session_id, 'S-HUMAN');
  assert.equal(task.approvals[0]?.code_verified, true);
  // 码是一次性的：闸门离开 awaiting_approval 后即作废
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.approval_code_hash, null);
});

// ── 审批确认码（审查意见 GLM-01）──

test('GLM-01：通过审批必须带正确的确认码，缺码或错码都不放行', async () => {
  const ctx = await fakeCtx();
  const code = generateApprovalCode();
  const arm = async () => {
    await setGate({
      triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval',
      runId: 'R1', approvalCodeHash: hashApprovalCode(code), heartbeatStaleMs: STALE,
    });
  };

  await arm();
  await assert.rejects(
    recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved' }),
    (e: { code?: number }) => e.code === EXIT.USAGE,
    '缺 --code 应退 64',
  );
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'awaiting_approval', '闸门不得被改动');

  await assert.rejects(
    recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', code: 'TRV-XXXX-XXXX' }),
    (e: { code?: number }) => e.code === EXIT.GATE_BLOCK,
    '错码应被拒',
  );
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'awaiting_approval');

  // 大小写与连字符差异不该成为障碍（用户是手抄的）
  const out = await recordApproval({
    ctx, topic: TOPIC, stage: 'plan', decision: 'approved',
    code: code.toLowerCase().replace(/-/g, ''),
  });
  assert.match(out.message, /已通过/);
});

test('GLM-01：还没发过码的闸门不能通过，提示先取码', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  await assert.rejects(
    recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', code: 'TRV-AAAA-BBBB' }),
    (e: { code?: number; message?: string }) => e.code === EXIT.GATE_BLOCK && /--await-approval/.test(e.message ?? ''),
  );
});

test('GLM-01：拒绝与放弃不需要码——它们是收紧，不是放行', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  const r = await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'rejected', reason: '方案不对' });
  assert.match(r.message, /已拒绝/);

  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'code', state: 'awaiting_approval', runId: 'R2', heartbeatStaleMs: STALE });
  const a = await recordApproval({ ctx, topic: TOPIC, stage: 'code', decision: 'abandoned' });
  assert.match(a.message, /已放弃/);
});

test('GLM-01：确认码不落明文，state.json 里只有 sha256', async () => {
  const ctx = await fakeCtx();
  const code = generateApprovalCode();
  await setGate({
    triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval',
    runId: 'R1', approvalCodeHash: hashApprovalCode(code), heartbeatStaleMs: STALE,
  });
  const raw = await fs.readFile(path.join(ctx.triviumDir, 'state.json'), 'utf8');
  assert.ok(!raw.includes(code), 'state.json 不得出现码明文');
  assert.ok(raw.includes(hashApprovalCode(code)), 'state.json 应记录 sha256');
});

test('拒绝必须给理由', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  await assert.rejects(
    recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'rejected' }),
    (e: { code?: number }) => e.code === EXIT.USAGE,
  );
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'awaiting_approval', '闸门不得被改动');
});

/*
 * 双审进行中不能放弃：原先 abandon 跳过全部状态校验、又用无条件 setGate，
 * 把并发的 running 覆写成 abandoned——审查员正在读真实工作树，写锁却被解除了。
 */
test('running 的闸门不能放弃，也不能审批；提示先 --cancel', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'code', state: 'running', runId: 'R2', heartbeatStaleMs: STALE });
  for (const decision of ['abandoned', 'approved'] as const) {
    await assert.rejects(
      recordApproval({ ctx, topic: TOPIC, stage: 'code', decision }),
      (e: { code?: number; message: string }) => {
        assert.equal(e.code, EXIT.GATE_BLOCK);
        assert.match(e.message, /--cancel R2/);
        return true;
      },
    );
  }
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'code'))?.state, 'running', '闸门必须原样保留');
});

test('放弃走比较-交换：只动我们读到的那一轮', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'review_done_awaiting_disposition', runId: 'R1', heartbeatStaleMs: STALE });
  const out = await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'abandoned', reason: '换焦点重来' });
  assert.match(out.message, /已放弃/);
  const g = await getGate(ctx.triviumDir, TOPIC, 'plan');
  assert.equal(g?.state, 'abandoned');
  assert.equal(g?.run_id, 'R1');
});
