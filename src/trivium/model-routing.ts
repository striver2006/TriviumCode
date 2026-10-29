/** 统一配置路由与冻结请求比对；历史可选字段仍按原值参与一致性校验。 */
import type { Config, CriticId, CriticRequest, RunMeta, Stage } from './types.js';
import { resolveTier, type TierOverrides } from './adapters/base.js';
import { isDeepStrictEqual } from 'node:util';

export function resolveConfiguredTier(cfg: Config, id: CriticId, stage: Stage, cli: TierOverrides = {}) {
  return resolveTier(cfg, id, stage, cli);
}

export function requestRouteSnapshot(req: CriticRequest) {
  return { model: req.model, effort: req.effort ?? null, tier: req.tier,
    tier_source: req.tier_source, access: req.access!,
    ...(req.admission ? { admission: req.admission } : {}),
    ...(req.native_model ? { native_model: req.native_model } : {}) };
}

export function sameRequestedRoute(req: CriticRequest | undefined, frozen: NonNullable<RunMeta['requested_routes']>[CriticId]): boolean {
  return !!req && !!frozen && isDeepStrictEqual(requestRouteSnapshot(req), frozen) && req.profile_requested === frozen.access.profile;
}
