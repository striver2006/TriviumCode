/**
 * 第 4 段与第 8 段的交集校验（EV-02，必读交集校验计划 r2 §3.1）。
 *
 * 任务书第 4 段（必读、建议核实、己方历史）与第 8 段（逐侧禁读集）此前各自生成、互不核对，
 * 同一路径可以同时出现在两边：一面要求审查员读它，一面说读了即作废。
 *
 * 本文件守纯函数一层：交集判定（条目写法 × 禁读条目形态 × 类别 × 两个方向）、
 * 第 4 段条目的来源标注、拒跑文案与剔除告警的措辞。调用链（`prepareRun` 的三段、
 * `--start` / 同步路径 / run.json 三个出口、零工件）在 `test/integration/mustread-deny.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  CONTEXT_CONFLICT_MAX_LINES,
  DENY_CATEGORY_LABEL,
  MUST_READ_PRUNED_DISPLAY_MAX,
  MUST_READ_PRUNED_WARNING,
  MUST_READ_SOURCE_LABEL,
  WARNING_MARK,
  buildMustReadList,
  plainWarningText,
  denyContextFor,
  findDenyConflicts,
  renderContextConflicts,
  renderPrunedWarnings,
  type DenyConflict,
  type DenyContext,
  type MustReadSource,
} from '../../src/trivium/brief.js';
import { enumerateDenyPaths } from '../../src/trivium/freeze.js';
import { defaultConfig } from '../../src/trivium/config.js';

const ROOT = '/proj';
const RUNS = '/runs';
const PEER_MD = '.reviews/T/plan/2026-10-02-T-glm.md';
const PEER_JSON = '.reviews/T/plan/_meta/review-glm-20261002T000000Z.json';

/** gemini 侧的一份禁读集：四类各至少一条（形状照 `enumerateDenyPaths` 的返回：项目相对 + 运行根绝对） */
const DENY = [PEER_MD, PEER_JSON, '.trivium', RUNS, '.env', 'config/prod.key'];

const ctx = (over: Partial<DenyContext> = {}): DenyContext => ({
  projectRoot: ROOT,
  triviumDir: path.join(ROOT, '.trivium'),
  runRoot: RUNS,
  critic: 'gemini',
  sensitiveGlobs: defaultConfig().review.sensitive_globs,
  ...over,
});

type Shape = { category: DenyConflict['category']; direction: DenyConflict['direction']; denyEntry: string };
const byDeny = (a: Shape, b: Shape): number => a.denyEntry.localeCompare(b.denyEntry);
/** 只取（类别, 方向, 禁读条目）三元组，按禁读条目排序——断言不依赖遍历次序 */
const shape = (cs: readonly DenyConflict[]): Shape[] =>
  cs.map((c) => ({ category: c.category, direction: c.direction, denyEntry: c.denyEntry })).sort(byDeny);

// ─────────────── findDenyConflicts：under 方向 × 写法 ───────────────

test('under · 作废类：对端审查件按五种写法都判命中，类别 peer-artifact', () => {
  for (const entry of [
    PEER_MD,
    `./${PEER_MD}`,
    `src/../${PEER_MD}`,
    `${ROOT}/${PEER_MD}`,
    `/private${ROOT}/${PEER_MD}`, // macOS 的 /private 前缀与机器判定同口径抹平
  ]) {
    const got = findDenyConflicts(entry, DENY, ctx());
    assert.deepEqual(shape(got), [{ category: 'peer-artifact', direction: 'under', denyEntry: PEER_MD }], entry);
    assert.equal(got[0]!.entry, entry, '报错与告警要按用户的原始写法点名');
  }
});

test('under · 只记一笔类：凭据文件判 sensitive，编排器状态目录及其子路径判 orchestrator-state', () => {
  assert.deepEqual(shape(findDenyConflicts('.env', DENY, ctx())), [
    { category: 'sensitive', direction: 'under', denyEntry: '.env' },
  ]);
  assert.deepEqual(shape(findDenyConflicts('./config/prod.key', DENY, ctx())), [
    { category: 'sensitive', direction: 'under', denyEntry: 'config/prod.key' },
  ]);
  for (const entry of ['.trivium', '.trivium/state.json', `${ROOT}/.trivium/lock/x`]) {
    assert.deepEqual(shape(findDenyConflicts(entry, DENY, ctx())), [
      { category: 'orchestrator-state', direction: 'under', denyEntry: '.trivium' },
    ], entry);
  }
});

