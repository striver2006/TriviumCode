/**
 * `guard`：只读失守、漂移、对方产出泄漏、Agent 证据下限的判定（设计 §10.3 / §11.4 / §9.2）。
 *
 * guard 只**判定**，不做中止决策——中止交给 `gate` 与失败策略。
 * 这样「检出」与「处置」分开，处置策略可配而检出逻辑恒定。
 */
import nodePath from 'node:path';
import { promises as fs } from 'node:fs';
import type { Config, CriticId, CriticRequest, CriticResult, DegradedFinding, DenyCategory, EvidenceUntrusted, Review,
  SuspectedWrite,
} from './types.js';
import { describeDriftUnknown, EVIDENCE_UNTRUSTED_CAUSE_TEXT } from './types.js';
import {
  checkEvidence,
  checkPeerLeak,
  checkPeerLeakViaCommand,
  effectiveReadPaths,
  MCP_WRITE_EVENT_PREFIX,
  toProjectRelative,
  TOOL_TRACE_CAPABILITY,
  type TraceCapability,
} from './adapters/base.js';
import { checkReviewIntegrity } from './parse.js';
import {
  judgeDrift,
  driftAction,
  classifyDenyPath,
  isVoidingCategory,
  isOrchestratorReadable,
  type DriftVerdict,
  type Snapshot,
} from './freeze.js';
import { ALL_CLI_NAMES } from './agents/registry.js';
import { expandHome, matchesAnyGlob } from './util/fsx.js';
import { TRIVIUM_DIR } from './config.js';

export interface SideVerdict {
  critic: CriticId;
  evidenceOk: boolean;
  evidenceReasons: string[];
  projectReads: number;
  /** 轨迹中出现写事件 → 审查员失守（比指纹变化更确定） */
  readonlyBreach: boolean;
  breachEvidence: string[];
  /** 轨迹读取路径命中禁读清单，**或**命令原文里出现了禁读条目（措施 b） */
  peerArtifactRead: boolean;
  /** 命中的读取路径（措施 a） */
  peerHits: string[];
  /**
   * 命中的**命令原文**（措施 b，§10.1）。
   *
   * 与 `peerHits` 分开记而不是并进同一个数组：两者的性质不同——
   * 路径命中说明它**读了**那个文件，命令命中说明它**跑了**一条提到那个文件的命令
   * （可能经 git 对象库，文件系统上根本没发生读取）。处置相同，但排查时
   * 要看得出是哪条通道，否则「为什么 deny 生效了还漏」永远查不清。
   */
  peerCommandHits: string[];
  /**
   * 命中的**非作废类**条目（编排器状态目录、凭据文件），以及它们的类别。
   *
   * 与 `peerHits` / `peerCommandHits` 分开记：那两个是「会让这一侧作废」的证据，
   * 这里是「记下来、但不影响结论」的。合并记会让分类白做——
   * 读的人看到一个非空数组，仍然不知道该不该采信这一侧。
   */
  notedCategories: DenyCategory[];
  notedPaths: string[];
  /**
   * 告警档命中的**命令原文**（措施 b）。
   *
   * 与 `notedPaths` 分列，理由同作废类的 `peerHits` / `peerCommandHits`：
   * 路径命中说明它读了那个文件，命令命中说明它跑了一条提到那个文件的命令。
   * 初版漏了这一项，于是 `command-trace` 一族（只有命令通道）的告警档命中
   * 恒无证据——留痕说「命中了」却拿不出任何一条（r1 三侧独立指出）。
   */
  notedCommands: string[];
  /**
   * 命中路径逐条带类（供 `run.json` 的 `peer_leak_via_path` 落盘）。
   *
   * 同一侧一轮内可同时命中多类，处置取最重档而留痕要能复盘每一条各属哪类——
   * 只记一个聚合的类别会把这件事再塌缩一次。
   */
  typedHits: { path: string; category: DenyCategory }[];
  /**
   * 命令通道的命中逐条带类（供 `run.json` 的 `peer_leak_via_command` 落盘）。
   *
   * 与 `typedHits` 同构（r2 代码双审 AGY-04 ≡ GLM-05）：上一版命令通道只落命令原文，
   * 分档结果一个字都没进留痕，于是同一份分档在两条通道上**可读性不对等**——
   * 路径通道能复盘「碰的是哪一档」，命令通道只能看到一行命令。
   * 对 `command-trace` 一族尤其要紧：命令通道是它**唯一**的通道。
   *
   * `path` 是分类实际用的那个目标：命令里那个路径 token（能静态解析时），
   * 否则是禁读条目本身。
   */
  typedCommandHits: { command: string; path: string; category: DenyCategory }[];
  /** consulted 与轨迹交叉核对未通过 */
  consultedUnverified: boolean;
  /** 结构性问题（编号前缀错、重复编号等） */
  integrityIssues: string[];
  /**
   * **疑似**写入：命中写形态但判不实的命令（M8 第 3 步，r9 双审 GLM-05 接线）。
   *
   * 不参与 `readonlyBreach`——它是排查线索，不是判决。
   * 之所以要让它出现在判定结果里而不是只躺在 `trace.json`：
   * 契约注释承诺了「进 doctor 输出」，而**宣称了不存在的消费方**正是
   * EV-06 记的那个形态。要么让宣称成真，要么把宣称改小；这里选前者，
   * 因为这一档的价值恰恰就在「人读排查有入口」。
   */
  suspectedWrites: SuspectedWrite[];
  /**
   * 该侧两条核验通道的可用档位（§11.1，M8 第 2 步）。
   *
   * **三态不得塌缩**：`readonlyBreach: false` 与 `peerHits: []` 各有两个来源——
   * 「核验过、没命中」与「根本没法核验」。这两个档位就是把它们分开。
   * 不记的话，`command-trace` 侧的空数组与「扫过没命中」在留痕里**完全同形**。
   */
  verification: SideVerification;
  /**
   * 模型覆盖是否落实（EV-82）。原样透传 `CriticResult.model_override_applied`——
   * **判据归适配器，本层只播报**：各族的模型 id 形态不同，判定层做统一比较必然误报。
   *
   * 四种情况（`undefined` / `true` / `false` / `null`）的语义见
   * `CriticResult.model_override_applied`。这里只对 `false` 出告警。
   */
  modelOverrideApplied?: boolean | null;
  /**
   * 置首结论（EV-82 第三段 r3 §3.4）：原样透传 `CriticResult.model_override_reorder`，只供 `false` 告警按 `kind` 分句。
   * 缺席即本侧无置首，告警维持原文。
   */
  modelOverrideReorder?: NonNullable<CriticResult['model_override_reorder']>;
  /**
   * 落点自检（EV-112 计划 r3 §4.6）：原样透传 `CriticResult.carriers_landed`。判据归适配器，本层只播报：
   * `log` 或 `rollout` 为 false 时出一句落点缺失；`leaked_to_home` 任一项为 true 时另出一句、点名泄漏的那一类。缺席不出声。
   */
  carriersLanded?: NonNullable<CriticResult['carriers_landed']>;
  /**
   * 没做模型覆盖而实际模型不同（EV-122）：原样透传 `CriticResult.model_unenforced`。判据归适配器，本层只播报，
   * 按结构化 `cause` 给排查指向、不匹配 `reason` 文案。缺席不出声。
   */
  modelUnenforced?: NonNullable<CriticResult['model_unenforced']>;
}

