import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { acceptanceRate, buildTopicReport, renderTopicReport, type RoundReport } from '../../src/trivium/report.js';
import { newRunMeta, writeRunMeta, registerRun, type TaskMeta } from '../../src/trivium/meta.js';
import { writeArtifact, writeMeta, type ArchiveLayout } from '../../src/trivium/archive.js';
import { CRITICS, EXCEPTION_TERMINATION_BY, type Review } from '../../src/trivium/types.js';
import { DEFAULT_DRIVER } from '../../src/trivium/agents/registry.js';
import { scratchDir, scratchDirSync } from '../helpers/scratch.js';

const TASK_LOCK_DIR = scratchDirSync('trivium-report-lock-');

/**
 * 主题级复盘（设计 §5.1 / §9.3 / §15.2）。
 *
 * 报告只读 `.reviews/`，所以这些用例的做法是**真的把归档摆出来**再读回，
 * 而不是往渲染函数里塞手造对象——后者测不出「归档里缺件时会怎样」，
 * 而那恰恰是复盘最容易骗人的地方。
 */

const TOPIC = '复盘主题';

async function archive(): Promise<ArchiveLayout & { root: string }> {
  const raw = await scratchDir('trivium-report-');
  const root = await fs.realpath(raw);
  const archiveRoot = path.join(root, '.reviews');
  await fs.mkdir(path.join(archiveRoot, TOPIC, 'plan', '_meta'), { recursive: true });
  return { archiveRoot, topic: TOPIC, root };
}

/**
 * 造一份合规结论。编号必须是 `AGY-NN` / `GLM-NN`：
 * schema 的 id pattern 是 `^(AGY|GLM)-(r\\d+-)?\\d{2,}$`，
 * 裁决件解析器也据此过滤（免得把表格里的小结行当数据行）。
 */
function review(locations: string[], severities: string[] = [], prefix = 'AGY'): Review {
  return {
    schema: 'trivium.review.v1',
    verdict: 'request-changes',
    summary: 's',
    findings: locations.map((location, i) => ({
      id: `${prefix}-${String(i + 1).padStart(2, '0')}`,
      severity: severities[i] ?? 'minor',
      layer: 'plan',
      kind: 'correctness',
      location,
      problem: 'p',
      evidence: 'e',
      suggestion: 'g',
      confidence: 'high',
    })),
  } as unknown as Review;
}

