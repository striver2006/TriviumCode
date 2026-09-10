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