/** 单侧两条核验通道的档位与生效阈值 */
export interface SideVerification {
  /**
   * 「尝试写」检测是否可用。`unavailable` ⟺ `rejectionRecorded === false`。
   *
   * **记的是能力恒态，与本次是否检出写事件无关**（r3 裁决 GLM-06）。
   * 真阳性由 `readonlyBreach` 表达，两者正交：档位为 `unavailable` 的侧
   * 一样可能 `readonlyBreach === true`（写命令成功执行、照常留痕）。
   * 本档位只修饰**阴性结论**的可信度——「没检出写事件」在该侧不足以排除失守。
   */
  readonly: 'ok' | 'unavailable';
  /**
   * 措施 a（读取路径比对 deny）的可用档位。
   *
   * `unavailable` ⟺ `traceShape === 'command-trace'`——该族 `read_paths` 恒空，
   * deny 核验只剩措施 b 一条通道（已知形态必检，非完备，R25）。
   *
   * **`partial`（2026-09-16 新增）**：该侧有结构化轨迹，但「必然带路径」的读调用里
   * 出现了提不出路径的——提取器相对厂商实际参数名已经退化。
   * 补这一档之前，本字段**只看能力声明、不看实际拿到了什么**：
   * 声明为 tool-trace 的侧交出空路径集，档位照样是 `ok`，而 `ok` 承诺的是
   * 「路径核验有效」——那是把「没测到」说成了「测出来没有」。
   */
  path: 'ok' | 'partial' | 'unavailable';
  /**
   * `unavailable` 的**成因**（r2 代码双审 GLM-03 ≡ CODEX-07）。
   *
   * 三种成因的处置完全不同，而上一版把它们压成同一个值，
   * 横幅也只有一句话——读的人无从知道该去修什么：
   *
   * | 成因 | 含义 | 该怎么办 |
   * | :--- | :--- | :--- |
   * | `command-trace` | 该族结构性无信号，`read_paths` 恒空 | 没法修，deny 核验只剩措施 b |
   * | `no-counts` | 该侧没报计数（旧留痕，或适配器没采集） | 修适配器 |
   * | `no-path-bearing-calls` | 本轮一次「必带路径」的读调用都没有 | 不是缺陷，探测面为零而已 |
   *
   * 只在 `path === 'unavailable'` 时有值。
   */
  pathCause?: 'command-trace' | 'no-counts' | 'no-path-bearing-calls';
  /** 本次生效的项目读取下限（`command-trace` 族折减后的值） */
  evidenceThreshold: number;
  /**
   * 证据不可信（EV-188）：本侧有经编排器看不见的通道完成的调用（今天只有名单外的 MCP 调用，`cause: 'mcp-call'`）。
   * **只在成立时出现**（结构上缺席，不是 `undefined` 值）。
   *
   * 结论保留、不作废、不判失守——与 `readonlyBreach`（确诊）正交。它修饰的是**阴性结论**：「措施 a / b 没命中」
   * 「轨迹无写事件」在本侧不再足以说明没读禁读面、没写、没出网。所以它与 `readonly: 'unavailable'` 一样参与漂移归因
   * 分流（`judgeRun`，计划双审 AGY-01），并走降级档位的五面留痕；不进闸门、不升格、不塌缩成无事。
   */
  untrusted?: EvidenceUntrusted;
}

/**
 * consulted 交叉核对的匹配集（§11.4）。导出是为了让用例能断言**集合本身**而不只是布尔位：
 * 阈值 80% 下 15 项漏 3 项照样绿，只锁布尔锁不住 15/15（计划双审 CODEX-02 ≡ AGY-01 ≡ GLM-02）。
 *
 * 两边都经 `toProjectRelative` 归一（realpath 别名、`./`、绝对/相对写法，CODEX-07）；
 * consulted 里项目外的条目算 `missing`（它本来就不该出现在那里）。
 */
export function matchConsulted(
  consulted: readonly string[],
  tracePaths: readonly string[],
  roots: readonly string[],
): { matched: string[]; missing: string[] } {
  const traceSet = new Set<string>();
  for (const p of tracePaths) {
    const rel = toProjectRelative(p, roots);
    if (rel !== null) traceSet.add(rel);
  }
  const matched: string[] = [];
  const missing: string[] = [];
  for (const c of consulted) {
    const rel = toProjectRelative(c, roots);
    (rel !== null && traceSet.has(rel) ? matched : missing).push(c);
  }
  return { matched, missing };
}

/**
 * 单侧判定。
 *
 * `consulted` 交叉核对的阈值是 80%（§11.4）：允许少量路径写法差异，
 * 但大面积对不上就说明是编造的。匹配集本身由上面的 `matchConsulted` 算。
 */
