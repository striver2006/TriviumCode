/**
 * `preflight`：启动预检（设计 §8.1 / FR-18 / AC-16，按修订版 M3 计划 §1 实现）。
 *
 * 铁律：**预检失败时不得创建主题目录、不得写任何 `_meta/`、不得产生任何双审标记**（AC-16）。
 * 因此这里的每一项检查都必须是**无残留**的：
 *   - 归档根可写性用 `access` 探测；目录不存在时只检查**父目录**权限，严禁创建它；
 *   - 探活缓存写推迟到**全部检查通过之后**（审查意见 GLM-05）。
 *
 * 另一条铁律：探针过期时**快速失败**，不在预检里隐式拉起 `doctor`
 * （AGY-03 / GLM-08）。预检是被 skill 在**非交互**的 Bash 工具里调用的，
 * 无处告知也无从等待；而完整 `doctor` 会击穿 600s 工具超时，
 * 届时配额已烧而探针一字未落盘。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs, constants as fsConstants } from 'node:fs';
import type { AuthCacheEntry, Config, CriticId, Ctx, Stage } from './types.js';
import { CRITICS, STAGES } from './types.js';
import { EXIT, TriviumError } from './exit-codes.js';
import { agentConfigOf, patchProbe, probeIsFresh } from './config.js';
import { invokeAgy } from './adapters/agy.js';
import { invokeZcode, qualifyZcodeModel } from './adapters/zcode.js';
import { routeModel } from './adapters/base.js';
import { exists, sha256File } from './util/fsx.js';
import { isGitRepo } from './util/git.js';
import { run } from './util/exec.js';
import { step } from './util/log.js';

/**
 * 预检范围。`all` **不是** `Stage`——它不是一个审查阶段，
 * 塞进 `Stage` 会污染 `timeout_s` / `min_tool_calls` 等按阶段索引的配置（GLM-02）。
 */
export type PreflightScope = Stage | 'all';

export function parsePreflightScope(raw: string | null): PreflightScope {
  if (!raw) throw new TriviumError(EXIT.USAGE, `缺少 --stage，取值：${STAGES.join(' | ')} | all`);
  if (raw === 'all') return 'all';
  if ((STAGES as readonly string[]).includes(raw)) return raw as Stage;
  throw new TriviumError(
    EXIT.USAGE,
    `--stage 只接受 ${STAGES.join(' | ')} | all，收到：${raw}`,
  );
}

const scopeStages = (scope: PreflightScope): Stage[] => (scope === 'all' ? [...STAGES] : [scope]);

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** 失败时应返回的退出码 */
  exitCode?: number;
}

export interface PreflightResult {
  ok: boolean;
  scope: PreflightScope;
  checks: CheckResult[];
  /** 第一个失败项决定退出码 */
  exitCode: number;
  /** 通过后待写入的探活缓存（失败时不写——AC-16） */
  pendingAuthCache: Partial<Record<CriticId, AuthCacheEntry>>;
}

export interface PreflightOptions {
  ctx: Ctx;
  scope: PreflightScope;
  /** 本次实际生效的模型覆盖，用于按「实际生效值」校验 slug（GLM-01） */
  modelOverrides?: Partial<Record<CriticId, string>>;
  /** 跳过探活（调试用，会在输出中标注） */
  skipAuthCheck?: boolean;
  /** 强制重新探活，穿透 TTL 缓存（AGY-02） */
  refreshAuth?: boolean;
}

// ─────────────────────── 各项检查 ───────────────────────

/** 决定 agy 可用性的配置指纹：只读 Agent 定义文件（AGY-02） */
async function agyFingerprint(cfg: Config): Promise<string | null> {
  const p = path.join(os.homedir(), '.gemini/config/agents', agentConfigOf(cfg, 'gemini', 'antigravity').agent, 'agent.md');
  return (await exists(p)) ? sha256File(p) : null;
}

