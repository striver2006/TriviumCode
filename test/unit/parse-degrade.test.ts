/**
 * 解析回退逐条降级（设计 §6.5；计划 `.reviews/解析回退逐条降级/plan/` r2 §5.1 P1～P13）。
 *
 * 新导出一律经命名空间取（`P.xxx`），不用具名导入：用例要能**逐格**移植进改前构建
 * （`git archive d418ce7`）——具名导入缺一个导出整个文件就加载失败，分不出哪格红、哪格是回归。
 * 名字带〔回归〕的格在改前构建上也必须绿（改前就成立的行为）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../../src/trivium/parse.js';
import { renderFrontMatter, type RenderInput } from '../../src/trivium/render.js';
import { CRITICS, type CriticResult, type Review } from '../../src/trivium/types.js';
import reviewSchema from '../../skills/dual-critic/schema/review.v2.json' with { type: 'json' };

type Loose = Record<string, unknown>;

function finding(id: string, over: Loose = {}, drop: string[] = []): Loose {
  const f: Loose = {
    id, severity: 'minor', layer: 'plan', kind: 'correctness',
    location: `plan §${id}`, problem: `问题 ${id}`, evidence: '读了 src/a.ts', suggestion: '改之', confidence: 'high',
    ...over,
  };
  for (const k of drop) delete f[k];
  return f;
}

function review(findings: Loose[], over: Loose = {}): Loose {
  return {
    schema: 'trivium.review.v2', verdict: 'pass-after-changes', summary: '最危险的一条在前。',
    findings, not_covered: ['前端'], consulted: ['src/a.ts'], ...over,
  };
}

/** 成功支的新字段；改前构建上是 undefined，断言会当格红 */
function okParts(r: P.ParseOutcome): { ids: string[]; degraded: { id: string; problems: { field: string; kind: string }[]; raw: Loose }[]; repairs: { stripped_fields: string[]; unescaped_backslashes: number } } {
  assert.equal(r.ok, true, r.ok ? '' : `应解析成功：${r.reason} ${r.errors.join('; ')}`);
  const x = r as Extract<P.ParseOutcome, { ok: true }>;
  assert.ok(Array.isArray(x.degraded), '成功支应带 degraded');
  assert.ok(x.repairs, '成功支应带 repairs');
  return { ids: x.review.findings.map((f) => f.id), degraded: x.degraded, repairs: x.repairs };
}

function failCause(r: P.ParseOutcome): string {
  assert.equal(r.ok, false, '应整份回退');
  return (r as Extract<P.ParseOutcome, { ok: false }>).cause;
}

const ECHO6 = { topic: 'T', stage: 'plan', role: 'glm', run_id: '20260101T000000Z', rerun_index: 1, evidence_ok: true };

test('P1 根带编排器回显的六个键 ⇒ 剥掉后整份合格，stripped_fields 逐项记下', () => {
  const r = P.parseReview(JSON.stringify(review([finding('GLM-01')], ECHO6)));
  const { ids, degraded, repairs } = okParts(r);
  assert.deepEqual(ids, ['GLM-01']);
  assert.deepEqual(degraded, []);
  assert.deepEqual([...repairs.stripped_fields].sort(), Object.keys(ECHO6).sort());
  assert.equal(repairs.unescaped_backslashes, 0);
  assert.equal('topic' in (r as Extract<P.ParseOutcome, { ok: true }>).review, false, '剥掉的键不进结论');
});

test('P2〔回归〕拼错的回显键（toppic）不剥 ⇒ 根不合、整份回退，错误点名它', () => {
  const r = P.parseReview(JSON.stringify(review([finding('GLM-01')], { toppic: 'T' })));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes('toppic')), r.errors.join('; '));
});

test('P2′ 拼错的回显键 ⇒ 成因是 root_invalid', () => {
  assert.equal(failCause(P.parseReview(JSON.stringify(review([finding('GLM-01')], { toppic: 'T' })))), 'root_invalid');
});

