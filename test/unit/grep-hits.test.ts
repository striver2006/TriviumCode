/**
 * Grep 命中计入读取面（EV-76 出路 ①）：解析、分档、归一化、回放。
 *
 * 夹具是**真跑输出的截取**（`test/fixtures/claude-events/README.md`「Grep 两份」一节）：
 * 根前缀改写成 `<ROOT>`，加载时换成本文件的 `FAKE_ROOT`。两种形态都锁——
 * 生产 9/9 次 Grep 传绝对 `path`，探针实测传相对 `path`（计划双审 CODEX-03 / GLM-04）。
 *
 * 变异验证（2026-09-19 实跑，`node scripts/build.mjs --with-tests` 后单跑本文件）：
 *   - `GREP_CONTENT_LINE` 改成永不匹配 → T1a / T1b / T2 / T3 / T7 / T8 / T10 七条红；
 *   - `toProjectRelative` 的 `isUnder` 退化成裸 `startsWith` → T11 红（`/repository` 被切成 `../repository/…`）。
 * 与修订计划 §2.7「T1 / T7 / T10 / T11 各做一次」的映射（代码双审 CODEX-04）：第一次变异同时覆盖 T1、T7、T10
 * （三条都依赖 content 行解析），第二次覆盖 T11；两次合并覆盖计划的四条，不是漏做两条。
 *   - 第三次（本轮代码双审后补）：删掉 guard.ts 措施 a 里的 `search_hit_paths` 并集 → T12 红；
 *     `toLogicalForm` 退化成原样透传 → T13 红。
 * 注意 `npm run build` 只打 bundle，不重编 `dist/test`——单跑用例前要带 `--with-tests`，否则测的是旧产物。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { REPO_ROOT } from '../helpers/fixture.js';
import {
  countTools,
  grepHitPaths,
  parseClaudeEvents,
  parseGrepResults,
  readPaths,
} from '../../src/trivium/adapters/claude-trace.js';
import { buildClaudeResult } from '../../src/trivium/adapters/claude.js';
import { failedResult, toProjectRelative, TOOL_TRACE_CAPABILITY } from '../../src/trivium/adapters/base.js';
import { judgeSide, matchConsulted } from '../../src/trivium/guard.js';
import { TRIVIUM_DIR, defaultConfig } from '../../src/trivium/config.js';
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';
import { readonlyToolsFromProbe } from '../../src/trivium/adapters/claude.js';
import type { CriticRequest, CriticResult, Review } from '../../src/trivium/types.js';

import { IS_WIN } from '../helpers/platform.js';

// Windows 移植：win32 的 path.isAbsolute 不认 '/proj' 这类盘相对形态；引号串里的 POSIX 绝对路径统一补 ${ABS} 盘符根（macOS 上为空串，字面不变）
const ABS = IS_WIN ? 'D:' : '';

const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/claude-events');
const FAKE_ROOT = `${ABS}/proj/m9-acceptance`;

async function loadTrace(name: string, root = FAKE_ROOT) {
  const raw = await fs.readFile(path.join(FIXTURES, name), 'utf8');
  return parseClaudeEvents(raw.split('<ROOT>').join(root));
}

/** 第 2 跑（run 20260919T120643Z）审查员自报的 15 项 consulted，逐字 */
const CONSULTED_RUN2 = [
  '.reviews/M9-验收-3812f4c/code/_meta/changes-20260919T120643Z.diff',
  'src/trivium/adapters/base.ts',
  'src/trivium/preflight.ts',
  'src/trivium/adapters/codex.ts',
  'src/trivium/critics.ts',
  'src/trivium/guard.ts',
  'src/trivium/review.ts',
  'src/trivium/agents/registry.ts',
  'test/unit/preflight.test.ts',
  'test/unit/codex-write-verbs.test.ts',
  'CLAUDE.md',
  'AGENTS.md',
  'doc/03_api/PROTOCOL_dual_critic_relay.md',
  'doc/05_testing/CASE_manual_acceptance.md',
  'doc/02_design/LLD_orchestrator.md',
];
/** 其中只在目录级 Grep 结果里出现过的 5 项——修前 J5 落 10/15 的那 5 项 */
const GREP_ONLY_RUN2 = [
  'test/unit/preflight.test.ts',
  'test/unit/codex-write-verbs.test.ts',
  'doc/03_api/PROTOCOL_dual_critic_relay.md',
  'doc/05_testing/CASE_manual_acceptance.md',
  'doc/02_design/LLD_orchestrator.md',
];

