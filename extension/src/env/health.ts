/**
 * 环境健康模型（FR-1）。
 *
 * 数据源：`.trivium/config.local.yaml` 的 probe 段（doctor 回填）。面板默认只读
 * probe 结论；「重新探测」按钮才调 `doctor --json --no-model-calls`（静态、零配额）。
 * 不展示指纹等敏感字段（D9′）。
 */
import type { ProbeSection } from './config';
import { CARRIERS, type AgentId } from '../launch/carriers';

export type AgentAvailability = 'available' | 'auth-missing' | 'not-probed' | 'unavailable';

export interface AgentHealth {
  agentId: AgentId;
  display: string;
  availability: AgentAvailability;
  version: string | null;
  entrypoint: string | null;
  /** 探针结论时间（probed_at） */
  probedAt: string | null;
  /** auth 探活时间（checked_at） */
  authCheckedAt: string | null;
  /** 探针段里的模型清单（可能为空数组） */
  models: string[];
}

export function buildHealth(probe: ProbeSection | null): AgentHealth[] {
  return (Object.keys(CARRIERS) as AgentId[]).map((agentId) => {
    const carrier = CARRIERS[agentId];
    const cli = probe?.cli[carrier.cliKey];
    const auth = probe?.auth[agentId];
    const entrypoint = (cli?.['entrypoint'] as string | undefined) ?? null;
    const version = (cli?.['version'] as string | undefined) ?? null;
    const probedAt = (cli?.['probed_at'] as string | undefined) ?? null;
    const modelsRaw = cli?.['models'];
    const authOk = auth?.['ok'];
    const authCheckedAt = (auth?.['checked_at'] as string | undefined) ?? null;

    let availability: AgentAvailability;
    if (!cli || !entrypoint) {
      availability = 'not-probed';
    } else if (authOk === false) {
      availability = 'auth-missing';
    } else {
      availability = 'available';
    }
    return {
      agentId,
      display: carrier.display,
      availability,
      version,
      entrypoint,
      probedAt,
      authCheckedAt,
      models: Array.isArray(modelsRaw) ? (modelsRaw as string[]) : [],
    };
  });
}

export const AVAILABILITY_LABEL: Record<AgentAvailability, string> = {
  available: '可用',
  'auth-missing': '未认证',
  'not-probed': '未探测（先跑 doctor）',
  unavailable: '不可用',
};
