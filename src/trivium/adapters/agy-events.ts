/**
 * Antigravity `--output-format stream-json` 事件解析（纯函数，无 I/O）。
 *
 * M0 实测确立的事实：**`stream-json` 本身就是工具轨迹来源**，不需要另找日志文件。
 * 这同时服务三件事：AC-05 的 Agent 执行证据、AC-11 的 `project_reads` 下限、
 * 以及 §10.1 第 ③ 道的 `deny_paths` 事后轨迹核验。
 *
 * 事件形状（agy 1.2.0 实测）：
 *   {"event":"init","conversation_id":…,"init":{model,cwd,tools[],permission_mode}}
 *   {"event":"step_update","step_update":{step_index,state,step_type,tool_name,tool_info{parameters,error},duration_seconds,usage}}
 *   {"event":"result","result":{status,response,duration_seconds,num_turns,usage,denied_actions[]}}
 */

export type ToolState = 'ACTIVE' | 'DONE' | 'ERROR' | string;

export interface AgyToolCall {
  stepIndex: number;
  toolName: string;
  state: ToolState;
  parameters: Record<string, unknown>;
  /** 从参数里提取出的文件路径（绝对路径，agy 的文件工具只接受绝对路径） */
  path: string | null;
  errorMessage: string | null;
  durationSeconds: number | null;
}

export interface AgyDeniedAction {
  action: string;
  display_name?: string;
}

export interface AgyStreamResult {
  conversationId: string | null;
  /** init 事件上报的 cwd（只读上报，不是我们设的） */
  cwd: string | null;
  model: string | null;
  /** init 上报的是**完整工具注册表**而非 Agent 白名单——不得用它证明只读（M0 坑） */
  registryTools: string[];
  permissionMode: string | null;
  toolCalls: AgyToolCall[];
  status: string | null;
  response: string;
  numTurns: number | null;
  durationSeconds: number | null;
  usage: Record<string, number>;
  /** 官方机读的软拒绝信号（1.1.27 引入）。非空即说明有工具被静默拒了 */
  deniedActions: AgyDeniedAction[];
  /** 无法解析为 JSON 的行，用于诊断 */
  malformedLines: number;
}

/**
 * agy 文件类工具的参数里，路径可能叫这几个名字。
 *
 * **`SearchPath` 是 2026-09-16 补上的，补之前措施 a 对 grep 通道恒盲**：
 * `grep_search` 的目录参数就叫 `SearchPath`（`Query` 是搜索词），不在本表里，
 * 于是 `extractPath` 对它恒返回 null——r12 实测 15 次 `grep_search`（全部 `DONE`）
 * 提出 **0 条**路径，而 `countTools` 照常把它们计进 `grep`，计数通道看起来一切正常。
 *
 * 这条缺口格外要命，因为 grep 正是探针记录里写明的**绕过通道**：
 * zcode 侧「显式 deny 该路径后，模型改用 Grep 读到了目标文件」、
 * claude 侧「同一批规则下 Grep 仍从该目录取到了哨兵」。
 * 也就是说，最可能被用来绕过的那条路，检测面上是空的。
 *
 * **补键名只是第一层防线**（防我们自己重构时改坏提取逻辑）。
 * 厂商改参数名仍会让这里静默退化——那要靠运行期覆盖率与探针臂，见设计 10.1.1。
 */
const PATH_KEYS = [
  'AbsolutePath',
  'SearchDirectory',
  'SearchPath',
  'DirectoryPath',
  'Path',
  'File',
  'TargetFile',
];

/**
 * 只读工具集：出现在轨迹里表示「读了东西」。
 *
 * 本侧四个读工具的目录参数**都是必填的**，所以它们同时也构成
 * `AGY_MUST_HAVE_PATH`（设计 10.1.1 第②层的覆盖率分母）。
 */
export const AGY_READ_TOOLS = new Set(['view_file', 'grep_search', 'find_by_name', 'list_dir']);

