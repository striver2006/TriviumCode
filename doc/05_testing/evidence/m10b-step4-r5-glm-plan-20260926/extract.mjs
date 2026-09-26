#!/usr/bin/env node
/**
 * 3-5 轮（glm 真载体 · plan · J4）取证：只读夹具与本目录 `rollout-raw/4-session-end/` 的会话留痕，只写本目录。
 *   · `03-readout.json`：r5 §7.2 判据、§7.4 EV-107 逐格、r10 §4.2 参数保真、J4 载体证据；
 *   · `04-rollout-excerpt.json`：摘录（r10 §4.1 第 5 条）——只收用户消息原文（`<system-reminder>` 注入只记长度与 sha256）、
 *     工具调用（名字 + 命令文本或目标路径）与被拒的工具结果、每条请求的 `model` / `querySource`；不收推理、系统提示与工具输出全文；
 *   · `fixture-copy/`：原稿、两份审查文档、裁决件、run.json、task.json 原样副本。
 *
 *   node extract.mjs <fixture> [tag]      # tag 缺省 pre-approve；审批后以 post-approve 再跑
 *
 * 期望值先从代码推出、写死在下面：
 *   · 护栏：glm 登记 `guardLevel: 'L2'`（`hookConfigTarget` 有值，profile `l2-hook`）；非 L1 不看 Hook 在场 ⇒ L2；
 *   · EV-107：Driver 厂商 zcode，名义族 `/glm/i`（`VENDOR_MODEL_FAMILY`）；逐侧按生效模型算，异构 ⇒ `override_reason` null。
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
const TOPIC = '配置加载重构';
const DRIVER = 'glm';
const DRIVER_FAMILY = /glm/i; // VENDOR_MODEL_FAMILY.zcode
const EXPECT_GUARD = 'L2';
const INVOKE_PREFIX = '/dual-review-plan ';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const topicDir = path.join(fixture, '.reviews', TOPIC);
const planDir = path.join(topicDir, 'plan');
const metaDir = path.join(planDir, '_meta');
const planFiles = (await fs.readdir(planDir)).filter((n) => n.endsWith('.md')).sort();
const metaFiles = (await fs.readdir(metaDir)).sort();
const runFile = metaFiles.filter((n) => /^run-.+\.json$/.test(n)).sort().at(-1);
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

const isDraft = (n) => n.endsWith(`-${DRIVER}.md`) && !/-(revised|response)-/.test(n);
const draft = planFiles.find(isDraft);
const revised = planFiles.find((n) => n.endsWith(`-revised-${DRIVER}.md`));
const revisedFm = revised ? frontMatter(await fs.readFile(path.join(planDir, revised), 'utf8')) : {};
const draftFm = draft ? frontMatter(await fs.readFile(path.join(planDir, draft), 'utf8')) : {};

const critics = Object.keys(run.critics ?? {}).sort();
const ev107 = [];
for (const id of critics) {
  const c = run.critics[id];
  const model = c.model_effective ?? c.model_requested ?? null;
  const expHet = model ? !DRIVER_FAMILY.test(model) : true;
  const doc = planFiles.find((n) => n.endsWith(`-${id}.md`) && !/-(revised|response)-/.test(n));
  const fm = frontMatter(await fs.readFile(path.join(planDir, doc), 'utf8'));
  const orOk = (v) => (expHet ? v === null : typeof v === 'string' && v !== '');
  const row = {
    critic: id,
    model_effective: c.model_effective ?? null,
    model_effective_source: c.model_effective_source ?? null,
    expect: { heterogeneous: expHet, override_reason: expHet ? null : '非空' },
    run_json: { heterogeneous: c.heterogeneous ?? null, override_reason: c.override_reason ?? null },
    review_doc: { file: doc, heterogeneous: fmBool(fm.heterogeneous), override_reason: fmNull(fm.override_reason) },
  };
  row.ok = {
    run_heterogeneous: row.run_json.heterogeneous === expHet,
    run_override_reason: orOk(row.run_json.override_reason),
    doc_heterogeneous: row.review_doc.heterogeneous === expHet,
    doc_override_reason: orOk(row.review_doc.override_reason),
  };
  ev107.push(row);
}

// ── 会话留痕摘录 ──
const rawDir = path.join(HERE, 'rollout-raw', '4-session-end');
const sessFile = (await fs.readdir(rawDir)).find((n) => n.startsWith('model-io-sess_') && !n.startsWith('model-io-sess_subagent_') && n !== 'model-io-sess_baee857f-c891-4b10-bdb7-bf11d5c84a1d.jsonl' && n !== 'model-io-sess_e3671b27-1c8c-4963-8db9-6003f9b6798f.jsonl');
const lines = (await fs.readFile(path.join(rawDir, sessFile), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const requests = lines.map((x, i) => ({ i, startedAt: x.startedAt, model: x.model?.modelId ?? null, provider: x.model?.providerId ?? null, querySource: x.querySource ?? null }));
const full = lines.at(-1).request.messages; // 最后一条请求携带完整消息列表（messageOffset 0）
const excerpt = [];
for (const m of full) {
  if (m.role === 'user') {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    excerpt.push(text.startsWith('<system-reminder>')
      ? { kind: 'user_injected', head: text.slice(0, 80), length: text.length, sha256: sha(text) }
      : { kind: 'user_message', text });
  } else if (m.role === 'assistant' && m.toolCalls?.length) {
    for (const tc of m.toolCalls) {
      const inp = tc.input ?? {};
      excerpt.push({ kind: 'tool_call', id: tc.id, name: tc.name, command: inp.command ?? null, file_path: inp.file_path ?? null, skill: inp.skill ?? inp.name ?? null, args: inp.args ?? null });
    }
  } else if (m.role === 'tool' && m.isError) {
    excerpt.push({ kind: 'tool_error', toolCallId: m.toolCallId, toolName: m.toolName, content: String(m.content).slice(0, 600) });
  }
}
const userMsgs = excerpt.filter((e) => e.kind === 'user_message');
const invoke = userMsgs.find((e) => e.text.startsWith(INVOKE_PREFIX));
const invokeArgs = invoke ? invoke.text.slice(INVOKE_PREFIX.length) : null;
const typedTopic = invokeArgs ? /--topic\s+(\S+)/.exec(invokeArgs)?.[1] ?? null : null;
const typedFocus = invokeArgs ? invokeArgs.split(/\s--/)[0] : null;
const briefFocus = {};
for (const b of metaFiles.filter((n) => /^brief-.+\.md$/.test(n))) {
  const t = await fs.readFile(path.join(metaDir, b), 'utf8');
  briefFocus[b] = /## 2\. 本次审查焦点[\s\S]*?\n> (.*)\n/.exec(t)?.[1] ?? null;
}
const toolCalls = excerpt.filter((e) => e.kind === 'tool_call');
const startCall = toolCalls.find((e) => e.name === 'Bash' && /review --start/.test(e.command ?? ''));
const startOut = startCall ? full.find((m) => m.role === 'tool' && m.toolCallId === startCall.id) : null;
const nodes = JSON.parse(await fs.readFile(path.join(HERE, '05-rollout-nodes.json'), 'utf8'));

const artifacts = run.artifacts ?? [];
const draftRel = draft ? `${TOPIC}/plan/${draft}` : null;
const readout = {
  at: new Date().toISOString(),
  tag,
  fixture,
  run_file: runFile,
  plan_files: planFiles,
  criteria: {
    draft_suffix_is_driver: { draft: draft ?? null, role: draftFm.role ?? null, ok: Boolean(draft) },
    run_driver: { got: run.driver ?? null, ok: run.driver === DRIVER },
    run_driver_enabled: { got: run.driver_enabled ?? null, ok: run.driver_enabled === true },
    run_driver_guard_level: { expect: EXPECT_GUARD, got: run.driver_guard_level ?? null, ok: run.driver_guard_level === EXPECT_GUARD },
    critics: { got: critics, critics_selected: run.critics_selected ?? null, excludes_driver: !critics.includes(DRIVER) },
    disposition: { file: revised ?? null, role: revisedFm.role ?? null, ok: revisedFm.role === DRIVER },
    task_drivers_plan: { got: task.drivers?.plan ?? null, ok: task.drivers?.plan?.driver === DRIVER },
    draft_is_last_artifact: { last: artifacts.at(-1)?.path ?? null, draft: draftRel, ok: artifacts.at(-1)?.path === draftRel },
    ev107_all_ok: ev107.every((r) => Object.values(r.ok).every(Boolean)),
    param_fidelity: {
      typed: invoke?.text ?? null,
      topic: { typed: typedTopic, run_json: run.topic ?? null, ok: typedTopic !== null && typedTopic === run.topic },
      focus: { typed: typedFocus, run_prompt_hint: run.prompt_hint ?? null, brief: briefFocus, ok: typedFocus !== null && typedFocus === run.prompt_hint && Object.values(briefFocus).every((f) => f === typedFocus) },
      task_goal: { run_json: run.task_goal ?? null, note: '命令 B 轮不适用（r10 §4.2 只在命令 A 轮设本格）' },
    },
    j4: {
      session_file: sessFile,
      requests: requests.length,
      models: [...new Set(requests.map((r) => r.model))],
      start_call_in_session: Boolean(startCall),
      start_output_has_run_id: startOut ? String(startOut.content).includes(run.run_id) : false,
      subagent_files_any_node: nodes.some((n) => n.files.some((f) => f.subagent)),
      agent_tool_calls: toolCalls.filter((e) => /^(Agent|Task)$/.test(e.name)).length,
    },
    approvals: task.approvals ?? [],
  },
  ev107,
  tool_errors: excerpt.filter((e) => e.kind === 'tool_error').map((e) => ({ ...e, hook_denial: /^禁止写入/.test(e.content) })),
  run_status: run.status ?? null,
  run_snapshot: { git_head: run.snapshot?.git_head ?? null, dirty: run.snapshot?.dirty ?? null, drift: run.snapshot?.drift ?? null },
  run_gate: run.gate ?? null,
  run_artifacts: artifacts,
  task_gate: task.gate ?? null,
  requests,
};

const suffix = tag === 'pre-approve' ? '' : `-${tag}`;
await fs.writeFile(path.join(HERE, `03-readout${suffix}.json`), JSON.stringify(readout, null, 2) + '\n', 'utf8');
await fs.writeFile(path.join(HERE, '04-rollout-excerpt.json'), JSON.stringify(excerpt, null, 2) + '\n', 'utf8');
const copyDir = path.join(HERE, 'fixture-copy');
await fs.mkdir(copyDir, { recursive: true });
for (const n of planFiles) await fs.copyFile(path.join(planDir, n), path.join(copyDir, n));
await fs.copyFile(path.join(metaDir, runFile), path.join(copyDir, runFile));
await fs.copyFile(path.join(topicDir, 'task.json'), path.join(copyDir, `task${suffix}.json`));

console.log(JSON.stringify(readout.criteria, null, 2));
for (const r of ev107) console.log('ev107', r.critic, r.model_effective, JSON.stringify(r.run_json), JSON.stringify(r.review_doc), JSON.stringify(r.ok));
console.log('tool_errors', JSON.stringify(readout.tool_errors.map((e) => [e.toolName, e.hook_denial])));