/** 摆一轮完整归档：两侧审查文档 + 两份 review json + run.json */
async function seedRound(
  l: ArchiveLayout,
  opts: {
    rerunIndex: number;
    runId: string;
    gemini?: Review | null;
    glm?: Review | null;
    glmFailed?: boolean;
    usage?: Record<string, unknown>;
    drift?: boolean;
    /** 跑后复算比不了（EV-139）：changed 真、files 空、带 unknown_reason */
    driftUnknown?: boolean;
    guardLevel?: 'L1' | 'L2';
    /** 手工置 true：生产代码从不写 true，只用来钉「report 不据它打旗标」（EV-137） */
    forgedRoleFile?: boolean;
  },
) {
  const meta = newRunMeta({
    runId: opts.runId, topic: l.topic, stage: 'plan', rerunIndex: opts.rerunIndex,
    command: 'test', promptHint: '焦点', taskGoal: null, criticsSelected: CRITICS,
    treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S',
    denyPaths: [], driftPolicy: 'warn',
    ...(opts.guardLevel ? { driverGuardLevel: opts.guardLevel } : {}),
  });
  if (opts.drift) meta.snapshot.drift = { changed: true, files: ['x.ts'], policy: 'warn' };
  if (opts.driftUnknown) {
    meta.snapshot.drift = {
      changed: true, files: [], policy: 'fail',
      unknown_reason: { cause: 'object_gone', detail: '送审快照的 tree 0123456789ab 在审查期间被清理' },
    };
  }
  if (opts.forgedRoleFile) meta.guard.forged_role_file = true;

  for (const [c, rv] of [['gemini', opts.gemini], ['glm', opts.glm]] as const) {
    if (c === 'glm' && opts.glmFailed) {
      meta.critics.glm = {
        vendor: 'zcode', cli_version: null, model_requested: 'GLM-x', model_effective: null,
        model_effective_source: 'unverified', profile_requested: null, model_provider: null,
        status: 'timeout', exit_code: null, duration_s: 900,
        tool_calls: {}, evidence_ok: false, heterogeneous: true, fail_reason: '脚本级超时（900s）',
      };
      await writeMeta(l, 'plan', `review-glm-${opts.runId}.failed.json`,
        JSON.stringify({ critic: 'glm', status: 'timeout', fail_reason: '脚本级超时（900s）' }) + '\n');
      meta.review_mode = 'partial';
      meta.degraded_reason = 'glm: timeout';
      continue;
    }
    if (!rv) continue;
    meta.critics[c] = {
      vendor: c === 'gemini' ? 'antigravity' : 'zcode',
      cli_version: '1.0', profile_requested: null, model_provider: null,
      model_requested: c === 'gemini' ? 'gemini-x' : 'GLM-x',
      model_effective: c === 'gemini' ? 'gemini-x' : 'provider/GLM-x',
      model_effective_source: 'envelope', status: 'ok', exit_code: 0, duration_s: c === 'gemini' ? 100 : 200,
      tool_calls: { read: 9 }, evidence_ok: true, heterogeneous: true,
      ...(opts.usage ? { usage: opts.usage as Record<string, number> } : {}),
    };
    await writeMeta(l, 'plan', `review-${c}-${opts.runId}.json`, JSON.stringify(rv) + '\n');
    await writeArtifact({
      layout: l, stage: 'plan', role: c, writer: c,
      rerunIndex: opts.rerunIndex, content: `# ${c} 审查\n\nrun_id: ${opts.runId}\n`,
    });
  }

  meta.status = 'success';
  await writeRunMeta(l, 'plan', meta);
  await registerRun(l, meta, { triviumDir: TASK_LOCK_DIR, heartbeatStaleMs: 120_000 });
  return meta;
}

// ── 空主题 ──

test('空主题：如实说「没有轮次」，不渲染成一份看起来干净的报告', async () => {
  const l = await archive();
  const r = await buildTopicReport(l);
  assert.equal(r.rounds.length, 0);
  assert.ok(r.notes.some((n) => /没有任何已产出审查工件/.test(n)));
  const md = renderTopicReport(r);
  assert.match(md, /没有任何已产出审查工件/);
  assert.match(md, /（无数据）/);
});

// ── 正常一轮 ──

test('一轮双审：时间线、意见数、严重度分布、生效模型齐备', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['src/a.ts:10', 'src/b.ts:20'], ['blocker', 'major']),
    glm: review(['src/a.ts:8-12'], ['minor'], 'GLM'),
  });

  const r = await buildTopicReport(l);
  assert.equal(r.rounds.length, 1);
  const d = r.rounds[0]!;
  assert.equal(d.runId, 'R1');
  assert.equal(d.reviewMode, 'full');
  assert.deepEqual(
    d.sides.map((s) => [s.critic, s.findings]).sort(),
    [['gemini', 2], ['glm', 1]],
  );
  assert.deepEqual(d.severity, { blocker: 1, major: 1, minor: 1, nit: 0 });

  const md = renderTopicReport(r);
  assert.match(md, /plan r1/);
  assert.match(md, /provider\/GLM-x/, '生效模型须是回读值');
});

