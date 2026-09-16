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

  return {
    events,
    modelEffective,
    toolCalls: counts,
    readPaths: [...readPaths],
    writeEvents: [...new Set(writeEvents)],
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
