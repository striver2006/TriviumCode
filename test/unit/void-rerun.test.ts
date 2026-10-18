/**
 * 作废侧在同一次运行内重跑一次（BACKLOG EV-225，M12 批次 3，计划 r2 §4.3）。
 *
 * 端到端的形态（桩 + worker + 归档 + 闸门）在 `test/integration/fault-injection.test.ts` 的 EV-225 组与 AC-25 组；
 * 这里钉住各零件自己的契约：runner 的重拉与计数、单侧判定与终判同源、点名段不成为新泄漏面、
 * 首次输出的去处与分类、等待预算、schema、会话启动清扫。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { MAX_VOID_RERUNS, VOID_RERUN_NOTE, runBothSides, type SideProgress } from '../../src/trivium/runner.js';
import { TOOL_TRACE_CAPABILITY, type AdapterContext, type CriticAdapter } from '../../src/trivium/adapters/base.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { judgeSide, makeSideLeakJudge, type SideLeakVerdict } from '../../src/trivium/guard.js';
import { classifyDenyPath, leakRecordVoids } from '../../src/trivium/freeze.js';
import {
  VOID_RERUN_BANNER_HEADING, VOID_RERUN_BANNER_MAX_ITEMS, commandProgramName, renderVoidRerunBanner,
} from '../../src/trivium/brief.js';
import { RUN_DIR_FILE_NAMES, VOIDED_ATTEMPTS_DIR, isRunDirFile } from '../../src/trivium/run-files.js';
import { ALL_AGENT_IDS } from '../../src/trivium/agents/registry.js';
import { stashVoidedOutput } from '../../src/trivium/review.js';
import { budgetForStatus, computeMaxWaits, type RunStatus } from '../../src/trivium/status.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import { scrubRunDir } from '../../src/trivium/scrub.js';
import { CRITICS, type CriticId, type CriticRequest, type CriticResult, type DenyCategory, type RunMeta } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

// WIN_FILE_SKIP（Windows 移植）：夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）');
} else {

// ── runner ──

function okResult(critic: CriticId, over: Partial<CriticResult> = {}): CriticResult {
  return {
    critic, status: 'ok', exit_code: 0, duration_s: 10,
    raw_stdout_path: '/runs/out', trace_path: '/runs/trace', review_json: null,
    raw_response_text: '{}', model_effective: 'M', model_effective_source: 'envelope',
    model_provider: null, profile_requested: null,
    tool_calls: { read: 6 }, read_paths: ['/proj/src/a.ts'], search_hit_paths: null, write_events: [], command_texts: [],
    evidence_ok: true, fail_reason: null, session_id: 'S', cli_version: '1',
    peer_deny_applied: false, deny_skipped: 0, deny_rule_count: 0, deny_bytes: 0, command_line: 'x', ...over,
  };
}

const failedTransient = (critic: CriticId): CriticResult =>
  okResult(critic, { status: 'failed', fail_reason: '空输出', raw_response_text: null });

const CTX: AdapterContext = { cfg: defaultConfig(), nodePath: '/usr/bin/node' };

function req(critic: CriticId): CriticRequest {
  return {
    run_id: 'R1', topic: 't', stage: 'plan', critic,
    project_root: '/proj', subject_path: '/proj/s.md', deny_paths: [],
    out_dir: `/runs/x/${critic}/out`, brief_path: '/proj/b.md', brief_text: 'BRIEF',
    model: 'M', timeout_s: 900, schema_path: '/s.json',
    min_tool_calls: 5, profile_requested: null, min_project_reads: 3, tier: null, tier_source: null,
  };
}

/** 按脚本依次返回结果、记录每次收到的任务书的桩适配器 */
function scripted(critic: CriticId, script: CriticResult[]): CriticAdapter & { briefs: string[] } {
  const briefs: string[] = [];
  let i = 0;
  return {
    critic, briefs,
    capability: TOOL_TRACE_CAPABILITY, commandExecution: 'none',
    availability: () => ({ ok: true }),
    effortReadback: () => ({ effective: null, source: null }),
    async run(_ctx, r) {
      briefs.push(r.brief_text);
      return script[Math.min(i++, script.length - 1)]!;
    },
  } as CriticAdapter & { briefs: string[] };
}

