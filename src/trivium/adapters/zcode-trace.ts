/**
 * ZCode 输出与会话日志解析（纯函数，无 I/O）。
 *
 * M0 实测确立的两件事：
 *   1. `--json` 的 stdout **不是纯 JSON**——前面可能有 `AI SDK Warning System: …` 之类的
 *      告警行。因此不能 `JSON.parse(stdout.trim())`，必须先把 envelope 抠出来。
 *   2. envelope 里**没有 model 字段**，生效模型只能从会话日志的 `context.model` 回读。
 *      这是 AC-13「两侧 model_effective 与指定一致」的唯一取值点。
 */
import type { ToolCallCounts } from '../types.js';
import { redactSecrets } from '../secrets.js';
import { MCP_WRITE_EVENT_PREFIX } from './base.js';

export interface ZcodeEnvelope {
  sessionId: string | null;
  traceId: string | null;
  turnId: string | null;
  /** 正文字段。设计记载为 .response，M0 实测确认 */
  response: string;
  usage: Record<string, number>;
  eventCount: number | null;
  /** envelope 中出现过的全部字段名，供探针记录 */
  keys: string[];
}

/**
 * 从可能混有告警行的 stdout 中抠出 JSON envelope。
 *
 * 策略：从第一个 `{` 开始做括号配平扫描（跳过字符串内的括号），取第一个完整对象。
 * 比「按行找以 { 开头的行」稳健——envelope 是多行 pretty-print 的。
 */
