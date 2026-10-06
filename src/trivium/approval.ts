/**
 * 人工审批与放弃（设计 §7.1 辅助命令 / §8.4 解除方式）。
 *
 * 三种结论——通过 / 拒绝 / 放弃——**均解除业务写锁**。拒绝或放弃时保留全部已有工件
 * （PRD 第 10 章）；拒绝后 Driver 可按开发者意见改写归档内的修订件，
 * 但流水线不得自动进入编码/改码/修复。
 */
import type { Ctx, Stage } from './types.js';
import { setGateChecked, getGate, type GateState } from './state.js';
import { updateTask, readTaskStrict, type ApprovalRecord } from './meta.js';
import type { ArchiveLayout } from './archive.js';
import { resolveTopic } from './topic.js';
import { resetStopBlockCount } from './lock.js';
import { EXIT, TriviumError } from './exit-codes.js';
import { shellQuoteArg } from './naming.js';

/**
 * ## 审批这道关的信任边界（审查意见 GLM-01，如实记录）
 *
 * `trivium approve` 是普通 CLI 子命令，本函数**不校验调用来源**；而
 * `/dual-review-*` 的 allowed-tools 预批准了 `Bash(.trivium/bin/trivium:*)`。
 * 也就是说人工审批闸门可以由 Driver 自己一条命令关掉，不需要用户任何确认，
 * 而 CLAUDE.md 里「想继续请让用户走 /dual-approve」只是提示词约束。
 * 按会话区分也没用：人工审批与自批发生在同一个会话里。
 *
 * 曾经加过一枚一次性确认码（`--await-approval` 发码、approve 必须 `--code`），
 * 后来**移除了**：码的明文经 stdout 由 Driver 转述给用户，Driver 读得到它，
 * 因此它构不成权限边界，只会让人以为这道关是机械保证的——
 * 虚假的安全感比没有护栏更糟。
 *
 * 现在这里诚实地只做两件事：**不假装有机械边界**，以及把「谁在什么时候解的闸」
 * 写进 `task.json.approvals` 供事后对账。真正的边界需要宿主提供一条
 * 不经过模型的带外通道（TTY、审批 UI），本项目没有。
 */
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
  /**
   * 调用方**已复核过**的 run_id（M10a 第 3 步，计划 r3 §3.3）。
   *
   * `decision === 'approved'` 时必须与闸门当前的 run_id 一致，未传视同不一致。
   *
   * ## 为什么要它
   *
   * 复核（`gate.verifyRoundForApproval`）在 `cmdApproval` 里做，本函数随后**自己再读一次闸门**
   * 并按那次读到的 run_id 做比较-交换。两次读之间别的运行若把同一阶段置成
   * awaiting_approval，下面的状态检查拦不住（那是它认可的合法状态）——
   * 于是会批到一个没核过的轮次。这个字段把「核过的」钉进本函数的比较。
   *
   * ## 它不保证什么
   *
   * **只证明调用方给出的 run_id 与闸门一致，不证明复核真的跑过**——调用方完全可以
   * 不复核就把 `gate.run_id` 原样传进来。复核有没有跑，靠 `cmdApproval` 的代码结构
   * 与变异验证守着（M10a 第 3 步测试报告 M1），不靠这个字段。
   */
  verifiedRunId?: string | null;
}

/** 放弃可以作用在哪些状态上：除 `running` 之外的全部 */
const ABANDONABLE: readonly GateState[] = [
  'idle', 'review_done_awaiting_disposition', 'awaiting_approval', 'approved', 'rejected', 'abandoned',
];

/**
 * 人工审批的**终态**：这三种都表示「这一轮，人已经表过态了」。
 *
 * 只列 `approved` 是不够的——`setGateChecked` 的 `expect` 只比 `runId`，
 * 对同一轮已 `rejected` / `abandoned` 的闸门照样会推进，
 * 于是「校验命令撤销人的表态」这个缺陷换个终态原样重现。
 */
const HUMAN_DECIDED: readonly GateState[] = ['approved', 'rejected', 'abandoned'];

