/**
 * 人工审批与放弃（设计 §7.1 辅助命令 / §8.4 解除方式）。
 *
 * 三种结论——通过 / 拒绝 / 放弃——**均解除业务写锁**。拒绝或放弃时保留全部已有工件
 * （PRD 第 10 章）；拒绝后 Driver 可按开发者意见改写归档内的修订件，
 * 但流水线不得自动进入编码/改码/修复。
 */
import type { Ctx, Stage } from './types.js';
import { setGateChecked, getGate, type GateState } from './state.js';
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

/** 放弃可以作用在哪些状态上：除 `running` 之外的全部 */
const ABANDONABLE: readonly GateState[] = [
  'idle', 'review_done_awaiting_disposition', 'awaiting_approval', 'approved', 'rejected', 'abandoned',
];

export async function recordApproval(i: ApprovalInput): Promise<{ message: string }> {
  const { ctx } = i;
  const gate = await getGate(ctx.triviumDir, i.topic, i.stage);

  if (!gate) {
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `主题「${i.topic}」的 ${i.stage} 阶段没有闸门记录，无需审批。`,
    );
  }
  /*
   * 双审进行中不能放弃：审查员正在读真实工作树，此时解除写锁就是制造漂移。
   * 原先 abandon 跳过全部状态校验、又用无条件 setGate，会把并发的 running 覆写成
   * abandoned——正是 state.ts 头注释里列举的绕过形态②③，`gate --check` 与 executeRun
   * 都补了 expect，唯独审批路径没补。
   */
  if (gate.state === 'running') {
    throw new TriviumError(
      EXIT.GATE_BLOCK,
      `主题「${i.topic}」的 ${i.stage} 阶段双审进行中（run ${gate.run_id ?? '未知'}），不能${i.decision === 'abandoned' ? '放弃' : '审批'}。\n` +
        `  请先 \`trivium review --cancel ${gate.run_id ?? '<run_id>'}\`，或等它跑完。`,
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

  /*
   * 先做比较-交换：只有闸门仍是我们读到的那一轮（run_id 相同）且状态允许时才写。
   * 读与写之间若有别的运行接管了槽位（新一轮 --start 把它置成 running），本次审批作废。
   */
  const heartbeatStaleMs = ctx.config.review.heartbeat_stale_s * 1000;
  const g = await setGateChecked({
    triviumDir: ctx.triviumDir,
    topic: i.topic,
    stage: i.stage,
    state: i.decision,
    heartbeatStaleMs,
    expect: {
      state: i.decision === 'abandoned' ? ABANDONABLE : ['awaiting_approval'],
      runId: gate.run_id,
      allowMissing: false,
    },
  });
  if (!g.applied) {
    throw new TriviumError(
      EXIT.GATE_BLOCK,
      `闸门未变更：${g.skipped ?? '状态已被另一次运行接管'}。请重新查看 \`trivium status --topic ${i.topic}\` 后再决定。`,
    );
  }

  const ref = await resolveTopic(ctx, i.topic, i.stage);
  await updateTask(ref.layout, (t) => {
    t.approvals.push(record);
    t.gate = { stage: i.stage, state: i.decision, since: record.at, run_id: gate.run_id };
  }, { triviumDir: ctx.triviumDir, heartbeatStaleMs });
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
