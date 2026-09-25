/**
 * 工件命名的**唯一**实现（设计 §6.2 / FR-08）。
 *
 * 形态：`<YYYY-MM-DD>-<主题字段>-<角色>.md`
 *       主题字段 = `<主题>[-r<N>][-revised|-response]`
 *
 * 这里只做纯函数的「生成」与「解析」，不碰文件系统——落盘与防覆盖在 archive。
 * 拆成纯函数是为了让 §17.1 的单元层能在没有真实 CLI 与仓库的情况下覆盖它。
 */
import { DEFAULT_DRIVER, suffixAlternation, type AgentId } from './agents/registry.js';
import type { CriticId, Stage } from './types.js';

/**
 * 工件角色后缀 = 已登记的 Agent id（计划 §2.1）。
 *
 * 重构前是 `'claude' | CriticId` 两类三值，隐含「Driver 恒为 claude、
 * claude 从不当审核者」的假设。后缀标识**产出方**，与「发起方」正交，
 * 因此它的取值域就是全部注册 Agent，与谁当 Driver 无关。
 */
export type Role = AgentId;
export type DispositionKind = 'revised' | 'response';

/** 主题名的保留后缀：主题不得以这些结尾，否则文件名无法反向解析 */
const RESERVED_SUFFIX = /-(?:r\d+|revised|response|verify)$/;

export interface TopicValidation {
  ok: boolean;
  /** 规范化后的主题（空格转 -） */
  normalized: string;
  reason?: string;
  suggestion?: string;
}

/**
 * 主题名合法性（设计 §6.1）。
 *
 * 允许中英文、数字、`-`、`_`、`.`；长度 1～64；
 * 禁止路径分隔符、`..`、前导 `.`、控制字符；空格自动转 `-`。
 */
export function validateTopic(raw: string, maxLen = 64): TopicValidation {
  const normalized = raw.trim().replace(/\s+/g, '-');

  if (normalized.length === 0) {
    return { ok: false, normalized, reason: '主题名不能为空' };
  }
  if (normalized.length > maxLen) {
    return {
      ok: false,
      normalized,
      reason: `主题名长度 ${normalized.length} 超过上限 ${maxLen}`,
      suggestion: normalized.slice(0, maxLen),
    };
  }
  if (/[/\\]/.test(normalized)) {
    return { ok: false, normalized, reason: '主题名不得包含路径分隔符 / 或 \\' };
  }
  if (normalized.includes('..')) {
    return { ok: false, normalized, reason: '主题名不得包含 ..' };
  }
  if (normalized.startsWith('.')) {
    return { ok: false, normalized, reason: '主题名不得以 . 开头' };
  }
  // eslint 风格的控制字符检查（不引 lint，手写范围）
  for (const ch of normalized) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f) {
      return { ok: false, normalized, reason: '主题名不得包含控制字符' };
    }
  }
  if (RESERVED_SUFFIX.test(normalized)) {
    return {
      ok: false,
      normalized,
      reason:
        '主题名不得以 -r<数字> / -revised / -response / -verify 结尾——' +
        '这些是保留后缀，否则无法区分「主题 X 的第 2 轮」与「主题 X-r2 的首轮」',
      suggestion: normalized.replace(RESERVED_SUFFIX, ''),
    };
  }
  return { ok: true, normalized };
}

export interface ArtifactName {
  date: string;
  topic: string;
  /** 重跑轮次，首跑为 1（文件名中不出现） */
  rerunIndex: number;
  kind: DispositionKind | null;
  role: Role;
}

/** 本地日期 YYYY-MM-DD（不是 UTC——工件日期应与开发者所见一致） */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 生成工件文件名。
 *
 * `driver` 指当轮发起方，裁决件后缀只能是它（计划 §2.1 / B-2）。缺省
 * `claude` 保持旧调用行为不变——M7a 里 Driver 恒为 claude，此参数为
 * M10 的 Driver 任意化预留。重构前这里写死 `a.role !== 'claude'`，
 * 非 Claude Driver 的裁决件根本无法落盘。
 */
