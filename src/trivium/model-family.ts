/** 保守模型族比较；请求值、缺失值与未解析别名均不能冒充回读。 */
import { MODEL_FAMILY_RULES } from './agents/registry.js';
import type { AgentId, CriticId, CriticResult, DriverDeclaration, FamilyComparison } from './types.js';

export function modelFamily(model: string | null): string | null {
  if (!model) return null;
  const id = model.split('/').at(-1)!;
  return MODEL_FAMILY_RULES.find(rule => rule.pattern.test(id))?.family ?? null;
}
export function compareModels(left: AgentId, right: AgentId,
  a: { model: string | null; source: FamilyComparison['left_source'] },
  b: { model: string | null; source: FamilyComparison['right_source'] }): FamilyComparison {
  const af = a.source === null ? null : modelFamily(a.model);
  const bf = b.source === null ? null : modelFamily(b.model);
  const status = af === null || bf === null ? 'unknown' : af === bf ? 'same-family' : 'different-family';
  const reason = a.model === null ? '左侧模型信息缺失' : b.model === null ? '右侧模型未回读' :
    af === null || bf === null ? '模型标识或来源无法确认' : af === bf ? `双方模型属于 ${af} 族` : `模型族不同：${af} / ${bf}`;
  return { left, right, status, left_model: a.model, right_model: b.model,
    left_source: a.source, right_source: b.source, reason };
}
export function compareRunModels(driver: AgentId, declaration: DriverDeclaration | undefined,
  sides: readonly CriticId[], results: Partial<Record<CriticId, CriticResult>>): FamilyComparison[] {
  const points = [{ id: driver, model: declaration?.model ?? null, source: declaration?.model ? 'declared' as const : null },
    ...sides.map(id => {
      const r = results[id];
      const source = r?.model_effective_source === 'envelope' || r?.model_effective_source === 'trace' ? r.model_effective_source : null;
      return { id, model: source ? r?.model_effective ?? null : null, source };
    })];
  const pairs: FamilyComparison[] = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const a = points[i]!, b = points[j]!;
    pairs.push(compareModels(a.id, b.id, a, b));
  }
  return pairs;
}

export function familyWarnings(pairs: readonly FamilyComparison[]): string[] {
  const groups = new Map<string, string[]>();
  for (const pair of pairs) if (pair.status !== 'different-family') {
    const key = `${pair.status}：${pair.reason}`;
    groups.set(key, [...(groups.get(key) ?? []), `${pair.left}/${pair.right}`]);
  }
  return [...groups].map(([why, ids]) => `模型族 ${why}（${ids.join('、')}）；告警继续`);
}
