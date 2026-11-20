/**
 * 真实 gate 对拍（r2 计划 D9，CODEX-03 建议）：用本仓真实 wrapper 跑
 * `gate --check --json`，断言输出结构与插件的 GateCheckOutput 类型逐字段对齐。
 *
 * 说明（对 r2 计划原文的微调，交付说明同步记录）：不在本仓 `.reviews/` 落测试草稿——
 * 那会污染真实主题的归档与后续 gate 判定；草稿正确性由单测对拍真实裁决件
 * （.reviews/agy适配1.5.2 两件）+ 生成后自动 gate 复核兜底，本件负责**输出契约**对齐。
 */
import * as assert from 'node:assert/strict';
import { TriviumCli } from '../../src/cli/triviumCli';
import type { GateCheckOutput } from '../../src/cli/commands';
import path from 'node:path';

const REPO = process.env['TRIVIUM_REAL_REPO'] ?? path.resolve(__dirname, '../../../..');
const TOPIC = process.env['TRIVIUM_REAL_TOPIC'] ?? 'VSCode插件Phase3';

suite('真实 gate --check 输出契约对拍', function () {
  this.timeout(120_000);
  let root: string;
  suiteSetup(async () => {
    // gate --check 会更新 task.json 的共同阻断记录，必须在隔离仓执行。
    ({ root } = await buildTmpRepo());
    await fsp.cp(path.join(REPO, '.reviews', TOPIC), path.join(root, '.reviews', TOPIC), { recursive: true });
  });
  suiteTeardown(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  test('plan 阶段：输出字段与 GateCheckOutput 逐项对齐（含 loop 四字段）', async () => {
    const cli = new TriviumCli(root);
    assert.ok(await cli.wrapperExists(), `未找到 ${REPO}/.trivium/bin/trivium（应在 TriviumCode 仓内运行）`);
    const r = await cli.runJson<GateCheckOutput>(['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json'], 120_000);
    assert.ok(r.json, `读不到 JSON 输出（退出码 ${r.code}）`);
    const out = r.json!;
    // 顶层字段逐项（cli.ts:1674-1685 的 emitJson 形状）
    assert.equal(typeof out.ok, 'boolean');
    assert.equal(out.stage, 'plan');
    assert.equal(typeof out.rerun_index, 'number');
    assert.equal(typeof out.run_id, 'string');
    assert.ok(Array.isArray(out.failures));
    assert.ok(Array.isArray(out.warnings));
    assert.ok(Array.isArray(out.structured_ids));
    assert.ok(Array.isArray(out.fallback_ids));
    assert.ok(Array.isArray(out.degraded_ids));
    assert.ok('disposition' in out);
    assert.ok('review_loop' in out);
    assert.ok('round_verdict' in out);
    assert.ok('next_action' in out);
    assert.ok('round_line' in out);
    // 退出码协议：0 通过 / 2 未通过
    assert.ok(r.code === 0 || r.code === 2, `退出码应为 0/2，实际 ${r.code}`);
    if (!out.ok) assert.equal(r.code, 2, 'failures 非空必须退 2');
    // 本主题 r1 轮已裁决齐备：真实运行时应 ok=true（若在 r1 裁决完成后执行）
    if (out.ok) {
      assert.equal(r.code, 0);
      assert.ok(out.disposition, 'ok=true 时应给出裁决件路径');
      assert.ok(out.round_line !== null, '带轮次链的运行应给 round_line');
      assert.ok(out.round_verdict !== null && typeof out.round_verdict.sides === 'object');
    }
  });

  test('失败码字段形态：failures[].code/message/ids 与插件消费对齐', async () => {
    const cli = new TriviumCli(root);
    const r = await cli.runJson<GateCheckOutput>(['gate', '--stage', 'code', '--topic', 'RealGate闭环', '--check', '--json'], 120_000);
    assert.equal(r.code, 2);
    assert.ok(r.json?.failures.some(f => f.code === 'missing_disposition'));
    assert.ok(r.json);
    for (const f of r.json.failures ?? []) {
      assert.equal(typeof f.code, 'string');
      assert.equal(typeof f.message, 'string');
      if (f.ids !== undefined) assert.ok(Array.isArray(f.ids));
    }
  });
});

// ── r3 CLAUDE-09：真实 gate 闭环——临时仓生成草稿并直调真实 gate 校验 ──

import { promises as fsp } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildGapModel } from '../../src/disposition/gateGapModel';
import { readRunMeta, allFallbackIds, expectedAddresses, resolveDriverId } from '../../src/disposition/runMeta';
import { renderDisposition, draftFileName } from '../../src/disposition/dispositionDraft';
import type { GateCheckOutput as GC } from '../../src/cli/commands';