test('时间线带「Driver（护栏）」列：留痕有等级就写等级，旧留痕没有就写「—」，不补成 L1（B1）', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1', guardLevel: 'L2',
    gemini: review(['src/a.ts:10']), glm: review(['src/b.ts:1'], [], 'GLM'),
  });
  await seedRound(l, {
    rerunIndex: 2, runId: 'R2',
    gemini: review(['src/a.ts:10']), glm: review(['src/b.ts:1'], [], 'GLM'),
  });
  const r = await buildTopicReport(l);
  const [r1, r2] = r.rounds;
  assert.deepEqual([r1!.driver, r1!.driverGuardLevel], [DEFAULT_DRIVER, 'L2']);
  assert.deepEqual([r2!.driver, r2!.driverGuardLevel], [DEFAULT_DRIVER, null], '缺失即「无从得知」');
  const md = renderTopicReport(r);
  assert.match(md, /\| Driver（护栏） \|/);
  assert.match(md, new RegExp(`\\| \`R1\` \\|.*\\| ${DEFAULT_DRIVER}（L2） \\|`));
  assert.match(md, new RegExp(`\\| \`R2\` \\|.*\\| ${DEFAULT_DRIVER}（—） \\|`));
});

test('归一化后的重合度进表，且未归一化值一并给出', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['src/a.ts:10']),
    glm: review(['src/a.ts:8-12'], [], 'GLM'),
  });
  const r = await buildTopicReport(l);
  // 两侧时恰好一对，与旧行为等价；配对身份随项给出（M7b 第 2 步）
  assert.equal(r.rounds[0]!.divergences.length, 1, '两侧应恰好产出一对');
  const v = r.rounds[0]!.divergences[0]!;
  assert.deepEqual([v.a, v.b], ['gemini', 'glm'], '配对身份要如实记，渲染侧不再靠默契补名字');
  assert.equal(v.jaccard, 1, ':10 落在 :8-12 内，是同一处');
  assert.equal(v.rawJaccard, 0, '原始字符串不相等');
  assert.equal(v.degenerate, true);
  assert.match(renderTopicReport(r), /退化|重合度超过阈值/);
});

// ── 降级与缺件 ──

test('单侧超时：显示状态而非 0，并进降级清单', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['src/a.ts:1']),
    glmFailed: true,
  });

  const r = await buildTopicReport(l);
  const d = r.rounds[0]!;
  const glm = d.sides.find((s) => s.critic === 'glm')!;
  assert.equal(glm.findings, null, '失败侧的意见数必须是 null，不能是 0');
  assert.equal(glm.status, 'timeout');
  assert.equal(d.reviewMode, 'partial');
  assert.deepEqual(d.divergences, [], '只有一侧有结论时不算重合度');

  const md = renderTopicReport(r);
  assert.match(md, /（timeout）/, '表里显示状态');
  assert.match(md, /脚本级超时/);
  assert.match(md, /0.*会被读成「该侧认为没问题」/s);
});

test('审查完成但无裁决件 → 明确点出，采纳率不按 0 算', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  const r = await buildTopicReport(l);
  assert.equal(r.rounds[0]!.disposals, null);
  assert.ok(r.rounds[0]!.notes.some((n) => /尚无裁决件/.test(n)));
  assert.deepEqual(acceptanceRate(r.rounds), { accepted: 0, total: 0 });
  assert.match(renderTopicReport(r), /尚无裁决件/);
});

// ── 裁决与驳回 ──

test('裁决件被解析：采纳率与被驳回项带理由', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['a:1', 'a:2']), glm: review(['b:1'], [], 'GLM'),
  });
  await writeArtifact({
    layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1,
    content: [
      '# 修订计划', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了 | §3 |',
      '| AGY-02 | gemini | major | 驳回 | 与 ADR-001 冲突，镜像树已被推翻 | — |',
      '| GLM-01 | glm | minor | 暂缓 | 依赖上游探针结论，M4 再定 | — |',
      '',
    ].join('\n'),
  });

  const r = await buildTopicReport(l);
  const d = r.rounds[0]!;
  assert.deepEqual(d.disposals, { 接受: 1, 驳回: 1, 暂缓: 1 });
  assert.deepEqual(acceptanceRate(r.rounds), { accepted: 1, total: 3 });
  assert.equal(d.contested.length, 2, '驳回与暂缓都算争议项');

  const md = renderTopicReport(r);
  assert.match(md, /1 \/ 3 = 33%/);
  assert.match(md, /与 ADR-001 冲突/, '驳回理由必须出现在报告里');
  assert.match(md, /M4 再定/);
});

