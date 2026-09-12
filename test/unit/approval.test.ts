import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { recordApproval } from '../../src/trivium/approval.js';
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
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  const out = await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', sessionId: 'S-HUMAN' });
  assert.match(out.message, /已通过/);
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'approved');
  const task = await readTask({ archiveRoot: ctx.archiveRoot, topic: TOPIC });
  assert.equal(task.approvals.length, 1);
  assert.equal(task.approvals[0]?.run_id, 'R1');
  // GLM-05：谁在什么时候解的闸要留痕——审批不校验来源，事后对账是仅剩的手段
  assert.equal(task.approvals[0]?.session_id, 'S-HUMAN');
});

test('GLM-05：没传会话 id 时留痕为 null，而不是假装知道', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved' });
  const task = await readTask({ archiveRoot: ctx.archiveRoot, topic: TOPIC });
  assert.equal(task.approvals[0]?.session_id, null);
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
