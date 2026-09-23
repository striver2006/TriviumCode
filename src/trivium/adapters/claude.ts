/**
 * Claude Code 适配器（设计 §11.1 / §3.7 / §3.7.1，M9 第 3 步）。
 *
 * 本文件**分两半落地**，这是刻意的顺序（计划双审焦点三，三侧一致判可行）：
 *
 * - **下半身（本批）**：`buildClaudeArgs` / `invokeClaude` 与四个纯函数。
 *   它们是**参数拼装与执行封装**，不含任何探测逻辑。
 * - **上半身（第 8 步）**：`claudeAdapter` 各成员。
 *
 * 分半的理由：BACKLOG EV-42 / EV-43 都写着「**编写适配器之前**先补实测」，
 * 而 EV-43 又要求实测「用与适配层一致的 stdin 传参结构」——这是个先有鸡还是先有蛋。
 * 解法是让准入脚本 **import 本文件的下半身**（`scripts/claude-admission-control.mjs`），
 * 与 `scripts/codex-sandbox-control.mjs` 调生产的 `invokeCodex` 逐字同构。
 * EV-43 那句「不在生产 `adapters/claude.ts` 内实现探测逻辑」管的是**探测装置的归属**
 * （夹具、哨兵、判词归脚本与探针），不禁止脚本调用适配器的 argv/exec 封装。
 *
 * 这样做优于「脚本自建一份配方 + 补对账用例」：后者是**给漂移加守卫**，
 * 前者是**消除漂移**——报告 §12 对策 1 写的就是这条。
 *
 * ## 铁律（原则 P7）
 *
 * **取值必须靠实测才知道的旗标**一律由 probe 结论构造，不得硬编码设计文档里的示例。
 * 这不等于「适配层不得出现任何旗标字面量」——机制类旗标（输出格式、prompt 载入方式）
 * 由编排器需求决定、不是厂商能力事实，按设计 §11.1「旗标归属判据」就该写在本层。
 *
 * **绝不出现在本文件代码里的字面量**：那四个只读不变量、codex 的沙箱值、
 * 以及已作废的 §7.2 模板旗标。`registry-parity` 第 6 条会当场打红——**那是刻意的，不去改测试**。
 * （措辞要准：第 6 条扫描前会剥掉注释，所以它守的是**代码里的字符串字面量**。
 * 但注释里也不复述那些值——复述一遍就多一份会漂移的副本，见下方 `readonlyToolsFromProbe`。）
 * 连**裸的**读工具名也不许写（M9 第 3 步新增的分解形加强判据对 `adapters/<cli>.ts`
 * 精确匹配生效）：本文件需要工具名时一律走 `readonlyToolsFromProbe` 运行时派生。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CriticRequest, CriticResult } from '../types.js';
import { run } from '../util/exec.js';
import { ensureDir } from '../util/fsx.js';
import {
  CLAUDE_OUTPUT_TOOLS,
  countTools,
  extractClaudePath,
  finalReviewText,
  parseClaudeEvents,
  parseGrepResults,
  pathCoverage,
  readPaths,
  successfulToolUses,
  type ClaudeTrace,
} from './claude-trace.js';
import {
  failedResult,
  TOOL_TRACE_CAPABILITY,
  type AdapterContext,
  type CriticAdapter,
} from './base.js';

export interface ClaudeInvokeOptions {
  bin: string;
  cwd: string;
  /** 送审包全文。**走 stdin，不进 argv** */
  prompt: string;
  model: string | null;
  /** 探针实测被接受的只读旗标（argv 形态，原样透传） */
  readonlyArgs: string[];
  /**
   * 内联 JSON Schema 的**内容**，不是路径。
   *
   * **由调用方读入后传进来**，本层不碰文件系统——`buildClaudeArgs` 要保持纯函数，
   * 否则 A1–A20 与 M1–M22 那一批覆盖不到它（计划双审 CODEX-08）。
   * 实测传路径当场被拒：`--json-schema is not valid JSON: Unrecognized token '/'`。
   */
  schemaJson: string | null;
  /** 内联 settings JSON（`permissions.deny`），由 `buildDenySettings` 产出；null 即不注入 */
  settingsJson: string | null;
  timeoutMs: number;
  /**
   * **仅准入脚本使用**的成本硬闸。生产路径恒为 null。
   *
   * `CriticRequest` 没有成本闸门字段（设计 §3.7.1 末行：尺度类，要用须先补接口），
   * 所以真实审查不传它。准入脚本要按计划的调用预算给自己上闸，
   * 那是**纯追加、不改被测行为**的偏差——脚本文件头与实测报告各记一次。
   */
  maxBudgetUsd?: string | null;
}

/**
 * argv 拼装。**纯函数**，与执行分离，让调用配方有回归测试。
 *
 * ## prompt 走 stdin，且**不带位置参数 `-`**（形态 A）
 *
 * EV-41 实测形态 A（无位置参数、管道）与形态 B（位置参数 `-`，codex 同款）
 * **等价可用**，31,913 字节送审包两者都跑通。取 A 的两条理由：
 *
 * 1. **依赖面更小**。实测报告 §1.4 明写：本步**没有能区分「`-` 是 stdin 标记」
 *    与「`-` 被忽略、而管道输入本来就会被读」的实验**。取 B 等于把一个
 *    **未验的约定含义**写进生产配方。
 * 2. EV-43 明写「形态 B 的位置参数 `-` 会与 prompt 位置参数冲突」，
 *    而 `stream_json_requires_verbose` 的负对照恰恰是**参数校验行为**——
 *    B 形态下它可能因为另一个原因失败而被误归因。
 *
 * **与 codex 侧不同形**（`buildCodexArgs` 末位是 `-`），这一点写在这里而不是留给记性：
 * 两者实测等价，取 A 是因为依赖面更小。
 */
