/**
 * Claude Code 的 `stream-json` 轨迹解析（M9 第 3 步）。
 *
 * ## 为什么住在 `adapters/` 而不是 `probes/`
 *
 * 原先 `parseClaudeEvents` 与 `ClaudeTrace` 住在 `probes/claude.ts`，而适配层
 * **不得 import `probes/`**（`registry-parity` 第 5 条）。三家先例的方向都是
 * **探针反向 import 适配层**（`probes/agy.ts` ← `adapters/agy-events.ts`、
 * `probes/zcode.ts` ← `adapters/zcode-trace.ts`、codex 同构），本文件照此搬家。
 * 一处事实一个来源，不出现两份解析器。
 *
 * ## 为什么只有解析器搬过来，两个只读常量留在探针侧
 *
 * `READONLY_INVARIANTS` 与 `READONLY_TOOLS` **必须留在 `probes/claude.ts`**。
 * 把它们搬进 `adapters/` 会让 `registry-parity` 第 6 条的**两条腿同时响亮打红**：
 * 主扫命中黑名单 token，正向防空转腿发现 token 已不在 `probes/` 出现。
 *
 * **理由是「会当场红」，不是「会静默绿」**——计划原稿写的是后者，被计划双审
 * GLM-04 逐条验过打回（两条腿都是响亮失败，不是静默通过）。结论不变，机理写准。
 *
 * ## 本文件里的裸工具名是允许的，但只在本文件族
 *
 * 下面的 `CLAUDE_READ_TOOLS` 等常量里有裸 `'Read'` / `'Grep'` / `'Glob'`。
 * `registry-parity` 第 6 条的黑名单锁的是**全形** `'Read,Grep,Glob'`（逗号连写），
 * 而「分解形加强判据」的论域是 **全部适配器文件 − `-trace` / `-events` 分类文件族**
 * ——本文件属于豁免的那一族。
 *
 * 分工的道理：分解形要咬的是「argv 构造处把只读工具名拆开写」这一种规避，
 * 而 trace 文件族按职责就要出现裸工具名做事件分类
 * （`zcode-trace.ts` 的 `ZCODE_READ_TOOLS` 是现成先例）。
 *
 * > **措辞改准（代码双审 r2 AGY-03 ≡ GLM-07 ≡ CODEX-07）**：上一版这里写的是
 * > 「只对 `adapters/<cli>.ts` 精确匹配生效」，那是 **r1 修复之前**的论域，
 * > 而 r1 的 CODEX-05 ≡ AGY-01 ≡ GLM-04 正是要求把它从「单个主文件」**扩到全域**
 * > （codex 家配方无逗号项 ⇒ 分解形集合为空 ⇒ 跨厂商文件整段 no-op）。
 * > 照旧文本去「对齐实现」，最省事的动作就是把论域收窄回去——
 * > **那会直接削掉 r1 刚补齐的跨厂商能力**，正是 EV-39 自己担心的事。
 * > 权威措辞以设计 v1.3.26 为准。
 *
 * 另注：本文件**不需要** `LITERAL_ALLOWLIST` 条目——那是 Agent id 字面量扫描
 * （防的是硬编码 `'claude'` 这类身份串），**与第 6 条黑名单是两回事**，
 * 只要本文件不出现带引号的 `'claude'` 即可（同 `codex-trace.ts`）。
 */
import { hasRedactionMark } from '../secrets.js';

