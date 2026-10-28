/** 统一同步路由：原生默认事实由厂商提供，通用层不识别厂商身份。 */
import type { Config, CriticId, CriticRequest, RunMeta, Stage } from './types.js';
import { resolveTier, type TierOverrides } from './adapters/base.js';
import { wiredAdapter } from './adapters/index.js';
import { isDeepStrictEqual } from 'node:util';

export function resolveConfiguredTier(cfg: Config, id: CriticId, stage: Stage, cli: TierOverrides = {}) {
  return resolveTier(cfg, id, stage, cli, wiredAdapter(id)?.defaultModelFor?.(cfg));
}

export function requestRouteSnapshot(req: CriticRequest) {
  return { model: req.model, effort: req.effort ?? null, tier: req.tier,
    tier_source: req.tier_source, access: req.access!,
    ...(req.native_model ? { native_model: req.native_model } : {}) };
}

export function sameRequestedRoute(req: CriticRequest | undefined, frozen: NonNullable<RunMeta['requested_routes']>[CriticId]): boolean {
  return !!req && !!frozen && isDeepStrictEqual(requestRouteSnapshot(req), frozen) && req.profile_requested === frozen.access.profile;
}
