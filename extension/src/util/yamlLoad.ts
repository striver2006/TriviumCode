/**
 * YAML 安全加载薄封装。
 *
 * `.trivium/config.local.yaml` 的 probe 段大量使用锚点别名（&a1 / *a1），
 * 解析库必须支持 alias 展开；未知类型一律返回 null，不抛异常（读不到配置
 * 应当表现为「功能降级」，而不是让插件崩掉）。
 */
import { promises as fs } from 'node:fs';
import YAML from 'yaml';

export async function loadYamlFile(path: string): Promise<unknown> {
  try {
    const text = await fs.readFile(path, 'utf8');
    return YAML.parse(text);
  } catch {
    return null;
  }
}

/** 深取值：obj.a?.b?.c 的安全版，任一层缺失返回 undefined */
export function deepGet(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** 深合并（配置覆盖语义）：对象递归合并，数组与标量整体替换 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === null || override === undefined) return base;
  if (base === null || base === undefined) return override;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (typeof base === 'object' && typeof override === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return override;
}