export function judgeSide(
  cfg: Config,
  critic: CriticId,
  result: CriticResult,
  review: Review | null,
  req: CriticRequest,
  opts: {
    archiveRootAbs: string;
    projectRoot: string;
    /**
     * consulted 归一化用的根别名：`[projectRoot, realpath(projectRoot)]`。
     * 由 `judgeRun` 算一次传下来（realpath 是 I/O，本函数保持同步纯函数）；
     * 缺省 `[projectRoot]`——单测用合成根时走这条，行为与传 realpath 失败时相同。
     */
    projectRoots?: readonly string[];
    /** 编排器状态目录的绝对路径——分类与具名放行都要它（设计 §10.1.1） */
    triviumDir: string;
    /** 运行根的绝对路径。那是混合树，己方材料与对端输出都在里面 */
    runRoot: string;
    capability?: TraceCapability;
    /**
     * 本侧逐条降级的意见（设计 §6.5）。**必填**：完整性告警（撞号、「零意见未说明」、evidence 未列入
     * consulted）要按「合格 ∪ 降级」判——漏传时全部降级的一侧会被误报成「零意见」，合格与降级撞号也不再有人报。
     */
    degraded: readonly DegradedFinding[];
  },
): SideVerdict {
  /*
   * 未传能力声明时按结构化轨迹处理——那是本步之前的唯一形态，行为逐字等价。
   * 这**不是**「默认放行」：`command-trace` 的侧由适配器显式声明，
   * 漏传会让该侧按 tool-trace 判（证据恒不达标），响亮失败而非静默放行。
   */
  const cap = opts.capability ?? TOOL_TRACE_CAPABILITY;

  const ev = checkEvidence(result, req, { archiveRootAbs: opts.archiveRootAbs, capability: cap });

  /*
   * ── 分类作用在**命中**上，不是在 deny 条目上（设计 §10.1.1）──
   *
   * 禁读集由四类性质完全不同的对象拼成，而它们曾共用一个布尔位与一句
   * 「该侧结论作废」。四次实测命中**全部落在编排器状态目录那一类**——
   * 审查员读了自己的护栏配置或列了目录，与背靠背独立性毫无关系。
   *
   * ## 为什么必须按命中判，而不是先把条目分组
   *
   * 初版（2026-09-16）是「按条目预分组，再把各组分别喂给两条通道」，
   * 三侧代码双审独立判为阻断：**禁读集对这两棵树只有整棵目录条目**
   * （`enumerateDenyPaths` 加的是裸目录），而条目自身在分类器里落到兜底最重档，
   * 于是整棵进作废集合、前缀匹配下读任何子文件都作废——
   * **分档、放行、己方豁免三项一次都不生效，要修的误伤逐字保留**。
   *
   * 根因不只是那个空串判据：**目录条目表达不了「整棵禁、其中几个放行」**。
   * 设计 §10.1.1 的原话就是「两条通道都实现**匹配时豁免**」——
   * 即先按全集匹配、再对每条命中判类与放行。现在照它做。
   *
   * 代价是两条通道各自要过一遍分类，但那是 O(命中数)，而命中通常是 0。
   */
  const denyCtx = {
    projectRoot: opts.projectRoot,
    triviumDir: opts.triviumDir,
    runRoot: opts.runRoot,
    critic,
    sensitiveGlobs: cfg.review.sensitive_globs,
  };
  /**
   * 一条命中该怎么处置：放行 → 丢弃（返回 `null`）；作废类 → 计入作废；其余 → 记告警。
   *
   * **己方运行材料与具名放行同处置——整个不算命中**（r2 代码双审 GLM-04 ≡ CODEX-05）。
   * 上一版把它留在告警档里「记一笔」，理由是「记下来无害」。那个理由不成立：
   * 审查员读自己这一侧的 `request.json` 是**编排器要求它做的事**，
   * 把必经动作记成「碰了禁读集」，留痕上与真实泄漏同形，读的人分不出哪条要紧——
   * 告警档一旦被常态噪声填满，它就不再是告警。设计 §10.1.1 给 `own-run-material`
   * 的定性是「②′ 己方材料」，与「不得读」平级的是**对端**那两类。
   */
  const dispose = (hit: string): { category: DenyCategory; voiding: boolean } | null => {
    if (isOrchestratorReadable(hit, opts)) return null;
    const category = classifyDenyPath(hit, denyCtx);
    if (category === 'own-run-material') return null;
    return { category, voiding: isVoidingCategory(category) };
  };

  /*
   * 措施 a **只吃真实读取事实（`read_paths` 与 `search_hit_paths`），不吃回填**（r2/r3 双审两侧均确认；
   * `search_hit_paths` 是 EV-76 出路 ① 加进来的，见下一段）：
   * 回填路径的语义是「跑了一条提到该文件的命令」，不等于「读到了该文件」。
   * 命令通道由下面的措施 b 承担，两条分列才看得出泄漏走的是哪条。
   *
   * 按**全集**匹配，分类在命中之后做——见上面的说明。
   */
  /*
   * 措施 a 吃两份**真实读取**事实：结构化读取路径，以及搜索工具 `content` 输出里命中的文件
   * （`search_hit_paths`，EV-76 出路 ①）。后者的文本与 Read 同样进入模型上下文；探针实测
   * CLI 路径级 deny 对 Grep 不生效（§3.7），事后核验是那条通道唯一的兜底。
   * **这是新规则**（设计 §10.1 2026-09-19 起），不是「既有承诺生效」：此前承诺只覆盖 Grep 的
   * `path` 入参。`files_with_matches` / `count` 只披露存在性、与 Glob 同档，不进这里。
   * 与 codex 侧 EV-16 的不对称：那边命令输出在 trace.json 里但**未做命中解析**（未采集），这边解析了——
   * 差在采集，不是规则矛盾。
   *
   * **两条判定线共用一份归一化**（代码双审 CODEX-02 ≡ GLM-02）：`checkPeerLeak` 内部只按字面
   * `projectRoot` 归一（抹 `/private`，无 realpath），而 Grep 命中以 `init.cwd`（物理路径）为基准——
   * 符号链接根下 deny 条目是逻辑形态、命中是物理形态，恒不命中。所以先经 `toProjectRelative`
   * 用 `projectRoots` 别名把落在项目内的路径折成**项目相对**形态再送入（由它按字面根解析回逻辑形态）；
   * 项目外的（运行根等）保留原样。`read_paths` 同样处理，不只改新通道。
   */
  const roots = opts.projectRoots ?? [opts.projectRoot];
  const toLogicalForm = (ps: readonly string[]): string[] =>
    ps.map((p) => {
      const rel = toProjectRelative(p, roots);
      return rel === null || rel === '.' ? p : rel;
    });
  const peerRaw = checkPeerLeak(
    toLogicalForm([...result.read_paths, ...(result.search_hit_paths ?? [])]),
    req.deny_paths,
    opts.projectRoot,
  );
  /*
   * 措施 b（§10.1 / EV-01）：命令原文的字面扫描。
   *
   * 与措施 a **同等处置**——两者任一命中即该侧作废。不设权重也不设开关：
   * **§18.1 #21** 的默认值就是不提供 `hard|warn|off` 开关，理由是**开关会引入
   * 「绕过检测」的合法路径**——这条理由独立成立，是拒绝开关的全部依据。
   *
   * > 初版这里写的是「§18.1 **#8**」（那是闸门期写锁的作用域，引错了），
   * > 并接了一句「确需收窄 git 通道时裁 `readonly_commands` 已是更强的旋钮」——
   * > 而**同一个补丁**刚以「拿一个不存在、且已决定不用的机制当拒绝理由，
   * > 是把论证建在空处」为由把那句话从 §18.1 #21 删掉。一面删、一面写进新注释。
   * > 该旋钮无消费方（BACKLOG **EV-15**），且已拍板不收窄（**EV-16**）。
   * > （2026-10-01：该键已删除，EV-15 结案。）
   */

  /*
   * ── 逐条命中分流：作废 / 记一笔 / 放行 ──
   *
   * 路径通道的命中是**路径**，直接判类。
   * 命令通道的命中是**命令原文**，判不了类——一条命令可能提到多个条目。
   * 对它的处置见下面 `cmdDisposition` 的说明。
   */
  const typedHits: { path: string; category: DenyCategory }[] = [];
  const peerHits: string[] = [];
  const notedPaths: string[] = [];
  const notedCategories: DenyCategory[] = [];

  for (const hit of peerRaw.hits) {
    const d = dispose(hit);
    if (!d) continue; // 具名放行：当没命中
    typedHits.push({ path: hit, category: d.category });
    if (d.voiding) peerHits.push(hit);
    else {
      notedPaths.push(hit);
      if (!notedCategories.includes(d.category)) notedCategories.push(d.category);
    }
  }

  /*
   * 命令通道：**与路径通道同一个谓词**（r2 代码双审 AGY-01 ≡ GLM-01 ≡ CODEX-01，阻断）。
   *
   * 匹配层现在给出每条命中命令撞上的条目，以及命令里那个路径 token 归一后的绝对路径。
   * 分类喂给它的是 `resolved`（碰的是哪个文件），只有静态解析不了时才退回 `entry`
   * （碰的是哪棵树）——后者必然落在更重的档上，是保守方向。
   *
   * 上一版走的是另一条路：把作废类条目挑出来单独再扫一遍，扫中算作废。
   * 那个做法**对条目分类、不对命中分类**，与路径通道不是同一件事——
   * 整棵运行根在路径通道里按命中的子文件分档（己方材料放行），
   * 在命令通道里按根自己分档（一律对端输出、一律作废）。同一次泄漏、两条通道、
   * 相反结论，而两条通道本就是同一判定的两个观察面。
   *
   * 这一步不能省（r1 CODEX-03）：命令通道是 `command-trace` 一族的**唯一**通道，
   * 省掉它等于对那一族完全不做禁读核验；而把命令命中一律当作废，
   * 又会让「一次目录列举」重新把该侧判掉——那正是四次误伤里的两次形态。
   */
  const cmdRaw = checkPeerLeakViaCommand(result.command_texts, req.deny_paths, opts.projectRoot);
  const cmdVoidingHits: string[] = [];
  const cmdNotedHits: string[] = [];
  /** 命令通道的命中明细：哪条命令、碰了哪个条目、判在哪一档 */
  const cmdTypedHits: { command: string; path: string; category: DenyCategory }[] = [];

  for (const m of cmdRaw.matches) {
    const typed: DenyCategory[] = [];
    for (const h of m.hits) {
      const target = h.resolved ?? h.entry;
      const d = dispose(target);
      if (!d) continue; // 具名放行 / 己方材料：当没命中
      typed.push(d.category);
      cmdTypedHits.push({ command: m.command, path: target, category: d.category });
    }
    if (typed.length === 0) continue;
    /*
     * 一条命令可以同时撞上多个条目（`diff <己方材料> <对端产出>`），
     * 按**最重档**处置那条命令：有一个作废类就作废。
     */
    if (typed.some((c) => isVoidingCategory(c))) cmdVoidingHits.push(m.command);
    else {
      cmdNotedHits.push(m.command);
      /*
       * 命令通道的告警档命中也要落明细（r1 AGY-05 ≡ GLM-06 ≡ CODEX-03）。
       * 初版只收路径通道的 hits，于是 `command-trace` 一族——它**只有**命令通道——
       * 的告警档命中恒无证据：留痕说「命中了、属告警档」，一条证据都拿不出来。
       */
      for (const c of typed) if (!notedCategories.includes(c)) notedCategories.push(c);
    }
  }
  const cmdVoiding = { leaked: cmdVoidingHits.length > 0, hits: cmdVoidingHits };
  const notedCommands = cmdNotedHits;

  /*
   * 轨迹里出现写事件 = 审查员失守（§10.3 末段）。
   *
   * **两档一律成立，与 `rejectionRecorded` 无关。** M6 的 P-C2 只断言
   * 「被沙箱拒绝的命令不产生事件」；成功执行的命令照常留痕（P-C1 的样本本身
   * 就是 `status:"completed"`、`exit_code:0` 的 `command_execution`）。
   * 所以沙箱一旦失守、写命令真的跑成了，那是**正向确凿证据**，必须判失守——
   * 把它压成 false 会让失守信号凭空消失，还会让下面的漂移判定把审查员的写入
   * 归因成开发者手改（方向正好反）。
   *
   * `rejectionRecorded === false` 影响的只有**阴性结论**：没检出写事件时，
   * 不足以排除「尝试过写但被拒、没留痕」，该侧只读保障从三重降到两重。
   * 这一层由 `verification.readonly` 档位表达，不动本判定。
   */
  const readonlyBreach = result.write_events.length > 0;

  // consulted 与轨迹交叉核对——吃回填后的有效路径 ∪ 搜索命中，两边都过同一份归一化
  let consultedUnverified = false;
  const consulted = review?.consulted ?? [];
  if (consulted.length > 0) {
    const { matched } = matchConsulted(
      consulted,
      [...effectiveReadPaths(result, cap, opts.projectRoot), ...(result.search_hit_paths ?? [])],
      opts.projectRoots ?? [opts.projectRoot],
    );
    consultedUnverified = matched.length / consulted.length < 0.8;
  } else if (review !== null) {
    // 结构化成功但没填 consulted，无法核对
    consultedUnverified = true;
  }

  const integrityIssues: string[] = [];
  if (review) {
    const i = checkReviewIntegrity(review, critic, opts.degraded);
    if (!i.prefixOk) integrityIssues.push(`编号前缀不属于本侧：${i.badIds.join(', ')}`);
    if (i.duplicateIds.length > 0) integrityIssues.push(`编号重复：${i.duplicateIds.join(', ')}`);
    if (i.evidenceNotInConsulted.length > 0) {
      integrityIssues.push(`evidence 引用但未列入 consulted：${i.evidenceNotInConsulted.join(', ')}`);
    }
    if (i.emptyWithoutExplanation) integrityIssues.push('零意见但未说明检查了什么');
  }

  void cfg;
  return {
    critic,
    evidenceOk: ev.ok,
    evidenceReasons: ev.reasons,
    projectReads: ev.projectReads,
    readonlyBreach,
    breachEvidence: result.write_events,
    /*
     * **只有作废类的命中才置真**（r1 三侧阻断）。
     * 初版用两条通道的原始 leaked 做或运算，于是告警档命中一样让该侧作废——
     * 分档等于没做。现在它等价于「过滤掉放行与告警档之后还剩命中」。
     */
    peerArtifactRead: peerHits.length > 0 || cmdVoiding.hits.length > 0,
    peerHits,
    peerCommandHits: cmdVoiding.hits,
    notedCategories,
    notedPaths: [...new Set(notedPaths)],
    notedCommands,
    typedHits,
    typedCommandHits: cmdTypedHits,
    consultedUnverified,
    integrityIssues,
    suspectedWrites: [...(result.suspected_write_events ?? [])],
    verification: (() => {
      const pv = pathVerificationTier(result, cap);
      const untrustedTools = [...new Set(result.mcp_untrusted_tools ?? [])].sort();
      return {
        readonly: cap.rejectionRecorded ? 'ok' : 'unavailable',
        path: pv.tier,
        ...(pv.cause ? { pathCause: pv.cause } : {}),
        evidenceThreshold: ev.minProjectReads,
        ...(untrustedTools.length > 0 ? { untrusted: { cause: 'mcp-call' as const, tools: untrustedTools } } : {}),
      };
    })(),
    // 字段缺席（本次无覆盖尝试）与三态一并原样透传，本层不做归一（EV-82）
    ...(result.model_override_applied === undefined
      ? {}
      : { modelOverrideApplied: result.model_override_applied }),
    ...(result.model_override_reorder === undefined ? {} : { modelOverrideReorder: result.model_override_reorder }),
    ...(result.carriers_landed === undefined ? {} : { carriersLanded: result.carriers_landed }),
    ...(result.model_unenforced === undefined ? {} : { modelUnenforced: result.model_unenforced }),
  };
}