export function buildArtifactName(a: ArtifactName, driver: AgentId = DEFAULT_DRIVER): string {
  if (a.rerunIndex < 1) throw new Error(`rerunIndex 必须 ≥ 1，收到 ${a.rerunIndex}`);
  if (a.kind !== null && a.role !== driver) {
    throw new Error(
      `-${a.kind} 是 Driver 裁决件专用后缀（当轮 Driver：${driver}），不能用于角色 ${a.role}`,
    );
  }
  const parts = [a.topic];
  if (a.rerunIndex > 1) parts.push(`r${a.rerunIndex}`);
  if (a.kind) parts.push(a.kind);
  return `${a.date}-${parts.join('-')}-${a.role}.md`;
}

/** 验证记录文件名：`<日期>-<主题>-verify.md`，不带角色后缀（§6.2） */
export function buildVerifyName(date: string, topic: string, rerunIndex = 1): string {
  const parts = [topic];
  if (rerunIndex > 1) parts.push(`r${rerunIndex}`);
  return `${date}-${parts.join('-')}-verify.md`;
}

/*
 * 角色后缀集由注册表生成（计划 §2.1 / GLM-05）。
 *
 * 写死三值时，一旦归档里出现过 `-codex.md`，该文件对解析器即不存在——
 * `listStageArtifacts` 跳过它、AC-07 检查器不识别它、gate 找不到它。
 * 识别集必须始终覆盖全部已登记后缀，**与该 Agent 当前是否启用无关**：
 * 历史留痕的可读性不能随注册项的启停而消失。
 */
const NAME_RE = new RegExp(
  `^(\\d{4}-\\d{2}-\\d{2})-(.+?)(?:-r(\\d+))?(?:-(revised|response))?-(${suffixAlternation()})\\.md$`,
);

/** 解析工件文件名。不合规返回 null——调用方据此判定「非本流水线产出」 */
export function parseArtifactName(fileName: string): ArtifactName | null {
  const m = NAME_RE.exec(fileName);
  if (!m) return null;
  const [, date, topic, r, kind, role] = m;
  return {
    date: date!,
    topic: topic!,
    rerunIndex: r ? Number.parseInt(r, 10) : 1,
    kind: (kind as DispositionKind | undefined) ?? null,
    role: role as Role,
  };
}

/**
 * 角色后缀硬约束（§6.2 / PRD 6.3）：交互写者只能产出自己的后缀，
 * 审查员后缀的文件由编排器 `archive` 独占产出。
 *
 * `driver` 缺省 `claude`，与重构前语义逐项相同。
 */
export function roleIsAllowedForWriter(
  writer: 'driver' | CriticId,
  role: Role,
  driver: AgentId = DEFAULT_DRIVER,
): boolean {
  return writer === 'driver' ? role === driver : role === writer;
}

/** 阶段对应的裁决件后缀（§6.3） */
export function dispositionKindForStage(stage: Stage): DispositionKind {
  return stage === 'code' ? 'response' : 'revised';
}

/**
 * 某文件名是否可能被 AC-07 的角色后缀检查器误判——_meta/ 内不得出现这类名字。
 *
 * 后缀集由注册表生成（计划 §2.2 / A-3）：写死三值时，新后缀 `-codex.md`
 * 落进 `_meta/` 不再被识别。
 */
export function looksLikeRoleArtifact(fileName: string): boolean {
  return new RegExp(`-(?:${suffixAlternation()})\\.md$`).test(fileName);
}

/**
 * 上面那条判据的人读形态，如 `-claude/-codex/-gemini/-glm.md`——**与判据同源**（EV-61 ④，M10b 第 2 步）。
 *
 * 此前 `archive.writeMeta` 的报错文案写死三家后缀：判据按注册表认四家，
 * 文案只说三家，被拦的人照文案排查会漏掉 codex。
 */
export function roleArtifactSuffixLabel(): string {
  return `-${suffixAlternation().split('|').join('/-')}.md`;
}
