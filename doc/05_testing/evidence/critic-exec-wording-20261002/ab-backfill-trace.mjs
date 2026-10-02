#!/usr/bin/env node
/**
 * 补收 codex 轨迹命令原文：ab-run.mjs 初版按 request.json 认运行目录，而同步运行没有该文件，base-old / new-r1 两轮没收到。
 * 按夹具目录名（meta.json 的 fixture）认运行目录，取与 ab-run.mjs 现版相同的字段（命令文本、退出码、状态、输出前 400 字），
 * 不碰 codexhome。用法（在仓库根）：node doc/05_testing/evidence/critic-exec-wording-20261002/ab-backfill-trace.mjs <标签>
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LABEL = process.argv[2];
const DIR = path.join(process.cwd(), 'doc/05_testing/evidence/critic-exec-wording-20261002/ab', LABEL);
const meta = JSON.parse(await fs.readFile(path.join(DIR, 'meta.json'), 'utf8'));
const runsRoot = path.join(os.homedir(), '.' + 'trivium', 'runs');
const repo = (await fs.readdir(runsRoot)).find((r) => r.startsWith(`${path.basename(meta.fixture)}-`));
if (!repo) throw new Error('找不到运行目录');
const tr = JSON.parse(await fs.readFile(path.join(runsRoot, repo, meta.run_id, 'codex', 'out', 'trace.json'), 'utf8'));
const cmds = (tr.commands ?? []).map((x) => ({
  command: x.command ?? null,
  exit_code: x.exitCode ?? null,
  status: x.status ?? null,
  output_head: typeof x.output === 'string' ? x.output.slice(0, 400) : null,
}));
await fs.writeFile(path.join(DIR, 'codex-commands.json'), JSON.stringify(cmds, null, 2) + '\n');
meta.run_dir = path.join(runsRoot, repo, meta.run_id);
meta.codex_command_count = cmds.length;
meta.codex_commands_backfilled = true;
await fs.writeFile(path.join(DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`${LABEL}：${cmds.length} 条命令`);
