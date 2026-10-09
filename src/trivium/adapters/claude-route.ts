/** Claude 路线与指纹的唯一实现。元数据解析不执行 profile，不返回任何凭据。 */
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { accessSync, constants, readFileSync, readdirSync } from 'node:fs';
import type { ClaudeProbe, Config } from '../types.js';

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

export function executableFile(file: string | null): boolean {
  if (!file) return false;
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
}

function wrapperPath(): string | null {
  for (const file of [path.join(os.homedir(), '.local', 'bin', 'cld'),
    ...(process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'cld'))]) {
    if (executableFile(file)) return file;
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
  const fingerprint = createHash('sha256').update(JSON.stringify({
    profile, nativeBin, bin, version: version === undefined
      ? (probe?.routes?.[claudeRouteKey(profile)]?.probe.version ?? probe?.version ?? null) : version,
    wrapperSha256, configurationSha256,
  })).digest('hex');
  return { mode: profile === null ? 'native' : 'profile', profile, nativeBin, bin,
    prefix: profile === null ? [] : ['--profile', profile], fingerprint, wrapperSha256, configurationSha256,
    providerDeclared: profile, modelsDeclared, env: claudeRouteEnv(profile) };
}

/** 新profile只认同指纹路线结论；原生旧结论继续读取，版本新鲜度由预检校验。 */
export function claudeProbeForRoute(cfg: Config, profile: string | null): ClaudeProbe | undefined {
  const root = cfg.probe.cli.claude;
  const entry = root?.routes?.[claudeRouteKey(profile)];
  if (!entry) return root && profile === null && root.route_profile == null &&
    root.entrypoint === resolveClaudeRoute(cfg, profile).nativeBin ? root : undefined;
  return entry.fingerprint === resolveClaudeRoute(cfg, profile, entry.probe.version).fingerprint ? entry.probe : undefined;
}
