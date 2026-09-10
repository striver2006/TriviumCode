#!/usr/bin/env node
/**
 * TriviumCode 构建脚本（设计 §5.2 / AD-12）
 *
 * 产物：
 *   src/trivium/cli.ts → skills/dual-critic/scripts/trivium.cjs   （单文件零依赖，随核心 skill 分发）
 *   src/install.ts     → dist/install.cjs                         （安装器）
 *
 * 两者都以 CJS + bundle 形式出，把 yaml / ajv 内联进单文件，运行期零 node_modules。
 * --target=node18 而非本机 Node 版本，保证 AD-12 承诺的 Node ≥ 18 兼容性。
 *
 * 测试构建（--tests-only 或 --with-tests）：把 src/ 与 test/ 逐文件转译（不 bundle）到
 * dist/test/，再由 `node --test dist/test/` 运行。不用 Node 原生 type-stripping，
 * 因为那需要 Node ≥ 22，会把 Node 18 用户挡在门外。
 */
import { build } from 'esbuild';
import { readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const testsOnly = argv.includes('--tests-only');
const withTests = testsOnly || argv.includes('--with-tests');

const COMMON = {
  platform: 'node',
  target: 'node18',
  logLevel: 'info',
};

/** 递归收集某目录下的 .ts 文件 */
async function collectTs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectTs(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

async function bundleBinaries() {
  await mkdir(path.join(ROOT, 'skills/dual-critic/scripts'), { recursive: true });
  await mkdir(path.join(ROOT, 'dist'), { recursive: true });

  await build({
    ...COMMON,
    entryPoints: [path.join(ROOT, 'src/trivium/cli.ts')],
    outfile: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'),
    bundle: true,
    format: 'cjs',
    banner: { js: '#!/usr/bin/env node' },
  });

  await build({
    ...COMMON,
    entryPoints: [path.join(ROOT, 'src/install.ts')],
    outfile: path.join(ROOT, 'dist/install.cjs'),
    bundle: true,
    format: 'cjs',
    banner: { js: '#!/usr/bin/env node' },
  });
}

async function buildTests() {
  const outdir = path.join(ROOT, 'dist/test');
  await rm(outdir, { recursive: true, force: true });
  const entryPoints = [
    ...(await collectTs(path.join(ROOT, 'src'))),
    ...(await collectTs(path.join(ROOT, 'test'))),
  ];
  if (entryPoints.length === 0) return;
  await build({
    ...COMMON,
    entryPoints,
    outdir,
    outbase: ROOT,
    bundle: false,
    // ESM，与 package.json 的 "type": "module" 一致；源码里的 `.js` 相对导入直接可用。
    // 注意与两个 bundle 产物（.cjs）不同：那两个是给外部调用的单文件，这里是给 node --test 跑的。
    format: 'esm',
    sourcemap: 'inline',
  });
}

if (!testsOnly) await bundleBinaries();
if (withTests) await buildTests();
