/**
 * Qoder CN 模型请求/回读的 fail-closed 纯逻辑。
 *
 * 这个模块不猜模型名，也不把 Auto 当成底层模型。调用方必须先把官方原生
 * 目录或配置解析成 `QoderNativeModelCatalog`，再把同一份解析结果绑定到本轮
 * requested_routes；worker 不得在子进程里重新选择默认值。
 */

export type QoderModelTier = 'default' | 'flash' | 'pro';

export interface QoderNativeModelCatalog {
  source: 'official-directory' | 'official-config';
  sourceFingerprint: string;
  defaults: Readonly<Partial<Record<QoderModelTier, string>>>;
  available: readonly string[];
}

export interface QoderModelRequest {
  tier: QoderModelTier;
  override: string | null;
}

export interface QoderResolvedModel {
  tier: QoderModelTier;
  requested: string;
  declared: string;
  source: QoderNativeModelCatalog['source'];
  sourceFingerprint: string;
}

export interface QoderEffectiveModel {
  /** Qoder 的 Auto 是路由标签，不是可宣称的底层模型。 */
  label: string | null;
  effective: string | null;
  source: 'stream' | 'unknown';
}

export class QoderModelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QoderModelConfigurationError';
  }
}

export class QoderModelFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QoderModelFallbackError';
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new QoderModelConfigurationError(`${label} 缺失或不是非空字符串`);
  }
  return value.trim();
}

/**
 * 校验官方原生目录/配置解析结果。这里故意不从模型名推导 default/flash/pro；
 * 缺任何默认项都必须回报配置缺失，而不是用 auto 或另一档补位。
 */
export function validateQoderNativeModelCatalog(
  catalog: QoderNativeModelCatalog,
): QoderNativeModelCatalog {
  if (catalog.source !== 'official-directory' && catalog.source !== 'official-config') {
    throw new QoderModelConfigurationError('Qoder CN 模型来源不是官方目录或原生配置');
  }
  const sourceFingerprint = nonEmptyString(catalog.sourceFingerprint, '模型来源指纹');
  if (!Array.isArray(catalog.available) || catalog.available.length === 0) {
    throw new QoderModelConfigurationError('Qoder CN 官方模型目录为空，无法确定请求模型');
  }
  if (catalog.defaults === null || typeof catalog.defaults !== 'object' || Array.isArray(catalog.defaults)) {
    throw new QoderModelConfigurationError('Qoder CN 官方默认模型配置缺失或格式无效');
  }
  const available = [...new Set(catalog.available.map((x) => nonEmptyString(x, '模型目录项')))];
  const defaults: Partial<Record<QoderModelTier, string>> = {};
  for (const tier of ['default', 'flash', 'pro'] as const) {
    const value = catalog.defaults[tier];
    if (value !== undefined) {
      const model = nonEmptyString(value, `Qoder CN ${tier} 默认模型`);
      if (model.toLowerCase() === 'auto') {
        throw new QoderModelConfigurationError(`Qoder CN ${tier} 默认模型不能是 Auto 路由标签`);
      }
      if (!available.includes(model)) {
        throw new QoderModelConfigurationError(`Qoder CN ${tier} 默认模型不在官方目录：${model}`);
      }
      defaults[tier] = model;
    }
  }
  return { ...catalog, sourceFingerprint, defaults, available };
}

/** 解析请求模型：显式覆盖优先，但仍必须是官方目录中的实际值。 */
export function resolveQoderModelRequest(
  request: QoderModelRequest,
  rawCatalog: QoderNativeModelCatalog,
): QoderResolvedModel {
  if (!['default', 'flash', 'pro'].includes(request.tier)) {
    throw new QoderModelConfigurationError(`Qoder CN 未知模型档位：${String(request.tier)}`);
  }
  const catalog = validateQoderNativeModelCatalog(rawCatalog);
  const declared = catalog.defaults[request.tier];
  if (declared === undefined) {
    throw new QoderModelConfigurationError(`Qoder CN ${request.tier} 默认模型配置缺失`);
  }
  const requested = nonEmptyString(request.override ?? declared, 'Qoder CN 请求模型');
  if (requested.toLowerCase() === 'auto' || !catalog.available.includes(requested)) {
    throw new QoderModelConfigurationError(`Qoder CN 请求模型不在官方目录：${requested}`);
  }
  return {
    tier: request.tier,
    requested,
    declared,
    source: catalog.source,
    sourceFingerprint: catalog.sourceFingerprint,
  };
}

function parseJsonLines(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        events.push(value as Record<string, unknown>);
      }
    } catch {
      // 非 JSON 的 stderr/stdout 行不构成生效模型回读。
    }
  }
  return events;
}

/** 只取原生事件中的模型标签；缺少底层回读时保持 null。 */
export function readQoderEffectiveModel(streamText: string): QoderEffectiveModel {
  let label: string | null = null;
  for (const event of parseJsonLines(streamText)) {
    for (const value of [event['model'], (event['message'] as Record<string, unknown> | undefined)?.['model']]) {
      if (typeof value === 'string' && value.trim()) label = value.trim();
    }
  }
  if (label === null || label.toLowerCase() === 'auto') {
    return { label, effective: null, source: label === null ? 'unknown' : 'stream' };
  }
  return { label, effective: label, source: 'stream' };
}

/**
 * 运行期间发现回退即失败。stderr 的明确回退告警优先；Auto 标签也只能作为
 * 回退/未知信号，不能作为请求模型的成功回读。
 */
export function assertQoderModelDidNotFallback(
  resolved: QoderResolvedModel,
  stdout: string,
  stderr: string,
): QoderEffectiveModel {
  const effective = readQoderEffectiveModel(stdout);
  const fallbackLine = stderr.split(/\r?\n/).find((line) =>
    /\bmodel\b/i.test(line) && /using\s+["']?[^\s"']+["']?\s+instead\b|\bfallback\b/i.test(line),
  );
  if (fallbackLine) {
    throw new QoderModelFallbackError(`Qoder CN 运行期间回退模型：请求 ${resolved.requested}；证据：${fallbackLine.trim()}`);
  }
  if (effective.label?.toLowerCase() === 'auto') {
    throw new QoderModelFallbackError(`Qoder CN 生效标签为 Auto，不能证明请求模型 ${resolved.requested} 生效`);
  }
  if (effective.effective === null) {
    throw new QoderModelFallbackError(`Qoder CN 未回读生效模型：请求 ${resolved.requested}`);
  }
  if (effective.effective !== resolved.requested) {
    throw new QoderModelFallbackError(
      `Qoder CN 生效模型与请求不符：请求 ${resolved.requested}，回读 ${effective.effective}`,
    );
  }
  return effective;
}
