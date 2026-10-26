/** Claude 路线与指纹的唯一实现。元数据解析不执行 profile，不返回任何凭据。 */
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { accessSync, constants, readFileSync, readdirSync } from 'node:fs';
import type { ClaudeProbe, Config } from '../types.js';
import { IS_WIN } from '../util/platform.js';

export interface ClaudeRoute {
  mode: 'native' | 'profile';
  profile: string | null;
  nativeBin: string | null;
  bin: string | null;
  prefix: string[];
  wrapperSha256: string | null;
  configurationSha256: string | null;
  fingerprint: string;
  providerDeclared: string | null;
  modelsDeclared: string[];
  env: Record<string, string | undefined>;
  /*
   * 第三方网关 env（CC Switch 支撑，win32 实测 2026-10-19）：`--restricted` 按官方语义忽略
   * user/project/local settings 文件——CC Switch 恰好把网关配置写在用户级 settings.json 的
   * env 段，受限模式一开就回落官方端点报「未登录」。路线解析时从 settings.json 提取 env 段，
   * 每次带模型调用的子进程经 `claudeInvocationEnv` 以**环境变量**注入（EV-256；1.2.0～1.3.1
   * 曾并进 `--settings` 内联载荷，键值因此出现在进程命令行里）。受限模式认进程环境变量
   * （2026-10-24 win32 实测）。值只在内存，指纹只记 sha256；输出侧由 `scrubGatewayEnv` 对凭据类键
   * 逐值脱敏，模型名键的值按模型名对待（EV-257，判据见 `isModelNameKey` 与 `gatewayScrubPlan`；
   * 带上下文窗口后缀的形态见 `looksLikeModelName`，EV-258）。
   */
  settingsEnv: Record<string, string>;
  settingsEnvNote: string | null;
}