test('under · 运行根：对端子树判 peer-run-output，己方子树与运行目录那一层的运行时文件不算', () => {
  assert.deepEqual(shape(findDenyConflicts(`${RUNS}/slot/rid/glm/out/x.json`, DENY, ctx())), [
    { category: 'peer-run-output', direction: 'under', denyEntry: RUNS },
  ]);
  // 段数不足的几层同时含对端子树，按对端判（与 classifyDenyPath 同一保守方向）
  assert.deepEqual(shape(findDenyConflicts(`${RUNS}/slot`, DENY, ctx())), [
    { category: 'peer-run-output', direction: 'under', denyEntry: RUNS },
  ]);
  assert.deepEqual(findDenyConflicts(`${RUNS}/slot/rid/gemini/out/x.json`, DENY, ctx()), [], '己方子树');
  assert.deepEqual(findDenyConflicts(`${RUNS}/slot/rid/request.json`, DENY, ctx()), [], '运行目录那一层的运行时文件');
});

test('under · 具名放行不算：项目配置与 wrapper（含子路径与 ~ 写法）', () => {
  for (const entry of ['.trivium/config.yaml', '.trivium/bin', '.trivium/bin/trivium', `./.trivium/config.yaml`]) {
    assert.deepEqual(findDenyConflicts(entry, DENY, ctx()), [], entry);
  }
  // 计划双审 r1 AGY-03：辅助函数吃的是展开后的绝对路径。项目根在 HOME 之下时，~ 写法同样放行
  const home = os.homedir();
  const proj = path.join(home, 'proj-x');
  const c = ctx({ projectRoot: proj, triviumDir: path.join(proj, '.trivium') });
  assert.deepEqual(findDenyConflicts('~/proj-x/.trivium/config.yaml', ['.trivium'], c), []);
  assert.deepEqual(shape(findDenyConflicts('~/proj-x/.trivium/state.json', ['.trivium'], c)), [
    { category: 'orchestrator-state', direction: 'under', denyEntry: '.trivium' },
  ]);
});

test('under · ~ 写法展开后再判：对端子树命中、己方子树放过', () => {
  const runs = path.join(os.homedir(), '.trivium-t', 'runs');
  const c = ctx({ runRoot: runs });
  const deny = [runs];
  assert.deepEqual(shape(findDenyConflicts('~/.trivium-t/runs/s/r/glm/o', deny, c)), [
    { category: 'peer-run-output', direction: 'under', denyEntry: runs },
  ]);
  assert.deepEqual(findDenyConflicts('~/.trivium-t/runs/s/r/gemini/o', deny, c), [], '己方子树（~ 写法）');
});

test('under · $HOME 与 ${HOME} 写法同样展开（与措施 a / 措施 b 同宽，代码双审 CODEX-02）', () => {
  const runs = path.join(os.homedir(), '.trivium-t', 'runs');
  const c = ctx({ runRoot: runs });
  for (const pre of ['$HOME', '${HOME}']) {
    assert.deepEqual(shape(findDenyConflicts(`${pre}/.trivium-t/runs/s/r/glm/o`, [runs], c)), [
      { category: 'peer-run-output', direction: 'under', denyEntry: runs },
    ], pre);
    assert.deepEqual(findDenyConflicts(`${pre}/.trivium-t/runs/s/r/gemini/o`, [runs], c), [], `${pre}：己方子树`);
    // 裸写家目录 ⇒ 罩住运行根
    assert.deepEqual(shape(findDenyConflicts(pre, [runs], c)), [
      { category: 'peer-run-output', direction: 'contains', denyEntry: runs },
    ], `${pre}（裸写）`);
  }
});

// ─────────────── findDenyConflicts：contains 方向 ───────────────

