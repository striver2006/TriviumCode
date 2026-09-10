/**
 * 人工审批与放弃（设计 §7.1 辅助命令 / §8.4 解除方式）。
 *
 * 三种结论——通过 / 拒绝 / 放弃——**均解除业务写锁**。拒绝或放弃时保留全部已有工件
 * （PRD 第 10 章）；拒绝后 Driver 可按开发者意见改写归档内的修订件，
 * 但流水线不得自动进入编码/改码/修复。
 */
import type { Ctx, Stage } from './types.js';
import { setGate, getGate } from './state.js';
import { updateTask, type ApprovalRecord } from './meta.js';
import { resolveTopic } from './topic.js';
import { resetStopBlockCount } from './lock.js';
import { EXIT, TriviumError } from './exit-codes.js';

export interface ApprovalInput {
  ctx: Ctx;
  topic: string;
  stage: Stage;
  decision: 'approved' | 'rejected' | 'abandoned';
  reason?: string | null;
  sessionId?: string | null;
}

export async function recordApproval(i: ApprovalInput): Promise<{ message: string }> {
  const { ctx } = i;
  const gate = await getGate(ctx.triviumDir, i.topic, i.stage);

  if (!gate) {
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `主题「${i.topic}」的 ${i.stage} 阶段没有闸门记录，无需审批。`,
    );
  }
  if (gate.state !== 'awaiting_approval' && i.decision !== 'abandoned') {
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `主题「${i.topic}」的 ${i.stage} 阶段当前状态为 ${gate.state}，不处于等待审批。`,
    );
  }
  if (i.decision === 'rejected' && !i.reason) {
    throw new TriviumError(EXIT.USAGE, '拒绝审批必须给出 --reason');
  }

  const record: ApprovalRecord = {
    at: new Date().toISOString(),
    stage: i.stage,
    run_id: gate.run_id ?? '',
    decision: i.decision,
    reason: i.reason ?? null,
  };

  const ref = await resolveTopic(ctx, i.topic, i.stage);
  await updateTask(ref.layout, (t) => {
    t.approvals.push(record);
    t.gate = { stage: i.stage, state: i.decision, since: record.at, run_id: gate.run_id };
  });

  await setGate({
    triviumDir: ctx.triviumDir,
    topic: i.topic,
    stage: i.stage,
    state: i.decision,
    heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
  });
  // 闸门关闭后阻断计数归零，下一轮重新计
  await resetStopBlockCount(ctx.triviumDir, i.topic, i.stage);

  const verb =
    i.decision === 'approved' ? '已通过' : i.decision === 'rejected' ? '已拒绝' : '已放弃';
  return {
    message:
      `${verb}：主题「${i.topic}」${i.stage} 阶段${i.reason ? `（${i.reason}）` : ''}。\n` +
      `  业务写锁已解除。全部工件保留。\n` +
      (i.decision === 'approved'
        ? '  可以继续下一阶段。'
        : '  流水线不会自动进入编码/改码/修复——如需继续请显式发起。'),
  };
}