// ── T1：两种形态 × 三种模式 ────────────────────────────────────────────

test('T1a 相对 path 形态：content 进 hits，count / files_with_matches 进 listed，文件级 Grep 不产路径', async () => {
  const t = await loadTrace('grep-three-modes-relative-path.jsonl');
  assert.equal(t.init?.cwd, FAKE_ROOT, 'init.cwd 必须被采集（计划双审 CODEX-04）');
  const g = parseGrepResults(t, null);
  // files_with_matches 5 个 + count 5 个，同一集合
  const five = ['cli.ts', 'critics.ts', 'review.ts', 'topic-args.ts', 'types.ts'].map((f) => `${FAKE_ROOT}/src/trivium/${f}`);
  assert.deepEqual([...g.listed].sort(), [...five].sort());
  // content（head_limit 3）：命中哪几个文件取决于 ripgrep 的遍历顺序，不锁具体文件；
  // 锁的是形态——非空、全在 src/trivium/ 下、且 ⊆ files_with_matches 列出的那 5 个
  assert.ok(g.hits.length >= 1 && g.hits.length <= 3, `head_limit 3 最多 3 行，实得 ${g.hits.length} 个文件`);
  for (const h of g.hits) assert.ok(five.includes(h), `content 命中 ${h} 不在 files_with_matches 的集合里——路径基准或解析出错`);
  assert.ok(g.resultLines > 10, '原始行数含噪声行，作漂移诊断');
  // 文件级 Grep（path=critics.ts，content）输出是「行号:文本」，不得提出任何路径
  const fileLevel = t.toolUses.filter((u) => u.name === 'Grep' && String(u.input['path']).endsWith('critics.ts'));
  assert.equal(fileLevel.length, 1);
  assert.ok(!g.hits.some((h) => h.endsWith('critics.ts')), '文件级 Grep 的命中归入参路径（readPaths 已计），不重复计');
});

test('T1b 绝对 path 形态（生产形态）：content 命中相对 cwd 而非相对 path 参数', async () => {
  const t = await loadTrace('grep-content-absolute-path.jsonl');
  const g = parseGrepResults(t, null);
  assert.ok(g.hits.length >= 30, `目录级 content Grep 应命中数十个文件，实得 ${g.hits.length}`);
  for (const h of g.hits) assert.ok(h.startsWith(`${FAKE_ROOT}/`), `命中必须落在项目根下：${h}`);
  // path=<ROOT>/src 的命中写作 src/…（相对 cwd），不是 trivium/…（相对 path）
  assert.ok(g.hits.includes(`${FAKE_ROOT}/src/trivium/preflight.ts`));
  assert.deepEqual(g.listed, [], '生产 9/9 次都是 content 模式，listed 应为空');
});

// ── T2 / T3：守卫与配对 ───────────────────────────────────────────────

test('T2 守卫：数字开头、含空白、无 / 无 . 的行不当路径；噪声行不计', () => {
  const lines = [
    '[Showing results with pagination = limit: 3]',
    'Found 3 files',
    '7:  const t = a ? 1:2:3',      // 文件级 content 行里的文本——数字开头
    'src/a b.ts:1:x',               // 含空白
    'Dockerfile:3:FROM node',       // 无 / 无 .——已知假阴性
    'src/ok.ts:12:hit',
  ].join('\n');
  const t = parseClaudeEvents(
    [
      JSON.stringify({ type: 'system', subtype: 'init', cwd: FAKE_ROOT, tools: ['Grep'], model: 'm' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'x', path: FAKE_ROOT, output_mode: 'content' } }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'g1', content: lines }] } }),
    ].join('\n'),
  );
  const g = parseGrepResults(t, null);
  assert.deepEqual(g.hits, [`${FAKE_ROOT}/src/ok.ts`]);
  assert.equal(g.resultLines, 6, '非空行全计，噪声行也算——漂移诊断要看总量');
});

test('T3 配对：is_error 的 Grep 结果不计；无 id 的 tool_use 不计；数组形态的 content 也能读', () => {
  const t = parseClaudeEvents(
    [
      JSON.stringify({ type: 'system', subtype: 'init', cwd: FAKE_ROOT, tools: ['Grep'], model: 'm' }),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'x', output_mode: 'content' } },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'x', output_mode: 'content' } },
        { type: 'tool_use', id: 'g3', name: 'Grep', input: { pattern: 'x', output_mode: 'content' } },
      ] } }),
      JSON.stringify({ type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'g1', is_error: true, content: 'src/err.ts:1:x' },
        { type: 'tool_result', tool_use_id: 'g3', content: [{ type: 'text', text: 'src/arr.ts:1:x' }] },
      ] } }),
    ].join('\n'),
  );
  assert.deepEqual(grepHitPaths(t, null), [`${FAKE_ROOT}/src/arr.ts`]);
});

