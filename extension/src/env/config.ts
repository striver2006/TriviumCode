/**
 * `.trivium/` 配置只读解析（FR-1 / FR-2 / FR-4 的数据源）。
 *
 * 插件**绝不写** `.trivium/*.yaml`（G6）；本模块只读 config.yaml + config.local.yaml
 * 并做覆盖合并（local 的 probe 段是 doctor 回填的探针结论，含 YAML 锚点别名）。
 */
import path from 'node:path';
import { homedir } from 'node:os';
import { promises as fs } from 'node:fs';
import { deepGet, deepMerge, loadYamlFile } from '../util/yamlLoad';

export interface TriviumConfig {
  /** 合并后的原始配置对象（typed 视图由 getter 提供） */
  raw: Record<string, unknown>;
  schema: string | null;
  /** 运行根（已展开 ~）；读不到配置时为 null */
  runRoot: string | null;
  /** 缺省审核者集合（config review.default_critics） */
  defaultCritics: string[];
  /** 心跳失联阈值（秒）；读不到取编排器缺省 120 */
  heartbeatStaleS: number;
  /** 档位表名（profiles 的键） */
  profileNames: string[];
}

export interface ProbeSection {
  generatedAt: string | null;
  /** probe.cli.<cliKey> —— 键为 CLI 名（claude/codex/agy/zcode），不是 Agent id */
  cli: Record<string, Record<string, unknown>>;
  /** probe.auth.<agentId> */
  auth: Record<string, Record<string, unknown>>;
}

export function expandHome(p: string, home = process.env['HOME'] || homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

export class TriviumEnv {
  readonly configPath: string;
  readonly localConfigPath: string;

  constructor(public readonly workspaceRoot: string) {
    this.configPath = path.join(workspaceRoot, '.trivium', 'config.yaml');
    this.localConfigPath = path.join(workspaceRoot, '.trivium', 'config.local.yaml');
  }

  /** 是否已 init（有 config.yaml 即认为已 init；wrapper 的存在由调用方另行检查） */
  async inited(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  async loadConfig(): Promise<TriviumConfig> {
    const base = await loadYamlFile(this.configPath);
    const local = await loadYamlFile(this.localConfigPath);
    const merged = deepMerge(base, local) as Record<string, unknown> | null;
    const raw = merged ?? {};
    const runRootRaw = deepGet(raw, ['runtime', 'run_root']);
    const defaultCritics = deepGet(raw, ['review', 'default_critics']);
    const heartbeat = deepGet(raw, ['review', 'heartbeat_stale_s']);
    const profiles = deepGet(raw, ['profiles']);
    return {
      raw,
      schema: (deepGet(raw, ['schema']) as string | undefined) ?? null,
      runRoot:
        typeof runRootRaw === 'string' && runRootRaw.length > 0
          ? expandHome(runRootRaw)
          : path.join(process.env['HOME'] || homedir(), '.trivium', 'runs'),
      defaultCritics: Array.isArray(defaultCritics) ? (defaultCritics as string[]) : [],
      heartbeatStaleS: typeof heartbeat === 'number' ? heartbeat : 120,
      profileNames: profiles && typeof profiles === 'object' ? Object.keys(profiles as Record<string, unknown>) : [],
    };
  }

  /** probe 段（只在 config.local.yaml 里，由 doctor 回填） */
  async loadProbe(): Promise<ProbeSection | null> {
    const local = (await loadYamlFile(this.localConfigPath)) as Record<string, unknown> | null;
    if (!local) return null;
    const probe = local['probe'];
    if (!probe || typeof probe !== 'object') return null;
    const p = probe as Record<string, unknown>;
    return {
      generatedAt: (p['generated_at'] as string | undefined) ?? null,
      cli: (p['cli'] as Record<string, Record<string, unknown>>) ?? {},
      auth: (p['auth'] as Record<string, Record<string, unknown>>) ?? {},
    };
  }
}
