import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { recordApproval, humanDecidedThisRound } from '../../src/trivium/approval.js';
import { setGate, getGate } from '../../src/trivium/state.js';
import { readTask } from '../../src/trivium/meta.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';

const TOPIC = '审批';
const STALE = 120_000;
/** 审批正本的文件名（`meta.ts` 的 `taskPath` 落点） */
const TASK_FILE = 'task.json';

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

/*
 * ── 校验命令不得撤销人的审批（EV-29）──
 *
 * `gate --check` 校验通过后按运行记录的 entry 推进闸门状态，而推进用的
 * `expect` 只比 runId、不看当前状态。于是「审批后按裁决补修复 → 改动涉及裁决件
 * → 顺手复校一次完整性」这条极常见的路径，会把已放行的闸门重新关上。
 * 2026-09-16 实测撞上一次，撞上后连提交都做不了（Hook 按本机状态文件判写锁）。
 *
 * `humanDecidedThisRound` 是那三处入口（`--check` 的两个迁移分支、`--await-approval`）
 * 共用的前置判据。下面钉住它的五条语义。
 */

test('EV-29：三个人工终态都算「本轮已表态」，不只是 approved', async () => {
  for (const decision of ['approved', 'rejected', 'abandoned'] as const) {
    const ctx = await fakeCtx();
    const layout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
    await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
    await recordApproval({
      ctx, topic: TOPIC, stage: 'plan', decision,
      ...(decision === 'approved' ? {} : { reason: '理由' }),
    });
    assert.equal(
      await humanDecidedThisRound(layout, 'plan', 'R1'),
      true,
      `${decision} 也是人工表态——只挡 approved 的话，同一缺陷换个终态原样重现`,
    );
  }
});

test('EV-29：只认本轮本阶段——别轮次/别阶段的表态不算', async () => {
  const ctx = await fakeCtx();
  const layout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved' });

  assert.equal(await humanDecidedThisRound(layout, 'plan', 'R1'), true);
  assert.equal(await humanDecidedThisRound(layout, 'plan', 'R2'), false, '另一轮没表过态');
  assert.equal(await humanDecidedThisRound(layout, 'code', 'R1'), false, '另一阶段没表过态');
});

test('EV-29：空 run_id 不当通配', async () => {
  const ctx = await fakeCtx();
  const layout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  // 闸门没有 run_id 时审批记录里写的就是空串，不能让它匹配上任何一轮
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: null, heartbeatStaleMs: STALE });
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved' });
  const t = await readTask({ archiveRoot: ctx.archiveRoot, topic: TOPIC });
  assert.equal(t.approvals[0]?.run_id, '', '前提：这种情形确实写空串');

  assert.equal(await humanDecidedThisRound(layout, 'plan', ''), false, '空串不是一轮，不能算表过态');
});

test('EV-29：没有审批记录时返回 false（新主题正常走停点）', async () => {
  const ctx = await fakeCtx();
  const layout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  assert.equal(await humanDecidedThisRound(layout, 'plan', 'R1'), false);
});

test('EV-29：正本损坏时 fail-closed —— 不推进，而不是当成没表过态', async () => {
  const ctx = await fakeCtx();
  const layout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved' });

  /*
   * 把审批正本写坏。走宽松读会把「锚被搅坏」当成「没有审批记录」→ 判定可以推进
   * → 已审批的闸门照旧被打回——**恰是本条要修的缺陷，换个触发条件重现**。
   * 所以这里必须返回 true（视为已表态、不动闸门）。
   */
  await fs.writeFile(path.join(ctx.archiveRoot, TOPIC, TASK_FILE), '{ 这不是合法 JSON', 'utf8');

  assert.equal(
    await humanDecidedThisRound(layout, 'plan', 'R1'),
    true,
    '读不出正本时必须保守——宁可不推进，也不能凭「读不到」去撤销人的审批',
  );
});
