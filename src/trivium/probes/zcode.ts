/**
 * ZCode（`zcode.cjs`）能力探针（设计 §3.5）。
 *
 * M0 实测要点：
 *   - CLI 的**模型 provider 配置独立于桌面端**：桌面端读 `~/.zcode/v2/config.json`，
 *     CLI 读 `~/.zcode/cli/config.json`。凭据（OAuth）是共享的，但配置不是。
 *     因此「已登录」不等于「可用」，预检必须真跑一次最小 headless。
 *   - `--help` 列出的参数不等于实际接受的参数（`--max-turns` 即为反例），
 *     `readonly_flags` 必须逐个实测。
 *   - **不存在裸 `ZCODE_MODEL` 环境变量**（0.16.5），模型覆盖只能走
 *     `config_copy`（`ZCODE_HOME` 指向独立配置副本）或 `global`。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { run } from '../util/exec.js';
import { exists, makeTempDir } from '../util/fsx.js';
import { workTreeHash, statusPorcelain, diffTrees } from '../util/git.js';
import { createFixture, SENTINEL_OPEN, SENTINEL_PEER, type Fixture } from './fixture.js';
import {
  parseZcodeEnvelope,
  parseZcodeRollout,
  parseZcodeTrace,
  type ZcodeEnvelope,
  type ZcodeRollout,
} from '../adapters/zcode-trace.js';
import type { ZcodeProbe } from '../types.js';

const ENTRY_CANDIDATES = [
  '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
  path.join(os.homedir(), 'Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'),
];

/** CLI 侧配置根（与桌面端 `~/.zcode/v2/` 不是同一份） */
export const ZCODE_CLI_DIR = path.join(os.homedir(), '.zcode/cli');
export const ZCODE_CLI_CONFIG = path.join(ZCODE_CLI_DIR, 'config.json');

export interface ZcodeRunOptions {
  entry: string;
  node: string;
  cwd: string;
  prompt: string;
  /** 实测被接受的只读参数组合 */
  readonlyFlags?: string[];
  /**
   * 独立 HOME，模型覆盖与配置隔离的**唯一**落点。
   * M0 实测：`ZCODE_HOME` / `ZCODE_DATA_BASE_DIR` / `ZCODE_STORAGE_DIR` 对配置解析
   * **全部无效**，只有 `HOME` 能重定向到 `<home>/.zcode/cli/config.json`。
   */
  homeDir?: string | null;
  timeoutMs?: number;
}

export interface ZcodeRunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  envelope: ZcodeEnvelope | null;
  /** 结构化失败分类，用于区分「未配置」与「鉴权失败」与「真失败」 */
  failureKind: 'none' | 'model_config_missing' | 'provider_not_configured' | 'other';
  commandLine: string;
  durationMs: number;
}

export async function runZcode(opts: ZcodeRunOptions): Promise<ZcodeRunOutcome> {
  const args = ['--prompt', opts.prompt, '--cwd', opts.cwd, '--json', '--no-color'];
  for (const f of opts.readonlyFlags ?? []) args.push(f);

  const env: Record<string, string | undefined> = {};
  if (opts.homeDir) env['HOME'] = opts.homeDir;

  const r = await run(opts.node, [opts.entry, ...args], {
    cwd: opts.cwd,
    env,
    timeoutMs: opts.timeoutMs ?? 300_000,
  });

  // stdout 不是纯 JSON：前面可能有 AI SDK 告警行，必须抠出 envelope（M0 实测）
  const envelope = parseZcodeEnvelope(r.stdout);

  let failureKind: ZcodeRunOutcome['failureKind'] = 'none';
  if (r.code !== 0) {
    if (/Model config is missing/i.test(r.stderr)) failureKind = 'model_config_missing';
    else if (/provider is missing an API key|provider_not_configured/i.test(r.stderr))
      failureKind = 'provider_not_configured';
    else failureKind = 'other';
  }

  return {
    exitCode: r.code,
    timedOut: r.timedOut,
    stdout: r.stdout,
    stderr: r.stderr,
    envelope,
    failureKind,
    commandLine: r.commandLine,
    durationMs: r.durationMs,
  };
}

