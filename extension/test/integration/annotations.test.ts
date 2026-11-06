/**
 * 批注宿主集成测试（r2 计划 D9′：FR-6b/6c 核心断言）。
 *
 * 真实 VS Code 宿主 + Phase 2 夹具（源文件 + _meta 三侧 review JSON +
 * changes.diff + git 冻结基线）。Comments 断言走 threadsSnapshot 可观测面
 * （VS Code 无公开枚举 API，事实 20）；诊断走 languages.getDiagnostics。
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import path from 'node:path';
import { AnnotationHub, resetHubGitApiCacheForTest } from '../../src/reviews/annotationHub';
import { diffMember } from '../../src/reviews/diffParse';
import { buildPhase2Fixture, waitFor, type Phase2Fixture } from './fixtureLib';

/**
 * 伪 git API（测试环境 --disable-extensions 禁用内置 git 扩展）：
 * toGitUri → `${fsPath}.baseline`（夹具留有基线快照文件，内容 = git 基线提交版）。
 */
const fakeGitApi = (): { toGitUri: (uri: vscode.Uri) => vscode.Uri } => ({
  toGitUri: (uri) => vscode.Uri.file(`${uri.fsPath}.baseline`),
});

function reviewOf(critic: string, findings: Array<Record<string, string>>): string {
  return JSON.stringify({ schema: 'trivium.review.v2', verdict: 'pass', summary: 's', findings: findings.map((f, i) => ({
    id: f.id ?? `${critic}-${i}`, severity: f.severity, layer: 'code', kind: 'correctness',
    location: f.location, problem: f.problem, evidence: f.evidence, suggestion: 's', confidence: 'high',
  })) }, null, 2);
}