/**
 * 路径核验的档位（设计 §10.1.1 第②层）。
 *
 * ## 为什么不能只看能力声明
 *
 * 原先这一行是 `cap.traceShape === 'command-trace' ? 'unavailable' : 'ok'`——
 * **只看该侧声明了什么，不看本次实际拿到了什么**。声明为 `tool-trace` 的侧
 * 只要交出空的或残缺的路径集，档位照样是 `ok`，而 `ok` 承诺的是「路径核验有效」。
 *
 * ## 分母按工具分两档
 *
 * 「必然带路径」的读调用（文件读类）提不出路径 = 提取器相对厂商实际参数名**已经退化**，
 * 这就是改名探测器，近零假阳；而搜索 / 列目录类**允许**无路径——不带目录的搜索是
 * 合法形态，无路径即无读取事实，把它们计进分母会让 `partial` 变成稳态噪声。
 *
 * ## 它防得住什么、防不住什么
 *
 * 防得住**参数改名**（工具名不变、`tool-trace` 族）：下一轮当场可见。
 * 防不住**工具改名或新增读工具**——那时分母自己缩小、提取率仍是 100%，
 * 盲区只是从「提不出路径」搬到「这条调用没被算进读类」。那一层要靠探针臂，
 * 已登记待排。`command-trace` 族结构性无信号，恒 `unavailable`。
 */
function pathVerificationTier(
  result: CriticResult,
  cap: TraceCapability,
): { tier: 'ok' | 'partial' | 'unavailable'; cause?: SideVerification['pathCause'] } {
  if (cap.traceShape === 'command-trace') {
    return { tier: 'unavailable', cause: 'command-trace' };
  }
  const total = result.path_bearing_reads;
  const withPath = result.path_bearing_reads_with_path;

  /*
   * **该侧没报这两个计数 → `unavailable`，不是 `ok`**（r1 三侧独立指出）。
   *
   * 初版这里 `return 'ok'`，而同一行的注释写的是「不知道就别说『有效』」——
   * 注释与实现直接相反，等于拿 `ok` 填「不知道」。而 `ok` 在 run.v2 的语义是
   * 「路径核验有效」：没有任何输入支撑的「有效」，正是本主题一路在修的三态塌缩
   * （「没测到」被说成「测出来没有」）。
   *
   * 这一支现在只剩旧留痕会走到——两家结构化轨迹的适配器都已对称采集。
   */
  /*
   * `== null` **同时盖住 `undefined` 与 `null`**：前者是「该族没有这个概念，
   * 或留痕早于本字段」，后者是「本族有、这次没采到」（zcode 读不到 rollout）。
   * 两者的成因表述不同（契约见 `CriticResult`），但判定相同——都是「没测」。
   */
  if (total == null || withPath == null) {
    return { tier: 'unavailable', cause: 'no-counts' };
  }

  /*
   * 分母为 0（本轮没有「必带路径」的调用）同样记 `unavailable`。
   *
   * 「一次都没调用过那类工具」与「调用了且全部提出了路径」是两件事，
   * 而只有后者才配叫「核验有效」。初版把前者也记 `ok`，于是**纯搜索轮次**
   * （一次文件读都没有）看起来核验通过，实际探测面为零。
   */
  if (total === 0) return { tier: 'unavailable', cause: 'no-path-bearing-calls' };

  return { tier: withPath < total ? 'partial' : 'ok' };
}

