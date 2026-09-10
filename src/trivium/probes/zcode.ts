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
import { createFixture, SENTINEL_OPEN, type Fixture } from './fixture.js';
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
  /** 独立配置根，模型覆盖与日志隔离的落点 */
  zcodeHome?: string | null;
  logDir?: string | null;
  timeoutMs?: number;
}

export interface ZcodeRunOutcome {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  envelope: Record<string, unknown> | null;
  /** 结构化失败分类，用于区分「未配置」与「鉴权失败」与「真失败」 */
  failureKind: 'none' | 'model_config_missing' | 'provider_not_configured' | 'other';
  commandLine: string;
  durationMs: number;
}

export async function runZcode(opts: ZcodeRunOptions): Promise<ZcodeRunOutcome> {
  const args = ['--prompt', opts.prompt, '--cwd', opts.cwd, '--json', '--no-color'];
  for (const f of opts.readonlyFlags ?? []) args.push(f);

  const env: Record<string, string | undefined> = {};
  if (opts.zcodeHome) env['ZCODE_HOME'] = opts.zcodeHome;
  if (opts.logDir) env['ZCODE_LOG_DIR'] = opts.logDir;

  const r = await run(opts.node, [opts.entry, ...args], {
    cwd: opts.cwd,
    env,
    timeoutMs: opts.timeoutMs ?? 300_000,
  });

  let envelope: Record<string, unknown> | null = null;
  const trimmed = r.stdout.trim();
  if (trimmed.startsWith('{')) {
    try {
      envelope = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      envelope = null;
    }
  }

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

  // 关键：把 ZCODE_HOME 指向一个空目录，让模型配置解析必然失败。
  // ZCode 的处理顺序是「参数解析 → 配置解析 → 模型调用」，因此这样能在
  // 拿到参数解析结论的同时，在配置解析阶段就停住，**一次模型调用都不会发生**。
  // 否则在配置正常的机器上跑 doctor 会白白烧掉 7 次 ZCode 配额。
  const emptyHome = await makeTempDir('trivium-flagprobe');
  try {
    for (const flag of candidates) {
      const r = await run(
        node,
        [entry, '--prompt', 'ok', '--cwd', cwd, '--json', '--no-color', ...flag],
        { cwd, timeoutMs: 30_000, env: { ZCODE_HOME: emptyHome } },
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

/** 定位工具轨迹来源。M0 实测两个候选都存在，rollout 更完整但体积大 */
export async function probeTraceSource(logDirOverride?: string | null): Promise<string | null> {
  const candidates = [
    logDirOverride ? path.join(logDirOverride, 'zcode-{date}.jsonl') : null,
    path.join(ZCODE_CLI_DIR, 'log/zcode-{date}.jsonl'),
    path.join(ZCODE_CLI_DIR, 'rollout/model-io-sess_{sessionId}.jsonl'),
  ].filter((c): c is string => Boolean(c));

  for (const tpl of candidates) {
    const dir = path.dirname(tpl);
    if (!(await exists(dir))) continue;
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    if (entries.some((e) => e.endsWith('.jsonl'))) return tpl;
  }
  return null;
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

  probe.trace_source = await probeTraceSource();
  notes.push(`trace_source=${probe.trace_source ?? '未定位'}`);

  // CLI 侧模型配置是否就位——这一步不花配额，但决定后面能不能跑
  const cliConfigured = await exists(ZCODE_CLI_CONFIG);
  if (!cliConfigured) {
    notes.push(
      `⚠️ 缺少 ${ZCODE_CLI_CONFIG}。ZCode 的 CLI 模型 provider 配置独立于桌面端` +
        `（桌面端在 ~/.zcode/v2/config.json），凭据共享但配置不共享。` +
        `请先开一次 TUI 用 /model 选定模型，或手工创建该文件。`,
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
      const keys = Object.keys(out.envelope);
      probe.response_field = keys.includes('response') ? 'response' : (keys.find((k) => typeof out.envelope![k] === 'string') ?? null);
      const body = String(out.envelope[probe.response_field ?? 'response'] ?? '');
      notes.push(
        `envelope 字段=${JSON.stringify(keys)}；response_field=${probe.response_field}；` +
          `哨兵命中=${body.includes(SENTINEL_OPEN)}`,
      );
      const m = out.envelope['model'];
      if (typeof m === 'string') {
        probe.model_id_form = m;
        notes.push(`回读到的模型 id 形态=${m}`);
      }
    } else {
      notes.push('ZCode stdout 不是可解析的 JSON envelope');
    }

    probe.scratch_paths = await probeScratchPaths(fx);
    notes.push(`scratch_paths=${JSON.stringify(probe.scratch_paths)}`);

    // 模型覆盖：env 档已被证伪（0.16.5 无裸 ZCODE_MODEL），只剩 config_copy 与 global
    probe.model_override = 'config_copy';
    probe.isolation = 'settings_path';
    notes.push(
      'model_override=config_copy：0.16.5 不存在裸 ZCODE_MODEL 环境变量，' +
        '模型覆盖须经 ZCODE_HOME 指向的独立配置副本实现',
    );
  } finally {
    await fx.cleanup();
  }

  return { probe, notes };
}