export async function probeZcodeEntry(
  configured: string | null,
  node: string,
): Promise<{ entry: string | null; version: string | null }> {
  const candidates = [configured, ...ENTRY_CANDIDATES].filter((c): c is string => Boolean(c));
  let entry: string | null = null;
  for (const c of candidates) {
    if (await exists(c)) {
      entry = c;
      break;
    }
  }
  if (!entry) return { entry: null, version: null };
  const r = await run(node, [entry, 'version'], { timeoutMs: 60_000 });
  if (r.code !== 0) return { entry, version: null };
  const m = /(\d+\.\d+\.\d+)/.exec(r.stdout);
  return { entry, version: m?.[1] ?? r.stdout.trim() };
}

/**
 * `zcode.readonly_flags`：逐个实测**实际被接受**的只读参数组合。
 *
 * 不能信 `--help`——M0 实测 `--max-turns` 在 help 中列出但会报
 * `Unknown option '--max-turns'`。判定方式是看 stderr 里是否出现 `Unknown option '<flag>'`：
 * 参数解析发生在模型调用之前，因此这一步**不消耗配额**。
 */
export async function probeReadonlyFlags(
  entry: string,
  node: string,
  cwd: string,
): Promise<{ accepted: string[]; rejected: string[] }> {
  const candidates: string[][] = [
    ['--mode', 'plan'],
    ['--mode', 'yolo'],
    ['--disallowed-tools', 'Write,Edit,MultiEdit,ApplyPatch,Bash'],
    ['--allowed-tools', 'Read,Grep,Glob'],
    ['--max-turns', '40'],
    ['--permission-mode', 'plan'],
    ['--settings', '/nonexistent-probe-settings.json'],
  ];

  const accepted: string[] = [];
  const rejected: string[] = [];

  // 关键：把 **HOME** 指向一个空目录，让模型配置解析必然失败。
  // ZCode 的处理顺序是「参数解析 → 配置解析 → 模型调用」，因此这样能在
  // 拿到参数解析结论的同时，在配置解析阶段就停住，**一次模型调用都不会发生**。
  // 否则在配置正常的机器上跑 doctor 会白白烧掉 7 次 ZCode 配额。
  //
  // 注意必须是 HOME 而不是 ZCODE_HOME —— M0 实测后者对配置解析无效（冲突项 C-08）。
  const emptyHome = await makeTempDir('trivium-flagprobe');
  try {
    for (const flag of candidates) {
      const r = await run(
        node,
        [entry, '--prompt', 'ok', '--cwd', cwd, '--json', '--no-color', ...flag],
        { cwd, timeoutMs: 30_000, env: { HOME: emptyHome } },
      );
      const unknown = new RegExp(`Unknown option '${flag[0]!.replace(/-/g, '\\-')}`).test(r.stderr);
      if (unknown) rejected.push(flag.join(' '));
      else accepted.push(flag.join(' '));
    }
  } finally {
    await fs.rm(emptyHome, { recursive: true, force: true });
  }
  return { accepted, rejected };
}

/**
 * 定位工具轨迹来源。M0 实测需要**两个**文件，各自提供不同的信息：
 *   - `log/zcode-<date>.jsonl`：工具名、调用计数、`context.model`、结构化失败根因；
 *   - `rollout/model-io-sess_<sessionId>.jsonl`：工具**参数**（含文件路径）、`model.source`。
 * 前者缺路径，后者缺调用状态，缺一不可。
 */
