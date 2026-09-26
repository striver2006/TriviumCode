#!/usr/bin/env node
/**
 * 3-4 轮（codex 真载体 · code · 夹具）取证：只读夹具与 codex 会话 rollout，只写本目录。
 *   · `03-readout.json`：r5 §7.2 判据、§7.4 EV-107 逐格、r10 §4.2 参数保真；
 *   · `04-rollout-excerpt.json`：rollout 摘录——只收用户消息（注入的 AGENTS.md / skill 全文只记长度与 sha256）、
 *     工具调用（命令文本或 apply_patch 的目标路径行）与每轮 `turn_context` 的模型 / 沙箱 / 审批策略；不收推理、不收工具输出全文；
 *   · `fixture-copy/`：两份审查文档、应答件、run.json、task.json、NOTES.md 原样副本。
 *
 *   node extract.mjs <fixture> <rollout.jsonl>
 *
 * 期望值先从代码推出、写死在下面：
 *   · 护栏：codex 登记 `guardLevel: 'L2'`、`hookConfigTarget: null` ⇒ `effectiveGuardLevel` 返回 L2（`hook-config.ts:374`）；
 *   · EV-107：Driver 厂商 openai，名义族 `/gpt/i`（`VENDOR_MODEL_FAMILY`）；逐侧按生效模型算，异构 ⇒ `override_reason` null。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [fixture, rollout] = process.argv.slice(2);
if (!fixture || !rollout) {
  console.error('用法：node extract.mjs <fixture> <rollout.jsonl>');
  process.exit(64);
}
const TOPIC = 'slug规范化';
const DRIVER = 'codex';
const DRIVER_FAMILY = /gpt/i; // VENDOR_MODEL_FAMILY.openai
const EXPECT_GUARD = 'L2';
const INVOKE_PREFIX = '$dual-review-code ';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const topicDir = path.join(fixture, '.reviews', TOPIC);
const codeDir = path.join(topicDir, 'code');
const metaDir = path.join(codeDir, '_meta');
const codeFiles = (await fs.readdir(codeDir)).filter((n) => n.endsWith('.md')).sort();
const metaFiles = (await fs.readdir(metaDir)).sort();
const runFile = metaFiles.find((n) => /^run-.+\.json$/.test(n));
const run = JSON.parse(await fs.readFile(path.join(metaDir, runFile), 'utf8'));
const task = JSON.parse(await fs.readFile(path.join(topicDir, 'task.json'), 'utf8'));

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

const response = codeFiles.find((n) => n.endsWith(`-response-${DRIVER}.md`));
const responseFm = frontMatter(await fs.readFile(path.join(codeDir, response), 'utf8'));

const critics = Object.keys(run.critics ?? {}).sort();
const ev107 = [];
for (const id of critics) {
  const c = run.critics[id];
  const model = c.model_effective ?? c.model_requested ?? null;
  const expHet = model ? !DRIVER_FAMILY.test(model) : true;
  const doc = codeFiles.find((n) => n.endsWith(`-${id}.md`) && !/-(revised|response)-/.test(n));
  const fm = frontMatter(await fs.readFile(path.join(codeDir, doc), 'utf8'));
  const orOk = (v) => (expHet ? v === null : typeof v === 'string' && v !== '');
  const row = {
    critic: id,
    model_effective: c.model_effective ?? null,
    model_effective_source: c.model_effective_source ?? null,
    expect: { heterogeneous: expHet, override_reason: expHet ? null : '非空' },
    run_json: { heterogeneous: c.heterogeneous ?? null, override_reason: c.override_reason ?? null },
    review_doc: { file: doc, heterogeneous: fmBool(fm.heterogeneous), override_reason: fmNull(fm.override_reason), drift: fmBool(fm.drift) },
  };
  row.ok = {
    run_heterogeneous: row.run_json.heterogeneous === expHet,
    run_override_reason: orOk(row.run_json.override_reason),
    doc_heterogeneous: row.review_doc.heterogeneous === expHet,
    doc_override_reason: orOk(row.review_doc.override_reason),
  };
  ev107.push(row);
}

// ── rollout 摘录 ──
const records = (await fs.readFile(rollout, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const excerpt = [];
for (const o of records) {
  const p = o.payload ?? {};
  if (o.type === 'session_meta') {
    excerpt.push({ t: o.timestamp, kind: 'session_meta', id: p.id ?? null, cwd: p.cwd ?? null, cli_version: p.cli_version ?? null, originator: p.originator ?? null });
  } else if (o.type === 'turn_context') {
    excerpt.push({ t: o.timestamp, kind: 'turn_context', model: p.model ?? null, sandbox: p.sandbox_policy?.type ?? null, approval: p.approval_policy ?? null });
  } else if (o.type === 'response_item' && p.type === 'message' && p.role === 'user') {
    const text = (p.content ?? []).map((x) => x.text ?? '').join('');
    const injected = text.startsWith('# AGENTS.md instructions') || text.startsWith('<skill>') || text.startsWith('<environment_context>');
    excerpt.push(injected
      ? { t: o.timestamp, kind: 'user_injected', head: text.slice(0, 120), length: text.length, sha256: sha(text) }
      : { t: o.timestamp, kind: 'user_message', text });
  } else if (o.type === 'response_item' && p.type === 'function_call') {
    let cmd = null;
    try { cmd = JSON.parse(p.arguments).cmd ?? null; } catch { cmd = null; }
    excerpt.push({ t: o.timestamp, kind: 'function_call', name: p.name, cmd });
  } else if (o.type === 'response_item' && p.type === 'custom_tool_call') {
    const targets = String(p.input ?? '').split('\n').filter((l) => /^\*\*\* (Add|Update|Delete) File:/.test(l));
    excerpt.push({ t: o.timestamp, kind: 'custom_tool_call', name: p.name, targets });
  }
}
const userMsgs = excerpt.filter((e) => e.kind === 'user_message');
const invoke = userMsgs.find((e) => e.text.startsWith(INVOKE_PREFIX));
const invokeArgs = invoke ? invoke.text.slice(INVOKE_PREFIX.length) : null;
const typedTopic = invokeArgs ? /--topic\s+(\S+)/.exec(invokeArgs)?.[1] ?? null : null;
const typedFocus = invokeArgs ? invokeArgs.split(/\s--/)[0] : null;
const briefs = metaFiles.filter((n) => /^brief-.+\.md$/.test(n));
const briefFocus = {};
for (const b of briefs) {
  const t = await fs.readFile(path.join(metaDir, b), 'utf8');
  briefFocus[b] = /## 2\. 本次审查焦点[\s\S]*?\n> (.*)\n/.exec(t)?.[1] ?? null;
}
const writes = excerpt.filter((e) => e.kind === 'custom_tool_call').map((e) => ({ t: e.t, name: e.name, targets: e.targets }));

const readout = {
  at: new Date().toISOString(),
  fixture,
  rollout,
  run_file: runFile,
  code_files: codeFiles,
  meta_files: metaFiles,
  criteria: {
    run_driver: { got: run.driver ?? null, ok: run.driver === DRIVER },
    run_driver_enabled: { got: run.driver_enabled ?? null, ok: run.driver_enabled === true },
    run_driver_guard_level: { expect: EXPECT_GUARD, got: run.driver_guard_level ?? null, ok: run.driver_guard_level === EXPECT_GUARD },
    critics: { got: critics, critics_selected: run.critics_selected ?? null, excludes_driver: !critics.includes(DRIVER) },
    response: { file: response ?? null, role: responseFm.role ?? null, kind: responseFm.kind ?? null, ok: responseFm.role === DRIVER },
    task_drivers: task.drivers ?? null,
    approvals: task.approvals ?? [],
    ev107_all_ok: ev107.every((r) => Object.values(r.ok).every(Boolean)),
    param_fidelity: {
      typed: invoke?.text ?? null,
      topic: { typed: typedTopic, run_json: run.topic ?? null, ok: typedTopic !== null && typedTopic === run.topic },
      focus: {
        typed: typedFocus,
        run_prompt_hint: run.prompt_hint ?? null,
        brief: briefFocus,
        ok: typedFocus !== null && typedFocus === run.prompt_hint && Object.values(briefFocus).every((f) => f === typedFocus),
      },
      task_goal: { run_json: run.task_goal ?? null, note: '命令 C 轮不适用（r10 §4.2 只在命令 A 轮设本格）' },
    },
  },
  ev107,
  carrier_writes: writes,
  run_status: run.status ?? null,
  run_entry: run.entry ?? null,
  run_snapshot: { git_head: run.snapshot?.git_head ?? null, dirty: run.snapshot?.dirty ?? null, drift: run.snapshot?.drift ?? null, build: run.snapshot?.build ?? null },
  run_artifacts: run.artifacts ?? [],
  task_gate: task.gate ?? null,
  task_joint_checks: task.joint_checks ?? [],
};

await fs.writeFile(path.join(HERE, '03-readout.json'), JSON.stringify(readout, null, 2) + '\n', 'utf8');
await fs.writeFile(path.join(HERE, '04-rollout-excerpt.json'), JSON.stringify(excerpt, null, 2) + '\n', 'utf8');

const copyDir = path.join(HERE, 'fixture-copy');
await fs.mkdir(copyDir, { recursive: true });
for (const n of codeFiles) await fs.copyFile(path.join(codeDir, n), path.join(copyDir, n));
await fs.copyFile(path.join(metaDir, runFile), path.join(copyDir, runFile));
await fs.copyFile(path.join(topicDir, 'task.json'), path.join(copyDir, 'task.json'));
await fs.copyFile(path.join(fixture, 'NOTES.md'), path.join(copyDir, 'NOTES.md'));

console.log(JSON.stringify(readout.criteria, null, 2));
for (const r of ev107) console.log('ev107', r.critic, r.model_effective, JSON.stringify(r.run_json), JSON.stringify(r.review_doc), JSON.stringify(r.ok));
console.log('writes', JSON.stringify(writes));
console.log('snapshot', JSON.stringify(readout.run_snapshot.drift), 'dirty', readout.run_snapshot.dirty);