async function buildTmpRepo(): Promise<{ root: string; topic: string; runId: string }> {
  const os = await import('node:os');
  const root = await fsp.mkdtemp(await fsp.mkdtemp(path.join(os.tmpdir(), 'trivium-real-gate-')) + '/repo-');
  const topic = 'RealGate闭环';
  const runId = '20261107T030000Z';
  await fsp.mkdir(path.join(root, '.trivium', 'bin'), { recursive: true });
  // wrapper 直接拷贝本仓的（内嵌 node 绝对路径与安装副本脚本绝对路径，跨目录可用）
  await fsp.copyFile(path.join(REPO, '.trivium', 'bin', 'trivium'), path.join(root, '.trivium', 'bin', 'trivium'));
  await fsp.writeFile(path.join(root, '.trivium', 'config.yaml'), [
    'schema: trivium.config.v2',
    'archive_root: .reviews',
    `runtime:`,
    `  run_root: ${root}/runs`,
    'review:',
    '  default_critics: [claude]',
    '',
  ].join('\n'));
  const metaDir = path.join(root, '.reviews', topic, 'code', '_meta');
  const stageDir = path.join(root, '.reviews', topic, 'code');
  await fsp.mkdir(metaDir, { recursive: true });
  // run.v3 的交叉校验遍布全件（critics 侧形状、round_verdict/requested_routes 的
  // 入选集合、artifacts 的 sha256 等）——以本仓真实运行元数据为模板**原样保留三家
  // 结构**，只改 topic/runId/driver 与 artifacts 路径前缀，保证契约自洽
  // （手写最小件逐字段必被 ajv 拒：critics.claude 缺 vendor、artifacts 缺 sha256、
  //  round_verdict.sides 不在入选集合……实测）
  const templatePath = path.join(REPO, '.reviews', 'VSCode插件Phase3', 'code', '_meta', 'run-20261107T014536Z.json');
  const template = JSON.parse(await fsp.readFile(templatePath, 'utf8')) as {
    artifacts?: Array<Record<string, string>>;
    snapshot?: Record<string, unknown>;
  } & Record<string, unknown>;
  template['run_id'] = runId;
  template['topic'] = topic;
  template['driver'] = 'glm';
  template['artifacts'] = (template['artifacts'] ?? []).map((a) => ({ ...a, path: a['path']!.replace('VSCode插件Phase3', topic) }));
  if (template['snapshot'] && typeof template['snapshot'] === 'object') {
    delete template['snapshot']['after_tree_hash']; // 基线缺席走「无基线」分支，不伪造 tree hash
  }
  await fsp.writeFile(path.join(metaDir, `run-${runId}.json`), JSON.stringify(template, null, 2));
  // 三家审查正文（文件名与 artifacts 登记一致）与结构化意见（review.v2 最小件）
  const reviewDocs = (template['artifacts'] ?? [])
    .map((a) => a['path']!)
    .filter((p) => !p.includes('/_meta/') && /-(claude|gemini|codex)\.md$/.test(p))
    .map((p) => p.slice(p.lastIndexOf('/') + 1));
  for (const name of reviewDocs) {
    await fsp.writeFile(path.join(stageDir, name), '# 审查正文（最小）\n');
  }
  const PREFIX: Record<string, string> = { claude: 'CLAUDE', gemini: 'AGY', codex: 'CODEX' };
  for (const critic of ['claude', 'gemini', 'codex']) {
    await fsp.writeFile(
      path.join(metaDir, `review-${critic}-${runId}.json`),
      JSON.stringify({
        schema: 'trivium.review.v2', verdict: 'pass-after-changes', summary: '总判断',
        findings: [{ id: `${PREFIX[critic]}-01`, severity: 'minor', layer: 'code', kind: 'correctness', location: 'src/a.ts:1', problem: '演示意见', evidence: '证据', suggestion: '建议', confidence: 'high' }],
      }, null, 2),
    );
  }
  await fsp.writeFile(
    path.join(root, '.reviews', topic, 'task.json'),
    JSON.stringify({
      schema: 'trivium.task.v1', topic, created_at: '2026-11-07T03:00:00.000Z', updated_at: '2026-11-07T03:05:00.000Z',
      runs: [{ run_id: runId, stage: 'code', rerun_index: 1, status: 'success', review_mode: 'full', started_at: '2026-11-07T03:00:00.000Z', driver: 'glm' }],
      gate: { stage: 'code', state: 'review_done_awaiting_disposition', since: '2026-11-07T03:05:00.000Z', run_id: runId },
      approvals: [], degradations: [], disputed: false, disputes: [], drivers: { code: { driver: 'glm' } },
    }, null, 2),
  );
  // 真实 gate 依赖 git（快照与漂移检测；工件须纳入版本管理）——init + 基线提交；
  // 夹具仓禁用 hooks（本机可能装有 TriviumCode 全局 commit 拦截，与夹具仓无关）
  const git = (args: string): void => {
    execFileSync('git', ['-c', 'core.hooksPath=', ...args.split(' ')], { cwd: root, stdio: 'ignore' });
  };
  git('init -q');
  git('config user.email t@t');
  git('config user.name t');
  git('add -A');
  git('commit -q -m baseline');
  return { root, topic, runId };
}