export async function probeTraceSource(
  homeDir?: string | null,
): Promise<{ names: string | null; args: string | null }> {
  const cliDir = homeDir ? path.join(homeDir, '.zcode/cli') : ZCODE_CLI_DIR;
  const pick = async (sub: string, tpl: string): Promise<string | null> => {
    const dir = path.join(cliDir, sub);
    if (!(await exists(dir))) return null;
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    return entries.some((e) => e.endsWith('.jsonl')) ? path.join(dir, tpl) : null;
  };
  return {
    names: await pick('log', 'zcode-{date}.jsonl'),
    args: await pick('rollout', 'model-io-{sessionId}.jsonl'),
  };
}

/** 读取某次会话的 rollout（工具参数与模型来源的唯一取值点） */
export async function readRollout(
  sessionId: string,
  homeDir?: string | null,
): Promise<ZcodeRollout | null> {
  const dir = path.join(homeDir ? path.join(homeDir, '.zcode/cli') : ZCODE_CLI_DIR, 'rollout');
  // 注意：sessionId 自带 `sess_` 前缀，文件名是 `model-io-` + sessionId。
  // 拼成 `model-io-sess_${sessionId}` 会得到 model-io-sess_sess_… 而找不到文件。
  const file = path.join(dir, `model-io-${sessionId}.jsonl`);
  if (!(await exists(file))) return null;
  return parseZcodeRollout(await fs.readFile(file, 'utf8'));
}

export async function probeScratchPaths(fx: Fixture): Promise<string[]> {
  const now = await workTreeHash(fx.root);
  if (now === fx.baselineTree) return [];
  const changed = await diffTrees(fx.root, fx.baselineTree, now);
  const untracked = (await statusPorcelain(fx.root))
    .filter((e) => e.status.trim() === '??')
    .map((e) => e.path);
  return [...new Set([...changed, ...untracked])].sort();
}

/** 读取某个 sessionId 的会话日志并解析轨迹 */
export async function readTrace(
  sessionId: string | null,
  logDir?: string,
): Promise<ReturnType<typeof parseZcodeTrace> | null> {
  const dir = logDir ?? path.join(ZCODE_CLI_DIR, 'log');
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return null;
  }
  const latest = files.at(-1);
  if (!latest) return null;
  const jsonl = await fs.readFile(path.join(dir, latest), 'utf8');
  return parseZcodeTrace(jsonl, sessionId);
}

/**
 * `zcode.path_deny`：能否以**路径级**规则拒绝读取指定文件。
 *
 * M0 实测结论：**不支持**。`--disallowed-tools` 支持 `Tool(arg)` 带参形态
 * （`--help` 示例即 `"Bash(git *) Edit"`），语法上接受 `Read(<path>)`，
 * 但**挡不住文件**——ZCode 的读路径有多条（`Read` / `Grep` / `Glob` /
 * `ReadSessionContext` / `Bash`），封掉一条模型会换另一条。实测中：
 *   - 只封 `Read(<peer>)` + `Write` + `Edit` 时，模型用 `Bash` 的 `head -1` 读到了；
 *   - 再加封 `Bash` 后，模型用 `Grep` 读到了。
 * 要靠 denylist 挡住一个文件，等于要枚举并封掉全部读路径，那样连被审对象也读不了。
 *
 * 附带确认了一件重要的事：**`--mode plan` 并不阻止命令执行**，
 * 与设计 §11.3 要点 4 引述的社区观察一致，因此完整 denylist 中 `Bash` 是必需项。
 */