// ── T7：回放第 2 跑 ───────────────────────────────────────────────────

const REQ: CriticRequest = {
  critic: 'claude',
  stage: 'code',
  model: 'm',
  timeout_s: 60,
  min_tool_calls: 5,
  min_project_reads: 3,
  subject_path: `${FAKE_ROOT}/.reviews/M9-验收-3812f4c/code/_meta/changes-20260919T120643Z.diff`,
  brief_path: `${FAKE_ROOT}/.reviews/M9-验收-3812f4c/code/_meta/brief-claude-R1.md`,
  project_root: FAKE_ROOT,
  deny_paths: [],
  out_dir: '/runs/out',
  brief_text: '',
} as unknown as CriticRequest;

function sideResult(trace: ReturnType<typeof parseClaudeEvents>, over: Partial<CriticResult> = {}): CriticResult {
  const built = buildClaudeResult(
    trace,
    { exitCode: 0, durationMs: 1000, commandLine: 'claude -p …' },
    { stdout: '/run/stdout.jsonl', trace: '/run/trace.json' },
    { version: '2.1.277', path_deny: { file_shape_verified: true } },
    readonlyToolsFromProbe(READONLY_INVARIANTS),
    { ruleCount: 0, skipped: [], bytes: 0 },
    { fallbackRoot: FAKE_ROOT },
  );
  return { ...built, ...over };
}

function judge(
  result: CriticResult,
  review: Review | null,
  over: { req?: Partial<CriticRequest>; projectRoots?: readonly string[] } = {},
) {
  return judgeSide(defaultConfig(), 'claude', result, review, { ...REQ, ...over.req } as CriticRequest, {
    degraded: [],
    archiveRootAbs: `${FAKE_ROOT}/.reviews`,
    projectRoot: FAKE_ROOT,
    ...(over.projectRoots ? { projectRoots: over.projectRoots } : {}),
    triviumDir: `${FAKE_ROOT}/${TRIVIUM_DIR}`,
    runRoot: '/runs',
    capability: TOOL_TRACE_CAPABILITY,
  });
}

test('T7 回放第 2 跑：Grep 命中恰好补上那 5 项，consulted 15/15，布尔位翻回 false', async () => {
  const t = await loadTrace('grep-content-absolute-path.jsonl');
  assert.equal(t.toolUses.length, 24, '夹具是那 24 条 tool_use 的截取');
  const reads = readPaths(t);
  const hits = grepHitPaths(t, FAKE_ROOT);
  for (const f of GREP_ONLY_RUN2) {
    assert.ok(hits.includes(`${FAKE_ROOT}/${f}`), `目录级 Grep 命中必须含 ${f}`);
    assert.ok(!reads.includes(`${FAKE_ROOT}/${f}`), `${f} 只经 Grep 结果见过，不该在 readPaths 里`);
  }
  const r = sideResult(t);
  // 集合断言：15 项逐条在归一化后的匹配集里（不是只看 80% 布尔位）
  const m = matchConsulted(CONSULTED_RUN2, [...r.read_paths, ...(r.search_hit_paths ?? [])], [FAKE_ROOT]);
  assert.deepEqual(m.missing, [], `仍未匹配：${m.missing.join('、')}`);
  assert.equal(m.matched.length, 15);
  // 修前口径（不并 search_hit_paths）恰是 10/15——锁住「修的就是这 5 项」
  const before = matchConsulted(CONSULTED_RUN2, r.read_paths, [FAKE_ROOT]);
  assert.equal(before.matched.length, 10);
  const review = { consulted: CONSULTED_RUN2, findings: [], summary: 'x', not_covered: [] } as unknown as Review;
  assert.equal(judge(r, review).consultedUnverified, false);
  assert.equal(judge({ ...r, search_hit_paths: null }, review).consultedUnverified, true, '不并命中即回到修前的 J5 失败');
});

// ── T8 / T9：不进 project_reads；三态 ─────────────────────────────────

test('T8 search_hit_paths 不进 project_reads——证据档口径不动（变异守卫）', async () => {
  const t = await loadTrace('grep-content-absolute-path.jsonl');
  const r = sideResult(t);
  const withHits = judge(r, null).projectReads;
  const without = judge({ ...r, search_hit_paths: null }, null).projectReads;
  assert.equal(withHits, without, '把 hits 并进 read_paths 会让这条红');
  assert.ok((r.search_hit_paths ?? []).length > 30, '前提：本夹具确实有几十条命中');
});