test('P3 reviewer / addresses 不在清单 ⇒ root_invalid（不是编排器写进审查文档的字段）', () => {
  assert.equal(failCause(P.parseReview(JSON.stringify(review([finding('GLM-01')], { reviewer: 'glm' })))), 'root_invalid');
  assert.equal(failCause(P.parseReview(JSON.stringify(review([finding('GLM-01')], { addresses: ['x.md'] })))), 'root_invalid');
});

test('P4 字符串里的「反斜杠 + 竖线」⇒ 按字面还原后合格，计数与值都对', () => {
  const text = JSON.stringify(review([finding('AGY-01', { evidence: '表格 a PIPE b' })])).replace('PIPE', '\\|');
  assert.throws(() => JSON.parse(text), '前提：原文不是合法 JSON');
  const r = P.parseReview(text);
  const { ids, repairs } = okParts(r);
  assert.deepEqual(ids, ['AGY-01']);
  assert.equal(repairs.unescaped_backslashes, 1);
  const ev = (r as Extract<P.ParseOutcome, { ok: true }>).review.findings[0]!.evidence;
  assert.equal(ev, '表格 a \\| b', '值里保留字面的反斜杠与竖线');
});

test('P5 合法转义原样；能直接解析的文本不走还原（计数 0）', () => {
  const u = String.fromCharCode(92) + 'u00e9'; // 反斜杠 u 加四位十六进制，JSON 解析为 é
  const text = JSON.stringify(review([finding('AGY-01')])).replace('问题 AGY-01', `换行\\n引号\\"反斜杠\\\\重音${u}`);
  const r = P.parseReview(text);
  const { repairs } = okParts(r);
  assert.equal(repairs.unescaped_backslashes, 0);
  assert.equal((r as Extract<P.ParseOutcome, { ok: true }>).review.findings[0]!.problem, '换行\n引号"反斜杠\\重音é');
});

test('P5′ Windows 路径形态（反斜杠后跟 users、再跟 glm）⇒ 两处按字面还原、计数 2', () => {
  const bs = String.fromCharCode(92);
  const text = JSON.stringify(review([finding('GLM-01', { location: 'C:PATH' })])).replace('PATH', `${bs}users${bs}glm`);
  const r = P.parseReview(text);
  const { repairs } = okParts(r);
  assert.equal(repairs.unescaped_backslashes, 2);
  assert.equal((r as Extract<P.ParseOutcome, { ok: true }>).review.findings[0]!.location, `C:${bs}users${bs}glm`);
});

test('P5‴ 原文因非法转义要还原时，同一段里合法的「反斜杠 u 加四位十六进制」照旧按转义解析、不被双写', () => {
  const bs = String.fromCharCode(92);
  const text = JSON.stringify(review([finding('AGY-01', { evidence: 'PIPE 与 UNI' })]))
    .replace('PIPE', `${bs}|`).replace('UNI', `${bs}u00e9`);
  const r = P.parseReview(text);
  const { repairs } = okParts(r);
  assert.equal(repairs.unescaped_backslashes, 1);
  assert.equal((r as Extract<P.ParseOutcome, { ok: true }>).review.findings[0]!.evidence, `${bs}| 与 é`);
});

test('P5″ repairInvalidEscapes 只动字符串内部', () => {
  const bs = String.fromCharCode(92);
  const out = P.repairInvalidEscapes(`{"a":"x${bs}|y","b":"${bs}n"}`);
  assert.equal(out.count, 1);
  assert.deepEqual(JSON.parse(out.text), { a: `x${bs}|y`, b: '\n' });
});

test('P6〔回归〕缺逗号 ⇒ 整份回退，reason 是原始语法报错', () => {
  const r = P.parseReview('{"schema": "trivium.review.v1" "verdict": "approve"}');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /JSON 语法错误/);
});