/** 一次 headless 调用解析出来的轨迹 */
export interface ClaudeTrace {
  /** `system/init` 回读的生效配置 */
  /**
   * `cwd` 是 CLI 在 `system/init` 里回报的工作目录（realpath 形态）。claude 侧它是构造性的
   * （`invokeClaude` 显式 `cwd: projectRoot`），采集它是为了给 Grep 命中的相对路径一个
   * **回读来的**基准，而不是靠调用方记得传（EV-76 出路 ①，计划双审 CODEX-04 ≡ GLM-03）。
   */
  init: { model: string | null; tools: string[]; permissionMode: string | null; cwd: string | null } | null;
  /** 全部 `tool_use`：工具名 + 参数 + id（id 用于与 tool_result 配对） */
  toolUses: { name: string; input: Record<string, unknown>; id: string | null }[];
  /** 出错的 `tool_result` 文本（白名单外工具走这条路，不进 permission_denials） */
  toolErrors: string[];
  /** 收到 `is_error` 结果的那些 `tool_use_id`——判据要配对，不能只数错误条数 */
  erroredToolUseIds: Set<string>;
  /**
   * **成功** `tool_result` 的文本，按 `tool_use_id` 配对。
   *
   * 此前解析器只留 `is_error` 的结果，成功结果的内容被丢弃——于是目录级 Grep 命中了哪些文件
   * 无从得知，J5 只能看见 `Grep(path=doc)` 这一条入参（EV-76）。这里只存文本，不做任何解释；
   * 解释在 `parseGrepResults`。
   */
  toolResults: Map<string, string>;
  /** `result` 事件里的权限拒绝记录（路径级 deny 走这条路） */
  permissionDenials: { tool_name: string; tool_input: Record<string, unknown> }[];
  finalText: string | null;
  sessionId: string | null;
  costUsd: number | null;
  /**
   * 跑完了没有。
   *
   * 判据是「有 `result` 事件**且它不是错误形态**」——错误路径的 result
   * （预算掐断、max_turns 一类）不算跑完（审查意见 GLM-05）。
   *
   * 初版只看「存在 type === 'result'」，忽略事件自带的 `is_error` / `subtype`，
   * 而注释却写着「与另两家同口径」——codex 的 `traceCompleted` 要求
   * 「有最终回复」，错误运行拿不到回复即未完成。两边并不同口径，
   * 后果是错误路径被塌缩成「测了，答案是读不到文件」的确定否定。
   *
   * 判据取**保守形态**：不是 success 就按未得出结论处理。
   * 不枚举已知的错误 subtype——那些取值我没有实测样本（见 M6 第 3 步报告边界）。
   */
  completed: boolean;
  /**
   * 成功解析出的事件条数。
   *
   * 立此字段是为了让 `judgeVerboseBinding` **复用本解析器的口径**，
   * 而不是在它自己那边再写一份「什么算一条事件」（代码双审 CODEX-07）——
   * 两处各存一份判据，日后事件行格式一变就会分叉，
   * 正是本轮在 `path_deny` 上刚消掉的同一形态。
   *
   * 口径即下方循环的口径：`{` 开头且 `JSON.parse` 成功的行。坏行不计。
   */
  eventCount: number;
}

/**
 * 解析 `--output-format stream-json` 的 JSONL。
 *
 * 坏行跳过而不是抛：真实输出里混过非 JSON 的提示行。
 */