test('T9 三态：失败出口写 null，claude 成功出口写数组（可为空）', async () => {
  const f = failedResult('claude', { reason: 'x', exitCode: 1, durationMs: 1, commandLine: 'c' } as never);
  assert.equal(f.search_hit_paths, null);
  const t = await loadTrace('read-sentinel.jsonl');
  assert.deepEqual(sideResult(t).search_hit_paths, [], '无 Grep 的轨迹是空数组，不是 null');
  assert.ok(countTools(t).read! >= 1);
});

// ── T10：夹具兜底扫描的输出腿 ─────────────────────────────────────────

test('T10 兜底：凡 grep-*.jsonl 夹具，content 命中或 listed 至少一条非空——格式漂移在构建期打红', async () => {
  const names = (await fs.readdir(FIXTURES)).filter((n) => n.startsWith('grep-') && n.endsWith('.jsonl'));
  assert.ok(names.length >= 2, '两种形态的样本都要在');
  for (const n of names) {
    const g = parseGrepResults(await loadTrace(n), FAKE_ROOT);
    assert.ok(g.resultLines > 0, `${n}：没有任何结果行`);
    assert.ok(g.hits.length + g.listed.length > 0, `${n}：结果行 ${g.resultLines} 条却一条都没解析出——格式漂移了（设计 §3.7 Grep 格式行）`);
  }
});

// ── T11：归一化 ───────────────────────────────────────────────────────

test(`T11 toProjectRelative：/tmp 与 ${ABS}/private/tmp、./、绝对写法互相匹配；同名前缀与项目外为 null`, () => {
  // /private 双形态是 macOS 专属语义（resolve 前的符号链接前缀）；win32 上只测正根一侧
  const roots = IS_WIN
    ? [`${ABS}/tmp/repo`]
    : [`${ABS}/tmp/repo`, `${ABS}/private/tmp/repo`];
  if (!IS_WIN) assert.equal(toProjectRelative(`${ABS}/private/tmp/repo/src/a.ts`, roots), 'src/a.ts');
  assert.equal(toProjectRelative(`${ABS}/tmp/repo/src/a.ts`, roots), 'src/a.ts');
  assert.equal(toProjectRelative('./src/a.ts', roots), 'src/a.ts');
  assert.equal(toProjectRelative('src/a.ts', roots), 'src/a.ts');
  assert.equal(toProjectRelative(`${ABS}/tmp/repository/src/a.ts`, roots), null, '分隔符边界：/repo 不是 /repository 的前缀（AGY-04）');
  assert.equal(toProjectRelative(`${ABS}/etc/passwd`, roots), null);
  const m = matchConsulted(['src/a.ts', 'doc/x.md'], [`${ABS}${IS_WIN ? '' : '/private'}/tmp/repo/src/a.ts`], roots);
  assert.deepEqual(m, { matched: ['src/a.ts'], missing: ['doc/x.md'] });
});

// ── T12 / T13：措施 a 的接线与根口径（代码双审 CODEX-02/03 ≡ AGY-01 ≡ GLM-01/02）──

