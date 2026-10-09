/** 请求路线快照只解析一次，执行端只能追加实际启动和运行时回读。 */
import { agentById } from './agents/registry.js';
import type { AccessMeta, Config, CriticId, CriticResult } from './types.js';
import type { AdapterTable } from './adapters/base.js';
export function requestedAccess(cfg: Config, critic: CriticId, profile: string | null, adapters: AdapterTable): AccessMeta {
  return adapters[critic]?.accessFor?.(cfg, profile) ?? {
    requested_mode: agentById(critic)?.supportsProfiles ? profile === null ? 'native' : 'profile' : 'standard',
    profile, launcher_requested: cfg.probe.cli[agentById(critic)!.cliName]?.entrypoint ?? null,
    launcher_effective: null, wrapper_sha256: null, configuration_sha256: null,
    provider_declared: null, provider_declared_source: null, provider_effective: null, provider_effective_source: null,
  };
}
export function effectiveAccess(request: AccessMeta, result: CriticResult): AccessMeta {
  return { ...request, ...result.access,
    launcher_effective: result.process_started ?? result.exit_code !== null
      ? (result.access?.launcher_effective ?? request.launcher_requested) : null,
    provider_effective: result.model_provider,
    provider_effective_source: result.model_provider === null ? null : 'trace' };
}