test('contains：条目是目录、其下有禁读条目——按罩住的那条判类别', () => {
  assert.deepEqual(shape(findDenyConflicts('.reviews/T', DENY, ctx())), ([
    { category: 'peer-artifact', direction: 'contains', denyEntry: PEER_MD },
    { category: 'peer-artifact', direction: 'contains', denyEntry: PEER_JSON },
  ] as Shape[]).sort(byDeny));
  // 项目根罩住项目内的全部禁读条目，不含项目外的运行根
  assert.deepEqual(shape(findDenyConflicts('.', DENY, ctx())), ([
    { category: 'peer-artifact', direction: 'contains', denyEntry: PEER_MD },
    { category: 'peer-artifact', direction: 'contains', denyEntry: PEER_JSON },
    { category: 'orchestrator-state', direction: 'contains', denyEntry: '.trivium' },
    { category: 'sensitive', direction: 'contains', denyEntry: '.env' },
    { category: 'sensitive', direction: 'contains', denyEntry: 'config/prod.key' },
  ] as Shape[]).sort(byDeny));
  // 罩住运行根：按对端处置
  assert.deepEqual(shape(findDenyConflicts('/', [RUNS], ctx())), [
    { category: 'peer-run-output', direction: 'contains', denyEntry: RUNS },
  ]);
  const runs = path.join(os.homedir(), '.trivium-t', 'runs');
  assert.deepEqual(shape(findDenyConflicts('~', [runs], ctx({ runRoot: runs }))), [
    { category: 'peer-run-output', direction: 'contains', denyEntry: runs },
  ]);
});

test('contains · 具名放行不算（计划双审 r1 GLM-02）：宽 glob 把 .trivium/config.yaml 收成独立条目时', () => {
  const deny = ['.trivium', '.trivium/config.yaml', '.trivium/bin/trivium'];
  assert.deepEqual(shape(findDenyConflicts('.trivium', deny, ctx())), [
    { category: 'orchestrator-state', direction: 'under', denyEntry: '.trivium' },
  ]);
  assert.deepEqual(shape(findDenyConflicts('.', deny, ctx())), [
    { category: 'orchestrator-state', direction: 'contains', denyEntry: '.trivium' },
  ]);
});

test('反例：同前缀兄弟与无关路径不算', () => {
  for (const entry of ['.trivium-backup/x', '.reviews2/T', '.reviews/T2', 'src/a.ts', `${RUNS}-old/x`, '.envrc-dir/../src']) {
    assert.deepEqual(findDenyConflicts(entry, DENY, ctx()), [], entry);
  }
});

test('denyContextFor：与第 8 段渲染同一份上下文（运行根展开 ~、编排器目录在项目根下）', () => {
  const cfg = defaultConfig();
  const c = denyContextFor(cfg, ROOT, 'glm');
  assert.equal(c.triviumDir, path.join(ROOT, '.trivium'));
  assert.ok(!c.runRoot.startsWith('~'), c.runRoot);
  assert.equal(c.critic, 'glm');
  assert.deepEqual(c.sensitiveGlobs, cfg.review.sensitive_globs);
});

// ─────────────── 己方历史：非 claude Driver 下的旧裁决件（EV-186 的那一半） ───────────────