/** 决定 zcode 可用性的配置指纹：CLI 侧的 config.json（AGY-02 / 坑 P-08、P-10） */
async function zcodeFingerprint(): Promise<string | null> {
  const p = path.join(os.homedir(), '.zcode/cli/config.json');
  return (await exists(p)) ? sha256File(p) : null;
}

function authCacheValid(
  entry: AuthCacheEntry | undefined,
  cliVersion: string | null,
  fingerprint: string | null,
  ttlHours: number,
  now = Date.now(),
): { valid: boolean; reason: string } {
  if (!entry) return { valid: false, reason: '无缓存' };
  const ageH = (now - new Date(entry.checked_at).getTime()) / 3_600_000;
  if (!Number.isFinite(ageH)) return { valid: false, reason: '缓存时间戳不可解析' };
  if (ageH > ttlHours) return { valid: false, reason: `缓存已超过 ${ttlHours}h TTL` };
  // CLI 自升级过就失效——agy 在 M0 期间真的升过一次（坑 P-02）
  if (entry.cli_version !== cliVersion) {
    return { valid: false, reason: `CLI 版本已变（${entry.cli_version} → ${cliVersion}）` };
  }
  if (entry.fingerprint !== fingerprint) {
    return { valid: false, reason: '关键配置文件已变（Agent 定义或 CLI config.json）' };
  }
  return { valid: true, reason: `缓存有效（${ageH.toFixed(2)}h 前探活通过）` };
}

/** 探针新鲜度。过期即**快速失败**，不隐式拉起 doctor（AGY-03 / GLM-08） */
function checkProbeFreshness(cfg: Config): CheckResult {
  if (cfg.probe.generated_at === null) {
    return {
      name: '探针结论存在',
      ok: false,
      exitCode: EXIT.ENV,
      detail:
        '尚未运行过探针。请先手动运行 `trivium doctor`（约需 2~4 分钟，会消耗少量厂商配额），然后重试。\n' +
        '  预检刻意**不**自动拉起 doctor：它会击穿 Bash 工具的 600s 超时，届时配额已烧而结论未落盘。',
    };
  }
  if (!probeIsFresh(cfg)) {
    return {
      name: '探针结论未过期',
      ok: false,
      exitCode: EXIT.ENV,
      detail:
        `探针结论已过期（generated_at=${cfg.probe.generated_at}，超过 probe_ttl_days=${cfg.probe_ttl_days}）。\n` +
        '  请手动运行 `trivium doctor` 重新校准后重试。',
    };
  }
  return { name: '探针结论新鲜', ok: true, detail: `generated_at=${cfg.probe.generated_at}` };
}

/** CLI 版本与探针记录是否一致（治 agy 自升级，坑 P-02） */
async function checkCliVersions(cfg: Config): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  const bin = cfg.probe.agy.bin;
  if (!bin || !(await exists(bin))) {
    out.push({
      name: 'Antigravity 可调用',
      ok: false,
      exitCode: EXIT.ENV,
      detail: `探针记录的 agy 路径不可用：${bin ?? '(未记录)'}。请重新运行 doctor。`,
    });
  } else {
    const r = await run(bin, ['--version'], { timeoutMs: 60_000 });
    const v = r.code === 0 ? r.stdout.trim() : null;
    if (v === null) {
      out.push({ name: 'Antigravity 可调用', ok: false, exitCode: EXIT.ENV, detail: 'agy --version 失败' });
    } else if (v !== cfg.probe.agy.version) {
      out.push({
        name: 'Antigravity 版本与探针一致',
        ok: false,
        exitCode: EXIT.ENV,
        detail:
          `agy 版本已变（探针记录 ${cfg.probe.agy.version} → 实际 ${v}）。\n` +
          '  参数与行为可能随版本漂移，请重新运行 `trivium doctor`。',
      });
    } else {
      out.push({ name: 'Antigravity 可调用', ok: true, detail: `agy ${v}` });
    }
  }

  const entry = cfg.probe.zcode.entry;
  if (!entry || !(await exists(entry))) {
    out.push({
      name: 'ZCode 可调用',
      ok: false,
      exitCode: EXIT.ENV,
      detail: `探针记录的 zcode 入口不可用：${entry ?? '(未记录)'}。请重新运行 doctor。`,
    });
  } else {
    const node = cfg.runtime.node ?? process.execPath;
    const r = await run(node, [entry, 'version'], { timeoutMs: 60_000 });
    const m = r.code === 0 ? /(\d+\.\d+\.\d+)/.exec(r.stdout) : null;
    const v = m?.[1] ?? null;
    if (v === null) {
      out.push({ name: 'ZCode 可调用', ok: false, exitCode: EXIT.ENV, detail: 'zcode version 失败' });
    } else if (v !== cfg.probe.zcode.version) {
      out.push({
        name: 'ZCode 版本与探针一致',
        ok: false,
        exitCode: EXIT.ENV,
        detail: `zcode 版本已变（${cfg.probe.zcode.version} → ${v}）。请重新运行 doctor。`,
      });
    } else {
      out.push({ name: 'ZCode 可调用', ok: true, detail: `zcode ${v}` });
    }
  }
  return out;
}

