import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { recordApproval, humanDecidedThisRound, humanDecision } from '../../src/trivium/approval.js';
import { setGate, getGate } from '../../src/trivium/state.js';
import { readTask } from '../../src/trivium/meta.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const TOPIC = '审批';
const STALE = 120_000;
/** 审批正本的文件名（`meta.ts` 的 `taskPath` 落点） */
const TASK_FILE = 'task.json';

async function fakeCtx(): Promise<Ctx> {
  const root = await scratchDir('trivium-approval-');
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });
  return { config: defaultConfig(), projectRoot: root, archiveRoot: path.join(root, '.reviews'), triviumDir, sources: ['<test>'] };
}

test('等待审批的闸门可以通过，记录进 task.json 并解除写锁', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  const out = await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', sessionId: 'S-HUMAN', verifiedRunId: 'R1' });
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
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', verifiedRunId: 'R1' });
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
      ...(decision === 'approved' ? { verifiedRunId: 'R1' } : { reason: '理由' }),
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
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', verifiedRunId: 'R1' });

  assert.equal(await humanDecidedThisRound(layout, 'plan', 'R1'), true);
  assert.equal(await humanDecidedThisRound(layout, 'plan', 'R2'), false, '另一轮没表过态');
  assert.equal(await humanDecidedThisRound(layout, 'code', 'R1'), false, '另一阶段没表过态');
});

test('EV-29：空 run_id 不当通配', async () => {
  const ctx = await fakeCtx();
  const layout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  /*
   * 闸门没有 run_id 时审批记录里写的就是空串，不能让它匹配上任何一轮。
   * 用 rejected 造这条记录：M10a 第 3 步起 approved 在闸门 run_id 为 null 时恒被拒
   * （`verifiedRunId` 绑定），而本条测的是 `humanDecidedThisRound`，与决定种类无关。
   */
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: null, heartbeatStaleMs: STALE });
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'rejected', reason: '造一条空 run_id 的记录' });
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
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', verifiedRunId: 'R1' });

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

test('代码双审 r3 GLM-03：humanDecision 把「读不出」与「确已表态」分开报', async () => {
  const ctx = await fakeCtx();
  const layout = { archiveRoot: ctx.archiveRoot, topic: TOPIC };
  assert.equal(await humanDecision(layout, 'plan', 'R1'), 'undecided', '没有正本');
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', verifiedRunId: 'R1' });
  assert.equal(await humanDecision(layout, 'plan', 'R1'), 'decided');
  assert.equal(await humanDecision(layout, 'plan', 'R2'), 'undecided');
  assert.equal(await humanDecision(layout, 'plan', ''), 'undecided', '空串不当通配');

  await fs.writeFile(path.join(ctx.archiveRoot, TOPIC, TASK_FILE), '{ 这不是合法 JSON', 'utf8');
  assert.equal(await humanDecision(layout, 'plan', 'R1'), 'unreadable');
  assert.equal(await humanDecision(layout, 'plan', 'R2'), 'unreadable', '读不出时与哪一轮无关');
});

/*
 * ── 核过的就是批的（M10a 第 3 步，计划 r3 §3.3）──
 *
 * `cmdApproval` 先复核、再调 `recordApproval`，后者自己再读一次闸门。两次读之间闸门若被
 * 另一轮接管成 awaiting_approval，状态检查拦不住——只有 run_id 比对能拦。
 * 本组也是变异 M5（删掉绑定）的鉴别用例：直接调 `recordApproval`，不经 CLI、不经复核。
 */
test('verifiedRunId：approved 时与闸门 run_id 不一致 ⇒ 拒绝，闸门与正本都不动', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R2', heartbeatStaleMs: STALE });
  await assert.rejects(
    recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', verifiedRunId: 'R1' }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.GATE_BLOCK);
      assert.match(e.message, /R2/);
      assert.match(e.message, /R1/);
      return true;
    },
  );
  assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'awaiting_approval');
  const task = await readTask({ archiveRoot: ctx.archiveRoot, topic: TOPIC });
  assert.equal(task.approvals.length, 0, '核的不是这一轮，就不能留下「已通过」的记录');
});

test('verifiedRunId：approved 时没传（或为空）⇒ 拒绝——不给「没传就不比」的口子', async () => {
  for (const runId of ['R1', null] as const) {
    const ctx = await fakeCtx();
    await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId, heartbeatStaleMs: STALE });
    for (const verifiedRunId of [undefined, null, ''] as const) {
      await assert.rejects(
        recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision: 'approved', verifiedRunId }),
        (e: { code?: number }) => e.code === EXIT.GATE_BLOCK,
        `闸门 run_id=${runId}、verifiedRunId=${JSON.stringify(verifiedRunId)} 不得放行` +
          '（闸门为 null 且未传时 null === null 正是那个口子）',
      );
    }
    assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'awaiting_approval');
  }
});

test('verifiedRunId 只约束 approved：rejected / abandoned 不需要它', async () => {
  for (const decision of ['rejected', 'abandoned'] as const) {
    const ctx = await fakeCtx();
    await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
    await recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision, reason: '理由' });
    assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, decision);
  }
});