export function extractJsonEnvelope(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i]!;
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(stdout.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseZcodeEnvelope(stdout: string): ZcodeEnvelope | null {
  const o = extractJsonEnvelope(stdout);
  if (!o) return null;
  return {
    sessionId: typeof o['sessionId'] === 'string' ? o['sessionId'] : null,
    traceId: typeof o['traceId'] === 'string' ? o['traceId'] : null,
    turnId: typeof o['turnId'] === 'string' ? o['turnId'] : null,
    response: typeof o['response'] === 'string' ? o['response'] : '',
    usage: o['usage'] && typeof o['usage'] === 'object' ? (o['usage'] as Record<string, number>) : {},
    eventCount: typeof o['eventCount'] === 'number' ? o['eventCount'] : null,
    keys: Object.keys(o),
  };
}

/**
 * ZCode 的读类工具。M0 实测模型会在被封一个之后换用另一个——这就是路径级 deny 无效的原因。
 * WebFetch / WebSearch 不在其列：出网不是「读项目」，把被审代码发到外部端点不该计入 AC-11 的证据。
 */
export const ZCODE_READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ReadSessionContext']);
/**
 * 读类工具里**必然带路径**的那一档（设计 10.1.1 第②层的覆盖率分母）。
 *
 * **只有 `Read`，与 agy 侧的四个不同**——这不是口径不统一，是厂商契约的差异：
 * 本侧 `Grep` / `Glob` 的 `path` 参数是**可选**的（不传即从当前目录搜），
 * 见下方 `ZcodeRolloutToolCall.path` 的注释；把它们计进分母会让降级档位
 * 变成稳态噪声，淹掉真信号。
 *
 * 两家分母不同这件事本身要写明，否则下一个人会以为其中一侧漏配了。
 */
export const ZCODE_MUST_HAVE_PATH = new Set(['Read']);
/** 写类工具与 shell：出现即 readonly_breach（FR-15 / AC-08） */
export const ZCODE_WRITE_TOOLS = new Set([
  'Write', 'Edit', 'MultiEdit', 'ApplyPatch', 'NotebookEdit', 'Bash',
]);

/** MCP 工具名的统一前缀（`mcp__〈server〉__〈tool〉`）。只认这个前缀；非 `mcp__` 开头的表外内置工具不在 EV-188 的论域 */
export const ZCODE_MCP_PREFIX = 'mcp__';
/**
 * 具名的执行型 MCP 工具，按 server 前缀登记：一被调用即进 `write_events`、判只读失守，与 `Bash` 同档（EV-188）。
 *
 * **实见出处**：「审查侧实测措辞约束」代码双审 run `20261002T023804Z` 的 glm 侧 rollout 共 25 次请求，每一次的工具清单都声明了
 * `mcp__node_repl__js`（Node 内核 JS 执行，经插件缓存带进副本 HOME）；同一台 server 另声明过 `js_add_node_module_dir`、`js_reset`。
 * 历史调用（截至 2026-10-02 本主题计划双审之后扫描：本仓保留的 214 份 glm 侧 rollout 里 38 份、共 95 次，跑过 `git`、`bash -c`、读项目外文件）见
 * `doc/05_testing/evidence/mcp-exec-detect-20261002/` 的扫描结果。
 *
 * **按 server 前缀而不是逐个工具名**：后两个工具本身不执行代码，但它们是同一个执行内核的控制面，同档处置更稳。
 * **新增一项要有实见依据**（某次运行的工具清单或调用记录），写进上面的出处。名单是常量、不进配置：放进配置就是给绕过检测开合法路径。
 */
export const ZCODE_MCP_EXEC_PREFIXES: readonly string[] = ['mcp__node_repl__'];

export function isZcodeMcp(name: string): boolean {
  return name.startsWith(ZCODE_MCP_PREFIX);
}

export function isZcodeMcpExec(name: string): boolean {
  return ZCODE_MCP_EXEC_PREFIXES.some((p) => name.startsWith(p));
}

export interface ZcodeTraceEvent {
  event: string;
  level: string;
  toolName: string | null;
  model: string | null;
  status: 'started' | 'completed' | 'failed' | null;
  /** 工具参数中的路径（如果日志里带） */
  path: string | null;
}

export interface ZcodeTrace {
  events: ZcodeTraceEvent[];
  /** 从 context.model 回读的生效模型——envelope 里没有这个字段 */
  modelEffective: string | null;
  toolCalls: ToolCallCounts;
  readPaths: string[];
  writeEvents: string[];
  /**
   * MCP 调用按工具名的次数（EV-188），只供与 rollout 合并（`summarizeZcodeMcp`）。
   * 每个名字取 `max(started 条数, completed + failed 条数)`：一次调用一条 started 一条终态，任一条丢了不少计、都在不重计。
   * **计的是尝试不是成功**——与下面写事件扫全部 `tool.call.*` 同口径；`toolCalls` 的四类仍只看 completed。
   */
  mcpCalls: Record<string, number>;
  /**
   * MCP 调用的 id → 工具名（EV-188）。日志行**顶层**的 `toolCallId` 与 rollout 的 `response.toolCalls[].id` 一一对应
   * （2026-10-02 核五次真实运行共 172 次调用，无一例外），合并时按它求并集；没有 `toolCallId` 的事件只进上面的按名计数。
   */
  mcpCallIds: Record<string, string>;
  turnFailed: boolean;
  failureCause: string | null;
}

function statusOf(event: string): ZcodeTraceEvent['status'] {
  if (event.endsWith('.started')) return 'started';
  if (event.endsWith('.completed')) return 'completed';
  if (event.endsWith('.failed')) return 'failed';
  return null;
}

/**
 * 解析会话日志 JSONL，只取属于指定 sessionId 的行。
 *
 * 共享 HOME 时同一个日志文件里有多个会话交织，必须按 sessionId 过滤；
 * 独立 HOME（`isolation: home_copy`）下日志天然隔离，传 null 即可全收。
 */
export function parseZcodeTrace(jsonl: string, sessionId: string | null): ZcodeTrace {
  const events: ZcodeTraceEvent[] = [];
  let modelEffective: string | null = null;
  let turnFailed = false;
  let failureCause: string | null = null;
  const mcpCallIds: Record<string, string> = {};

  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (sessionId && o['sessionId'] !== sessionId) continue;

    const ctx = (o['context'] ?? {}) as Record<string, unknown>;
    const event = String(o['event'] ?? '');
    const model = typeof ctx['model'] === 'string' ? ctx['model'] : null;
    if (model && !modelEffective) modelEffective = model;

    if (event === 'turn.failed') {
      turnFailed = true;
      const err = (o['error'] ?? {}) as Record<string, unknown>;
      const cause = (err['cause'] ?? {}) as Record<string, unknown>;
      failureCause =
        (typeof cause['message'] === 'string' ? cause['message'] : null) ??
        (typeof err['message'] === 'string' ? err['message'] : null);
    }

    const toolName = typeof ctx['toolName'] === 'string' ? ctx['toolName'] : null;
    // MCP 调用的 id 在行的**顶层**（`context` 里没有），与 rollout 的调用 id 同值（EV-188）
    const callId = typeof o['toolCallId'] === 'string' && o['toolCallId'].length > 0 ? o['toolCallId'] : null;
    if (callId && toolName && isZcodeMcp(toolName) && event.startsWith('tool.call.')) mcpCallIds[callId] = toolName;
    if (!event.startsWith('tool.call.') && !model && event !== 'turn.failed') continue;

    events.push({
      event,
      level: String(o['level'] ?? ''),
      toolName,
      model,
      status: statusOf(event),
      path:
        typeof ctx['filePath'] === 'string'
          ? ctx['filePath']
          : typeof ctx['path'] === 'string'
            ? ctx['path']
            : null,
    });
  }

  // 只统计**成功完成**的工具调用：failed 的调用没有真的读到东西，不能算证据
  const completed = events.filter((e) => e.event === 'tool.call.completed' && e.toolName);
  const counts: ToolCallCounts = { read: 0, grep: 0, glob: 0, run_command: 0 };
  const readPaths = new Set<string>();
  const writeEvents: string[] = [];

  for (const e of completed) {
    const n = e.toolName!;
    if (n === 'Read') counts.read = (counts.read ?? 0) + 1;
    else if (n === 'Grep') counts.grep = (counts.grep ?? 0) + 1;
    else if (n === 'Glob') counts.glob = (counts.glob ?? 0) + 1;
    else if (n === 'Bash') counts.run_command = (counts.run_command ?? 0) + 1;
    if (ZCODE_READ_TOOLS.has(n) && e.path) readPaths.add(e.path);
  }
  for (const e of events) {
    if (e.toolName && ZCODE_WRITE_TOOLS.has(e.toolName) && e.event.startsWith('tool.call.')) {
      writeEvents.push(`${e.toolName}(${e.path ?? ''})`);
    }
  }

  const mcpStarted = new Map<string, number>();
  const mcpEnded = new Map<string, number>();
  for (const e of events) {
    if (!e.toolName || !isZcodeMcp(e.toolName) || !e.event.startsWith('tool.call.')) continue;
    const m = e.status === 'started' ? mcpStarted : e.status === 'completed' || e.status === 'failed' ? mcpEnded : null;
    if (m) m.set(e.toolName, (m.get(e.toolName) ?? 0) + 1);
  }
  const mcpCalls: Record<string, number> = {};
  for (const n of new Set([...mcpStarted.keys(), ...mcpEnded.keys()])) {
    mcpCalls[n] = Math.max(mcpStarted.get(n) ?? 0, mcpEnded.get(n) ?? 0);
  }

  return {
    events,
    modelEffective,
    toolCalls: counts,
    readPaths: [...readPaths],
    writeEvents: [...new Set(writeEvents)],
    mcpCalls,
    mcpCallIds,
    turnFailed,
    failureCause,
  };
}