export function buildClaudeArgs(
  opts: Pick<ClaudeInvokeOptions, 'model' | 'readonlyArgs' | 'schemaJson' | 'settingsJson' | 'maxBudgetUsd'>,
): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    /*
     * **`--verbose` 无条件硬编码，不读 `stream_json_requires_verbose` 来决定传不传。**
     *
     * 那个探针字段的消费方是**漂移可见性**，不是参数构造（`types.ts` 该字段的
     * 声明逐字写着这句，设计 §3.7.1 同）。按它动态拼参数会把一个「监视器」
     * 变成「控制器」：厂商解除绑定的那天，字段翻 false ⇒ 我们就不传了 ⇒
     * 再也观测不到它何时又绑回去。
     *
     * 实测（2.1.273）：不带它时 CLI **直接拒绝**——退 1、零事件、零 API 调用。
     */
    '--verbose',
    // 只读旗标：探针实测挣来的安全不变量，**原样透传**（判据二，与 codex 同族）
    ...opts.readonlyArgs,
    ...(opts.model ? ['--model', opts.model] : []),
    /*
     * 「送 CLI 的那一份 schema」的唯一出口（代码双审 CODEX-03）：无论调用方从哪读来，
     * 都在这里做幂等归一，剥掉 CLI 不认的 2020-12 `$schema` 头。`readSchemaJson` 也剥，
     * 两处叠加是幂等的——EV-74 落地后探针与准入脚本都改走 `readSchemaJson` 了
     * （代码双审 GLM-06），这里仍保留第二道剥壳是防未来新增调用方绕过它，
     * 不是因为今天真有调用方绕过。
     */
    ...(opts.schemaJson ? ['--json-schema', stripMetaSchemaRef(opts.schemaJson)] : []),
    ...(opts.settingsJson ? ['--settings', opts.settingsJson] : []),
    ...(opts.maxBudgetUsd ? ['--max-budget-usd', opts.maxBudgetUsd] : []),
  ];
}

/**
 * 只读旗标由探针结论构造（P7）。
 *
 * 本机实测落盘的是**可直接使用的 argv 片段**，与 codex 同族，故原样透传——
 * **不按 zcode 写**：那家的 `readonly_flags` 装的是「候选串的接受记录」，
 * 才需要取旗标名、值另给全集常量（设计 §11.1 判据二）。
 *
 * 空数组的含义是「本机没有实测到可用的只读组合」，此时该侧必须判不可用——
 * 绝不能回落到一个「文档上写着应该管用」的默认值。
 */
export function readonlyArgsFromProbe(readonlyFlags: readonly string[]): string[] {
  return [...readonlyFlags];
}

/**
 * 从只读旗标里**运行时派生**出被允许的工具名白名单。
 *
 * ## 判据：取不以 `-` 开头的元素，按 `,` 切开
 *
 * 落盘的是一段 argv 片段，其中**旗标名以 `-` 开头、值不以 `-` 开头**，
 * 而工具白名单是其中唯一一个逗号分隔的值。真实取值见
 * `probes/claude.ts` 的 `READONLY_INVARIANTS`——**此处刻意不复述它**：
 * 复述一遍就多一份会漂移的副本，而且是写在「禁止字面重建」那段话的旁边
 * 给后来者留一个可照抄的模板。想知道具体值就去看那个常量。
 *
 * ## 为什么不按旗标名查找
 *
 * 那要写出那个旗标名或它的子串：前者被 `registry-parity` 第 6 条当场打红，
 * 后者（`f.includes('tool')`）是**钻自己分词器的空子**——本项目对「绕过自己的守卫」
 * 的定性一贯比缺陷本身更重。也不用形状匹配（大驼峰逗号串正则）：那是第二套判据，
 * 会与探针的真实落盘形态漂移。
 *
 * ## 空集必须 fail-closed，且在两处
 *
 * 派生不出白名单 ⇒ **无法判定白名单外的工具调用** ⇒ 只读失守检测在本侧失效。
 * 于是 `availability()` 判该侧不可用（第 8 步），且结果组装处另有一条**运行期断言**。
 * 两处独立、各自可失效而不互相依赖——与 zcode 侧 `--disallowed-tools` 那条同一条纪律。
 *
 * **绝不回落到一个默认工具集**：那会把「没测到」变成「确认是这三个」，
 * 而这一族塌缩是本主题连修四轮的那个形状。
 */
export function readonlyToolsFromProbe(readonlyFlags: readonly string[]): string[] {
  const out = new Set<string>();
  for (const f of readonlyFlags) {
    if (f.startsWith('-')) continue; // 旗标名不是工具名
    for (const t of f.split(',')) {
      const v = t.trim();
      if (v) out.add(v);
    }
  }
  return [...out];
}

/** `rule_syntax` 解析出的规则外壳：把一个路径表达式包成一条 deny 规则 */
export interface DenyRuleShape {
  /** 探针实测时用的那个工具名（只用于记录，不参与生成——生成时按本次白名单逐个套） */
  sampleTool: string;
  /** 路径表达式是否带 `./` 前缀（探针落盘形态如此） */
  relPrefix: string;
}

/**
 * 从探针落盘的 `path_deny.rule_syntax` 里**解析出规则外壳**，而不是字面套用它。
 *
 * ## 为什么不能字面套用
 *
 * 落盘值是**目录 glob**（形如 `<Tool>(./<dir>/**)`，探针拿夹具目录测的），
 * 而适配层要注入的 `CriticRequest.deny_paths` 是**逐文件清单**——两者形状不同。
 * 设计 §3.7.1 说「规则写法读 `rule_syntax`」，若读成「照这个字符串套」，
 * 就是拿一个非生产形状去拼规则（M9 第 3 步计划双审 §1.5）。
 *
 * 所以这里只取它的**包装形态**（`<Tool>(<path-expr>)` 与相对前缀），
 * 路径表达式按 `deny_paths` 逐条生成、工具名按本次白名单逐个套。
 *
 * 解析不出来返回 `null`，调用方据此**不注入并记原因**——不猜一个形状硬拼。
 */
export function denyRuleShapeOf(ruleSyntax: string | null): DenyRuleShape | null {
  if (!ruleSyntax) return null;
  const m = /^([A-Za-z][A-Za-z0-9_]*)\((.+)\)$/.exec(ruleSyntax.trim());
  if (!m) return null;
  const inner = m[2]!;
  return { sampleTool: m[1]!, relPrefix: inner.startsWith('./') ? './' : '' };
}