test('P6′ 缺逗号 ⇒ 成因 json_syntax；有非法转义也修不好时同样 json_syntax，并说明试过还原', () => {
  assert.equal(failCause(P.parseReview('{"schema": "trivium.review.v1" "verdict": "approve"}')), 'json_syntax');
  const bs = String.fromCharCode(92);
  const r = P.parseReview(`{"a": "x${bs}|y" "b": 1}`);
  assert.equal(failCause(r), 'json_syntax');
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes('还原')), r.errors.join('; '));
});

test('P7 两条合格 + 缺 confidence + severity: medium ⇒ 合格两条进 review、两条降级并逐字段点名', () => {
  const r = P.parseReview(JSON.stringify(review([
    finding('CODEX-01', { severity: 'blocker' }),
    finding('CODEX-02'),
    finding('CODEX-03', {}, ['confidence']),
    finding('CODEX-04', { severity: 'medium' }),
  ])));
  const { ids, degraded } = okParts(r);
  assert.deepEqual(ids, ['CODEX-01', 'CODEX-02']);
  assert.deepEqual(degraded.map((d) => d.id), ['CODEX-03', 'CODEX-04']);
  assert.deepEqual(degraded[0]!.problems.map((p) => [p.field, p.kind]), [['confidence', 'missing']]);
  assert.deepEqual(degraded[1]!.problems.map((p) => [p.field, p.kind]), [['severity', 'invalid']]);
  assert.equal(degraded[1]!.raw['severity'], 'medium', '原值照录');
  assert.deepEqual(
    (degraded as unknown as { index: number }[]).map((d) => d.index), [2, 3], 'index 是原数组下标',
  );
});

test('P7′ 意见多带字段 ⇒ 降级、kind 为 extra', () => {
  const { degraded } = okParts(P.parseReview(JSON.stringify(review([finding('CODEX-02', { evidence_extra: 'x' })]))));
  assert.deepEqual(degraded[0]!.problems.map((p) => [p.field, p.kind]), [['evidence_extra', 'extra']]);
});

test('P8 降级意见编号不可用（缺 id / 形状畸形 / 不是对象）⇒ finding_unaddressable', () => {
  const noId = finding('X', {}, ['id', 'confidence']);
  assert.equal(failCause(P.parseReview(JSON.stringify(review([finding('AGY-01'), noId])))), 'finding_unaddressable');
  assert.equal(failCause(P.parseReview(JSON.stringify(review([finding('AGY-1')])))), 'finding_unaddressable');
  assert.equal(failCause(P.parseReview(JSON.stringify(review([finding('AGY-01'), '一句话意见' as unknown as Loose])))), 'finding_unaddressable');
});