export function parseClaudeEvents(jsonl: string): ClaudeTrace {
  let init: ClaudeTrace['init'] = null;
  const toolUses: ClaudeTrace['toolUses'] = [];
  const toolErrors: string[] = [];
  const erroredToolUseIds = new Set<string>();
  const toolResults = new Map<string, string>();
  let permissionDenials: ClaudeTrace['permissionDenials'] = [];
  let finalText: string | null = null;
  let sessionId: string | null = null;
  let costUsd: number | null = null;
  let completed = false;
  let eventCount = 0;

  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    eventCount += 1;
    if (typeof o['session_id'] === 'string') sessionId = o['session_id'];

    if (o['type'] === 'system' && o['subtype'] === 'init') {
      init = {
        model: typeof o['model'] === 'string' ? o['model'] : null,
        tools: Array.isArray(o['tools']) ? (o['tools'] as string[]) : [],
        permissionMode: typeof o['permissionMode'] === 'string' ? o['permissionMode'] : null,
        cwd: typeof o['cwd'] === 'string' ? o['cwd'] : null,
      };
    }

    const message = o['message'] as { content?: unknown } | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const raw of content) {
        const b = raw as Record<string, unknown>;
        if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
          toolUses.push({
            name: b['name'],
            input: (b['input'] as Record<string, unknown> | undefined) ?? {},
            id: typeof b['id'] === 'string' ? b['id'] : null,
          });
        }
        if (b['type'] === 'tool_result' && b['is_error'] === true) {
          toolErrors.push(typeof b['content'] === 'string' ? b['content'] : JSON.stringify(b['content']));
          if (typeof b['tool_use_id'] === 'string') erroredToolUseIds.add(b['tool_use_id']);
        } else if (b['type'] === 'tool_result' && typeof b['tool_use_id'] === 'string') {
          toolResults.set(b['tool_use_id'], resultText(b['content']));
        }
      }
    }

    if (o['type'] === 'result') {
      /*
       * 保守形态：`is_error` 为真、或 `subtype` 存在且不是 success，一律不算跑完。
       * 错误 result 的具体取值没有实测样本，所以按「不是 success 就存疑」判，
       * 而不是枚举已知错误类型——枚举漏一个就退回旧行为。
       */
      const sub = typeof o['subtype'] === 'string' ? o['subtype'] : null;
      completed = o['is_error'] !== true && (sub === null || sub === 'success');
      if (typeof o['result'] === 'string') finalText = o['result'];
      if (typeof o['total_cost_usd'] === 'number') costUsd = o['total_cost_usd'];
      if (Array.isArray(o['permission_denials'])) {
        permissionDenials = o['permission_denials'] as ClaudeTrace['permissionDenials'];
      }
    }
  }

  return {
    init,
    toolUses,
    toolErrors,
    erroredToolUseIds,
    toolResults,
    permissionDenials,
    finalText,
    sessionId,
    costUsd,
    completed,
    eventCount,
  };
}

// ─────────────────────── 工具面分类与路径提取（M9 第 3 步新增） ───────────────────────

/**
 * 只读工具面里的读类工具。
 *
 * **这不是安全不变量的副本**：安全不变量（哪些工具被允许）由探针实测挣来、
 * 经 `probe.readonly_flags` 原样透传，适配层不得字面重建。本集合回答的是
 * 另一个问题——**轨迹里这次调用该归到哪一类计数**，是事后核验的分类表。
 *
 * 两者今天取值重合，而**来源与失效方式不同**：探针那份被清空时该侧判不可用；
 * 本集合是解析器的分类依据，与该侧可不可用无关。
 */
export const CLAUDE_READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/**
 * CLI 自己注入的**输出通道**工具——既不是读，也不是写。
 *
 * **实测依据（2026-09-19，M9 第 6 步验收 run `20260919T120643Z`，claude 2.1.277）**：
 * 带 `--json-schema` 时 `system/init` 的 `tools` 为 `Glob、Grep、Read、StructuredOutput`，
 * 模型通过调用 `StructuredOutput` 交付最终 JSON（本次调了 5 次，前 4 次形态不对被 CLI 打回）。
 * 它不在 `--tools` 白名单里（白名单是 `Read,Grep,Glob`），按「白名单外即写事件」的判据
 * 会被算成 5 次写、`readonly_breach: true`——而它一个字节都没落盘。
 *
 * 探针没拦住：`json_schema_ok` 那一臂与工具面 / 写事件两臂是**分开跑**的，
 * 工具面核对时没带 `--json-schema`，从未见过这个工具名（BACKLOG EV-75）。
 *
 * 只豁免这一个名字。它出现在轨迹里是**结构化输出生效**的正向证据，不是失守。
 */
export const CLAUDE_OUTPUT_TOOLS = new Set(['StructuredOutput']);