/** 读到 `/peer` 的结果判作废——单测里的判定器只认这个标记，形状与 `makeSideLeakJudge` 的产出同 */
const LEAKY = (c: CriticId) => okResult(c, { read_paths: ['/peer/review.md'] });
const fakeJudge = (_c: CriticId, r: CriticResult): SideLeakVerdict | null => {
  if (r.status !== 'ok') return null;
  const hits = r.read_paths.filter((p) => p.startsWith('/peer')).map((p) => ({ path: p, category: 'peer-artifact' as DenyCategory }));
  return { voided: hits.length > 0, path: { hit: hits.length > 0, hits }, command: { hit: false, commands: [], hits: [] } };
};

test('runner：不传作废钩子时与原先逐值相同——瞬时重试照旧，不写逐次记录', async () => {
  const g = scripted('gemini', [failedTransient('gemini'), okResult('gemini')]);
  const out = await runBothSides({ ctx: CTX, adapters: { gemini: g }, requests: { gemini: req('gemini') }, maxTransientRetries: 1 });
  assert.equal(out.attempts.gemini, 2);
  assert.equal(out.results.gemini?.status, 'ok');
  assert.deepEqual(out.attemptLog, {}, '没发生作废重跑就不交逐次记录');
  const g2 = scripted('gemini', [failedTransient('gemini')]);
  const out2 = await runBothSides({ ctx: CTX, adapters: { gemini: g2 }, requests: { gemini: req('gemini') }, maxTransientRetries: 1 });
  assert.equal(out2.attempts.gemini, 2, '瞬时重试额度 1：共两次，与原判据「attempts > max」等价');
  const g3 = scripted('gemini', [failedTransient('gemini')]);
  const out3 = await runBothSides({ ctx: CTX, adapters: { gemini: g3 }, requests: { gemini: req('gemini') }, maxTransientRetries: 0 });
  assert.equal(out3.attempts.gemini, 1);
});

test('runner：首次作废、重跑干净——重拉一次，点名段插在最前面、原任务书逐字跟随，首次输出挪走', async () => {
  const g = scripted('gemini', [LEAKY('gemini'), okResult('gemini')]);
  const stashed: [CriticId, number][] = [];
  const out = await runBothSides({
    ctx: CTX, adapters: { gemini: g }, requests: { gemini: req('gemini') }, maxTransientRetries: 1,
    judgeLeak: fakeJudge,
    stashVoided: async (c, n) => { stashed.push([c, n]); return `voided/${c}/attempt-${n}`; },
    voidRerunBanner: () => `${VOID_RERUN_BANNER_HEADING}\n点名`,
  });
  assert.equal(out.results.gemini?.status, 'ok');
  assert.equal(out.attempts.gemini, 2);
  assert.deepEqual(stashed, [['gemini', 1]]);
  assert.equal(g.briefs[0], 'BRIEF');
  assert.equal(g.briefs[1], `${VOID_RERUN_BANNER_HEADING}\n点名\n\n---\n\nBRIEF`, '点名段在前、原任务书逐字在后');
  const log = out.attemptLog.gemini!;
  assert.deepEqual(log.map((a) => [a.n, a.status, a.voided, a.output_dir]), [[1, 'ok', true, 'voided/gemini/attempt-1'], [2, 'ok', false, undefined]]);
  assert.equal(leakRecordVoids({ path: log[0]!.peer_leak_via_path, command: log[0]!.peer_leak_via_command }), true, '条目的 voided 与明细同谓词');
  assert.equal(out.rerunBanners.gemini, `${VOID_RERUN_BANNER_HEADING}\n点名`);
});

