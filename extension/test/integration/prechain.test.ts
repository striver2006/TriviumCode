/** 前置链（FR-3）：经桩 wrapper 的 resolve → preflight → claim（含错误面） */
import * as assert from 'node:assert/strict';
import { promises as fs, existsSync as fsSync } from 'node:fs';
import path from 'node:path';
import { TriviumCli } from '../../src/cli/triviumCli';
import { TriviumCommands } from '../../src/cli/commands';
import { runResolveAndPreflight, claimAfterConfirm, buildCliFlags, isFailedStep } from '../../src/launch/prechain';
import { fxPaths, waitFor } from './testHelper';

suite('前置链（FR-3）', function () {
  this.timeout(30_000);

  test('happy path：resolve ok → preflight ok，主题与 critics 透传', async () => {
    const p = await fxPaths();
    await fs.writeFile(p.stubResponses, JSON.stringify({
      'topic resolve': {
        code: 0,
        json: {
          ok: true, topic: 'HappyTopic', topic_inferred: true, task_goal: '目标', prompt_hint: null,
          critics: ['claude', 'gemini', 'codex'], max_rounds: { plan: 5, code: 5 }, notes: [], driver: 'glm',
        },
      },
      preflight: { code: 0, json: { ok: true, checks: [], warnings: [], exit_code: 0 } },
      'topic claim': { code: 0, json: { ok: true, topic: 'HappyTopic', stage: 'plan', driver: 'glm', outcome: 'claimed' } },
    }));
    const cmds = new TriviumCommands(new TriviumCli(p.root));
    const report = await runResolveAndPreflight(cmds, {
      entry: 'A',
      body: '目标正文',
      flags: { driver: 'glm', critics: ['claude', 'gemini', 'codex'], maxRounds: 5, topic: 'HappyTopic' },
    });
    assert.equal(report.failed, false);
    assert.equal(report.topic, 'HappyTopic');
    assert.equal(report.topicInferred, true);
    const claim = await claimAfterConfirm(cmds, 'A', 'HappyTopic', 'glm');
    assert.ok(claim.step === 'claim' && claim.state === 'ok');
  });

  test('resolve 退 64：错误面带退出码与信息', async () => {
    const p = await fxPaths();
    await fs.writeFile(p.stubResponses, JSON.stringify({
      'topic resolve': { code: 64, json: { ok: false, error: '缺提示语' } },
    }));
    const cmds = new TriviumCommands(new TriviumCli(p.root));
    const report = await runResolveAndPreflight(cmds, {
      entry: 'A', body: '', flags: { driver: 'glm', critics: ['claude'] },
    });
    assert.equal(report.failed, true);
    const step = report.steps[0]!;
    assert.ok(isFailedStep(step));
    assert.equal(step.code, 64);
  });

  test('preflight 退 69：失败项明细进错误面', async () => {
    const p = await fxPaths();
    await fs.writeFile(p.stubResponses, JSON.stringify({
      'topic resolve': {
        code: 0,
        json: { ok: true, topic: 'T', topic_inferred: false, task_goal: 'g', prompt_hint: null, critics: ['claude'], notes: [], driver: 'glm' },
      },
      preflight: {
        code: 69,
        json: { ok: false, checks: [{ name: '探针结论未过期', ok: false, warn: false, detail: '已过期：claude' }], warnings: [], exit_code: 69 },
      },
    }));
    const cmds = new TriviumCommands(new TriviumCli(p.root));
    const report = await runResolveAndPreflight(cmds, { entry: 'A', body: 'x', flags: { driver: 'glm', critics: ['claude'] } });
    assert.equal(report.failed, true);
    const step = report.steps[1]!;
    assert.ok(isFailedStep(step));
    assert.match(step.message, /探针结论未过期/);
  });

  test('claim 失败（退 64：他家已执笔）如实透传', async () => {
    const p = await fxPaths();
    await fs.writeFile(p.stubResponses, JSON.stringify({
      'topic claim': { code: 64, json: { ok: false, error: '该阶段已由别家执笔' } },
    }));
    const cmds = new TriviumCommands(new TriviumCli(p.root));
    const claim = await claimAfterConfirm(cmds, 'A', 'T', 'glm');
    assert.ok(claim.step === 'claim' && claim.state === 'failed');
    assert.equal(claim.code, 64);
  });

  test('入口 C/D 不预认领（skipped 分支）', async () => {
    const p = await fxPaths();
    const cmds = new TriviumCommands(new TriviumCli(p.root));
    const claim = await claimAfterConfirm(cmds, 'C', 'T', 'glm');
    assert.equal(claim.step, 'skipped');
  });

  test('preflight 透传运行旗标且不带非预检旗标（CLAUDE-03）', async () => {
    const p = await fxPaths();
    await fs.writeFile(p.stubResponses, JSON.stringify({
      'topic resolve': {
        code: 0,
        json: { ok: true, topic: 'T', topic_inferred: false, task_goal: 'g', prompt_hint: null, critics: ['claude'], notes: [], driver: 'glm' },
      },
      preflight: { code: 0, json: { ok: true, checks: [], warnings: [], exit_code: 0 } },
    }));
    const cmds = new TriviumCommands(new TriviumCli(p.root));
    const report = await runResolveAndPreflight(cmds, {
      entry: 'A', body: 'x',
      flags: {
        driver: 'glm', critics: ['claude'], maxRounds: 5, topic: 'T',
        extra: ['--profile', 'pro', '--model-claude', 'm1', '--driver-model', 'dm1', '--driver-provider', 'dp1', '--context', '/tmp/ctx', '--max-rounds', '9'],
      },
    });
    assert.equal(report.failed, false);
    const lastArgsPath = path.join(p.root, '.trivium', 'stub', 'last-args.json');
    await waitFor(() => fsSync(lastArgsPath), 10_000);
    const lastArgs = JSON.parse(await fs.readFile(lastArgsPath, 'utf8')) as string[];
    // 最近一次调用是 preflight：含 profile/模型覆盖与 Driver 声明，不含 context/topic/max-rounds
    const joined = lastArgs.join(' ');
    assert.ok(lastArgs.includes('preflight'));
    assert.ok(joined.includes('--profile pro'));
    assert.ok(joined.includes('--model-claude m1'));
    assert.ok(joined.includes('--driver-model dm1'));
    assert.ok(joined.includes('--driver-provider dp1'));
    assert.ok(!joined.includes('--context'));
    assert.ok(!joined.includes('--topic'));
    assert.ok(!joined.includes('--max-rounds'));
  });

  test('旗标组装：--driver/--critics/--max-rounds/--topic 次序稳定', async () => {
    const flags = buildCliFlags({ driver: 'glm', critics: ['a', 'b'], maxRounds: 5, topic: 'T' });
    assert.deepEqual(flags, ['--driver', 'glm', '--critics', 'a,b', '--max-rounds', '5', '--topic', 'T']);
  });

  test('--version 与 review --status/--cancel 走桩', async () => {
    const p = await fxPaths();
    await fs.writeFile(p.stubResponses, JSON.stringify({
      '--version': { code: 0, stdout: 'trivium 9.9.9\n' },
      'review --status': { code: 0, json: { ok: true, run_id: p.runId, phase: 'success', message: null, sides: {}, artifacts: [] } },
      'review --cancel': { code: 0, stdout: '已取消\n' },
    }));
    const cmds = new TriviumCommands(new TriviumCli(p.root));
    assert.equal(await cmds.version(), 'trivium 9.9.9');
    const st = await cmds.reviewStatus(p.runId);
    assert.equal(st.out?.phase, 'success');
    const cancel = await cmds.reviewCancel(p.runId);
    assert.equal(cancel.code, 0);
  });
});