test('T12 措施 a：搜索命中对端审查件 → 作废并分类；命中状态文件只告警；命中己方运行材料不作废；置空恢复', async () => {
  /*
   * 此前全仓没有任何用例喂过非空 deny_paths + search_hit_paths：删掉 guard.ts 措施 a 里的并集，
   * 全仓照绿——新规则是安全判定面上的 fail-open 面。本条一次锁住「接线」与「10.1.1 分档不误伤」。
   */
  const t = await loadTrace('read-sentinel.jsonl');
  const peerRel = '.reviews/M9-验收-3812f4c/code/2026-09-19-M9-验收-3812f4c-glm.md';
  const stateRel = `${TRIVIUM_DIR}/state.json`;
  const ownRun = '/runs/proj-1/R1/claude/out/result.json';
  const req = { deny_paths: [peerRel, stateRel, '/runs/proj-1/R1'] };
  const base = sideResult(t);

  // ① 对端审查件（peer-artifact，作废类）
  let v = judge({ ...base, search_hit_paths: [`${FAKE_ROOT}/${peerRel}`] }, null, { req });
  assert.equal(v.peerArtifactRead, true, '经 Grep content 读到对端审查件，与 Read 读到同等处置');
  assert.ok(v.peerHits.some((h) => h.endsWith('-glm.md')), `peerHits 应含对端件，实得 ${JSON.stringify(v.peerHits)}`);
  assert.ok(v.typedHits.some((h) => h.category === 'peer-artifact'));

  // ② 编排器状态文件（orchestrator-state，告警级）
  v = judge({ ...base, search_hit_paths: [`${FAKE_ROOT}/${stateRel}`] }, null, { req });
  assert.equal(v.peerArtifactRead, false, '状态文件不含审查意见，命中只记告警');
  assert.ok(v.notedPaths.some((p) => p.endsWith('state.json')));
  assert.ok(v.notedCategories.includes('orchestrator-state'));

  // ③a 正对照（第 2 轮 CODEX-03 ≡ AGY-01）：同一条运行根 deny 条目、对端侧输出 → 命中并作废（peer-run-output）。
  //    没有这一格，③b 的三个空集断言区分不了「命中后放行」与「压根没命中」——toLogicalForm 若把项目外路径弄丢，
  //    ③b 照绿而措施 a 对运行根静默变盲。
  v = judge({ ...base, search_hit_paths: ['/runs/proj-1/R1/gemini/out/result.json'] }, null, { req });
  assert.equal(v.peerArtifactRead, true, '运行根条目对项目外的绝对路径仍要能前缀命中——项目外路径必须原样送进 checkPeerLeak');
  assert.ok(v.typedHits.some((h) => h.category === 'peer-run-output'), `实得 ${JSON.stringify(v.typedHits)}`);

  // ③b 己方运行材料（own-run-material）：guard 的 dispose 对它整体放行——三个集合都不记，
  //    这是设计 §10.1.1 的取向（告警档不被常态噪声填满），不是漏判；本格锁的是「命中了但不作废、不告警」
  v = judge({ ...base, search_hit_paths: [ownRun] }, null, { req });
  assert.equal(v.peerArtifactRead, false, '己方运行材料不损害独立性');
  assert.deepEqual(v.peerHits, [], '不进作废集');
  assert.deepEqual(v.notedPaths, [], '不进告警集');
  assert.ok(!v.typedHits.some((h) => h.path === ownRun), 'dispose 对己方材料返回 null，typedHits 里也不该有它');

  // ④ 置空 → 恢复 false（删掉并集时 ① 红、本格照绿——两格合起来才是变异守卫）
  v = judge({ ...base, search_hit_paths: null }, null, { req });
  assert.equal(v.peerArtifactRead, false);
});

test('T13 符号链接根：projectRoots 带 realpath 别名时，物理形态的搜索命中仍命中逻辑形态的 deny 条目', async () => {
  /*
   * CODEX-02 ≡ GLM-02：checkPeerLeak 只按字面 projectRoot 归一（抹 /private，无 realpath），
   * 而 Grep 命中以 init.cwd（物理路径）为基准——符号链接根下 deny 条目是逻辑形态、命中是物理形态，
   * 恒不命中。judgeSide 现在先经 projectRoots 别名把项目内路径折成相对形态再送入。
   */
  const t = await loadTrace('read-sentinel.jsonl');
  const LINK = `${ABS}/Users/someone/link/repo`;
  // 物理根也要带 ${ABS}（EV-259）：win32 上无盘符的根路径按当前目录所在盘解析，仓库不在 D 盘时与 LINK 的 D: 对不上
  const REAL = `${ABS}/Volumes/data/repo`;
  const req = { ...REQ, project_root: LINK, deny_paths: ['.reviews/T/plan/2026-09-19-T-glm.md'] } as CriticRequest;
  const opts = (roots?: readonly string[]) => ({
    degraded: [],
    archiveRootAbs: `${LINK}/.reviews`,
    projectRoot: LINK,
    ...(roots ? { projectRoots: roots } : {}),
    triviumDir: `${LINK}/${TRIVIUM_DIR}`,
    runRoot: '/runs',
    capability: TOOL_TRACE_CAPABILITY,
  });
  const r = { ...sideResult(t), search_hit_paths: [`${REAL}/.reviews/T/plan/2026-09-19-T-glm.md`] };
  assert.equal(
    judgeSide(defaultConfig(), 'claude', r, null, req, opts([LINK, REAL])).peerArtifactRead,
    true,
    '带别名：物理形态命中折成相对形态后命中逻辑形态条目',
  );
  assert.equal(
    judgeSide(defaultConfig(), 'claude', r, null, req, opts()).peerArtifactRead,
    false,
    '不带别名：正是 CODEX-02 指出的假阴性——本格锁住「别名是修法」这件事，别把它当 bug 修掉',
  );
});
