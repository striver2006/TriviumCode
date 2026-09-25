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
import type { CriticId, Ctx, Stage } from './types.js';
import { assertModelOverrideKeys, resolveCriticSelection, resolveDriver } from './critics.js';
import { validateTopic, parseArtifactName } from './naming.js';
import { EXIT, TriviumError } from './exit-codes.js';
import { exists } from './util/fsx.js';
import { isReviewArtifact } from './archive.js';
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
  // M9 第 5 步：不认识它就会被当正文压进 restParts，与 `--base` 那次同形
  'driver',
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

/**
 * `topic resolve` 认得的具名旗标全集（只读导出）。
 *
 * 供 `entry-render-parity` 对账「入口资产声明的旗标 ⊆ CLI 认得的旗标」（M10b 第 2 步，
 * 计划 r5 §5.1 ②：四家 × CLI 旗标对账）——入口资产里写了一个 CLI 不认的旗标，
 * 它会被当成正文压进焦点，正是本文件头部登记的那一族缺口。
 */
export function resolveNamedFlags(): readonly string[] {
  return NAMED_FLAGS;
}
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
  /** 去掉具名参数后剩下的正文（各 token 以单个空格相连） */
  rest: string;
  /** 正文的逐 token 形态——旧写法指纹（首尾成对字面引号）要按 token 看 */
  restTokens: string[];
}

/**
 * 切分 `--` 之后的 argv。
 *
 * **入参是 token 数组，不是字符串**（BACKLOG EV-18）。此前这里收一整串再自行分词，
 * 分词器遇到正文里一个裸引号就进入引号态、此后所有空白失效，`--topic X` 被粘进同一
 * token 落进正文，主题静默回落推断。shell 已经把边界切好了，第二跳连同它的缺陷一起删掉：
 * 每个 argv 元素就是一个 token，正文里的引号、`$`、反引号都只是字符。
 *
 * 支持 `--k v`、`--k=v`。**提示语正文里出现 `--` 不会被误当参数**
 * ——只有出现在白名单里的 `--<name>` 才按参数处理。裸露在 argv 里的已知旗标
 * 就是真旗标（这是命令行固有的语义，靠 shell 引号把正文包成一个参数来消歧）。
 */
export function splitArguments(tokens: readonly string[]): ParsedArgsBundle {
  const named: Partial<Record<NamedFlag, string>> = {};
  const booleans = new Set<string>();
  const restParts: string[] = [];

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
  return { named, booleans, rest: restParts.join(' ').trim(), restTokens: restParts };
}

function isKnownFlag(token: string): boolean {
  if (!token.startsWith('--')) return false;
  const eq = token.indexOf('=');
  const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
  return (NAMED_FLAGS as readonly string[]).includes(name);
}

/** 一条被包进正文的旗标字样：出现在哪个字段里 */
export interface SwallowedFlag {
  flag: string;
  where: 'rest' | 'focus' | 'goal';
}

/**
 * 找出**被包进同一个 shell 参数里**、因此没被识别为旗标的已知旗标字样（EV-18 的响亮失败）。
 *
 * 论域是正文与两个贪婪旗标的值——`--focus '重点核实 --topic 透传'` 这种写法里，
 * `--topic` 落在 `named.focus` 而不在 rest，只扫 rest 会漏（计划双审 GLM-03）。
 * 该旗标已显式给出时不算：那时正文里的字样只是在谈论它。
 * 对 `--topic` 调用方退 64（它决定审查落在哪个目录，误判代价最高），其余进 notes（CODEX-09）。
 */
export function findSwallowedFlags(b: ParsedArgsBundle): SwallowedFlag[] {
  const fields: [SwallowedFlag['where'], string][] = [
    ['rest', b.rest],
    ['focus', b.named['focus'] ?? ''],
    ['goal', b.named['goal'] ?? ''],
  ];
  const out: SwallowedFlag[] = [];
  for (const name of NAMED_FLAGS) {
    const given = BOOLEAN_FLAGS.has(name) ? b.booleans.has(name) : b.named[name] !== undefined;
    if (given) continue;
    /*
     * 前后界用「不是旗标名成分」而不是「空白」：`重点看--topic 主题甲` 这类中文与旗标黏连的写法里
     * 字样确实在正文内，用 `(^|\s)` 界定就检不出来，主题照样静默回落推断——正是 EV-18 的原始危害
     * （代码双审 r2 GLM-04）。后界同理，且仍不会误伤 `--topic-x` 这种更长的旗标名。
     */
    const re = new RegExp(`(?<![A-Za-z0-9_-])--${name}(?![A-Za-z0-9_-])`);
    for (const [where, text] of fields) {
      if (text && re.test(text)) out.push({ flag: name, where });
    }
  }
  return out;
}

