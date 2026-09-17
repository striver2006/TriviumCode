/**
 * 退出码约定（设计 §7.3）。
 *
 * 这是编排器与 Claude Code 侧 skill / Hook 之间的契约，任何模块都不得自行发明退出码。
 * 特别地 `GATE_BLOCK=2` 对 Hook 有特殊语义（PreToolUse 阻断工具调用、Stop 阻止收工），
 * 因此 Hook 子命令必须经统一 wrapper 保证只在**明确判定**时返回 2，内部异常一律返回 1。
 */
export const EXIT = {
  /** 成功 */
  OK: 0,
  /** 一般失败 */
  FAIL: 1,
  /** 闸门阻断（供 Claude Code Hook 使用） */
  GATE_BLOCK: 2,
  /** 参数错误：缺提示语、模型 slug 非法、主题名非法 */
  USAGE: 64,
  /** 前置产物缺失：找不到计划 / 根因材料 / 无代码变更 */
  MISSING_ARTIFACT: 65,
  /** 环境或预检失败：CLI 不可调用、未认证、归档根不可写、非 git 仓库 */
  ENV: 69,
  /** 同主题已有运行持锁（§12.6） */
  LOCKED: 70,
  /** 运行仍在进行中（仅 `review --wait`） */
  STILL_RUNNING: 73,
  /** 超时或单侧失败且为严格模式 */
  STRICT_ABORT: 75,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** 带退出码的受控错误：cli 顶层捕获后按该码退出，不打印堆栈 */
export class TriviumError extends Error {
  readonly code: ExitCode;
  readonly details?: unknown;

  constructor(code: ExitCode, message: string, details?: unknown) {
    super(message);
    this.name = 'TriviumError';
    this.code = code;
    this.details = details;
  }
}

export const usageError = (m: string, d?: unknown) => new TriviumError(EXIT.USAGE, m, d);
export const missingArtifact = (m: string, d?: unknown) => new TriviumError(EXIT.MISSING_ARTIFACT, m, d);
export const envError = (m: string, d?: unknown) => new TriviumError(EXIT.ENV, m, d);

/**
 * 旗标值看起来像是从自由文本里误吞来的，就补一句解释。
 *
 * `topic resolve` 按 argv 逐个 token 解析（EV-18 之后不再拼串重切），于是正文里
 * **裸露**的 `--base`、`--profile` 这类词会被当成真旗标，连同后一个 token 一起被抠走。
 * 被抠走的那截几乎必然撞上下游校验（坏 ref / 坏档位 / 非法 slug），但原先的文案
 * 只说「你写错了」——而用户的真实情况往往是**压根没想传这个参数**。
 *
 * 判据：ref 名与档位名都不含空格、也不会是中文；命中即几乎可以断定是误吞。
 * 判错的代价只是多一行提示，判漏的代价是用户对着「请给出一个存在的 ref」发懵。
 */
export function swallowedTextHint(value: string): string {
  const looksLikeProse = /\s/.test(value) || /[^\x20-\x7E]/.test(value);
  if (!looksLikeProse) return '';
  return (
    '\n  这段文字像是任务目标或焦点的一部分——它前面的 `--xxx` 被当成了旗标，' +
    '把它当值吞了进去。\n' +
    "  请把整段正文放进**一个**单引号参数，旗标放在引号之外，例如：`-- '让 --base 真正进入冻结' --focus <焦点>`。"
  );
}