test('runner：二次命中——侧级判 failed(peer_leak)，不进瞬时重试，至多重跑 MAX_VOID_RERUNS 次', async () => {
  assert.equal(MAX_VOID_RERUNS, 1);
  const g = scripted('gemini', [LEAKY('gemini')]);
  const out = await runBothSides({
    ctx: CTX, adapters: { gemini: g }, requests: { gemini: req('gemini') }, maxTransientRetries: 3,
    judgeLeak: fakeJudge, stashVoided: async () => null, voidRerunBanner: () => 'B',
  });
  assert.equal(out.attempts.gemini, 2, '首次 + 一次重跑，瞬时额度再多也不再跑');
  assert.equal(out.results.gemini?.status, 'failed');
  assert.match(out.results.gemini?.fail_reason ?? '', /^peer_leak/);
  // 分层记法：条目记适配器层的 ok
  assert.deepEqual(out.attemptLog.gemini!.map((a) => [a.status, a.voided, a.fail_reason]), [['ok', true, null], ['ok', true, null]]);
});

test('runner：重跑那次遇瞬时故障照样可重试（额度整侧共用），条目逐次都记', async () => {
  const g = scripted('gemini', [LEAKY('gemini'), failedTransient('gemini'), okResult('gemini')]);
  const out = await runBothSides({
    ctx: CTX, adapters: { gemini: g }, requests: { gemini: req('gemini') }, maxTransientRetries: 1,
    judgeLeak: fakeJudge, stashVoided: async () => null, voidRerunBanner: () => 'B',
  });
  assert.equal(out.results.gemini?.status, 'ok');
  assert.deepEqual(out.attemptLog.gemini!.map((a) => [a.n, a.status, a.voided]), [[1, 'ok', true], [2, 'failed', null], [3, 'ok', false]]);
});

test('runner：重跑那次适配器抛异常——逐次记录与点名段照样交回（代码双审 GLM-02）', async () => {
  let n = 0;
  const g = {
    ...scripted('gemini', []),
    async run(): Promise<CriticResult> {
      if (n++ === 0) return LEAKY('gemini');
      throw new Error('适配器崩了');
    },
  } as CriticAdapter;
  const out = await runBothSides({
    ctx: CTX, adapters: { gemini: g }, requests: { gemini: req('gemini') }, maxTransientRetries: 1,
    judgeLeak: fakeJudge, stashVoided: async () => 'voided/gemini/attempt-1', voidRerunBanner: () => 'B',
  });
  assert.equal(out.results.gemini?.status, 'failed');
  assert.deepEqual(out.attemptLog.gemini?.map((a) => [a.n, a.status, a.voided]), [[1, 'ok', true], [2, 'failed', null]]);
  assert.match(out.attemptLog.gemini![1]!.fail_reason ?? '', /适配器异常：适配器崩了/);
  assert.equal(out.attempts.gemini, 2);
  assert.equal(out.rerunBanners.gemini, 'B', '已送出的点名段要能落盘');

  // 没发生作废重跑就抛的，照旧不交逐次记录
  const h = { ...scripted('glm', []), async run(): Promise<CriticResult> { throw new Error('一上来就崩'); } } as CriticAdapter;
  const out2 = await runBothSides({ ctx: CTX, adapters: { glm: h }, requests: { glm: req('glm') }, maxTransientRetries: 1, judgeLeak: fakeJudge });
  assert.deepEqual(out2.attemptLog, {});
  assert.equal(out2.attempts.glm, 1);
});

test('runner：判定器抛异常——不重跑，按未判出作废收口（终判照常）', async () => {
  const g = scripted('gemini', [LEAKY('gemini'), okResult('gemini')]);
  const out = await runBothSides({
    ctx: CTX, adapters: { gemini: g }, requests: { gemini: req('gemini') }, maxTransientRetries: 1,
    judgeLeak: () => { throw new Error('判定器坏了'); }, stashVoided: async () => null, voidRerunBanner: () => 'B',
  });
  assert.equal(out.attempts.gemini, 1);
  assert.equal(out.results.gemini?.status, 'ok');
  assert.deepEqual(out.attemptLog, {});
});