/**
 * 旧写法的指纹：某个 token 首尾是成对的字面引号。
 *
 * 旧 SKILL.md 教 Driver 给正文补字面双引号（那是给已删除的分词器准备的）。新解析器不剥引号，
 * 补了就会原样进 BRIEF，FR-20 的「逐字」被一对多余的引号污染而无任何报错
 * （计划双审 CODEX-08）。不退 64——正文本身以引号起止是合法内容——只提醒。
 */
export function findLiteralQuoteWrapped(b: ParsedArgsBundle): string[] {
  const candidates = [...b.restTokens, b.named['focus'] ?? '', b.named['goal'] ?? ''];
  return candidates.filter(
    (t) => t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0],
  );
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
   * 当轮 Driver（`--driver <id>`，M9 第 5 步）。缺省即注册表缺省值。
   *
   * 它决定两件事：**谁不得入选**（自己不能审自己）、**原稿是谁的后缀**。
   * 回显出来是让上层能看见本次采信的是哪一个——静默取缺省正是这一族缺口的形状。
   */
  driver: AgentId;
  /**
   * 本次声明的 Driver 是否**已启用为 Driver**。
   *
   * M10a 第 3 步起未启用即在 `resolveDriver` 退 64，走到这里的恒为 true。
   * 字段保留为契约：M9 第 5 步到 M10a 第 2 步之间它可以是 false（当时「放行 + 标注」），
   * 下游按字段读，删掉就是破坏性变更。
   */
  driver_enabled: boolean;
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
  /** `--` 之后的 argv，逐个 token（EV-18：不再收整串） */
  rawArgs: readonly string[];
}