// ── token 与告警 ──

test('token 逐侧列出，字符串字段被丢弃而不是累加成垃圾', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1',
    gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM'),
    // 实测 zcode 的 usage 里混了字符串 source 字段
    usage: { input_tokens: 100, output_tokens: 20, source: 'provider' },
  });
  const r = await buildTopicReport(l);
  const md = renderTopicReport(r);
  assert.match(md, /input_tokens 100/);
  assert.doesNotMatch(md, /0provider|source provider/, '字符串字段不得进汇总');
  assert.match(md, /两侧\*\*不合计\*\*/);
});

test('漂移与路径 deny 降级进告警清单', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM'), drift: true });
  const r = await buildTopicReport(l);
  assert.ok(r.rounds[0]!.guardFlags.some((g) => /漂移 1 个文件/.test(g)));
  assert.match(renderTopicReport(r), /漂移 1 个文件/);
});

test('EV-139：比不了进告警清单，不因两个桶都空而一声不吭', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM'), driftUnknown: true });
  const r = await buildTopicReport(l);
  const flags = r.rounds[0]!.guardFlags;
  assert.ok(
    flags.includes('漂移无法判定（对象已不在：送审快照的 tree 0123456789ab 在审查期间被清理，fail）'),
    `guardFlags=${JSON.stringify(flags)}`,
  );
  assert.ok(!flags.some((g) => /漂移 \d+ 个文件/.test(g)), '比不了不能写成「漂移 N 个文件」');
  assert.match(renderTopicReport(r), /漂移无法判定/);
});

/*
 * EV-137：guard.forged_role_file 是保留字段、写侧恒 false，全仓没有检测去置它。
 * report 据它打「角色后缀伪造」旗标，等于替没做过的检测作证——所以不读。手工置 true 也不出这面旗。
 */
test('EV-137 G1：forged_role_file 即使为 true 也不打「角色后缀伪造」旗标（保留字段，不代表检测过）', async () => {
  const l = await archive();
  await seedRound(l, {
    rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM'), forgedRoleFile: true,
  });
  const r = await buildTopicReport(l);
  assert.ok(!r.rounds[0]!.guardFlags.some((g) => /角色后缀伪造/.test(g)), `guardFlags=${JSON.stringify(r.rounds[0]!.guardFlags)}`);
  assert.doesNotMatch(renderTopicReport(r), /角色后缀伪造/);
});

// ── 多轮 ──

test('多轮按轮次升序，采纳率跨轮累计', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  await seedRound(l, { rerunIndex: 2, runId: 'R2', gemini: review(['c:1']), glm: review(['d:1'], [], 'GLM') });

  const r = await buildTopicReport(l);
  assert.deepEqual(r.rounds.map((d) => d.rerunIndex), [1, 2]);
  assert.deepEqual(r.rounds.map((d) => d.runId), ['R1', 'R2']);

  const rounds: RoundReport[] = r.rounds.map((d) => ({
    ...d, disposals: { 接受: 2, 驳回: 1, 暂缓: 0 },
  }));
  assert.deepEqual(acceptanceRate(rounds), { accepted: 4, total: 6 });
});