test('runner：一侧重拉期间另一侧不受影响——调用次数、任务书、进度事件都与不注入时相同', async () => {
  const g = scripted('gemini', [LEAKY('gemini'), okResult('gemini')]);
  const l = scripted('glm', [okResult('glm')]);
  const events: [CriticId, SideProgress][] = [];
  const out = await runBothSides({
    ctx: CTX, adapters: { gemini: g, glm: l }, requests: { gemini: req('gemini'), glm: req('glm') }, maxTransientRetries: 1,
    onSideProgress: (c, p) => events.push([c, p]),
    judgeLeak: fakeJudge, stashVoided: async () => null, voidRerunBanner: () => 'B',
  });
  assert.equal(l.briefs.length, 1);
  assert.equal(l.briefs[0], 'BRIEF');
  assert.equal(out.attempts.glm, 1);
  assert.equal(out.attemptLog.glm, undefined);
  const glmEvents = events.filter(([c]) => c === 'glm').map(([, p]) => p);
  assert.ok(glmEvents.every((p) => p.voidRerun === undefined), 'glm 不得带重跑标记');
  assert.ok(!('note' in glmEvents[glmEvents.length - 1]!), '没重跑的一侧收口事件照旧不带 note');

  const gemEvents = events.filter(([c]) => c === 'gemini').map(([, p]) => p);
  assert.ok(gemEvents.some((p) => p.voidRerun === true && p.note === VOID_RERUN_NOTE), '决定重跑时报重跑标记与说明');
  const last = gemEvents[gemEvents.length - 1]!;
  assert.equal(last.state, 'ok');
  assert.equal(last.note, null, '重跑后收口显式清掉「重跑中」（计划双审 AGY-02）');
});

// ── 单侧判定与终判同源 ──

test('makeSideLeakJudge 与 judgeSide 对同一份结果给同一结论；告警级 / 己方材料不判作废；首次输出对两侧都是对端输出', async () => {
  const proj = await scratchDir('trivium-void-proj-');
  const runRoot = path.join(proj, 'runs');
  const cfg = defaultConfig();
  cfg.runtime.run_root = runRoot;
  const peerDoc = path.join('.reviews', 't', 'plan', '2026-01-01-t-glm.md');
  const triviumDir = path.join(proj, '.trivium');
  const r0: CriticRequest = { ...req('gemini'), project_root: proj, deny_paths: [peerDoc, runRoot, triviumDir] };
  const judge = await makeSideLeakJudge({
    cfg, projectRoot: proj, archiveRootAbs: path.join(proj, '.reviews'), triviumDirRel: '.trivium',
    requests: { gemini: r0 }, capabilities: {},
  });
  const runDir = path.join(runRoot, 'slot', 'R1');
  const cases: [string, Partial<CriticResult>, boolean | null][] = [
    ['对端审查件', { read_paths: [path.join(proj, peerDoc)] }, true],
    ['对端运行输出', { read_paths: [path.join(runDir, 'glm', 'out', 'result.json')] }, true],
    ['本侧被作废的上一次输出', { read_paths: [path.join(runDir, VOIDED_ATTEMPTS_DIR, 'gemini', 'attempt-1', 'result.json')] }, true],
    ['命令通道读对端审查件', { command_texts: [`git show HEAD:${peerDoc}`] }, true],
    ['编排器状态目录', { read_paths: [path.join(triviumDir, 'state.json')] }, false],
    ['己方运行材料', { read_paths: [path.join(runDir, 'gemini', 'out', 'result.json'), path.join(runDir, 'request.json')] }, false],
    ['失败侧不判', { status: 'failed' }, null],
  ];
  for (const [name, over, want] of cases) {
    const r = okResult('gemini', { read_paths: [], ...over });
    const got = judge('gemini', r);
    if (want === null) {
      assert.equal(got, null, name);
      continue;
    }
    assert.equal(got?.voided, want, name);
    const ref = judgeSide(cfg, 'gemini', r, null, r0, {
      archiveRootAbs: path.join(proj, '.reviews'), projectRoot: proj, projectRoots: [proj, await fs.realpath(proj)],
      triviumDir, runRoot, degraded: [],
    });
    assert.equal(got!.voided, ref.peerArtifactRead, `${name}：与 judgeSide 同结论`);
    assert.equal(leakRecordVoids({ path: got!.path, command: got!.command }), got!.voided, `${name}：与闸门的谓词同结论`);
  }
  const noted = judge('gemini', okResult('gemini', { read_paths: [path.join(triviumDir, 'state.json')] }))!;
  assert.equal(noted.path.hit, true, '告警级命中照样记明细，只是不作废');
});

