/**
 * 档位命令行旗标：`--tier-〈id〉` / `--effort-〈id〉` / `--profile-〈id〉`（M11 第 5 步，设计 7.1「档位旗标」、11.5）。
 *
 * **收集、键校验、取值校验、合并只此一份**——`cli.ts`（review / preflight）与 `topic-args.ts`（topic resolve）
 * 共用。同一判定有两个入口时判定必须只有一份（EV-53）：上一次只收口一个入口，另一个原样丢参数。
 *
 * ## 三类旗标与 `--model-〈id〉` 的关系
 *
 * - **收集面 = 全部已登记 Agent**：写给本轮当不了审核者的一家，要落到明确报错上，而不是被 `topic resolve`
 *   当正文吞进焦点（与 `collectModelOverrides` 同理）。
 * - **键判定与 `--model-〈id〉` 同一份**：`critics.ts` 的 `assertCriticFlagKeys`。
 * - **`--profile-〈id〉` 多一格**：只有适配器实现了 `vendorProfilesFor` 钩子的那一家成立——今天派生结果恰为
 *   `--profile-codex`（规格写的名字），源码不写任何 Agent id（用户 2026-10-08 定）。它与 trivium 自己的
 *   `--profile 〈档位表名〉` 是两个命名空间。
 *
 * ## 取值的去向
 *
 * M11 第 6 步起三类旗标的值随请求下传给各家适配器（思考等级与厂商 profile 第 5 步时被预检的过渡闸拦着，
 * 第 6 步透传接线后拆除）。本模块只做形状层的判定；原生枚举、无此概念与本机名单是 `checkTierCombos` 的永久判据。
 */
import type { Config, CriticId, TierName } from './types.js';
import { ALL_AGENT_IDS, agentById, type AgentId } from './agents/registry.js';
import { TIER_NAMES, type TierOverrides } from './adapters/base.js';
import { assertCriticFlagKeys, type CriticFlagPrefix } from './critics.js';
import { usageError } from './exit-codes.js';

/** 一侧的命令行精确值（不含 model——那一类仍走 `--model-〈id〉` 的既有通道） */
export interface TierFlagValues {
  tier?: TierName;
  effort?: string;
  vendorProfile?: string | null;
}

type Kind = Exclude<CriticFlagPrefix, 'model' | 'native'>;
const KINDS: readonly Kind[] = ['tier', 'effort', 'profile'];

/** 三类旗标的全部名字（逐已登记 Agent）。`topic resolve` 的白名单与 help 都从这里取 */
export function tierFlagNames(): string[] {
  return [...KINDS.flatMap((k) => ALL_AGENT_IDS.map((id) => `${k}-${id}`)), ...nativeFlagNames()];
}

export function nativeFlagNames(): string[] {
  return ALL_AGENT_IDS.map((id) => `native-${id}`);
}

/** 适配器实现了 `vendorProfilesFor` 的 Agent——`--profile-〈id〉` 只对它们成立 */
export function vendorProfileAgents(): AgentId[] {
  return ALL_AGENT_IDS.filter((id) => agentById(id)?.supportsProfiles === true);
}

/** 收集结果：键是 Agent id，值是原文（**空串表示写了没给值**，与「没写」区分） */
export type RawTierFlags = Record<Kind, Record<string, string>> & { native?: Record<string, string> };

/**
 * 收集三类旗标。`get` 返回 `undefined` 表示没写；返回空串表示写了但没给值（计划三审 AGY-02：
 * `topic resolve` 对缺值记空串，按真假过滤会把它静默丢掉）。
 */
export function collectTierFlags(get: (name: string) => string | undefined): RawTierFlags {
  const out: RawTierFlags = { tier: {}, effort: {}, profile: {} };
  for (const k of KINDS) {
    for (const id of ALL_AGENT_IDS) {
      const v = get(`${k}-${id}`);
      if (v !== undefined) out[k][id] = v;
    }
  }
  out.native = {};
  for (const id of ALL_AGENT_IDS) {
    const v = get(`native-${id}`);
    if (v !== undefined) out.native[id] = v;
  }
  return out;
}

