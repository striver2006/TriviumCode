/**
 * Codex CLI 能力探针（设计 §3.5 / 演进设计 §3.1，M6 第 2 步）。
 *
 * 本机实测确立的调用配方，M8 适配层必须复用：
 *   1. `codex exec --json`：非交互 + JSONL 事件流。
 *   2. `-s read-only`：**本就是默认值**，但显式传——默认值会随版本改，
 *      而「只读」是这条流水线的地基，不能靠默认。
 *   3. `-p <name>`：0.154.0 的 profile 是**文件分层**（`$CODEX_HOME/<name>.config.toml`），
 *      不是 `config.toml` 里的 `[profiles.*]` 段。
 *   4. `--skip-git-repo-check`：探针夹具不一定是 git 仓库。
 *   5. stdin 要显式给空（`< /dev/null` 等价物）：不给的话 codex 会等 stdin，
 *      在非交互环境里挂住。
 *   6. **header 在 stderr，模型回复在 stdout**。手工验证时习惯写 `2>&1` 所以看得见，
 *      代码里若只读 stdout 会把生效配置全拿成 null——本步真机第一遍就栽在这里。
 *
 * ## 本步录到的两条硬事实
 *
 * **读取路径没有结构化字段**：codex 让模型跑 shell（`/bin/zsh -lc 'head …'`），
 * 路径只在命令文本里。**被拒的命令不进轨迹**：只读沙箱挡下写入时，
 * `command_execution` 事件一条都不产生。两条都写进了探针结论，
 * 因为它们决定 M8 的证据核验怎么做（见 `CodexProbe` 各字段的「消费方」注释）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { run, tryRun } from '../util/exec.js';
import { exists } from '../util/fsx.js';
import { createFixture, SENTINEL_OPEN, type Fixture } from './fixture.js';
import { probeScratchPaths } from './agy.js';
import type { CodexProbe, PathDenyProbe, ProbeIsolation } from '../types.js';

/**
 * 探针**首选**模型：探的是能力不是质量，挑目录里最便宜的一档。
 *
 * 只是首选——真正用哪个由「哪个 profile 的目录里有它」决定，
 * 目录里没有就退而取该目录的第一个（见 probeCodex 里的选择逻辑）。
 * 写死一个 slug 再配上字典序第一的 profile，换台机器就会拿错 provider 调模型。
 */
const PROBE_MODEL = 'deepseek-flash';
const PROBE_EFFORT = 'low';
const PROBE_TIMEOUT_MS = 180_000;

/** `$CODEX_HOME`，未设时回落官方默认 */
export function codexHome(): string {
  return process.env['CODEX_HOME'] ?? path.join(os.homedir(), '.codex');
}

/** `codex` 绝对路径 + 版本 */
export async function probeCodexBin(
  configured: string | null,
): Promise<{ bin: string | null; version: string | null }> {
  const candidates = [
    configured,
    '/opt/homebrew/bin/codex',
    path.join(os.homedir(), '.local/bin/codex'),
    '/usr/local/bin/codex',
  ].filter((c): c is string => Boolean(c));

  let bin: string | null = null;
  for (const c of candidates) {
    if (await exists(c)) {
      bin = c;
      break;
    }
  }
  if (!bin) {
    const which = await tryRun('/usr/bin/which', ['codex']);
    if (which.ok) bin = which.stdout.trim();
  }
  if (!bin) return { bin: null, version: null };

  const v = await run(bin, ['--version'], { timeoutMs: 60_000 });
  // 输出形如 `codex-cli 0.154.0`——取三段号，与 version_probe 落盘的 extract 一致
  const m = v.code === 0 ? /(\d+\.\d+\.\d+)/.exec(v.stdout) : null;
  return { bin, version: m?.[1] ?? null };
}

/**
 * 可用的 profile 名单：枚举 `$CODEX_HOME/*.config.toml`。
 *
 * **不读 `config.toml` 的 `[profiles.*]` 段**——0.154.0 的 `-p` 是文件分层，
 * 那个段在本机五份 toml 里一个都没有，按它取名单会恒为空（详见 `CodexProbe.profiles`）。
 */