export async function resolveTopicArgs(input: ResolveInput): Promise<TopicResolution> {
  const { ctx, scope, rawArgs } = input;
  const bundle = splitArguments(rawArgs);
  const { named, booleans, rest } = bundle;
  const notes: string[] = [];

  /*
   * ── 「给了却没被识别」要响亮失败，不回落推断（EV-18 的验收句）──
   *
   * 已知旗标字样被包进了某个 shell 参数（正文或 --focus/--goal 的值）而该旗标又没显式给：
   * 对 `--topic` 退 64——它决定审查落在哪个 `.reviews/<主题>/`，回落推断就是审在错误主题下；
   * 其余旗标进 notes（`--base` 在 code 阶段有下游校验兜底，`--focus`/`--goal` 只会少一段）。
   */
  const swallowed = findSwallowedFlags(bundle);
  const topicSwallowed = swallowed.find((s) => s.flag === 'topic');
  if (topicSwallowed) {
    throw new TriviumError(
      EXIT.USAGE,
      `检测到 --topic 字样，但它被包进了同一个 shell 参数里（${topicSwallowed.where}），未被识别为旗标。\n` +
        '  要指定主题，把 --topic <主题> 放在引号之外；\n' +
        '  若它只是焦点正文的一部分，请同时显式传 --topic 以消歧——否则主题会回落推断、审在错误的目录下。',
    );
  }
  for (const s of swallowed) {
    notes.push(`正文含 --${s.flag} 字样（在 ${s.where} 里）但未识别为旗标：若你本想传它，请把它放在引号之外`);
  }
  for (const t of findLiteralQuoteWrapped(bundle)) {
    notes.push(`「${t.slice(0, 24)}${t.length > 24 ? '…' : ''}」首尾带字面引号：新版解析器不剥引号，这对引号会原样进入焦点；不需要补字面引号，去掉即可`);
  }

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
   * **命令 A 原先不接受选侧旗标**（审查意见 GLM-02）。当时的理由：`NAMED_FLAGS` 不分 scope，
   * `/dual-run --critics glm` 会解析成功、然后被 S2/S6 的交接说明静默丢弃——「错的报错、对的消失」；
   * 而命令 A 一次跑 plan 与 code 两轮，「这一轮选哪几侧」被判为语义模糊，于是明确拒绝、指引改用 B/C/D。
   *
   * **EV-125 放开**（用户 2026-09-25 定）：`--critics` / `--only` / `--allow-single` 在命令 A 里
   * 取「两轮共用同一组」的语义——与 `--model-*` / `--profile` / `--driver` 早已采用的「两轮都生效、
   * S2 / S6 各传一次」同形，所以不再模糊。拒绝之后的一切本就不分 scope：入选以最终 Driver 解析、
   * 模型覆盖按入选校验、`only` 恒置 null；而下方的两阶段 Driver 比对保证了同一组对 plan / code 都合法
   * （Driver 不会一阶段合法、另一阶段非法）。命令 A 契约的 S0.5 / S0.6 / S2 / S6 显式透传 `critics`
   * 与 `allow_single`，「对的消失」那一格由契约守住。
   *
   * 直接效果：命令 A 缺省集合外的一家（非 claude Driver 下的 claude）从此有了入选出口，
   * 按轮控制侧数也不必再改 `config.yaml`（BACKLOG EV-125 的两个缺口）。
   */

  /*
   * **命令 A 原先同样不接受 `--driver`**（M9 第 5 步，计划双审 D3）。当时的理由：
   * `--driver` 只作 CLI / 编排器内部旗标落地，不进 skill、不进 argument-hint（步骤表 §2.14），
   * 命令 A 收下它之后没有任何交接说明会把它带下去——接受即静默丢弃。
   *
   * **M10b 第 2 步放开**（计划 r5 §5.3，B4）：入口资产改为单源渲染，`--driver <自家 id>` 由渲染注入，
   * 命令 A 的交接说明在 S0.5 / S0.6 / 两次认领 / S2 / S6 六处都显式带上它——「之前」的前提到此为止
   * （EV-125 起原「S0 预检」挪到解析之后，记为 S0.6）。
   * 放开的同时把交叉校验扩到 plan 与 code 两个阶段（见下方主题解析之后那段）。
   */

  /*
   * 当轮 Driver 的**取值**推迟到主题解析之后（M10a 第 1 步）——缺席时要继承该阶段的
   * 权威值，而那要先知道主题。这里只做取值合法性校验：非法取值必须在这里退 64，
   * 不能等到继承判定之后。
   */
  const explicitDriver = (named['driver'] ?? '').trim()
    ? resolveDriver(named['driver']!).driver
    : null;

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
        `主题「${topicRaw}」异常短：通常意味着正文被裸露的 \`--xxx\` 旗标截断，` +
          '请核对用户原始输入，必要时把整段正文放进一个单引号参数重传',
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

  /*
   * ── 当轮 Driver：显式旗标优先，缺席则**继承该阶段的权威值**（M10a 第 1 步）──
   *
   * 与 `review --start` 共用 `driver-claim` 的那一份判定与校验。**两个入口都要有**：
   * 技能侧先走本入口会被挡住，而 `review --start` 才是真正烧配额的那条——
   * 只落一处就是 EV-53 那族缺口的形状。
   *
   * **命令 A（`scope === 'all'`）对 plan 与 code 两个阶段逐一比对**（M10b 第 2 步，计划 r5 §5.3）：
   * 此前它整段跳过——那时命令 A 在上面拒绝了 `--driver`，没有可比对的值。放开旗标而不补这一段，
   * 冲突就要等到 S2 / S6 的 `--start` 才暴露：S1 的原稿已经按错的后缀写下去了。
   * 任一阶段冲突即在入口退 64；code 阶段 `--start` 的自带比对照样保留，这里是提前一道，不是替代。
   * 全程纯只读，「不创建任何目录」的承诺不受影响。
   */
  /** 旗标缺席时继承来的权威值；各阶段都没有留痕与声明则为 null（回落缺省） */
  let inheritedDriver: AgentId | null = null;
  {
    const {
      resolveStageDriver, crossCheckDriver, declaredStageDriver, stageDriverInvariant, claimCommand,
    } = await import('./driver-claim.js');
    const { readTask } = await import('./meta.js');
    const layout = { archiveRoot: ctx.archiveRoot, topic };
    // 放在留痕坏损判定之后再读，与改动前的报错先后一致
    let task: Awaited<ReturnType<typeof readTask>> | undefined;
    const stages: readonly Stage[] = scope === 'all' ? ['plan', 'code'] : [scope];

    /** 旗标缺席时各阶段可继承的权威值（缺省回落不算） */
    const inherited: { stage: Stage; driver: AgentId; source: 'run' | 'claim' }[] = [];
    for (const stage of stages) {
      const resolution = await resolveStageDriver(layout, stage);
      if (resolution.kind === 'corrupt') {
        throw new TriviumError(
          EXIT.GATE_BLOCK,
          `无法判定当轮 Driver：${topic} / ${stage} 的运行留痕读不出来` +
            `（${resolution.unreadable.join('、')}）。\n` +
            '  这里**不**按缺省 Driver 继续，**也不**退回声明——留痕坏了就判不了身份，\n' +
            '  而退到被保护方自己写的声明是把权威排序倒过来用。\n' +
            `  出口是重跑一次 ${stage} 阶段双审：新运行会先落一份可读的留痕。`,
        );
      }
      if (task === undefined) task = await readTask(layout);
      const declared = declaredStageDriver(task, stage);
      const runDriver = resolution.source === 'run' ? resolution.driver : null;
      // 先问「这份留痕本身自洽吗」，再问「你传的对不对」——顺序反了会用一个坏基准去判对错
      const broken = stageDriverInvariant({ topic, stage, runDriver, declared });
      if (broken) throw new TriviumError(EXIT.USAGE, broken);
      const conflict = crossCheckDriver({
        topic, stage, driver: explicitDriver, runDriver, declared,
      });
      if (conflict) throw new TriviumError(EXIT.USAGE, conflict);
      if (resolution.source !== 'default') {
        inherited.push({ stage, driver: resolution.driver, source: resolution.source });
      }
    }

    if (!explicitDriver && inherited.length > 0) {
      const distinct = [...new Set(inherited.map((i) => i.driver))];
      if (distinct.length > 1) {
        /*
         * 只有命令 A 走得到：两个阶段各有权威值且互不相同，省略旗标就没有「该继承谁」的答案。
         *
         * 这时**不存在**与两个阶段都相容的显式取值——显式传哪一个都会撞上另一个阶段（代码双审 GLM-05）。
         * 此前文案叫用户「显式传 --driver」，照做只会再退一次 64。出口只有两条：
         * 改写仅有声明（没有运行留痕）的那个阶段，或另开主题。留痕是事实、改不了，故只对声明给命令。
         */
        const exits = inherited
          .filter((i) => i.source !== 'run')
          .map((i) => {
            const other = inherited.find((o) => o.stage !== i.stage)!.driver;
            return `  改写 ${i.stage} 阶段的声明、按 ${other} 继续：${claimCommand(topic, i.stage, other)}`;
          });
        throw new TriviumError(
          EXIT.USAGE,
          `主题 ${topic} 的 plan 与 code 阶段当轮 Driver 不一致` +
            `（${inherited.map((i) => `${i.stage}：${i.driver}`).join('；')}），省略 --driver 无从继承；` +
            '显式传哪一个都会与另一个阶段冲突——命令 A 一次跑两个阶段，只能有一个执笔者。\n' +
            (exits.length > 0
              ? `${exits.join('\n')}\n  （该阶段若已用声明写出带后缀的文件，改写会被拒，请先处理那些文件。）\n`
              : '') +
            '  或者另开一个主题。',
        );
      }
      inheritedDriver = distinct[0]!;
      for (const i of inherited) {
        notes.push(
          `未传 --driver，已继承 ${i.stage} 阶段的当轮 Driver「${i.driver}」` +
            `（来源：${i.source === 'run' ? '运行留痕' : 'topic claim 的声明'}）`,
        );
      }
    }
  }
  const driver: AgentId = explicitDriver ?? inheritedDriver ?? DEFAULT_DRIVER;

  /*
   * 按**最终**的 driver 再过一次 `resolveDriver`，不是只信旗标那次解析：
   * 继承来的值没经过它，未启用为 Driver 的要在这里退 64（M10a 第 3 步；
   * 此前这里是「放行 + 往 notes 里标注一条」）。
   */
  const enabledAsDriver = resolveDriver(driver).enabledAsDriver;

  const critics = resolveCriticSelection(ctx.config, {
    critics: named['critics'] ?? null,
    only: onlyRaw || null,
    driver,
  });

  const models: Partial<Record<CriticId, string>> = {};
  /*
   * 逐审核者取 `--model-<id>`，不再写死两个旗标名。
   * 旗标名对既有两侧逐字不变（id 即 gemini / glm），第三家启用后自动可用。
   *
   * 白名单的论域是**全部已登记 Agent**，取值的论域是**本轮实际能入选谁**——
   * 两者之差（登记了但本轮当不了审核者，含当轮 Driver 自身）必须当场报错。
   * 不报的话它会落进「解析成功、随后被丢弃」：留痕里看不出用户指定过模型，
   * 而这正是 `--base` 漏传那一族的形状。
   *
   * ## 判据从 `CRITICS` 换成 `selectableCritics` 的理由（EV-53）
   *
   * 原判据是「在不在**启用集合**里」，与当轮 Driver 无关。M9 第 4 步把 claude
   * 启用为审核者之后，`--model-claude X` 从此合法通过——而 `critics.ts` 的
   * 「当轮 Driver 不得入选」恒拒 claude，那个模型覆盖**一路走到被丢弃**，
   * 正是这段注释自己要防的形态，只是触发它的从「未启用的第三家」
   * 变成了「已启用但当不了本轮审核者的 Driver」。
   *
   * 正确判据是「本轮**实际**能入选谁」，而那要等 `--driver` 落地才成为逐次运行的事实。
   * **判据与文案共用同一份派生**：此前文案读 `CRITICS`（含 Driver）而 `legalList`
   * 读减 Driver 的那份，同一条命令里两段「当前可用」会互相矛盾。
   *
   * **判定本身搬去了 `critics.ts`**（第 2 轮 CODEX-05）：`review --start` 也要用同一条，
   * 而把它在这里再实现一遍正是 EV-53 自己的形态——上一次收口只落在本文件一个入口，
   * 另一个入口原样留着丢参数。共用 `assertModelOverrideKeys` 之后，文案也随之与
   * 「不能选 Driver」那几条统一成「当前可用」。
   *
   * **M10b 第 2 步代码双审 CODEX-02 再收紧一档**：判据从「本轮能入选谁」改为「本轮实际入选了谁」
   * （上面刚解析出的 `critics`）。「能入选但没入选」那一家的覆盖同样会被丢弃（原 EV-67）；
   * 缺省集合减去 Driver 之后，它在非 claude Driver 的缺省路径上成了常规形态。
   */
  const written = ALL_AGENT_IDS.filter((id) => named[`model-${id}`]);
  assertModelOverrideKeys(ctx.config, driver, written, critics);
  for (const id of written) models[id] = named[`model-${id}`]!;

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
    subjectPath = await locateSubjectReadOnly(ctx, topic, scope, explicit ?? null, driver);
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
    driver,
    driver_enabled: enabledAsDriver,
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
    // 与 `topic.locateSubject` 同款硬拒：显式路径没有「下一个候选」可退，
    // 静默换成别的就是「解析成功、随后被悄悄替换」那一族缺口
    if (await isReviewArtifact(abs)) {
      throw new TriviumError(
        EXIT.MISSING_ARTIFACT,
        `指定的被审对象是一份**审查件**，不是原稿：${explicit}\n` +
          '  它的 front-matter 是 schema: trivium.review.v1，由编排器从审查员的结构化输出渲染而成。\n' +
          '  拿它当被审对象会让这一轮审的是「对意见的意见」。请指向原稿。',
      );
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

  // 剔掉审查件而非硬拒：理由与 `topic.locateSubject` 同款（换过 Driver 的主题里，
  // 别家当 Driver 时产出的审查件顶着这一家的后缀且日期更晚，会排在真原稿前面）
  const kept: typeof candidates = [];
  const dropped: string[] = [];
  for (const c of candidates) {
    if (await isReviewArtifact(path.join(stageDir, c.fileName))) dropped.push(c.fileName);
    else kept.push(c);
  }

  if (kept.length === 0) {
    const why = dropped.length > 0
      ? `\n  已排除（是审查件而非原稿）：${dropped.join(', ')}`
      : '';
    throw new TriviumError(
      EXIT.MISSING_ARTIFACT,
      `在 ${path.relative(ctx.projectRoot, stageDir)} 下找不到原稿（形如 <日期>-${topic}-${driver}.md）。${why}\n` +
        `  该目录下现有：${entries.length > 0 ? entries.join(', ') : '（空）'}`,
    );
  }
  return path.join(stageDir, kept[0]!.fileName);
}
