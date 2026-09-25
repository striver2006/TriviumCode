#!/usr/bin/env node
/**
 * EV-125 变异验证的包装：跑 `scripts/mutation-check.mjs <本目录>/mutation-spec.json`，
 * 把装置的 stdout 与 stderr 原样写进 `mutation-output.txt`（会话里的命令不带重定向，输出由脚本自己写）。
 * 退出码透传装置的退出码。仓库根按脚本位置推导（EV-103）。
 *
 * 用法：node doc/05_testing/evidence/ev125-mutation-20260925/run.mjs
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const child = spawn(process.execPath, [path.join(ROOT, 'scripts/mutation-check.mjs'), path.join(HERE, 'mutation-spec.json')], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
const code = await new Promise((resolve) => child.on('close', resolve));
await fs.writeFile(path.join(HERE, 'mutation-output.txt'), out, 'utf8');
process.exit(code ?? 1);
