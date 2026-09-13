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
import { DEFAULT_DRIVER, type AgentId } from './agents/registry.js';
import { CRITICS, type CriticId, type Ctx, type Stage } from './types.js';
import { validateTopic, parseArtifactName } from './naming.js';
import { EXIT, TriviumError } from './exit-codes.js';
import { exists } from './util/fsx.js';
import { diffExcludePrefixes } from './code-stage.js';
import type { PreflightScope } from './preflight.js';

/**
 * 具名参数白名单。其余正文按命令语义落到焦点或任务目标（见 resolveTopicArgs）。
 *
 * `only` / `allow-single` / `session-id` 是后补的（审查意见 AGY-04）：`review --start`
 * 三个都支持，这里却不认识，于是它们被当成正文压进 restParts——单审降级意图丢失，
 * 焦点正文里还平白多出一截 `--allow-single`。这一族缺口的形状与 `--base` 那次相同：
 * 不报错、留痕正常、审的不是用户以为的东西。
 */
const NAMED_FLAGS = [
  'topic', 'context', 'plan-file', 'rca-file', 'base',
  'model-gemini', 'model-glm', 'profile', 'focus', 'goal',
  'only', 'allow-single', 'session-id',
] as const;
/** 自由文本旗标：贪婪取到下一个已知旗标为止 */
const GREEDY_FLAGS: ReadonlySet<string> = new Set(['focus', 'goal']);
/**
 * 布尔旗标：**不吃后面的 token**。
 *
 * 若让 `--allow-single` 走「取下一个 token 当值」的默认路径，
 * `/dual-review-code --allow-single 重点看并发安全` 会把「重点看并发安全」当成它的值吞掉，
 * 焦点变成空——补白名单反倒制造出一个新的静默截断。
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['allow-single']);
type NamedFlag = (typeof NAMED_FLAGS)[number];

export interface ParsedArgsBundle {
  named: Partial<Record<NamedFlag, string>>;
  /** 出现过的布尔旗标 */
  booleans: Set<string>;
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
  const booleans = new Set<string>();
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
    if (BOOLEAN_FLAGS.has(name)) {
      // `--allow-single` 或 `--allow-single=false`，都不吃后面的 token
      const v = eq === -1 ? 'true' : t.slice(eq + 1).trim().toLowerCase();
      if (v !== 'false' && v !== '0') booleans.add(name);
      continue;
    }
    if (eq !== -1) {
      named[name] = t.slice(eq + 1);
      continue;
    }
    /*
     * ── `--focus` / `--goal` 贪婪取值，其余旗标只吃一个 token ──
     *
     * 焦点与任务目标都是自由文本，天然带空格。若照单 token 取，用户写
     * `--focus 重点看 并发安全` 只会拿到「重点看」，剩下的悄悄漏进正文——
     * 又是一次静默截断。其余旗标（topic / base / context / model-*）都是单值，
     * 贪婪反而会把后面的正文吞进去，所以只对这两个放宽。
     */
    if (GREEDY_FLAGS.has(name)) {
      const parts: string[] = [];
      while (i + 1 < tokens.length && !isKnownFlag(tokens[i + 1]!)) parts.push(tokens[++i]!);
      named[name] = parts.join(' ');
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
  return { named, booleans, rest: restParts.join(' ').trim() };
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
  /**
   * 审查焦点（编排器内部一律叫 prompt_hint，AGY-04）。
   * B/C/D 的命令正文就是它；命令 A 只认显式 `--focus`。
   */
  prompt_hint: string | null;
  /**
   * 任务目标原文（设计 §9.4，进 BRIEF 第 4 段）。
   * 命令 A 的命令正文就是它；B/C/D 只认显式 `--goal`（或「`<目标> --focus <焦点>`」写法里的正文），
   * 为 null 时由编排器回退到 task.json / plan 原稿。与 `prompt_hint` **刻意分开**（RV-19）。
   */
  task_goal: string | null;
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
  /** 只跑一侧（`review --start --only gemini|glm`），null 表示两侧都跑 */
  only: CriticId | null;
  /** 一侧失败时不中止，产出单审结果并留痕（§12.4） */
  allow_single: boolean;
  /**
   * 调用方传进来的会话 id。
   *
   * 它不该由用户手打（宿主注入或 CLI 从环境取），但整串 `$ARGUMENTS` 里出现时
   * 必须被识别——否则会被当成正文吞进审查焦点。原样回显，供上层决定要不要透传。
   */
  session_id: string | null;
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
  const { named, booleans, rest } = splitArguments(rawArgs);
  const notes: string[] = [];

  /*
   * `--only` 的取值在这里就校验（审查意见 AGY-04）。
   * 留到 `review --start` 才报错的话，用户要等解析走完一整轮才看到「拼错了」，
   * 而 resolve 的职责本就是「把整串参数切清楚并当场指出问题」。
   */
  const onlyRaw = named['only']?.trim() ?? '';
  // 合法值取自当前启用的审核者集合，不写死两家（M7b 起 `--critics` 取代本旗标）
  if (onlyRaw && !CRITICS.includes(onlyRaw as CriticId)) {
    throw new TriviumError(
      EXIT.USAGE,
      `--only 只接受 ${CRITICS.join(' | ')}，收到：${onlyRaw}`,
    );
  }
  const only = (onlyRaw || null) as CriticId | null;
  const allowSingle = booleans.has('allow-single');
  if (only && allowSingle) {
    notes.push('同时给了 --only 与 --allow-single：只跑一侧时降级本就必然发生，--allow-single 不改变行为');
  }

  /*
   * ── 位置参数按命令语义定，旗标只做覆盖 ──
   *
   *   命令 A（scope=all）：正文 = 任务目标（「要达成什么」，BRIEF 第 4 段），`--focus` 可选。
   *   命令 B/C/D：       正文 = 审查焦点（「重点看什么」，第 2 段，FR-20 / AC-09 的唯一落点），
   *                     `--goal` 可选；任务目标缺省时由编排器回退到 task.json / plan 原稿。
   *
   * 这是 PRD 的原始定义（第 8 章：「命令后面带的提示语」= 审查焦点）。用户在 B/C/D 里
   * 最常打的就是焦点，几乎不会打目标——目标本来就能从归档里取回。曾经把 B/C/D 的正文
   * 改判为任务目标、焦点强制走 `--focus`，动机是「正文里出现 `--base` 会被吞掉」；
   * 但那是分词器的固有歧义，`--focus` 贪婪取值遇到已知旗标同样截断，没解决问题，
   * 反倒让 `/dual-review-code 重点看并发` 直接退 64。
   *
   * 兼容显式写法 `<任务目标> --focus <焦点>`：B/C/D 给了 `--focus`，正文就落到任务目标上。
   * 显式 `--goal` / `--focus` 永远优先于正文。
   */
  const focusFlag = (named['focus'] ?? '').trim() || null;
  const goalFlag = (named['goal'] ?? '').trim() || null;
  const body = rest.trim() || null;

  let promptHint: string | null;
  let taskGoal: string | null;
  if (scope === 'all') {
    taskGoal = goalFlag ?? body;
    promptHint = focusFlag;
  } else if (focusFlag) {
    promptHint = focusFlag;
    taskGoal = goalFlag ?? body;
  } else {
    promptHint = body;
    taskGoal = goalFlag;
  }

  /*
   * ── B/C/D 什么都没写才退 64（FR-20），不留给执行者自觉 ──
   *
   * 原先只有 SKILL.md 里一句「若提示语为空 → 停止」，靠执行者判断。
   * 命令 A（scope=all）不在此列：它的焦点本就是可选的补充提示。
   */
  if (scope !== 'all' && !promptHint) {
    throw new TriviumError(
      EXIT.USAGE,
      '缺少审查焦点：命令 B/C/D 必须写明本次重点看什么（FR-20）。\n' +
        '  焦点会逐字进入两侧送审材料，是 AC-09 的验收落点。\n' +
        '  写法：/dual-review-<plan|code|bug> <本次重点看什么>\n' +
        '  也可显式：<任务目标> --focus <本次重点看什么>',
    );
  }

  // 主题：显式指定优先，否则从提示语/任务目标推导
  let inferred = false;
  let topicRaw = named['topic']?.trim() ?? '';
  if (topicRaw.length === 0) {
    topicRaw = inferTopic(taskGoal ?? promptHint ?? '', ctx.config.topic.max_len);
    inferred = true;
    notes.push(`主题由${taskGoal ? '任务目标' : '审查焦点'}推导：「${topicRaw}」——请向用户回显确认`);
    /*
     * ── 推导结果异常短，多半是任务目标被旗标截断了 ──
     *
     * 正文里出现 `--base` 这类词而没加引号时，它会被当成真旗标并吞掉后一个
     * token，正文只剩开头零星几个字；主题从这截残渣推导，就成了「让」这种单字。
     * `validateTopic` 不会拦——单字是合法主题名——于是真的建出 `.reviews/让/`。
     * 上面那条通用提醒对所有推导主题一视同仁，这里把最可能出错的情形单独点破。
     */
    if (topicRaw.length <= 2) {
      notes.push(
        `主题「${topicRaw}」异常短：通常意味着正文被 \`--xxx\` 旗标截断（未加引号），` +
          '请核对用户原始输入，必要时把整段用双引号包起来重传',
      );
    }
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
      ctx.config.review.sensitive_globs,
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
    task_goal: taskGoal,
    subject_path: subjectPath,
    base,
    diff_available: diffAvailable,
    context_paths: contextPaths,
    models,
    profile: named['profile'] ?? null,
    only,
    allow_single: allowSingle,
    session_id: named['session-id']?.trim() || null,
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
  /**
   * 当轮 Driver：原稿由它产出（审查意见 AGY-03 / GLM-01）。
   *
   * 与 `topic.locateSubject` 同款。这一处曾经漏改，还被 `registry-parity`
   * 的白名单无理由豁免掉了——grep 对账本是为补人工清单的漏而设，
   * 白名单把它重新变回了盲区。
   */
  driver: AgentId = DEFAULT_DRIVER,
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
        `  请先落盘原稿（形如 <日期>-${topic}-${driver}.md），或用 ` +
        `${stage === 'plan' ? '--plan-file' : '--rca-file'} 显式指定。`,
    );
  }

  const candidates = entries
    .map((fileName) => ({ fileName, parsed: parseArtifactName(fileName) }))
    .filter(
      (c) =>
        c.parsed !== null &&
        c.parsed.topic === topic &&
        c.parsed.role === driver &&
        c.parsed.kind === null,
    )
    .sort((a, b) => b.parsed!.rerunIndex - a.parsed!.rerunIndex || b.fileName.localeCompare(a.fileName));

  if (candidates.length === 0) {
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `在 ${path.relative(ctx.projectRoot, stageDir)} 下找不到原稿（形如 <日期>-${topic}-${driver}.md）。\n` +
        `  该目录下现有：${entries.length > 0 ? entries.join(', ') : '（空）'}`,
    );
  }
  return path.join(stageDir, candidates[0]!.fileName);
}
