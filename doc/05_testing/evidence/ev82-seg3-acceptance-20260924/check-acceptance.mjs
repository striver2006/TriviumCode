#!/usr/bin/env node
/**
 * EV-82 第三段验收（计划 `EV-82-置首修法` r3 §7.3）：按四条判据核对一次真实派发的留痕。只读。
 *
 *   1. run.json：glm 侧 `model_effective` 的 modelId 段为请求模型；
 *   2. run.json：`model_override_applied === true`；
 *   3. trace.json：`modelSelection.reorder.kind === 'applied'`（或 `identity`，此时以 1、2、4 加 doctor 读数为准）；
 *   4. rollout.jsonl：**每一条**请求的模型都是请求模型（现有解析器只取首条，这里逐条核，不改解析器）。
 *
 * - rollout 逐字含送审包全文：逐行只取模型字段（顶层 `model` 与 `response.modelId`），其它内容一律不读出、不输出；
 * - trace.json 只取 `modelSelection` 一段；
 * - 仓库根按脚本位置推导（EV-103），运行目录取自 run.json 同目录的编排器约定，不写死用户目录。
 *
 * 用法：node doc/05_testing/evidence/ev82-seg3-acceptance-20260924/check-acceptance.mjs <run_id> [<topic>] [<stage>]
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const [runId, topic = 'EV-82-审查臂诊断', stage = 'plan'] = process.argv.slice(2);
if (!runId) {
  console.error('用法：node check-acceptance.mjs <run_id> [<topic>] [<stage>]');
  process.exit(64);
}
const REQUESTED_TAIL = 'GLM-5.3-Flash';
const tail = (m) => (typeof m === 'string' ? m.slice(m.indexOf('/') + 1) : null);

const runJsonPath = path.join(ROOT, '.reviews', topic, stage, '_meta', `run-${runId}.json`);
const run = JSON.parse(await fs.readFile(runJsonPath, 'utf8'));
const g = run.critics?.glm ?? {};

// 运行目录：~/.trivium/runs/<项目键>/<run_id>/glm/out——项目键从 run.json 的 run_dir 取，缺失时按目录名搜
async function findOutDir() {
  if (typeof run.run_dir === 'string') return path.join(run.run_dir, 'glm', 'out');
  const base = path.join(os.homedir(), '.trivium', 'runs');
  for (const proj of await fs.readdir(base)) {
    const cand = path.join(base, proj, runId, 'glm', 'out');
    try { await fs.access(cand); return cand; } catch { /* next */ }
  }
  return null;
}
const outDir = await findOutDir();

let modelSelection = null;
let rollout = { lines: 0, parsed: 0, withModel: 0, models: {} };
if (outDir) {
  try {
    const t = JSON.parse(await fs.readFile(path.join(outDir, 'trace.json'), 'utf8'));
    modelSelection = t.modelSelection ?? null;
  } catch { /* 缺失即判据 3 不可核 */ }
  try {
    const text = await fs.readFile(path.join(outDir, 'rollout.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      rollout.lines += 1;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      rollout.parsed += 1;
      // 只取模型字段
      const top = o?.model && typeof o.model === 'object' ? `${o.model.providerId}/${o.model.modelId}` : typeof o?.model === 'string' ? o.model : null;
      const resp = typeof o?.response?.modelId === 'string' ? o.response.modelId : null;
      for (const m of [top, resp].filter(Boolean)) {
        rollout.models[m] = (rollout.models[m] ?? 0) + 1;
      }
      if (top || resp) rollout.withModel += 1;
    }
  } catch { /* 缺失即判据 4 不可核 */ }
}

const c1 = tail(g.model_effective) === REQUESTED_TAIL;
const c2 = g.model_override_applied === true;
const kind = modelSelection?.reorder?.kind ?? null;
const c3 = kind === 'applied' || kind === 'identity';
const modelKeys = Object.keys(rollout.models);
const c4 = rollout.withModel > 0 && modelKeys.every((m) => tail(m) === REQUESTED_TAIL);

const out = {
  plan: 'EV-82-置首修法 r3 §7.3',
  run_id: runId,
  topic,
  stage,
  run_status: run.status ?? null,
  git_head: run.snapshot?.git_head ?? null,
  glm: {
    status: g.status ?? null,
    model_requested: g.model_requested ?? null,
    model_effective: g.model_effective ?? null,
    model_effective_source: g.model_effective_source ?? null,
    model_route: g.model_route ?? null,
    model_override_applied: g.model_override_applied ?? null,
    run_json_has_model_override_reorder: Object.hasOwn(g, 'model_override_reorder'),
  },
  trace_model_selection: modelSelection,
  rollout,
  criteria: {
    '1_model_effective_is_requested': c1,
    '2_model_override_applied_true': c2,
    '3_reorder_kind': { kind, pass: c3 },
    '4_rollout_every_request_is_requested': c4,
  },
  all_pass: c1 && c2 && c3 && c4,
};
const outPath = path.join(HERE, `acceptance-${runId}.json`);
await fs.writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(`run ${runId}（${topic}/${stage}，HEAD ${String(out.git_head).slice(0, 7)}，状态 ${out.run_status}）`);
console.log(`判据 1 model_effective=${g.model_effective} ⇒ ${c1 ? '✓' : '✗'}`);
console.log(`判据 2 model_override_applied=${g.model_override_applied} ⇒ ${c2 ? '✓' : '✗'}`);
console.log(`判据 3 trace reorder=${JSON.stringify(modelSelection?.reorder ?? null)} ⇒ ${c3 ? '✓' : '✗'}`);
console.log(`判据 4 rollout ${rollout.lines} 行（解析 ${rollout.parsed}，带模型 ${rollout.withModel}）模型计数 ${JSON.stringify(rollout.models)} ⇒ ${c4 ? '✓' : '✗'}`);
console.log(`run.json glm 段含 model_override_reorder：${out.glm.run_json_has_model_override_reorder}（应为 false）`);
console.log(`trace note：${modelSelection?.note ?? '（无）'}`);
console.log(`结论：${out.all_pass ? '四条全满足' : '有判据不满足'}`);
console.log(`输出：${path.relative(ROOT, outPath)}`);
