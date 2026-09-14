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
import { ALL_AGENT_IDS, DEFAULT_DRIVER, type AgentId } from './agents/registry.js';
import { CRITICS, type CriticId, type Ctx, type Stage } from './types.js';
import { resolveCriticSelection } from './critics.js';
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
const STATIC_FLAGS = [
  'topic', 'context', 'plan-file', 'rca-file', 'base',
  'profile', 'focus', 'goal',
  'only', 'allow-single', 'session-id', 'critics',
] as const;
type StaticFlag = (typeof STATIC_FLAGS)[number];

/**
 * 逐 Agent 的模型覆盖旗标，由注册表派生。
 *
 * **此前这里写死 `model-gemini` / `model-glm` 两条**，而下方取值的循环早在
 * M7b 第 2 步就改成了按集合拼名（`model-${c}`）。两者之间的缝隙正是本文件
 * 头部登记的那一族缺口：`--model-<第三家>` 不在白名单里，于是不报错、
 * 不退非零码，整段被当成正文压进 `restParts`——模型覆盖静默丢失，
 * 焦点正文里还平白多出一截 `--model-xxx`。
 *
 * 用模板字面量类型从 `AgentId` 派生，注册表加一家这里自动跟随；
 * 论域取**全部已登记 Agent** 而非当前可用审核者，是为了让「写了但不可用」
 * 落到下面那条明确的报错上，而不是退回静默吞进正文。
 */
type ModelFlag = `model-${AgentId}`;
const MODEL_FLAGS: readonly ModelFlag[] = ALL_AGENT_IDS.map((id): ModelFlag => `model-${id}`);

const NAMED_FLAGS: readonly (StaticFlag | ModelFlag)[] = [...STATIC_FLAGS, ...MODEL_FLAGS];
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
  /**
   * 本轮入选的审核者集合（`--critics a,b`；缺省取 `review.default_critics`）。
   *
   * **恒非空**：这里已经解析并校验完，skill 照抄透传即可，不必再自己拼。
   * `--only` 是它的单元素特例，两者同时给会在此处退 64。
   */
  critics: CriticId[];
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
  /*
   * `--critics` 与 `--only` 的解析与校验都交给 `resolveCriticSelection`
   * （M7b 第 5 步）。此前这里自己实现了一遍 `--only` 的字面校验，
   * 而 `cli.ts` 的 `review --start` 又实现了一遍——两处不一致正是上一轮
   * 修掉的形态。现在只有一个判定处，两个入口都调它。
   */
  /*
   * 命令 A 不接受选侧旗标（审查意见 GLM-02）。
   *
   * `NAMED_FLAGS` 不分 scope，于是 `/dual-run --critics glm` 会被解析成功，
   * 然后**被 S2/S6 的交接说明静默丢弃**（那里只交代了 focus / context / models / profile）——
   * 拼错的当场退 64，写对的反而无声消失。「错的报错、对的消失」是本项目反复记过的形态。
   *
   * 不给命令 A 补透传而是明确拒绝：它一次要跑 plan 与 code 两轮双审，
   * 「这一轮选哪几侧」在命令 A 层面语义本就模糊。与其定义一个想不清楚的语义，
   * 不如让用户改用 B/C/D。这条边界写在设计 7.1。
   */
  if (scope === 'all' && (named['critics'] || onlyRaw)) {
    const given = named['critics'] ? '--critics' : '--only';
    throw new TriviumError(
      EXIT.USAGE,
      `命令 A（全流程）不接受 ${given}：它一次要跑计划审与代码审两轮，` +
        '「本轮选哪几侧」在这一层没有确定语义。\n' +
        '  想指定审核者请改用 /dual-review-plan、/dual-review-code 或 /dual-review-bug。',
    );
  }

  const critics = resolveCriticSelection(ctx.config, {
    critics: named['critics'] ?? null,
    only: onlyRaw || null,
  });
  /*
   * **入选来自 `--only` 时，输出的 `only` 置 null**（审查意见 AGY-01 ≡ GLM-01，两侧判 major）。
   *
   * 这是那条 major 的**数据层修法**：`critics` 已经完整表达了入选集合（含 `--only` 的
   * 单元素形态），再把 `only` 一并输出，下游照抄就会同时拼出两个旗标而撞上互斥——
   * 实测 `--only glm` 时 `--start` 必退 64，且报错说的是「你不能同时给两个」，
   * 而用户根本没写 `--critics`。
   *
   * 文档层（三份 SKILL 删去 `--only` 透传）也改了，但**光改文档不够**：文档会被抄错、
   * 会有未同步的旧副本。这里让第二个旗标在数据上就不存在，错误形态才真正不可达。
   */
  const only: CriticId | null = null;
  const allowSingle = booleans.has('allow-single');
  if (onlyRaw && allowSingle) {
    /*
     * 口径按新语义重写（审查意见 GLM-03）。原文写的是「只跑一侧时降级本就必然发生，
     * --allow-single 不改变行为」——本步之后两句都是假话：选一侧成功记 `full`、
     * 不写 `degraded_reason`；而 `--allow-single` 实际改变的是**失败分支**
     * （strict 下该侧失败整次退 75，degrade 下继续留痕）。
     */
    notes.push(
      '已按 --only 只选一侧：这是配置意图，成功时不标降级；' +
        '--allow-single 只影响该侧失败时是否中止（§12.4）',
    );
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
  /*
   * 逐审核者取 `--model-<id>`，不再写死两个旗标名。
   * 旗标名对既有两侧逐字不变（id 即 gemini / glm），第三家启用后自动可用。
   *
   * 白名单的论域是**全部已登记 Agent**，取值的论域是**当前可用审核者**——
   * 两者之差（登记了但未启用为审核者，如 Driver 自身）必须当场报错。
   * 不报的话它会落进「解析成功、随后被丢弃」：留痕里看不出用户指定过模型，
   * 而这正是 `--base` 漏传那一族的形状。
   */
  for (const id of ALL_AGENT_IDS) {
    const v = named[`model-${id}`];
    if (!v) continue;
    if (!(CRITICS as readonly string[]).includes(id)) {
      throw new TriviumError(
        EXIT.USAGE,
        `--model-${id}：${id} 当前不是可用审核者，不能为它指定模型。\n` +
          `  当前可用：${CRITICS.join('、')}`,
      );
    }
    models[id] = v;
  }

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
    critics,
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