/**
 * 本轮是否已经过人工表态——**以 `task.json.approvals[]` 为正本**。
 *
 * ## 为什么需要它
 *
 * `gate --check` 是**校验**命令，它没有资格撤销人的审批。而现状是：校验通过后
 * 按 `run.json.entry` 无条件推进闸门状态（B/C/D 推等待审批、A 推 idle），
 * 两处都只带 `expect: { runId }`、不看当前状态。于是「审批后按裁决补修复、
 * 改动涉及裁决件、顺手复校一次完整性」这条极常见的路径，会把已放行的闸门重新关上。
 * 2026-09-16 实测撞上一次，撞上后连提交都做不了（Hook 按本机状态文件判写锁）。
 *
 * ## 为什么认 `task.json` 而不是本机状态文件
 *
 * 审批记录（`approvals[]`，含时间、决定与会话来源）只在这里，它是进 Git 的审计正本；
 * 本机状态文件是运行时写锁载体、不进 Git。两份曾经分叉成互相矛盾的答案
 * （正本记 `approved`、本机记 `awaiting_approval`），而校验命令只写了后者。
 * 认正本即可判断，**不必让校验命令去写第二份状态**——那会引入跨文件写序与
 * 半途失败的新问题（两者分属不同锁域，没有原子写）。
 *
 * ## fail-closed
 *
 * 正本**读不出来**时返回 true（视为已表态、不推进）。`readTaskStrict` 特意把
 * `missing` 与 `unreadable` 分开，就是为了这里：走宽松读会把「锚被搅坏」当成
 * 「没有审批记录」，于是已审批的闸门照旧被打回——**恰是本函数要修的缺陷，
 * 换个触发条件重现**。`missing` 则是真的没有记录（新主题），返回 false。
 */
export async function humanDecidedThisRound(
  layout: ArchiveLayout,
  stage: Stage,
  runId: string,
): Promise<boolean> {
  // 空 run_id 不能当通配：`recordApproval` 在 gate.run_id 为 null 时写的就是空串
  if (!runId) return false;

  const { task, state } = await readTaskStrict(layout);
  if (state === 'unreadable') return true; // fail-closed，理由见上
  if (state === 'missing') return false;

  return (task.approvals ?? []).some(
    (a) =>
      a.stage === stage &&
      a.run_id === runId &&
      HUMAN_DECIDED.includes(a.decision as GateState),
  );
}

/**
 * 闸门是否处于可表态的状态——`recordApproval` 的前置校验，抽出来与 `cmdApproval` 共用。
 *
 * `cmdApproval` 在 approved 路径上**复核之前**先调它：running 的闸门若先去跑复核，
 * 用户看到的会是一串误导人的「裁决缺口」，而不是「双审进行中，请先 --cancel」。
 * **`recordApproval` 内保留原调用**（计划双审 r1 GLM-02）：三种决定的前置校验与抽取前逐字相同。
 *
 * 只抛错、不返回布尔——调用方没有「判定不过但继续」的写法可选。
 */
export function assertGateDecidable(
  gate: Awaited<ReturnType<typeof getGate>>,
  i: Pick<ApprovalInput, 'topic' | 'stage' | 'decision' | 'reason'>,
): asserts gate is NonNullable<Awaited<ReturnType<typeof getGate>>> {
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
}

export async function recordApproval(i: ApprovalInput): Promise<{ message: string }> {
  const { ctx } = i;
  const gate = await getGate(ctx.triviumDir, i.topic, i.stage);
  assertGateDecidable(gate, i);

  /*
   * 核过的就是批的（见 `ApprovalInput.verifiedRunId`）。
   * 未传或为空一律视同不一致——写成 `(verifiedRunId ?? null) !== gate.run_id` 的话，
   * 闸门 run_id 为 null 且调用方没传时 `null === null` 放行，正是「没传就不比」的口子。
   * 闸门 run_id 为 null 时 approved 因此恒被拒，与复核函数「推断不出 run_id 即拒绝」同向。
   */
  if (i.decision === 'approved' && (!i.verifiedRunId || i.verifiedRunId !== gate.run_id)) {
    throw new TriviumError(
      EXIT.GATE_BLOCK,
      `闸门当前记着 run ${gate.run_id ?? '（无）'}，而通过前复核的是 ${i.verifiedRunId ?? '（未给出）'}——` +
        '两者不是同一轮，本次不放行。\n' +
        `  请重新查看 \`trivium status --topic ${shellQuoteArg(i.topic)}\` 后再审批。`,
    );
  }

  const record: ApprovalRecord = {
    at: new Date().toISOString(),
    stage: i.stage,
    run_id: gate.run_id ?? '',
    decision: i.decision,
    reason: i.reason ?? null,
    session_id: i.sessionId ?? null,
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
      `闸门未变更：${g.skipped ?? '状态已被另一次运行接管'}。请重新查看 \`trivium status --topic ${shellQuoteArg(i.topic)}\` 后再决定。`,
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