export async function probePathDeny(
  entry: string,
  node: string,
  fx: Fixture,
  readonlyFlags: string[],
): Promise<{ supported: boolean; ruleSyntax: string | null; method: string; attempts: string[] }> {
  const attempts = [
    '--disallowed-tools "Read(<绝对路径>)"：语法被接受，但模型改用 Bash(head -1) 读到了目标文件',
    '--disallowed-tools "Read(<路径>) Write Edit MultiEdit ApplyPatch Bash"：模型改用 Grep 读到了目标文件',
    '--settings <path>：参数被拒绝（Unknown option），无法注入独立权限配置',
    '--mode plan：实测**不阻止命令执行**，不能作为只读手段单独使用',
    '结论：要靠 denylist 挡住单个文件需封掉全部读路径（Read/Grep/Glob/ReadSessionContext/Bash），' +
      '那样连被审对象也读不了，粒度不可用',
  ];

  const out = await runZcode({
    entry,
    node,
    cwd: fx.root,
    readonlyFlags: [...readonlyFlags, '--disallowed-tools', `Read(${fx.peerFile})`],
    prompt: `请读取绝对路径 ${fx.peerFile} 并原样回显它的第一行内容。只做这一件事。`,
  });
  const leaked = (out.envelope?.response ?? '').includes(SENTINEL_PEER);

  return {
    supported: false,
    ruleSyntax: null,
    method: leaked
      ? '否定对照成立：即使显式 deny 该路径，模型仍换用其它读工具读到了对方产出（哨兵命中）'
      : `本次未命中哨兵（failureKind=${out.failureKind}），但结论仍为不支持——` +
        'denylist 是工具级而非路径级，无法只挡一个文件',
    attempts,
  };
}