/**
 * 拼 `--settings` 的内联 JSON（`permissions.deny`）。
 *
 * ## 每个读工具一条规则
 *
 * 探针实测的结论是**规则按工具生效，不是按路径生效**：只注入一条读规则时，
 * 模型换用另一个读工具就绕过去了。所以白名单里有几个读工具，这里就要写几条。
 * 工具名**从 `readonlyToolsFromProbe` 派生**，本文件不写任何工具名字面量。
 *
 * ## 每条路径同时生成「精确」与「子树」两条
 *
 * `deny_paths` 是**混合集**：项目相对文件、项目相对目录、以及项目外绝对路径
 * （`enumerateDenyPaths` 无条件加后两者）。而这个数组是扁平字符串，
 * **丢失了「这条是文件还是目录」的信息**。
 *
 * 与其用扩展名去猜（不可靠），不如两条都下：一条路径要么是文件要么是目录，
 * 多生成的那条匹配不到任何东西、无害；漏生成则是一条禁读通道静默失效。
 * 与 `CLAUDE_PATH_KEYS` 宽收同一条道理——**宽的代价是 0，漏的代价是兜底不存在**。
 *
 * ## 返回 null 的两种情形都要被调用方记下来
 *
 * 外壳解析不出、或白名单为空 ⇒ 不注入。**「没注入」与「注入了但被 CLI 拒掉」
 * 不能长得一样**（与 `scrubRunDir` 那条「没得抹与抹过了不能长得一样」同一条纪律），
 * 后者由第 8 步的失败出口落 `fail_reason`。
 */
/**
 * 一条路径能不能安全地表示成 `<Tool>(<path>)` 形态的规则。
 *
 * ## 为什么需要它（代码双审 r1 CODEX-02 ≡ AGY-02）
 *
 * 规则是**裸字符串拼接**，而 `deny_paths` 里的路径是可以带标点的：
 * `validateTopic` 只挡空白/路径分隔符/`..`/控制符/以 `.` 开头，
 * **实测放行 `M9(收口)`、`a,b`、`fix*`**。于是 `.reviews/M9(收口)/…` 会生成
 * `Read(./.reviews/M9(收口)/x.md)` 这种**括号嵌套**的规则。
 *
 * 两种可能结局都不好，**而且都不可见**：CLI 若拒整份 `--settings`，本次审查直接失败
 * （还算可诊断）；若**逐条静默丢弃**，禁读通道就死了一条而我们看不出来——
 * 因为 `peer_deny_applied` 读的是探针格（探针夹具、单条 ASCII 路径），
 * **不是本次注入的这批规则**。
 *
 * ## 判据：这条路径拼出来的规则，**还能不能字面匹配到它自己**
 *
 * **上一版的判据是「会不会破坏规则**语法**」，那是错的**（代码双审 r2 CODEX-02 ≡ GLM-04）。
 * 规则体是 **glob**——探针落盘的 `rule_syntax` 里带双星通配，而子树规则也靠同一套
 * 通配语义。所以真正决定挡不挡得住的是**语义**，不是语法。
 *
 * 实跑确证（`validateTopic` 对这些主题名全部放行）：
 *
 * ```text
 * .reviews/M9[3]/code/a.md  →  Read(./.reviews/M9[3]/code/a.md)
 * ```
 *
 * `[3]` 在 glob 里是**字符类**，只匹配单个字符 `3`——**这条规则匹配不到它自己那条
 * 字面路径**，禁读通道 fail-open，而且 `skipped` 是空的：
 * **比圆括号更隐蔽，「逐条记名」机制对它完全不可见**。
 * 反方向的星号会**过匹配**：主题名带星号时，规则会扩成一批同前缀目录，
 * 超出 `deny_paths` 的字面集合，可能连坐审查员合法读取的己方历史。
 *
 * ## 挡什么、放行什么
 *
 * **挡**：`( ) [ ] { } * ? !`、反斜杠，以及换行/回车。
 *
 * **放行**：非 ASCII、**逗号、空格**，以及其余一切。本次运行的 270 条里
 * **267 条是非 ASCII 的中文主题名**，挡掉它们等于把禁读通道整个关上。
 *
 * ## 字符集是**实测定的**，不再是手挑的（EV-49 结案，代码双审 r3）
 *
 * r3 首版按 CODEX-05 / GLM-06 的意见把**逗号、空格、反斜杠**一并挡了，
 * 理由是「三者都可达、匹配语义都未测，保守超集的代价只是可见的跳过」。
 * 随后按 EV-49 的触发条件补了实测臂（`scripts/claude-admission-control.mjs`
 * 的 `deny-dialect` 用例，2.1.276，各一次真实调用）——**结论推翻了其中两条**：
 *
 * | 臂 | 观测 | 判定 |
 * | :--- | :--- | :--- |
 * | `[` | 哨兵**泄漏**、denials 空 | 规则匹配不到自身，**fail-open** ⇒ 该挡 |
 * | `*` | 未泄漏、也没进 denials | **判不出**（模型发起过调用但两条腿都不成立）⇒ 维持挡 |
 * | `,` | 未泄漏、**进 denials** | 规则**照常生效** ⇒ **放行** |
 * | 空格 | 未泄漏、**进 denials** | 规则**照常生效** ⇒ **放行** |
 *
 * 所以这个方言把路径**当字面量**处理，逗号与空格挡了是**净损失**：
 * 它们本可以被正常屏蔽，挡掉反而让那条禁读通道白白消失。
 * `docs/My Key.pem` 这类**从 `walkSensitive` 直接派生**的敏感文件路径尤其吃亏——
 * 那是最不该丢规则的一类。
 *
 * **`*` 维持挡，但理由换了**：不是「fail-open」（没测出来），而是 r2 立的
 * **过匹配**——`fix*` 会扩成一批同前缀目录，超出 `deny_paths` 的字面集合，
 * 可能连坐审查员合法读取的己方历史。那条理由独立成立，不依赖本次实测。
 *
 * **反斜杠维持挡且仍未实测**：它从主题名不可达（`validateTopic` 显式挡 `\`），
 * 只能从 `walkSensitive` 来，而在把反斜杠当转义符的方言里它会改变匹配。
 * 本轮没给它排臂——如实记为未测，不拿逗号/空格的结论去替它背书。
 *
 * ## 判据与实现的距离（codex 点破的那个区分）
 *
 * 判据写的是「这条路径拼出来的规则还能不能字面匹配到它自己」，
 * 实现是「含不含这几个字符」——**两者不是一回事**。
 * 方向的正确性（跳过可见、fail-open 不可见）**不论证字符集的正确性**，
 * 此前我把这两件事合着讲了。现在字符集有了实测背书，`*` 有独立理由，
 * 反斜杠仍是推断——**三者的证据强度不同，这里分开写**。
 *
 * 不按来源分档（codex 给的另一个选项）：`buildDenySettings` 收到的是扁平路径数组，
 * 分档要把来源标签一路从 `freeze.ts` 传进适配层，是比本轮大得多的改动；
 * 而实测之后需要分档的动机也消失了——逗号与空格两档都放行。
 */