test('己方历史：非 claude Driver 下 claude 的旧裁决件在禁读集里，交集判定认得出', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-mrd-')));
  try {
    const stageDir = path.join(root, '.reviews', 'T', 'plan');
    await fs.mkdir(stageDir, { recursive: true });
    const rel = '.reviews/T/plan/2026-10-02-T-revised-claude.md';
    await fs.writeFile(
      path.join(root, rel),
      ['---', 'schema: trivium.disposition.v1', 'topic: T', 'stage: plan', 'role: claude', 'kind: revised', '---', ''].join('\n'),
    );
    const cfg = defaultConfig();
    const c = denyContextFor(cfg, root, 'gemini');
    // 当轮 Driver 是 codex：裁决件中缀 + 非当轮 Driver 后缀 ⇒ indeterminate ⇒ 进禁读集
    const denyCodex = await enumerateDenyPaths(cfg, root, path.join(root, '.reviews'), 'gemini', 'codex', 'T');
    assert.ok(denyCodex.includes(rel), JSON.stringify(denyCodex));
    assert.deepEqual(shape(findDenyConflicts(rel, denyCodex, c)), [
      { category: 'peer-artifact', direction: 'under', denyEntry: rel },
    ]);
    // 当轮 Driver 是 claude：它是 Driver 自己的裁决件，不进禁读集，也就没有交集
    const denyClaude = await enumerateDenyPaths(cfg, root, path.join(root, '.reviews'), 'gemini', 'claude', 'T');
    assert.deepEqual(findDenyConflicts(rel, denyClaude, c), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ─────────────── buildMustReadList：来源标注，行为不变 ───────────────

test('buildMustReadList：三类各带来源；与公约重名的 --context 保留公约来源；不存在的照旧不列', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-mrd-')));
  try {
    await fs.mkdir(path.join(root, 'doc/02_design'), { recursive: true });
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'CLAUDE.md'), 'x');
    await fs.writeFile(path.join(root, 'README.md'), 'x');
    await fs.writeFile(path.join(root, 'doc/02_design/widget-design.md'), 'x');
    await fs.writeFile(path.join(root, 'src/x.ts'), 'x');
    const got = await buildMustReadList(defaultConfig(), root, 'widget', [
      'src/x.ts',
      'CLAUDE.md',
      'src/不存在.ts',
    ]);
    assert.deepEqual(got, [
      { path: 'CLAUDE.md', source: 'convention' },
      { path: 'README.md', source: 'convention' },
      { path: 'doc/02_design/widget-design.md', source: 'keyword' },
      { path: 'src/x.ts', source: 'context' },
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ─────────────── 拒跑文案（64） ───────────────

const conflict = (entry: string, denyEntry: string, category: DenyConflict['category'], direction: DenyConflict['direction'] = 'under'): DenyConflict =>
  ({ entry, denyEntry, category, direction });

test('拒跑文案：按 --context 条目分组，组内逐条点名禁读条目、类别与涉及哪几侧', () => {
  const text = renderContextConflicts([PEER_MD, '.env', 'src/a.ts'], [
    { critic: 'gemini', conflicts: [conflict(PEER_MD, PEER_MD, 'peer-artifact'), conflict('.env', '.env', 'sensitive')] },
    { critic: 'glm', conflicts: [conflict('.env', '.env', 'sensitive')] },
  ]);
  assert.match(text, /^--context 里有路径落在本轮的禁读集里/);
  assert.ok(text.includes(`「${PEER_MD}」\n    落在禁读范围「${PEER_MD}」内 · ${DENY_CATEGORY_LABEL['peer-artifact']} · 涉及 gemini 侧`), text);
  assert.ok(text.includes(`「.env」\n    落在禁读范围「.env」内 · ${DENY_CATEGORY_LABEL.sensitive} · 涉及 gemini、glm 侧`), text);
  assert.ok(!text.includes('src/a.ts'), '没撞上的 --context 条目不列');
  assert.match(text, /出口：从 --context 里去掉这些路径/);
  assert.match(text, /本次没有写任何工件/);
});

test('拒跑文案：contains 方向写「含禁读条目」；超过上限截断并写「另有 N 条」', () => {
  const many = Array.from({ length: CONTEXT_CONFLICT_MAX_LINES + 3 }, (_, i) =>
    conflict('.', `secret-${String(i).padStart(2, '0')}.key`, 'sensitive', 'contains'));
  const text = renderContextConflicts(['.'], [{ critic: 'gemini', conflicts: many }]);
  assert.equal((text.match(/含禁读条目/g) ?? []).length, CONTEXT_CONFLICT_MAX_LINES);
  assert.match(text, /…另有 3 条/);
});

test('拒跑文案：同一路径对不同侧类别不同时分行写（运行目录下某侧子树对该侧是己方材料）', () => {
  const p = `${RUNS}/s/r/glm/out`;
  const text = renderContextConflicts([p], [
    { critic: 'gemini', conflicts: [conflict(p, RUNS, 'peer-run-output')] },
    { critic: 'codex', conflicts: [conflict(p, RUNS, 'peer-run-output')] },
  ]);
  assert.ok(text.includes(`${DENY_CATEGORY_LABEL['peer-run-output']} · 涉及 gemini、codex 侧`), text);
  assert.ok(!text.includes('glm 侧'), '己方材料那一侧不出现');
});

// ─────────────── 剔除告警 ───────────────

const prunedOf = (critic: 'gemini' | 'glm' | 'codex', source: MustReadSource, entry: string, c: DenyConflict) =>
  ({ critic, source, entry, conflicts: [c] });

test('剔除告警：只剔部分侧时点名剔了哪几侧、哪几侧照常列出', () => {
  const ws = renderPrunedWarnings(
    [prunedOf('gemini', 'suggested', PEER_MD, conflict(PEER_MD, PEER_MD, 'peer-artifact'))],
    ['gemini', 'glm'],
  );
  assert.equal(ws.length, 1);
  assert.equal(ws[0]!.name, MUST_READ_PRUNED_WARNING);
  const d = ws[0]!.detail;
  assert.ok(d.startsWith('⚠️ '), d);
  assert.ok(d.includes(`「${PEER_MD}」（来源：建议核实）落在 gemini 侧的禁读集里`), d);
  assert.ok(d.includes(`${DENY_CATEGORY_LABEL['peer-artifact']}；禁读条目「${PEER_MD}」`), d);
  assert.ok(d.includes('已从该侧任务书的第 4 段剔除，glm 侧照常列出'), d);
  assert.ok(!d.includes('写进被审对象'), '不得建议把内容抄进送审材料（凭据类文件会因此外泄）');
});

test('剔除告警（计划双审 r1 AGY-02）：覆盖全部入选侧时写「各侧」，不写「照常列出」；单审核者写「本侧」', () => {
  const both = renderPrunedWarnings(
    [
      prunedOf('gemini', 'convention', 'AGENTS.md', conflict('AGENTS.md', 'AGENTS.md', 'sensitive')),
      prunedOf('glm', 'convention', 'AGENTS.md', conflict('AGENTS.md', 'AGENTS.md', 'sensitive')),
    ],
    ['gemini', 'glm'],
  );
  assert.equal(both.length, 1, '同一条目按侧聚合成一条');
  assert.ok(both[0]!.detail.includes('落在各侧的禁读集里'), both[0]!.detail);
  assert.ok(both[0]!.detail.includes('已从各侧任务书的第 4 段剔除。'), both[0]!.detail);
  assert.ok(!both[0]!.detail.includes('照常列出'), both[0]!.detail);

  const single = renderPrunedWarnings(
    [prunedOf('glm', 'keyword', 'doc/02_design/x.md', conflict('doc/02_design/x.md', 'doc/02_design/x.md', 'sensitive'))],
    ['glm'],
  );
  assert.ok(single[0]!.detail.includes('落在本侧的禁读集里'), single[0]!.detail);
  assert.ok(!single[0]!.detail.includes('照常列出'), single[0]!.detail);
});

test('剔除告警：多侧多类时逐组写明是哪几侧；三侧剔两侧写「这几侧」', () => {
  const ws = renderPrunedWarnings(
    [
      prunedOf('gemini', 'suggested', 'doc/r/T/plan/x-glm.md', conflict('doc/r/T/plan/x-glm.md', 'doc/r/T/plan/x-glm.md', 'peer-artifact')),
      prunedOf('codex', 'suggested', 'doc/r/T/plan/x-glm.md', conflict('doc/r/T/plan/x-glm.md', 'doc/r/T/plan/x-glm.md', 'peer-artifact')),
    ],
    ['codex', 'gemini', 'glm'],
  );
  assert.ok(ws[0]!.detail.includes('落在 codex、gemini 侧的禁读集里'), ws[0]!.detail);
  assert.ok(ws[0]!.detail.includes('已从这几侧任务书的第 4 段剔除，glm 侧照常列出'), ws[0]!.detail);

  const mixed = renderPrunedWarnings(
    [
      prunedOf('gemini', 'own-history', 'h.md', conflict('h.md', 'h.md', 'peer-artifact')),
      prunedOf('glm', 'own-history', 'h.md', conflict('h.md', 'h.md', 'sensitive')),
    ],
    ['gemini', 'glm'],
  );
  assert.ok(mixed[0]!.detail.includes(`gemini 侧：${DENY_CATEGORY_LABEL['peer-artifact']}`), mixed[0]!.detail);
  assert.ok(mixed[0]!.detail.includes(`glm 侧：${DENY_CATEGORY_LABEL.sensitive}`), mixed[0]!.detail);
});

test('剔除告警：四类自动来源各有人读标签；来源标签表穷尽五值', () => {
  const sources: MustReadSource[] = ['convention', 'keyword', 'suggested', 'own-history'];
  for (const s of sources) {
    const ws = renderPrunedWarnings([prunedOf('gemini', s, 'a.md', conflict('a.md', 'a.md', 'sensitive'))], ['gemini', 'glm']);
    assert.ok(ws[0]!.detail.includes(`（来源：${MUST_READ_SOURCE_LABEL[s]}）`), `${s}：${ws[0]!.detail}`);
  }
  assert.deepEqual(Object.keys(MUST_READ_SOURCE_LABEL).sort(), ['context', 'convention', 'keyword', 'own-history', 'suggested']);
  // 同名条目来源不同时不合并（公约与建议核实各一条）
  const two = renderPrunedWarnings(
    [
      prunedOf('gemini', 'convention', 'a.md', conflict('a.md', 'a.md', 'sensitive')),
      prunedOf('gemini', 'suggested', 'a.md', conflict('a.md', 'a.md', 'sensitive')),
    ],
    ['gemini', 'glm'],
  );
  assert.equal(two.length, 2);
  assert.deepEqual(renderPrunedWarnings([], ['gemini', 'glm']), []);
});

test('剔除告警封顶（代码双审 CODEX-06）：给了上限时前 max-1 条照旧、其余并成一条点名汇总；不给上限时全量', () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => prunedOf('gemini', 'own-history', `h${i}.md`, conflict(`h${i}.md`, `h${i}.md`, 'peer-artifact')));
  const many = mk(8);
  const full = renderPrunedWarnings(many, ['gemini', 'glm']);
  assert.equal(full.length, 8, '不给上限：全量（run.json 用）');
  const capped = renderPrunedWarnings(many, ['gemini', 'glm'], MUST_READ_PRUNED_DISPLAY_MAX);
  assert.equal(capped.length, MUST_READ_PRUNED_DISPLAY_MAX);
  assert.deepEqual(capped.slice(0, MUST_READ_PRUNED_DISPLAY_MAX - 1), full.slice(0, MUST_READ_PRUNED_DISPLAY_MAX - 1), '前 max-1 条与全量逐字相同');
  const last = capped[MUST_READ_PRUNED_DISPLAY_MAX - 1]!;
  assert.equal(last.name, MUST_READ_PRUNED_WARNING);
  assert.ok(last.detail.startsWith(WARNING_MARK), last.detail);
  assert.ok(last.detail.includes('另有 4 条'), last.detail);
  for (const i of [4, 5, 6, 7]) assert.ok(last.detail.includes(`「h${i}.md」`), last.detail);
  assert.ok(last.detail.includes('gate.warnings'), '要指明全量在哪儿');
  // 恰好等于上限时不并
  assert.equal(renderPrunedWarnings(mk(MUST_READ_PRUNED_DISPLAY_MAX), ['gemini', 'glm'], MUST_READ_PRUNED_DISPLAY_MAX).length, MUST_READ_PRUNED_DISPLAY_MAX);
  // 汇总里点名有上限，其余写「等」
  const lots = renderPrunedWarnings(mk(30), ['gemini', 'glm'], MUST_READ_PRUNED_DISPLAY_MAX);
  const sum = lots[lots.length - 1]!.detail;
  assert.ok(sum.includes('另有 26 条'), sum);
  assert.equal((sum.match(/「/g) ?? []).length, 10, sum);
  assert.ok(sum.includes('等（'), sum);
});

test('字符串通道去掉 ⚠️ 前缀：warn() 打印时自带一个，run.json gate.warnings 的既有条目都不带', () => {
  const [w] = renderPrunedWarnings([prunedOf('gemini', 'suggested', 'a.md', conflict('a.md', 'a.md', 'sensitive'))], ['gemini']);
  assert.ok(w!.detail.startsWith(WARNING_MARK));
  assert.equal(plainWarningText(w!.detail), w!.detail.slice(WARNING_MARK.length));
  assert.equal(plainWarningText('没有前缀的句子'), '没有前缀的句子');
});