/**
 * 读类工具里**必然带路径**的那一档（设计 §10.1.1 第②层的覆盖率分母）。
 *
 * **只有 `Read`，与 agy 侧的四个不同**——这不是口径不统一，是厂商契约的差异：
 * 本侧 `Grep` / `Glob` 的路径参数是**可选**的（不传即从当前工作目录搜），
 * 把它们计进分母会让降级档位变成**稳态噪声**，淹掉真信号。
 *
 * **与 `zcode-trace.ts` 的 `ZCODE_MUST_HAVE_PATH` 同形且同因**（那一侧的注释
 * 把理由写过一遍）。两家分母相同、与 agy 不同这件事本身要写明，
 * 否则下一个人会以为其中一侧漏配了。
 */
export const CLAUDE_MUST_HAVE_PATH = new Set(['Read']);

/**
 * 各工具的参数里，路径可能叫这几个名字。**逐键的证据等级不同，如实标注**：
 *
 * | 键 | 证据 |
 * | :--- | :--- |
 * | `file_path` | **本侧实测样本证过**：`test/fixtures/claude-events/*.jsonl` 里 `Read` 与 `Write` 的 `tool_use.input` 都用它 |
 * | `path` | **本侧无实测样本**。旁证是同族衍生 CLI（`zcode-trace.ts` 的 `ZCODE_PATH_KEYS` 含它，M0 实测），工具面同源 |
 * | `notebook_path` | **本侧无实测样本**，同上旁证；宽收无代价（键不存在就取不到） |
 *
 * ## 为什么明知无样本也要收 `path`
 *
 * 设计 §3.7 对 M9 写死了一条：「CLI 层的路径拦截**不完整**，事后轨迹核验仍是
 * 必需项，**且必须覆盖 `Grep` 的 `path` 参数**」——`permissions.deny` 对 `Grep`
 * 实测**不生效**，那条通道的唯一兜底就是这里。收不到就等于那条兜底不存在。
 *
 * 而 v1.3.12 教训七记过同一形态的实账：措施 a 对 agy 的 grep 通道**全盲**，
 * 因为 `PATH_KEYS` 不含它的搜索目录参数名，实测 15 次 grep 提出 **0** 条路径。
 * 修法就是把那个键名加进去。宽收的代价是 0，漏收的代价是一条兜底静默失效。
 *
 * ## 待取证（M9 第 3 步 EV-43 复验时办）
 *
 * EV-43 的 `path_deny` 那格**必跑 Grep 臂**，届时把真实事件流落一份进
 * `test/fixtures/claude-events/`，本表的第二、三行即可从旁证升为实测。
 * **不靠记性**：`claude-trace.test.ts` 有一条契约用例扫全部夹具样本，
 * 凡值呈路径形态的 `tool_use.input` 键都必须在本表里，键名不对**当场红**。
 */
export const CLAUDE_PATH_KEYS = ['file_path', 'path', 'notebook_path'];

/** 从一次 `tool_use` 的参数里提取路径；取不到返回 null（如 Grep 只给了 pattern） */
export function extractClaudePath(input: Record<string, unknown>): string | null {
  for (const k of CLAUDE_PATH_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * 成功执行的 `tool_use`——即**没有**收到 `is_error` 结果的那些。
 *
 * 读取证据必须按这个口径算，不能拿全集：**被 deny 挡住的 `Read` 不算读到了东西**，
 * 不排掉会让路径级 deny 真正生效时反而抬高证据计数（方向正好相反）。
 * 与 `agy-events.ts` 的同名手法同构。
 */
export function successfulToolUses(trace: ClaudeTrace): ClaudeTrace['toolUses'] {
  return trace.toolUses.filter((u) => u.id === null || !trace.erroredToolUseIds.has(u.id));
}

/** 成功读取到的项目路径（去重，保持首次出现顺序） */
export function readPaths(trace: ClaudeTrace): string[] {
  const out = new Set<string>();
  for (const u of successfulToolUses(trace)) {
    if (!CLAUDE_READ_TOOLS.has(u.name)) continue;
    const p = extractClaudePath(u.input);
    if (p) out.add(p);
  }
  return [...out];
}

// ─────────────────────── Grep 结果解析（EV-76 出路 ①，M9 第 6 步后） ───────────────────────

/** `tool_result.content` 的文本形态：字符串，或 `{type:'text',text}` 数组 */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((x) => (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : ''))
      .join('\n');
  }
  return '';
}