test('P9 回显清单 = 全开分支 renderFrontMatter 的键集 − 审查契约根属性（逐项相等，不许放宽成子集）', () => {
  const RESULT: CriticResult = {
    critic: 'glm', status: 'ok', exit_code: 0, duration_s: 1,
    raw_stdout_path: '/o', trace_path: '/t', review_json: null, raw_response_text: '{}',
    model_effective: 'm', model_effective_source: 'envelope', model_provider: null, profile_requested: null,
    model_route: 'env',
    tool_calls: { read: 1 }, read_paths: [], search_hit_paths: null, write_events: [], command_texts: [],
    evidence_ok: true, fail_reason: null, session_id: 's', cli_version: '1', peer_deny_applied: false,
    deny_skipped: 0, deny_rule_count: 0, deny_bytes: 0, command_line: 'x',
  };
  const base: RenderInput = {
    critic: 'glm', stage: 'plan', topic: 'T', runId: 'R', rerunIndex: 1,
    review: review([finding('GLM-01')]) as unknown as Review, rawText: null, result: RESULT,
    modelRequested: 'm', effort: 'high',
    effortRequested: 'high', effortEffective: null, effortEffectiveSource: null, tier: null, tierSource: 'legacy',
    snapshotHash: 'sha256:x', startedAt: 'a', finishedAt: 'b',
    evidenceOk: true, projectReads: 1, selectedCritics: CRITICS, degraded: false, drift: false, peerDeny: false,
    consultedUnverified: true,
    verification: { readonly: 'unavailable', path: 'unavailable', untrusted: { cause: 'mcp-call', tools: ['mcp__zread__read_file'] } },
    peerLeak: { hit: true, via: 'both', category: 'peer_artifact' as never, voiding: true, paths: ['x'], commands: ['y'] },
    jointCheck: { state: 'skipped-insufficient-sides', effective_sides: 1 },
    access: { requested_mode: 'standard', profile: null, launcher_requested: null, launcher_effective: null,
      wrapper_sha256: null, configuration_sha256: null, provider_declared: null, provider_declared_source: null,
      provider_effective: null, provider_effective_source: null },
    familyComparisons: [],
    heterogeneous: false, overrideReason: 'r',
    degradedFindings: [{ index: 1, id: 'GLM-02', problems: [{ field: 'confidence', kind: 'missing', message: 'm' }], raw: {} }],
    parseRepairs: { stripped_fields: ['topic'], unescaped_backslashes: 1 },
  };
  const keysOf = (i: RenderInput): string[] => {
    const fm = renderFrontMatter(i);
    return fm.split('\n').filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.slice(0, l.indexOf(':')));
  };
  const all = new Set([
    ...keysOf(base),
    ...keysOf({ ...base, review: null, rawText: 'x', parseFallbackCause: 'root_invalid' }),
  ]);
  const rootProps = new Set(Object.keys((reviewSchema as { properties: Loose }).properties));
  const expected = [...all].filter((k) => !rootProps.has(k)).sort();
  assert.ok(expected.includes('findings_degraded') && expected.includes('parse_repairs') && expected.includes('parse_fallback_cause'),
    `前提：全开夹具应覆盖三个新键，实得 ${expected.join(',')}`);
  assert.deepEqual([...P.ECHOED_ORCHESTRATOR_KEYS].sort(), expected);
});

/**
 * P9′ 来源枚举（代码双审 r1 CODEX-02）：P9 的键集来自手写夹具，新加一个由新输入字段控制的条件键而夹具没跟时，
 * P9 仍绿、清单静默少一项。这里改从 `render.ts` 源码里 `renderFrontMatter` 的对象字面量静态枚举：
 * 顶层键固定四格缩进（含简写 `vendor,`），条件展开 `...(cond ? { k: … } : {})`，多行条件对象在十格缩进。
 * 扫描器自己认不出的行（四格缩进、既不是键也不是展开的起头）当场红——防扫描器随源码格式漂移而假绿。
 */
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'src/trivium/render.ts'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('找不到仓库根');
}