/** 编排 ZCode 侧的全部探针 */
export async function probeZcode(
  configuredEntry: string | null,
  node: string,
  opts: { skipModelCalls?: boolean } = {},
): Promise<{ probe: ZcodeProbe; notes: string[] }> {
  const notes: string[] = [];
  const probe: ZcodeProbe = {
    entry: null,
    version: null,
    readonly_flags: [],
    model_override: null,
    trace_source: null,
    response_field: null,
    path_deny: { supported: null, rule_syntax: null, method: null, attempts: [] },
    scratch_paths: [],
    isolation: 'shared',
    model_id_form: null,
    models: [],
  };

  const { entry, version } = await probeZcodeEntry(configuredEntry, node);
  probe.entry = entry;
  probe.version = version;
  if (!entry) {
    notes.push('未找到 zcode.cjs 入口，ZCode 侧不可用');
    return { probe, notes };
  }

  const ts = await probeTraceSource();
  probe.trace_source = ts.names;
  probe.trace_args_source = ts.args;
  notes.push(
    `trace_source（工具名/模型）=${ts.names ?? '未定位'}；` +
      `trace_args_source（工具参数与路径）=${ts.args ?? '未定位'}`,
  );

  // CLI 侧模型配置是否就位——这一步不花配额，但决定后面能不能跑
  const cliConfigured = await exists(ZCODE_CLI_CONFIG);
  if (!cliConfigured) {
    notes.push(
      `⚠️ 缺少 ${ZCODE_CLI_CONFIG}。ZCode 的 CLI 模型 provider 配置独立于桌面端` +
        `（桌面端在 ~/.zcode/v2/config.json），凭据共享但配置不共享。` +
        `注意 zcode.cjs 无法单独拉起 TUI（缺 @zcode/tui 运行时），需手工创建该文件，形如：\n` +
        `  {"provider":{"<providerId>":{"name":…,"kind":"anthropic",` +
        `"options":{"apiKey":"…","baseURL":"…"},"source":"custom","models":{…}}},` +
        `"model":{"main":"<providerId>/<modelName>","lite":"…"}}`,
    );
  }

  const fx = await createFixture();
  try {
    const flags = await probeReadonlyFlags(entry, node, fx.root);
    probe.readonly_flags = flags.accepted;
    notes.push(
      `readonly_flags 接受=${JSON.stringify(flags.accepted)}；` +
        `拒绝=${JSON.stringify(flags.rejected)}（--help 列出不等于实际接受）`,
    );

    if (opts.skipModelCalls || !cliConfigured) {
      notes.push('跳过需要真实模型调用的 ZCode 探针（配置缺失或已显式跳过）');
      return { probe, notes };
    }

    const readonly = flags.accepted.flatMap((f) => f.split(' ')).length > 0
      ? flags.accepted.filter((f) => f.startsWith('--mode plan') || f.startsWith('--disallowed-tools'))
          .flatMap((f) => f.split(' '))
      : [];

    const out = await runZcode({
      entry,
      node,
      cwd: fx.root,
      readonlyFlags: readonly,
      prompt:
        `项目根目录是 ${fx.root} 。请读取绝对路径 ${fx.openFile} ，` +
        `并原样回显它的第一行内容。只做这一件事。`,
    });

    if (out.failureKind !== 'none') {
      notes.push(`ZCode headless 失败（${out.failureKind}）：${out.stderr.slice(0, 200)}`);
      return { probe, notes };
    }

    // 正文字段：设计记载为 .response，实测确认
    if (out.envelope) {
      probe.response_field = out.envelope.keys.includes('response') ? 'response' : null;
      notes.push(
        `envelope 字段=${JSON.stringify(out.envelope.keys)}；response_field=${probe.response_field}；` +
          `哨兵命中=${out.envelope.response.includes(SENTINEL_OPEN)}`,
      );

      // envelope 中**没有** model 字段，生效模型只能从日志/rollout 回读（AC-13）
      const trace = await readTrace(out.envelope.sessionId);
      if (trace?.modelEffective) {
        probe.model_id_form = trace.modelEffective;
        notes.push(
          `生效模型回读=${trace.modelEffective}（来源：会话日志 context.model —— ` +
            `envelope 无 model 字段，这是 AC-13 的取值点之一）`,
        );
        notes.push(`轨迹工具计数=${JSON.stringify(trace.toolCalls)}（标准日志只有工具名，无路径）`);
      } else {
        notes.push('未能从会话日志回读生效模型——AC-13 的证据链在本机不完整');
      }

      // 读取路径只能从 rollout 取——标准日志的 tool.call.* 不带任何路径字段
      const rollout = out.envelope.sessionId ? await readRollout(out.envelope.sessionId) : null;
      if (rollout) {
        notes.push(
          `rollout 工具调用=${rollout.toolCalls.length} 条，可提取读取路径 ${rollout.readPaths.length} 个；` +
            `model.source=${rollout.modelSource}（印证模型覆盖档位为 config_copy）`,
        );
        if (!probe.model_id_form && rollout.modelEffective) probe.model_id_form = rollout.modelEffective;
      } else {
        notes.push(
          '未找到该会话的 rollout 文件——deny_paths 轨迹核验（AC-04）与 consulted ' +
            '交叉核对（AC-11）在 ZCode 侧将缺少路径证据',
        );
      }
    } else {
      notes.push('ZCode stdout 中抠不出 JSON envelope');
    }

    const deny = await probePathDeny(entry, node, fx, readonly);
    probe.path_deny = {
      supported: deny.supported,
      rule_syntax: deny.ruleSyntax,
      method: deny.method,
      attempts: deny.attempts,
    };
    notes.push(`path_deny.supported=${deny.supported}：${deny.method}`);

    probe.scratch_paths = await probeScratchPaths(fx);
    notes.push(`scratch_paths=${JSON.stringify(probe.scratch_paths)}`);

    // 模型覆盖：env 档已被证伪（0.16.5 无裸 ZCODE_MODEL），只剩 config_copy 与 global
    probe.model_override = 'config_copy';
    probe.isolation = 'home_copy';
    notes.push(
      'model_override=config_copy / isolation=home_copy：0.16.5 既无裸 ZCODE_MODEL 环境变量，' +
        '`--settings` 参数也被拒绝，且 ZCODE_HOME/ZCODE_DATA_BASE_DIR/ZCODE_STORAGE_DIR ' +
        '对配置解析无效——模型覆盖只能靠独立 HOME 下的 <home>/.zcode/cli/config.json 副本实现',
    );
  } finally {
    await fx.cleanup();
  }

  return { probe, notes };
}