test('缺 run.json 的轮次照样出现在报告里，并说明元数据缺失', async () => {
  const l = await archive();
  // 只放一份审查文档，不放 run.json
  await writeArtifact({
    layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1,
    content: '# 孤立的审查文档\n',
  });
  const r = await buildTopicReport(l);
  assert.equal(r.rounds.length, 1, '有工件就得出现，不能因为缺元数据就当它不存在');
  assert.ok(r.rounds[0]!.notes.some((n) => /找不到对应的/.test(n)));
  assert.match(renderTopicReport(r), /找不到对应的/);
});

test('task.json 的降级与争议项被带进报告', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  const taskPath = path.join(l.archiveRoot, l.topic, 'task.json');
  const task = JSON.parse(await fs.readFile(taskPath, 'utf8')) as TaskMeta;
  task.disputed = true;
  task.disputes = [{ run_id: 'R1', finding_ids: ['X-1', 'Y-2'], note: '双方共同 blocker 被驳回' }];
  await fs.writeFile(taskPath, JSON.stringify(task, null, 2));

  const md = renderTopicReport(await buildTopicReport(l));
  assert.match(md, /双方共同 blocker 被驳回/);
  assert.match(md, /X-1、Y-2/);
});

// ── 降级纪律：读不到就说读不到（审查意见 GLM-r2-09）──

test('verify 记录损坏 → 如实说损坏，不伪装成「从未验证」', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  const vdir = path.join(l.archiveRoot, TOPIC, 'verify', '_meta');
  await fs.mkdir(vdir, { recursive: true });
  await fs.writeFile(path.join(vdir, 'verify-R9.json'), '{ 这不是 JSON', 'utf8');

  const r = await buildTopicReport(l);
  assert.ok(
    r.notes.some((n) => /verify 记录损坏/.test(n)),
    `应如实报损坏，实际 notes：${r.notes.join(' | ')}`,
  );
  const md = renderTopicReport(r);
  assert.match(md, /verify 记录损坏/);
  // 「记录损坏」被渲染成「尚无记录」恰是 P5 要防的误读
  assert.doesNotMatch(md, /- 尚无 verify 记录/);
});

test('裁决件读不到不让整份复盘崩溃', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  // 写一份裁决件，然后把它变成目录——readFile 必然失败
  const p = path.join(l.archiveRoot, TOPIC, 'plan', `${new Date().toISOString().slice(0, 10)}-${TOPIC}-revised-claude.md`);
  await fs.mkdir(p, { recursive: true });

  const r = await buildTopicReport(l); // 不该抛
  assert.ok(
    r.rounds[0]!.notes.some((n) => /裁决件读取失败/.test(n)),
    `应进 notes，实际：${r.rounds[0]!.notes.join(' | ')}`,
  );
  assert.equal(r.rounds[0]!.disposals, null);
});

// ── EV-144：没进时间线的运行（计划 r2 §3.6 / §4.1 V1～V7）──

/** 摆一份没产出审查文档的运行：只有 run.json（与可选的 .failed.json 登记），阶段目录里没有它的审查文档 */
async function seedUnlisted(
  l: ArchiveLayout,
  opts: {
    runId: string;
    rerunIndex?: number;
    status: 'running' | 'success' | 'failed' | 'cancelled';
    gateState?: string;
    termination?: import('../../src/trivium/types.js').RunTermination;
    /** 入选侧全部失败：每侧登记一份 .failed.json */
    allSidesFailed?: boolean;
  },
) {
  const meta = newRunMeta({
    runId: opts.runId, topic: l.topic, stage: 'plan', rerunIndex: opts.rerunIndex ?? 1,
    command: 'test', promptHint: '焦点', taskGoal: null, criticsSelected: ['gemini', 'glm'],
    treeHash: 'T', gitHead: 'HEAD', dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
  });
  meta.status = opts.status;
  meta.gate.state = opts.gateState ?? (opts.status === 'running' ? 'running' : opts.status);
  if (opts.status !== 'running') meta.finished_at = '2026-09-27T01:00:00.000Z';
  if (opts.termination) meta.termination = opts.termination;
  if (opts.allSidesFailed) {
    for (const c of ['gemini', 'glm'] as const) {
      const w = await writeMeta(l, 'plan', `review-${c}-${opts.runId}.failed.json`,
        JSON.stringify({ critic: c, status: 'failed', fail_reason: '桩注入的进程级失败' }) + '\n');
      meta.artifacts.push({ path: w.relPath, sha256: w.sha256 });
    }
  }
  await writeRunMeta(l, 'plan', meta);
  return meta;
}