suite('真实 gate 闭环：临时仓首写 → 插件生成 → 真实闸门通过', function () {
  this.timeout(120_000);

  test('首写：missing_disposition → 插件草稿落盘 → 真实 gate ok=true', async () => {
    const { root, topic } = await buildTmpRepo();
    const cli = new TriviumCli(root);
    // ① 真实 gate：应报 missing_disposition 且给出结构化编号
    const r1 = await cli.runJson<GC>(['gate', '--stage', 'code', '--topic', topic, '--check', '--json'], 120_000);
    assert.ok(r1.json, '真实 gate 应产出 JSON');
    assert.equal(r1.json!.ok, false);
    assert.ok(r1.json!.failures.some((f) => f.code === 'missing_disposition'));
    assert.deepEqual([...r1.json!.structured_ids].sort(), ['AGY-01', 'CLAUDE-01', 'CODEX-01'], '三家各一条');
    // ② 插件数据面：与 cockpit.openDesk 同源的三件套
    const runId = r1.json!.run_id;
    const fsApi = { readFile: (p: string) => fsp.readFile(p, 'utf8') };
    const meta = await readRunMeta(fsApi, path.join(root, '.reviews', topic, 'code', '_meta'), runId);
    assert.ok(meta);
    const fallbackExpected = await allFallbackIds(fsApi, meta!, path.join(root, '.reviews', topic, 'code', '_meta'));
    const driver = await resolveDriverId(fsApi, meta, path.join(root, '.reviews'), topic, 'code');
    const addresses = expectedAddresses(meta!, topic, 'code');
    const model = buildGapModel({ check: r1.json!, topic, stage: 'code', meta, fallbackExpected, driver, addresses, existingRows: [] });
    // ③ 裁决（驳回：code 阶段无 next_plan 要求）→ 草稿落盘（wx）
    const text = renderDisposition({
      topic, stage: 'code', runId, driver: driver!.driver, addresses,
      rows: [
        { id: 'CLAUDE-01', critic: 'claude', severity: 'minor', verdict: '驳回', reason: '演示意见与实现不符', action: null },
        { id: 'AGY-01', critic: 'gemini', severity: 'minor', verdict: '驳回', reason: '演示意见不采纳', action: null },
        { id: 'CODEX-01', critic: 'codex', severity: 'minor', verdict: '驳回', reason: '演示意见不采纳', action: null },
      ],
      titleNote: '代码审应答',
    });
    const fileName = draftFileName({ topic, rerunIndex: model.rerunIndex, stage: 'code', driver: driver!.driver });
    const abs = path.join(root, '.reviews', topic, 'code', fileName);
    await fsp.writeFile(abs, text, { flag: 'wx' });
    // ④ 真实 gate 复核：插件生成件必须通过裁决齐备校验
    const r2 = await cli.runJson<GC>(['gate', '--stage', 'code', '--topic', topic, '--check', '--json'], 120_000);
    assert.ok(r2.json, '复核应产出 JSON');
    assert.equal(r2.json!.ok, true, `插件生成件须过真实闸门；实际 failures：${JSON.stringify(r2.json!.failures)}`);
    await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined);
    void execFileSync; // 保留引用占位（避免未用 import）
  });

  test('无表头修复：坏裁决件 → cockpit 生产链路重建 → 真实 gate ok=true', async () => {
    const { root, topic } = await buildTmpRepo();
    const cli = new TriviumCli(root);
    // ① 预置一份坏件（无表格、front-matter 残缺）→ gate 报 bad_front_matter/unparsable_table
    const badName = '2026-11-07-RealGate闭环-response-glm.md';
    await fsp.writeFile(path.join(root, '.reviews', topic, 'code', badName), '这不是一份合法裁决件：没有 front-matter 也没有表格。\n');
    const r1 = await cli.runJson<GC>(['gate', '--stage', 'code', '--topic', topic, '--check', '--json'], 120_000);
    assert.ok(r1.json, 'gate 输出读不到必须失败（不得静默通过，r4 CLAUDE-02）');
    assert.ok(r1.json!.failures.some((f) => f.code === 'bad_front_matter' || f.code === 'unparsable_table' || f.code === 'missing_findings'));
    // ② 走 cockpit 生产分支（r4 CLAUDE-02：不经旁路渲染——openDesk 读真实 gate 输出
    // 与 run 元数据，surgery=null 重建、预览绑定、replace 落盘全链路）
    const { Cockpit } = await import('../../src/ui/cockpit');
    const { TriviumEnv } = await import('../../src/env/config');
    const { TriviumCommands } = await import('../../src/cli/commands');
    const { TerminalRelay } = await import('../../src/launch/terminalRelay');
    const { StateWatch } = await import('../../src/monitor/stateWatch');
    const { AnnotationHub } = await import('../../src/reviews/annotationHub');
    const { memoryPresetStore } = await import('../integration/fakePresets');
    const env = new TriviumEnv(root);
    const cmds = new TriviumCommands(cli);
    const stateWatch = new StateWatch(root);
    const cockpit = new Cockpit({
      root, env, cli, cmds, relay: new TerminalRelay(), stateWatch,
      annotationHub: new AnnotationHub(root), saveGuard: null, presets: memoryPresetStore(),
      repoRoot: root, disposables: { push: () => {} },
    });
    try {
      await cockpit.open();
      await cockpit.handleMessageForTest({ type: 'gate-open', topic, stage: 'code' });
      for (let i = 0; i < 50 && !cockpit.deskForTest(); i++) await new Promise((r) => setTimeout(r, 100));
      const desk0 = cockpit.deskForTest();
      assert.ok(desk0, '裁决台应打开');
      assert.equal(desk0!.form, 'repair', 'disposition 非空 → 修复模式');
      await cockpit.handleMessageForTest({
        type: 'desk-update',
        rows: [
          { id: 'CLAUDE-01', verdict: '驳回', reason: '演示意见与实现不符', action: '' },
          { id: 'AGY-01', verdict: '驳回', reason: '演示意见不采纳', action: '' },
          { id: 'CODEX-01', verdict: '驳回', reason: '演示意见不采纳', action: '' },
        ],
      });
      await cockpit.handleMessageForTest({ type: 'desk-preview' });
      await cockpit.handleMessageForTest({ type: 'desk-save' });
      // 落盘即内部复核（真实 gate）；稍等链路完成
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      cockpit.dispose();
      stateWatch.dispose();
    }
    // ③ 真实 gate 终判：重建件必须过闸门
    const r2 = await cli.runJson<GC>(['gate', '--stage', 'code', '--topic', topic, '--check', '--json'], 120_000);
    assert.ok(r2.json, '复核输出读不到必须失败');
    assert.equal(r2.json!.ok, true, `重建件须过真实闸门；实际 failures：${JSON.stringify(r2.json!.failures)}`);
    await fsp.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });
});