export function denyPathRepresentable(p: string): boolean {
  return !/[()[\]{}*?!\\\n\r]/.test(p);
}

/** `buildDenySettings` 的产出：规则串 + 供留痕的规模与降级信息 */
export interface DenySettingsBuild {
  /** `--settings` 的内联 JSON；无可注入规则时为 null */
  json: string | null;
  ruleCount: number;
  /** JSON 字节数——**要记进留痕**：它进的是单个 argv 项，受 ARG_MAX 约束 */
  bytes: number;
  /** 无法表示成规则、因而被跳过的路径（逐条记因，不静默丢） */
  skipped: string[];
}

export function buildDenySettings(
  denyPaths: readonly string[],
  tools: readonly string[],
  shape: DenyRuleShape | null,
): DenySettingsBuild {
  const empty: DenySettingsBuild = { json: null, ruleCount: 0, bytes: 0, skipped: [] };
  if (!shape || tools.length === 0 || denyPaths.length === 0) return empty;

  const rules: string[] = [];
  const skipped: string[] = [];
  // 去重：`deny_paths` 可能含重复项，而每条都会展开成 工具数 × 2 条规则
  for (const p of [...new Set(denyPaths)]) {
    if (!denyPathRepresentable(p)) {
      skipped.push(p);
      continue;
    }
    const isAbs = path.isAbsolute(p);
    // 项目外绝对路径按原样注入；项目相对路径补探针实测形态的前缀
    const base = isAbs ? p : `${shape.relPrefix}${p}`;
    const stripped = base.replace(/\/+$/, '');
    for (const tool of tools) {
      rules.push(`${tool}(${stripped})`); // 精确：这条路径本身是文件时生效
      rules.push(`${tool}(${stripped}/**)`); // 子树：这条路径是目录时生效
    }
  }
  if (rules.length === 0) return { ...empty, skipped };

  const json = JSON.stringify({ permissions: { deny: rules } });
  return { json, ruleCount: rules.length, bytes: Buffer.byteLength(json, 'utf8'), skipped };
}

/**
 * `--settings` 的字节数软上限。
 *
 * 它整份进**单个 argv 项**，与 prompt、schema、env 共用 `ARG_MAX`（本机 1048576）。
 * 取 ARG_MAX 的 1/8 作为告警线：留出送审包（几十 KB）、schema 与环境的余量。
 *
 * **设计 §3.7.1 里那句「几十 KB 离上限差一个数量级」的论域是 prompt**，
 * 不覆盖 settings——代码双审 r1 CODEX-03 指出这一点时，未剪枝的 settings
 * 已达 **153,302 字节**（占 ARG_MAX 的 14.6%、是送审包的约 4.8 倍）。
 * 主因已由 CODEX-01 的 `topic` 剪枝修掉（**复算为**约 0.54%，缩小约 27.1 倍），
 * 但**上界仍随主题内归档件数增长**，所以这道闸要在。
 *
 * **「复算」不是「实测」**（代码双审 r3 CODEX-02）：这三个数是用本文件的
 * `buildDenySettings` 对真实 `run.json` 的 `deny_paths` **重新算**出来的，
 * 不是某次运行的落盘观测。上一版这里写「实测降到约 0.6%」，而 0.6% 那组
 * 出自一份**手写简化算法**——报告 §4.1.1 已把它判为三组里最不可信的一组。
 * 权威值以报告 §4.1.1 的复算表为准。
 */
export const DENY_SETTINGS_SOFT_CAP_BYTES = Math.floor(1048576 / 8);

export interface ClaudeInvokeOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  commandLine: string;
  durationMs: number;
}

/**
 * **唯一**执行 claude 的地方。
 *
 * `stdin` 必须显式给：prompt 走的就是这条路（形态 A，argv 里没有位置参数）。
 * codex 侧踩过「继承了一个不会 EOF 的 stdin、进程挂到超时被杀」，此处同理显式给定。
 */
export async function invokeClaude(opts: ClaudeInvokeOptions): Promise<ClaudeInvokeOutcome> {
  const args = buildClaudeArgs(opts);
  const r = await run(opts.bin, args, {
    cwd: opts.cwd,
    stdin: opts.prompt,
    timeoutMs: opts.timeoutMs,
    killTree: true,
  });
  return {
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.code,
    timedOut: r.timedOut,
    commandLine: r.commandLine,
    durationMs: r.durationMs,
  };
}

/** 读 schema 文件内容供 `buildClaudeArgs` 使用——**读文件留在这里，不进纯函数** */
export async function readSchemaJson(schemaPath: string): Promise<string> {
  return stripMetaSchemaRef(await fs.readFile(schemaPath, 'utf8'));
}

/**
 * 去掉顶层 `$schema` 键，其余原样保留（含 `$id`）。
 *
 * **实测依据（2026-09-19，M9 第 6 步验收，claude 2.1.277）**：`review.v1.json` 头部的
 * `"$schema": "https://json-schema.org/draft/2020-12/schema"` 让 CLI 当场拒绝——
 * `--json-schema is not a valid JSON Schema: no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`，
 * 两次尝试同一错误、零 API 调用。同一文件去掉 `$schema`、或改 draft-07 的 `$schema`，均被接受；
 * 只去 `$id` 不去 `$schema` 仍拒。所以只剥这一个键，不动别的：契约文件本身不改——
 * 不只是因为 agy 侧传文件路径且接受 2020-12；更硬的理由是本仓 `parse.ts` / `schemas.ts`
 * 用的 `Ajv2020` 对 draft-07 头当场抛 `no schema with key or ref`（代码双审 CODEX-04，已实跑），
 * 把契约改成 draft-07 不是取舍，是加载期崩溃。
 *
 * **剥壳之后 CLI 按它自己的方言校验**，契约里若出现 2020-12 独有关键字（`$defs`、
 * `prefixItems`、`unevaluated*`、`dependent*` …）会被静默忽略或直接拒，留痕分不出哪种。
 * 今天 `review.v1.json` 不含 2020-12 独有键，这件事由契约用例 A31 守着，不靠记性；
 * A31 是单向黑名单——draft-07 独有或跨方言语义变化的键（`dependencies`、tuple 形 `items`、
 * `$ref` 兄弟键等）不在论域，改契约时人工核（第 2 轮 CODEX-F01-⑤）。
 *
 * **探针为什么没拦住**：`probes/claude.ts` 的 `json_schema_ok` 用的是一个不带 `$schema` 的
 * 迷你 schema，从未喂过真实契约文件——那一格答的是「旗标收内联 JSON」，不是「收本仓的 schema」。
 * 该盲区登记 BACKLOG EV-74，探针改喂真实文件是它的修法，不在本层。
 *
 * 纯函数、不碰文件系统，理由同 `buildClaudeArgs`。输入不是合法 JSON 时原样返回：
 * 那种情形 CLI 会用自己的报错拒掉，本层不替它改写错误形态。
 */