export interface RunVerdict {
  sides: Partial<Record<CriticId, SideVerdict>>;
  drift: DriftVerdict;
  driftAction: 'ok' | 'warn' | 'fail';
  /**
   * 指纹变化但轨迹无写事件 → 开发者手改，按漂移处置而非失守（§9.2 第 4 步）。
   *
   * **这个归因只对 `verification.readonly === 'ok'` 的侧成立。** 前提是
   * 「轨迹无写事件」能证明「审查员没写」——而对 `rejectionRecorded=false` 的侧，
   * 无写事件**不能**排除审查员写过（被拒的不留痕）。那种情形下文件落进
   * `unattributedDriftFiles`，不得记到开发者头上。
   */
  fingerprintChangedFiles: string[];
  /**
   * 指纹变化、但本轮有侧的只读核验不可用 ⇒ **无法归因**（§11.1，M8 第 2 步）。
   *
   * 既不判审查员失守（没有正向证据），也不判开发者手改（阴性证据不可信）。
   * 单列而不是并进 `fingerprintChangedFiles`：后者是一个**已归因**的结论，
   * 把不可归因的混进去，等于用一个更强的断言掩盖证据的缺口。
   */
  unattributedDriftFiles: string[];
  /**
   * 本轮「无法归因」的成因（EV-188 计划双审 AGY-01）：能力恒态（有侧 `rejectionRecorded === false`）、证据不可信
   * （有判过的侧 `verification.untrusted`）、MCP 执行型调用（有判过的侧写事件含 `MCP:` 条目），可同时成立。
   * 只在 `unattributedDriftFiles` 非空时出现，只供告警按成因分句；可选是为了不动既有的字面构造，缺席按第一种说。
   */
  unattributedCauses?: ('readonly-unavailable' | 'evidence-untrusted' | 'mcp-exec')[];
  readonlyBreach: boolean;
  breachedFiles: string[];
  peerArtifactRead: boolean;
}

export interface JudgeRunInput {
  cfg: Config;
  projectRoot: string;
  archiveRootAbs: string;
  /** 归档根的项目相对路径，漂移判定要整体排除它 */
  archiveRootRel: string;
  /** `.trivium/` 的项目相对路径，同样排除；缺省 `.trivium` */
  triviumDirRel?: string;
  before: Snapshot;
  afterTreeHash: string;
  afterSubjectSha256: string;
  relatedPaths: string[];
  results: Partial<Record<CriticId, CriticResult>>;
  reviews: Partial<Record<CriticId, Review | null>>;
  /**
   * 逐侧逐条降级的意见（设计 §6.5）。**必填**，理由同 `judgeSide` 的同名字段；
   * 某侧缺键按 `[]`（该侧没有降级意见，或根本没解析成功）。
   */
  degraded: Partial<Record<CriticId, readonly DegradedFinding[]>>;
  requests: Partial<Record<CriticId, CriticRequest>>;
  /**
   * 逐侧的轨迹能力声明，取自适配器表（`ctx.adapters[critic].capability`）。
   *
   * **必须由调用方透传**：能力的唯一起源是适配器，`judgeRun` 自己取不到。
   * 缺某一侧时该侧按 `tool-trace` 判——对结构化轨迹两家是正确默认，
   * 对 `command-trace` 侧则会因证据恒不达标而响亮失败，不会静默放行。
   */
  capabilities?: Partial<Record<CriticId, TraceCapability>>;
}