// ── 首次输出的去处 ──

test('VOIDED_ATTEMPTS_DIR 不是 Agent id、不是运行目录层文件；其下路径对本侧与对端都判对端运行输出', () => {
  assert.ok(!(ALL_AGENT_IDS as readonly string[]).includes(VOIDED_ATTEMPTS_DIR));
  assert.ok(!RUN_DIR_FILE_NAMES.includes(VOIDED_ATTEMPTS_DIR));
  assert.equal(isRunDirFile(VOIDED_ATTEMPTS_DIR), false);
  const ctx = (critic: CriticId) => ({ projectRoot: '/proj', triviumDir: '/proj/.trivium', runRoot: '/runs', critic, sensitiveGlobs: [] });
  const p = path.join('/runs', 'slot', 'R1', VOIDED_ATTEMPTS_DIR, 'gemini', 'attempt-1', 'result.json');
  assert.equal(classifyDenyPath(p, ctx('gemini')), 'peer-run-output', '重跑侧读自己上一次的输出：同样作废');
  assert.equal(classifyDenyPath(p, ctx('glm')), 'peer-run-output');
});

test('stashVoidedOutput：父目录不存在也挪得过去；目标已占用时整删 out 兜底；没有 out 时静默返回 null', async () => {
  const run = await scratchDir('trivium-void-stash-');
  await fs.mkdir(path.join(run, 'gemini', 'out'), { recursive: true });
  await fs.writeFile(path.join(run, 'gemini', 'out', 'result.json'), '{"n":1}');
  const w: string[] = [];
  assert.equal(await stashVoidedOutput(run, 'gemini', 1, w), path.join('voided', 'gemini', 'attempt-1'));
  assert.equal(await fs.readFile(path.join(run, 'voided', 'gemini', 'attempt-1', 'result.json'), 'utf8'), '{"n":1}');
  await assert.rejects(fs.access(path.join(run, 'gemini', 'out')), 'out 已挪走');

  // 目标被占用（非空目录）：改名失败 → 整删 out 兜底，不留污染输出在己方子树
  await fs.mkdir(path.join(run, 'gemini', 'out'), { recursive: true });
  await fs.writeFile(path.join(run, 'gemini', 'out', 'result.json'), '{"n":2}');
  assert.equal(await stashVoidedOutput(run, 'gemini', 1, w), null);
  await assert.rejects(fs.access(path.join(run, 'gemini', 'out')), '兜底整删了 out');
  assert.deepEqual(w, [], '整删成功不告警');

  assert.equal(await stashVoidedOutput(run, 'glm', 1, w), null, '该次尝试没留下 out');
  assert.deepEqual(w, []);
});

test('stashVoidedOutput：挪不走也删不掉时告警「可能残留」，不抛', async () => {
  const run = await scratchDir('trivium-void-stash-');
  const side = path.join(run, 'gemini');
  await fs.mkdir(path.join(side, 'out'), { recursive: true });
  await fs.writeFile(path.join(side, 'out', 'result.json'), '{}');
  const w: string[] = [];
  try {
    await fs.chmod(side, 0o555); // 侧目录只读：out 既改不了名也删不掉
    assert.equal(await stashVoidedOutput(run, 'gemini', 1, w), null);
  } finally {
    await fs.chmod(side, 0o755);
  }
  assert.equal(w.length, 1, JSON.stringify(w));
  assert.match(w[0]!, /可能残留在己方子树/);
});

// ── 点名段 ──

