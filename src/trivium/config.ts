/**
 * 配置加载与合并（设计 §13.1）。
 *
 * 优先级：内置默认 → .trivium/config.yaml → .trivium/config.local.yaml → 命令行参数。
 * `probe:` 段由 doctor 回填，人不手工编辑；它落在 config.local.yaml（本机结论，不进 Git）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import type { Config, Ctx, ProbeSection, Stage } from './types.js';
import { envError } from './exit-codes.js';
import { exists, expandHome } from './util/fsx.js';
import { isGitRepo, repoRoot } from './util/git.js';

export const CONFIG_SCHEMA_ID = 'trivium.config.v1' as const;
export const TRIVIUM_DIR = '.trivium';

export function defaultProbe(): ProbeSection {
  return {
    generated_at: null,
    verify_suggestion: { build: [], test: [] },
    agy: {
      bin: null,
      version: null,
      models: [],
      headless_read_ok: null,
      json_schema_ok: null,
      pty_required: null,
      path_deny: { supported: null, rule_syntax: null, method: null, attempts: [] },
      scratch_paths: [],
      isolation: 'shared',
      read_strategy: null,
    },
    zcode: {
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
    },
    auth: { agy_checked_at: null, zcode_checked_at: null },
  };
}

/**
 * 内置默认配置。
 *
 * profiles 的模型 slug 已对照本机 `agy models` 与 ZCode 模型目录校验过存在性；
 * doctor 每次运行会重新校验，slug 失效时报错而非静默回落（设计 §11.5）。
 */
export function defaultConfig(): Config {
  const perStage = <T>(v: T): Record<Stage, T> => ({ plan: v, code: v, bug: v });
  return {
    schema: CONFIG_SCHEMA_ID,
    archive_root: '.reviews',
    topic: { max_len: 64, forbid_chars: ['/', '\\', '..', ' '] },
    runtime: { node: null, run_root: '~/.trivium/runs' },
    isolation: {
      peer_artifact_globs: ['**/*-gemini.md', '**/*-glm.md'],
      deny_via_cli: 'auto',
      context_max_docs: 12,
    },
    review: {
      parallel: true,
      failure_policy: 'strict',
      allow_single_flag: true,
      timeout_s: { plan: 900, code: 1200, bug: 1200 },
      wait_timeout_s: 540,
      heartbeat_stale_s: 120,
      retry: { transient_max: 1 },
      cache: false,
      min_tool_calls: perStage(5),
      min_project_reads: perStage(3),
      on_drift: 'warn',
      on_drift_related: 'fail',
      sensitive_globs: ['.env*', '**/*.pem', '**/*.key', '**/id_rsa*'],
      block_severities: ['blocker', 'major'],
      skip_doc_only_review: false,
      skip_globs: ['**/*.md', 'docs/**', '**/*.txt'],
      never_skip_globs: [
        '**/package.json', '**/pubspec.yaml', '**/Cargo.toml', '**/requirements*.txt',
        '.github/**', '.gitlab-ci.yml', 'Dockerfile', '.claude/**', '.trivium/**',
      ],
    },
    critics: {
      gemini: {
        vendor: 'antigravity',
        bin: null,
        agent: 'trivium-critic',
        effort: { plan: 'high', code: 'medium', bug: 'high' },
        readonly_commands: [
          'git log', 'git blame', 'git diff', 'git show', 'git status',
          'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc',
        ],
      },
      glm: { vendor: 'zcode', entry: null, max_turns: 40, unsupported_override: 'reject' },
    },
    profiles: {
      default: {
        gemini: { plan: 'gemini-3.1-pro-high', code: 'gemini-3.8-flash-high', bug: 'gemini-3.1-pro-high' },
        glm: { plan: 'GLM-5.3', code: 'GLM-5.3-Flash', bug: 'GLM-5.3' },
      },
      architecture: {
        gemini: { plan: 'gemini-3.1-pro-high', code: 'gemini-3.1-pro-high', bug: 'gemini-3.1-pro-high', effort: 'high' },
        glm: { plan: 'GLM-5.3', code: 'GLM-5.3', bug: 'GLM-5.3' },
      },
      hotfix: {
        gemini: { plan: 'gemini-3.8-flash-low', code: 'gemini-3.8-flash-low', bug: 'gemini-3.8-flash-low' },
        glm: { plan: 'GLM-5.3-Flash', code: 'GLM-5.3-Flash', bug: 'GLM-5.3-Flash' },
      },
      security: {
        gemini: { plan: 'gemini-3.1-pro-high', code: 'gemini-3.1-pro-high', bug: 'gemini-3.1-pro-high', effort: 'high' },
        glm: { plan: 'GLM-5.3', code: 'GLM-5.3', bug: 'GLM-5.3' },
      },
    },
    active_profile: 'default',
    gate: {
      require_adjudication: true,
      allow_defer: true,
      block_business_write_when_awaiting_approval: true,
      approval_lock_scope: 'session',
      approval_lock_ttl_h: 24,
      block_commit: true,
      stop_hook_max_blocks: 2,
      max_check_retries: 3,
      reason_policy: 'warn',
      joint_blocker_policy: 'warn',
    },
    preflight: { auth_cache_ttl_h: 1 },
    verify: { build: [], test: [] },
    retention: { run_dir_days: 30 },
    probe: defaultProbe(),
    probe_ttl_days: 7,
  };
}