/** 整次运行的判定 */
export async function judgeRun(input: JudgeRunInput): Promise<RunVerdict> {
  const { cfg, results, reviews, requests } = input;

  /*
   * 全部已探 CLI 的 scratch 白名单并集：这一步不能省，否则会把 Agent 自己的
   * 会话缓存误判成「只读失守」（M0 实测本机两侧均为空，但别的机器上未必）。
   *
   * 遍历而不是写死两段（原文是 `[...cfg.probe.agy.scratch_paths, ...cfg.probe.zcode.scratch_paths]`）：
   * 探针段 Partial 化之后那种写法在 `noUncheckedIndexedAccess` 下直接编译不过，
   * 而若图省事强转，缺段时会变成运行期 TypeError——这是 guard 这条只读护栏的路径，
   * 不能靠强转糊过去（审查意见 AGY-03）。取并集也天然对第三家成立。
   *
   * 按 `ALL_CLI_NAMES` 取键，**不按盘上实有键**（审查意见 GLM-08）：
   * `Object.values(cfg.probe.cli)` 会把未登记的键也算进来，于是一个没人登记的段
   * 能往只读失守的白名单里塞 glob——而 `preflight` / `doctor` 都按注册表遍历、
   * 根本看不见它。`schemas.ts` 已补了「probe.cli 键 ⊆ 已登记 CLI」的校验把关，
   * 这里同口径是第二道：即使有人直接改盘绕过校验，影响面也不会扩大。
   */
  const scratchGlobs = ALL_CLI_NAMES.flatMap((n) => cfg.probe.cli[n]?.scratch_paths ?? []);

  const drift = await judgeDrift({
    cfg,
    projectRoot: input.projectRoot,
    before: input.before,
    afterTreeHash: input.afterTreeHash,
    afterSubjectSha256: input.afterSubjectSha256,
    relatedPaths: input.relatedPaths,
    scratchGlobs,
    archiveRootRel: input.archiveRootRel,
    ...(input.triviumDirRel ? { triviumDirRel: input.triviumDirRel } : {}),
  });

  /*
   * consulted 归一化的根别名：realpath 取不到（合成根、ENOENT）就只用 projectRoot，
   * 与 `judgeSide` 缺省一致；取到了也不替换 projectRoot，只多一个别名。
   */
  let projectRoots: readonly string[] = [input.projectRoot];
  try {
    const real = await fs.realpath(input.projectRoot);
    if (real !== input.projectRoot) projectRoots = [input.projectRoot, real];
  } catch {
    /* 合成根或不可解析：只按字面根归一 */
  }

  const sides: Partial<Record<CriticId, SideVerdict>> = {};
  for (const c of Object.keys(results) as CriticId[]) {
    const r = results[c];
    const q = requests[c];
    if (!r || !q) continue;
    /*
     * 已经失败或超时的一侧不再评判证据。
     *
     * 一个超时被 SIGTERM 掉的进程当然「零工具调用、零项目文件读取」——
     * 再报一遍「证据不足」只会把真正的原因（超时）埋在噪音里。
     * 真实运行中就出现过这种误导：glm 侧 900s 超时，人读输出却说它证据不足。
     * 失败原因由 runner 的 fail_reason 与 decideMode 的 degraded_reason 负责。
     */
    if (r.status === 'timeout' || r.status === 'failed') continue;
    const cap = input.capabilities?.[c];
    sides[c] = judgeSide(cfg, c, r, reviews[c] ?? null, q, {
      archiveRootAbs: input.archiveRootAbs,
      projectRoot: input.projectRoot,
      projectRoots,
      /*
       * 分类与具名放行要这两个根（设计 §10.1.1）。
       * `triviumDirRel` 是可选的（旧调用没传），缺省按约定目录名拼——
       * 拼错的后果是那一类命中被归成「对端产物」而判作废，方向保守。
       */
      triviumDir: nodePath.resolve(input.projectRoot, input.triviumDirRel ?? TRIVIUM_DIR),
      runRoot: expandHome(cfg.runtime.run_root),
      ...(cap ? { capability: cap } : {}),
      degraded: input.degraded[c] ?? [],
    });
  }

  const breachedFiles = Object.values(sides).flatMap((s) => s?.breachEvidence ?? []);
  const fingerprintChangedFiles =
    drift.kind === 'related' || drift.kind === 'unrelated' ? drift.files : [];
  const changed = fingerprintChangedFiles.filter((f) => !matchesAnyGlob(f, scratchGlobs));

  /*
   * 归因分流（§9.2 第 4 步 + §11.1）。
   *
   * 「指纹变了但轨迹无写事件 ⇒ 开发者手改」这条推理的前提是**轨迹能证明审查员没写**。
   * 对 `readonly: 'unavailable'` 的侧（`rejectionRecorded=false`）这个前提不成立：
   * 被拒的写不留痕，无写事件排除不了审查员写过。只要本轮有任一侧处于该档位，
   * 变更文件就落进 `unattributedDriftFiles` 而不是被记成开发者手改——
   * 否则审查员的失守会被安到开发者头上，方向正好反。
   *
   * 取「任一侧」而不是逐侧分配：指纹是**整个工作树**的快照，看不出是哪一侧改的。
   * 有一侧不可归因，这批文件的归因就不可靠。
   *
   * **判据取 `input.capabilities` 而不是 `sides`**（r6 双审 AGY-02）：
   * `sides` 只含成功侧——超时/失败的一侧在上面的循环里被 `continue` 跳过。
   * 而能力是**静态声明**，与该侧这次跑没跑成无关。按 `sides` 算会有一个很坏的性质：
   * **不可用侧崩得越彻底，归因越「自信」**——它一超时就不进 `sides`，
   * `anyReadonlyUnavailable` 变 false，于是漂移被记成开发者手改。
   */
  const anyReadonlyUnavailable = Object.values(input.capabilities ?? {}).some(
    (c) => c?.rejectionRecorded === false,
  );
  /*
   * 另外两种成因同样让「无写事件 ⇒ 开发者手改」的前提不成立（EV-188）：
   * - 证据不可信（计划双审 AGY-01）：有侧调了名单外的 MCP 工具，经它的写入不在轨迹里；
   * - MCP 执行型调用（已判失守）：它能写任意文件，而写事件里只有代码摘要、没有路径，扣不出是哪些文件——
   *   不并进来的话，同轮的工作树变动会被记成开发者手改（计划 r2 只写了前一种，这一种是编码时补的同族格，报告记偏离）。
   * 这两种是**运行期事实**，只能取判过的侧（`sides`）；失败 / 超时的侧轨迹没解析、调没调过无从得知，与既有「失败侧不评判证据」同口径。
   */
  const anyEvidenceUntrusted = Object.values(sides).some((s) => s?.verification.untrusted !== undefined);
  const anyMcpExec = Object.values(sides).some((s) => s?.breachEvidence.some((e) => e.startsWith(MCP_WRITE_EVENT_PREFIX)));
  const unattributedCauses: NonNullable<RunVerdict['unattributedCauses']> = [
    ...(anyReadonlyUnavailable ? (['readonly-unavailable'] as const) : []),
    ...(anyEvidenceUntrusted ? (['evidence-untrusted'] as const) : []),
    ...(anyMcpExec ? (['mcp-exec'] as const) : []),
  ];
  const cannotAttribute = unattributedCauses.length > 0;

  /*
   * 已确诊失守的文件不进「无法归因」桶：那批有**正向证据**，
   * 与「既无正向证据也不能排除」的语义相反。不扣除的话，
   * 运行时会同屏打出「只读失守：轨迹中出现了写事件」与「无法归因：无正向证据」两条。
   *
   * ## 判据是**路径解析后的相等比对**，不是子串包含
   *
   * 两侧都提过三次才收敛到这里，把失败的路子记下来：
   *
   * - **裸 `includes`**（r6 实现）：`write_to_file(/proj/src/metadata.ts)` 对
   *   `data.ts` 判真——无边界子串，不相干文件被误扣。
   * - **只加左边界 `/${f}`**（r7 实现）：挡住了上一族，但**斜杠对齐的后缀分量**
   *   与**右端开放**两族还在——`/proj/sub/README.md` 对根 `README.md` 判真、
   *   `/proj/src/a.ts.bak` 对 `src/a.ts` 判真（r8 双审 GLM-01 ≡ AGY-03，实测复现）。
   *   r7 应答件写的「这一条就能杀掉尾段子串误扣」**只对无边界族成立**。
   *
   * 所以回到 r6 应答件的原案：**从 `toolName(...)` 形态剥出路径、归一后做相等比对**。
   * 子串匹配无论怎么补边界都是在猜路径的边在哪，而括号里的内容本来就是完整路径。
   *
   * **已知限制（漏扣方向，保守可接受）**：剥不出路径的形态——agy 侧拿不到 `path`
   * 时用 `JSON.stringify(parameters).slice(0, 80)` 填充、被截断的长路径，
   * 以及不带括号的自定义事件串——一律**留在原桶**。
   * 宁可多报一个「无法归因」，也不要把有证据的漂移悄悄归掉。
   */
  const breachedAbs = new Set(
    [...new Set(breachedFiles)].flatMap((ev) => {
      // MCP 执行型条目（EV-188）括号里是代码摘要不是路径，不参与扣除——将来摘要形态变了、恰好像个路径时也不会错扣
      if (ev.startsWith(MCP_WRITE_EVENT_PREFIX)) return [];
      // `toolName(<path>)`：取最后一对括号内的内容，避免路径自身含括号时被切断
      const open = ev.indexOf('(');
      const close = ev.lastIndexOf(')');
      if (open < 0 || close <= open) return [];
      const inner = ev.slice(open + 1, close).trim();
      if (inner.length === 0) return [];
      return [nodePath.resolve(input.projectRoot, inner)];
    }),
  );
  const attributedToBreach = (f: string): boolean =>
    breachedAbs.has(nodePath.resolve(input.projectRoot, f));

  const unattributed = cannotAttribute ? changed.filter((f) => !attributedToBreach(f)) : [];

  return {
    sides,
    drift,
    driftAction: driftAction(cfg, drift),
    fingerprintChangedFiles: cannotAttribute ? [] : changed,
    unattributedDriftFiles: unattributed,
    ...(unattributed.length > 0 ? { unattributedCauses } : {}),
    readonlyBreach: Object.values(sides).some((s) => s?.readonlyBreach === true),
    breachedFiles: [...new Set(breachedFiles)],
    peerArtifactRead: Object.values(sides).some((s) => s?.peerArtifactRead === true),
  };
}

