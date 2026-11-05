/**
 * 运行监控（FR-4）：state 发现、status 渲染、心跳零事件失联、终态复核、
 * 侧完成正文入口、闸门先行窗口。
 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StateWatch } from '../../src/monitor/stateWatch';
import { RunWatch } from '../../src/monitor/statusWatch';
import { ReviewWatch } from '../../src/monitor/reviewWatch';
import { locateRunDirWithRetry } from '../../src/monitor/runDiscovery';
import { waitFor, fxPaths, RUN_ID, bucketOf } from './testHelper';

async function atomicWrite(p: string, text: string): Promise<void> {
  const tmp = `${p}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, p);
}

suite('运行监控（FR-4）', function () {
  this.timeout(60_000);

  test('初始扫描：活跃白名单命中，历史残留不进活跃', async () => {
    const p = await fxPaths();
    const snaps: { active: number }[] = [];
    const w = new StateWatch(p.root);
    w.onChange((s) => snaps.push({ active: s.active.length }));
    await waitFor(() => snaps.length > 0);
    assert.equal(snaps[0]!.active, 1); // DemoTopic running；历史A/B 不进
    w.dispose();
  });

  test('晚订阅回放：构造后订阅也能立刻拿到初始快照（CODEX-03）', async () => {
    const p = await fxPaths();
    const w = new StateWatch(p.root);
    await new Promise((r) => setTimeout(r, 800)); // 等构造期初始扫描完成
    let replayed = 0;
    const d = w.onChange(() => (replayed += 1));
    assert.equal(replayed, 1, '订阅即回放最近快照');
    d.dispose();
    w.dispose();
  });

  test('活跃→回落 idle：RunEnded 事件（失败运行回 idle 也被看见）', async () => {
    const p = await fxPaths();
    const w = new StateWatch(p.root);
    let snaps = 0;
    let endedCount = 0;
    w.onChange((_s, ended) => {
      snaps += 1;
      endedCount += ended.length;
    });
    await waitFor(() => snaps >= 1, 20_000); // 等初始扫描（此刻 DemoTopic=running）
    await p.writeState({
      'DemoTopic/plan': { topic: 'DemoTopic', stage: 'plan', state: 'idle', run_id: RUN_ID, since: '2026-11-06T00:00:00.000Z', session_id: null },
    });
    await waitFor(() => endedCount >= 1, 20_000);
    w.dispose();
  });

  test('闸门先行窗口：run 目录后建也能定位（重试退避）', async () => {
    const p = await fxPaths();
    const laterRunId = '20261106T000009Z';
    const target = path.join(p.runRoot, bucketOf(p.root), laterRunId);
    const promise = locateRunDirWithRetry(p.runRoot, laterRunId, { intervalMs: 200, rounds: 25 }, { repoHint: path.basename(p.root) }, async () => {
      if (!(await fs.stat(target).then(() => true).catch(() => false))) {
        await fs.mkdir(target, { recursive: true });
      }
    });
    const dir = await promise;
    assert.equal(dir, target);
  });

  test('RunWatch：渲染推进 + 终态复核 + 自动清理', async () => {
    const p = await fxPaths();
    const phases: string[] = [];
    const finals: string[] = [];
    let probeCalls = 0;
    const w = new RunWatch(
      {
        runDir: p.runDir,
        runId: p.runId,
        heartbeatStaleS: 120,
        heartbeatIntervalS: 30,
        logTailBytes: 65536,
        statusProbe: async () => {
          probeCalls += 1;
          return { phase: 'success', artifacts: ['/tmp/a.md'] };
        },
      },
      {
        onRender: (r) => phases.push(r.phase),
        onFinal: (r, note) => {
          finals.push(r.phase);
          assert.ok(note === null || note.includes('滞后') || note.includes('为准'));
        },
      },
    );
    await waitFor(() => phases.length > 0);
    // 推进到终态
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'success', heartbeat_at: new Date().toISOString(),
      sides: { claude: { state: 'ok', model: 'stub-m', attempt: 1, elapsed_s: 5, cli: null } },
      artifacts: ['/tmp/a.md'], exit_code: 0, message: null,
    });
    await waitFor(() => finals.length > 0, 20_000);
    assert.equal(probeCalls, 1, '终态复核应恰好调用一次');
    assert.equal(finals[0], 'success');
    // 终态后自动 dispose：再写文件不应触发渲染（disposable.test 会再验）
    w.dispose();
  });

  test('心跳零事件失联：无文件写入也出现 stale 提示（D5′）', async () => {
    const p = await fxPaths();
    const staleNotes: string[] = [];
    // 先写「心跳新鲜」的 running 快照再建 watch（构造期读到新鲜值）；
    // 上一用例可能遗留终态快照，若 watch 先建会被终态复核立即自毁
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'running', heartbeat_at: new Date().toISOString(),
      sides: {}, artifacts: [], exit_code: null, message: null,
    });
    const w = new RunWatch(
      {
        runDir: p.runDir,
        runId: p.runId,
        heartbeatStaleS: 1,          // 1 秒即失联（测试压缩阈值）
        heartbeatIntervalS: 5,       // 最小周期 5s
        logTailBytes: 65536,
        statusProbe: async () => ({ phase: 'running', artifacts: null }),
      },
      {
        onRender: (_r, extra) => {
          if (extra.stale) staleNotes.push(extra.note ?? '');
        },
        onFinal: () => {},
      },
    );
    // 此后完全不再写文件——失联只能由周期重估发现（heartbeatStaleS=1s，重估 5s 一拍）
    await waitFor(() => staleNotes.length > 0, 20_000);
    assert.match(staleNotes[0]!, /失联/);
    assert.ok(staleNotes[0]!.includes('worker.log'), '失联提示应含 worker.log 路径');
    w.dispose();
  });

  test('ReviewWatch：侧完成归档件即时列出（CLAUDE-06）', async () => {
    const p = await fxPaths();
    const stageDir = path.join(p.root, '.reviews', 'DemoTopic', 'plan');
    await fs.mkdir(stageDir, { recursive: true });
    const lists: { name: string; role: string | null }[][] = [];
    const w = new ReviewWatch(stageDir);
    w.onChange((files) => lists.push(files.map((f) => ({ name: f.name, role: f.role }))));
    await atomicWrite(
      path.join(stageDir, '2026-11-06-DemoTopic-claude.md'),
      '---\nschema: trivium.review.v2\nrole: claude\n---\n\n# 审查\n',
    );
    await waitFor(() => lists.some((l) => l.some((f) => f.name.includes('claude'))), 20_000);
    const last = lists.at(-1)!.find((f) => f.name.includes('claude'))!;
    assert.equal(last.role, 'claude');
    w.dispose();
  });

  test('终态复核不一致：以 CLI 的 phase/artifacts 修正终稿（CLAUDE-05/CODEX-04）', async () => {
    const p = await fxPaths();
    const finals: { phase: string; artifacts: string[] }[] = [];
    const w = new RunWatch(
      {
        runDir: p.runDir, runId: p.runId, heartbeatStaleS: 120, heartbeatIntervalS: 30, logTailBytes: 65536,
        statusProbe: async () => ({ phase: 'success', artifacts: ['/tmp/权威.md'] }),
      },
      {
        onRender: () => {},
        onFinal: (r) => finals.push({ phase: r.phase, artifacts: r.artifacts }),
      },
    );
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'failed', heartbeat_at: new Date().toISOString(),
      sides: {}, artifacts: ['/tmp/旧.md'], exit_code: 1, message: null,
    });
    await waitFor(() => finals.length > 0, 20_000);
    assert.equal(finals[0]!.phase, 'success', '终稿应采用 CLI 复核的 phase');
    assert.deepEqual(finals[0]!.artifacts, ['/tmp/权威.md'], '终稿应采用 CLI 的 artifacts');
    w.dispose();
  });

  test('终态复核仍在运行：恢复监控而非弃用（CODEX-04 第 2 态）', async () => {
    const p = await fxPaths();
    const renders: string[] = [];
    let probePhase = 'running';
    const w = new RunWatch(
      {
        runDir: p.runDir, runId: p.runId, heartbeatStaleS: 120, heartbeatIntervalS: 30, logTailBytes: 65536,
        statusProbe: async () => ({ phase: probePhase, artifacts: null }),
      },
      { onRender: (r, extra) => renders.push(`${r.phase}|${extra.note ? 'note' : ''}`), onFinal: () => {} },
    );
    // 文件抢报 success，但 CLI 说 running → 应恢复监控（render 回 running、不 dispose）
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'success', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [], exit_code: 0, message: null,
    });
    await waitFor(() => renders.some((x) => x.startsWith('running|')), 20_000);
    assert.ok(!w.isCrossChecked, '复核未确认终态，不应置位 crossChecked');
    // 随后 CLI 确认终态 → 出终稿
    probePhase = 'success';
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'success', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: ['/tmp/最终.md'], exit_code: 0, message: null,
    });
    w.dispose();
  });

  test('status schema 不兼容：上报 schemaIssue 且不渲染（CODEX-07）', async () => {
    const p = await fxPaths();
    const issues: string[] = [];
    let renders = 0;
    const w = new RunWatch(
      {
        runDir: p.runDir, runId: p.runId, heartbeatStaleS: 120, heartbeatIntervalS: 30, logTailBytes: 65536,
        statusProbe: async () => ({ phase: 'running', artifacts: null }),
      },
      { onRender: () => (renders += 1), onFinal: () => {}, onSchemaIssue: (r) => issues.push(r) },
    );
    await p.writeStatus({
      schema: 'trivium.status.v9', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'running', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [],
    });
    await waitFor(() => issues.length > 0, 20_000);
    assert.match(issues[0]!, /status/);
    assert.ok(renders >= 1, '此前的合法快照渲染不受影响');
    w.dispose();
  });

  test('复核期间落盘的终态不丢：恢复监控后补读（CODEX-03）', async () => {
    const p = await fxPaths();
    const phases: string[] = [];
    let releaseProbe: (() => void) | null = null;
    let probeCalls = 0;
    const w = new RunWatch(
      {
        runDir: p.runDir, runId: p.runId, heartbeatStaleS: 120, heartbeatIntervalS: 30, logTailBytes: 65536,
        statusProbe: () =>
          new Promise<{ phase: string; artifacts: string[] | null }>((resolve) => {
            probeCalls += 1;
            if (probeCalls === 1) {
              // 第一次复核挂起：等测试在期间写入终态后再以 running 放行
              releaseProbe = () => resolve({ phase: 'running', artifacts: null });
            } else {
              resolve({ phase: 'success', artifacts: ['/tmp/最终2.md'] });
            }
          }),
      },
      { onRender: (r) => phases.push(r.phase), onFinal: (r) => phases.push(`final:${r.phase}`) },
    );
    // 初始 failed（终态）→ 触发复核（挂起）
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'failed', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [], exit_code: 1,
    });
    await waitFor(() => releaseProbe !== null, 20_000);
    // 复核挂起期间，真正的终态落盘（事件应被记为 pending，不丢）
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'success', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: ['/tmp/最终2.md'], exit_code: 0,
    });
    await new Promise((r) => setTimeout(r, 600));
    // 放行第一次复核为 running → 恢复监控 + 补读 pending 快照（success）→ 再次复核 → 终稿
    releaseProbe!();
    await waitFor(() => phases.includes('final:success'), 30_000);
    assert.ok(phases.includes('success'), '恢复监控后应补读到复核期间落盘的 success 快照');
    w.dispose();
  });

  test('挂载重试单例：目录晚建能挂上，成功即停、dispose 全清（CODEX-04）', async () => {
    const p = await fxPaths();
    const lateDir = path.join(p.runRoot, bucketOf(p.root), '20261106T000099Z');
    const w = new RunWatch(
      {
        runDir: lateDir, runId: '20261106T000099Z', heartbeatStaleS: 120, heartbeatIntervalS: 30, logTailBytes: 65536,
        statusProbe: async () => ({ phase: 'running', artifacts: null }),
      },
      { onRender: () => {}, onFinal: () => {} },
    );
    assert.ok(w.hasMountRetry, '目录未建：应有挂载重试任务');
    await new Promise((r) => setTimeout(r, 2_500));
    await fs.mkdir(lateDir, { recursive: true });
    await atomicWrite(
      path.join(lateDir, 'status.json'),
      JSON.stringify({ schema: 'trivium.status.v1', run_id: '20261106T000099Z', topic: 'DemoTopic', stage: 'plan', phase: 'running', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [] }),
    );
    await waitFor(() => !w.hasMountRetry, 20_000);
    w.dispose();
    assert.ok(!w.hasMountRetry, 'dispose 后无残留挂载任务');
  });

  test('失联恢复后瞬态 note 清空（CLAUDE-06 信号面）', async () => {
    const p = await fxPaths();
    const notes: Array<string | null> = [];
    const w = new RunWatch(
      {
        runDir: p.runDir, runId: p.runId, heartbeatStaleS: 1, heartbeatIntervalS: 5, logTailBytes: 65536,
        statusProbe: async () => ({ phase: 'running', artifacts: null }),
      },
      { onRender: (_r, extra) => notes.push(extra.stale ? extra.note : extra.note), onFinal: () => {} },
    );
    // 新鲜 → 旧心跳（失联）→ 再写新鲜心跳（恢复）
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'running', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [],
    });
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'running', heartbeat_at: new Date(Date.now() - 60_000).toISOString(), sides: {}, artifacts: [],
    });
    await waitFor(() => notes.some((n) => n !== null && n.includes('失联')), 20_000);
    await p.writeStatus({
      schema: 'trivium.status.v1', run_id: p.runId, topic: 'DemoTopic', stage: 'plan',
      phase: 'running', heartbeat_at: new Date().toISOString(), sides: {}, artifacts: [],
    });
    await waitFor(() => notes.at(-1) === null, 20_000);
    w.dispose();
  });
});
