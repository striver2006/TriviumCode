/**
 * 人工审批与放弃（设计 §7.1 辅助命令 / §8.4 解除方式）。
 *
 * 三种结论——通过 / 拒绝 / 放弃——**均解除业务写锁**。拒绝或放弃时保留全部已有工件
 * （PRD 第 10 章）；拒绝后 Driver 可按开发者意见改写归档内的修订件，
 * 但流水线不得自动进入编码/改码/修复。
 */
import crypto from 'node:crypto';
import type { Ctx, Stage } from './types.js';
import { setGateChecked, getGate, type GateState } from './state.js';
import { updateTask, type ApprovalRecord } from './meta.js';
import { resolveTopic } from './topic.js';
import { resetStopBlockCount } from './lock.js';
import { EXIT, TriviumError } from './exit-codes.js';

// ─────────────────────── 审批确认码（审查意见 GLM-01）───────────────────────

/**
 * 易读字符集：去掉 0/O/1/I/L 这些手抄时会认错的字符。
 * 31^8 ≈ 39 bit，对「防止顺手自批」这个用途足够，也短到能一眼抄完。
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * 生成一次性审批确认码。
 *
 * ## 它挡的是什么
 *
 * `trivium approve` 是普通 CLI 子命令，`recordApproval` 不校验调用来源；而
 * `/dual-review-*` 的 allowed-tools 预批准了 `Bash(.trivium/bin/trivium:*)`。
 * 也就是说**人工审批闸门可以由 Driver 自己一条命令关掉，不需要用户任何确认**，
 * 而 CLAUDE.md 里「想继续请让用户走 /dual-approve」只是提示词约束。
 * 会话比对救不了这件事：人工审批与自批发生在同一个会话里。
 *
 * 有了码，审批至少要跨越「把停点话术里的码显式抄进命令」这一步——
 * 从「顺手就做了」变成一次留在命令行与审批记录里的、可审计的明确动作。
 *
 * ## 它挡不住什么（别把它当密码学边界）
 *
 * 码的明文出现在 `--await-approval` 的 stdout 里，而在 Claude Code 这类宿主中
 * **stdout 正是经由 Driver 转述给用户的**——Driver 读得到它。所以这是
 * 审计与意图护栏，不是权限边界：它让自批变成有痕迹的越界，而不是让自批不可能。
 * 真正的边界需要宿主提供一条不经过模型的带外通道（TTY、审批 UI），本项目没有。
 * 这一点在 RUNBOOK 与 CLAUDE.md 里如实写明，不要在文档里把它说成更强的东西。
 */
export function generateApprovalCode(): string {
  const pick = (n: number): string =>
    Array.from({ length: n }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  return `TRV-${pick(4)}-${pick(4)}`;
}

/** 比对时忽略大小写与连字符：用户手抄不该因为少打一个 `-` 就失败 */
const normalizeCode = (code: string): string => code.trim().toUpperCase().replace(/-/g, '');

export function hashApprovalCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');
}

export function approvalCodeMatches(input: string, hash: string): boolean {
  const a = Buffer.from(hashApprovalCode(input), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export interface ApprovalInput {
  ctx: Ctx;
  topic: string;
  stage: Stage;
  decision: 'approved' | 'rejected' | 'abandoned';
  reason?: string | null;
  /**
   * 发起审批的会话 id（审查意见 GLM-05）。
   *
   * 原先这个字段从 CLI 就没传进来过、`recordApproval` 也从不使用，
   * `ApprovalRecord` 里更没有落点——整套锁都押在 session 身份上，
   * 唯独「谁解的闸」这一最关键的事件不留痕。现在它会进审批记录供事后审计。
   */
  sessionId?: string | null;
  /** 审批确认码明文。只有 `approved` 需要 */
  code?: string | null;
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

  /*
   * ── 确认码：只有「通过」要（审查意见 GLM-01）──
   *
   * 拒绝与放弃不要码，是因为它们的风险方向相反：那是收紧，不是放行。
   * 给收紧动作也加门槛，只会让人在想喊停的时候喊不停。
   */
  if (i.decision === 'approved') {
    if (!gate.approval_code_hash) {
      throw new TriviumError(
        EXIT.GATE_BLOCK,
        `主题「${i.topic}」的 ${i.stage} 阶段还没有发出审批确认码，不能通过。\n` +
          `  请先运行：trivium gate --stage ${i.stage} --topic ${i.topic} --await-approval\n` +
          '  它会打印本次停点的确认码，审批时用 --code 带上。',
      );
    }
    if (!i.code) {
      throw new TriviumError(
        EXIT.USAGE,
        '通过审批必须带 --code <确认码>。\n' +
          '  码在停点话术里（`gate --await-approval` 的输出）。\n' +
          '  这一步是刻意的：审批是解除护栏的动作，不该顺手就完成。',
      );
    }
    if (!approvalCodeMatches(i.code, gate.approval_code_hash)) {
      throw new TriviumError(
        EXIT.GATE_BLOCK,
        `确认码不匹配，审批未生效。\n` +
          `  码只对本次停点有效；若闸门重新进入过其它状态，请重新运行\n` +
          `  trivium gate --stage ${i.stage} --topic ${i.topic} --await-approval 取码。`,
      );
    }
  }

  const record: ApprovalRecord = {
    at: new Date().toISOString(),
    stage: i.stage,
    run_id: gate.run_id ?? '',
    decision: i.decision,
    reason: i.reason ?? null,
    session_id: i.sessionId ?? null,
    code_verified: i.decision === 'approved',
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