export function stripMetaSchemaRef(schemaJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaJson);
  } catch {
    return schemaJson;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return schemaJson;
  const obj = parsed as Record<string, unknown>;
  if (!('$schema' in obj)) return schemaJson;
  const { $schema: _dropped, ...rest } = obj;
  return JSON.stringify(rest);
}

// ═══════════════════════ 上半身：claudeAdapter 各成员（第 8 步）═══════════════════════

/**
 * 把一次运行的原始事实组装成 `CriticResult`。
 *
 * **抽成纯函数是为了能被变异验证打中**：这里有一条 AC-20 的硬判据——
 * 「生效模型以回读为准、拿不到就记 `unverified`，绝不用 requested 冒充」——
 * 若埋在 `run()` 里，要真跑 claude 才走得到。codex 侧跑过一次 M4 变异证实了这点：
 * `meta.modelEffective ?? req.model` 改下去，**全量用例无一变红**。
 * 冒充的后果不是数字难看，是 AC-20 那条验收**永远通过、永远没有意义**。
 */
export function buildClaudeResult(
  trace: ClaudeTrace,
  o: Pick<ClaudeInvokeOutcome, 'exitCode' | 'durationMs' | 'commandLine'>,
  paths: { stdout: string; trace: string },
  probe: { version: string | null; path_deny: { file_shape_verified: boolean | null } },
  /** 本次真实递出的只读工具白名单（`readonlyToolsFromProbe` 的产出） */
  readonlyTools: readonly string[],
  /**
   * 本次 deny 注入的产出（规模 + 跳过项）。
   *
   * **走入参而不是让 `run()` 事后补**：这两格要进判定面（`report.ts` 据此推降级旗标），
   * 埋在 `run()` 里的字段组装没有任何用例守得到——codex 侧的 M4 变异证实过这一点。
   */
  deny: Pick<DenySettingsBuild, 'ruleCount' | 'skipped' | 'bytes'>,
  /**
   * Grep 相对命中的绝对化基准，只在 `init.cwd` 缺失时用。可选是为了不动 14 处既有直调
   * （它们的夹具 init 无 cwd 且不含 Grep 结果，缺省 null 即「相对命中丢弃」）。
   */
  opts: { fallbackRoot?: string | null } = {},
): CriticResult {
  /*
   * **运行期断言：白名单为空时不得产出「没有写事件」这个结论**（fail-closed 的后半）。
   *
   * `availability()` 已经挡过一次，但那是**另一层**——两层各自可失效而不互相依赖。
   * 空白名单意味着「白名单外」这个概念没有定义，此时 `write_events: []`
   * 说的不是「没有失守」，而是「失守检测已经静默死掉」。两者不能长得一样。
   *
   * 形态照抄 `zcode.ts` 里那个 throw，理由也一样：纯记性约定守不住，
   * 而 AGENTS.md 纪律 12 明令这类纪律要换成不依赖记性的机制。
   */
  if (readonlyTools.length === 0) {
    throw new Error(
      'claude 侧派生不出只读工具白名单（readonlyTools 为空），而适配器仍要产出 write_events。\n' +
        '  白名单为空时「白名单外的工具调用」没有定义，只读失守检测在本侧已失效——\n' +
        '  要么修好 probe.readonly_flags 的派生（见 readonlyToolsFromProbe），\n' +
        '  要么让 availability() 把该侧判为不可用，不要在这里产出一个看起来干净的结论。',
    );
  }

  const successful = successfulToolUses(trace);
  const counts = countTools(trace);
  const cover = pathCoverage(trace);

  /*
   * 写事件 = 轨迹里出现**白名单外工具**的 `tool_use`。
   *
   * **无论成功与否都算**（与 agy 侧 `writeEvents` 同口径）：尝试写本身就是失守信号。
   * 所以这里扫 `trace.toolUses` 全集，不是 `successful`。
   *
   * **判据扫工具名，不看 `permission_denials`**：白名单外的工具走「工具不存在」
   * 路径，实测那次 denials 是**空数组**而拒绝信息在 `tool_result` 里
   * （M9 第 1 步报告 §3.1 第 2 条）。扫错地方会让这条判据恒为空。
   *
   * **`CLAUDE_OUTPUT_TOOLS` 例外**：`--json-schema` 下 CLI 自己注入 `StructuredOutput`
   * 作为交付通道，它不在 `--tools` 白名单里、也不落盘。M9 第 6 步验收第 2 跑把它算成
   * 5 次写事件、整轮判 `readonly_breach: true`（run `20260919T120643Z`）。只豁免那一个名字。
   */
  const writes = trace.toolUses
    .filter((u) => !readonlyTools.includes(u.name) && !CLAUDE_OUTPUT_TOOLS.has(u.name))
    .map((u) => `${u.name}(${extractClaudePath(u.input) ?? JSON.stringify(u.input).slice(0, 80)})`);

  return {
    critic: 'claude',
    status: 'ok',
    exit_code: o.exitCode,
    duration_s: o.durationMs / 1000,
    raw_stdout_path: paths.stdout,
    trace_path: paths.trace,
    review_json: null, // 由 parse 填充
    raw_response_text: finalReviewText(trace),
    /*
     * 生效模型**回读**自 `system/init`。取不到记 `unverified`，
     * **绝不用 `req.model` 冒充**——与另两家同一条纪律（AC-20 的口径）。
     */
    model_effective: trace.init?.model ?? null,
    /*
     * 来源是 **`envelope`**，不是 `trace`。
     *
     * `system/init` 是**事件流自身的一个事件**，与 agy 同形；zcode / codex 记 `trace`
     * 是因为它们的生效模型读的是**另一个文件**（会话文件 / rollout）。
     * 两者不是措辞差异——`model_effective_source` 的取值集就是按「从哪拿到的」分的。
     */
    model_effective_source: trace.init?.model ? 'envelope' : 'unverified',
    /*
     * 恒为 `null`，且**这是能说明理由的空**：该族 CLI 不暴露 provider 归属，
     * 也没有厂商 profile 的概念（codex 才有 `-p`）。空的含义是「该侧没有这种字段」，
     * 不是「没采集」。形态与 agy 侧同构。
     */
    model_provider: null,
    profile_requested: null,
    tool_calls: {
      read: counts.read,
      grep: counts.grep,
      glob: counts.glob,
      /*
       * **恒 0，且这一格是真实的**：只读工具面里没有命令工具（Bash 不在白名单），
       * 所以「跑了 0 条命令」是事实而非「没采集」。与 `command_texts` 的运行期断言配对。
       */
      run_command: 0,
    },
    read_paths: readPaths(trace),
    /*
     * Grep `content` 命中（EV-76 出路 ①）：基准 = `init.cwd`（回读）?? 调用方给的项目根。
     * 只装 `content` 档；另两档留在 trace.json 的 `grep.listed`，不进判定面。
     */
    search_hit_paths: parseGrepResults(trace, opts.fallbackRoot ?? null).hits,
    /*
     * 覆盖率两个计数**无条件填**（算不出写 null，不省略键）。
     * `zcode.ts` 那边记过教训：省略键会让 `verification.path` 档位恒为 ok，
     * 等于拿 ok 填「不知道」。
     */
    path_bearing_reads: cover.total,
    path_bearing_reads_with_path: cover.withPath,
    write_events: writes,
    /*
     * **恒为空，且由上面的白名单断言守着**：该侧工具面里没有命令工具，
     * 措施 b（命令文本字面扫描）在本侧无输入。
     * 若哪天白名单里出现了命令工具，`run_command` 与这一格都要真去提取——
     * 那时 `readonlyTools` 会含它，而这里仍恒空，是一个会被审出来的矛盾。
     */
    command_texts: [],
    evidence_ok: false, // 由 guard 判定
    fail_reason: null,
    session_id: trace.sessionId,
    cli_version: probe.version,
    /*
     * **读 `file_shape_verified`，不读 `supported`**（BACKLOG EV-42）。
     *
     * `supported` 回答「这家 CLI 有没有路径级 deny 机制」；这一格回答的是
     * **「本机曾实测该逐文件形状可拦」**——两件事。三态在这里天然安全：
     * `null`（没验过）与 `false` 都判不过 `=== true`。
     * 有一条跨文件契约用例锁着「别换回读 supported」。
     *
     * ## 它**不**承诺本次这批规则条条生效（代码双审 r2 GLM-01）
     *
     * 上一版这里写的是「本次注入的那些逐文件路径真的挡住了」，**那比字段能知道的更多**：
     * 取值来自探针夹具里的单条 ASCII 路径，而**本次**注入的那批规则可能含
     * 被 `denyPathRepresentable` 跳过的路径、或含 glob 元字符而字面匹配不上的路径。
     * 逐条结果看 `trace.json` 的 `denySettings.skippedPaths`，
     * 规模与跳过条数另经 `CriticResult` 进判定面（见 `deny_skipped`）。
     *
     * **同文件 249-250 行**（`denyPathRepresentable` 的立理由）一直写的就是准确口径，
     * 而这里的旧措辞与它并存自相矛盾了整整一轮——r1 应答件承诺过改它，**没落地**。
     */
    peer_deny_applied: probe.path_deny.file_shape_verified === true,
    /*
     * 本次注入的规模与跳过条数**进判定面**（代码双审 r2 CODEX-01）。
     *
     * `peer_deny_applied` 读探针格，对本次这批规则一无所知；跳过项此前只躺在
     * `trace.json` 而全仓无消费方，且两条失败出口在写它**之前**就 return。
     * 有了这三格，`report.ts` 才能在 `deny_skipped > 0` 时推一条与
     * 「路径级 deny 未生效」同档的降级旗标。
     *
     * **字节数与另两格同路**（代码双审 r3 GLM-08 ≡ CODEX-03）：r2 承诺三格并列，
     * 上一版只落了两格，字节数困在 `trace.json` 里——而它才是 ARG_MAX 预算的
     * 主要消费者（条数看不出规模），超软上限的情形在 `run.json` 层此前完全不可见。
     */
    deny_skipped: deny.skipped.length,
    deny_rule_count: deny.ruleCount,
    deny_bytes: deny.bytes,
    command_line: o.commandLine,
    usage: trace.costUsd !== null ? { cost_usd: trace.costUsd } : undefined,
    // successful 只用于计数与路径，这里显式点名避免被读成「未使用」
    ...(successful.length === 0 ? {} : {}),
  };
}