test('EV-144 V1：只有一份被取消的运行 ⇒ 轮次 0，另列一条「被 review --cancel 取消」，头部注明另有 1 次', async () => {
  const l = await archive();
  await seedUnlisted(l, { runId: 'C1', status: 'cancelled' });
  const r = await buildTopicReport(l);
  assert.equal(r.rounds.length, 0);
  assert.equal(r.unlistedRuns.length, 1);
  assert.equal(r.unlistedRuns[0]!.runId, 'C1');
  assert.equal(r.unlistedRuns[0]!.label, '被 review --cancel 取消');
  assert.ok(r.notes.some((n) => /没有任何已产出审查工件的轮次（另有 1 次运行未产出审查文档/.test(n)), r.notes.join(' | '));
  const md = renderTopicReport(r);
  assert.match(md, /\*\*轮次总数\*\*：0（另有 1 次运行未产出审查文档，见时间线下方）/);
  assert.match(md, /### 未进时间线的运行（没有产出审查文档）/);
  assert.match(md, /\| plan \| r1 \| `C1` \|.*\| cancelled \| 被 review --cancel 取消 \|/);
});

test('EV-144 V2：入选侧全部失败 + 同轮次号的成功重跑 ⇒ 时间线只列重跑，失败那次进下表且预定轮次同为 r1', async () => {
  const l = await archive();
  await seedUnlisted(l, { runId: 'A1', status: 'failed', allSidesFailed: true });
  await seedRound(l, { rerunIndex: 1, runId: 'A2', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  const r = await buildTopicReport(l);
  assert.deepEqual(r.rounds.map((d) => d.runId), ['A2']);
  assert.equal(r.unlistedRuns.length, 1, JSON.stringify(r.unlistedRuns));
  assert.equal(r.unlistedRuns[0]!.runId, 'A1');
  assert.equal(r.unlistedRuns[0]!.rerunIndex, 1);
  assert.equal(r.unlistedRuns[0]!.label, '入选侧全部失败');
  assert.match(renderTopicReport(r), /同一轮次号可能在上下两张表里各出现一次/);
});

test('EV-144 V3：停在 running 的运行 ⇒ 说明「进行中，或没走到收尾」（report 只读归档，分不出这两种）', async () => {
  const l = await archive();
  await seedUnlisted(l, { runId: 'U1', status: 'running' });
  const r = await buildTopicReport(l);
  assert.equal(r.unlistedRuns[0]!.label, '进行中，或没走到收尾');
  assert.equal(r.unlistedRuns[0]!.finishedAt, null);
});

test('EV-144 V4：两条事后收尾写成的 failed ⇒ 说明分别带退出码与失联原因', async () => {
  const l = await archive();
  await seedUnlisted(l, { runId: 'W1', status: 'failed', termination: { by: 'worker_exception', exit_code: 69 } });
  await seedUnlisted(l, { runId: 'W2', status: 'failed', termination: { by: 'worker_lost', reason: 'pid_gone' } });
  const r = await buildTopicReport(l);
  assert.deepEqual(
    r.unlistedRuns.map((u) => [u.runId, u.label]),
    [['W1', 'worker 异常（退出码 69）'], ['W2', 'worker 失联（pid_gone）']],
  );
  assert.deepEqual(r.unlistedRuns[1]!.termination, { by: 'worker_lost', reason: 'pid_gone' });
});

test('EV-144 V5：纯文档跳过（success、skipped_doc_only）⇒ 说明「纯文档跳过（FR-23）」', async () => {
  const l = await archive();
  await seedUnlisted(l, { runId: 'D1', status: 'success', gateState: 'skipped_doc_only' });
  const r = await buildTopicReport(l);
  assert.equal(r.unlistedRuns[0]!.label, '纯文档跳过（FR-23）');
});

test('EV-144 V6：读不出来的 run.json 不进下表，进 notes（此前被静默跳过）', async () => {
  const l = await archive();
  await fs.writeFile(path.join(l.archiveRoot, TOPIC, 'plan', '_meta', 'run-BAD.json'), '{ 坏掉的', 'utf8');
  const r = await buildTopicReport(l);
  assert.equal(r.unlistedRuns.length, 0);
  assert.ok(r.notes.some((n) => /plan\/_meta\/run-BAD\.json` 读不出来/.test(n)), r.notes.join(' | '));
});

test('EV-144 V7：所有运行都进了时间线 ⇒ 不渲染下表，头部也没有「另有」半句（防噪声）', async () => {
  const l = await archive();
  await seedRound(l, { rerunIndex: 1, runId: 'R1', gemini: review(['a:1']), glm: review(['b:1'], [], 'GLM') });
  const r = await buildTopicReport(l);
  assert.equal(r.unlistedRuns.length, 0);
  const md = renderTopicReport(r);
  assert.doesNotMatch(md, /未进时间线的运行/);
  assert.doesNotMatch(md, /另有 \d+ 次运行/);
});

// ── EV-145：准备阶段与同步路径的事后收尾（事后收尾余项计划 r2 §4.1 V8 / V9）──

test('EV-145 V8：prepare_exception / sync_exception 写成的 failed ⇒ 说明分别写清「未拉起审查员」与「同步路径异常」并带退出码', async () => {
  const l = await archive();
  await seedUnlisted(l, { runId: 'P1', status: 'failed', termination: { by: 'prepare_exception', exit_code: 1 } });
  await seedUnlisted(l, { runId: 'P2', status: 'failed', termination: { by: 'sync_exception', exit_code: 70 } });
  const r = await buildTopicReport(l);
  assert.deepEqual(
    r.unlistedRuns.map((u) => [u.runId, u.label]),
    [['P1', '准备阶段失败，未拉起审查员（退出码 1）'], ['P2', '同步路径异常（退出码 70）']],
  );
});

test('EV-150 V8′：post_spawn_exception 写成的 failed ⇒ 说明写清「派生工作进程之后启动未完成，工作进程已终止」并带退出码', async () => {
  const l = await archive();
  await seedUnlisted(l, { runId: 'Q1', status: 'failed', termination: { by: 'post_spawn_exception', exit_code: 1 } });
  const r = await buildTopicReport(l);
  assert.deepEqual(
    r.unlistedRuns.map((u) => [u.runId, u.label]),
    [['Q1', '派生工作进程之后启动未完成，工作进程已终止（退出码 1）']],
  );
});

test('EV-145 V9：termination.by 的每一个取值都有专门的说明，不落进兜底「failed（gate.state=…）」', async () => {
  const l = await archive();
  const shapes: import('../../src/trivium/types.js').RunTermination[] = [
    ...EXCEPTION_TERMINATION_BY.map((by) => ({ by, exit_code: 1 })),
    { by: 'worker_lost', reason: 'pid_gone' },
  ];
  for (const [i, t] of shapes.entries()) {
    await seedUnlisted(l, { runId: `T${i}`, status: 'failed', termination: t });
  }
  const r = await buildTopicReport(l);
  assert.equal(r.unlistedRuns.length, shapes.length);
  for (const u of r.unlistedRuns) {
    assert.ok(!u.label.startsWith('failed（gate.state='), `${JSON.stringify(u.termination)} 落进了兜底说明：${u.label}`);
  }
});
