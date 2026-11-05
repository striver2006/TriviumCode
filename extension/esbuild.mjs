// esbuild 打包脚本：src/extension.ts → dist/extension.js（单文件 CJS）。
// 与主仓同款教训：charset 必须 utf8，默认 ascii 会把中文全部 \u 转义。
import { build } from 'esbuild';

const production = process.argv.includes('--production');

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  charset: 'utf8',
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
});
