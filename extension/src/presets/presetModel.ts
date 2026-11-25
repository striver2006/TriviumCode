/**
 * 装配预设模型（FR-11，计划 r2 §D5；纯函数）。
 *
 * 分层（AGY-06）：只存装配参数（任务书 FR-11 原文的「Driver/审查者/入口/轮次/高级项」）；
 * **topic/body 不进 preset**（会话瞬态，加载不得冲刷用户正在起草的输入）；
 * ctxPaths 属高级项但工作区绑定——跨工作区加载时由调用方校验存在性并标注失效。
 * 存储双作用域：globalState（用户级）/ workspaceState（工作区级 memento，不落
 * `.vscode/settings.json`——那会进编排器审查快照，与保存防护自相矛盾，CLAUDE-03）。
 */
import type { DriverChoice } from '../launch/driverModels';

export interface LaunchPreset extends DriverChoice {
  /** 模型版本（将来演进留迁移点） */
  v: 1;
  name: string;
  scope: 'global' | 'workspace';
  createdAt: string;
  updatedAt: string;
  driver: string;
  critics: string[];
  /** 入口 A/B/C/D */
  entry: string;
  maxRounds?: number;
  profile?: string;
  extraFlags: string;
  ctxPaths?: string[];
}

/** 未知字段剔除 + 类型防御；坏条目返回 null（读取容错，不抛错） */
export function sanitizePreset(raw: unknown, scope: LaunchPreset['scope']): LaunchPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['name'] !== 'string' || r['name'].trim() === '') return null;
  if (typeof r['driver'] !== 'string' || r['driver'] === '') return null;
  if (!Array.isArray(r['critics']) || !r['critics'].every((c) => typeof c === 'string')) return null;
  if (typeof r['entry'] !== 'string' || !['A', 'B', 'C', 'D'].includes(r['entry'])) return null;
  const out: LaunchPreset = {
    v: 1,
    name: r['name'].trim(),
    scope,
    createdAt: typeof r['createdAt'] === 'string' ? r['createdAt'] : new Date().toISOString(),
    updatedAt: typeof r['updatedAt'] === 'string' ? r['updatedAt'] : new Date().toISOString(),
    driver: r['driver'],
    critics: r['critics'] as string[],
    entry: r['entry'],
    extraFlags: typeof r['extraFlags'] === 'string' ? r['extraFlags'] : '',
  };
  if (typeof r.driverModel === 'string' && r.driverModel) out.driverModel = r.driverModel;
  if (typeof r.driverEffort === 'string' && r.driverEffort) out.driverEffort = r.driverEffort;
  if (typeof r['maxRounds'] === 'number' && Number.isFinite(r['maxRounds'])) out.maxRounds = r['maxRounds'];
  if (typeof r['profile'] === 'string' && r['profile'] !== '') out.profile = r['profile'];
  if (Array.isArray(r['ctxPaths']) && r['ctxPaths'].every((p) => typeof p === 'string')) out.ctxPaths = r['ctxPaths'] as string[];
  return out;
}

/** 装配参数（cockpit FormState 的子集）→ preset */
export function presetFromAssembly(name: string, scope: LaunchPreset['scope'], a: DriverChoice & {
  driver: string;
  critics: string[];
  entry: string;
  maxRounds?: number;
  profile?: string;
  extraFlags: string;
  ctxPaths?: string[];
  now?: Date;
}): LaunchPreset {
  const now = (a.now ?? new Date()).toISOString();
  return {
    v: 1,
    name: name.trim(),
    scope,
    createdAt: now,
    updatedAt: now,
    driver: a.driver, driverModel: a.driverModel, driverEffort: a.driverEffort,
    critics: [...a.critics],
    entry: a.entry,
    maxRounds: a.maxRounds,
    profile: a.profile,
    extraFlags: a.extraFlags,
    ctxPaths: a.ctxPaths ? [...a.ctxPaths] : undefined,
  };
}

/**
 * preset → 表单回填字段（装配参数集；**不含** topic/body——UI 只把本对象写进对应
 * 表单控件，正文与主题输入框保持用户现状）。
 */
export interface AssemblyFields extends DriverChoice {
  driver: string;
  critics: string[];
  entry: string;
  maxRounds?: number;
  profile?: string;
  extraFlags: string;
  ctxPaths: string[];
}

export function assemblyOf(p: LaunchPreset): AssemblyFields {
  return {
    driver: p.driver, driverModel: p.driverModel, driverEffort: p.driverEffort,
    critics: [...p.critics],
    entry: p.entry,
    maxRounds: p.maxRounds,
    profile: p.profile,
    extraFlags: p.extraFlags,
    ctxPaths: p.ctxPaths ? [...p.ctxPaths] : [],
  };
}

/** 跨工作区加载时校验 ctxPaths 存在性（exists 注入）；失效项标注跳过（r2 AGY-04：路径判定跨平台化） */
export async function filterStaleCtxPaths(
  exists: (p: string) => Promise<boolean>,
  paths: string[],
  workspaceRoot: string,
): Promise<{ keep: string[]; stale: string[] }> {
  const { isAbsolute, join } = await import('node:path');
  const keep: string[] = [];
  const stale: string[] = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : join(workspaceRoot, p);
    if (await exists(abs)) keep.push(p);
    else stale.push(p);
  }
  return { keep, stale };
}