/**
 * 模型 slug 合法性（GLM-01）。
 *
 * 按「**本次实际生效**的模型」校验——命令行覆盖 > profile。数据源是探针记录的模型清单。
 * 这一项的执行点不只在独立 `preflight` 命令，`review --start` 也必须内嵌同一套校验，
 * 否则覆盖参数的非法值会漏到运行中段才暴露（白烧配额 + strict 中止）。
 */
export function checkModelSlugs(
  cfg: Config,
  scope: PreflightScope,
  overrides: Partial<Record<CriticId, string>> = {},
): CheckResult {
  const bad: string[] = [];
  const agyModels = cfg.probe.agy.models;
  const zcodeModels = cfg.probe.zcode.models ?? [];

  for (const stage of scopeStages(scope)) {
    for (const critic of CRITICS) {
      const routed = routeModel(cfg, critic, stage, { cli: overrides[critic] ?? null });
      if (!routed.model) {
        bad.push(`${critic}/${stage}: profile「${cfg.active_profile}」未定义模型且无覆盖`);
        continue;
      }
      /*
       * 穷尽分支，不用 `if (gemini) … else …` 二分。
       *
       * 二分写法下，任何**非 gemini** 的审核者（含将来的第三家与测试桩）都会掉进
       * else 分支、被拿去按 ZCode 的模型目录校验，于是报一条驳斥自己的错：
       * 「模型 X 不在 ZCode 模型目录中」——而那侧压根不是 ZCode。
       * 新增 CriticId 时这里会直接编译不过，比运行期误报早得多。
       */
      if (critic === 'gemini') {
        // 未知 slug 会让 agy 直接非零退出，不会静默换模型——所以这里能硬校验
        if (agyModels.length > 0 && !agyModels.includes(routed.model)) {
          bad.push(
            `${critic}/${stage}: slug「${routed.model}」不在 agy models 中。` +
              `可用值：${agyModels.join(', ')}`,
          );
        }
      } else if (critic === 'glm') {
        // ZCode 侧允许短名，适配层会按探针回读的 providerId 补全前缀（坑 P-06）
        const qualified = qualifyZcodeModel(routed.model, cfg.probe.zcode.model_id_form ?? null);
        const short = (qualified ?? '').split('/').pop() ?? '';
        if (zcodeModels.length > 0 && !zcodeModels.some((m) => m === short || m === qualified)) {
          bad.push(
            `${critic}/${stage}: 模型「${routed.model}」不在 ZCode 模型目录中。` +
              `可用值：${zcodeModels.join(', ')}`,
          );
        }
      } else {
        const unreachable: never = critic;
        throw new Error(`未处理的审核者 slug 校验：${String(unreachable)}`);
      }
    }
  }

  return bad.length === 0
    ? {
        name: '模型 slug 合法',
        ok: true,
        detail: `已校验 ${scopeStages(scope).length} 个阶段 × ${CRITICS.length} 侧`,
      }
    : { name: '模型 slug 合法', ok: false, exitCode: EXIT.USAGE, detail: bad.join('\n  ') };
}

