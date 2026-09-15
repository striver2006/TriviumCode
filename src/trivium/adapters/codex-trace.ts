/**
 * codex 事件流与会话文件的解析（设计 §11.1，M8 第 3 步）。
 *
 * ## 为什么住在 adapters/ 而不是 probes/
 *
 * 本文件原是 `probes/codex.ts` 的一部分。适配器接入时若再写一份解析，
 * 同一个事实就有了两个来源（纪律 7）——探针据一份下结论、适配器据另一份采证据，
 * 两份漂移了没人发现。搬家后探针 import 本模块，与
 * `zcode-trace.ts` / `agy-events.ts` 的分工一致：解析是纯函数，执行留在适配器里。
 *
 * 搬家的安全网是 `test/unit/codex-events.test.ts`——它先于搬家存在且当时全绿。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';

/** 一条命令执行记录 */
export interface CodexCommand {
  command: string;
  exitCode: number | null;
  status: string;
  output: string;
}

/** 事件流里出现过的 item 类型 + 命令执行记录 */
export interface CodexTrace {
  /** 顶层事件类型（thread.started / turn.completed / error …） */
  eventTypes: string[];
  /** item 类型（command_execution / agent_message / reasoning / error …） */
  itemTypes: string[];
  commands: CodexCommand[];
  finalText: string | null;
  /** 会话 id。与会话文件名精确关联，不靠「取最新文件」（zcode 侧的坑 P-14） */
  threadId: string | null;
  /**
   * 错误消息（顶层 `{"type":"error"}` 事件与 `error` item 合流）。
   *
   * **顶层 error 是本步实测新发现的形态**，探针记录的 `json_event_types` 里没有它：
   * 跨家族调用（`-p qwen -m deepseek-flash`）时流里是
   * `Reconnecting... 1/5 (stream disconnected: Model not found: deepseek-flash)`，
   * 重试五次后退 1。不认这个类型，失败原因就只剩一个退出码。
   */
  errors: string[];
  /**
   * 已完成的 item 原始对象。
   *
   * 留着是为了让「读取路径有没有结构化字段」可以**真测**而不是写常量：
   * 判据要看除 `command` 外有没有别的字段装着路径（M6 审查意见 GLM-04）。
   */
  rawItems: Record<string, unknown>[];
}

/** 解析 `exec --json` 的 JSONL。坏行跳过而不是抛——真实输出里混过 stderr 噪声 */
export function parseCodexEvents(jsonl: string): CodexTrace {
  const eventTypes = new Set<string>();
  const itemTypes = new Set<string>();
  const commands: CodexCommand[] = [];
  const rawItems: Record<string, unknown>[] = [];
  const errors: string[] = [];
  let finalText: string | null = null;
  let threadId: string | null = null;

  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof o['type'] === 'string') eventTypes.add(o['type']);
    if (o['type'] === 'thread.started' && typeof o['thread_id'] === 'string') {
      threadId = o['thread_id'];
    }
    // 顶层 error 事件：没有 item，消息直接挂在事件上
    if (o['type'] === 'error' && typeof o['message'] === 'string') {
      errors.push(o['message']);
      continue;
    }

    const item = o['item'] as Record<string, unknown> | undefined;
    if (!item) continue;
    const itemType = typeof item['type'] === 'string' ? item['type'] : null;
    if (itemType) itemTypes.add(itemType);
    if (o['type'] === 'item.completed') rawItems.push(item);
    if (itemType === 'command_execution' && item['status'] === 'completed') {
      commands.push({
        command: String(item['command'] ?? ''),
        exitCode: typeof item['exit_code'] === 'number' ? item['exit_code'] : null,
        status: String(item['status'] ?? ''),
        output: String(item['aggregated_output'] ?? ''),
      });
    }
    if (itemType === 'agent_message' && typeof item['text'] === 'string') {
      finalText = item['text'];
    }
    if (itemType === 'error' && typeof item['message'] === 'string') {
      errors.push(item['message']);
    }
  }
  return {
    eventTypes: [...eventTypes].sort(),
    itemTypes: [...itemTypes].sort(),
    commands,
    finalText,
    threadId,
    errors,
    rawItems,
  };
}

/**
 * 「这次跑完了没有」—— 三态判据的**共用前提**（M6 审查意见 GLM-01 / GLM-05）。
 *
 * `run()` 超时**不抛错**、返回截断输出，所以只看解析结果的话，
 * 一次网络抖动与一次真实的能力缺陷长得一模一样。
 * 判据取「有没有最终回复」而不是退出码：codex 在模型拒绝任务时也可能退 0，
 * 而那时同样没有可用结论。
 */
export function traceCompleted(trace: CodexTrace, timedOut: boolean): boolean {
  return !timedOut && trace.finalText !== null;
}

/**
 * 成功执行过的命令 —— 写判据的入参（`classifyWriteCommands` 的调用契约）。
 *
 * 判据是 `status: completed` **且** `exit_code === 0`。失败的命令不进这一档，
 * 但它们仍留在 `command_texts` 全集里供措施 b 扫描：泄漏企图即便失败也要检出，
 * 两者论域不同。
 */
