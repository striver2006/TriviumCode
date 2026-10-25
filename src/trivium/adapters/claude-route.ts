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
   * （2026-10-24 win32 实测）。值只在内存，指纹只记 sha256；输出侧仍由 `scrubGatewayEnv` 逐值脱敏。
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

export function claudeProfilesDir(): string {
  return path.join(os.homedir(), '.claude', 'profiles');
}

export function claudeProfileNames(dir = claudeProfilesDir()): string[] {
  try { return readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.env'))
    .map(e => e.name.slice(0, -4)).sort(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}

/** 只接受独立静态 export 字符串。插值/命令替换/多行内容不作为元数据。 */
export function claudeProfileMetadata(text: string): { models: string[] } {
  const models: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*export\s+(ANTHROPIC_(?:MODEL|DEFAULT_[A-Z_]+_MODEL|SMALL_FAST_MODEL))=(?:"([\w.\/:+-]+)"|'([\w.\/:+-]+)'|([\w.\/:+-]+))\s*(?:#.*)?$/.exec(line);
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
   * 读取用户级 settings.json，键值不落任何留痕——指纹只进 sha256，经环境变量注入、不进命令行（EV-256）。
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