/** 只读能力可用（§8.1）：ZCode 的 readonly_flags 非空 + Antigravity 的只读 Agent 存在 */
async function checkReadonlyCapability(cfg: Config): Promise<CheckResult> {
  const problems: string[] = [];
  if (cfg.probe.zcode.readonly_flags.length === 0) {
    problems.push('探针未实测到任何可用的 ZCode 只读参数组合');
  }
  const agentPath = path.join(
    os.homedir(),
    '.gemini/config/agents',
    agentConfigOf(cfg, 'gemini', 'antigravity').agent,
    'agent.md',
  );
  if (!(await exists(agentPath))) {
    problems.push(
      `找不到只读审查 Agent 定义 ${agentPath}。` +
        '没有它 agy 会用完整工具集（含写工具），只读无从保障。请运行安装器。',
    );
  }
  return problems.length === 0
    ? { name: '只读能力可用', ok: true, detail: `ZCode 组合 ${cfg.probe.zcode.readonly_flags.join(' ')}` }
    : { name: '只读能力可用', ok: false, exitCode: EXIT.ENV, detail: problems.join('\n  ') };
}

/**
 * 归档根与 git（§8.1）。
 *
 * **无残留**：目录存在则 `access(W_OK)`；不存在则检查**父目录**权限，
 * 严禁为了探测而创建 `.reviews/`（AGY-01 / GLM-05）。
 */
async function checkArchiveAndGit(ctx: Ctx): Promise<CheckResult> {
  const problems: string[] = [];

  if (!(await isGitRepo(ctx.projectRoot))) {
    problems.push('当前目录不是 git 仓库——快照与漂移检测依赖 git');
  }

  const target = (await exists(ctx.archiveRoot)) ? ctx.archiveRoot : path.dirname(ctx.archiveRoot);
  try {
    await fs.access(target, fsConstants.W_OK);
  } catch {
    problems.push(`归档根不可写：${target}`);
  }

  return problems.length === 0
    ? { name: '归档与 git 可用', ok: true, detail: `归档根 ${ctx.archiveRoot}` }
    : { name: '归档与 git 可用', ok: false, exitCode: EXIT.ENV, detail: problems.join('\n  ') };
}

/** 命令 A 专属：`verify.build` / `verify.test` 皆空则拒绝启动（§14.1 / GLM-02） */
function checkVerifyConfigured(cfg: Config, scope: PreflightScope): CheckResult | null {
  if (scope !== 'all') return null;
  const b = cfg.verify.build.length;
  const t = cfg.verify.test.length;
  if (b + t > 0) {
    return { name: '编译测试命令已配置', ok: true, detail: `build ${b} 条 / test ${t} 条` };
  }
  return {
    name: '编译测试命令已配置',
    ok: false,
    exitCode: EXIT.ENV,
    detail:
      'verify.build 与 verify.test 皆为空，命令 A 拒绝启动——跑完全流程却无法收口是不可接受的（§14.1）。\n' +
      '  请把 `trivium doctor` 探测到的候选**逐条确认**后写入 .trivium/config.yaml。' +
      '编排器只执行显式配置的命令，不猜测执行。',
  };
}

// ─────────────────────── 探活 ───────────────────────

interface AuthProbe {
  critic: CriticId;
  result: CheckResult;
  /** 通过时待写入缓存的条目（失败时为 null——只缓存正结论，GLM-06） */
  cache: AuthCacheEntry | null;
}