export function succeededCommands(trace: CodexTrace): string[] {
  return trace.commands.filter((c) => c.status === 'completed' && c.exitCode === 0).map((c) => c.command);
}

/** 会话元数据里能回读到的生效事实 */
export interface CodexSessionMeta {
  sessionId: string | null;
  /** provider 家族（`qwen` / `deepseek` …）——随 `-p` 走 */
  modelProvider: string | null;
  /** 生效模型 slug——随 `-m` 走，不是 profile 的意图值 */
  modelEffective: string | null;
  cliVersion: string | null;
}

/**
 * 解析会话文件首行的 `session_meta`（**生效模型的唯一回读落点**）。
 *
 * ## 为什么必须从这里读
 *
 * `exec --json` 的事件流里**没有任何 model 字段**（本步实测三组调用逐行核对，
 * 既有样本 `test/fixtures/codex-events/read-sentinel.jsonl` 同形）。
 * 而 AC-20 要求「生效模型与指定一致且互可区分」，`model_effective` 拿不到就没法验收。
 *
 * ## 实测依据（M8 第 3 步，2026-09-15）
 *
 * | 命令 | 回读值 |
 * | :--- | :--- |
 * | `-p qwen` | `qwen` / `qwen3.8-max` |
 * | `-p deepseek` | `deepseek` / `deepseek-flash` |
 * | `-p qwen -m qwen3.8-flash` | `qwen` / **`qwen3.8-flash`** |
 *
 * 第三组证明它**跟随 `-m` 覆盖**、而不是复读 profile 的意图值——
 * 这正是 AC-20 那句「生效模型仍以回读为准、不采信 profile 意图」要的东西。
 *
 * ## 边界
 *
 * `base_instructions.provenance` 不是公开契约，字段名可能随版本变。
 * 取不到时返回 null，由调用方记 `unverified`——**绝不用 requested 冒充**
 * （与 `adapters/zcode.ts` 的既定纪律一致）。
 */
export function parseCodexSessionMeta(firstLine: string): CodexSessionMeta {
  const empty: CodexSessionMeta = {
    sessionId: null, modelProvider: null, modelEffective: null, cliVersion: null,
  };
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(firstLine.trim()) as Record<string, unknown>;
  } catch {
    return empty;
  }
  if (o['type'] !== 'session_meta') return empty;
  const p = o['payload'] as Record<string, unknown> | undefined;
  if (!p) return empty;

  const base = p['base_instructions'] as Record<string, unknown> | undefined;
  const prov = base?.['provenance'] as Record<string, unknown> | undefined;

  return {
    sessionId: typeof p['session_id'] === 'string' ? p['session_id'] : null,
    modelProvider: typeof p['model_provider'] === 'string' ? p['model_provider'] : null,
    modelEffective: typeof prov?.['model'] === 'string' ? (prov['model'] as string) : null,
    cliVersion: typeof p['cli_version'] === 'string' ? p['cli_version'] : null,
  };
}

/**
 * 按 `threadId` 在 `$CODEX_HOME/sessions/` 下定位会话文件。
 *
 * 文件名形如 `rollout-<时间戳>-<threadId>.jsonl`，而 `threadId` 正是
 * `thread.started` 事件给出的那个——**逐字相同**（本步实测核对）。
 * 因此关联不靠「取最新文件」：共享 HOME 下并发跑两轮就会串号，
 * zcode 侧为这个踩过坑（P-14）。
 *
 * 目录按 `YYYY/MM/DD` 分层，跨零点的运行会落在第二天，所以逐层找而不是拼日期。
 */
export async function findSessionFile(codexHome: string, threadId: string): Promise<string | null> {
  const root = path.join(codexHome, 'sessions');
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      if (name.includes(threadId) && name.endsWith('.jsonl')) return full;
      // 不用 withFileTypes：Dirent 的泛型在本仓库 @types/node 版本下与 readdir
      // 重载对不齐，而这里只需要「能不能继续往下走」，stat 失败即当文件跳过
      try {
        if ((await fs.stat(full)).isDirectory()) stack.push(full);
      } catch {
        /* competing cleanup 之类，跳过即可 */
      }
    }
  }
  return null;
}

/** 读会话文件并回读生效事实。文件不在或首行不是 session_meta 时全 null */
export async function readSessionMeta(
  codexHome: string,
  threadId: string | null,
): Promise<CodexSessionMeta> {
  const empty: CodexSessionMeta = {
    sessionId: null, modelProvider: null, modelEffective: null, cliVersion: null,
  };
  if (!threadId) return empty;
  const file = await findSessionFile(codexHome, threadId);
  if (!file) return empty;
  try {
    const text = await fs.readFile(file, 'utf8');
    return parseCodexSessionMeta(text.split('\n')[0] ?? '');
  } catch {
    return empty;
  }
}