test('点名段：标题在第一行；只列作废类；命令只点程序名、不回显参数；位置收敛到禁读条目或第三段目录', () => {
  const runRoot = '/runs';
  const deny = ['.reviews/t/plan/2026-01-01-t-glm.md', '.reviews/t/plan/_meta', runRoot];
  const MARK = '对端意见里的一句话QZX';
  const text = renderVoidRerunBanner({
    path: {
      hits: [
        { path: '/proj/.reviews/t/plan/2026-01-01-t-glm.md', category: 'peer-artifact' },
        { path: '/proj/.reviews/t/plan/_meta/review-glm-R0.json', category: 'peer-artifact' },
        { path: '/runs/slot/R1/glm/out/result.json', category: 'peer-run-output' },
        { path: `/runs/slot/R1/${VOIDED_ATTEMPTS_DIR}/gemini/attempt-1/result.json`, category: 'peer-run-output' },
        { path: '/proj/.trivium/state.json', category: 'orchestrator-state' },
      ],
    },
    command: {
      hits: [
        { command: `/usr/bin/grep -rn "${MARK}" .reviews`, path: '/proj/.reviews/t/plan/2026-01-01-t-glm.md', category: 'peer-artifact' },
        { command: `FOO=bar cat ${MARK}`, path: '/runs/slot/R1/glm/out/result.json', category: 'peer-run-output' },
      ],
    },
  }, { projectRoot: '/proj', runRoot, denyPaths: deny });
  assert.equal(text.split('\n')[0], VOID_RERUN_BANNER_HEADING);
  assert.ok(!text.includes(MARK), '命令参数一个字都不进点名段');
  assert.ok(text.includes('经命令 `grep` 碰到'), '程序名取首个词的末段');
  assert.ok(text.includes('经命令碰到'), '首个词不合形态（环境变量赋值）就只写「经命令」');
  assert.ok(text.includes('`.reviews/t/plan/2026-01-01-t-glm.md`'), '项目内命中显示禁读条目');
  assert.ok(text.includes('`.reviews/t/plan/_meta`'), '_meta 下的命中显示罩住它的那条目录条目，不点到文件');
  assert.ok(!text.includes('review-glm-R0.json'));
  assert.ok(text.includes("`/runs/slot/R1/glm/`（运行目录里 glm 侧的本轮输出）"), "运行根下只到第三段");
  assert.ok(!text.includes('result.json'), '运行根下的文件名不点名');
  assert.ok(text.includes('运行目录里被作废的上一次输出'));
  assert.ok(!text.includes('state.json'), '告警级命中不列');
});

test('点名段：条数封顶，其余写「另有 N 条」；程序名形态收窄', () => {
  const hits = Array.from({ length: VOID_RERUN_BANNER_MAX_ITEMS + 3 }, (_, i) => ({ path: `/proj/d${i}.md`, category: 'peer-artifact' as DenyCategory }));
  const text = renderVoidRerunBanner(
    { path: { hits }, command: { hits: [] } },
    { projectRoot: '/proj', runRoot: '/runs', denyPaths: hits.map((h) => h.path) },
  );
  assert.ok(text.includes('- 另有 3 条'));
  assert.equal(commandProgramName('/opt/homebrew/bin/git show HEAD:x'), 'git');
  assert.equal(commandProgramName('  cat a'), 'cat');
  assert.equal(commandProgramName('FOO=bar cat a'), null);
  assert.equal(commandProgramName(`${'a'.repeat(33)} x`), null);
  assert.equal(commandProgramName(''), null);
});

// ── 等待预算 ──

test('budgetForStatus：任一侧 void_rerun 为真时追加一份单侧超时，两侧都重跑也只加一份', () => {
  const b = { stageTimeoutS: 900, waitTimeoutS: 180, maxWaits: computeMaxWaits(900, 180, 1) };
  const st = (sides: RunStatus['sides']) => ({ sides });
  assert.deepEqual(budgetForStatus(b, null), b);
  assert.deepEqual(budgetForStatus(b, st({ gemini: { state: 'running', model: null, attempt: 1, elapsed_s: 1 } })), b);
  const one = budgetForStatus(b, st({ gemini: { state: 'running', model: null, attempt: 2, elapsed_s: 1, void_rerun: true } }));
  assert.equal(one.maxWaits, b.maxWaits + 5);
  const both = budgetForStatus(b, st({
    gemini: { state: 'running', model: null, attempt: 2, elapsed_s: 1, void_rerun: true },
    glm: { state: 'running', model: null, attempt: 2, elapsed_s: 1, void_rerun: true },
  }));
  assert.equal(both.maxWaits, one.maxWaits);
});

// ── run.v3 的 attempts ──