async function probeAgyAuth(ctx: Ctx, opts: PreflightOptions): Promise<AuthProbe> {
  const cfg = ctx.config;
  const version = cfg.probe.agy.version;
  const fp = await agyFingerprint(cfg);
  const cached = cfg.probe.auth?.gemini;

  if (!opts.refreshAuth) {
    const v = authCacheValid(cached, version, fp, cfg.preflight.auth_cache_ttl_h);
    if (v.valid) {
      return {
        critic: 'gemini',
        result: { name: 'Antigravity 已认证', ok: true, detail: v.reason },
        cache: null, // 缓存本来就有效，无需重写
      };
    }
    step(`[gemini] 探活缓存不可用（${v.reason}），执行最小 headless 探活`);
  }

  const bin = cfg.probe.agy.bin;
  if (!bin) {
    return {
      critic: 'gemini',
      result: { name: 'Antigravity 已认证', ok: false, exitCode: EXIT.ENV, detail: 'agy 路径未记录' },
      cache: null,
    };
  }

  const out = await invokeAgy({
    bin,
    cwd: ctx.projectRoot,
    prompt: '只回复 OK 两个字母，不要调用任何工具。',
    model: cfg.probe.agy.models[0] ?? null,
    agent: agentConfigOf(cfg, 'gemini', 'antigravity').agent,
    timeoutMs: 120_000,
    pty: cfg.probe.agy.pty_required === true,
  });

  const ok = out.parsed.status === 'SUCCESS' && !out.timedOut;
  return {
    critic: 'gemini',
    result: ok
      ? { name: 'Antigravity 已认证', ok: true, detail: `探活通过（${Math.round(out.durationMs / 1000)}s）` }
      : {
          name: 'Antigravity 已认证',
          ok: false,
          exitCode: EXIT.ENV,
          detail:
            `探活失败（status=${out.parsed.status}）。请先交互登录一次：\`agy\` 然后完成登录流程。\n` +
            `  stderr: ${out.stderr.slice(0, 200)}`,
        },
    cache: ok ? { checked_at: new Date().toISOString(), cli_version: version, fingerprint: fp, ok: true } : null,
  };
}

async function probeZcodeAuth(ctx: Ctx, opts: PreflightOptions): Promise<AuthProbe> {
  const cfg = ctx.config;
  const version = cfg.probe.zcode.version;
  const fp = await zcodeFingerprint();
  const cached = cfg.probe.auth?.glm;

  if (!opts.refreshAuth) {
    const v = authCacheValid(cached, version, fp, cfg.preflight.auth_cache_ttl_h);
    if (v.valid) {
      return {
        critic: 'glm',
        result: { name: 'ZCode 已认证', ok: true, detail: v.reason },
        cache: null,
      };
    }
    step(`[glm] 探活缓存不可用（${v.reason}），执行最小 headless 探活`);
  }

  const entry = cfg.probe.zcode.entry;
  if (!entry) {
    return {
      critic: 'glm',
      result: { name: 'ZCode 已认证', ok: false, exitCode: EXIT.ENV, detail: 'zcode 入口未记录' },
      cache: null,
    };
  }
  if (fp === null) {
    return {
      critic: 'glm',
      result: {
        name: 'ZCode 已认证',
        ok: false,
        exitCode: EXIT.ENV,
        detail:
          '找不到 ~/.zcode/cli/config.json。ZCode 的 **CLI 模型 provider 配置独立于桌面端**' +
          '（桌面端在 ~/.zcode/v2/config.json），凭据共享但配置不共享——' +
          '「已登录」不等于「可用」。请手工创建该文件（结构见 M0 探针报告 §6.3）。',
      },
      cache: null,
    };
  }

  const out = await invokeZcode({
    entry,
    node: cfg.runtime.node ?? process.execPath,
    cwd: ctx.projectRoot,
    prompt: '只回复 OK 两个字母，不要调用任何工具。',
    readonlyArgs: ['--mode', 'plan'],
    timeoutMs: 180_000,
  });

  const ok = out.failureKind === 'none' && out.envelope !== null && !out.timedOut;
  return {
    critic: 'glm',
    result: ok
      ? { name: 'ZCode 已认证', ok: true, detail: `探活通过（${Math.round(out.durationMs / 1000)}s）` }
      : {
          name: 'ZCode 已认证',
          ok: false,
          exitCode: EXIT.ENV,
          detail:
            out.failureKind === 'provider_not_configured'
              ? 'provider 鉴权失败。检查 ~/.zcode/cli/config.json 里的 apiKey（格式 <id>.<secret>）。'
              : `探活失败（${out.failureKind}）：${out.stderr.slice(0, 200)}`,
        },
    cache: ok ? { checked_at: new Date().toISOString(), cli_version: version, fingerprint: fp, ok: true } : null,
  };
}

