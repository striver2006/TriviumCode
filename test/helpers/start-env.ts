/**
 * 「写者与读者的环境不同」的构造（EV-158，worker启动时刻规范化计划 r2 §5.1）。
 *
 * 照 `cli-group-record.test.ts` U16 的办法：进程内改 `process.env`——`run()` 在派生时拷贝 `process.env`，所以之后派生的
 * `ps` 就在这个环境里跑。W / R 都不是 UTC、也不是 C：避开「写者恰在 UTC + C 时缺省形态与规范化形态逐字相同」的巧合（计划 §2）。
 *
 * P0（计划双审 r1 CODEX-02）：某台机器没装 fr_FR / de_DE 区域时 libc 会回退，两个名义不同的环境可能同形，
 * 那时「R 下判同一进程」的断言会静默变真。所以每格造记录前先断言两个环境的缺省形态确实不同、且都不等于规范化形态。
 */
import assert from 'node:assert/strict';
import { processStartTime } from '../../src/trivium/util/exec.js';

export type EnvPatch = Record<string, string | undefined>;

/** 写者的环境 */
export const ENV_W: EnvPatch = { TZ: 'Asia/Tokyo', LC_ALL: 'fr_FR.UTF-8', LANG: undefined, LC_TIME: undefined };
/** 读者的环境 */
export const ENV_R: EnvPatch = { TZ: 'America/New_York', LANG: 'de_DE.UTF-8', LC_ALL: undefined, LC_TIME: undefined };

const KEYS = ['TZ', 'LANG', 'LC_ALL', 'LC_TIME'] as const;

/** 在 `env` 下跑 fn，结束后把四个键原样还原（含「原本没有」） */
export async function withEnv<T>(env: EnvPatch, fn: () => Promise<T>): Promise<T> {
  const saved: EnvPatch = {};
  for (const k of KEYS) saved[k] = process.env[k];
  const apply = (e: EnvPatch) => {
    for (const k of KEYS) {
      if (!(k in e)) continue;
      const v = e[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  apply(env);
  try {
    return await fn();
  } finally {
    apply(saved);
  }
}

/** 同一进程在 W、R 下的缺省形态与规范化形态 */
export async function formsOf(pid: number): Promise<{ w: string | null; r: string | null; canonical: string | null }> {
  const w = await withEnv(ENV_W, () => processStartTime(pid));
  const r = await withEnv(ENV_R, () => processStartTime(pid));
  const canonical = await processStartTime(pid, { canonical: true });
  return { w, r, canonical };
}

/** P0：W 与 R 的缺省形态确实不同，且都不等于规范化形态；不满足即本格失败，文案带上三个形态 */
export async function assertEnvPairDistinct(pid: number): Promise<{ w: string; r: string; canonical: string }> {
  const f = await formsOf(pid);
  const msg = `环境对没有错开，用例前提不成立：W=${JSON.stringify(f.w)} R=${JSON.stringify(f.r)} 规范化=${JSON.stringify(f.canonical)}`;
  assert.ok(f.w && f.r && f.canonical, msg);
  assert.notEqual(f.w, f.r, msg);
  assert.notEqual(f.w, f.canonical, msg);
  assert.notEqual(f.r, f.canonical, msg);
  return { w: f.w!, r: f.r!, canonical: f.canonical! };
}
