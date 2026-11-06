/**
 * 版本对齐（N4，r2 计划 D10′）。
 *
 * 按插件实际消费的**文件类型**声明支持的 schema 串；逐文件判「未知主版本」即降级
 * 只读。CLI `--version` 的数值版本与 schema 串不是同一命名空间（CLAUDE-09），
 * 数值只作诊断展示，不参与判定。
 */
export type SchemaVerdict =
  | { kind: 'ok' }
  | { kind: 'incompatible'; reason: string }
  | { kind: 'unknown'; reason: string };

/**
 * 插件消费的文件类型 → 支持的 schema 串（唯一事实源：本表）。
 *
 * `review`（Phase 2）与前三类不同：审查工件逐文件降级（旧版/坏件只影响该文件，
 * 不进 worstVerdict 的全局禁点火判定）——消费点在 reviewParse，语义见 r2 计划 D1′。
 */
export const SUPPORTED_SCHEMAS = {
  config: 'trivium.config.v2',
  state: 'trivium.state.v1',
  status: 'trivium.status.v1',
  review: 'trivium.review.v2',
} as const;

export type SchemaFileKind = keyof typeof SUPPORTED_SCHEMAS;

/**
 * 解析 `trivium.<name>.v<N>` 形态；主版本（N）超出支持即不兼容。
 * 解析不了的串按 unknown 处理（保守降级，不误放行）。
 */
export function checkSchema(actual: string | null | undefined, kind: SchemaFileKind): SchemaVerdict {
  const supported = SUPPORTED_SCHEMAS[kind];
  if (!actual) {
    return { kind: 'unknown', reason: `${kind}: 文件缺 schema 标识` };
  }
  const m = /^trivium\.([A-Za-z0-9_]+)\.v(\d+)$/.exec(actual);
  const s = /^trivium\.([A-Za-z0-9_]+)\.v(\d+)$/.exec(supported);
  if (!m || !s) {
    return { kind: 'unknown', reason: `${kind}: schema 串 "${actual}" 无法解析` };
  }
  if (m[1] !== s[1]) {
    return { kind: 'unknown', reason: `${kind}: 未知数据名 "${m[1]}"` };
  }
  if (Number(m[2]) !== Number(s[2])) {
    return { kind: 'incompatible', reason: `${kind}: 支持 ${supported}，实际 ${actual}` };
  }
  return { kind: 'ok' };
}

/** 汇总判定：任一不兼容 → 降级只读（禁点火，监控照常） */
export function worstVerdict(verdicts: SchemaVerdict[]): SchemaVerdict {
  const inc = verdicts.find((v) => v.kind === 'incompatible');
  if (inc) return inc;
  const unk = verdicts.find((v) => v.kind === 'unknown');
  if (unk) return unk;
  return { kind: 'ok' };
}