// ─────────────────────── 编排 ───────────────────────

export async function runPreflight(opts: PreflightOptions): Promise<PreflightResult> {
  const { ctx, scope } = opts;
  const cfg = ctx.config;
  const checks: CheckResult[] = [];
  const pendingAuthCache: Partial<Record<CriticId, AuthCacheEntry>> = {};

  // ① 探针新鲜度（过期即快速失败，不拉 doctor）
  checks.push(checkProbeFreshness(cfg));
  // ② ③ CLI 可调用且版本与探针一致
  if (checks.every((c) => c.ok)) checks.push(...(await checkCliVersions(cfg)));
  // ④ 只读能力
  if (checks.every((c) => c.ok)) checks.push(await checkReadonlyCapability(cfg));
  // ⑤ 模型 slug（按本次实际生效值）
  if (checks.every((c) => c.ok)) checks.push(checkModelSlugs(cfg, scope, opts.modelOverrides));
  // ⑥ 归档与 git（无残留探测）
  if (checks.every((c) => c.ok)) checks.push(await checkArchiveAndGit(ctx));
  // ⑦ 命令 A 的编译测试配置
  if (checks.every((c) => c.ok)) {
    const v = checkVerifyConfigured(cfg, scope);
    if (v) checks.push(v);
  }
  // ⑧ 探活（最贵的一项，放最后，前面失败就不必烧配额）
  if (checks.every((c) => c.ok)) {
    if (opts.skipAuthCheck) {
      checks.push({
        name: '探活',
        ok: true,
        detail: '⚠️ 已跳过（--skip-auth-check）。若凭据实际失效，会在运行中段才暴露。',
      });
    } else {
      const probes = await Promise.all([probeAgyAuth(ctx, opts), probeZcodeAuth(ctx, opts)]);
      for (const p of probes) {
        checks.push(p.result);
        if (p.cache) pendingAuthCache[p.critic] = p.cache;
      }
    }
  }

  const failed = checks.find((c) => !c.ok);
  return {
    ok: failed === undefined,
    scope,
    checks,
    exitCode: failed?.exitCode ?? (failed ? EXIT.ENV : EXIT.OK),
    pendingAuthCache,
  };
}

/**
 * 全部通过后才写探活缓存（GLM-05），且走全局锁（GLM-07）。
 *
 * 顺序很重要：**先判定通过，再写缓存**。反过来会让「预检失败」也留下写入，
 * 使 AC-16 的零工件承诺在字面上不成立。
 */
export async function commitAuthCache(ctx: Ctx, r: PreflightResult): Promise<void> {
  if (!r.ok) return;
  if (Object.keys(r.pendingAuthCache).length === 0) return;
  await patchProbe(
    ctx.triviumDir,
    (p) => {
      p.auth = { ...(p.auth ?? {}), ...r.pendingAuthCache };
    },
    ctx.config.review.heartbeat_stale_s * 1000,
  );
}

export function renderPreflight(r: PreflightResult): string {
  const lines = [`预检（scope=${r.scope}）`, '─'.repeat(60)];
  for (const c of r.checks) {
    lines.push(`  ${c.ok ? '✓' : '✗'} ${c.name}`);
    if (c.detail) for (const l of c.detail.split('\n')) lines.push(`      ${l}`);
  }
  lines.push('');
  lines.push(r.ok ? '✓ 预检通过' : `✗ 预检未通过（退出码 ${r.exitCode}）——不会产生任何工件`);
  return lines.join('\n');
}