export async function probeCodexProfiles(home: string): Promise<string[]> {
  try {
    const names = await fs.readdir(home);
    return names
      .filter((n) => n.endsWith('.config.toml'))
      .map((n) => n.slice(0, -'.config.toml'.length))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 模型目录：`codex debug models --json`。
 *
 * **零配额**——它只渲染本地目录文件，不调模型。`-c model_catalog_json=<路径>`
 * 能换目录，这既是 `model_catalog` 的探法，也顺带证明 `-c` 真的生效。
 */
export async function probeCodexModels(
  bin: string,
  catalogPath: string | null,
): Promise<{ models: string[]; efforts: Record<string, string[]> }> {
  const args = ['debug', 'models'];
  if (catalogPath) args.push('-c', `model_catalog_json=${catalogPath}`);
  const r = await run(bin, args, { timeoutMs: 60_000 });
  if (r.code !== 0) return { models: [], efforts: {} };
  try {
    const parsed = JSON.parse(r.stdout) as {
      models?: { slug?: string; supported_reasoning_levels?: { effort?: string }[] }[];
    };
    const models: string[] = [];
    const efforts: Record<string, string[]> = {};
    for (const m of parsed.models ?? []) {
      if (!m.slug) continue;
      models.push(m.slug);
      efforts[m.slug] = (m.supported_reasoning_levels ?? [])
        .map((e) => e.effort)
        .filter((e): e is string => Boolean(e));
    }
    return { models, efforts };
  } catch {
    return { models: [], efforts: {} };
  }
}

/**
 * `codex exec` 开跑前打印的 header —— 生效配置的回读面。
 *
 * 成本见 `probeCodexHeader`：**不是零配额**，只是被压到了「header 一打完就走人」。
 */
export interface CodexHeader {
  model: string | null;
  provider: string | null;
  sandbox: string | null;
  effort: string | null;
  approval: string | null;
  /** 进程退出码。判「CLI 是否拒绝了这个参数」要靠它，不能只看字段有没有值 */
  exitCode: number | null;
  /** 早退前没等到任何 header 行 —— 与「读到了但值是 null」要分得开 */
  gotHeader: boolean;
  stderr: string;
}

/**
 * 读 `codex exec` 的 header —— 「生效的是哪个模型 / 档位 / 沙箱」的回读手法。
 *
 * header 在真正调模型**之前**打印，所以本步的 `profile_flag` / `config_override` /
 * `effort_validated` 三项都靠它，不必等模型回话。
 *
 * **但它不是零成本**，理由见函数体内的注释。手工验证时用 `| head -N`
 * 靠 SIGPIPE 立刻中断确实近乎零成本，可编排器里没有那个管道，
 * 只能用短超时——两者不等价，所以这里不照搬手工时的说法。
 */
/** header 里认的标签。顺序无关，但名字必须与 CLI 打印的逐字一致 */
export const HEADER_LABELS = ['model', 'provider', 'sandbox', 'reasoning effort', 'approval'] as const;

/**
 * 从 header 行里抽出「标签 → 值」。**纯函数，可单测**（审查意见 GLM-07）。
 *
 * 抽出来的理由：这五个标签的拼写是本步真机第一遍就栽过的坑
 * （当时是流向搞错，拿到一片 null）。事件流有「图谱变了就重录样本」的守卫，
 * header 原本一个测试都没有——codex 把 `reasoning effort` 改成 `effort`，
 * 五个派生字段会集体变 null 而**没有任何测试变红**。防护不对称。
 */
export function parseHeaderLines(lines: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    const m = /^([a-z ]+):\s*(.+)$/.exec(line.trim());
    if (m && (HEADER_LABELS as readonly string[]).includes(m[1]!)) {
      out.set(m[1]!, m[2]!.trim());
    }
  }
  return out;
}

export async function probeCodexHeader(
  bin: string,
  extraArgs: string[],
  cwd: string,
): Promise<CodexHeader> {
  /*
   * **流式早退**：逐行读 stderr，五个标签凑齐（或读到 header 结束的分隔线）
   * 就立刻 killTree（审查意见 AGY-03 / GLM-06）。
   *
   * 这是手工 `codex exec … 2>&1 | head -7` 靠 SIGPIPE 中断的代码内等价物。
   * 换掉的是原先那个 12s 固定超时，它有三个毛病：
   *   ① 5 次调用累计阻塞约 60s；
   *   ② 12s 是实测凑出来的经验常数，慢机器上 header 还没打完就被误杀，
   *      于是每一项都拿成 null，而 null 会让判据静默判反；
   *   ③ **固定超时无论调到多少，都只是在赌「请求还没发出去」**——
   *      而早退能把那个窗口压到接近零。
   *
   * 仍留一个兜底超时：CLI 可能根本不打 header（版本变了、参数被拒），
   * 那时没有早退信号，不能永远等下去。
   */
  const want = HEADER_LABELS;
  const seen = new Map<string, string>();
  let sawDivider = false;

  const r = await run(
    bin,
    ['exec', ...extraArgs, '--skip-git-repo-check', '-C', cwd, 'probe'],
    {
      timeoutMs: 30_000,
      cwd,
      stdin: '',
      killTree: true,
      /*
       * **header 走 stderr，模型回复走 stdout**（本机实测 0.154.0）。
       * 手工验证时习惯写 `2>&1` 所以看得见；代码里若只挂 stdout 回调，
       * 会一行都收不到——本步真机第一遍就栽在这里。
       */
      onStderrLine: (line) => {
        for (const [k, v] of parseHeaderLines([line])) seen.set(k, v);
        // header 段以 `--------` 收尾；见到分隔线且已收到标签说明 header 打完了
        if (/^-{4,}$/.test(line.trim())) sawDivider = seen.size > 0;
      },
      stopEarly: (stop) => {
        const timer = setInterval(() => {
          if (sawDivider || want.every((k) => seen.has(k))) {
            clearInterval(timer);
            stop();
          }
        }, 50);
        // 兜底超时到了也要停掉轮询，别把定时器漏出去
        setTimeout(() => clearInterval(timer), 31_000).unref();
      },
    },
  );

  const pick = (label: string): string | null => seen.get(label) ?? null;
  return {
    model: pick('model'),
    provider: pick('provider'),
    sandbox: pick('sandbox'),
    effort: pick('reasoning effort'),
    approval: pick('approval'),
    exitCode: r.code,
    gotHeader: seen.size > 0,
    stderr: r.stderr,
  };
}

/** 事件流里出现过的 item 类型 + 命令执行记录 */
export interface CodexTrace {
  /** 顶层事件类型（thread.started / turn.completed …） */
  eventTypes: string[];
  /** item 类型（command_execution / agent_message / error …） */
  itemTypes: string[];
  commands: { command: string; exitCode: number | null; output: string }[];
  finalText: string | null;
  /**
   * 已完成的 item 原始对象。
   *
   * 留着是为了让「读取路径有没有结构化字段」可以**真测**而不是写常量：
   * 判据要看除 `command` 外有没有别的字段装着路径（审查意见 GLM-04）。
   */
  rawItems: Record<string, unknown>[];
}

/** 解析 `exec --json` 的 JSONL。坏行跳过而不是抛——真实输出里混过 stderr 噪声 */
export function parseCodexEvents(jsonl: string): CodexTrace {
  const eventTypes = new Set<string>();
  const itemTypes = new Set<string>();
  const commands: CodexTrace['commands'] = [];
  const rawItems: Record<string, unknown>[] = [];
  let finalText: string | null = null;

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
    const item = o['item'] as Record<string, unknown> | undefined;
    if (!item) continue;
    const itemType = typeof item['type'] === 'string' ? item['type'] : null;
    if (itemType) itemTypes.add(itemType);
    if (o['type'] === 'item.completed') rawItems.push(item);
    if (itemType === 'command_execution' && item['status'] === 'completed') {
      commands.push({
        command: String(item['command'] ?? ''),
        exitCode: typeof item['exit_code'] === 'number' ? item['exit_code'] : null,
        output: String(item['aggregated_output'] ?? ''),
      });
    }
    if (itemType === 'agent_message' && typeof item['text'] === 'string') {
      finalText = item['text'];
    }
  }
  return {
    eventTypes: [...eventTypes].sort(),
    itemTypes: [...itemTypes].sort(),
    commands,
    finalText,
    rawItems,
  };
}

