/**
 * 配置加载与合并（设计 §13.1）。
 *
 * 优先级：内置默认 → .trivium/config.yaml → .trivium/config.local.yaml → 命令行参数。
 * `probe:` 段由 doctor 回填，人不手工编辑；它落在 config.local.yaml（本机结论，不进 Git）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import type { AgentConfig, AgentId, Config, Ctx, ProbeSection, Stage } from './types.js';
import { CRITICS } from './types.js';
import { EXIT, TriviumError, envError, swallowedTextHint } from './exit-codes.js';
import { exists, expandHome } from './util/fsx.js';
import { isGitRepo, repoRoot } from './util/git.js';
import { validateConfig } from './schemas.js';

export const CONFIG_SCHEMA_ID = 'trivium.config.v2' as const;
/** v1 的 schema 标识。只出现在读侧：磁盘上的旧配置按它识别并做内存迁移 */
export const CONFIG_SCHEMA_ID_V1 = 'trivium.config.v1' as const;
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
      agent: null,
    },
    zcode: {
      entry: null,
      version: null,
      readonly_flags: [],
      model_override: null,
      trace_source: null,
      trace_args_source: null,
      response_field: null,
      path_deny: { supported: null, rule_syntax: null, method: null, attempts: [] },
      scratch_paths: [],
      isolation: 'shared',
      model_id_form: null,
      models: [],
    },
    auth: {},
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
      allow_partial_flag: true,
      /*
       * 默认审核者集合维持两家——与现状等价，成本不变（设计 13.1.1）。
       * 从注册表的 criticEnabled 派生而不是写死 `['gemini','glm']`：
       * 启用第三家时这里自动跟随，不必记得回来改（纪律 7）。
       */
      default_critics: [...CRITICS],
      max_critics: 3,
      timeout_s: { plan: 900, code: 1200, bug: 1200 },
      /*
       * 每次 `--wait` 的窗口，同时也是**用户能收到进度的最小间隔**——Bash 工具在
       * 命令退出前不回传 stdout，窗口内 Driver 物理上说不了话。原值 540s 意味着
       * 用户每 9 分钟才听到一声，与没有反馈在体感上没有区别。180s 是成本与体感的
       * 折中：更短（如 60s）会让 code 阶段逼近百次往返，收益却是边际的。
       */
      wait_timeout_s: 180,
      heartbeat_stale_s: 120,
      retry: { transient_max: 1 },
      cache: false,
      min_tool_calls: perStage(5),
      min_project_reads: perStage(3),
      on_drift: 'warn',
      on_drift_related: 'fail',
      // `.env*` 只匹配根目录（glob 的 * 不跨 /），子目录里的 config/.env.production 要靠 **/.env*
      sensitive_globs: ['.env*', '**/.env*', '**/*.pem', '**/*.key', '**/id_rsa*'],
      block_severities: ['blocker', 'major'],
      skip_doc_only_review: false,
      skip_globs: ['**/*.md', 'docs/**', '**/*.txt'],
      never_skip_globs: [
        '**/package.json', '**/pubspec.yaml', '**/Cargo.toml', '**/requirements*.txt',
        '.github/**', '.gitlab-ci.yml', 'Dockerfile', '.claude/**', '.trivium/**',
      ],
    },
    agents: {
      gemini: {
        vendor: 'antigravity',
        bin: null,
        agent: 'trivium-critic',
        // slug 后缀才是权威：模型名带 -high/-medium/-low 时 buildAgyArgs 不传 --effort
        // （agy 1.2.0 会报冲突，坑 P-16）。当前两档 slug 全是 -high，此处三项均随之写 high，
        // 否则归档 front-matter 会记下一个从未生效的 effort 值。
        effort: { plan: 'high', code: 'high', bug: 'high' },
        readonly_commands: [
          'git log', 'git blame', 'git diff', 'git show', 'git status',
          'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc',
        ],
      },
      glm: { vendor: 'zcode', entry: null, max_turns: 40, unsupported_override: 'reject' },
    },
    // 两档的差异只在 GLM 侧用不用 Flash——gemini 侧两档相同。
    // 不写 profile 级 effort：该字段无任何读取点，且 slug 自带后缀时 effort 本就不生效。
    profiles: {
      default: {
        gemini: { plan: 'gemini-3.8-flash-high', code: 'gemini-3.8-flash-high', bug: 'gemini-3.8-flash-high' },
        glm: { plan: 'GLM-5.3', code: 'GLM-5.3', bug: 'GLM-5.3' },
      },
      flash: {
        gemini: { plan: 'gemini-3.8-flash-high', code: 'gemini-3.8-flash-high', bug: 'gemini-3.8-flash-high' },
        glm: { plan: 'GLM-5.3-Flash', code: 'GLM-5.3-Flash', bug: 'GLM-5.3-Flash' },
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

/**
 * 应用 `--profile` 覆盖：换掉本次运行使用的模型档位（AGY-04 / GLM-05）。
 *
 * profile 是 `config.yaml` 里预设的成套模型（default / flash），
 * 平时由 `active_profile` 固定。`--profile` 让单次运行临时切档，省去改配置再改回来。
 *
 * 实现刻意选择「覆盖 `active_profile`」而不是给 `routeModel` 加参数：
 * 后者内部读的就是 `cfg.profiles[cfg.active_profile]`，覆盖源头则两个调用点、
 * 以及 review/preflight 里那两句「profile『X』未定义模型」的错误文案全部自动正确，
 * 不存在漏改一处的可能。
 *
 * 与 `--model-*` 不冲突且优先级更低：后者直指某个具体模型（routeModel 的 `cli` 档），
 * 本参数只是换一张默认值表——更具体的赢。
 */
export function applyProfileOverride(cfg: Config, name: string | null | undefined): Config {
  const wanted = name?.trim();
  if (!wanted) return cfg;
  if (!cfg.profiles[wanted]) {
    const available = Object.keys(cfg.profiles);
    throw new TriviumError(
      EXIT.USAGE,
      `profile「${wanted}」不存在。\n` +
        `  可用档位：${available.length > 0 ? available.join('、') : '（config.yaml 未定义任何 profile）'}` +
          swallowedTextHint(wanted),
    );
  }
  return { ...cfg, active_profile: wanted };
}

/**
 * 按 vendor 取某个 Agent 的配置段，并把联合类型收窄到该厂商的形状。
 *
 * `agents` 是 `Partial<Record<AgentId, AgentConfig>>`，直接 `cfg.agents.gemini!.agent`
 * 有两个问题：一是 `!` 在配置缺段时不报错，而是把 undefined 带到下游某处才崩，
 * 错误信息与真正的原因（配置里没有这一段）毫无关系；二是联合类型下访问
 * 厂商专属字段编译不过，只能再加一次断言，于是 vendor 写错也不会被发现。
 *
 * 本函数把两件事一起做掉：**缺段就地失败并说清是哪一段**，vendor 不符也失败
 * ——后者是路由错配，会把请求发给错误的 CLI（与 `run.v2` 的 vendor 逐值比对同一纪律）。
 */
export function agentConfigOf<V extends AgentConfig['vendor']>(
  cfg: Config,
  id: AgentId,
  vendor: V,
): Extract<AgentConfig, { vendor: V }> {
  const seg = cfg.agents[id];
  if (!seg) {
    throw envError(
      `配置里缺少 agents.${id} 段，而本次运行需要它。\n` +
        `  已配置的 Agent：${Object.keys(cfg.agents).join('、') || '（无）'}`,
    );
  }
  if (seg.vendor !== vendor) {
    throw envError(
      `agents.${id}.vendor 是 ${seg.vendor}，但此处按 ${vendor} 使用它。\n` +
        '  vendor 决定适配器路由与禁读矩阵，错配会把请求发给另一家 CLI。',
    );
  }
  return seg as Extract<AgentConfig, { vendor: V }>;
}

/**
 * v1 → v2 的**内存迁移**（设计 §13.1.1，M7b 第 4 步）。
 *
 * 返回迁移后的配置与一条人读说明；入参不是 v1 时原样返回、说明为 null（幂等）。
 *
 * **磁盘上的文件不动。** 这是本步最重要的性质：已初始化的目标项目升级编排器后
 * **不改配置也能跑**，`trivium init` 的一次性改写因此是可选优化而非必要步骤。
 * 若改成「读到 v1 就拒绝启动」，每个已有项目都会在升级瞬间硬失败。
 *
 * 迁移四件事：
 *   · `critics.*` → `agents.*`；
 *   · `allow_single_flag` → `allow_partial_flag`（两者同时在场时**以新名为准**并在说明里点出）；
 *   · 补 `default_critics`（取 `agents` 的实有键）与 `max_critics`；
 *   · schema 标识改写为 v2。
 *
 * `default_critics` 取实有键而不是 `CRITICS` 全集，是为了让「配置里只写了一家」
 * 的旧项目迁移后仍然只跑那一家——迁移不该悄悄扩大审查面。
 */
export function migrateConfigV1(raw: unknown): { config: unknown; note: string | null } {
  if (typeof raw !== 'object' || raw === null) return { config: raw, note: null };
  const c = { ...(raw as Record<string, unknown>) };
  const review0 = c['review'] as Record<string, unknown> | undefined;

  /*
   * 触发条件不只看 `schema` 字段（审查这条要特别留意）。
   *
   * `config.local.yaml` 是**覆盖片段**，通常根本没有 `schema` 键，却完全可能写着
   * `critics.gemini.bin` 这种本机路径覆盖。只认 schema 字段的话，那类文件不会被迁移，
   * 它的 `critics` 段就会原样穿过合并、被 v2 的 `additionalProperties: false` 判非法——
   * 用户看到的是「你的本机配置不合法」，而真正的原因是我们改了键名。
   *
   * 所以再认两个旧形态的**特征键**。两者在 v2 里都已不是合法键，
   * 出现即可断定是旧配置，不存在误伤。
   */
  const looksV1 =
    c['schema'] === CONFIG_SCHEMA_ID_V1 ||
    c['critics'] !== undefined ||
    review0?.['allow_single_flag'] !== undefined;
  if (!looksV1) return { config: raw, note: null };

  const changes: string[] = [];

  if (c['critics'] !== undefined && c['agents'] === undefined) {
    c['agents'] = c['critics'];
    changes.push('critics.* → agents.*');
  } else if (c['critics'] !== undefined) {
    /*
     * 两段并存：`agents` 已在，旧的 `critics` 会被下面的 delete 丢掉。
     * **必须说出来**（审查意见 AGY-02 ≡ GLM-03）——现实触发形态是「手工升级时
     * 抄入了默认 agents 段，却忘了删自己原有的 critics 覆盖」，那里面的
     * `bin` / `max_turns` 等自定义值会无声消失。
     * 与紧邻的 allow_single_flag 冲突处理同一模式：静默取其一是最坏的选择。
     */
    changes.push('同时写了 critics 与 agents 两段，以 agents 为准（critics 里的自定义值未生效）');
  }
  delete c['critics'];

  const review = { ...((c['review'] as Record<string, unknown> | undefined) ?? {}) };
  if (review['allow_single_flag'] !== undefined) {
    if (review['allow_partial_flag'] === undefined) {
      review['allow_partial_flag'] = review['allow_single_flag'];
      changes.push('review.allow_single_flag → allow_partial_flag');
    } else {
      /*
       * 两个名字同时在场：**以新名为准**，并把这件事说出来。
       * 静默取其一是最坏的选择——用户改了旧名却不生效，且无从察觉。
       */
      changes.push('review 同时写了 allow_single_flag 与 allow_partial_flag，以后者为准');
    }
    delete review['allow_single_flag'];
  }
  /*
   * **迁移不补 `default_critics`**（审查意见 AGY-01 ≡ GLM-01，两侧独立判为 major）。
   *
   * 原实现按「迁移后 `agents` 的实有键」补这个值，理由写的是「只配了一家的项目，
   * 迁移后不该被悄悄加上第二家」。**那个理由建立在一个错误前提上**：它以为 v1 的
   * `critics` 键集表达了「选哪几侧」。并不是——`review.ts` 的选侧写的是
   * `opts.onlyCritic ? [opts.onlyCritic] : [...CRITICS]`，v1 运行时走注册表派生的全集，
   * **与配置里写了几家无关**。于是「v1 只配一家」的项目其实一直在跑两家，
   * 迁移后把它记成一家不是「不扩大」，而是**缩小**，直接违反本步
   * 「旧配置不改也能跑、行为不变」的核心承诺。
   *
   * 更糟的是它会**顶掉别人的值**：`deepMerge` 对数组是整体替换，而 `config.local.yaml`
   * 最典型的内容就是单侧本机覆盖（只改一家的 `agent` 或 `bin`）。实测那种片段迁移后
   * 带上 `default_critics: ['gemini']`，合并结果里另一家被静默清除。
   *
   * 正确做法是**什么都不做**：磁盘片段本就无须自带该键，合并时自然继承
   * `defaultConfig()` 的 `[...CRITICS]`，校验针对的也是合并结果。
   * 设计 13.1.1 的迁移段原本就只列了三件事，没有这一条——是我多做了。
   */
  /*
   * `max_critics` 只在**整份配置**（有 schema 字段的那份）上补默认值。
   * 覆盖片段补了也无害，但会让 config.local.yaml 凭空多出一个用户没写的键，
   * 日后排查「这个值哪来的」会多绕一圈。
   */
  if (c['schema'] === CONFIG_SCHEMA_ID_V1 && review['max_critics'] === undefined) {
    review['max_critics'] = 3;
  }
  if (Object.keys(review).length > 0) c['review'] = review;

  if (c['schema'] === CONFIG_SCHEMA_ID_V1) c['schema'] = CONFIG_SCHEMA_ID;

  // 只改了片段里不存在的东西（例如空对象）：没有实质变化就不打扰用户
  if (changes.length === 0) return { config: c, note: null };

  return {
    config: c,
    note: changes.map((x) => `    · ${x}`).join('\n'),
  };
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

  /*
   * **迁移必须逐源进行、且在 deepMerge 之前**（设计 §13.1.1）。
   *
   * 顺序颠倒会得到一个静默错误的结果：`defaultConfig()` 已是 v2 形状（带 `agents`），
   * 先合并的话，磁盘上的 `critics` 段只会作为一个**额外的键**并排落在结果里，
   * 而 `agents` 仍是内置默认——用户配的 bin / agent / max_turns **一个都不生效**，
   * 却没有任何报错。先迁移再合并，`critics` 在进入合并前就已改名为 `agents`。
   */
  const migrated: { file: string; shared: boolean; note: string }[] = [];
  for (const name of ['config.yaml', 'config.local.yaml']) {
    const p = path.join(triviumDir, name);
    const data = await readYamlIfExists(p);
    if (data !== undefined) {
      const { config: out, note } = migrateConfigV1(data);
      if (note) migrated.push({ file: p, shared: name === 'config.yaml', note });
      cfg = deepMerge(cfg, out);
      sources.push(p);
    }
  }

  /*
   * 告警走 **stderr**，每次 CLI 调用**最多一条**（设计 §13.1.1 的方框）。
   *
   * 不能走 stdout：`--json` 模式下 stdout 只允许出现一个 JSON，
   * 掺一行人读文字就会破坏 Hook 与 skills 读取 CLI 输出的协议。
   * `warn()` 本身恒走 stderr，这里依赖的就是那条铁律。
   *
   * 两个源都是 v1 时**合并成一条**而不是各打一条（审查意见 GLM-07）：
   * 条文说的是「每次 CLI 调用最多一次」，逐源 warn 会打出两条。
   *
   * 出路按源区分（审查意见 GLM-05）：`init` 的一次性改写**只作用于 `config.yaml`**，
   * 对它说「跑 init」是有效的出路；而 `config.local.yaml` 不进 Git、是本机私有文件，
   * `init` 去改写它越界了（它的职责是布置团队共享的运行时）。
   * 对后者说「跑 init」会让用户跑完发现告警还在，以为 init 坏了。
   *
   * 跨进程不去重：`--start` 派生的 worker 是独立进程，会各打一次。
   * 为此引入跨进程状态不值得——那是个需要落盘、需要清理、还会在并发下出错的
   * 机制，用来省掉一行提示。
   */
  if (migrated.length > 0) {
    const { warn } = await import('./util/log.js');
    const body = migrated
      .map((m) => `  ${m.file}：\n${m.note}\n    出路：${
        m.shared
          ? '`trivium init` 可一次性改写它（带备份）'
          : '本文件不进 Git，init 不会改它——手工把 `critics:` 改名为 `agents:`，或忽略本提示'
      }`)
      .join('\n');
    warn(
      `检测到 ${CONFIG_SCHEMA_ID_V1} 形态的配置，已在内存中按 ${CONFIG_SCHEMA_ID} 迁移` +
        `（磁盘文件未改动，旧配置继续可用）：\n${body}`,
    );
  }

  if (!(await exists(triviumDir)) && !opts.allowUninitialized) {
    throw envError(
      `本项目尚未初始化 TriviumCode（缺 ${TRIVIUM_DIR}/）。请先运行 \`trivium init\`。`,
    );
  }

  /*
   * 合并结果按 trivium.config.v2 校验，非法值**明确报错**而不是静默落回默认。
   * 原先一处校验都没有：`gate: "off"` 会让 deepMerge 用标量顶掉整个对象，
   * `block_commit` 变 undefined、提交拦截静默关闭；`approval_lock_scope: sesion`
   * 拼错反而按 global 全局加锁；`stop_hook_max_blocks: 0` 让收工拦截一次都不生效。
   * 与项目其它处处「宁可失败也不静默降级」的纪律对齐。
   */
  const problems = validateConfig(cfg);
  if (problems.length > 0) {
    throw envError(
      `配置不合法（${sources.slice(1).join('、') || '内置默认'}）：\n` +
        problems.map((p) => `  · ${p}`).join('\n') +
        '\n  契约见 skills/dual-critic/schema/config.v2.json。',
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

/**
 * 把 probe 段写回 config.local.yaml，保留该文件的其它字段。
 *
 * **必须在全局锁内调用**（审查意见 GLM-07）。这是对全局单文件的「读 → 改 → 写」，
 * 原子替换只防撕裂不防丢更新：两个并发 preflight、或 preflight 的自动 doctor 撞上
 * 手工 doctor，会互相覆盖（缓存时间戳或新鲜探针被旧内存态盖掉）。
 * 本项目已在 state.json 上踩过同一个坑，这里不再重复。
 *
 * 加锁由调用方负责——`persistProbe` 自己加锁会与调用方已持有的锁死锁。
 * 唯一的调用入口是 `persistProbeLocked`。
 */
async function persistProbeUnlocked(triviumDir: string, probe: ProbeSection): Promise<string> {
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

/** 串行化版本：所有生产路径都走这个（GLM-07） */
export async function persistProbe(
  triviumDir: string,
  probe: ProbeSection,
  heartbeatStaleMs = 120_000,
): Promise<string> {
  const { withGlobalLock } = await import('./lock.js');
  return withGlobalLock({ triviumDir, heartbeatStaleMs }, () =>
    persistProbeUnlocked(triviumDir, probe),
  );
}

/**
 * 只更新 probe 的一部分（探活缓存等），不覆盖其它段。
 *
 * 与 persistProbe 的区别：它接受一个 mutate 函数，在**锁内**先读回最新的
 * probe 再改——避免用调用方的旧内存态整体覆盖别人刚写的结论。
 */
export async function patchProbe(
  triviumDir: string,
  mutate: (p: ProbeSection) => void,
  heartbeatStaleMs = 120_000,
): Promise<string> {
  const { withGlobalLock } = await import('./lock.js');
  return withGlobalLock({ triviumDir, heartbeatStaleMs }, async () => {
    const p = path.join(triviumDir, 'config.local.yaml');
    const existing = ((await readYamlIfExists(p)) as Record<string, unknown> | undefined) ?? {};
    const probe = ((existing['probe'] as ProbeSection | undefined) ?? defaultProbe());
    mutate(probe);
    return persistProbeUnlocked(triviumDir, probe);
  });
}

/** 探针结论是否已过期（preflight 用，设计 §8.1） */
export function probeIsFresh(cfg: Config): boolean {
  const at = cfg.probe.generated_at;
  if (!at) return false;
  const ageMs = Date.now() - new Date(at).getTime();
  return Number.isFinite(ageMs) && ageMs < cfg.probe_ttl_days * 86_400_000;
}