test('P9′ 回显清单 = render.ts 源码里 renderFrontMatter 能写出的键 − 审查契约根属性（源码静态枚举）', () => {
  const src = readFileSync(path.join(repoRoot(), 'src/trivium/render.ts'), 'utf8');
  const start = src.indexOf('  const fm: Record<string, unknown> = {\n');
  const end = src.indexOf('\n  };\n', start);
  assert.ok(start > 0 && end > start, '找不到 renderFrontMatter 的对象字面量');
  const body = src.slice(start, end).split('\n').slice(1);
  const keys = new Set<string>();
  const unknown: string[] = [];
  let depth = 0; // 只在顶层（四格缩进）识别起头
  for (const line of body) {
    const t = line.trim();
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    if (/^ {4}\S/.test(line) && depth === 0) {
      let m: RegExpExecArray | null;
      if ((m = /^ {4}([a-z_]+)(?::|,$)/.exec(line))) keys.add(m[1]!);
      else if ((m = /^ {4}\.\.\.\(.*\?\s*\{\s*([a-z_]+):/.exec(line))) keys.add(m[1]!);
      else if (/^ {4}\.\.\.\(/.test(line)) { /* 多行条件对象的起头，键在下面十格缩进 */ }
      else unknown.push(line);
    }
    const m10 = /^ {10}([a-z_]+): \{$/.exec(line);
    if (m10) keys.add(m10[1]!);
  }
  assert.deepEqual(unknown, [], '扫描器认不出的顶层行（源码格式变了就改扫描器，不要放宽断言）');
  const rootProps = new Set(Object.keys((reviewSchema as { properties: Loose }).properties));
  const fromSource = [...keys].filter((k) => !rootProps.has(k)).sort();
  assert.ok(fromSource.length >= 30, `前提：应枚举出三十多个键，实得 ${fromSource.length}`);
  assert.deepEqual([...P.ECHOED_ORCHESTRATOR_KEYS].sort(), fromSource);
});

test('P10① 首候选部分合格、后候选全合格且编号覆盖 ⇒ 取后者', () => {
  const first = review([finding('AGY-01'), finding('AGY-02', {}, ['confidence'])]);
  const second = review([finding('AGY-01'), finding('AGY-02')]);
  const { ids, degraded } = okParts(P.parseReview(`${JSON.stringify(first)}\n${JSON.stringify(second)}`));
  assert.deepEqual(ids, ['AGY-01', 'AGY-02']);
  assert.deepEqual(degraded, []);
});

test('P10② 首候选部分合格、后候选全合格但只是其子集 ⇒ 留前者，合格与降级编号都不丢', () => {
  const first = review([finding('AGY-01'), finding('AGY-02'), finding('AGY-03', {}, ['confidence'])]);
  const second = review([finding('AGY-01')]);
  const { ids, degraded } = okParts(P.parseReview(`${JSON.stringify(first)}\n${JSON.stringify(second)}`));
  assert.deepEqual(ids, ['AGY-01', 'AGY-02']);
  assert.deepEqual(degraded.map((d) => d.id), ['AGY-03']);
});

test('P10③ 首候选根不合、后候选部分合格 ⇒ 取后者', () => {
  const first = review([finding('AGY-01')], { reviewer: 'x' });
  const second = review([finding('AGY-01'), finding('AGY-02', { kind: 'risk' })]);
  const { ids, degraded } = okParts(P.parseReview(`${JSON.stringify(first)}\n${JSON.stringify(second)}`));
  assert.deepEqual(ids, ['AGY-01']);
  assert.deepEqual(degraded.map((d) => d.id), ['AGY-02']);
});

test('P10④〔回归〕两个全合格候选 ⇒ 取前者', () => {
  const first = review([finding('AGY-01')]);
  const second = review([finding('AGY-01'), finding('AGY-02')]);
  const r = P.parseReview(`${JSON.stringify(first)}\n${JSON.stringify(second)}`);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.review.findings.map((f) => f.id), ['AGY-01']);
});

test('P11 没有候选 ⇒ no_json_object；findings 不是数组 ⇒ root_invalid；多候选失败取走得最远那格', () => {
  assert.equal(failCause(P.parseReview('只写了一段小结，没有 JSON。')), 'no_json_object');
  assert.equal(failCause(P.parseReview(JSON.stringify({ ...review([]), findings: {} }))), 'root_invalid');
  // 围栏里是根不合的对象，逐行候选是语法坏的一行 ⇒ 报根不合（走得更远），不报最后那个语法错
  const text = ['```json', JSON.stringify(review([finding('AGY-01')], { reviewer: 'x' })), '```', '{"broken": }'].join('\n');
  const r = P.parseReview(text);
  assert.equal(failCause(r), 'root_invalid');
});

test('P12 checkReviewIntegrity 对降级编号判前缀与撞号；有降级意见时不算「零意见未说明」', () => {
  const rv = review([], { summary: '短', not_covered: [] }) as unknown as Review;
  const d = (id: string, raw: Loose = {}): { id: string; raw: Loose } => ({ id, raw });
  const i1 = P.checkReviewIntegrity(rv, 'gemini', [d('GLM-01')]);
  assert.equal(i1.prefixOk, false);
  assert.deepEqual(i1.badIds, ['GLM-01']);
  const rv2 = review([finding('AGY-01')]) as unknown as Review;
  assert.deepEqual(P.checkReviewIntegrity(rv2, 'gemini', [d('AGY-01')]).duplicateIds, ['AGY-01']);
  assert.equal(P.checkReviewIntegrity(rv, 'gemini', [d('AGY-02')]).emptyWithoutExplanation, false);
  assert.equal(P.checkReviewIntegrity(rv, 'gemini', []).emptyWithoutExplanation, true);
});

test('P12′ 降级意见的 evidence 同样与 consulted 交叉核对（代码双审 r1 GLM-01）', () => {
  const rv = review([finding('AGY-01')]) as unknown as Review; // consulted 只有 src/a.ts
  const i = P.checkReviewIntegrity(rv, 'gemini', [{ id: 'AGY-02', raw: { evidence: '读了 src/zz.ts 与 src/a.ts' } }]);
  assert.deepEqual(i.evidenceNotInConsulted, ['src/zz.ts']);
  // evidence 不是字符串（本身就是不合格的那个字段）时跳过，不抛
  assert.deepEqual(P.checkReviewIntegrity(rv, 'gemini', [{ id: 'AGY-03', raw: { evidence: 42 } }]).evidenceNotInConsulted, []);
});

test('P15 根不合而对象拿得到 ⇒ F 单元按意见逐条出，每条单元含对应意见（代码双审 r1 CODEX-01）', () => {
  const raw = JSON.stringify(review([finding('GLM-01'), finding('GLM-02'), finding('GLM-03')], { reviewer: 'glm' }));
  assert.equal(failCause(P.parseReview(raw)), 'root_invalid');
  const units = P.enumerateFallbackFindings(`前言一句。\n\n\`\`\`json\n${raw}\n\`\`\``, 'glm');
  assert.equal(units.length, 3);
  units.forEach((u, i) => {
    assert.ok(u.startsWith(`GLM-F0${i + 1}: `), u.slice(0, 20));
    assert.ok(u.includes(`"GLM-0${i + 1}"`), '单元正文是那一条意见的原文');
  });
});

test('P15′〔回归〕拿不到对象时照旧按原文段落切', () => {
  const units = P.enumerateFallbackFindings('第一段意见：计划没覆盖并发回滚，需要补偿事务。\n\n第二段意见：命名不一致，建议统一术语与字段名。', 'glm');
  assert.equal(units.length, 2);
  assert.ok(units[0]!.startsWith('GLM-F01: 第一段'));
});

test('P13 修复只随所选候选：首候选部分合格且带修复、后候选全合格无修复且覆盖 ⇒ 取后者、repairs 零值', () => {
  const bs = String.fromCharCode(92);
  const first = JSON.stringify(review([finding('AGY-01', { evidence: 'a PIPE b' }), finding('AGY-02', {}, ['confidence'])], { topic: 'T' }))
    .replace('PIPE', `${bs}|`);
  const second = JSON.stringify(review([finding('AGY-01'), finding('AGY-02')]));
  const { ids, repairs } = okParts(P.parseReview(`${first}\n${second}`));
  assert.deepEqual(ids, ['AGY-01', 'AGY-02']);
  assert.deepEqual(repairs, { stripped_fields: [], unescaped_backslashes: 0 });
});

test('P14 厂商注入字段照剥并如实留痕', () => {
  const { repairs } = okParts(P.parseReview(JSON.stringify(review([finding('AGY-01')], { toolAction: 'x', toolSummary: 'y' }))));
  assert.deepEqual(repairs.stripped_fields, ['toolAction', 'toolSummary']);
});
