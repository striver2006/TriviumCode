#!/usr/bin/env node
/**
 * M10b 第 4 步 3-2 轮（claude · code · 兼容回归 J3）的夹具准备。沿用 3-1 轮夹具（plan 已审批），不新建目录。
 *
 * 做一件事：把夹具现状（init 产物 + 3-1 轮归档）逐个路径 `git add` 后提交，
 * 使 code 阶段补丁（`git diff HEAD` 到工作区）只含本轮业务改动。`.gitignore` 里的运行时文件按规则不进提交。
 * 不删除任何东西（R1 / R8）。读数写进本目录 `01-setup-readout.json`。
 *
 *   node setup.mjs <fixture>
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = process.argv[2];
if (!fixture) {
  console.error('用法：node setup.mjs <fixture>');
  process.exit(64);
}
const PATHS = ['.claude', '.gitignore', '.reviews', '.trivium', '.zcode', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
const ID = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid'];

const log = [];
async function git(args) {
  try {
    const r = await run('git', args, { cwd: fixture, maxBuffer: 16 * 1024 * 1024 });
    log.push({ cmd: ['git', ...args].join(' '), code: 0, out: r.stdout.slice(-4000) });
    return r.stdout;
  } catch (e) {
    log.push({ cmd: ['git', ...args].join(' '), code: e.code, out: (e.stdout ?? '').slice(-2000), err: (e.stderr ?? '').slice(-2000) });
    throw e;
  }
}

for (const p of PATHS) await git([...ID, 'add', '--', p]);
await git([...ID, 'commit', '-q', '-m', 'fixture: init 产物与 3-1 轮归档']);
const head = (await git(['rev-parse', 'HEAD'])).trim();
const tracked = (await git(['ls-files'])).split('\n').filter(Boolean);
const status = await git(['status', '--short']);

const readout = { at: new Date().toISOString(), fixture, head, tracked_count: tracked.length, tracked, status_after: status, log };
await fs.writeFile(path.join(HERE, '01-setup-readout.json'), JSON.stringify(readout, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ head, tracked_count: tracked.length, status_after: status }, null, 2));
