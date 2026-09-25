#!/usr/bin/env node
/**
 * M10b 第 3 步变异验证的包装：跑 `scripts/mutation-check.mjs <本目录>/<规格>`，
 * 把装置的 stdout 与 stderr 原样写进对应的输出文件（会话里的命令不带重定向，输出由脚本自己写）。
 * 退出码透传装置的退出码。仓库根按脚本位置推导（EV-103）。
 *
 * 用法：
 *   node doc/05_testing/evidence/m10b-step3-20260925/run.mjs                      # mutation-spec.json → mutation-output.txt
 *   node doc/05_testing/evidence/m10b-step3-20260925/run.mjs mutation-spec-2.json # → mutation-output-2.txt
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const spec = process.argv[2] ?? 'mutation-spec.json';
const suffix = /^mutation-spec(-\d+)?\.json$/.exec(spec)?.[1] ?? '';
const child = spawn(process.execPath, [path.join(ROOT, 'scripts/mutation-check.mjs'), path.join(HERE, spec)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
const code = await new Promise((resolve) => child.on('close', resolve));
await fs.writeFile(path.join(HERE, `mutation-output${suffix}.txt`), out, 'utf8');
process.exit(code ?? 1);