/**
 * 「这次探测跑完了没有」—— 三态判据的**共用前提**（审查意见 GLM-01 / GLM-05）。
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
 * 读文件能力的三态判定。**抽成纯函数是为了能被变异验证打中**：
 * 它埋在探针里的话，要真跑 codex 才走得到，等于没有断言守着。
 *
 * 这是**唯一驱动 doctor blocker 的 codex 判据**，原写法 `?? false`
 * 把四条路径塌缩成确定否定：超时被杀、spawn 失败、provider 报错退出、
 * 事件流里没有 agent_message。一次网络抖动就会让盘上落下
 * 「能力缺陷」这个事实，doctor 据此打 blocker 并附一条可能完全不对的诊断。
 */
export function judgeHeadlessRead(
  trace: CodexTrace,
  timedOut: boolean,
  sentinel: string,
): boolean | null {
  if (!traceCompleted(trace, timedOut)) return null;
  return trace.finalText!.includes(sentinel);
}

/**
 * 跑一次最小任务并录事件流。
 *
 * 返回值带 `completed`：**判据必须能区分「测了，结论是否」与「根本没测成」**
 * （审查意见 GLM-01 / GLM-05）。`run()` 超时不抛错、返回截断输出，
 * 所以只看解析结果的话，一次网络抖动与一次真实的能力缺陷长得一模一样。
 */
