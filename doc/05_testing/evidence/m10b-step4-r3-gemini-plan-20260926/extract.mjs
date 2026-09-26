#!/usr/bin/env node
/**
 * 3-3 轮（gemini 名义 Driver · plan · 夹具）取证：只读夹具，只写本目录。
 *   · `03-readout.json`：r5 §7.2 判据逐项读数 + §7.4 EV-107 逐格比对；
 *   · `fixture-copy/`：原稿、两份审查文档、裁决件、run.json、task.json 的原样副本。
 *
 *   node extract.mjs <fixture> [tag]
 * tag 缺省为 `pre-approve`；用户审批后以 `post-approve` 再跑一次，读数写进 `03-readout-post-approve.json`。
 *
 * 期望值先从代码推出、写死在下面，不从 run.json 回读（回读等于拿被测值当期望）：
 *   · 护栏等级：注册表 gemini 登记 `guardLevel: 'L2'`、`hookConfigTarget: null`（`agents/registry.ts`）；
 *     `effectiveGuardLevel` 对非 L1 直接返回登记值、不看 Hook 在场（`hook-config.ts:374`）⇒ `L2`，
 *     `guardProfileOf` ⇒ `l2-none`，`gateHoldNotice` 取「本载体没有 Hook 拦截」一档。
 *   · EV-107：`heterogeneous = isHeterogeneous(model_effective ?? model_requested, vendor(driver))`，
 *     即模型名**不**匹配 Driver 厂商的名义族；gemini 厂商 `antigravity`，名义族 `/gemini/i`
 *     （`VENDOR_MODEL_FAMILY`，`agents/registry.ts:62`）。`override_reason` 在异构时为 null，
 *     同族时非空（`overrideReasonFor`，`review.ts:316`）。逐侧按**生效模型**算，不按 Agent。
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
const TOPIC = '缓存过期策略';
const DRIVER = 'gemini';
const DRIVER_FAMILY = /gemini/i; // VENDOR_MODEL_FAMILY.antigravity
const EXPECT_GUARD = 'L2';
const EXPECT_CRITICS = ['claude', 'codex'];

const topicDir = path.join(fixture, '.reviews', TOPIC);
const planDir = path.join(topicDir, 'plan');
const metaDir = path.join(planDir, '_meta');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const planFiles = (await fs.readdir(planDir)).filter((n) => n.endsWith('.md')).sort();
const metaFiles = (await fs.readdir(metaDir)).sort();
const runFile = metaFiles.find((n) => /^run-.+\.json$/.test(n));
const run = JSON.parse(await fs.readFile(path.join(metaDir, runFile), 'utf8'));
const task = JSON.parse(await fs.readFile(path.join(topicDir, 'task.json'), 'utf8'));

const isDriverSuffixed = (n) => n.endsWith(`-${DRIVER}.md`) && !/-(revised|response)-/.test(n);
const draft = planFiles.find(isDriverSuffixed);
const revised = planFiles.find((n) => n.endsWith(`-revised-${DRIVER}.md`));
const revisedText = await fs.readFile(path.join(planDir, revised), 'utf8');
const role = /^role:\s*(\S+)/m.exec(revisedText)?.[1] ?? null;

/** 审查文档 front-matter 的顶层标量（只取 `key: value` 一行形态；缺该行记为 undefined） */
function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const fm = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
    if (kv && kv[2] !== '') fm[kv[1]] = kv[2];
  }
  return fm;
}
const fmBool = (v) => (v === 'true' ? true : v === 'false' ? false : v);
const fmNull = (v) => (v === undefined || v === 'null' || v === '~' ? null : v);

const critics = Object.keys(run.critics ?? {}).sort();
const ev107 = [];
for (const id of critics) {
  const c = run.critics[id];
  const model = c.model_effective ?? c.model_requested ?? null;
  const expHet = model ? !DRIVER_FAMILY.test(model) : true;
  const reviewDoc = planFiles.find((n) => n.endsWith(`-${id}.md`) && !/-(revised|response)-/.test(n));
  const fm = frontMatter(await fs.readFile(path.join(planDir, reviewDoc), 'utf8'));
  const row = {
    critic: id,
    model_requested: c.model_requested ?? null,
    model_effective: c.model_effective ?? null,
    model_effective_source: c.model_effective_source ?? null,
    expect: { heterogeneous: expHet, override_reason: expHet ? null : '非空' },
    run_json: { heterogeneous: c.heterogeneous ?? null, override_reason: c.override_reason ?? null },
    review_doc: { file: reviewDoc, heterogeneous: fmBool(fm.heterogeneous), override_reason: fmNull(fm.override_reason) },
  };
  const orOk = (v) => (expHet ? v === null : typeof v === 'string' && v !== '');
  row.ok = {
    run_heterogeneous: row.run_json.heterogeneous === expHet,
    run_override_reason: orOk(row.run_json.override_reason),
    doc_heterogeneous: row.review_doc.heterogeneous === expHet,
    doc_override_reason: orOk(row.review_doc.override_reason),
  };
  ev107.push(row);
}

const artifacts = run.artifacts ?? [];
const last = artifacts.at(-1)?.path ?? null;
const draftRel = draft ? `${TOPIC}/plan/${draft}` : null;

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
    draft_suffix_is_driver: { draft: draft ?? null, ok: Boolean(draft) },
    run_driver: { got: run.driver ?? null, ok: run.driver === DRIVER },
    run_driver_enabled: { got: run.driver_enabled ?? null, ok: run.driver_enabled === true },
    run_driver_guard_level: { expect: EXPECT_GUARD, got: run.driver_guard_level ?? null, ok: run.driver_guard_level === EXPECT_GUARD },
    critics: { got: critics, critics_selected: run.critics_selected ?? null, expect: EXPECT_CRITICS, excludes_driver: !critics.includes(DRIVER) },
    disposition: { file: revised ?? null, role, ok: role === DRIVER },
    task_drivers_plan: { got: task.drivers?.plan ?? null, ok: task.drivers?.plan?.driver === DRIVER },
    draft_is_last_artifact: { last, draft: draftRel, index: artifacts.findIndex((a) => a.path === draftRel), count: artifacts.length, ok: last !== null && last === draftRel },
    ev107_all_ok: ev107.every((r) => Object.values(r.ok).every(Boolean)),
    approvals: task.approvals ?? [],
  },
  ev107,
  run_entry: run.entry ?? null,
  run_status: run.status ?? null,
  run_snapshot: run.snapshot ?? null,
  run_gate: run.gate ?? null,
  run_artifacts: artifacts,
  task_gate: task.gate ?? null,
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
for (const r of ev107) console.log('ev107', r.critic, r.model_effective, JSON.stringify(r.expect), JSON.stringify(r.run_json), JSON.stringify(r.review_doc), JSON.stringify(r.ok));
