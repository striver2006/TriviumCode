/** 集成测试用内存 KV（PresetStore 注入面）：无持久化，进程内共享一份 */
import { PresetStore, type KVStore } from '../../src/presets/presetStore';

export function memoryKV(): KVStore & { dump(): Record<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    async get(key) {
      return store.get(key) as never;
    },
    async update(key, value) {
      store.set(key, value);
    },
    dump() {
      return Object.fromEntries(store);
    },
  };
}

export function memoryPresetStore(): PresetStore {
  return new PresetStore(memoryKV(), memoryKV());
}
