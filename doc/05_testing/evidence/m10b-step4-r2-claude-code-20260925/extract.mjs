#!/usr/bin/env node
/**
 * 3-2 轮取证：只读夹具，只写本目录。
 *   · `03-readout[-<tag>].json`：r5 §7.2 判据逐项读数（code 轮：第 1 轮超时失败、第 2 轮成功）；
 *   · `fixture-copy/`：code 目录下全部 .md 与两轮 run.json、task.json 的原样副本。
 *
 *   node extract.mjs <fixture> [tag]      tag 缺省 pre-approve；审批后以 post-approve 再跑
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [fixture, tag = 'pre-approve'] = process.argv.slice(2);
if (!fixture) {
  console.error('用法：node extract.mjs <fixture> [tag]');
  process.exit(64);
}
const T = '限流器重构';
const topicDir = path.join(fixture, '.reviews', T);
const codeDir = path.join(topicDir, 'code');
const metaDir = path.join(codeDir, '_meta');
const RUN_FAILED = '20260925T155608Z';
const RUN_OK = '20260925T163113Z';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const mdFiles = (await fs.readdir(codeDir)).filter((n) => n.endsWith('.md')).sort();
const metaFiles = (await fs.readdir(metaDir)).sort();
const readRun = async (id) => JSON.parse(await fs.readFile(path.join(metaDir, `run-${id}.json`), 'utf8'));
const runFailed = await readRun(RUN_FAILED);
const run = await readRun(RUN_OK);
const task = JSON.parse(await fs.readFile(path.join(topicDir, 'task.json'), 'utf8'));
const response = mdFiles.find((n) => /-r2-response-claude\.md$/.test(n));
const responseText = await fs.readFile(path.join(codeDir, response), 'utf8');
const role = /^role:\s*(\S+)/m.exec(responseText)?.[1] ?? null;

const hashes = {};
for (const n of mdFiles) hashes[n] = sha(await fs.readFile(path.join(codeDir, n)));

const readout = {
  at: new Date().toISOString(),
  tag,
  fixture,
  md_files: mdFiles,
  meta_files: metaFiles,
  criteria: {
    note_draft_suffix: 'code 轮无原稿（命令 C 不认领、被审对象是补丁）',
    run_driver: run.driver ?? null,
    run_driver_enabled: run.driver_enabled ?? null,
    run_driver_guard_level: run.driver_guard_level ?? null,
    run_entry: run.entry ?? null,
    run_rerun_index: run.rerun_index ?? null,
    critics: Object.keys(run.critics ?? {}),
    critics_exclude_driver: !Object.keys(run.critics ?? {}).includes('claude'),
    response: { file: response, role, ok: role === 'claude' },
    task_drivers: task.drivers ?? null,
    task_drivers_code_absent: task.drivers?.code === undefined,
    task_runs_code: (task.runs ?? []).filter((r) => r.stage === 'code'),
    degradations: task.degradations ?? [],
    approvals: task.approvals ?? [],
  },
  run_failed: {
    run_id: RUN_FAILED,
    status: runFailed.status ?? null,
    critics: Object.fromEntries(Object.entries(runFailed.critics ?? {}).map(([k, c]) => [k, { status: c.status ?? null, model: c.model_effective ?? c.model_requested ?? null, duration_s: c.duration_s ?? null, note: c.note ?? c.error ?? null }])),
  },
  run_ok: {
    run_id: RUN_OK,
    status: run.status ?? null,
    snapshot: run.snapshot ?? null,
    gate: run.gate ?? null,
    artifacts: run.artifacts ?? [],
    critics: Object.fromEntries(Object.entries(run.critics ?? {}).map(([k, c]) => [k, { status: c.status ?? null, model: c.model_effective ?? null, heterogeneous: c.heterogeneous ?? null, override_reason: c.override_reason ?? null, verdict: c.verdict ?? null }])),
  },
  file_sha256: hashes,
};

const suffix = tag === 'pre-approve' ? '' : `-${tag}`;
await fs.writeFile(path.join(HERE, `03-readout${suffix}.json`), JSON.stringify(readout, null, 2) + '\n', 'utf8');
const copyDir = path.join(HERE, 'fixture-copy');
await fs.mkdir(copyDir, { recursive: true });
for (const n of mdFiles) await fs.copyFile(path.join(codeDir, n), path.join(copyDir, n));
for (const id of [RUN_FAILED, RUN_OK]) await fs.copyFile(path.join(metaDir, `run-${id}.json`), path.join(copyDir, `run-${id}.json`));
await fs.copyFile(path.join(topicDir, 'task.json'), path.join(copyDir, `task${suffix}.json`));

console.log(JSON.stringify(readout.criteria, null, 2));
console.log('failed run:', JSON.stringify(readout.run_failed));
console.log('ok run status', readout.run_ok.status, '| gate.warnings', JSON.stringify(readout.run_ok.gate?.warnings ?? null), '| artifacts', readout.run_ok.artifacts.length);
console.log('critics', JSON.stringify(readout.run_ok.critics));
