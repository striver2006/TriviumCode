/**
 * 递归删除清零守卫的共用件（EV-199 起于 `probe-fixture-cleanup.test.ts`，EV-204 挪来供全树守卫共用）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';

/** 目录下全部 `.ts`，**递归**（EV-199 代码双审 r1 GLM-01：将来有子目录也要扫到）；`name` 以目录名开头 */
export async function tsFiles(dir: string): Promise<{ name: string; src: string }[]> {
  const out: { name: string; src: string }[] = [];
  const rels = (await fs.readdir(dir, { recursive: true })).filter((n) => n.endsWith('.ts')).sort();
  for (const rel of rels) {
    out.push({ name: path.join(path.basename(dir), rel), src: await fs.readFile(path.join(dir, rel), 'utf8') });
  }
  return out;
}

/**
 * 数源码里的递归删除调用：实参按括号深度配平截取（EV-199 计划双审 r1 GLM-01）——
 * 单层正则会在 `path.join(…)` 的闭括号处截断，把 `fs.rm(path.join(a, b), { recursive: true })` 漏数成 0。
 *
 * 匹配面认形态不认名字（EV-199 代码双审 r1 GLM-01 ≡ CODEX-04）：`rm` / `rmdir` 及其 `Sync` 形态，接收者任意
 * （`fs.` / `fsp.` 别名 / `fs.promises.`）或解构导入的裸调用；递归判据认 `recursive: true` 与速记 `{ recursive }`。
 */
export function countRecursiveRm(src: string): number {
  let n = 0;
  for (const m of src.matchAll(/\brm(?:dir)?(?:Sync)?\(/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    if (/\brecursive\b\s*(?::\s*true\b|[,}])/.test(src.slice(start, i))) n++;
  }
  return n;
}