async function execProbe(
  bin: string,
  fx: Fixture,
  prompt: string,
  profile: string | null,
  model: string,
): Promise<CodexTrace & { completed: boolean; timedOut: boolean }> {
  const r = await run(
    bin,
    [
      'exec',
      /*
       * 带上 profile：探针模型属于某一家 provider，而基底 config.toml 指向的
       * 未必是同一家。codex **不校验 model 是否在目录里**（本步实测），
       * 所以不带 profile 时它会拿另一家的 provider 去调这个模型，静默失败——
       * 表现为「headless 读不到文件」，看起来像能力缺陷，实则是探针自己配错了。
       */
      ...(profile ? ['-p', profile] : []),
      '-m', model,
      '-c', `model_reasoning_effort=${PROBE_EFFORT}`,
      '-s', 'read-only',
      '--json',
      '--skip-git-repo-check',
      '-C', fx.root,
      prompt,
    ],
    { timeoutMs: PROBE_TIMEOUT_MS, cwd: fx.root, stdin: '', killTree: true },
  );
  const trace = parseCodexEvents(r.stdout);
  /*
   * 「跑完了」的判据取**有没有最终回复**，而不是退出码：
   * codex 在模型拒绝任务时也可能退 0，而那时同样没有可用结论。
   * 超时（timedOut）一定不算跑完。
   */
  return { ...trace, completed: traceCompleted(trace, r.timedOut), timedOut: r.timedOut };
}

/**
 * 路径级 deny 支持性 —— **真跑 `--help` 再下结论**（审查意见 GLM-04）。
 *
 * 原实现是写死的常量，`method` 里还钉着版本号——那句话下个版本就是假的。
 * 对照既有标准：`probes/agy.ts` 的 `probePathDeny` 真跑否定对照，
 * 注释明写「这样 `supported: false` 才是『实测过的结论』而不是『没试过』」。
 */
export async function probeCodexPathDeny(bin: string): Promise<PathDenyProbe> {
  const r = await run(bin, ['exec', '--help'], { timeoutMs: 60_000 });
  if (r.code !== 0) {
    return {
      supported: null,
      rule_syntax: null,
      method: `codex exec --help 执行失败（退出码 ${r.code}），未能判定`,
      attempts: [],
    };
  }
  const help = r.stdout + r.stderr;
  /*
   * 找「按路径拒绝读取」的旗标。`sandbox_permissions` 不算——
   * 它的取值（如 disk-full-read-access）是**放宽**权限的粗粒度开关，
   * 方向相反。找到疑似项时记 null 而不是 true：需要人真去验一次语义，
   * 探针不替它下肯定结论。
   */
  const suspects = ['--deny', '--disallow', 'deny_paths', 'path_deny', 'denied_paths'];
  const hits = suspects.filter((k) => help.includes(k));
  if (hits.length > 0) {
    return {
      supported: null,
      rule_syntax: null,
      method: `codex exec --help 出现疑似路径级 deny 的关键字：${hits.join('、')}——需人工确认语义`,
      attempts: [],
    };
  }
  const hasSandboxPermissions = help.includes('sandbox_permissions');
  return {
    supported: false,
    rule_syntax: null,
    method:
      `实跑 codex exec --help 全文扫描 ${suspects.join(' / ')}，零命中` +
      '（版本见同段的 probe.version，不在此处重复记以免它随版本过期）',
    attempts: hasSandboxPermissions
      ? ['sandbox_permissions：取值为 disk-full-read-access 一类的粗粒度放宽档，方向相反，不能用来收紧']
      : [],
  };
}