/** 人读告警文本（命令输出用）。**绝不自动 git checkout 回滚**（§10.3） */
export function renderGuardWarnings(v: RunVerdict): string[] {
  const out: string[] = [];

  if (v.readonlyBreach) {
    out.push(
      '只读失守：审查员的工具轨迹中出现了写事件。受影响的调用：\n' +
        v.breachedFiles.map((f) => `    ${f}`).join('\n') +
        '\n  编排器**不会**自动回滚。建议人工核对：\n' +
        '    git status --porcelain -uall\n' +
        '    git diff\n' +
        '  确认无误后再决定是否 `git checkout --` 相关文件。',
    );
    /*
     * MCP 通道的补句（EV-188 决策五）：`MCP:` 条目括号里是代码摘要不是文件路径——它能写任意文件，
     * 上面的「受影响的调用」列不出写了哪些，核对时不能只看这几行。
     */
    if (v.breachedFiles.some((f) => f.startsWith(MCP_WRITE_EVENT_PREFIX))) {
      out.push(
        '  其中 `MCP:` 开头的是 MCP 执行型工具调用：它能执行任意代码，读写与出网都不在核验面，按只读失守处置；' +
          '括号里是代码摘要（已脱敏、截断）不是文件路径，它写了哪些文件从轨迹里列不出来，以工作区核对为准。',
      );
    }
  }

  if (v.peerArtifactRead) {
    for (const s of Object.values(v.sides)) {
      if (!s?.peerArtifactRead) continue;
      /*
       * 两条通道分开播报（措施 a / 措施 b）。
       *
       * 合并成一行会在**只有命令通道命中**时打出「读到了禁读清单内的文件：」后面跟空清单
       * ——处置是对的（该侧照样作废），但人读留痕看起来像个 bug，排查的人会先去
       * 怀疑检测器本身。两条通道的性质本来就不同：路径命中说明它读了那个文件，
       * 命令命中说明它跑了一条提到那个文件的命令（可能经 git 对象库，文件系统上没发生读取）。
       */
      if (s.peerHits.length > 0) {
        out.push(`${s.critic} 侧读到了禁读清单内的文件：${s.peerHits.join(', ')}——该侧结论作废`);
      }
      if (s.peerCommandHits.length > 0) {
        out.push(
          `${s.critic} 侧的命令里出现了禁读清单内的路径：${s.peerCommandHits.join(' ｜ ')}` +
            '——该侧结论作废（措施 b：命令文本通道，可能经 git 对象库取值而不产生文件读取）',
        );
      }
    }
  }
  switch (v.drift.kind) {
    case 'subject_drift':
      out.push('被审对象在审查期间被修改：本次结论已不对应送审的那份内容，整次运行作废');
      break;
    case 'related':
      out.push(
        `与被审范围相关的文件在审查期间被修改（策略 ${v.driftAction}）：\n` +
          v.drift.files.map((f) => `    ${f}`).join('\n'),
      );
      break;
    case 'unrelated':
      out.push(
        `审查期间有无关文件被修改（策略 ${v.driftAction}）：\n` +
          v.drift.files.map((f) => `    ${f}`).join('\n'),
      );
      break;
    case 'unknown':
      /*
       * 比不了（EV-139）：不知道改了什么，就排除不了被审范围内的文件被改，按 on_drift_related 处置。
       * 出口要写全：核对后重跑；改 warn 会连带放宽真实的相关漂移，不是专关这一格的开关（计划 r2 §2.4）。
       */
      out.push(
        `审查期间工作树有变动，但比不了改了哪些文件（${describeDriftUnknown(v.drift)}）——\n` +
          `无法排除被审范围内的文件被改，按 on_drift_related 处置（策略 ${v.driftAction}）。\n` +
          (v.driftAction === 'fail'
            ? '  审查结论已落盘，但本轮不能当作有效审查。处置：用 git status / git diff 核对审查期间是否动过工作树，\n' +
              '  确认后重跑本阶段审查；审查进行中不要执行会立即清理不可达对象的 git 命令（如 git prune、git gc --prune=now）。\n' +
              '  若只想告警，可把 review.on_drift_related 设为 warn——它会同时放宽真实的相关漂移。'
            : '  本轮照常结束，但漂移是否涉及被审范围无从判断，请人工核对：git status / git diff'),
      );
      break;
    case 'none':
      break;
    default: {
      // 穷尽性断言（计划双审 GLM-03）：再加一种漂移结论而漏写分支，编译期即报错，不会静默不播
      const exhaustive: never = v.drift;
      void exhaustive;
    }
  }
  if (v.unattributedDriftFiles.length > 0) {
    const causes = v.unattributedCauses ?? ['readonly-unavailable'];
    if (causes.length === 1 && causes[0] === 'readonly-unavailable') {
      // 只有能力恒态这一种成因：文案与 EV-188 之前逐字相同
      out.push(
        '审查期间有文件变更，但本轮有侧的只读核验不可用，**无法归因**：\n' +
          v.unattributedDriftFiles.map((f) => `    ${f}`).join('\n') +
          '\n  既不能判为审查员失守（无正向证据），也不能判为开发者手改' +
          '（该侧被拒的写不留痕，无写事件排除不了审查员写过）。请人工核对。',
      );
    } else {
      /* 按成因分句（EV-188 计划双审 AGY-01）：三种成因让「无写事件 ⇒ 开发者手改」失效的方式不同，压成一句就说不清该查什么 */
      const why = causes.map((c) =>
        c === 'readonly-unavailable'
          ? '有侧的只读核验不可用（被拒的写不留痕）'
          : c === 'evidence-untrusted'
            ? '有侧证据不可信（调了名单外的 MCP 工具，经它的写入不在轨迹里）'
            : '有侧调用了 MCP 执行型工具（已判只读失守；它能写任意文件，写事件里没有路径）',
      );
      out.push(
        `审查期间有文件变更，但本轮${why.join('；')}，**无法归因**：\n` +
          v.unattributedDriftFiles.map((f) => `    ${f}`).join('\n') +
          '\n  不能判为开发者手改：无写事件排除不了审查员写过。请人工核对。',
      );
    }
  }

  for (const s of Object.values(v.sides)) {
    if (!s) continue;
    if (!s.evidenceOk) out.push(`${s.critic} 侧 Agent 执行证据不足：${s.evidenceReasons.join('；')}`);
    if (s.integrityIssues.length > 0) out.push(`${s.critic} 侧结论结构问题：${s.integrityIssues.join('；')}`);
    if (s.consultedUnverified) out.push(`${s.critic} 侧 consulted 无法与工具轨迹交叉核对`);

    /*
     * 降级档位的运行时告警——五面留痕的第五面（r1 裁决 §2.4 点名要补的那一面）。
     *
     * 既有的 `peer_deny_applied` 有四面留痕却独缺运行时这一面，新字段不重蹈：
     * 降级如果只落在 run 元数据里，跑的人当场看不见，等到复盘才发现「这一侧
     * 其实没核验过」已经晚了。
     */
    if (s.verification.readonly === 'unavailable') {
      out.push(
        `${s.critic} 侧只读核验不可用：该侧被拒的写操作不进轨迹，` +
          '「未检出写事件」不足以排除失守（只读保障从三重降到两重，指纹比对仍有效）',
      );
    }
    /*
     * 证据不可信的人读出口（EV-188，五面留痕的运行时那一面）。**不判失守、不作废、不阻断**，但必须当场看得见：
     * 跑的人据此知道这一侧「没命中禁读面」「没有写事件」两条阴性结论打了折。
     */
    if (s.verification.untrusted) {
      // 文案按成因取（代码双审 CODEX-F01 原文 CODEX-02）：cause 加值而文案表不跟，编译即失败
      const ut = EVIDENCE_UNTRUSTED_CAUSE_TEXT[s.verification.untrusted.cause];
      out.push(
        `${s.critic} 侧证据不可信（${ut.label}）：${ut.what} ${s.verification.untrusted.tools.join('、')}——` +
          `${ut.blind}，该侧「没命中禁读面」「没有写事件」两条阴性结论打折。` +
          `结论保留、不作废，意见照常逐条裁决；明细见该侧 trace.json 的 ${ut.where}`,
      );
    }
    /*
     * 疑似写入的人读出口（r9 双审 GLM-05）。
     *
     * 这一档不判失守，但**必须看得见**：它记的是「命中写形态却判不实」的命令，
     * 恰恰是排查只读问题时最该先看的那几条。只落 `trace.json` 等于埋起来——
     * 而契约注释承诺过它会出现在输出里。
     */
    if (s.suspectedWrites.length > 0) {
      const head = s.suspectedWrites.slice(0, 3).map((w) => `「${w.command}」（${w.why}）`);
      out.push(
        `${s.critic} 侧有 ${s.suspectedWrites.length} 条**疑似写入**（不判失守，仅供排查）：` +
          head.join('；') +
          (s.suspectedWrites.length > head.length ? ` …另 ${s.suspectedWrites.length - head.length} 条见 trace.json` : ''),
      );
    }
    /*
     * 模型覆盖没落实的人读出口（EV-82）。
     *
     * **不判失守、不改 `evidenceOk`、不阻断**：跑的模型不是请求的那个，不影响该侧结论本身的
     * 有效性，但它让 FR-06 的模型路由与 NFR-06 的异构默认在该侧失效——两侧可能是同一家族，
     * 双审的独立性名存实亡。EV-82 之所以埋了两天才被逮到，正是因为这件事此前**只有数据没有判定**：
     * `model_requested` 与 `model_effective` 两个值都在留痕里，没有任何一处去对照它们。
     *
     * 只对 `false` 出声：`true` 是正常、`null` 是没回读到（另有 `model_effective_source`
     * 那条通道说这件事）、字段缺席是本次压根没做覆盖——那一格若实际模型不同，由下面 `modelUnenforced` 那句说（EV-122）。
     */
    if (s.modelOverrideApplied === false) {
      out.push(
        `${s.critic} 侧**请求的模型没有生效**：实际跑的是另一个模型（对照 run.json 的 ` +
          '`model_requested` 与 `model_effective`）。该侧结论仍然有效，但模型路由（FR-06）与' +
          '异构默认（NFR-06）在本侧失效——若另一侧模型与它同家族，这一轮不构成真正的双审。' +
          reorderHint(s.modelOverrideReorder),
      );
    }
    /*
     * 没做覆盖而实际模型不同（EV-122）。与上一句互斥（适配器保证），**不判失守、不阻断**，理由同上。
     * 只陈述可观测事实（计划双审 CODEX-06）：限定失败那一支跑的是副本源的 `model.main` 或回落，不是 CLI 全局默认，
     * 因果不在这里下；排查指向按 `cause` 分句。
     */
    if (s.modelUnenforced) {
      const u = s.modelUnenforced;
      out.push(
        `${s.critic} 侧**本次没有做模型覆盖**：请求的是 \`${u.requested}\`，实际跑的是 \`${u.effective}\`（${u.reason}）。` +
          '该侧结论仍然有效，但模型路由（FR-06）与异构默认（NFR-06）在本侧不成立——若另一侧模型与它同家族，' +
          '这一轮不构成真正的双审。' +
          unenforcedHint(u.cause),
      );
    }
    /*
     * 落点自检的人读出口（EV-112 计划 r3 §4.6）。**不判失守、不阻断**：该侧结论本身仍有效，
     * 出事的是送审内容的落点——它可能不在运行目录的清扫面里，甚至写进了真实 HOME。
     * 两项合取：日志与存储根走两条互不相干的代码路径，只丢一条时另一条照常，析取会把半采纳报成正常。
     */
    if (s.carriersLanded && (!s.carriersLanded.log || !s.carriersLanded.rollout)) {
      const missing = [!s.carriersLanded.log ? '日志' : null, !s.carriersLanded.rollout ? 'rollout' : null].filter(Boolean).join('与');
      out.push(
        `${s.critic} 侧运行目录里缺本次会话的${missing}：ZCode 可能不再采纳对应的落点键（EV-112），` +
          'CLI 产物可能留在别处，生效模型也可能读不回。先看 doctor 的 cli_version 是否变了；详情见 run.json 的 carriers_landed',
      );
    }
    const leak = s.carriersLanded?.leaked_to_home;
    if (leak && (leak.log || leak.rollout)) {
      const where = [
        leak.log ? '日志（~/.zcode/cli/log 下本次拉起后改过的文件里有本次会话的行，该文件可能混有其它会话）' : null,
        leak.rollout ? 'rollout（~/.zcode/cli/rollout/model-io-<sessionId>.jsonl）' : null,
      ].filter(Boolean).join('；');
      out.push(
        `${s.critic} 侧本次会话的 CLI 产物出现在真实 HOME 下：${where}。送审内容已写进真实 HOME，` +
          '需人工自查后清理（sessionId 见 run.json）',
      );
    }
    if (s.verification.path === 'unavailable') {
      out.push(
        `${s.critic} 侧路径核验无结构化输入：该侧读取路径只存在于命令文本里，` +
          '措施 a 无通道可扫，deny 核验完全由措施 b 承担（已知形态必检，非完备）',
      );
    }
  }
  return out;
}