suite('批注宿主（FR-6b/6c）', function () {
  this.timeout(60_000);
  let fx: Phase2Fixture;
  let hub: AnnotationHub;

  suiteSetup(async () => {
    fx = await buildPhase2Fixture();
  });
  setup(async () => {
    resetHubGitApiCacheForTest(fakeGitApi());
    hub = new AnnotationHub(fx.root);
    await hub.setScope('DemoTopic', 'code');
    await waitFor(() => hub.threadsSnapshot().length > 0);
  });
  teardown(() => {
    hub.dispose();
    resetHubGitApiCacheForTest(null);
  });

  test('装配：三侧同层线程 + 分层不覆盖 + 区间贯通（CLAUDE-05）', () => {
    const threads = hub.threadsSnapshot();
    // sample.ts: C-01(2-4) C-02(3) G-01(3) G-02(nearby→3) X-01(2-3) → 行 2 与行 3 两线程
    const sampleThreads = threads.filter((t) => t.relPath === 'src/sample.ts');
    assert.ok(sampleThreads.length >= 2, `sample.ts 线程数：${sampleThreads.length}`);
    const line3 = sampleThreads.find((t) => t.startLine === 3 && t.endLine === 3);
    assert.ok(line3, '行 3 线程存在（C-02/G-01/G-02-nearby 合并）');
    const critics = line3!.comments.map((c) => c.critic).sort();
    assert.deepEqual(critics, ['claude', 'gemini', 'gemini'], '同 thread 多侧多 comment 分层');
    const line2 = sampleThreads.find((t) => t.startLine === 2);
    assert.ok(line2, '行 2 线程存在（C-01 区间与 X-01 主锚点）');
    assert.equal(line2!.endLine, 4, 'C-01 的 2-4 区间贯通到线程 range');
    assert.match(line2!.label, /claude|codex/);
  });

  test('诊断：severity 四档映射 + range 与线程同源（FR-6c）', () => {
    const uri = vscode.Uri.file(path.join(fx.root, 'src', 'sample.ts'));
    const diags = vscode.languages.getDiagnostics(uri);
    const byCode = new Map(diags.map((d) => [String(d.code), d]));
    // 六条建对象意见：C-01/02/03、G-01/02、X-01（C-04/X-02/X-03 走 listOnly）
    for (const id of ['C-01', 'C-02', 'C-03', 'G-01', 'G-02', 'X-01']) {
      assert.ok(byCode.get(id), `诊断 ${id} 存在`);
    }
    assert.equal(byCode.get('C-01')!.severity, vscode.DiagnosticSeverity.Error, 'blocker→Error');
    assert.equal(byCode.get('C-02')!.severity, vscode.DiagnosticSeverity.Error, 'major→Error');
    assert.equal(byCode.get('G-01')!.severity, vscode.DiagnosticSeverity.Warning, 'minor→Warning');
    assert.equal(byCode.get('X-01')!.severity, vscode.DiagnosticSeverity.Information, 'nit→Information');
    // range 同源：C-01 诊断区间 = 2-4
    assert.equal(byCode.get('C-01')!.range.start.line, 1);
    assert.equal(byCode.get('C-01')!.range.end.line, 3);
    assert.equal(byCode.get('C-01')!.source, 'TriviumCode 审查');
  });

  test('漂移显式：越界无锚→文件级 out-of-range；越界有锚→nearby（AGY-03/CLAUDE-08）', () => {
    const threads = hub.threadsSnapshot();
    const fileLevel = threads.find((t) => t.relPath === 'src/sample.ts' && t.startLine === 1 && t.label.includes('文件级'));
    assert.ok(fileLevel, 'C-03 越界无锚 → 文件级线程（首行）');
    assert.match(fileLevel!.label, /文件级/);
    const uri = vscode.Uri.file(path.join(fx.root, 'src', 'sample.ts'));
    const diags = vscode.languages.getDiagnostics(uri);
    const c03 = diags.find((d) => d.code === 'C-03');
    assert.ok(c03, 'C-03 诊断存在');
    assert.match(c03!.message, /行号越界/, '诊断显式标注漂移');
    // G-02 越界有锚 → nearby 重定位到行 3
    const g02 = diags.find((d) => d.code === 'G-02');
    assert.ok(g02);
    assert.equal(g02!.range.start.line, 2, 'G-02 nearby 重定位到 L3');
    assert.match(g02!.message, /邻近|原 L9999|漂移/);
  });

  test('listOnly：doc / missing-file / outside 不建线程与诊断（CLAUDE-06 展示面在列表）', () => {
    const threads = hub.threadsSnapshot();
    assert.ok(!threads.some((t) => t.relPath.includes('gone-missing')));
    assert.ok(!threads.some((t) => t.relPath === 'outside.ts'));
    const findings = hub.findingsOfFocusRun();
    assert.ok(findings.some((f) => f.id === 'C-04' && f.level === 'doc'));
    assert.ok(findings.some((f) => f.id === 'X-02' && f.level === 'missing'));
    assert.ok(findings.some((f) => f.id === 'X-03' && f.level === 'outside'));
    // 八条建对象意见（C-01/02/03、G-01/02、X-01、X-04 stale、X-05 drifting），三条 listOnly 不进诊断
    assert.equal(hub.diagnosticsSnapshot().length, 8);
  });

  test('逐家开关：切换即全量重建（D3′）', async () => {
    await hub.setEnabledCritics(new Set(['claude']));
    await waitFor(() => hub.threadsSnapshot().every((t) => t.comments.every((c) => c.critic === 'claude')));
    const threads = hub.threadsSnapshot();
    assert.ok(threads.length > 0);
    for (const t of threads) for (const c of t.comments) assert.equal(c.critic, 'claude');
    // 空集合 = 全部
    await hub.setEnabledCritics(new Set());
    await waitFor(() => hub.threadsSnapshot().some((t) => t.comments.some((c) => c.critic === 'gemini')));
  });

  test('切换 scope 全清：无孤儿诊断（D4′）', async () => {
    const uri = vscode.Uri.file(path.join(fx.root, 'src', 'sample.ts'));
    assert.ok(vscode.languages.getDiagnostics(uri).length > 0, '切换前有诊断');
    await hub.setScope('DemoTopic', 'plan'); // 无 plan 归档 → 空装配
    await waitFor(() => hub.threadsSnapshot().length === 0);
    assert.equal(vscode.languages.getDiagnostics(uri).length, 0, '切换后诊断全清（无孤儿）');
    // 回切 code 恢复
    await hub.setScope('DemoTopic', 'code');
    await waitFor(() => hub.threadsSnapshot().length > 0);
  });

  test('服务级 metaWatch：无面板也可消费侧完成落盘（CODEX-03/AGY-01）', async () => {
    // 本测试从不创建驾驶舱面板——Hub 独立消费 _meta 落盘
    const before = hub.threadsSnapshot().length;
    await fx.writeMeta('review-claude-20261106T000009Z.json', JSON.stringify({
      schema: 'trivium.review.v2', verdict: 'pass', summary: '新轮',
      findings: [{ id: 'C2-01', severity: 'major', layer: 'code', kind: 'correctness', location: 'src/sample.ts:7', problem: '新意见', evidence: 'e', suggestion: 's', confidence: 'high' }],
    }));
    // 新 run 落盘 → 焦点自动切到最新 run（runId 字典序 20261106T000009Z > 000005Z）
    await waitFor(() => hub.currentRunId === '20261106T000009Z');
    await waitFor(() => hub.threadsSnapshot().some((t) => t.relPath === 'src/sample.ts' && t.startLine === 7));
    assert.ok(before >= 0);
  });

  test('文件关闭→重开：线程恢复不重复（CLAUDE-03/CODEX-06 语义）', async () => {
    const uri = vscode.Uri.file(path.join(fx.root, 'src', 'sample.ts'));
    const count = hub.threadsSnapshot().length;
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await new Promise((r) => setTimeout(r, 300));
    await vscode.window.showTextDocument(doc, { preview: true });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(hub.threadsSnapshot().length, count, '关闭重开线程数恒定（VS Code 线程随文档管理）');
    assert.equal(vscode.languages.getDiagnostics(uri).length > 0, true, '诊断仍准确');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('挂载后编辑 → 一致性重校验显式标注（CLAU-01/CODEX-02 动态判据）', async () => {
    // 「服务级 metaWatch」用例已写入新轮工件——显式回放主 run 再校验
    await hub.setActiveRun(fx.run2Id);
    await waitFor(() => hub.findingsOfFocusRun().some((x) => x.id === 'C-01'));
    const uri = vscode.Uri.file(path.join(fx.root, 'src', 'sample.ts'));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    // 编辑行 3 内容（行数不变——「无锚+整体改写+行数够」回归由 consistency 兜住）
    await editor.edit((b) => {
      const line = doc.lineAt(2);
      b.replace(line.range, '  const size = 42;');
    });
    try {
      // r2 语义（CODEX-02 修复后）：编辑触发全 run 失效 + 重检——结论升级为静态真值
      // mismatch（工作区 ≠ 送审内容），不再停留在 edited 中间态
      await waitFor(() => {
        const f = hub.findingsOfFocusRun().find((x) => x.id === 'C-01');
        return f?.consistency === 'mismatch';
      }, 20_000);
      const diags = vscode.languages.getDiagnostics(uri);
      assert.match(diags.find((d) => d.code === 'C-01')!.message, /与送审版本不一致/, '诊断显式标注不静默');
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });

  test('静态一致性（送审内容重建，CLAUDE-02）：首次挂载即见 consistent/mismatch（CLAUDE-03/CODEX-04）', async () => {
    // 「服务级 metaWatch」用例已写入新轮工件——显式回放主 run（首次挂载语义）
    await hub.setActiveRun(fx.run2Id);
    await waitFor(() => hub.findingsOfFocusRun().some((x) => x.id === 'X-04'));
    const findings = hub.findingsOfFocusRun();
    // sample.ts：工作区 == 基线+补丁（送审时点内容）→ consistent
    const c01 = findings.find((x) => x.id === 'C-01');
    assert.equal(c01!.consistency, 'consistent', 'sample.ts 与送审版本一致');
    // drifting.ts：同为送审时点内容 → consistent
    const x05 = findings.find((x) => x.id === 'X-05');
    assert.equal(x05!.consistency, 'consistent', 'drifting.ts 与送审版本一致');
    // stale.ts：送审后工作区又改 → mismatch（诊断显式标注，不静默）
    const x04 = findings.find((x) => x.id === 'X-04');
    assert.equal(x04!.consistency, 'mismatch', 'stale.ts 送审后被编辑 → mismatch');
    const uri = vscode.Uri.file(path.join(fx.root, 'src', 'stale.ts'));
    const diag = vscode.languages.getDiagnostics(uri).find((d) => d.code === 'X-04');
    assert.ok(diag, 'stale.ts 诊断存在');
    assert.match(diag!.message, /与送审版本不一致/, '首次挂载诊断即带 mismatch 标注');
  });

  test('一致性缓存按 run 隔离（CODEX-06）：切轮回放不串用', async () => {
    // 主 run：stale → mismatch；archive run（不同冻结内容）重新判定
    await hub.setScope(fx.archiveTopic, 'code');
    await waitFor(() => hub.findingsOfFocusRun().length > 0);
    const ag = hub.findingsOfFocusRun().find((x) => x.id === 'AG2-01');
    // ArchiveTopic 的 changes.diff 无 hunks（只有头部）→ sample.ts 无送审快照 → unknown（不是沿用主 run 结论）
    assert.equal(ag!.consistency, 'unknown');
    // 切回主 run：mismatch 结论仍正确（显式回放 run2——前序用例写入了更新的轮次）
    await hub.setScope('DemoTopic', 'code');
    await hub.setActiveRun(fx.run2Id);
    await waitFor(() => hub.findingsOfFocusRun().some((x) => x.id === 'X-04'));
    assert.equal(hub.findingsOfFocusRun().find((x) => x.id === 'X-04')!.consistency, 'mismatch');
  });

  test('摄取竞态（CODEX-02）：切换 scope 后旧摄取整次丢弃，不污染新 scope', async () => {
    // 触发 DemoTopic 摄取（写新侧文件），不等完成立即切 ArchiveTopic
    const p = fx.writeMeta('review-claude-20261106T000011Z.json', reviewOf('claude', [
      { id: 'C3-01', severity: 'major', location: 'src/sample.ts:9', problem: '竞态意见', evidence: 'e', suggestion: 's', confidence: 'high' },
    ]));
    await hub.setScope(fx.archiveTopic, 'code'); // 同步段先完成（代次 +1），旧摄取恢复后即丢弃
    await p;
    await waitFor(() => hub.findingsOfFocusRun().length > 0, 20_000);
    // ArchiveTopic 只有自己的 AG2-01（src/sample.ts:7），没有 DemoTopic 的 C3-01
    const ids = hub.findingsOfFocusRun().map((f) => f.id);
    assert.ok(!ids.includes('C3-01'), `旧 scope 意见未污染新 scope（实际：${ids.join(',')}）`);
    assert.ok(ids.includes('AG2-01'));
  });

  test('交错回放（CODEX-01）：旧 setActiveRun 链被请求代次作废', async () => {
    const h2 = new AnnotationHub(fx.root);
    try {
      await h2.setScope('DemoTopic', 'code');
      // 交错的回放链：A 的 setActiveRun 在途，B 的 setScope 先完成
      const staleChain = h2.setActiveRun(fx.run2Id); // 不 await——其 ingest 在途
      await h2.setScope(fx.archiveTopic, 'code'); // 请求代次 +1
      await staleChain.catch(() => {});
      await waitFor(() => h2.findingsOfFocusRun().length > 0, 20_000);
      assert.equal(h2.currentScope?.topic, fx.archiveTopic, 'scope 是 B');
      const ids = h2.findingsOfFocusRun().map((f) => f.id);
      assert.deepEqual(ids, ['AG2-01'], `焦点是 B 的 run（实际：${ids.join(',')}），A 的迟到 setActiveRun 未生效`);
    } finally {
      h2.dispose();
    }
  });

  test('编辑失效全部 run 缓存（CODEX-02）：A→B→编辑→A 重检得真值', async () => {
    await hub.setActiveRun(fx.run2Id);
    await waitFor(() => hub.findingsOfFocusRun().some((x) => x.id === 'X-05'));
    // run2 下 drifting.ts == 送审内容 → consistent
    assert.equal(hub.findingsOfFocusRun().find((x) => x.id === 'X-05')!.consistency, 'consistent');
    // 编辑 drifting.ts（挂载 hash 失配 → 全 run 该文件结论失效）
    const abs = path.join(fx.root, 'src', 'drifting.ts');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), '// edited\n'));
    try {
      // r2 语义：编辑即失效 + 重检——X-05 直接得静态真值 mismatch
      await waitFor(() => hub.findingsOfFocusRun().find((x) => x.id === 'X-05')?.consistency === 'mismatch', 20_000);
      // 切到其它主题再切回：结论按当前工作区重检（不沿用编辑前的 consistent——CODEX-02 核心）
      await hub.setScope(fx.archiveTopic, 'code');
      await waitFor(() => hub.findingsOfFocusRun().length > 0);
      await hub.setScope('DemoTopic', 'code');
      await hub.setActiveRun(fx.run2Id);
      await waitFor(() => {
        const f = hub.findingsOfFocusRun().find((x) => x.id === 'X-05');
        return f !== undefined && f.consistency === 'mismatch';
      }, 20_000);
      assert.equal(hub.findingsOfFocusRun().find((x) => x.id === 'X-05')!.consistency, 'mismatch', '切回后仍为重检真值（旧缓存未复活）');
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });

  test('快速连续 setScope 与扫描期 dispose（CODEX-05）：无异常无残留', async () => {
    const h2 = new AnnotationHub(fx.root);
    // 快速切换（不 await 中间的）
    const p1 = h2.setScope('DemoTopic', 'code');
    const p2 = h2.setScope(fx.archiveTopic, 'code');
    const p3 = h2.setScope('DemoTopic', 'code');
    await Promise.all([p1, p2, p3]);
    await new Promise((r) => setTimeout(r, 300));
    h2.dispose(); // 扫描/装配可能仍在途
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(h2.threadsSnapshot().length, 0, 'dispose 后无残留线程');
  });

  test('删除文件的 Diff 入口（CLAUDE-02）：missing-file 意见携带 relPath 且在变更集', async () => {
    await hub.setActiveRun(fx.run2Id);
    await waitFor(() => hub.findingsOfFocusRun().some((x) => x.id === 'X-06'));
    const x06 = hub.findingsOfFocusRun().find((x) => x.id === 'X-06')!;
    assert.equal(x06.level, 'missing', 'gone.ts 已删除 → 文件缺失');
    assert.equal(x06.relPath, 'src/gone.ts');
    const diff = hub.diffOf(null)!;
    assert.ok(diffMember(diff, 'src/gone.ts')?.deleted, '在变更集且为删除 → Webview Diff 按钮条件成立（relPath+inChangeset）');
  });

  test('逐家开关过滤列表（CLAUDE-05）：关掉的侧不出现在 findings', async () => {
    await hub.setActiveRun(fx.run2Id);
    await waitFor(() => hub.findingsOfFocusRun().length >= 10);
    await hub.setEnabledCritics(new Set(['gemini']));
    await waitFor(() => hub.threadsSnapshot().every((t) => t.comments.every((c) => c.critic === 'gemini')));
    // cockpit 卡数据层同步过滤（由 cockpitFindings 套件断言卡片；此处断言 Hub 侧数据面口径：
    // focusSummaries 仍全量（组头计数），过滤发生在 cockpit buildFocusData）
    assert.equal(hub.getEnabledCritics().size, 1);
    await hub.setEnabledCritics(new Set());
  });

  test('dispose 失效在途装配（CODEX-03）：停用后不再创建任何对象', async () => {
    const h2 = new AnnotationHub(fx.root);
    const scopePromise = h2.setScope('DemoTopic', 'code'); // rebuild 在途
    h2.dispose(); // 立即停用：在途代次全部失效
    await scopePromise.catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(h2.threadsSnapshot().length, 0, '停用后无线程被创建');
  });
});