/**
 * 读类工具里**必然带路径**的那一档：提不出路径就是提取器坏了，不是合法形态。
 *
 * **四个都在**（r1 三侧独立指出）。初版只放了 `view_file`，理由是「搜索类允许
 * 无路径」——那个理由对**搜索词**成立，对**搜索目录**不成立：
 * `grep_search` 有 `SearchPath`、`find_by_name` 有 `SearchDirectory`、
 * `list_dir` 有 `DirectoryPath`，三者都是必填的目录参数。
 *
 * 排除它们的后果恰恰最坏：**EV-28 的历史根因就是 `grep_search` 提出 0 条路径**，
 * 而按初版口径，那次退化落在分母之外、档位照记「有效」——
 * 探测器对**唯一发生过的真实退化形态**失灵。
 */
export const AGY_MUST_HAVE_PATH = new Set([
  'view_file',
  'grep_search',
  'find_by_name',
  'list_dir',
]);

/** 写类工具/命令：出现在轨迹里即 readonly_breach（FR-15 / AC-08） */
export const AGY_WRITE_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'sed_file',
  'notebook_edit',
  'run_command',
]);

function extractPath(params: Record<string, unknown>): string | null {
  for (const k of PATH_KEYS) {
    const v = params[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

export function parseAgyStream(stdout: string): AgyStreamResult {
  const out: AgyStreamResult = {
    conversationId: null,
    cwd: null,
    model: null,
    registryTools: [],
    permissionMode: null,
    toolCalls: [],
    status: null,
    response: '',
    numTurns: null,
    durationSeconds: null,
    usage: {},
    deniedActions: [],
    malformedLines: 0,
  };

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      out.malformedLines++;
      continue;
    }

    const kind = ev['event'];

    if (kind === 'init') {
      out.conversationId = (ev['conversation_id'] as string | undefined) ?? null;
      const init = (ev['init'] ?? {}) as Record<string, unknown>;
      out.cwd = (init['cwd'] as string | undefined) ?? null;
      out.model = (init['model'] as string | undefined) ?? null;
      out.registryTools = Array.isArray(init['tools']) ? (init['tools'] as string[]) : [];
      out.permissionMode = (init['permission_mode'] as string | undefined) ?? null;
      continue;
    }

    if (kind === 'step_update') {
      const s = (ev['step_update'] ?? {}) as Record<string, unknown>;
      if (s['step_type'] !== 'tool') continue;
      const info = (s['tool_info'] ?? {}) as Record<string, unknown>;
      const params = (info['parameters'] ?? {}) as Record<string, unknown>;
      const err = info['error'] as Record<string, unknown> | undefined;
      out.toolCalls.push({
        stepIndex: typeof s['step_index'] === 'number' ? (s['step_index'] as number) : -1,
        toolName: (s['tool_name'] as string | undefined) ?? (info['name'] as string | undefined) ?? '',
        state: (s['state'] as string | undefined) ?? '',
        parameters: params,
        path: extractPath(params),
        errorMessage: (err?.['message'] as string | undefined) ?? null,
        durationSeconds:
          typeof s['duration_seconds'] === 'number' ? (s['duration_seconds'] as number) : null,
      });
      continue;
    }

    if (kind === 'result') {
      const r = (ev['result'] ?? {}) as Record<string, unknown>;
      out.status = (r['status'] as string | undefined) ?? null;
      out.response = (r['response'] as string | undefined) ?? '';
      out.numTurns = typeof r['num_turns'] === 'number' ? (r['num_turns'] as number) : null;
      out.durationSeconds =
        typeof r['duration_seconds'] === 'number' ? (r['duration_seconds'] as number) : null;
      if (r['usage'] && typeof r['usage'] === 'object') {
        out.usage = r['usage'] as Record<string, number>;
      }
      if (Array.isArray(r['denied_actions'])) {
        out.deniedActions = r['denied_actions'] as AgyDeniedAction[];
      }
      if (!out.conversationId && typeof r['conversation_id'] === 'string') {
        out.conversationId = r['conversation_id'];
      }
    }
  }

  return out;
}

/** 只统计**成功完成**的工具调用——ERROR 状态的调用没有真的读到东西，不能算证据 */
export function successfulToolCalls(r: AgyStreamResult): AgyToolCall[] {
  return r.toolCalls.filter((t) => t.state === 'DONE');
}

/** 轨迹中成功读取过的绝对路径去重集合 */
export function readPaths(r: AgyStreamResult): string[] {
  const set = new Set<string>();
  for (const t of successfulToolCalls(r)) {
    if (AGY_READ_TOOLS.has(t.toolName) && t.path) set.add(t.path);
  }
  return [...set];
}

/**
 * 路径提取的**覆盖率**：「必然带路径」的读调用有多少条、其中多少条真提出了路径。
 *
 * 两者不等即提取器已相对厂商实际参数名退化——这是本项目唯一能在**下一轮运行时**
 * 发现厂商改参数名的信号（设计 §10.1.1 第②层）。补它之前，这类退化只能靠
 * 人工复算原始轨迹发现，而运行目录到期即删。
 *
 * 分母取 `AGY_MUST_HAVE_PATH`——**四个读工具都在里面**。
 * 它们各自的目录参数都是必填的（文件路径 / 搜索目录 / 查找目录 / 列出目录），
 * 提不出来就是提取器相对厂商参数名退化了，不存在「合法的无路径调用」。
 */
export function pathCoverage(r: AgyStreamResult): { total: number; withPath: number } {
  let total = 0;
  let withPath = 0;
  for (const t of successfulToolCalls(r)) {
    if (!AGY_MUST_HAVE_PATH.has(t.toolName)) continue;
    total++;
    if (t.path) withPath++;
  }
  return { total, withPath };
}

/** 轨迹中出现的写事件（无论成功与否——尝试写本身就是失守信号） */
export function writeEvents(r: AgyStreamResult): string[] {
  return r.toolCalls
    .filter((t) => AGY_WRITE_TOOLS.has(t.toolName))
    .map((t) => `${t.toolName}(${t.path ?? JSON.stringify(t.parameters).slice(0, 80)})`);
}

/** agy 的 `run_command` 把命令放在这几个参数名里的任一个（实测形态，非文档） */
const COMMAND_KEYS = ['Command', 'CommandLine', 'command'];

/**
 * 轨迹里的**命令原文**，供措施 b（§10.1 / EV-01）扫描。
 *
 * **agy 侧这个数组通常是空的，而这正是预期**：`trivium-critic` 的工具白名单里
 * 没有 `run_command`，它出现即 `readonly_breach`（见 `AGY_WRITE_TOOLS`）。
 * 本函数存在的意义是**万一出现就要能扫**——失守与泄漏是两件事，
 * 一条既失守又读了对端产物的命令，两边都该记上。
 *
 * 取不到命令文本时**逐个收集 `parameters` 里的字符串值**，各自作为一条命令文本参与扫描。
 *
 * > 初版这里回落到 `JSON.stringify(parameters)`，注释写着「多带上下文只会让匹配
 * > 更容易命中，不会造成误判」——**方向正好相反**（r4 双审 GLM-05）。
 * > JSON 序列化把命令里的引号转义成 `\"`，而反斜杠**不在** `CMD_BOUNDARY`，
 * > 也**不能**加进去（B-4 的负断言明确要求 `cat \.reviews/…` 判否）。
 * > 于是带引号的 F-1 / F-5 形态在兜底路径上**反而漏检**。
 * >
 * > 触发条件窄（三个键都取不到才走兜底），但那正是兜底存在的意义场景：
 * > agy 哪天改了参数名，检测面会无声退化——而注释还在保证它不会。
 */
export function commandTexts(r: AgyStreamResult): string[] {
  return r.toolCalls
    .filter((t) => t.toolName === 'run_command')
    .flatMap((t) => {
      for (const k of COMMAND_KEYS) {
        const v = t.parameters[k];
        if (typeof v === 'string' && v.length > 0) return [v];
      }
      return Object.values(t.parameters).filter((v): v is string => typeof v === 'string');
    });
}