// ─────────────────── rollout：工具参数与模型来源 ───────────────────

/**
 * ZCode 的证据链需要**两个**文件（M0 实测）：
 *
 * | 文件 | 提供 |
 * | :--- | :--- |
 * | `~/.zcode/cli/log/zcode-<date>.jsonl` | 工具**名**、调用计数、`context.model`、结构化失败根因 |
 * | `~/.zcode/cli/rollout/model-io-sess_<sessionId>.jsonl` | 工具**参数**（含文件路径）、`model.source` |
 *
 * 标准日志的 `tool.call.*` 事件 `context` 里**只有 toolName**，没有任何路径字段，
 * 因此单靠它无法做 `deny_paths` 轨迹核验（AC-04）与 `consulted` 交叉核对（AC-11）。
 * 路径只能从 rollout 的 `response.toolCalls[].input` 取。
 */

/** 各工具的参数里，路径可能叫这几个名字 */
const ZCODE_PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'target_file'];

export interface ZcodeRolloutToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** 从 input 中提取出的路径（可能为 null，如 Grep 只给了 pattern） */
  path: string | null;
}

export interface ZcodeRollout {
  toolCalls: ZcodeRolloutToolCall[];
  readPaths: string[];
  writeEvents: string[];
  /** 生效模型的全限定形态 `<providerId>/<modelId>` */
  modelEffective: string | null;
  /**
   * 模型配置的**来源档位**，直接对应设计 §11.3 的模型覆盖三档回读。
   * 实测取值 `config` —— 印证 `model_override = config_copy`。
   */
  modelSource: string | null;
  /**
   * 路径提取的覆盖率（设计 10.1.1 第②层），与 agy 侧同构。
   *
   * 分母只含 `ZCODE_MUST_HAVE_PATH`——本侧只有 `Read` 必带路径。
   * 补这两个计数之前，该侧的 `verification.path` 档位**恒为 ok**：
   * 判定函数对 undefined 一律返回 ok，而注释写的是「不知道就别说有效」——
   * 注释与实现直接相反，等于拿 ok 填「不知道」（r1 三侧独立指出）。
   */
  pathCoverage: { total: number; withPath: number };
}