/**
 * Grep 三种 `output_mode` 的输出格式（claude 2.1.277 实测，夹具 `grep-*.jsonl`）：
 *
 * | 模式 | 行形态 | 噪声行 |
 * | `content` | `<相对项目根的路径>:<行号>:<文本>`；`path` 为单文件时是 `<行号>:<文本>`（无路径） | `[Showing results with pagination …]` |
 * | `count` | `<路径>:<计数>` | 空行、`Found N total occurrences across M files.` |
 * | `files_with_matches`（缺省） | `<路径>` | `Found N files`、`No files found` |
 *
 * 路径**相对 cwd**（= 项目根），不是相对 `path` 参数——`path: <ROOT>/src` 的命中仍写作 `src/…`。
 *
 * **分档消费**（计划双审 CODEX-01 ≡ GLM-01）：只有 `content` 的文本真实进入模型上下文，
 * 它的命中才算「读过」，进 `hits`（J5 匹配集 + 措施 a）；`count` / `files_with_matches`
 * 只披露存在性，与 Glob 同档，进 `listed` 只留痕、不消费。
 *
 * **只认严格形态、不猜**：提取出的路径不得以数字开头、不含空白、须含 `/` 或 `.`——
 * 文件级 Grep 的 `7:  a ? 1:2:3` 这类文本被第一条挡掉；代价是根目录下无扩展名的文件
 * （`Dockerfile`）会被丢，属可接受的假阴性（用例 T2 锁这条边界）。
 * 格式漂移的症状是 `hits` 归零而 `resultLines` 不为零——两格一起落 trace.json 才分得开。
 */
export interface GrepResults {
  /** `content` 模式命中的文件（绝对路径，去重、保序） */
  hits: string[];
  /** `count` / `files_with_matches` 列出的文件（绝对路径，去重）——只留痕 */
  listed: string[];
  /** 成功 Grep 结果的非空行总数（去重前、含噪声行）：漂移诊断用 */
  resultLines: number;
}

const GREP_CONTENT_LINE = /^([^\s:][^:]*?):(\d+):/;
const GREP_COUNT_LINE = /^([^\s:][^:]*?):(\d+)$/;
const GREP_NOISE_LINES = [/^Found \d+ files?$/, /^Found \d+ total occurrences/, /^No files found/, /^\[Showing results/];

function grepPathLike(s: string): boolean {
  return s.length > 0 && !/^\d/.test(s) && !/\s/.test(s) && (s.includes('/') || s.includes('.'));
}

export function parseGrepResults(trace: ClaudeTrace, fallbackRoot: string | null): GrepResults {
  const base = trace.init?.cwd ?? fallbackRoot;
  const hits = new Set<string>();
  const listed = new Set<string>();
  let resultLines = 0;
  const absolutize = (p: string): string | null => {
    if (p.startsWith('/')) return p;
    if (base === null) return null;
    return `${base.replace(/\/+$/, '')}/${p.replace(/^\.\//, '')}`;
  };
  for (const u of successfulToolUses(trace)) {
    if (u.name !== 'Grep' || u.id === null) continue;
    const text = trace.toolResults.get(u.id);
    if (text === undefined) continue;
    const mode = typeof u.input['output_mode'] === 'string' ? u.input['output_mode'] : 'files_with_matches';
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      if (line.trim() === '') continue;
      resultLines += 1;
      if (GREP_NOISE_LINES.some((re) => re.test(line))) continue;
      let p: string | null = null;
      let target: Set<string> | null = null;
      if (mode === 'content') {
        const m = GREP_CONTENT_LINE.exec(line);
        if (m) { p = m[1]!; target = hits; }
      } else if (mode === 'count') {
        const m = GREP_COUNT_LINE.exec(line);
        if (m) { p = m[1]!; target = listed; }
      } else {
        p = line;
        target = listed;
      }
      if (p === null || target === null || !grepPathLike(p)) continue;
      const a = absolutize(p);
      if (a !== null) target.add(a);
    }
  }
  return { hits: [...hits], listed: [...listed], resultLines };
}