/** 深合并：对象递归合并，数组与标量整体替换（数组语义是「覆盖」而非「追加」） */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base;
  if (Array.isArray(override) || typeof override !== 'object') return override as T;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

async function readYamlIfExists(p: string): Promise<unknown | undefined> {
  if (!(await exists(p))) return undefined;
  const raw = await fs.readFile(p, 'utf8');
  try {
    return YAML.parse(raw) ?? {};
  } catch (e) {
    throw envError(`配置文件解析失败：${p}\n  ${(e as Error).message}`);
  }
}

export interface LoadOptions {
  /** 起始目录，默认 process.cwd() */
  cwd?: string;
  /** 允许在非 git 仓库、无 .trivium 的目录加载（doctor 需要） */
  allowUninitialized?: boolean;
}

/** 加载配置并解析出运行上下文 */
export async function loadCtx(opts: LoadOptions = {}): Promise<Ctx> {
  const cwd = opts.cwd ?? process.cwd();

  const inRepo = await isGitRepo(cwd);
  if (!inRepo && !opts.allowUninitialized) {
    throw envError(
      '当前目录不是 git 仓库。TriviumCode 依赖 git 做快照与漂移检测，并要求工件纳入版本管理。',
    );
  }
  const projectRoot = (inRepo ? await repoRoot(cwd) : null) ?? cwd;
  const triviumDir = path.join(projectRoot, TRIVIUM_DIR);

  const sources: string[] = ['<builtin defaults>'];
  let cfg = defaultConfig();

  for (const name of ['config.yaml', 'config.local.yaml']) {
    const p = path.join(triviumDir, name);
    const data = await readYamlIfExists(p);
    if (data !== undefined) {
      cfg = deepMerge(cfg, data);
      sources.push(p);
    }
  }

  if (!(await exists(triviumDir)) && !opts.allowUninitialized) {
    throw envError(
      `本项目尚未初始化 TriviumCode（缺 ${TRIVIUM_DIR}/）。请先运行 \`trivium init\`。`,
    );
  }

  return {
    config: cfg,
    projectRoot,
    archiveRoot: path.resolve(projectRoot, cfg.archive_root),
    triviumDir,
    sources,
  };
}

/** run_root 展开为绝对路径 */
export function runRoot(cfg: Config): string {
  return expandHome(cfg.runtime.run_root);
}

/** 把 probe 段写回 config.local.yaml，保留该文件的其它字段 */
export async function persistProbe(triviumDir: string, probe: ProbeSection): Promise<string> {
  const p = path.join(triviumDir, 'config.local.yaml');
  const existing = ((await readYamlIfExists(p)) as Record<string, unknown> | undefined) ?? {};
  existing['probe'] = probe;
  await fs.mkdir(triviumDir, { recursive: true });
  const header =
    '# TriviumCode 本机配置（不进 Git）\n' +
    '# probe: 段由 `trivium doctor` 实测回填，请勿手工编辑（设计 §3.5 / §13.1）。\n' +
    '# 其它字段可覆盖 config.yaml 中的任意配置项。\n\n';
  await fs.writeFile(p, header + YAML.stringify(existing, { lineWidth: 0 }), 'utf8');
  return p;
}

/** 探针结论是否已过期（preflight 用，设计 §8.1） */
export function probeIsFresh(cfg: Config): boolean {
  const at = cfg.probe.generated_at;
  if (!at) return false;
  const ageMs = Date.now() - new Date(at).getTime();
  return Number.isFinite(ageMs) && ageMs < cfg.probe_ttl_days * 86_400_000;
}