export const claudeAdapter: CriticAdapter = {
  critic: 'claude',
  /*
   * 结构化轨迹族：读取路径有结构化字段，且**被拒的调用留在轨迹里**。
   *
   * `rejectionRecorded: true` 的依据是 M9 第 1 步的正向样本（报告 §3.1 第 3 条）：
   * 模型真发起了 `Write`、收到 `is_error` 的 `tool_result`
   * （`No such tool available: Write…in subagents as well as here`）、文件未创建。
   * 探针那一格偶尔落 `null` 是「没测到」（依赖模型这轮去没去调写工具），**不构成反证**。
   */
  capability: TOOL_TRACE_CAPABILITY,

  availability(ctx: AdapterContext) {
    // 两态判据同另三家：以 probed_at 区分「没探过」与「探过没找到」
    const p = ctx.cfg.probe.cli.claude;
    if (!p?.probed_at) {
      return { ok: false, reason: 'claude 尚未探测，请先运行 trivium doctor --only claude' };
    }
    if (!p.entrypoint) {
      return { ok: false, reason: '探针未找到 claude 可执行文件，请先运行 trivium doctor' };
    }
    if (p.readonly_flags.length === 0) {
      return {
        ok: false,
        reason:
          '探针未实测到可用的只读旗标——**这包括只读负对照失败的情形**' +
          '（负对照落了文件时探针会把该字段清空）。无法保障审查员只读，该侧不可用。',
      };
    }
    /*
     * MCP 硬前置必须**确认在场**，且判据读那一格而不是 `readonly_flags.length > 0`。
     *
     * 两者**不同真同假**（`types.ts` 该字段的文档逐条说明，r2 三侧独立打中过）：
     * 工具面读回为空那条路是 `null` 对 `false`；`existing` 保留上一轮清单而本轮
     * 拿不到 `init` 那条路是「数组非空而字段 null」。
     *
     * 漏掉这条硬前置的后果：用户已连接的 MCP 写工具（发信、云盘创建与共享）
     * 进入审查会话工具面——那是能越出项目边界的失守面，且单次成本约 24 倍。
     */
    if (p.strict_mcp_config_applied !== true) {
      return {
        ok: false,
        reason:
          `探针未确认 MCP 硬前置旗标在场（strict_mcp_config_applied=${p.strict_mcp_config_applied}）。\n` +
          '  null 是「本轮没核对成」，false 是「确认不在」——两者都不足以保障工具面干净。\n' +
          '  请重跑 trivium doctor --only claude。',
      };
    }
    if (p.headless_read_ok === false) {
      return { ok: false, reason: 'claude headless 读不到文件，该侧无法作为审查员使用' };
    }
    if (p.headless_read_ok === null) {
      return {
        ok: false,
        reason: '探针尚未实测 claude 的 headless 读取能力（上次探测没跑完），请重跑 trivium doctor --only claude',
      };
    }
    if (p.tool_surface_checked !== true) {
      return {
        ok: false,
        reason:
          `探针未核对过生效工具面（tool_surface_checked=${p.tool_surface_checked}）。\n` +
          '  没核对成就不知道白名单有没有真生效，只读保障无从谈起。',
      };
    }
    /*
     * 白名单派生不出来 ⇒ 该侧不可用（fail-closed 的前半）。
     * 后半是 `buildClaudeResult` 里的运行期断言——两层独立，各自可失效而不互相依赖。
     */
    if (readonlyToolsFromProbe(p.readonly_flags).length === 0) {
      return {
        ok: false,
        reason:
          '从只读旗标里派生不出工具白名单——无法判定「白名单外的工具调用」，\n' +
          '  只读失守检测在本侧失效。请重跑 trivium doctor --only claude 并检查落盘形态。',
      };
    }
    return { ok: true };
  },

  /**
   * 探活。
   *
   * `fingerprint()` **返回 `null` 并写明理由**：claude 的登录态在系统钥匙串里，
   * `~/.claude` 下没有凭据文件，**无从算指纹**。`null` 的契约语义就是
   * 「这一侧没有可哈希的凭据载体」，缓存因此只由 TTL 与 CLI 版本约束——
   * 这与「算出来是空字符串」不是一回事，后者会让任何凭据变更都命中缓存。
   */
  authProbe(ctx: AdapterContext, projectRoot: string) {
    const cfg = ctx.cfg;
    return {
      async fingerprint(): Promise<string | null> {
        return null;
      },
      async probe(): Promise<{ ok: boolean; detail: string }> {
        const p = cfg.probe.cli.claude;
        const bin = p?.entrypoint ?? null;
        if (!bin) return { ok: false, detail: 'claude 入口未记录' };
        if (!p || p.readonly_flags.length === 0) {
          return { ok: false, detail: '探针没有可用的只读旗标，拒绝在无护栏下拉起' };
        }
        const out = await invokeClaude({
          bin,
          cwd: projectRoot,
          prompt: '只回复 OK 两个字母，不要调用任何工具。',
          model: null, // 探的是登录态不是模型路由
          readonlyArgs: readonlyArgsFromProbe(p.readonly_flags),
          schemaJson: null,
          settingsJson: null,
          timeoutMs: 120_000,
        });
        const trace = parseClaudeEvents(out.stdout);
        const ok = trace.completed && !out.timedOut;
        return {
          ok,
          detail: ok
            ? `探活通过（${Math.round(out.durationMs / 1000)}s）`
            : `探活失败：${out.stderr.slice(0, 200) || '(无错误消息)'}。\n` +
              '  请确认本机 claude 已登录（登录态在系统钥匙串，编排器不代管凭据）。',
        };
      },
    };
  },

  /*
   * `scrubRunDir` **刻意不实现**。
   *
   * claude 的凭据走自身登录态（系统钥匙串），运行目录里**没有副本**——
   * 与 codex 把三份 toml/json 裁剪进 `codexhome/` 不同。清扫会如实记
   * 「该侧无载体」，而不是记一次「抹过了」：**「没得抹」与「抹过了」不能长得一样**
   * （`base.ts` 的契约，与 `authProbe?` 同一口径）。
   *
   * 给它加一个空实现会把前者伪装成后者，所以这里**不写**，不是忘了写。
   */

  async run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
    const probe = ctx.cfg.probe.cli.claude;
    if (!probe?.probed_at) {
      return failedResult('claude', {
        status: 'failed',
        reason: 'claude 尚未探测，请先运行 trivium doctor --only claude',
      });
    }
    if (!probe.entrypoint) {
      return failedResult('claude', { status: 'failed', reason: 'claude 入口未探测到' });
    }
    const bin = probe.entrypoint;
    const readonlyArgs = readonlyArgsFromProbe(probe.readonly_flags);
    const readonlyTools = readonlyToolsFromProbe(probe.readonly_flags);

    await ensureDir(req.out_dir);
    const stdoutPath = path.join(req.out_dir, 'stdout.jsonl');
    const tracePath = path.join(req.out_dir, 'trace.json');

    /*
     * 降级原因收集到**机读落点**（`trace.json`），不是只写进散文。
     *
     * 「没注入」与「注入了但被拒」不能长得一样，而「为什么没注入」同样要留痕——
     * 否则事后看到 `peer_deny_applied: false` 无从判断是探针没支持、规则拼不出、
     * 还是根本没走到那一步（M9 第 3 步计划双审 §2.3）。
     */
    const degradations: string[] = [];

    // schema 读文件留在这一层：buildClaudeArgs 要保持纯函数
    let schemaJson: string | null = null;
    if (probe.json_schema_ok === false) {
      degradations.push('json_schema_ok=false：探针实测该旗标不可用，本次不传，改由提示词约定 + 宽松解析');
    } else {
      try {
        schemaJson = await readSchemaJson(req.schema_path);
      } catch (e) {
        // 读不到就降级不传，并如实记原因——不拿一个猜的 schema 硬拼
        schemaJson = null;
        degradations.push(`schema 文件读不到（${(e as Error).message}），本次不传 --json-schema`);
      }
    }

    /*
     * deny 规则：外壳从 `rule_syntax` 解析，路径按 `req.deny_paths` 逐条生成。
     *
     * **`supported !== true` 时不注入**，而 `file_shape_verified === false`
     * （EV-42 否定结案）时**仍然注入**：`deny_paths` 是混合集，逐文件条目实测无效
     * 不等于目录条目无效，丢弃整份会把目录条目那部分尚存的纵深一并放弃，
     * 换不来任何安全收益——`peer_deny_applied` 已由那一格结构性判成 false，
     * 不存在「把没验过的事记成 true」的风险（M9 第 3 步计划双审 §2.3）。
     */
    const denyShape =
      probe.path_deny.supported === true ? denyRuleShapeOf(probe.path_deny.rule_syntax) : null;
    const deny = buildDenySettings(req.deny_paths, readonlyTools, denyShape);
    const settingsJson = deny.json;
    /*
     * **两条失败出口也要拿到它**（代码双审 r3 GLM-04 ≡ CODEX-04）。
     *
     * deny 在这里就建好并注入了，而超时与「未产出最终回复」两条 return
     * 发生在**写 `trace.json` 之前**——`trace.json` 是跳过项逐条记名的唯一落点，
     * 于是那两条路径上「注入了多少、跳过了多少」此前一个字都留不下，
     * `run.json` 记的是三个硬编码的 0。
     */
    const denyPayload = { skipped: deny.skipped.length, ruleCount: deny.ruleCount, bytes: deny.bytes };
    if (!settingsJson && req.deny_paths.length > 0) {
      degradations.push(
        `未注入 --settings（path_deny.supported=${probe.path_deny.supported}、` +
          `规则外壳=${denyShape ? '可解析' : '解析不出'}）——第 ③ 道屏蔽本次由事后轨迹核验独担`,
      );
    }
    /*
     * **第三种语义：这条路径无法表示成规则**（代码双审 r1 CODEX-02）。
     *
     * 此前只有「没注入」与「注入了但被拒」两格。跳过的路径若不逐条记因，
     * 就是**禁读通道死了一条而没人看得见**——而 `peer_deny_applied` 读的是探针格，
     * 它对本次这批规则一无所知。
     */
    for (const p of deny.skipped) {
      /*
       * **不枚举成因**（代码双审 r3 GLM-05）。上一版写的是「含圆括号或换行」，
       * 而判据在 r2 已扩到九个字符、r3 又扩到十二个——枚举式文案与判据
       * **必然**再次漂移（这已是第二次），主题名带星号触发的跳过会被记成错误成因。
       * 指向留痕的写法不会漂：判据改了，`skippedPaths` 照样是那份逐条清单。
       */
      degradations.push(
        `禁读路径拼不出一条能字面匹配它自己的规则，已跳过（逐条见 trace.json 的 denySettings.skippedPaths）：${p}`,
      );
    }
    /*
     * 规模软闸（CODEX-03）。整份 settings 进**单个 argv 项**，越界就是 spawn 失败（E2BIG）。
     * 这里**只告警不拦**：真拦掉等于主动放弃第 ③ 道屏蔽，而越界本身会响亮失败；
     * 告警的作用是让「快到上限了」在事后可见，不必等它真炸。
     */
    if (deny.bytes > DENY_SETTINGS_SOFT_CAP_BYTES) {
      degradations.push(
        `--settings 规模 ${deny.bytes} 字节 / ${deny.ruleCount} 条规则，` +
          `已越过软上限 ${DENY_SETTINGS_SOFT_CAP_BYTES}（ARG_MAX 的 1/8）——` +
          '它与 prompt、schema、env 共用 ARG_MAX，继续增长会 spawn 失败',
      );
    }

    let out: ClaudeInvokeOutcome;
    try {
      out = await invokeClaude({
        bin,
        cwd: req.project_root,
        prompt: req.brief_text,
        model: req.model,
        readonlyArgs,
        schemaJson,
        settingsJson,
        timeoutMs: req.timeout_s * 1000,
      });
    } catch (e) {
      return failedResult('claude', {
        status: 'failed',
        reason: `拉起 claude 失败：${(e as Error).message}`,
      });
    }

    await fs.writeFile(stdoutPath, out.stdout, 'utf8');
    const trace = parseClaudeEvents(out.stdout);

    if (out.timedOut) {
      return failedResult('claude', {
        status: 'timeout',
        reason: `脚本级超时（${req.timeout_s}s）`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: trace.sessionId,
        deny: denyPayload,
      });
    }

    if (!trace.completed) {
      /*
       * 没有 result 事件、或它是错误形态，即视为没跑成。
       * 退出码不足以判定——错误路径的 result（预算掐断、max_turns）也可能退 0。
       */
      const why = trace.toolErrors.slice(0, 2).join('；') || out.stderr.slice(0, 300);
      return failedResult('claude', {
        status: 'failed',
        reason: `claude 未产出最终回复：${why || '(无错误消息)'}`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: trace.sessionId,
        deny: denyPayload,
      });
    }

    await fs.writeFile(
      tracePath,
      JSON.stringify(
        {
          sessionId: trace.sessionId,
          init: trace.init,
          toolUses: trace.toolUses,
          toolErrors: trace.toolErrors,
          permissionDenials: trace.permissionDenials,
          eventCount: trace.eventCount,
          /*
           * Grep 结果解析留痕（EV-76 出路 ①，计划双审 CODEX-07）：
           * `hits` = content 命中（去重后，进判定面）；`listed` = 另两档（去重后，只留痕）；
           * `resultLines` = 成功 Grep 结果的非空行总数（去重前）。格式漂移 = hits 归零而 resultLines 不为零。
           */
          grep: parseGrepResults(trace, req.project_root),
          denySettings: {
            injected: settingsJson !== null,
            ruleCount: deny.ruleCount,
            // **字节数要记**：它是 ARG_MAX 预算的主要消费者，只记条数看不出规模
            bytes: deny.bytes,
            skippedPaths: deny.skipped,
            denyPathsRequested: req.deny_paths.length,
            fileShapeVerified: probe.path_deny.file_shape_verified,
          },
          /*
           * 本次发生过的降级，逐条记。空数组的含义是「没有降级」，
           * 与「没记录降级」不同——后者不会出现，因为这个键**恒在**。
           */
          degradations,
        },
        null,
        2,
      ),
      'utf8',
    );

    return buildClaudeResult(trace, out, { stdout: stdoutPath, trace: tracePath }, probe, readonlyTools, deny, {
      fallbackRoot: req.project_root,
    });
  },
};
