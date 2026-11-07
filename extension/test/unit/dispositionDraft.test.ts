/**
 * 裁决草稿单测（r2 计划 D9）：front-matter 七字段逐项、表头对拍 agy适配1.5.2
 * 真实件（字符级）、单元格安全化、文件名（本地日期/rN/kind/driver）、
 * 起草 wx / EEXIST / 修复写回 hash 防护、现有件解析。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDisposition, renderRepaired, renderFrontMatter, draftFileName, safeCell, normalizeVerdict, parseDispositionDoc, saveDraft, dispositionKindForStage, type DraftFs } from '../../src/disposition/dispositionDraft';

test('front-matter 七字段逐项（对齐 disposition.v1 schema；任务书「五字段」为笔误）', () => {
  const text = renderDisposition({
    topic: 'agy适配1.5.2',
    stage: 'code',
    runId: '20261106T172504Z',
    driver: 'glm',
    addresses: ['2026-11-07-agy适配1.5.2-claude.md', '2026-11-07-agy适配1.5.2-codex.md'],
    rows: [
      { id: 'CLAUDE-01', critic: 'claude', severity: 'minor', verdict: '接受', reason: '核实成立', action: '补两用例直触 pathCoverage' },
    ],
        titleNote: '代码审应答',
  });
  const lines = text.split('\n');
  assert.equal(lines[0], '---');
  assert.ok(lines.includes('schema: trivium.disposition.v1'));
  assert.ok(lines.includes('topic: agy适配1.5.2'));
  assert.ok(lines.includes('stage: code'));
  assert.ok(lines.includes('role: glm'));
  assert.ok(lines.includes('kind: response'));
  assert.ok(lines.includes('run_id: 20261106T172504Z'));
  assert.ok(lines.includes('addresses:'));
  assert.ok(lines.includes('  - 2026-11-07-agy适配1.5.2-claude.md'));
  assert.ok(lines.includes('  - 2026-11-07-agy适配1.5.2-codex.md'));
});

test('表头字符级对拍真实件：code「修改计划」/ plan「落点」', () => {
  const code = renderDisposition({ topic: 't', stage: 'code', runId: 'r', driver: 'glm', addresses: ['a.md'], rows: [], titleNote: 'x' });
  assert.ok(code.includes('| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |'));
  const plan = renderDisposition({ topic: 't', stage: 'plan', runId: 'r', driver: 'glm', addresses: ['a.md'], rows: [], titleNote: 'x' });
  assert.ok(plan.includes('| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |'));
  assert.ok(code.includes('| :--- | :--- | :--- | :--- | :--- | :--- |'));
});

test('单元格安全化：竖线与换行；— 占位', () => {
  assert.equal(safeCell('a|b'), 'a｜b');
  assert.equal(safeCell('两行\n文本'), '两行 文本');
});

test('裁决词归一（disposition.ts 同义集）', () => {
  assert.equal(normalizeVerdict('采纳'), '接受');
  assert.equal(normalizeVerdict('同意'), '接受');
  assert.equal(normalizeVerdict('不接受'), '驳回');
  assert.equal(normalizeVerdict('否决。'), '驳回');
  assert.equal(normalizeVerdict('搁置'), '暂缓');
  assert.equal(normalizeVerdict('部分接受'), null);
});

test('文件名：本地日期 + rN 中缀（rerun>1）+ kind + driver', () => {
  const now = new Date(2026, 10, 7, 23, 59); // 2026-11-07 本地
  assert.equal(draftFileName({ topic: 'T', rerunIndex: 1, stage: 'plan', driver: 'glm', now }), '2026-11-07-T-revised-glm.md');
  assert.equal(draftFileName({ topic: 'T', rerunIndex: 2, stage: 'code', driver: 'glm', now }), '2026-11-07-T-r2-response-glm.md');
  assert.equal(draftFileName({ topic: 'T', rerunIndex: null, stage: 'bug', driver: 'codex', now }), '2026-11-07-T-revised-codex.md');
  assert.equal(dispositionKindForStage('code'), 'response');
  assert.equal(dispositionKindForStage('plan'), 'revised');
});

test('现有件解析：front-matter + 表格行（修复模式预填）', () => {
  // 取 agy适配1.5.2 code response 件的真实形态骨架
  const doc = [
    '---',
    'schema: trivium.disposition.v1',
    'topic: agy适配1.5.2',
    'stage: code',
    'role: glm',
    'kind: response',
    'run_id: 20261106T172504Z',
    'addresses:',
    '  - 2026-11-07-agy适配1.5.2-claude.md',
    '  - 2026-11-07-agy适配1.5.2-codex.md',
    '---',
    '',
    '# 代码审第 1/5 轮应答（Driver：glm）',
    '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| CLAUDE-01 | claude | minor | 接受 | 核实成立：漏登时静默降档 | 补两用例 |',
    '| CODEX-01 | codex | minor | 接受 | 核实成立 | 已实施 |',
    '',
  ].join('\n');
  const parsed = parseDispositionDoc(doc);
  assert.equal(parsed.frontMatter['role'], 'glm');
  assert.deepEqual(parsed.frontMatter['addresses'], ['2026-11-07-agy适配1.5.2-claude.md', '2026-11-07-agy适配1.5.2-codex.md']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]!.id, 'CLAUDE-01');
  assert.equal(parsed.rows[0]!.verdict, '接受');
  assert.equal(parsed.rows[0]!.reason, '核实成立：漏登时静默降档');
  assert.equal(parsed.rows[0]!.action, '补两用例');
});

function memFs(existing: Record<string, string> = {}): DraftFs & { files: Map<string, string> } {
  const files = new Map(Object.entries(existing));
  return {
    files,
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return v;
    },
    async createExclusive(p, text) {
      if (files.has(p)) return false;
      files.set(p, text);
      return true;
    },
    async replaceExclusive(p, text) {
      files.set(p, text);
    },
  };
}

test('落盘：起草独占创建成功', async () => {
  const fs = memFs();
  const r = await saveDraft(fs, '/x/a.md', '内容', { kind: 'create' });
  assert.equal(r.ok, true);
  assert.equal(fs.files.get('/x/a.md'), '内容');
});

test('落盘：EEXIST 不抬升、如实报错转修复（CLAUDE-09/AGY-02）', async () => {
  const fs = memFs({ '/x/a.md': '旧内容' });
  const r = await saveDraft(fs, '/x/a.md', '新内容', { kind: 'create' });
  assert.equal(r.ok, false);
  assert.equal((r as { error: string }).error, 'exists');
  assert.equal(fs.files.get('/x/a.md'), '旧内容', '绝不覆盖');
});

test('落盘：修复写回 hash 防护——载入后被外部改动即拒写', async () => {
  const fs = memFs({ '/x/a.md': '载入时内容' });
  fs.files.set('/x/a.md', '外部已改'); // 模拟并发
  const r = await saveDraft(fs, '/x/a.md', '新内容', { kind: 'replace', loadedText: '载入时内容' });
  assert.equal(r.ok, false);
  assert.equal((r as { error: string }).error, 'conflict');
  assert.equal(fs.files.get('/x/a.md'), '外部已改', '不覆盖他人改动');
});

test('落盘：修复写回一致时原子替换成功', async () => {
  const fs = memFs({ '/x/a.md': '同内容' });
  const r = await saveDraft(fs, '/x/a.md', '新草稿', { kind: 'replace', loadedText: '同内容' });
  assert.equal(r.ok, true);
  assert.equal(fs.files.get('/x/a.md'), '新草稿');
});

test('行级落点：fallback 行可选、结构化行接受必填的模型数据', () => {
  // 模型层的 requireAction 在 gateGapModel；此处断言渲染端 fallback 行 action 空 → 「—」
  const text = renderDisposition({
    topic: 't', stage: 'code', runId: 'r', driver: 'glm', addresses: ['a.md'],
    rows: [{ id: 'AGY-F01', critic: 'gemini', severity: null, verdict: '接受', reason: 'r', action: null }],
    titleNote: 'x',
  });
  assert.ok(text.includes('| AGY-F01 | gemini | — | 接受 | r | — |'));
});

// ── 代码审 r1 修复回归（CLAUDE-04/10/11/12、AGY-06、CODEX-08）──

test('front-matter 走 yaml 序列化：方括号/引号/冒号类合法主题名不破坏契约（CLAUDE-10）', () => {
  for (const topic of ['[abc]主题', '带"引号"的主题', '冒号:主题', '正常主题']) {
    const text = renderDisposition({ topic, stage: 'code', runId: 'r', driver: 'glm', addresses: ['a.md'], rows: [], titleNote: 'x' });
    const fm = text.split('---')[1]!;
    const parsed = parseYaml(fm);
    assert.equal(parsed['topic'], topic, `主题「${topic}」往返不失真`);
    assert.equal(parsed['schema'], 'trivium.disposition.v1');
  }
  function parseYaml(block: string): Record<string, unknown> {
    // 直接复用被测模块同款 yaml 库做往返（契约层以编排器 YAML.parse 为准）
    const YAML = require('yaml');
    return YAML.parse(block) as Record<string, unknown>;
  }
});

test('原文手术：修复只改目标行，表外正文与合法行原样保留（CLAUDE-04/CODEX-08）', () => {
  const doc = [
    '---',
    'schema: trivium.disposition.v1',
    'topic: T',
    'stage: code',
    'role: glm',
    'kind: response',
    'run_id: r1',
    'addresses:',
    '  - a-claude.md',
    '---',
    '',
    '# 代码审第 1/5 轮应答（Driver：glm）',
    '',
    '本件由人工撰写：这一段表外正文（含修订说明、承诺等）**不得**因插件修复而丢失。',
    '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| CLAUDE-01 | claude | major | 接受 |  | 补两用例 |',
    '| CLAUDE-02 | claude | minor | 驳回 | 不成立 | — |',
    '| CLAUDE-03 | codex | nit | 接受 | 成立 | 已实施 |',
    '',
    '（表尾附注也不得丢失）',
    '',
  ].join('\n');
  const parsed = parseDispositionDoc(doc);
  assert.ok(parsed.surgery, '应解析出手术面');
  const out = renderRepaired(parsed, {
    replaceRows: new Map([['CLAUDE-01', { verdict: '接受', reason: '核实成立，补齐理由', action: '补两用例' }]]),
    removeIds: new Set(['CLAUDE-03']), // unknown：删除
    appendLines: ['| CODEX-09 | codex | minor | 接受 | 新增行理由 | 新增落点 |'],
    newFrontMatter: null,
    newHeaderLines: null,
  });
  // 表外正文与表尾附注原样保留
  assert.ok(out.includes('本件由人工撰写：这一段表外正文（含修订说明、承诺等）**不得**因插件修复而丢失。'));
  assert.ok(out.includes('（表尾附注也不得丢失）'));
  // 修复行替换、删除行消失、新增行追加、合法行原样
  assert.ok(out.includes('| CLAUDE-01 | claude | major | 接受 | 核实成立，补齐理由 | 补两用例 |'), '被修复行按原列结构更新（id/来源/严重度/落点列原样，裁决/理由列替换）');
  assert.ok(!out.includes('CLAUDE-03'), '删除行不再出现');
  assert.ok(out.includes('| CLAUDE-02 | claude | minor | 驳回 | 不成立 | — |'), '合法行原样保留（含 — 占位）');
  assert.ok(out.includes('| CODEX-09 | codex | minor | 接受 | 新增行理由 | 新增落点 |'));
  // front-matter 未重建时原样保留
  assert.ok(out.includes('run_id: r1'));
});

test('front-matter 重建（bad_front_matter）：替换首对 --- 之间，正文不动', () => {
  const doc = ['---', '坏掉的: front-matter', '---', '', '| 意见编号 | 裁决 | 理由 |', '| :--- | :--- | :--- |', '| CLAUDE-01 | 接受 | x |', ''].join('\n');
  const parsed = parseDispositionDoc(doc);
  const out = renderRepaired(parsed, {
    replaceRows: new Map(), removeIds: new Set(), appendLines: [],
    newFrontMatter: renderFrontMatter({ topic: 'T', stage: 'code', runId: 'r2', driver: 'glm', addresses: ['a-claude.md'] }),
    newHeaderLines: null,
  });
  assert.ok(out.startsWith('---\nschema: trivium.disposition.v1'));
  assert.ok(!out.includes('坏掉的'));
  assert.ok(out.includes('| CLAUDE-01 | 接受 | x |'));
});

test('addresses 空数组渲染为显式 []（AGY-06；空值会被宿主校验拦截，此处为兜底形态）', () => {
  const fm = renderFrontMatter({ topic: 'T', stage: 'plan', runId: 'r', driver: 'glm', addresses: [] });
  assert.ok(fm.includes('addresses: []'), fm);
});

test('r4 CLAUDE-02：unparsable 表头 + unknown 组合——先删后换表头，不误删合法行', () => {
  const doc = [
    '---',
    'schema: trivium.disposition.v1',
    'topic: T',
    'stage: code',
    'role: glm',
    'kind: response',
    'run_id: r1',
    'addresses:',
    '  - a-claude.md',
    '---',
    '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| CLAUDE-01 | claude | major | 接受 | 成立 | 已修 |',
    '| CLAUDE-02 | claude | minor | 驳回 | 不成立 | — |',
    '| GLM-99 | glm | nit | 接受 | 多余 | — |',
    '',
  ].join('\n');
  const parsed = parseDispositionDoc(doc);
  const out = renderRepaired(parsed, {
    replaceRows: new Map(),
    removeIds: new Set(['GLM-99']),
    appendLines: [],
    newFrontMatter: null,
    newHeaderLines: ['| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |', '| :--- | :--- | :--- | :--- | :--- | :--- |'],
  });
  assert.ok(!out.includes('GLM-99'), 'unknown 行删除');
  assert.ok(out.includes('| CLAUDE-01 | claude | major | 接受 | 成立 | 已修 |'), '合法行 1 原样');
  assert.ok(out.includes('| CLAUDE-02 | claude | minor | 驳回 | 不成立 | — |'), '合法行 2 原样（不因表头替换错位误删）');
  const again = parseDispositionDoc(out);
  assert.equal(again.rows.length, 2);
});

test('r4 CODEX-03：追加行按已知行锚定——编号列不在第一列也能插对位置', () => {
  // 合法三列表：编号在第 2 列（gate 的表头同义词认得），普通对齐行
  const doc = [
    '---',
    'schema: trivium.disposition.v1',
    'topic: T',
    'stage: ' + 'code',
    'role: glm',
    'kind: response',
    'run_id: r1',
    'addresses:',
    '  - a-claude.md',
    '---',
    '',
    '| 来源 | 意见编号 | 裁决 | 理由 |',
    '| --- | --- | --- | --- |',
    '| claude | CLAUDE-01 | 接受 | 成立 |',
    '',
  ].join('\n');
  const parsed = parseDispositionDoc(doc);
  assert.ok(parsed.surgery, '三列表头应可识别（id 在第 2 列）');
  const out = renderRepaired(parsed, {
    replaceRows: new Map(),
    removeIds: new Set(),
    appendLines: ['| claude | CLAUDE-02 | 驳回 | 不成立 |'],
    newFrontMatter: null,
    newHeaderLines: null,
  });
  const at1 = out.indexOf('| claude | CLAUDE-01 | 接受 | 成立 |');
  const at2 = out.indexOf('| claude | CLAUDE-02 | 驳回 | 不成立 |');
  assert.ok(at1 >= 0 && at2 > at1, '新行插在既有数据行之后（不进 front-matter）');
});
