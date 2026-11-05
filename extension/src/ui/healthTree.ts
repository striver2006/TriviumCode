/**
 * FR-1 环境健康树视图。
 *
 * 数据来自 probe 段（默认只读）；「刷新」走内存重读；「静态重探」按钮触发
 * doctor --no-model-calls（零厂商配额）。未 init 时 viewsWelcome 引导（贡献点
 * 在 package.json）。不展示指纹等敏感字段（D9′）。
 */
import * as vscode from 'vscode';
import type { TriviumServices } from '../services';
import { AVAILABILITY_LABEL, buildHealth, type AgentHealth } from '../env/health';

type HealthItem =
  | { kind: 'agent'; health: AgentHealth }
  | { kind: 'meta'; label: string; detail: string };

export class HealthProvider implements vscode.TreeDataProvider<HealthItem> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private agents: AgentHealth[] = [];
  private meta: { label: string; detail: string }[] = [];

  constructor(private readonly services: TriviumServices) {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const inited = await this.services.env.inited();
    if (!inited) {
      // 未 init：树保持为空 → viewsWelcome 引导生效（CLAUDE-05）
      this.agents = [];
      this.meta = [];
      this._onDidChange.fire();
      return;
    }
    const probe = await this.services.env.loadProbe();
    this.agents = buildHealth(probe);
    this.meta = [{ label: '已初始化（.trivium/）', detail: this.services.root }];
    if (probe?.generatedAt) {
      this.meta.push({ label: `探针结论：${probe.generatedAt}`, detail: '由 trivium doctor 回填于 config.local.yaml' });
    }
    const wrapperOk = await this.services.cli.wrapperExists();
    this.meta.push({
      label: wrapperOk ? 'wrapper 就绪' : 'wrapper 缺失（.trivium/bin/trivium）',
      detail: wrapperOk ? this.services.cli.wrapperPath() : '点火前置链不可用，请检查 init',
    });
    this._onDidChange.fire();
  }

  getTreeItem(el: HealthItem): vscode.TreeItem {
    if (el.kind === 'meta') {
      const item = new vscode.TreeItem(el.label, vscode.TreeItemCollapsibleState.None);
      item.description = el.detail;
      return item;
    }
    const h = el.health;
    const item = new vscode.TreeItem(h.display, vscode.TreeItemCollapsibleState.None);
    item.description = `${AVAILABILITY_LABEL[h.availability]}${h.version ? ` · ${h.version}` : ''}`;
    item.tooltip = new vscode.MarkdownString(
      [
        `**${h.display}**（${h.agentId}）`,
        `- 状态：${AVAILABILITY_LABEL[h.availability]}`,
        h.version ? `- CLI 版本：${h.version}` : '',
        h.entrypoint ? `- 入口：\`${h.entrypoint}\`` : '- 入口：未探到',
        h.probedAt ? `- 探测时间：${h.probedAt}` : '',
        h.authCheckedAt ? `- 认证探活：${h.authCheckedAt}` : '',
        h.models.length > 0 ? `- 模型清单：${h.models.slice(0, 5).join('、')}${h.models.length > 5 ? ' …' : ''}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    item.iconPath =
      h.availability === 'available'
        ? new vscode.ThemeIcon('check')
        : h.availability === 'auth-missing'
          ? new vscode.ThemeIcon('warning')
          : new vscode.ThemeIcon('circle-slash');
    return item;
  }

  getChildren(el?: HealthItem): HealthItem[] {
    if (el) return [];
    return [
      ...this.meta.map((m): HealthItem => ({ kind: 'meta', label: m.label, detail: m.detail })),
      ...this.agents.map((h): HealthItem => ({ kind: 'agent', health: h })),
    ];
  }
}
