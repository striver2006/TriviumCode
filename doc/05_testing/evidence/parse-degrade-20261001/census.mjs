// 「解析回退逐条降级」普查（只读、零配额）。
//
// 用法：node census.mjs --build <构建根> --out <读数.json> [--list <上一份读数.json>]
//   --build：含 dist/test/src/trivium/ 的目录（改前基线用 git archive 导出的 d418ce7；改后用仓库本身）。
//   --list ：固定样本清单（取上一份读数的 rows[].file），改后重放时用它，保证 48 份逐份对照。
//
// 每份样本给三组读数：
//   independent —— 不经 src，按 review.v1.json 独立分析：逐候选的语法 / 非法转义 / 根字段 / 逐条错误，
//                  并按计划 r1 的规则**预测**改后形态（ok / partial / fallback + 成因）。
//   parser      —— 用 --build 指定构建的 parseReview 实际重放的结果（改前只有 ok/reason；改后多出降级与修复字段）。
//   gate        —— 用该构建的 loadRoundReviews + checkAdjudication 复核该轮裁决（只读），看历史轮次是否翻转。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ROOT = process.cwd();
const BUILD = path.resolve(arg('--build') ?? ROOT);
const OUT = arg('--out');
const LIST = arg('--list');
const mod = (rel) => import(pathToFileURL(path.join(BUILD, 'dist/test/src/trivium', rel)).href);

const parse = await mod('parse.js');
const gate = await mod('gate.js');
const { defaultConfig, deepMerge } = await mod('config.js');
const { Ajv2020 } = await import(pathToFileURL(path.join(ROOT, 'node_modules/ajv/dist/2020.js')).href);
const YAML = (await import(pathToFileURL(path.join(ROOT, 'node_modules/yaml/dist/index.js')).href)).default;

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/dual-critic/schema/review.v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const vFull = ajv.compile(schema);
const vItem = ajv.compile(schema.properties.findings.items);
const ROOT_KEYS = new Set(Object.keys(schema.properties));
const ITEM_KEYS = Object.keys(schema.properties.findings.items.properties);
const ID_RE = new RegExp(schema.properties.findings.items.properties.id.pattern);

// 计划 r2 §3.2 的剥离清单：编排器写进审查文档 front-matter、且不属于 review.v1 根字段的键（render.ts renderFrontMatter），
// 含本主题新增的 findings_degraded / parse_fallback_cause / parse_repairs 三键（r1 读数用的是改前 32 键快照，三键不出现在旧样本里）
const ECHO_KEYS = [
  'topic', 'stage', 'role', 'vendor', 'agent_cli', 'model_requested', 'model_effective', 'model_effective_source',
  'effort', 'model_route', 'run_id', 'rerun_index', 'snapshot_hash', 'blind', 'started_at', 'finished_at',
  'duration_s', 'tool_calls', 'evidence_ok', 'findings_count', 'findings_degraded', 'degraded', 'parse_fallback',
  'parse_fallback_cause', 'parse_repairs', 'peer_deny', 'drift',
  'consulted_unverified', 'readonly_verification', 'path_verification', 'peer_leak', 'joint_check', 'heterogeneous',
  'override_reason', 'session_id',
];
const VENDOR_KEYS = ['toolAction', 'toolSummary'];

/** JSON 字符串内「反斜杠 + 非法转义字符」按字面还原（反斜杠自身转义），返回修复后文本与处数 */
function repairInvalidEscapes(s) {
  let out = '';
  let inStr = false;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) { if (ch === '"') inStr = true; out += ch; continue; }
    if (ch === '\\') {
      const nx = s[i + 1];
      if (nx !== undefined && '"\\/bfnrt'.includes(nx)) { out += ch + nx; i++; continue; }
      if (nx === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { out += s.slice(i, i + 6); i += 5; continue; }
      out += '\\\\'; n++; continue;
    }
    if (ch === '"') inStr = false;
    out += ch;
  }
  return { text: out, count: n };
}

const fmtErr = (e) => `${e.instancePath || '(根)'} ${e.message}${e.params && Object.keys(e.params).length ? ' ' + JSON.stringify(e.params) : ''}`;

