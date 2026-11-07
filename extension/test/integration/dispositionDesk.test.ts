/**
 * 裁决台集成测试（FR-8，r2 计划 D9）：首写链路（missing_disposition + fallback-items
 * → 表单含 F 编号行）→ 逐条裁决 → 预览对拍契约 → 落盘 → 磁盘断言；
 * 修复链路（EEXIST 转修复 + hash 防护）；缺口联动批注。
 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TriviumEnv } from '../../src/env/config';
import { TriviumCli } from '../../src/cli/triviumCli';
import { TriviumCommands } from '../../src/cli/commands';
import { TerminalRelay } from '../../src/launch/terminalRelay';
import { StateWatch } from '../../src/monitor/stateWatch';
import { AnnotationHub } from '../../src/reviews/annotationHub';
import { Cockpit } from '../../src/ui/cockpit';
import type { TriviumServices } from '../../src/services';
import { memoryPresetStore } from './fakePresets';
import { buildPhase2Fixture, waitFor, STUB_CLI_SRC, type Phase2Fixture } from './fixtureLib';
import { parseDispositionDoc } from '../../src/disposition/dispositionDraft';

const TOPIC = 'DemoTopic';
const STAGE = 'code';
const RUN = '20261106T000005Z';

/** 桩 gate 应答：首写（missing_disposition 提前返回——fallback_ids 恒空） */
function gateFirstWrite() {
  return {
    code: 2,
    json: {
      ok: false, stage: STAGE, rerun_index: 1, run_id: RUN,
      failures: [{ code: 'missing_disposition', message: '裁决件缺失：期望 2026-11-07-DemoTopic-response-glm.md 形态' }],
      warnings: [],
      structured_ids: ['CLAUDE-01', 'AGY-01', 'CODEX-01'],
      fallback_ids: [],
      degraded_ids: [],
      disposition: null,
      review_loop: { round: 1, max_rounds: 5 },
      round_verdict: {
        sides: { claude: 'pass-after-changes', gemini: 'pass', codex: 'reject' },
        excluded: {}, counts: { pass: 1, 'pass-after-changes': 1, reject: 1 },
        outcome: 'pass-after-changes', next_action: 'proceed',
      },
      next_action: 'proceed', round_line: '第 1/5 轮',
    },
  };
}

