/**
 * 驾驶舱意见列表集成测试（r2 计划 D9′：FR-6a 数据面——run 卡逐侧摘要、
 * 逐条意见含漂移/降级标注、Hub 订阅刷新）。
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { TriviumEnv } from '../../src/env/config';
import { TriviumCli } from '../../src/cli/triviumCli';
import { TriviumCommands } from '../../src/cli/commands';
import { TerminalRelay } from '../../src/launch/terminalRelay';
import { StateWatch } from '../../src/monitor/stateWatch';
import { AnnotationHub, resetHubGitApiCacheForTest } from '../../src/reviews/annotationHub';
import { Cockpit } from '../../src/ui/cockpit';
import type { TriviumServices } from '../../src/services';
import { buildPhase2Fixture, waitFor, type Phase2Fixture } from './fixtureLib';

suite('驾驶舱意见列表（FR-6a）', function () {
  this.timeout(90_000);
  let fx: Phase2Fixture;

  suiteSetup(async () => {
    fx = await buildPhase2Fixture();
  });

  test('活跃 run 发现 → 焦点回放 → run 卡携带逐侧摘要与逐条意见', async () => {
    resetHubGitApiCacheForTest({ toGitUri: (uri) => vscode.Uri.file(`${uri.fsPath}.baseline`) });
    const env = new TriviumEnv(fx.root);
    const cli = new TriviumCli(fx.root);
    const services: TriviumServices = {
      root: fx.root,
      env,
      cli,
      cmds: new TriviumCommands(cli),
      relay: new TerminalRelay(),
      stateWatch: new StateWatch(fx.root),
      annotationHub: new AnnotationHub(fx.root),
      repoRoot: fx.root,
      disposables: { push: () => {} },
    };
    const cockpit = new Cockpit(services);
    try {
      await cockpit.open();
      // 发现链：state.json 活跃闸门 → attachRun（run_root 定位 + 归属校验）
      await waitFor(() => cockpit.runStates().some((r) => r.runId === fx.run2Id), 30_000);
      // attachRun 已把 scope 指到 DemoTopic/code、焦点 run2 → 卡片带意见数据
      await waitFor(async () => {
        const card = (await cockpit.cardsForTest()).find((c) => c.runId === fx.run2Id);
        return (card?.findings?.length ?? 0) > 0;
      }, 30_000);
      const card = (await cockpit.cardsForTest()).find((c) => c.runId === fx.run2Id)!;

      // 逐侧摘要（三家 + verdict 中文标签）
      assert.equal(card.findingsSummary!.length, 3);
      const claude = card.findingsSummary!.find((s) => s.critic === 'claude')!;
      assert.equal(claude.verdictLabel, '修改后通过');
      assert.equal(claude.counts['blocker'], 1);
      const codex = card.findingsSummary!.find((s) => s.critic === 'codex')!;
      assert.equal(codex.verdictLabel, '不通过');

      // 逐条意见：解析级别与漂移/降级标注（CLAUDE-06 贯通）+ relPath 契约（CLAUDE-01）
      assert.equal(card.findings!.length, 12, '三家共 12 条（4+2+6）');
      const withPath = card.findings!.find((f) => f.id === 'C-01')!;
      assert.equal(withPath.relPath, 'src/sample.ts', '卡片携带 relPath（Diff 按钮/位置显示的契约字段）');
      assert.equal(withPath.file!.endsWith('src/sample.ts'), true);
      const x04 = card.findings!.find((f) => f.id === 'X-04')!;
      assert.equal(x04.consistency, 'mismatch', 'stale.ts 送审后漂移在卡片可见');
      const x06 = card.findings!.find((f) => f.id === 'X-06')!;
      assert.equal(x06.level, 'missing');
      assert.equal(x06.inChangeset, true, '删除文件意见带 Diff 入口数据（relPath+inChangeset，CLAUDE-02）');
      assert.equal(x06.relPath, 'src/gone.ts');
      const c03 = card.findings!.find((f) => f.id === 'C-03')!;
      assert.equal(c03.level, 'file');
      assert.match(c03.label ?? '', /行号越界/);
      const c04 = card.findings!.find((f) => f.id === 'C-04')!;
      assert.equal(c04.level, 'doc', '文档引用进列表不建批注');
      const x02 = card.findings!.find((f) => f.id === 'X-02')!;
      assert.equal(x02.level, 'missing', '文件缺失标注');
      const g02 = card.findings!.find((f) => f.id === 'G-02')!;
      assert.equal(g02.level, 'line');
      assert.equal(g02.startLine, 3, 'nearby 重定位');
      // 变更集成员判定（Diff 按钮数据面）
      const c01 = card.findings!.find((f) => f.id === 'C-01')!;
      assert.equal(c01.inChangeset, true, 'sample.ts 在变更集 → Diff 可用');
      const x03 = card.findings!.find((f) => f.id === 'X-03')!;
      assert.equal(x03.inChangeset, false);
    } finally {
      cockpit.dispose();
      services.stateWatch.dispose();
      services.relay.dispose();
      services.annotationHub.dispose();
      resetHubGitApiCacheForTest(null);
    }
  });

  test('历史回放卡（CLAUDE-04/CODEX-07）：无活跃 run 时回放归档 → 卡片携带意见列表', async () => {
    const env = new TriviumEnv(fx.root);
    const cli = new TriviumCli(fx.root);
    const services: TriviumServices = {
      root: fx.root, env, cli, cmds: new TriviumCommands(cli),
      relay: new TerminalRelay(), stateWatch: new StateWatch(fx.root),
      annotationHub: new AnnotationHub(fx.root), repoRoot: fx.root,
      disposables: { push: () => {} },
    };
    const cockpit = new Cockpit(services);
    try {
      await cockpit.open();
      await waitFor(() => cockpit.runStates().some((r) => r.runId === fx.run2Id), 30_000);
      // 稳态化：等 attach 链的 scope 跟随（setScope→setActiveRun）完成，再留稳定窗——
      // 否则 attach 的迟到 setScope 会与显式回放竞争把 scope 拉回活跃主题（波动来源）
      await waitFor(() => services.annotationHub.currentRunId === fx.run2Id, 30_000);
      await new Promise((r) => setTimeout(r, 600));
      // 回放纯归档主题（无活跃闸门、驾驶舱从未 attach 过它的 run）
      await services.annotationHub.setScope(fx.archiveTopic, 'code');
      await services.annotationHub.setActiveRun(fx.archiveTopicRunId);
      // CLAUDE-01：回放后驾驶舱面板被打开/聚焦（此前可能关闭）
      await waitFor(() => cockpit.isPanelOpen, 20_000);
      await waitFor(async () => {
        const card = (await cockpit.cardsForTest()).find((c) => c.runId === fx.archiveTopicRunId);
        return (card?.findings?.length ?? 0) > 0;
      }, 30_000);
      const card = (await cockpit.cardsForTest()).find((c) => c.runId === fx.archiveTopicRunId)!;
      assert.equal(card.phase, 'replay', '回放卡（非活跃 run）');
      assert.equal(card.phaseLabel, '历史回放');
      assert.equal(card.terminal, true, '回放卡不提供中止');
      assert.equal(card.findings!.length, 1);
      assert.equal(card.findings![0]!.id, 'AG2-01');
      assert.equal(card.findings![0]!.relPath, 'src/sample.ts');
    } finally {
      cockpit.dispose();
      services.stateWatch.dispose();
      services.relay.dispose();
      services.annotationHub.dispose();
    }
  });
});