/**
 * 「本次没有做模型覆盖」告警的排查指向（EV-122 计划 r2 §3.2）。是**先看哪里**，不是成因断言；
 * 按结构化 `cause` 分句，不对 `reason` 文案做匹配（计划双审 CODEX-02，与 `reorderHint` 同口径）。
 */
export function unenforcedHint(cause: NonNullable<SideVerdict['modelUnenforced']>['cause']): string {
  switch (cause) {
    case 'source_missing':
      return '先看副本源 `~/.zcode/cli/config.json` 在不在。';
    case 'qualify_failed':
      return '先看请求的模型名在不在副本源的 provider 目录里（profile 与 `--model-glm` 的写法），详情见 trace.json 的 `modelSelection.reason`。';
    default: {
      /*
       * 适配器产不出两值之外的 cause，但桩注入串只 JSON.parse、不校验，会原样走到这里（代码双审 r1 CODEX-01）：
       * 运行期不给指向、只留主句，免得把字面量 undefined 拼进播报。`never` 保住编译期穷尽——新增枚举值时这里照样红
       */
      const unreachable: never = cause;
      void unreachable;
      return '';
    }
  }
}

/**
 * `false` 告警的置首分句（EV-82 第三段 r3 §4.1）。**只在置首结论在场时**追加：缺席的侧（其余三家与桩）
 * 不写 trace.json 的 `modelSelection.reorder`，指向它会指向一份不存在的留痕（计划双审 r2 CODEX-06）。
 * 按结构化 `kind` 分句，不对 `reason` 文案做匹配（r2 GLM-r2-02）。
 */
export function reorderHint(r: SideVerdict['modelOverrideReorder']): string {
  if (!r) return '';
  const head = '先看 trace.json 的 `modelSelection.reorder`：';
  switch (r.kind) {
    case 'applied':
      return `${head}置首已生效仍回落——CLI 的回落规则可能变了，先看 doctor 的 \`zcode.runtime_selection\`。`;
    case 'identity':
      return `${head}请求本在首位，未做置首。`;
    case 'not_movable':
    // qualify_failed：审查运行产不出这一档（限定失败时不写置首结论，见 `VariantKind` 的产出面说明），
    // 生产上只有桩注入走得到；保留作穷尽 switch 的防御分支（代码双审 r1 CODEX-01）
    case 'qualify_failed':
      return `${head}置首没做成${r.reason ? `：${r.reason}` : ''}。`;
  }
}
