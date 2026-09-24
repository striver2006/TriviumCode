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
import { readdir, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
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
  // 默认 charset 是 ascii，会把全部中文转成 \u 转义：产物体积变大、且不可读不可 grep。
  // 本项目的人读输出与提示词全是中文，保留 utf8 很有必要。
  charset: 'utf8',
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

/**
 * 构建标识（EV-82 小主题第一段 r2 §2）：算法只在 `src/trivium/build-stamp.ts` 写一份。
 * 这里先把它单独打包成一个临时 CJS 再调用，运行时收尾重算走的是同一段代码，口径不会漂。
 * 取不到 git（例如 `git archive` 导出的树）时得到 null，照常构建、不报错。
 */
async function computeBuildStamp() {
  const helper = path.join(ROOT, 'dist/.build-stamp.cjs');
  await build({
    platform: 'node', target: 'node18', logLevel: 'silent', charset: 'utf8',
    entryPoints: [path.join(ROOT, 'src/trivium/build-stamp.ts')],
    outfile: helper, bundle: true, format: 'cjs',
  });
  try {
    const mod = createRequire(import.meta.url)(helper);
    return await mod.computeBuildStamp(ROOT);
  } finally {
    await rm(helper, { force: true });
  }
}

async function bundleBinaries() {
  await mkdir(path.join(ROOT, 'skills/dual-critic/scripts'), { recursive: true });
  await mkdir(path.join(ROOT, 'dist'), { recursive: true });

  const stamp = await computeBuildStamp();
  console.log(
    stamp
      ? `构建标识：${stamp.git_head.slice(0, 7)}${stamp.dirty ? '（作用面内有未提交改动）' : ''}，inputs ${stamp.inputs_sha256.slice(0, 12)}`
      : '构建标识：取不到 git，注入 null',
  );

  await build({
    ...COMMON,
    entryPoints: [path.join(ROOT, 'src/trivium/cli.ts')],
    outfile: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'),
    bundle: true,
    format: 'cjs',
    banner: { js: '#!/usr/bin/env node' },
    define: { __TRIVIUM_BUILD__: JSON.stringify(stamp) },
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

  // 逐文件转译（bundle: false）不会内联 JSON 导入，也不会把资源拷过去。
  // 打包产物靠 esbuild 内联即可，但测试构建必须把 schema 按同样的相对路径摆好，
  // 否则 parse.ts 的 `import … from '../../skills/.../review.v1.json'` 会解析失败。
  const schemaSrc = path.join(ROOT, 'skills/dual-critic/schema');
  if (existsSync(schemaSrc)) {
    await cp(schemaSrc, path.join(outdir, 'skills/dual-critic/schema'), { recursive: true });
  }
  const entryPoints = [
    ...(await collectTs(path.join(ROOT, 'src'))),
    ...(await collectTs(path.join(ROOT, 'test'))),
  ];
  if (entryPoints.length === 0) return;
  await build({
    ...COMMON,
    // 测试构建只在本机跑，可以用更高的 target：node18 不支持 import attributes，
    // esbuild 会把 `with { type: 'json' }` 剥掉，导致 Node 的 ESM loader 拒绝加载 JSON。
    // 打包产物仍用 node18（AD-12 的兼容承诺），两者互不影响。
    target: 'node22',
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