/**
 * 逐审核者取值旗标「写了没给值」的判定，**`--model-〈id〉` 与三类档位旗标共用这一份**（M12 批次 4，EV-228）：
 * 文案同源靠结构保证，不靠两处字面碰巧相同。`raw` 的键是 Agent id、值为空串表示写了没给值；
 * 按插入序（收集方按注册表序收）报第一个。调用方先做键判定再调它（先键后值）。
 */
export function assertFlagValuesGiven(prefix: Exclude<CriticFlagPrefix, 'native'>, raw: Readonly<Record<string, string>>): void {
  for (const [id, v] of Object.entries(raw)) {
    if (v === '') throw usageError(`--${prefix}-${id} 需要一个值，但没有给出。`);
  }
}

/**
 * 键校验 + 取值的形状校验，通过即返回逐入选侧的精确值。全部退 64、在任何落盘之前。
 *
 * 次序：①键（与 `--model-〈id〉` 同一判定）；②`--profile-〈id〉` 的该侧有没有厂商 profile 概念；
 * ③空值；④`--tier-〈id〉` 只收三档名。原生枚举、无此概念与本机名单不在这里——那是 `checkTierCombos` 的事，
 * 与配置来源同一处、同一文案。
 */
export function assertTierFlags(
  cfg: Config,
  driver: AgentId,
  raw: RawTierFlags,
  picked: readonly string[],
): Partial<Record<CriticId, TierFlagValues>> {
  for (const k of KINDS) assertCriticFlagKeys(cfg, driver, Object.keys(raw[k]), picked, k);
  assertCriticFlagKeys(cfg, driver, Object.keys(raw.native ?? {}), picked, 'native');

  const withProfile = new Set<string>(vendorProfileAgents());
  for (const id of new Set([...Object.keys(raw.profile), ...Object.keys(raw.native ?? {})])) {
    if (!withProfile.has(id)) {
      throw usageError(
        `--${raw.profile[id] !== undefined ? 'profile' : 'native'}-${id}：${id} 没有厂商 profile 概念，这个旗标对它不成立。\n` +
          `  --profile-〈id〉 是厂商 CLI 自己的配置分层名，不是 trivium 的 --profile 〈档位表名〉。\n` +
          `  可用：${[...withProfile].flatMap((a) => [`--profile-${a}`, `--native-${a}`]).join(' | ') || '（本机没有任何一家有厂商 profile 概念）'}`,
      );
    }
  }
  for (const id of Object.keys(raw.native ?? {})) {
    if (raw.profile[id] !== undefined) throw usageError(`--native-${id} 与 --profile-${id} 不能同时指定。`);
  }

  for (const k of KINDS) assertFlagValuesGiven(k, raw[k]);

  for (const [id, v] of Object.entries(raw.tier)) {
    if (!(TIER_NAMES as readonly string[]).includes(v)) {
      throw usageError(`--tier-${id} 只接受 ${TIER_NAMES.join(' | ')}，收到：${v}`);
    }
  }

  const out: Partial<Record<CriticId, TierFlagValues>> = {};
  const slot = (id: string): TierFlagValues => (out[id as CriticId] ??= {});
  for (const [id, v] of Object.entries(raw.tier)) slot(id).tier = v as TierName;
  for (const [id, v] of Object.entries(raw.effort)) slot(id).effort = v;
  for (const [id, v] of Object.entries(raw.profile)) slot(id).vendorProfile = v;
  for (const id of Object.keys(raw.native ?? {})) slot(id).vendorProfile = null;
  return out;
}

/**
 * 模型覆盖与三类旗标逐侧合并成 `resolveTier` 的命令行一级。**合并只此一份**（计划三审 CODEX-02）：
 * `checkModelSlugs` / `checkTierCombos` 内部调它，`review.ts` 的路由点用准备阶段算好的同一份结果。
 */
export function mergeCliOverrides(
  models: Partial<Record<CriticId, string>>,
  flags: Partial<Record<CriticId, TierFlagValues>> = {},
): Partial<Record<CriticId, TierOverrides>> {
  const out: Partial<Record<CriticId, TierOverrides>> = {};
  for (const id of new Set([...Object.keys(models), ...Object.keys(flags)]) as Set<CriticId>) {
    const m = models[id];
    out[id] = { ...(m ? { model: m } : {}), ...(flags[id] ?? {}) };
  }
  return out;
}