suite('裁决台（FR-8）', function () {
  this.timeout(90_000);
  let fx: Phase2Fixture;
  let cockpit: Cockpit;
  let stateWatch: StateWatch;

  suiteSetup(async () => {
    fx = await buildPhase2Fixture();
    await fs.mkdir(path.join(fx.root, '.trivium', 'stub'), { recursive: true });
    await fs.writeFile(path.join(fx.root, '.trivium', 'bin', 'trivium'), STUB_CLI_SRC, { mode: 0o755 });
  });

  teardown(async () => {
    cockpit?.dispose();
    stateWatch?.dispose();
  });

  async function makeCockpit(): Promise<void> {
    const env = new TriviumEnv(fx.root);
    const cli = new TriviumCli(fx.root);
    stateWatch = new StateWatch(fx.root);
    const services: TriviumServices = {
      root: fx.root, env, cli, cmds: new TriviumCommands(cli),
      relay: new TerminalRelay(), stateWatch,
      annotationHub: new AnnotationHub(fx.root),
      saveGuard: null, presets: memoryPresetStore(),
      repoRoot: fx.root, disposables: { push: () => {} },
    };
    cockpit = new Cockpit(services);
    await cockpit.open();
  }

  async function setStub(map: Record<string, unknown>): Promise<void> {
    await fs.writeFile(path.join(fx.root, '.trivium', 'stub', 'responses.json'), JSON.stringify(map));
  }

  test('首写链路：missing_disposition → 表单含结构化 + fallback 期望行 → 落盘契约对拍', async () => {
    // fallback 期望集来源文件（gemini 侧 parse_fallback）——gate 的 fallback_ids 恒空，不靠它
    await fs.writeFile(
      path.join(fx.metaDir, `review-gemini-${RUN}.fallback-items.md`),
      ['- AGY-F01: 总判断段第一条', '- AGY-F02: 分组段第二条'].join('\n'),
    );
    // 夹具 run.v3 补 artifacts（addresses 派生源：run.json.artifacts[]，不按日期拼名）；
    // gemini 侧设 parse_fallback——与 fallback-items 文件呼应（ok 侧无清单、不进期望集）
    await fs.writeFile(
      path.join(fx.metaDir, `run-${RUN}.json`),
      JSON.stringify({
        schema: 'trivium.run.v3', run_id: RUN, topic: TOPIC, stage: STAGE, rerun_index: 1,
        driver: 'glm', critics_selected: ['claude', 'gemini', 'codex'],
        critics: { claude: { status: 'ok' }, gemini: { status: 'parse_fallback' }, codex: { status: 'ok' } },
        started_at: '2026-11-06T00:00:05.000Z', finished_at: '2026-11-06T00:10:00.000Z',
        artifacts: [
          { path: `${TOPIC}/${STAGE}/_meta/brief-claude-${RUN}.md` },
          { path: `${TOPIC}/${STAGE}/2026-11-06-DemoTopic-claude.md` },
          { path: `${TOPIC}/${STAGE}/2026-11-06-DemoTopic-gemini.md` },
          { path: `${TOPIC}/${STAGE}/2026-11-06-DemoTopic-codex.md` },
          { path: `${TOPIC}/${STAGE}/2026-11-06-DemoTopic-response-glm.md` },
        ],
      }, null, 2),
    );
    await setStub({ gate: gateFirstWrite(), gateAfter: gateFirstWrite() });
    await makeCockpit();
    await cockpit.handleMessageForTest({ type: 'gate-open', topic: TOPIC, stage: STAGE });
    await waitFor(() => cockpit.deskForTest() !== null, 30_000);
    const desk = cockpit.deskForTest()!;
    assert.equal(desk.form, 'draft');
    assert.equal(desk.driver, 'glm', 'role 定位：run-<runId>.json 的 driver（夹具 run.v3 写 glm）');
    assert.equal(desk.items, 5, 'CLAUDE-01/AGY-01/CODEX-01 + AGY-F01/F02（fallback 期望集；编号用真实前缀形态，插件解析正则对齐 disposition.ts）');
    // 逐条裁决（webview 全量回传语义）
    await cockpit.handleMessageForTest({
      type: 'desk-update',
      rows: [
        { id: 'CLAUDE-01', verdict: '接受', reason: '成立，补锚点用例', action: '补 test/integration/anchors' },
        { id: 'AGY-01', verdict: '驳回', reason: '与现行契约一致，无需改', action: '' },
        { id: 'CODEX-01', verdict: '暂缓', reason: '等 Phase4 一并处理', action: '' },
        { id: 'AGY-F01', verdict: '接受', reason: 'fallback 条目成立', action: '' },
        { id: 'AGY-F02', verdict: '接受', reason: '同上', action: '' },
      ],
    });
    await cockpit.handleMessageForTest({ type: 'desk-preview' });
    await cockpit.handleMessageForTest({ type: 'desk-save' });
    await waitFor(async () => {
      const files = await fs.readdir(path.join(fx.root, '.reviews', TOPIC, STAGE));
      return files.some((f) => /-response-glm\.md$/.test(f));
    }, 30_000);
    const stageDir = path.join(fx.root, '.reviews', TOPIC, STAGE);
    const name = (await fs.readdir(stageDir)).find((f) => /-response-glm\.md$/.test(f))!;
    const text = await fs.readFile(path.join(stageDir, name), 'utf8');
    // 契约对拍：front-matter + 表格
    const parsed = parseDispositionDoc(text);
    assert.equal(parsed.frontMatter['schema'], 'trivium.disposition.v1');
    assert.equal(parsed.frontMatter['stage'], 'code');
    assert.equal(parsed.frontMatter['role'], 'glm');
    assert.equal(parsed.frontMatter['kind'], 'response');
    assert.equal(parsed.frontMatter['run_id'], RUN);
    assert.equal(parsed.rows.length, 5);
    assert.ok(text.includes('| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |'));
    // addresses 派生自 run.json.artifacts[]：有效侧三家审查正文；_meta/brief 与裁决件（response-glm）排除
    assert.deepEqual(parsed.frontMatter['addresses'], [
      '2026-11-06-DemoTopic-claude.md',
      '2026-11-06-DemoTopic-gemini.md',
      '2026-11-06-DemoTopic-codex.md',
    ]);
  });

  test('修复链路：既有件缺理由 → 修复模式预填 → 写回（EEXIST 场景验证）', async () => {
    const stageDir = path.join(fx.root, '.reviews', TOPIC, STAGE);
    // 造一份既有裁决件（CLAUDE-01 理由为空 → gate 报 empty_reason）
    const existing = [
      '---',
      'schema: trivium.disposition.v1',
      `topic: ${TOPIC}`,
      `stage: ${STAGE}`,
      'role: glm',
      'kind: response',
      `run_id: ${RUN}`,
      'addresses:',
      '  - 2026-11-06-DemoTopic-claude.md',
      '---',
      '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| CLAUDE-01 | claude | blocker | 接受 |  | 补用例 |',
      '| AGY-01 | gemini | minor | 驳回 | 不成立 | — |',
      '',
      '（表外附注：原文手术保真验证）',
      '',
    ].join('\n');
    const existingName = '2026-11-07-DemoTopic-response-glm.md';
    await fs.writeFile(path.join(stageDir, existingName), existing);
    await setStub({
      gate: {
        code: 2,
        json: {
          ok: false, stage: STAGE, rerun_index: 1, run_id: RUN,
          failures: [{ code: 'empty_reason', message: '理由为空', ids: ['CLAUDE-01'] }],
          warnings: [],
          structured_ids: ['CLAUDE-01', 'AGY-01'],
          fallback_ids: ['CLAUDE-01', 'AGY-01'],
          degraded_ids: [],
          disposition: path.join(stageDir, existingName),
          review_loop: null, round_verdict: null, next_action: null, round_line: null,
        },
      },
    });
    await makeCockpit();
    await cockpit.handleMessageForTest({ type: 'gate-open', topic: TOPIC, stage: STAGE });
    await waitFor(() => cockpit.deskForTest() !== null, 30_000);
    const desk = cockpit.deskForTest()!;
    assert.equal(desk.form, 'repair', 'disposition 非空 → 修复模式');
    // CLAUDE-01 修复行预填（接受 + 空理由）；补理由后写回
    await cockpit.handleMessageForTest({
      type: 'desk-update',
      rows: [{ id: 'CLAUDE-01', verdict: '接受', reason: '核实成立，补两用例', action: '补 pathCoverage 用例' }],
    });
    await cockpit.handleMessageForTest({ type: 'desk-preview' });
    await cockpit.handleMessageForTest({ type: 'desk-save' });
    await waitFor(async () => {
      const now = await fs.readFile(path.join(stageDir, existingName), 'utf8');
      return now.includes('核实成立，补两用例');
    }, 30_000);
    const afterText = await fs.readFile(path.join(stageDir, existingName), 'utf8');
    const after = parseDispositionDoc(afterText);
    assert.equal(after.rows.length, 2, 'AGY-01 合法行保留（不丢）');
    assert.equal(after.rows.find((r) => r.id === 'AGY-01')!.verdict, '驳回');
    assert.ok(afterText.includes('（表外附注：原文手术保真验证）'), '表外正文经原文手术保留');
    await fs.rm(path.join(stageDir, existingName));
  });

  test('联动批注：缺口编号定位到行（复用 Phase2 夹具锚点）', async () => {
    await setStub({ gate: gateFirstWrite() });
    await makeCockpit();
    await cockpit.handleMessageForTest({ type: 'gate-open', topic: TOPIC, stage: STAGE });
    await waitFor(() => cockpit.deskForTest() !== null, 30_000);
    // Hub scope 对齐 + 焦点 run 后，locate-finding 打开对应文件（不断言 UI，只断言不抛 + 有锚时无异常路径）
    await cockpit.handleMessageForTest({ type: 'locate-finding', id: 'C-01' });
    await new Promise((r) => setTimeout(r, 300));
    // 无锚编号 → 如实提示，不抛
    await cockpit.handleMessageForTest({ type: 'locate-finding', id: 'ZZ-99' });
    await new Promise((r) => setTimeout(r, 300));
  });
});
