/**
 * 运行历史树（FR-7，r2 计划 D6′）。
 *
 * TreeView `triviumHistory`（Trivium 容器内第二视图）：主题（折叠）→ 运行
 * （时间倒序）。节点 description 呈现时间线摘要与逐轮意见数/严重度分布；
 * ReviewFileStatus 降级件在节点标注（CLAUDE-06）。点击 run → 回放（setScope +
 * setActiveRun → 行内批注/Problems/意见列表聚焦）。扫描惰性（树可见/刷新时，
 * D8′），不做常驻 watcher。
 */
import * as vscode from 'vscode';
import path from 'node:path';
import { listTopics, listRuns, makeRunRootProber, type TopicSummary, type RunSummary } from './runHistory';
import type { AnnotationHub } from '../reviews/annotationHub';

type FsApi = { readdir(p: string): Promise<string[]>; readFile(p: string): Promise<string> };

class TopicNode extends vscode.TreeItem {
  constructor(readonly summary: TopicSummary) {
    super(summary.topic, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = describeTopic(summary);
    this.contextValue = 'triviumTopic';
    this.iconPath = new vscode.ThemeIcon('folder-library');
  }
}

class RunNode extends vscode.TreeItem {
  constructor(readonly topic: string, readonly run: RunSummary) {
    super(labelOf(run), vscode.TreeItemCollapsibleState.None);
    this.description = describeRun(run);
    this.contextValue = 'triviumRun';
    this.iconPath = new vscode.ThemeIcon(iconOf(run));
    this.tooltip = tooltipOf(this);
    // 点击 run 节点 → 回放（FR-7；命令在 extension.ts 注册）
    this.command = { command: 'trivium.history.replay', title: '回放该轮意见', arguments: [this] };
  }
}

function labelOf(run: RunSummary): string {
  const r = run.rerunIndex !== null ? `r${run.rerunIndex}` : '';
  return `${stageLabel(run.stage)} ${r} · ${run.runId}`.trim();
}

function stageLabel(stage: string): string {
  return { plan: '计划审', code: '代码审', bug: '根因审', verify: '编译测试' }[stage] ?? stage;
}

function describeTopic(t: TopicSummary): string {
  const when = t.updatedAt ? t.updatedAt.slice(0, 10) : '';
  return `${t.runCount} 次运行 · ${t.lastStatus ?? '未知末态'}${when ? ` · ${when}` : ''}${t.drivers.length > 0 ? ` · Driver: ${t.drivers.join('/')}` : ''}`;
}

function describeRun(run: RunSummary): string {
  const total = run.sides.reduce((acc, s) => acc + s.counts.blocker + s.counts.major + s.counts.minor + s.counts.nit, 0);
  const blocker = run.sides.reduce((acc, s) => acc + s.counts.blocker, 0);
  const major = run.sides.reduce((acc, s) => acc + s.counts.major, 0);
  const verdicts = run.sides.map((s) => s.verdict).filter(Boolean);
  const parts: string[] = [`${run.sides.length} 侧`];
  if (total > 0) parts.push(`${total} 条（${blocker} blocker ｜ ${major} major）`);
  else parts.push('无意见');
  if (verdicts.length > 0) parts.push([...new Set(verdicts)].join('/'));
  const degraded = run.sides.filter((s) => s.state !== 'ok').map((s) => `${s.critic} 侧${s.state === 'unsupported-schema' ? '工件不支持' : s.state === 'parse-error' ? '工件损坏' : '部分跳过'}`);
  if (!run.metaLocated) parts.push('run 目录未定位');
  return parts.join(' · ') + (degraded.length > 0 ? ` ｜ ${degraded.join('；')}` : '');
}

function iconOf(run: RunSummary): string {
  if (run.status === 'success') return 'pass-filled';
  if (run.status === 'failed') return 'error';
  return 'circle-filled';
}

function tooltipOf(node: RunNode): vscode.MarkdownString {
  const run = node.run;
  const lines: string[] = [`**${node.topic} · ${stageLabel(run.stage)} ${run.runId}**`];
  if (run.driver) lines.push(`Driver：${run.driver}`);
  if (run.startedAt) lines.push(`开始：${run.startedAt}`);
  if (run.finishedAt) lines.push(`结束：${run.finishedAt}`);
  for (const s of run.sides) {
    const c = s.counts;
    lines.push(`- ${s.critic}：${s.verdict ?? '未知'} · blocker ${c.blocker} / major ${c.major} / minor ${c.minor} / nit ${c.nit}${s.notice ? `（${s.notice}）` : ''}`);
  }
  return new vscode.MarkdownString(lines.join('\n\n'));
}

export class HistoryProvider implements vscode.TreeDataProvider<TopicNode | RunNode> {
  private readonly emitter = new vscode.EventEmitter<TopicNode | RunNode | undefined | null>();
  readonly onDidChangeTreeData = this.event;
  private cache = new Map<string, RunSummary[]>();

  constructor(
    private readonly services: { root: string; annotationHub: AnnotationHub },
    private readonly fs: FsApi,
    private readonly loadRunRoot: () => Promise<string>,
  ) {}

  get event(): vscode.Event<TopicNode | RunNode | undefined | null> {
    return this.emitter.event;
  }

  refresh(): void {
    this.cache.clear();
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TopicNode | RunNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TopicNode | RunNode): Promise<Array<TopicNode | RunNode>> {
    if (!element) {
      const reviewsRoot = path.join(this.services.root, '.reviews');
      const topics = await listTopics(this.fs, reviewsRoot);
      return topics.map((t) => new TopicNode(t));
    }
    if (element instanceof TopicNode) {
      const runRoot = await this.loadRunRoot();
      const runs = await listRuns(this.fs, path.join(this.services.root, '.reviews'), element.summary.topic, makeRunRootProber(runRoot, path.basename(this.services.root), element.summary.topic));
      this.cache.set(element.summary.topic, runs);
      return runs.map((r) => new RunNode(element.summary.topic, r));
    }
    return [];
  }

  /** 点击 run 节点：回放该轮全部意见（FR-7）；回放后聚焦驾驶舱（CLAUDE-01：面板未开也打开） */
  async replayRun(topic: string, run: { runId: string; stage: string }): Promise<void> {
    await this.services.annotationHub.setScope(topic, run.stage);
    await this.services.annotationHub.setActiveRun(run.runId);
    await vscode.commands.executeCommand('trivium.openCockpit');
  }

  runOf(topic: string, runId: string): RunSummary | null {
    return this.cache.get(topic)?.find((r) => r.runId === runId) ?? null;
  }
}