function extractZcodePath(input: Record<string, unknown>): string | null {
  for (const k of ZCODE_PATH_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** 解析 rollout JSONL（每行一次模型请求/响应） */
export function parseZcodeRollout(jsonl: string): ZcodeRollout {
  const toolCalls: ZcodeRolloutToolCall[] = [];
  const readPaths = new Set<string>();
  const writeEvents: string[] = [];
  let coverTotal = 0;
  let coverWithPath = 0;
  let modelEffective: string | null = null;
  let modelSource: string | null = null;

  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }

    const m = (o['model'] ?? {}) as Record<string, unknown>;
    if (!modelEffective && typeof m['modelId'] === 'string') {
      const pid = typeof m['providerId'] === 'string' ? m['providerId'] : null;
      modelEffective = pid ? `${pid}/${m['modelId']}` : m['modelId'];
    }
    if (!modelSource && typeof m['source'] === 'string') modelSource = m['source'];

    const resp = (o['response'] ?? {}) as Record<string, unknown>;
    const calls = resp['toolCalls'];
    if (!Array.isArray(calls)) continue;
    for (const raw of calls) {
      if (typeof raw !== 'object' || raw === null) continue;
      const c = raw as Record<string, unknown>;
      const name = typeof c['name'] === 'string' ? c['name'] : '';
      const input = (c['input'] ?? {}) as Record<string, unknown>;
      const p = extractZcodePath(input);
      toolCalls.push({
        id: typeof c['id'] === 'string' ? c['id'] : '',
        name,
        input,
        path: p,
      });
      if (ZCODE_READ_TOOLS.has(name) && p) readPaths.add(p);
      // 覆盖率分母：只算必带路径的那一档（设计 10.1.1 第②层）
      if (ZCODE_MUST_HAVE_PATH.has(name)) {
        coverTotal++;
        if (p) coverWithPath++;
      }
      if (ZCODE_WRITE_TOOLS.has(name)) {
        writeEvents.push(`${name}(${p ?? JSON.stringify(input).slice(0, 80)})`);
      }
    }
  }

  return {
    toolCalls,
    readPaths: [...readPaths],
    writeEvents: [...new Set(writeEvents)],
    modelEffective,
    modelSource,
    pathCoverage: { total: coverTotal, withPath: coverWithPath },
  };
}

// ─────────────────── MCP 调用：两份来源合并、分两档（EV-188） ───────────────────

/** 写事件里参数摘要的长度上限（脱敏之后再截） */
export const ZCODE_MCP_SUMMARY_MAX = 120;

export interface ZcodeMcpSummary {
  /** 本轮 MCP 调用总次数（各工具名计数之和） */
  total: number;
  /** 按工具名的次数：每个名字取 rollout 与日志两边的较大者 */
  byTool: Record<string, number>;
  /** 两份来源各自记到的 MCP 调用次数；`null` = 该来源没读到（与「读到了、0 次」不同） */
  sources: { rollout: number | null; log: number | null };
  /** 执行型调用产出的写事件，形如 `MCP:〈工具名〉(〈参数摘要〉)`，进 `write_events`、判只读失守 */
  execEvents: string[];
  /** 名单外的 MCP 工具名（去重、排序），进 `mcp_untrusted_tools`、判证据不可信 */
  untrustedTools: string[];
}

/** 参数摘要：先脱敏再折叠空白、截断——截断在前会把凭据切成半截，脱敏规则就对不上了 */
export function summarizeMcpInput(input: Record<string, unknown>): string {
  return redactSecrets(JSON.stringify(input)).content.replace(/\s+/g, ' ').slice(0, ZCODE_MCP_SUMMARY_MAX);
}