/** `content` 模式命中的文件——「读过」的那一档 */
export function grepHitPaths(trace: ClaudeTrace, fallbackRoot: string | null): string[] {
  return parseGrepResults(trace, fallbackRoot).hits;
}

/**
 * 路径提取的覆盖率（设计 §10.1.1 第②层）。
 *
 * 分母只含 `CLAUDE_MUST_HAVE_PATH`。两者不等即**提取器已相对厂商参数名退化**——
 * 厂商改了参数名而 `CLAUDE_PATH_KEYS` 没跟上时，这一格是唯一会说话的地方。
 *
 * 口径与 agy / zcode 两家同构：`total` 是必带路径的调用数，
 * `withPath` 是其中真提到了路径的。**两个计数都要无条件填进 `CriticResult`**，
 * 算不出写 `null` 也不要省略键——`zcode.ts` 那边记过，省略键会让
 * `verification.path` 档位恒为 `ok`，等于拿 ok 填「不知道」。
 */
export function pathCoverage(trace: ClaudeTrace): { total: number; withPath: number } {
  let total = 0;
  let withPath = 0;
  for (const u of successfulToolUses(trace)) {
    if (!CLAUDE_MUST_HAVE_PATH.has(u.name)) continue;
    total += 1;
    if (extractClaudePath(u.input)) withPath += 1;
  }
  return { total, withPath };
}

/**
 * 按读类工具分别计数。
 *
 * **不产出 `run_command`**：该侧的只读工具面里**没有命令工具**（Bash 不在其中），
 * 给一个不存在的概念记 0 与「跑了 0 条命令」长得一样，而两者含义不同。
 * 这与 agy 不同——那边 `run_command` 是真实存在的失守信号。
 */
export function countTools(trace: ClaudeTrace): { read: number; grep: number; glob: number } {
  let read = 0;
  let grep = 0;
  let glob = 0;
  for (const u of successfulToolUses(trace)) {
    if (u.name === 'Read') read += 1;
    else if (u.name === 'Grep') grep += 1;
    else if (u.name === 'Glob') glob += 1;
  }
  return { read, grep, glob };
}

/**
 * 最终回复文本。
 *
 * **带 `--json-schema` 时它是一个 JSON 字符串、要再 parse 一次**
 * （`types.ts` 的 `json_schema_ok` 字段实测结论）。本函数只取原文，
 * 解析交给调用方——审查结论的 schema 校验在 `parse.ts` 那一层，不在这里。
 */
export function finalReviewText(trace: ClaudeTrace): string | null {
  return trace.finalText;
}

/**
 * 生效模型的回读判定（EV-257）——`buildClaudeResult`、探针 `model_flag` 与准入 / 收口脚本共用。
 *
 * 事件流在解析前已过脱敏（`scrubGatewayEnv`），`init.model` 若带脱敏痕迹（占位符或首尾预览），
 * 说明回读被吞了：记 null + `unverified`，**不让占位符以回读成功的形态落盘**（AC-20）。
 * 这一道独立于逐值替换的键名划分——不靠那边划得完备。
 * 缺失或空串时与修复前的表达式逐字相同（`init?.model ?? null` 配 `init?.model ? … : 'unverified'`）。
 */
export function claudeModelReadback(init: ClaudeTrace['init']): { model: string | null; source: 'envelope' | 'unverified' } {
  const model = init?.model ?? null;
  if (hasRedactionMark(model)) return { model: null, source: 'unverified' };
  return { model, source: model ? 'envelope' : 'unverified' };
}