function metaWithAttempts(attempts: unknown): RunMeta {
  const m = newRunMeta({
    runId: 'R1', topic: '作废重跑', stage: 'plan', rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: CRITICS,
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's', denyPaths: [], driftPolicy: 'warn',
  });
  // 合法的 v3 逐侧记录（同 run-meta.test.ts 的 sideMeta），再叠 attempts
  (m.critics as Record<string, unknown>)['gemini'] = {
    vendor: 'antigravity', cli_version: '1.0',
    model_requested: 'm', model_effective: 'm', model_effective_source: 'envelope',
    profile_requested: null, model_provider: null,
    access: { requested_mode: 'standard', profile: null, launcher_requested: null, launcher_effective: null,
      wrapper_sha256: null, configuration_sha256: null, provider_declared: null, provider_declared_source: null,
      provider_effective: null, provider_effective_source: null },
    status: 'ok', exit_code: 0, duration_s: 10, tool_calls: {}, evidence_ok: true, heterogeneous: 'unknown',
    ...(attempts === undefined ? {} : { attempts }),
  };
  return m;
}

const A1 = {
  n: 1, started_at: '2026-10-17T00:00:00.000Z', duration_s: 5, status: 'ok', voided: true,
  peer_leak_via_path: { hit: true, hits: [{ path: '/runs/s/R1/glm/out/result.json', category: 'peer-run-output' }] },
  peer_leak_via_command: { hit: false, commands: [], hits: [] },
  output_dir: 'voided/gemini/attempt-1', fail_reason: null,
};
const A2 = { n: 2, started_at: '2026-10-17T00:01:00.000Z', duration_s: 6, status: 'ok', voided: false,
  peer_leak_via_path: { hit: false, hits: [] }, peer_leak_via_command: { hit: false, commands: [], hits: [] }, fail_reason: null };

test('run.v3：合法 attempts 通过；没有 attempts 的旧形态照常通过', () => {
  assert.equal(metaWithAttempts(undefined).schema, 'trivium.run.v3', '前提：新运行写 v3');
  assert.deepEqual(validateRunMeta(metaWithAttempts([A1, A2])), []);
  assert.deepEqual(validateRunMeta(metaWithAttempts(undefined)), []);
  assert.deepEqual(validateRunMeta(metaWithAttempts([A1, { ...A2, status: 'timeout', voided: null }])), [], '没判的条目 voided 为 null');
});

test('run.v3：attempts 至少两条、条目不许多余键、status 只认适配器层三值', () => {
  assert.ok(validateRunMeta(metaWithAttempts([A1])).length > 0, '只在发生过作废重跑时写，至少两条');
  assert.ok(validateRunMeta(metaWithAttempts([A1, { ...A2, extra: 1 }])).length > 0);
  assert.ok(validateRunMeta(metaWithAttempts([A1, { ...A2, status: 'parse_fallback' }])).length > 0);
  assert.ok(validateRunMeta(metaWithAttempts([A1, { ...A2, n: 0 }])).length > 0);
  assert.ok(validateRunMeta(metaWithAttempts([{ ...A1, peer_leak_via_path: { hit: true, hits: [{ path: 'x', category: 'nope' }] } }, A2])).length > 0);
});

// ── 会话启动清扫 ──

test('scrubRunDir：voided/ 下被挪走的首次输出也就地脱敏，结果并进运行目录层', async () => {
  const FAKE = ['Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M'].join('');
  const run = await scratchDir('trivium-void-scrub-');
  const log = path.join(run, VOIDED_ATTEMPTS_DIR, 'gemini', 'attempt-1', 'stdout.jsonl');
  await fs.mkdir(path.dirname(log), { recursive: true });
  await fs.writeFile(log, `{"r":"token = \\"${FAKE}\\""}\n`);
  const r = await scrubRunDir(run, () => undefined);
  assert.ok(!(await fs.readFile(log, 'utf8')).includes(FAKE), '首次输出里的凭据也要抹');
  assert.equal(r.runDir.redacted[path.join(VOIDED_ATTEMPTS_DIR, 'gemini', 'attempt-1', 'stdout.jsonl')], 1);
});

}
