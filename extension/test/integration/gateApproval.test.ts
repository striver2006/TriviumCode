/**
 * 闸门区集成测试（FR-9，r2 计划 D9）：awaiting_approval 浮出与计票、
 * 批准/拒绝（必填理由）/放弃经桩 CLI 断言 argv 与退出码路径、warnings 展示、
 * state 迁移后收敛。
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

const TOPIC = 'DemoTopic';
const STAGE = 'code';
const RUN = '20261106T000005Z';

suite('闸门区与人工审批（FR-9）', function () {
  this.timeout(90_000);
  let fx: Phase2Fixture;
  let cockpit: Cockpit;
  let stateWatch: StateWatch;
  let stubResponses: string;

  suiteSetup(async () => {
    fx = await buildPhase2Fixture();
    stubResponses = path.join(fx.root, '.trivium', 'stub', 'responses.json');
    // 替换 Phase2 夹具的占位 wrapper 为可编程桩（responses.json + last-args.json）
    await fs.mkdir(path.join(fx.root, '.trivium', 'stub'), { recursive: true });
    await fs.writeFile(path.join(fx.root, '.trivium', 'bin', 'trivium'), STUB_CLI_SRC, { mode: 0o755 });
  });

  setup(async () => {
    // 每用例重置：aa 态闸门（run2 归档齐全，计票可从桩 gate 返回）
    await fs.writeFile(path.join(fx.root, '.trivium', 'state.json'), JSON.stringify({
      schema: 'trivium.state.v1',
      updated_at: new Date().toISOString(),
      gates: { 'DemoTopic/code': { topic: TOPIC, stage: STAGE, state: 'awaiting_approval', run_id: RUN, rerun_index: 1, since: '2026-11-07T00:00:00.000Z', driver: 'glm', session_id: null } },
    }, null, 2));
    await fs.writeFile(stubResponses, JSON.stringify({
      gate: {
        code: 0,
        json: {
          ok: true, stage: STAGE, rerun_index: 1, run_id: RUN,
          failures: [],
          warnings: [{ code: 'degraded_round', message: '本轮有一侧降级（演示 warnings 一等展示）' }],
          structured_ids: ['C-01', 'G-01', 'X-01'], fallback_ids: [], degraded_ids: [],
          disposition: null,
          review_loop: { round: 1, max_rounds: 5 },
          round_verdict: {
            sides: { claude: 'pass-after-changes', gemini: 'pass', codex: 'reject' },
            excluded: {}, counts: { pass: 1, 'pass-after-changes': 1, reject: 1 },
            outcome: 'pass-after-changes', next_action: 'proceed',
          },
          next_action: 'proceed', round_line: '第 1/5 轮 · 计票：1 通过 / 1 修改后通过 / 1 不通过 → 修改后通过 · 下一步：进入下一阶段',
        },
      },
      approve: { code: 0, json: { ok: true, topic: TOPIC, stages: [STAGE], decision: 'approved', worktree_summary: { [STAGE]: { available: true, reason: null, run_id: RUN, baseline: 'review_end', baseline_tree: 'a', current_tree: 'b', total: 1, truncated: false, files: [{ status: 'M', path: 'src/sample.ts' }], excluded_prefixes: ['.reviews/', '.trivium/'], budget_ms: 20000, budget_overridden: false } } } },
      abandon: { code: 0, json: { ok: true, topic: TOPIC, stages: [STAGE], decision: 'abandoned' } },
    }));
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
    cockpit.autoConfirmForTest = true;
    await cockpit.open();
  });

  teardown(async () => {
    cockpit.dispose();
    stateWatch.dispose();
  });

  test('awaiting_approval → 闸门卡浮出 + 计票原样 + warnings 展示', async () => {
    await waitFor(async () => {
      const cards = await cockpit.gateAreaForTest();
      return cards.some((c) => c.topic === TOPIC && c.mode === 'aa');
    }, 30_000);
    const card = (await cockpit.gateAreaForTest()).find((c) => c.topic === TOPIC)!;
    assert.equal(card.mode, 'aa');
    assert.equal(card.vote!.sides.length, 3);
    assert.equal(card.vote!.counts.reject, 1);
    assert.equal(card.vote!.roundLine, '第 1/5 轮 · 计票：1 通过 / 1 修改后通过 / 1 不通过 → 修改后通过 · 下一步：进入下一阶段');
    assert.equal(card.warnings.length, 1);
    assert.equal(card.warnings[0]!.code, 'degraded_round');
  });

  test('raf 态 → 卡浮出为 raf 模式（裁决未齐提示）', async () => {
    await fs.writeFile(path.join(fx.root, '.trivium', 'state.json'), JSON.stringify({
      schema: 'trivium.state.v1', updated_at: new Date().toISOString(),
      gates: { 'DemoTopic/code': { topic: TOPIC, stage: STAGE, state: 'review_done_awaiting_disposition', run_id: RUN, rerun_index: 1, since: 'x', driver: 'glm', session_id: null } },
    }, null, 2));
    await waitFor(async () => {
      const cards = await cockpit.gateAreaForTest();
      const c = cards.find((x) => x.topic === TOPIC);
      return c !== undefined && c.mode === 'raf';
    }, 30_000);
  });

  test('批准 → approve --topic --stage --json argv 与权威摘要', async () => {
    await waitFor(async () => (await cockpit.gateAreaForTest()).some((c) => c.topic === TOPIC), 30_000);
    await cockpit.handleMessageForTest({ type: 'approve-req', topic: TOPIC, stage: STAGE });
    await waitFor(async () => {
      try {
        const argv = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'stub', 'last-args.json'), 'utf8'));
        return Array.isArray(argv) && argv[0] === 'approve';
      } catch {
        return false;
      }
    }, 30_000);
    const argv = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'stub', 'last-args.json'), 'utf8')) as string[];
    assert.deepEqual(argv, ['approve', '--topic', TOPIC, '--stage', STAGE, '--json']);
  });

  test('拒绝：空理由被前端拦截（不打 CLI）；有理由走 --reject --reason', async () => {
    await waitFor(async () => (await cockpit.gateAreaForTest()).some((c) => c.topic === TOPIC), 30_000);
    // 清掉前序用例的调用记录，保证「空理由未触达 CLI」可判
    await fs.rm(path.join(fx.root, '.trivium', 'stub', 'last-args.json'), { force: true });
    // 空理由：不产生任何 approve 调用
    await cockpit.handleMessageForTest({ type: 'reject-req', topic: TOPIC, stage: STAGE, reason: '   ' });
    await new Promise((r) => setTimeout(r, 300));
    await assert.rejects(() => fs.readFile(path.join(fx.root, '.trivium', 'stub', 'last-args.json')), '空理由不得触达 CLI');
    // 有理由：argv 带 --reject --reason
    await cockpit.handleMessageForTest({ type: 'reject-req', topic: TOPIC, stage: STAGE, reason: '方案未覆盖迁移路径' });
    await waitFor(async () => {
      try {
        const argv = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'stub', 'last-args.json'), 'utf8'));
        return Array.isArray(argv) && argv[0] === 'approve' && argv.includes('--reject');
      } catch {
        return false;
      }
    }, 30_000);
    const argv = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'stub', 'last-args.json'), 'utf8')) as string[];
    assert.deepEqual(argv, ['approve', '--topic', TOPIC, '--stage', STAGE, '--reject', '--reason', '方案未覆盖迁移路径', '--json']);
  });

  test('放弃（二次确认）→ abandon 显式 --stage', async () => {
    await waitFor(async () => (await cockpit.gateAreaForTest()).some((c) => c.topic === TOPIC), 30_000);
    await cockpit.handleMessageForTest({ type: 'abandon-req', topic: TOPIC, stage: STAGE });
    await waitFor(async () => {
      try {
        const argv = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'stub', 'last-args.json'), 'utf8'));
        return Array.isArray(argv) && argv[0] === 'abandon';
      } catch {
        return false;
      }
    }, 30_000);
    const argv = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'stub', 'last-args.json'), 'utf8')) as string[];
    assert.deepEqual(argv, ['abandon', '--topic', TOPIC, '--stage', STAGE, '--json'], '显式 --stage：省略会批量放弃全部开放闸门');
  });

  test('审批后 state 回落 → 闸门区收敛（卡片消失）', async () => {
    await waitFor(async () => (await cockpit.gateAreaForTest()).some((c) => c.topic === TOPIC), 30_000);
    await cockpit.handleMessageForTest({ type: 'approve-req', topic: TOPIC, stage: STAGE });
    await waitFor(async () => {
      try {
        const argv = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium', 'stub', 'last-args.json'), 'utf8'));
        return Array.isArray(argv) && argv[0] === 'approve';
      } catch {
        return false;
      }
    }, 30_000);
    // 模拟编排器迁移闸门（approved 后 state.json 更新）
    await fs.writeFile(path.join(fx.root, '.trivium', 'state.json'), JSON.stringify({
      schema: 'trivium.state.v1', updated_at: new Date().toISOString(),
      gates: { 'DemoTopic/code': { topic: TOPIC, stage: STAGE, state: 'approved', run_id: RUN, rerun_index: 1, since: 'y', driver: 'glm', session_id: null } },
    }, null, 2));
    await waitFor(async () => !(await cockpit.gateAreaForTest()).some((c) => c.topic === TOPIC), 30_000);
  });
});