function analyzeIndependent(raw) {
  const cands = parse.extractJsonCandidates(raw);
  const perCand = [];
  let best = null; // 预测：首个全合格 > 首个根合格 > 最深的失败
  let depth = 0; // 0 无候选 1 语法错 2 根不合 3 根合格
  let deepestFail = { cause: cands.length === 0 ? 'no_json_object' : null, errors: [] };
  const allRootOkIds = new Set(); // 全部根合格候选的编号并集——「跨候选丢失的编号数」的基准（计划 r2 §5.2，CODEX-01）
  for (const c of cands) {
    const rec = { from: c.from, len: c.json.length };
    let obj;
    try { obj = JSON.parse(c.json); rec.syntax = 'ok'; } catch (e) {
      const rep = repairInvalidEscapes(c.json);
      rec.syntaxError = e.message;
      if (rep.count > 0) {
        try { obj = JSON.parse(rep.text); rec.syntax = 'repaired'; rec.escapesRepaired = rep.count; } catch (e2) {
          rec.syntax = 'broken'; rec.escapesTried = rep.count; rec.afterRepairError = e2.message;
        }
      } else rec.syntax = 'broken';
    }
    if (rec.syntax === 'broken') { if (depth < 1) { depth = 1; deepestFail = { cause: 'json_syntax', errors: [rec.afterRepairError ?? rec.syntaxError] }; } perCand.push(rec); continue; }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) { rec.root = 'not_object'; perCand.push(rec); continue; }
    const extra = Object.keys(obj).filter((k) => !ROOT_KEYS.has(k));
    rec.strippedVendor = extra.filter((k) => VENDOR_KEYS.includes(k));
    rec.strippedEcho = extra.filter((k) => ECHO_KEYS.includes(k));
    rec.extraOther = extra.filter((k) => !VENDOR_KEYS.includes(k) && !ECHO_KEYS.includes(k));
    const cleaned = { ...obj };
    for (const k of [...rec.strippedVendor, ...rec.strippedEcho]) delete cleaned[k];
    const findingsIsArray = Array.isArray(cleaned.findings);
    const rootOk = findingsIsArray && vFull({ ...cleaned, findings: [] });
    rec.rootErrors = rootOk ? [] : findingsIsArray ? (vFull.errors ?? []).map(fmtErr) : ['findings 不是数组', ...(vFull({ ...cleaned, findings: [] }) ? [] : (vFull.errors ?? []).map(fmtErr))];
    if (!rootOk) { rec.root = 'invalid'; if (depth < 2) { depth = 2; deepestFail = { cause: 'root_invalid', errors: rec.rootErrors }; } perCand.push(rec); continue; }
    rec.root = 'ok';
    rec.findings = cleaned.findings.map((f, i) => {
      const ok = vItem(f);
      const idOk = f && typeof f === 'object' && typeof f.id === 'string' && ID_RE.test(f.id);
      const keys = f && typeof f === 'object' && !Array.isArray(f) ? Object.keys(f) : [];
      return {
        index: i,
        id: f && typeof f === 'object' ? f.id ?? null : null,
        ok,
        idUsable: idOk,
        missing: ITEM_KEYS.filter((k) => !keys.includes(k)),
        extra: keys.filter((k) => !ITEM_KEYS.includes(k)),
        errors: ok ? [] : (vItem.errors ?? []).map(fmtErr),
      };
    });
    const bad = rec.findings.filter((f) => !f.ok);
    rec.predicted = bad.length === 0 ? 'ok' : bad.some((f) => !f.idUsable) ? 'fallback:finding_unaddressable' : 'partial';
    perCand.push(rec);
    if (rec.predicted === 'fallback:finding_unaddressable') {
      if (depth < 3) { depth = 3; deepestFail = { cause: 'finding_unaddressable', errors: bad.filter((f) => !f.idUsable).flatMap((f) => f.errors) }; }
      continue;
    }
    // 计划 r2 §3.1「覆盖才替换」：首个根合格候选为默认；其后的全合格候选编号集覆盖默认候选全部编号才替换
    for (const f of rec.findings) if (typeof f.id === 'string') allRootOkIds.add(f.id);
    if (!best) { best = rec; if (rec.predicted === 'ok') break; continue; }
    if (rec.predicted === 'ok') {
      const mine = new Set(rec.findings.map((f) => f.id));
      if (best.findings.every((f) => mine.has(f.id))) { best = rec; break; }
    }
  }
  const predicted = best
    ? { outcome: best.predicted, from: best.from, qualified: best.findings.filter((f) => f.ok).length, degraded: best.findings.filter((f) => !f.ok).length,
        strippedEcho: best.strippedEcho, strippedVendor: best.strippedVendor, escapesRepaired: best.escapesRepaired ?? 0 }
    : { outcome: `fallback:${deepestFail.cause ?? 'no_json_object'}`, errors: deepestFail.errors.slice(0, 6) };
  if (best) predicted.lostIds = [...allRootOkIds].filter((id) => !best.findings.some((f) => f.id === id));
  return { candidates: perCand, predicted, allRootOkIds: [...allRootOkIds] };
}

function summarizeParser(r) {
  const out = { ok: r.ok };
  for (const [k, v] of Object.entries(r)) {
    if (k === 'review' || k === 'rawText') continue;
    if (k === 'ok') continue;
    out[k] = v;
  }
  if (r.ok) {
    out.findings = r.review.findings.length;
    out.ids = r.review.findings.map((f) => f.id);
  }
  return out;
}

// ── 样本集 ──
let files;
if (LIST) {
  files = JSON.parse(fs.readFileSync(LIST, 'utf8')).rows.map((r) => r.file);
} else {
  files = [];
  for (const topic of fs.readdirSync(path.join(ROOT, '.reviews')).sort()) {
    for (const stage of ['plan', 'code', 'bug']) {
      const d = path.join(ROOT, '.reviews', topic, stage, '_meta');
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d).sort()) {
        if (!/^review-[a-z]+-\d{8}T\d{6}Z\.json$/.test(f)) continue;
        const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (j.parse_fallback) files.push(path.relative(ROOT, path.join(d, f)));
      }
    }
  }
}

