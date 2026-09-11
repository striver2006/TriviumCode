/**
 * `topic resolve` 的参数解析（设计 §7.4 步骤 2，按修订版 M3 计划 §3 实现）。
 *
 * 从 skill 传来的整串 `$ARGUMENTS` 里切出具名参数与提示语。
 * 这是**确定性工作**，不能交给模型做（原则 P1）。
 *
 * 本命令**纯只读**：只做 `validateTopic` 与定位，严禁 `ensureDir` 或任何写操作——
 * 它运行在 `preflight` 与 `review --start` 之间，若在此创建阶段目录，
 * 后续复检失败就会留下孤立空目录，AC-16 在这条跨进程路径上失守
 * （审查意见 AGY-01 / GLM-03）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { CriticId, Ctx, Stage } from './types.js';
import { validateTopic, parseArtifactName } from './naming.js';
import { EXIT, TriviumError } from './exit-codes.js';
import { exists } from './util/fsx.js';
import { diffExcludePrefixes } from './code-stage.js';
import type { PreflightScope } from './preflight.js';

/** 具名参数白名单。其余正文即提示语 */
const NAMED_FLAGS = [
  'topic', 'context', 'plan-file', 'rca-file', 'base',
  'model-gemini', 'model-glm', 'profile', 'focus',
] as const;
type NamedFlag = (typeof NAMED_FLAGS)[number];

export interface ParsedArgsBundle {
  named: Partial<Record<NamedFlag, string>>;
  /** 去掉具名参数后剩下的正文 */
  rest: string;
}

/**
 * 切分 `$ARGUMENTS`。
 *
 * 支持 `--k v`、`--k=v`、以及带引号的值。**提示语正文里出现 `--` 不会被误当参数**
 * ——只有出现在白名单里的 `--<name>` 才按参数处理。
 */
export function splitArguments(raw: string): ParsedArgsBundle {
  const named: Partial<Record<NamedFlag, string>> = {};
  const restParts: string[] = [];
  const tokens = tokenize(raw);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.startsWith('--')) {
      restParts.push(t);
      continue;
    }
    const eq = t.indexOf('=');
    const name = (eq === -1 ? t.slice(2) : t.slice(2, eq)) as NamedFlag;
    if (!(NAMED_FLAGS as readonly string[]).includes(name)) {
      // 不是我们认识的参数 → 当作提示语正文的一部分，原样保留
      restParts.push(t);
      continue;
    }
    if (eq !== -1) {
      named[name] = t.slice(eq + 1);
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !isKnownFlag(next)) {
      named[name] = next;
      i++;
    } else {
      named[name] = '';
    }
  }
  return { named, rest: restParts.join(' ').trim() };
}

function isKnownFlag(token: string): boolean {
  if (!token.startsWith('--')) return false;
  const eq = token.indexOf('=');
  const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
  return (NAMED_FLAGS as readonly string[]).includes(name);
}

