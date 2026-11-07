/**
 * 预设存储（FR-11，计划 r2 §D5；注入 storage，可单测）。
 *
 * 双作用域：workspace（`context.workspaceState`，工作区级 memento——不写
 * `.vscode/settings.json`，避免落入编排器审查快照）与 global（`context.globalState`）。
 * 读取合并展示：同名时 workspace 优先并标注来源；坏条目剔除并计数（不阻断）。
 */
import { sanitizePreset, type LaunchPreset } from './presetModel';

/** VS Code memento 的最小注入面（globalState/workspaceState 同形；update 返回 Thenable） */
export interface KVStore {
  get<T>(key: string): Promise<T | undefined> | T | undefined;
  update(key: string, value: unknown): Promise<void> | Thenable<void>;
}

const KEY = 'trivium.presets';
const SOFT_LIMIT = 50;

export class PresetStore {
  constructor(
    private readonly global: KVStore,
    private readonly workspace: KVStore,
  ) {}

  private async readScope(store: KVStore, scope: LaunchPreset['scope']): Promise<{ presets: LaunchPreset[]; dropped: number }> {
    const raw = await store.get<unknown[]>(KEY);
    if (!Array.isArray(raw)) return { presets: [], dropped: 0 };
    const presets: LaunchPreset[] = [];
    let dropped = 0;
    for (const item of raw) {
      const p = sanitizePreset(item, scope);
      if (p) presets.push(p);
      else dropped += 1;
    }
    return { presets, dropped };
  }

  private async writeScope(store: KVStore, presets: LaunchPreset[]): Promise<void> {
    await store.update(KEY, presets);
  }

  /** 两作用域合并列表（workspace 同名优先，标注 source 已在 scope 字段） */
  async list(): Promise<LaunchPreset[]> {
    const g = await this.readScope(this.global, 'global');
    const w = await this.readScope(this.workspace, 'workspace');
    const map = new Map<string, LaunchPreset>();
    for (const p of g.presets) map.set(p.name, p);
    for (const p of w.presets) map.set(p.name, p); // workspace 覆盖同名 global
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 保存/更新（按 name+scope 去重替换）；超软上限返回 false 并带提示 */
  async save(preset: LaunchPreset): Promise<{ ok: boolean; hint?: string }> {
    const store = preset.scope === 'global' ? this.global : this.workspace;
    const { presets } = await this.readScope(store, preset.scope);
    const idx = presets.findIndex((p) => p.name === preset.name);
    if (idx >= 0) {
      presets[idx] = { ...preset, createdAt: presets[idx]!.createdAt };
    } else {
      if (presets.length >= SOFT_LIMIT) {
        return { ok: false, hint: `该作用域预设已达 ${SOFT_LIMIT} 条软上限：请先删除不用的预设。` };
      }
      presets.push(preset);
    }
    await this.writeScope(store, presets);
    return { ok: true };
  }

  async remove(name: string, scope: LaunchPreset['scope']): Promise<boolean> {
    const store = scope === 'global' ? this.global : this.workspace;
    const { presets } = await this.readScope(store, scope);
    const next = presets.filter((p) => p.name !== name);
    if (next.length === presets.length) return false;
    await this.writeScope(store, next);
    return true;
  }

  async get(name: string, scope: LaunchPreset['scope']): Promise<LaunchPreset | null> {
    const { presets } = await this.readScope(scope === 'global' ? this.global : this.workspace, scope);
    return presets.find((p) => p.name === name) ?? null;
  }
}