const repoCfg = YAML.parse(fs.readFileSync(path.join(ROOT, '.trivium/config.yaml'), 'utf8'));
const cfg = deepMerge(defaultConfig(), { gate: repoCfg.gate ?? {} });
const archiveRoot = path.join(ROOT, '.reviews');
const { readRunMeta } = await mod('meta.js');

const rows = [];
const gateCache = new Map();
for (const rel of files) {
  const m = /^\.reviews\/(.+)\/(plan|code|bug)\/_meta\/review-([a-z]+)-(\d{8}T\d{6}Z)\.json$/.exec(rel);
  const [, topic, stage, side, runId] = m;
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const raw = String(j.raw ?? '');
  const ind = analyzeIndependent(raw);
  const pr = summarizeParser(parse.parseReview(raw));
  const key = `${topic}|${stage}|${runId}`;
  if (!gateCache.has(key)) {
    const layout = { archiveRoot, topic };
    let g;
    try {
      const meta = await readRunMeta(layout, stage, runId);
      const lr = await gate.loadRoundReviews(layout, stage, runId);
      const res = await gate.checkAdjudication({
        cfg, layout, stage, rerunIndex: meta?.rerun_index ?? 1, reviews: lr.reviews, driver: meta?.driver,
        runIdPinned: true, degraded: lr.degraded, voidedSides: lr.voidedSides, readonlyBreach: lr.readonlyBreach,
        runWarnings: lr.runWarnings, expectedFallbackIds: lr.expectedFallbackIds, missingSides: lr.missingSides,
        runId, reviewDocs: lr.reviewDocs,
        ...(lr.expectedDegradedIds ? { expectedDegradedIds: lr.expectedDegradedIds } : {}),
      });
      g = {
        ok: res.ok,
        failures: res.failures.map((f) => ({ code: f.code, ids: f.ids ?? [] })),
        notes: lr.notes,
      };
    } catch (e) {
      g = { error: String(e.message ?? e).slice(0, 300) };
    }
    gateCache.set(key, g);
  }
  // 跨候选丢失的编号（计划 r2 §5.2 ③）：全部根合格候选的编号并集 − 解析器实际给出的合格 ∪ 降级编号；不复用形态相等判据
  if (pr.ok) {
    const got = new Set([...(pr.ids ?? []), ...((pr.degraded ?? []).map((d) => d.id))]);
    pr.lostIds = ind.allRootOkIds.filter((id) => !got.has(id));
  }
  rows.push({ file: rel, side, run: runId, stage, predicted: ind.predicted, candidates: ind.candidates, parser: pr, gate: gateCache.get(key) });
}

const count = (f) => rows.reduce((mm, r) => { const k = f(r); mm[k] = (mm[k] ?? 0) + 1; return mm; }, {});
const allFindings = rows.flatMap((r) => r.candidates.filter((c) => c.findings).slice(0, 1).flatMap((c) => c.findings));
const errKinds = {};
for (const f of allFindings) for (const e of f.errors) {
  const k = /required property '([^']+)'/.exec(e)?.[1] ? `缺 ${/required property '([^']+)'/.exec(e)[1]}`
    : /^\/(\w+) must be equal to one of the allowed values/.exec(e) ? `${/^\/(\w+)/.exec(e)[1]} 表外值`
      : /additional properties/.test(e) ? '多余字段' : e.replace(/\{.*$/, '').trim();
  errKinds[k] = (errKinds[k] ?? 0) + 1;
}
const out = {
  build: BUILD,
  generated_at: new Date().toISOString(),
  samples: rows.length,
  bySide: count((r) => r.side),
  predicted: count((r) => r.predicted.outcome),
  predictedBySide: count((r) => `${r.side}/${r.predicted.outcome}`),
  parserOk: count((r) => String(r.parser.ok)),
  parserCause: count((r) => r.parser.ok ? (r.parser.degraded?.length ? 'partial' : 'ok') : (r.parser.cause ?? 'fallback(改前无成因字段)')),
  gateOk: count((r) => r.gate.error ? 'error' : String(r.gate.ok)),
  findingsInRootOkCandidates: allFindings.length,
  findingsDegradedPredicted: allFindings.filter((f) => !f.ok).length,
  findingsIdUnusable: allFindings.filter((f) => !f.ok && !f.idUsable).length,
  findingErrorKinds: errKinds,
  predictedLostIds: rows.reduce((n, r) => n + (r.predicted.lostIds?.length ?? 0), 0),
  parserLostIds: rows.reduce((n, r) => n + (r.parser.lostIds?.length ?? 0), 0),
  rows,
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
const { rows: _r, ...head } = out;
console.log(JSON.stringify(head, null, 1));