/** 简易 shell 风格分词：支持单双引号，保留引号内的空格 */
function tokenize(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export interface TopicResolution {
  topic: string;
  /** 统一字段名：skill 传 --focus，编排器内部一律叫 prompt_hint（AGY-04） */
  prompt_hint: string | null;
  /**
   * 被审对象路径。按 stage 不同（AGY-04）：
   *   plan / bug → 必须定位到原稿，找不到退 65
   *   code       → null，改看 base 与 diff_available
   *   all（命令 A）→ null，S1 才起草
   */
  subject_path: string | null;
  /** code 阶段的 diff 基线 */
  base: string | null;
  diff_available: boolean | null;
  context_paths: string[];
  models: Partial<Record<CriticId, string>>;
  profile: string | null;
  /** 主题是否由编排器推导而来（skill 需回显给用户确认） */
  topic_inferred: boolean;
  notes: string[];
}

/** 从任务目标推导主题候选：取前若干个词，去掉标点 */
export function inferTopic(text: string, maxLen: number): string {
  const cleaned = text
    .replace(/[，。！？；：、,.!?;:"'`]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, Math.min(maxLen, 32)) || '未命名主题';
}

export interface ResolveInput {
  ctx: Ctx;
  scope: PreflightScope;
  rawArgs: string;
}

export async function resolveTopicArgs(input: ResolveInput): Promise<TopicResolution> {
  const { ctx, scope, rawArgs } = input;
  const { named, rest } = splitArguments(rawArgs);
  const notes: string[] = [];

  // 提示语：--focus 优先，否则取剩余正文
  const promptHint = (named['focus'] ?? rest).trim() || null;

  // 主题：显式指定优先，否则从提示语/任务目标推导
  let inferred = false;
  let topicRaw = named['topic']?.trim() ?? '';
  if (topicRaw.length === 0) {
    topicRaw = inferTopic(promptHint ?? '', ctx.config.topic.max_len);
    inferred = true;
    notes.push(`主题由任务目标推导：「${topicRaw}」——请向用户回显确认`);
  }
  const v = validateTopic(topicRaw, ctx.config.topic.max_len);
  if (!v.ok) {
    throw new TriviumError(
      EXIT.USAGE,
      `主题名不合法：${v.reason}${v.suggestion ? `\n  建议改为：${v.suggestion}` : ''}`,
    );
  }
  const topic = v.normalized;

  const models: Partial<Record<CriticId, string>> = {};
  if (named['model-gemini']) models.gemini = named['model-gemini'];
  if (named['model-glm']) models.glm = named['model-glm'];

  const contextPaths = (named['context'] ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  // ── 按 stage 定位被审对象（纯只读，目录不存在时容忍）──
  let subjectPath: string | null = null;
  let base: string | null = null;
  let diffAvailable: boolean | null = null;

  if (scope === 'plan' || scope === 'bug') {
    const explicit = scope === 'plan' ? named['plan-file'] : named['rca-file'];
    subjectPath = await locateSubjectReadOnly(ctx, topic, scope, explicit ?? null);
  } else if (scope === 'code') {
    base = named['base'] ?? 'HEAD';
    const { diffAgainst } = await import('./util/git.js');
    const diff = await diffAgainst(
      ctx.projectRoot, base,
      diffExcludePrefixes(path.relative(ctx.projectRoot, ctx.archiveRoot)),
    );
    diffAvailable = diff.trim().length > 0;
    if (!diffAvailable) {
      throw new TriviumError(
        EXIT.MISSING_ARTIFACT,
        `相对 ${base} 无代码变更可审。请先完成编码，或用 --base 指定其它基线。`,
      );
    }
    notes.push(`code 阶段的被审对象是 git diff（base=${base}），不是单一文件`);
  } else {
    // scope === 'all'：命令 A 的 S1 才起草，此时原稿必然不存在
    notes.push('命令 A：原稿将在 S1 由 Driver 起草，此时尚不存在');
  }

  return {
    topic,
    prompt_hint: promptHint,
    subject_path: subjectPath,
    base,
    diff_available: diffAvailable,
    context_paths: contextPaths,
    models,
    profile: named['profile'] ?? null,
    topic_inferred: inferred,
    notes,
  };
}

/**
 * 只读定位被审对象。**不创建任何目录**（AGY-01 / GLM-03）。
 *
 * 与 `topic.ts` 的 `locateSubject` 的区别：后者依赖已由 `resolveTopic` 创建的阶段目录，
 * 这里的路径是自己算出来的，目录不存在就直接报 65。
 */
async function locateSubjectReadOnly(
  ctx: Ctx,
  topic: string,
  stage: Stage,
  explicit: string | null,
): Promise<string> {
  if (explicit) {
    const abs = path.isAbsolute(explicit) ? explicit : path.join(ctx.projectRoot, explicit);
    if (!(await exists(abs))) {
      throw new TriviumError(EXIT.MISSING_ARTIFACT, `指定的被审对象不存在：${explicit}`);
    }
    return abs;
  }

  const stageDir = path.join(ctx.archiveRoot, topic, stage);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(stageDir);
  } catch {
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `找不到主题「${topic}」的 ${stage} 阶段目录（${path.relative(ctx.projectRoot, stageDir)}）。\n` +
        `  请先落盘原稿（形如 <日期>-${topic}-claude.md），或用 ` +
        `${stage === 'plan' ? '--plan-file' : '--rca-file'} 显式指定。`,
    );
  }

  const candidates = entries
    .map((fileName) => ({ fileName, parsed: parseArtifactName(fileName) }))
    .filter(
      (c) =>
        c.parsed !== null &&
        c.parsed.topic === topic &&
        c.parsed.role === 'claude' &&
        c.parsed.kind === null,
    )
    .sort((a, b) => b.parsed!.rerunIndex - a.parsed!.rerunIndex || b.fileName.localeCompare(a.fileName));

  if (candidates.length === 0) {
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `在 ${path.relative(ctx.projectRoot, stageDir)} 下找不到原稿（形如 <日期>-${topic}-claude.md）。\n` +
        `  该目录下现有：${entries.length > 0 ? entries.join(', ') : '（空）'}`,
    );
  }
  return path.join(stageDir, candidates[0]!.fileName);
}
