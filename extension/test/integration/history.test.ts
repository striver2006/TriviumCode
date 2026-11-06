/**
 * 运行历史集成测试（r2 计划 D9′：FR-7 树数据 + 回放 + AGY-05 第一事实源）。
 */
import * as assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { AnnotationHub } from '../../src/reviews/annotationHub';
import { HistoryProvider } from '../../src/history/historyProvider';
import { listTopics, listRuns, makeRunRootProber } from '../../src/history/runHistory';
import { buildPhase2Fixture, waitFor, type Phase2Fixture } from './fixtureLib';

function nodeFs() {
  return {
    readdir: (p: string) => fs.readdir(p),
    readFile: (p: string) => fs.readFile(p, 'utf8'),
  };
}

suite('运行历史（FR-7）', function () {
  this.timeout(60_000);
  let fx: Phase2Fixture;

  suiteSetup(async () => {
    fx = await buildPhase2Fixture();
  });

  test('listTopics：主题摘要', async () => {
    const topics = await listTopics(nodeFs(), path.join(fx.root, '.reviews'));
    const demo = topics.find((t) => t.topic === 'DemoTopic');
    assert.ok(demo, 'DemoTopic 在列表');
    assert.equal(demo!.runCount, 2);
    assert.equal(demo!.lastStatus, 'success');
    assert.deepEqual(demo!.drivers, ['glm']);
  });

  test('listRuns：归档齐全用 _meta 第一事实源（AGY-05，不探 run_root）', async () => {
    let probed = 0;
    const runs = await listRuns(nodeFs(), path.join(fx.root, '.reviews'), 'DemoTopic', async (runId) => {
      probed++;
      return runId === fx.run1Id ? fx.run1Dir : null; // 仅 run1 归档缺失 → 探测且命中本仓桶
    });
    assert.equal(runs.length, 2);
    const run2 = runs.find((r) => r.runId === fx.run2Id)!;
    assert.ok(run2, 'run2 在列表');
    assert.equal(run2.stage, 'code');
    assert.equal(run2.metaLocated, true);
    assert.equal(run2.sides.length, 3, '三侧统计来自 review 工件');
    const claude = run2.sides.find((s) => s.critic === 'claude')!;
    assert.equal(claude.verdict, 'pass-after-changes');
    assert.equal(claude.counts.blocker, 1);
    const codex = run2.sides.find((s) => s.critic === 'codex')!;
    assert.equal(codex.verdict, 'reject');
    // run2 归档齐全：不探测；run1 归档缺失：探测一次且命中本仓桶（他仓撞号桶 topic 不同）
    assert.equal(probed, 1, '仅 run1 触发 run_root 探测');
    const run1 = runs.find((r) => r.runId === fx.run1Id)!;
    assert.equal(run1.metaLocated, true, 'run1 经本仓桶定位（他仓撞号不接管）');
    assert.equal(run1.stage, 'plan');
  });

  test('归属纪律：他仓桶撞号不接管（runDiscovery 同款）', async () => {
    // 一个既不在本仓桶、也不在归档的 run：只有他仓桶命中 → 不接管
    const runs = await listRuns(
      nodeFs(),
      path.join(fx.root, '.reviews'),
      'DemoTopic',
      async (runId) => {
        // 模拟 locateRunDir：他仓桶 topic 不匹配 → null
        void runId;
        return null;
      },
    );
    const run1 = runs.find((r) => r.runId === fx.run1Id)!;
    assert.equal(run1.metaLocated, false, '探测失败 → 未定位（不接管他仓）');
  });

  test('HistoryProvider：主题→运行两级 + 回放挂载批注', async () => {
    const hub = new AnnotationHub(fx.root);
    const provider = new HistoryProvider(
      { root: fx.root, annotationHub: hub },
      nodeFs(),
      async () => fx.runRoot,
    );
    try {
      const topics = await provider.getChildren();
      const demoNode = topics.find((t) => t.label === 'DemoTopic');
      assert.ok(demoNode, '主题节点');
      const runs = await provider.getChildren(demoNode as never);
      assert.equal(runs.length, 2);
      // 时间倒序：run2 在前
      assert.equal((runs[0] as never as { run: { runId: string } }).run.runId, fx.run2Id);
      // 回放：点击 run2 → scope + 焦点 + 批注挂载
      await provider.replayRun('DemoTopic', { runId: fx.run2Id, stage: 'code' });
      await waitFor(() => hub.threadsSnapshot().length > 0);
      assert.equal(hub.currentRunId, fx.run2Id);
      assert.equal(hub.currentScope?.topic, 'DemoTopic');
      const uri = path.join(fx.root, 'src', 'sample.ts');
      void uri;
    } finally {
      hub.dispose();
    }
  });

  test('降级侧在节点 description 标注（CLAUDE-06）', async () => {
    // 追加一份 v1 旧件（新 run：review 件 + run 件）→ 历史统计标注「工件不支持」
    await fs.writeFile(
      path.join(fx.metaDir, `review-gemini-20261106T000007Z.json`),
      JSON.stringify({ schema: 'trivium.review.v1', verdict: 'pass', findings: [] }),
    );
    await fs.writeFile(
      path.join(fx.metaDir, `run-20261106T000007Z.json`),
      JSON.stringify({ schema: 'trivium.run.v3', run_id: '20261106T000007Z', topic: 'DemoTopic', stage: 'code', rerun_index: 2, driver: 'glm', critics_selected: ['gemini'], started_at: '2026-11-06T00:00:07.000Z' }, null, 2),
    );
    const runs = await listRuns(nodeFs(), path.join(fx.root, '.reviews'), 'DemoTopic', makeRunRootProber(fx.runRoot, path.basename(fx.root), 'DemoTopic'));
    const run7 = runs.find((r) => r.runId === '20261106T000007Z');
    assert.ok(run7, 'v1 旧件 run 也进列表（_meta/run 兜底追加）');
    const gemini = run7!.sides.find((s) => s.critic === 'gemini')!;
    assert.equal(gemini.state, 'unsupported-schema');
    assert.match(gemini.notice ?? '', /不支持/);
  });
});