/** 从用户级 settings.json 文本提取可注入的 env 段：只收 `ANTHROPIC_`/`CLAUDE_` 前缀的非空字符串值 */
export function extractSettingsEnv(text: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  const env = parsed && typeof parsed === 'object' ? (parsed as { env?: unknown }).env : undefined;
  const out: Record<string, string> = {};
  if (!env || typeof env !== 'object') return out;
  for (const [k, v] of Object.entries(env)) {
    if (/^(ANTHROPIC_|CLAUDE_)/.test(k) && typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/** 键名里出现任一段即按凭据处理，哪怕后缀像模型名（`ANTHROPIC_AUTH_MODEL` 一类伪模型键） */
const CREDENTIAL_KEY_WORDS = new Set(['TOKEN', 'KEY', 'SECRET', 'AUTH', 'PASSWORD', 'PASSWD', 'PASS', 'PWD',
  'CREDENTIAL', 'CREDENTIALS', 'BEARER', 'COOKIE', 'HEADER', 'HEADERS', 'URL']);

/**
 * 网关 env 键是否是模型名键（EV-257）：模型名键的值是模型名，不进逐值脱敏的替换集——
 * `system/init` 的 `model` 是 CLI 读这些键解析出的配置值（不是网关回报的，EV-258 订正），
 * 恰等于这些键的值，一并替换会把回读吞成占位符。
 *
 * **区分大小写、只认全大写段**：`extractSettingsEnv` 不改键名大小写，小写或混写的键过不了正则、
 * 留在替换集。方向是 fail-closed——最坏是那个模型名被替换、回读记 unverified，不会放过凭据；
 * 先转大写会把原本被替换的键放进豁免集，是放松（计划三审 AGY-01 未采纳的那一半）。
 * 这只是第一道守卫，值还要过 `gatewayScrubPlan` 的另三道。
 */
export function isModelNameKey(key: string): boolean {
  if (!/^(ANTHROPIC|CLAUDE)_(?:[A-Z0-9]+_)*MODEL(?:_NAME)?$/.test(key)) return false;
  return !key.split('_').some((seg) => CREDENTIAL_KEY_WORDS.has(seg));
}

/**
 * Claude Code 上下文窗口后缀（`sonnet[1m]` 一类，EV-258）的**无锚片段**：1～4 位不以 0 开头的数字加小写 k 或 m。
 * 只定义片段、不带锚：守卫 4 要锚在串尾，profile 元数据要放在闭引号之前，锚定由各使用点自定
 * （计划三审 AGY-01 ≡ GLM-01）。大写、多位、其它单位一律不认，fail-closed——代价只是那个值照旧替换、回读记 unverified。
 */
const CONTEXT_WINDOW_SUFFIX_PATTERN = String.raw`\[[1-9][0-9]{0,3}[km]\]`;
const CONTEXT_WINDOW_SUFFIX = new RegExp(`${CONTEXT_WINDOW_SUFFIX_PATTERN}$`);

/** 剥掉末尾**一个**上下文窗口后缀；没有就原样返回。不验证剩下的部分，由调用方自己判 */
export function stripContextWindowSuffix(value: string): string {
  const m = CONTEXT_WINDOW_SUFFIX.exec(value);
  return m ? value.slice(0, m.index) : value;
}

/**
 * 模型名键的值是否「长得像模型名」（EV-257 守卫 4，计划三审 GLM-01）：字符集沿用 `claudeProfileMetadata`
 * 对模型名值的口径 `[\w./:+-]`、长度 1～128；按非字母数字字符切开后最长一段不超过 16
 * （真实模型名由短段拼成，随机令牌是长连续段）；不是 UUID 形态。不像就照旧替换，代价只是回读记 unverified。
 * 这不是判别凭据的完备算法：由短段拼成的凭据填进模型名键仍会放行，作为剩余边界登记在主设计。
 *
 * 末尾一个上下文窗口后缀（`qwen3.8-max[1m]`）先剥掉，上述判据全部作用于剥后的部分（EV-258）：
 * 方括号在别处、两个后缀、后缀内容不符都剥不掉或剥后仍含方括号，照旧不像。
 */
export function looksLikeModelName(value: string): boolean {
  const base = stripContextWindowSuffix(value);
  if (!/^[\w./:+-]{1,128}$/.test(base)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) return false;
  return base.split(/[^A-Za-z0-9]+/).every((seg) => seg.length <= 16);
}

export function claudeProfilesDir(): string {
  return path.join(os.homedir(), '.claude', 'profiles');
}

export function claudeProfileNames(dir = claudeProfilesDir()): string[] {
  try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.env'))
    .map(e => e.name.slice(0, -4)).sort(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}

/** profile 元数据里模型名值的形态：守卫 4 的字符集，可带一个上下文窗口后缀（EV-258，同一片段派生） */
const PROFILE_MODEL_VALUE = String.raw`[\w.\/:+-]+(?:${CONTEXT_WINDOW_SUFFIX_PATTERN})?`;
const PROFILE_MODEL_LINE = new RegExp(String.raw`^\s*export\s+(ANTHROPIC_(?:MODEL|DEFAULT_[A-Z_]+_MODEL|SMALL_FAST_MODEL))=`
  + `(?:"(${PROFILE_MODEL_VALUE})"|'(${PROFILE_MODEL_VALUE})'|(${PROFILE_MODEL_VALUE}))` + String.raw`\s*(?:#.*)?$`);

/**
 * 只接受独立静态 export 字符串。插值/命令替换/多行内容不作为元数据。
 * 不加引号的带后缀形态也收：shell 对赋值右侧不做路径名展开，`export M=qwen[1m]` 就是静态串
 * （sh / bash / zsh / dash 实测，计划三审 CODEX-01）。
 */
export function claudeProfileMetadata(text: string): { models: string[] } {
  const models: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = PROFILE_MODEL_LINE.exec(line);
    const model = m?.[2] ?? m?.[3] ?? m?.[4];
    if (model && !models.includes(model)) models.push(model);
  }
  return { models };
}

export function claudeRouteEnv(profile: string | null, parent: NodeJS.ProcessEnv = process.env): Record<string, undefined> {
  const patch: Record<string, undefined> = {};
  const exact = new Set(['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT']);
  for (const key of Object.keys(parent)) {
    if (key.startsWith('ANTHROPIC_') || exact.has(key) || (profile !== null && key === 'CLAUDE_CODE_OAUTH_TOKEN')) patch[key] = undefined;
  }
  return patch;
}

/**
 * claude 子进程的环境补丁（EV-256）：先清、后注，次序固定。
 *
 * 先展开 `route.env`（`claudeRouteEnv` 的清除补丁：父进程 `ANTHROPIC_*` 等置 undefined），
 * 再展开 `route.settingsEnv`（`extractSettingsEnv` 提取出的网关键）——同名键网关值胜出；
 * 父进程里有、settings.json 里没有的键仍被清除。未开 `settings_env_source` 或 env 段为空时
 * `settingsEnv` 是 `{}`，结果与 `route.env` 逐键相同。
 *
 * 网关键进入子进程的**唯一**入口：`invokeClaude` 与探针 `routeInvocation` 各调一次。
 * 不把网关键直接并进 `route.env`——它还给 `--version` / `--help` / 预检版本核对用，
 * 那些调用不发模型请求，不该带上凭据。
 */
export function claudeInvocationEnv(route: Pick<ClaudeRoute, 'env' | 'settingsEnv'>): Record<string, string | undefined> {
  return { ...route.env, ...route.settingsEnv };
}

export function executableFile(file: string | null): boolean {
  if (!file) return false;
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
}

function wrapperPath(): string | null {
  // Windows：可选路由包装器的 cmd 形态；win32 下 X_OK 近似可读检查，存在性即判据
  const names = IS_WIN ? ['cld.cmd', 'cld.exe'] : ['cld'];
  const candidates: string[] = [path.join(os.homedir(), '.local', 'bin'),
    ...(process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean)];
  for (const name of names) {
    for (const dir of candidates) {
      const file = path.join(dir, name);
      if (executableFile(file)) return file;
    }
  }
  return null;
}

export function claudeRouteKey(profile: string | null): string {
  return profile === null ? 'native' : `profile:${profile}`;
}

export function resolveClaudeRoute(cfg: Config, profile: string | null, version?: string | null): ClaudeRoute {
  const config = cfg.agents.claude;
  const c = config?.vendor === 'anthropic' ? config : undefined;
  const probe = cfg.probe.cli.claude;
  const nativeBin = c?.bin ?? probe?.entrypoint ?? null;
  const bin = profile === null ? nativeBin : (c?.profile_bin ?? wrapperPath());
  let wrapperSha256: string | null = null;
  let configurationSha256: string | null = null;
  let modelsDeclared: string[] = [];
  if (profile !== null) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(profile)) throw new Error('profile 名称形状不合法');
    const content = readFileSync(path.join(claudeProfilesDir(), `${profile}.env`), 'utf8');
    configurationSha256 = createHash('sha256').update(content).digest('hex');
    modelsDeclared = claudeProfileMetadata(content).models;
    if (bin) wrapperSha256 = createHash('sha256').update(readFileSync(bin)).digest('hex');
  }
  /*
   * 第三方网关 env（见 ClaudeRoute.settingsEnv 的说明）：只在 settings_env_source 显式开启时
   * 读取用户级 settings.json，凭据类键值不落任何留痕——指纹只进 sha256，经环境变量注入、不进命令行（EV-256）；
   * 模型名键的值按模型名记录（EV-257）。
   */
  const settingsEnvSource = c?.settings_env_source ?? null;
  let settingsEnv: Record<string, string> = {};
  let settingsEnvNote: string | null = null;
  if (settingsEnvSource === 'user_settings') {
    try {
      settingsEnv = extractSettingsEnv(readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
      if (Object.keys(settingsEnv).length === 0) {
        settingsEnvNote = 'settings_env_source=user_settings：用户级 settings.json 的 env 段没有可注入键（ANTHROPIC_/CLAUDE_ 前缀）。官方登录机器属正常；第三方网关机器请检查 CC Switch 是否写入';
      }
    } catch (e) {
      settingsEnvNote = `settings_env_source=user_settings：读不到 ~/.claude/settings.json（${(e as NodeJS.ErrnoException).code ?? '未知错误'}），本次不注入网关 env`;
    }
  }
  const settingsEnvSha256 = settingsEnvSource === 'user_settings'
    ? createHash('sha256').update(Object.keys(settingsEnv).sort().map((k) => `${k}=${settingsEnv[k]!}`).join('\n')).digest('hex')
    : null;
  const fingerprint = createHash('sha256').update(JSON.stringify({
    profile, nativeBin, bin, version: version === undefined
      ? (probe?.routes?.[claudeRouteKey(profile)]?.probe.version ?? probe?.version ?? null) : version,
    wrapperSha256, configurationSha256, settingsEnvSha256,
  })).digest('hex');
  return { mode: profile === null ? 'native' : 'profile', profile, nativeBin, bin,
    prefix: profile === null ? [] : ['--profile', profile], fingerprint, wrapperSha256, configurationSha256,
    providerDeclared: profile, modelsDeclared, env: claudeRouteEnv(profile), settingsEnv, settingsEnvNote };
}

/** 新profile只认同指纹路线结论；原生旧结论继续读取，版本新鲜度由预检校验。 */
export function claudeProbeForRoute(cfg: Config, profile: string | null): ClaudeProbe | undefined {
  const root = cfg.probe.cli.claude;
  const entry = root?.routes?.[claudeRouteKey(profile)];
  if (!entry) return root && profile === null && root.route_profile == null &&
    root.entrypoint === resolveClaudeRoute(cfg, profile).nativeBin ? root : undefined;
  return entry.fingerprint === resolveClaudeRoute(cfg, profile, entry.probe.version).fingerprint ? entry.probe : undefined;
}