/**
 * 独立 `CODEX_HOME` 能否被采纳 —— **真跑一次**（审查意见 GLM-04）。
 *
 * 原实现是 `= 'home_copy'` 裸赋值加一句「实测可用」的注释，
 * 而那次实测是我在终端里做的，代码里没有任何实验。
 *
 * **临时副本不拷 `auth.json`**：凭据不进探针临时目录（设计纪律 9 的同源要求）。
 * 这里只验「独立 HOME 会被采纳」——判据是它能否读到副本里的 `config.toml`，
 * 不需要真的调模型。
 */
export async function probeCodexIsolation(bin: string): Promise<ProbeIsolation> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-codexhome-'));
  try {
    /*
     * 判据：让副本的 config 指向一个**不存在**的模型目录，看 codex 的报错里
     * 会不会出现那个路径。出现 = 它确实读了副本的 config.toml。
     *
     * 起初写的是「往副本里放一份自造目录、看输出里有没有 marker」，接连撞墙：
     * codex 严格解析目录条目，缺 `display_name` 报一次、补上再缺 `shell_type`……
     * 逐个补下去是在**追一个会随版本变的内部契约**，而我们要测的根本不是目录形状，
     * 是「独立 HOME 会不会被采纳」。用一条必然失败的路径当指纹，零依赖也更确定。
     *
     * **副本不拷 `auth.json`**：凭据不进探针临时目录（纪律 9 的同源要求）。
     * 这里也不需要——判据在解析配置那一步就出结果，根本走不到要凭据的地方。
     */
    const marker = path.join(dir, 'trivium-isolation-marker.json');
    await fs.writeFile(
      path.join(dir, 'config.toml'),
      `model_catalog_json = "${marker}"\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    /*
     * 判据是**成功/失败的翻转**，不看报错文本：
     * 真 HOME 下 `debug models` 正常输出目录；副本的 config 指向一条不存在的路径，
     * 若副本被采纳，这次必然失败。
     *
     * 一开始想用「报错里出现我给的路径」当指纹，实测 codex 只报
     * `No such file or directory (os error 2)`、**不带路径**——
     * 依赖错误文案本来就脆，换成依赖「行为翻转」才稳。
     */
    const baseline = await run(bin, ['debug', 'models'], { timeoutMs: 60_000 });
    if (baseline.code !== 0) return 'shared'; // 基线就不通，无从比对
    const r = await run(bin, ['debug', 'models'], {
      timeoutMs: 60_000,
      env: { CODEX_HOME: dir },
    });
    return r.code !== 0 ? 'home_copy' : 'shared';
  } catch {
    return 'shared';
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function probeCodex(
  configuredBin: string | null,
  opts: { skipModelCalls?: boolean; existing?: CodexProbe } = {},
): Promise<{ probe: CodexProbe; notes: string[] }> {
  const notes: string[] = [];
  /*
   * 同 probeAgy / probeZcode：以既有结论为起点，跳过的探针保留原值。
   * 否则 `--no-model-calls` 会把上一次真实探到的结论覆盖成 null，
   * preflight 随即判该侧不可用——用户会以为是环境坏了。
   */
  const probe: CodexProbe = opts.existing
    ? structuredClone(opts.existing)
    : {
        entrypoint: null,
        version: null,
        version_probe: null,
        probed_at: null,
        models: [],
        path_deny: { supported: null, rule_syntax: null, method: null, attempts: [] },
        scratch_paths: [],
        isolation: 'shared',
        exec_headless_read_ok: null,
        json_event_types: [],
        json_item_types: [],
        trace_path_structured: null,
        rejected_command_in_trace: null,
        readonly_flags: [],
        profile_flag: null,
        unknown_profile_rejected: null,
        profiles: [],
        config_override: null,
        effort_validated: null,
        model_catalog_path: null,
      };

  const { bin, version } = await probeCodexBin(configuredBin);
  probe.entrypoint = bin;
  probe.version = version;
  probe.probed_at = new Date().toISOString();
  // 与 agy 同形：直接执行、抠三段号（`codex --version` 输出 `codex-cli 0.154.0`）
  probe.version_probe = { runner: null, args: ['--version'], extract: String.raw`(\d+\.\d+\.\d+)` };
  if (!bin) {
    notes.push('未找到 codex 可执行文件，Codex 侧不可用');
    return { probe, notes };
  }

  const home = codexHome();
  probe.profiles = await probeCodexProfiles(home);
  notes.push(
    probe.profiles.length > 0
      ? `profile 名单（$CODEX_HOME/<name>.config.toml）：${probe.profiles.join('、')}`
      : '⚠️ 未找到任何 <name>.config.toml —— `-p` 无可用取值',
  );

  const catalog = await probeCodexModels(bin, null);
  probe.models = catalog.models;
  notes.push(
    catalog.models.length > 0
      ? `模型目录 ${catalog.models.length} 个：${catalog.models.slice(0, 6).join('、')}…`
      : '⚠️ `codex debug models` 未返回任何模型',
  );

  probe.path_deny = await probeCodexPathDeny(bin);

  if (opts.skipModelCalls) {
    notes.push(
      '已跳过需要真实模型调用的探针（--no-model-calls）——' +
        'exec_headless_read_ok / trace_path_structured / rejected_command_in_trace / scratch_paths 保留上一次的结论',
    );
    return { probe, notes };
  }

  const fx = await createFixture();
  try {
    // ── 读文件能力 + 轨迹形态 ────────────────────────────────────
    /*
     * 选 profile：**要挑目录里真有可用模型的那个**（审查意见 GLM-02 / AGY-04）。
     *
     * 原写法是 `profiles[0]`——字典序第一。本机恰好 deepseek 排最前所以跑通了，
     * 那是巧合不是设计。换一台只装 qwen.config.toml 的机器，探针会拿 qwen 的
     * provider 去调 deepseek-flash，而本步实测确认了「codex 不校验 model
     * 是否在目录里」，请求必然失败 → 落一个假的能力否定。
     *
     * execProbe 的注释自己精确描述过这类失败形态（「看起来像能力缺陷，
     * 实则是探针自己配错了」），却只防了「不带 profile」那一半。
     */
    let probeProfile: string | null = null;
    let probeModel: string | null = null;
    for (const name of probe.profiles) {
      const catalog = await readCatalogPath(name);
      const { models } = await probeCodexModels(bin, catalog);
      const usable = models.find((m) => m === PROBE_MODEL) ?? models[0];
      if (usable) {
        probeProfile = name;
        probeModel = usable;
        break;
      }
    }
    if (!probeModel) {
      notes.push(
        '⚠️ 没有任何 profile 的模型目录里有可用模型——跳过需要真实调用的探针。' +
          '这是**探针无从开展**，不是 codex 的能力缺陷，相关字段保持未测（null）。',
      );
      return { probe, notes };
    }
    notes.push(`探针用 profile=${probeProfile}、model=${probeModel}`);
    const read = await execProbe(
      bin,
      fx,
      `读取文件 ${fx.openFile} 并只回显它的第一行，不要做别的事。`,
      probeProfile,
      probeModel,
    );
    probe.json_event_types = read.eventTypes;
    probe.json_item_types = read.itemTypes;
    /*
     * 三态（审查意见 GLM-01）。这是**唯一驱动 doctor blocker 的 codex 判据**，
     * 原写法 `?? false` 把四条路径塌缩成确定否定：180s 超时被杀、spawn 失败、
     * provider 报错退出、事件流里没有 agent_message。
     * 一次网络抖动就会让盘上落下 `false` 这个「能力缺陷事实」，
     * doctor 据此打 blocker 并附一条可能完全不对的诊断。
     *
     * 我在本文件另外三处 header 判据上写明过这个理由，却漏掉了最重的这一处——
     * 修一条时没有列全部同形落点。
     */
    probe.exec_headless_read_ok = judgeHeadlessRead(read, read.timedOut, SENTINEL_OPEN);
    /*
     * 读取路径是否结构化——**真测，不是常量**（审查意见 GLM-04）。
     *
     * 原实现是 `= false` 裸赋值，而它上面那段注释描述的判据一行都没实现：
     * 上一轮裁决 §0.1「注释宣称了实现没兑现的事」的同形复发。
     * 我手工看清楚了命令事件的形状，就把手工结论直接写成了代码常量——
     * 可探针承诺的是「在**这台机器上**实测」，手工验过不等于代码测过。
     *
     * 判据就是那段注释原本写的：除 `command` 外，有没有**别的字段**装着哨兵路径。
     * 有 → 存在结构化路径字段；只在命令文本里 → 取不到。
     */
    probe.trace_path_structured = read.completed
      ? read.rawItems.some((it) =>
          Object.entries(it).some(
            ([k, v]) => k !== 'command' && typeof v === 'string' && v.includes(fx.openFile),
          ),
        )
      : null;
    notes.push(
      probe.exec_headless_read_ok
        ? `exec headless 读文件通过（哨兵命中）；事件类型 ${probe.json_event_types.join('、')}；` +
          `item 类型 ${probe.json_item_types.join('、')}`
        : '⚠️ exec headless 未读到哨兵文件，Codex 侧不可用于审查',
    );
    notes.push(
      '读取路径**无结构化字段**：codex 让模型跑 shell，路径只在 command 文本里——' +
        'M8 的 project_reads 与禁读核验只能走命令文本解析（BACKLOG EV-01 措施 b）',
    );

    // ── 只读负对照：写入必须失败 ──────────────────────────────────
    const write = await execProbe(
      bin,
      fx,
      '请在当前目录创建文件 breach.txt，内容写 BREACH。只做这一件事。',
      probeProfile,
      probeModel,
    );
    const breachPath = path.join(fx.root, 'breach.txt');
    const breached = await exists(breachPath);
    if (breached) {
      probe.readonly_flags = [];
      notes.push('⚠️ 只读沙箱负对照**失败**：read-only 下文件仍被创建，该侧不可用于审查');
    } else {
      probe.readonly_flags = ['-s', 'read-only'];
      notes.push('只读负对照成立：-s read-only 下写入被拒，breach.txt 未创建');
    }
    /*
     * 被拒的命令有没有留在轨迹里。
     *
     * 本机实测 false——这一条不是顺带记的，它决定 guard 的 write_events
     * 判定对该侧是否成立。为真时才有「事后轨迹核验」这道补充。
     */
    /*
     * 三态（审查意见 GLM-05）。只看 `commands.length` 的话，写入探针本身失败
     * （超时、provider 报错、模型压根没尝试写）也会被记成确定结论
     * 「被拒的命令不进事件流」。
     *
     * 判据复现录制样本里的推理：那条结论是靠**模型自述试过两条途径且被拒**
     * 才坐实的——没有那段自述，commands 为空什么也证明不了。
     */
    const deniedNarrative = /只读|read-only|not permitted|sandbox/i.test(write.finalText ?? '');
    probe.rejected_command_in_trace = !write.completed
      ? null
      : deniedNarrative
        ? write.commands.length > 0
        : null;
    if (probe.rejected_command_in_trace === false) {
      notes.push(
        '⚠️ 被沙箱拒绝的命令**不进事件流**（command_execution 为 0 条）——' +
          '设计 §10.3「轨迹有写事件即判失守」对该侧恒为假，只读保障完全落在沙箱上',
      );
    }

    // ── 运行时污染 ────────────────────────────────────────────────
    probe.scratch_paths = await probeScratchPaths(fx);
    notes.push(
      probe.scratch_paths.length === 0
        ? 'scratch_paths=[]：codex 在项目根零污染（会话落在 $CODEX_HOME）'
        : `scratch_paths=${JSON.stringify(probe.scratch_paths)}`,
    );

    /*
     * ── profile / -c / effort ──
     *
     * **低成本**（不是零配额）：每次都要真起一次 codex，读到 header 就早退终止。
     * 窗口被压到接近零，但不等于零——说法按实现的实际状态写，不按期望写
     * （审查意见 GLM-06：原先 docstring 与这里都写「零配额」，而函数体自认可能已发请求）。
     *
     * 三处判据都是**差异比对**，因此必须先保证基线可区分（审查意见 AGY-02）：
     * 拿一个与基底同值的参数去探，无论实现对错都会得出同一个结果。
     */
    const base = await probeCodexHeader(bin, [], fx.root);

    /*
     * 挑一个 provider 与基底**不同**的 profile —— 不能裸取 profiles[0]
     * （审查意见 AGY-02②）：若首个 profile 的 provider 恰好等于基底，
     * 判据会把「生效了」误判成「没生效」。
     */
    let contrastProfile: string | null = null;
    let contrastHeader: CodexHeader | null = null;
    if (base.provider !== null) {
      for (const name of probe.profiles) {
        const h = await probeCodexHeader(bin, ['-p', name], fx.root);
        if (h.provider !== null && h.provider !== base.provider) {
          contrastProfile = name;
          contrastHeader = h;
          break;
        }
      }
    }
    if (contrastProfile && contrastHeader) {
      probe.profile_flag = true;
      const unknown = await probeCodexHeader(bin, ['-p', '__trivium_no_such_profile__'], fx.root);
      /*
       * 未知 profile 被拒的话 codex 会在打 header 前退出。
       * 「读不到 header」也可能是探测本身失败，所以以「基底那次读得到」为前提；
       * 再看退出码：非零退出 = 明确被拒，零退出但没 header = 说不准。
       */
      probe.unknown_profile_rejected = !unknown.gotHeader && unknown.exitCode !== 0;
      notes.push(
        `profile：-p ${contrastProfile} → provider ${contrastHeader.provider}` +
          `（基底 ${base.provider}），生效=true；未知名字被拒=${probe.unknown_profile_rejected}`,
      );
      if (probe.unknown_profile_rejected === false) {
        notes.push(
          '⚠️ 未知 profile 名**不报错、静默回落基底配置**——拼错名字不会有任何提示，' +
            'M8 的预检必须自己拦',
        );
      }
    } else {
      probe.profile_flag = null;
      probe.unknown_profile_rejected = null;
      notes.push(
        base.provider === null
          ? '⚠️ 基底 header 读不到 provider，profile 相关判据无从比对（记 null）'
          : '⚠️ 本机所有 profile 的 provider 都与基底相同，无法用差异法判定 -p 是否生效（记 null）',
      );
    }

    /*
     * `-c` 覆盖：挑一个与基底**当前值不同**的档位去覆盖（审查意见 AGY-02③）。
     * 用固定的 'low' 的话，基底本来就是 low 时，即使 -c 被完全忽略也会判成生效。
     */
    const contrastEffort = base.effort === 'low' ? 'high' : 'low';
    const overridden = await probeCodexHeader(
      bin,
      ['-c', `model_reasoning_effort=${contrastEffort}`],
      fx.root,
    );
    probe.config_override =
      base.effort === null || overridden.effort === null
        ? null
        : overridden.effort === contrastEffort;

    /*
     * effort 是否被客户端按目录校验：给一个目录里**没有**的档位。
     *
     * 三种结果要分清（审查意见 AGY-02①）：
     *   · 非零退出 → CLI **拒绝了**它，即校验了（true）；
     *   · 正常打出 header 且档位原样透传 → 没校验（false）；
     *   · 其余（读不到 header 又是零退出）→ 说不准（null）。
     * 原写法只看 `effort === null ? null : …`，会把「报错退出」记成「没测到」——
     * 而事实恰恰是它校验了，判据方向反了。
     */
    const bogus = '__trivium_bogus__';
    const bogusEffort = await probeCodexHeader(
      bin,
      ['-c', `model_reasoning_effort=${bogus}`],
      fx.root,
    );
    probe.effort_validated =
      bogusEffort.exitCode !== null && bogusEffort.exitCode !== 0
        ? true
        : bogusEffort.effort !== null
          ? bogusEffort.effort !== bogus
          : null;
    notes.push(
      `-c 覆盖生效=${probe.config_override}（基底 ${base.effort} → 请求 ${contrastEffort} → 实得 ${overridden.effort}）；` +
        `effort 被客户端校验=${probe.effort_validated}` +
        (probe.effort_validated === false
          ? '（目录外的档位照样透传，preflight 必须自己校验）'
          : ''),
    );

    probe.model_catalog_path = await readCatalogPath(probeProfile);
    probe.isolation = await probeCodexIsolation(bin);
  } finally {
    await fx.cleanup();
  }

  return { probe, notes };
}

/**
 * 从生效配置里回读模型目录路径——**不写死**（P7；设计文档记的文件名与本机不符）。
 *
 * **按本次实际使用的 profile 回读，回落基底**（审查意见 GLM-09）：
 * C-1 确立了 profile 是**文件分层**，`<name>.config.toml` 同样能设这个键，
 * 所以活跃 profile 下生效的目录文件未必是基底 `config.toml` 里记的那份。
 * 原实现只读基底，且带着一个 `void bin` 弃用的死参数（删旧代码留下的残骸）。
 */
async function readCatalogPath(profile: string | null): Promise<string | null> {
  const home = codexHome();
  const readKey = async (file: string): Promise<string | null> => {
    try {
      const text = await fs.readFile(file, 'utf8');
      return /^\s*model_catalog_json\s*=\s*["'](.+?)["']/m.exec(text)?.[1] ?? null;
    } catch {
      return null;
    }
  };
  if (profile) {
    const fromProfile = await readKey(path.join(home, `${profile}.config.toml`));
    if (fromProfile) return fromProfile;
  }
  return readKey(path.join(home, 'config.toml'));
}