/**
 * 把 rollout 的 `response.toolCalls` 与会话日志的 `tool.call.*` 合并成本轮 MCP 调用的计数与两档分类（计划 r2 §2.2）。
 *
 * **去重按调用 id 求并集**：日志行顶层的 `toolCallId` 与 rollout 的调用 id 同值（2026-10-02 核五次真实运行共 172 次调用、
 * 一一对应；计划 r2 §1.4 写的「没有调用 id」只核了 `context` 的键，是错的，编码时更正）。两边记的是同一批调用，相加会算两遍。
 * **id 缺失的日志事件按名取大兜底**：每个名字最终计 `max(并集里该名的次数, 日志按名计数)`——两边 id 都全时等于并集，
 * 日志没带 id 时退化为「rollout 与日志取大」，任一边丢行或没读到都由另一边补。
 *
 * **工具名全集取两边并集**（计划双审 AGY-02）：执行型与名单外两支都在并集上分类，任一来源独有的名字都不漏。
 *
 * **有执行型调用就一定有写事件**：rollout 里每次调用一条（带参数摘要）；只在日志里出现的那部分（rollout 丢行或没读到）
 * 补一条「会话日志另记 k 次，参数不可得」——不因参数缺失而漏判。
 */
export function summarizeZcodeMcp(
  rolloutCalls: readonly ZcodeRolloutToolCall[] | null,
  logCounts: Readonly<Record<string, number>> | null,
  logCallIds: Readonly<Record<string, string>> | null = null,
): ZcodeMcpSummary {
  const fromRollout = new Map<string, ZcodeRolloutToolCall[]>();
  const rolloutIds = new Set<string>();
  for (const c of rolloutCalls ?? []) {
    if (!isZcodeMcp(c.name)) continue;
    const list = fromRollout.get(c.name) ?? [];
    list.push(c);
    fromRollout.set(c.name, list);
    if (c.id) rolloutIds.add(c.id);
  }
  /** 只在日志里有 id、rollout 里没有的调用，按名计 */
  const logOnly = new Map<string, number>();
  for (const [id, name] of Object.entries(logCallIds ?? {})) {
    if (!isZcodeMcp(name) || rolloutIds.has(id)) continue;
    logOnly.set(name, (logOnly.get(name) ?? 0) + 1);
  }
  const names = [
    ...new Set([...fromRollout.keys(), ...logOnly.keys(), ...Object.keys(logCounts ?? {}).filter(isZcodeMcp)]),
  ].sort();

  const byTool: Record<string, number> = {};
  const execEvents: string[] = [];
  const untrustedTools: string[] = [];
  for (const n of names) {
    const ro = fromRollout.get(n) ?? [];
    /*
     * rollout 里该名有条目缺 id（代码双审 GLM-01）：它对不上日志的 id，同一次调用会既进 ro.length 又进 logOnly、算两遍。
     * 这种名字整体退回按名取大，不累加 logOnly。五次真实运行未见缺 id，这是厂商格式变化时的兜底
     */
    const unionable = ro.every((c) => c.id.length > 0);
    byTool[n] = Math.max(ro.length + (unionable ? (logOnly.get(n) ?? 0) : 0), logCounts?.[n] ?? 0);
    if (isZcodeMcpExec(n)) {
      /*
       * 条目带调用 id：参数摘要只取前 120 字，多次调用常以同一段代码开头（真实回放 run 20261001T092816Z：7 次调用、
       * 摘要只有 2 种）——不带 id 时下面的去重会把它们合成一条，留痕里的条数就不再是调用次数；带上 id 还能回 rollout 查全文
       */
      for (const c of ro) execEvents.push(`${MCP_WRITE_EVENT_PREFIX}${n}(${c.id ? `${c.id} ` : ''}${summarizeMcpInput(c.input)})`);
      const extra = byTool[n] - ro.length;
      if (extra > 0) execEvents.push(`${MCP_WRITE_EVENT_PREFIX}${n}(会话日志另记 ${extra} 次，参数不可得)`);
    } else {
      untrustedTools.push(n);
    }
  }

  const sum = (xs: Iterable<number>): number => [...xs].reduce((a, b) => a + b, 0);
  return {
    total: sum(Object.values(byTool)),
    byTool,
    sources: {
      rollout: rolloutCalls === null ? null : sum([...fromRollout.values()].map((l) => l.length)),
      log: logCounts === null ? null : sum(Object.entries(logCounts).filter(([k]) => isZcodeMcp(k)).map(([, v]) => v)),
    },
    execEvents: [...new Set(execEvents)],
    untrustedTools,
  };
}
