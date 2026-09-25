#!/usr/bin/env node
/**
 * 3-1 轮取证：只读夹具，只写本目录。
 *   · `03-readout.json`：r5 §7.2 判据逐项读数（run.json / task.json / 归档文件名）；
 *   · `fixture-copy/`：原稿、两份审查文档、裁决件、run.json 的原样副本。
 *
 *   node extract.mjs <fixture> [tag]
 * tag 缺省为 `pre-approve`；用户审批后以 `post-approve` 再跑一次，读数写进 `03-readout-post-approve.json`。
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
const TOPIC = '限流器重构';
const topicDir = path.join(fixture, '.reviews', TOPIC);
const planDir = path.join(topicDir, 'plan');
const metaDir = path.join(planDir, '_meta');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const planFiles = (await fs.readdir(planDir)).filter((n) => n.endsWith('.md')).sort();
const metaFiles = (await fs.readdir(metaDir)).sort();
const runFile = metaFiles.find((n) => /^run-.+\.json$/.test(n));
const run = JSON.parse(await fs.readFile(path.join(metaDir, runFile), 'utf8'));
const task = JSON.parse(await fs.readFile(path.join(topicDir, 'task.json'), 'utf8'));

const draft = planFiles.find((n) => /-claude\.md$/.test(n) && !/-(revised|response)-/.test(n));
const revised = planFiles.find((n) => /-revised-claude\.md$/.test(n));
const revisedText = await fs.readFile(path.join(planDir, revised), 'utf8');
const role = /^role:\s*(\S+)/m.exec(revisedText)?.[1] ?? null;

const fileHashes = {};
for (const n of planFiles) fileHashes[n] = sha(await fs.readFile(path.join(planDir, n)));

const readout = {
  at: new Date().toISOString(),
  tag,
  fixture,
  run_file: runFile,
  plan_files: planFiles,
  meta_files: metaFiles,
  criteria: {
    draft_suffix_is_driver: { draft, ok: /-claude\.md$/.test(draft ?? '') },
    run_driver: run.driver ?? null,
    run_driver_enabled: run.driver_enabled ?? null,
    run_driver_guard_level: run.driver_guard_level ?? null,
    run_entry: run.entry ?? null,
    critics_selected: run.critics_selected ?? run.critics_set ?? Object.keys(run.critics ?? {}),
    critics_exclude_driver: !Object.keys(run.critics ?? {}).includes('claude'),
    disposition: { file: revised, role, ok: role === 'claude' },
    task_drivers_plan: task.drivers?.plan ?? null,
    approvals: task.approvals ?? [],
  },
  run_status: run.status ?? null,
  run_snapshot: run.snapshot ?? null,
  run_gate: run.gate ?? null,
  run_artifacts: run.artifacts ?? [],
  critics: Object.fromEntries(
    Object.entries(run.critics ?? {}).map(([id, c]) => [
      id,
      { model: c.model_effective ?? c.model ?? null, heterogeneous: c.heterogeneous ?? null, override_reason: c.override_reason ?? null, state: c.status ?? c.state ?? null },
    ]),
  ),
  file_sha256: fileHashes,
};

const suffix = tag === 'pre-approve' ? '' : `-${tag}`;
await fs.writeFile(path.join(HERE, `03-readout${suffix}.json`), JSON.stringify(readout, null, 2) + '\n', 'utf8');

const copyDir = path.join(HERE, 'fixture-copy');
await fs.mkdir(copyDir, { recursive: true });
for (const n of planFiles) await fs.copyFile(path.join(planDir, n), path.join(copyDir, n));
await fs.copyFile(path.join(metaDir, runFile), path.join(copyDir, runFile));
await fs.copyFile(path.join(topicDir, 'task.json'), path.join(copyDir, `task${suffix}.json`));

console.log(JSON.stringify(readout.criteria, null, 2));
console.log('status', readout.run_status, '| gate.warnings', JSON.stringify(readout.run_gate?.warnings ?? null));
console.log('artifacts', readout.run_artifacts.map((a) => a.path ?? a).join(' | '));
console.log('critics', JSON.stringify(readout.critics));
