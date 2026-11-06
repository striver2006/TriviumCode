/**
 * 插件激活入口。
 *
 * 注册命令、视图与配置；全部 Disposable 进 context.subscriptions 统一释放。
 * Phase 2 新增：批注宿主（服务级，见 services）、运行历史树、批注状态栏。
 */
import * as vscode from 'vscode';
import { createServices, type TriviumServices } from './services';
import { HealthProvider } from './ui/healthTree';
import { Cockpit } from './ui/cockpit';
import { HistoryProvider } from './history/historyProvider';
import { openDiffFor } from './reviews/diffView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const services = await createServices(context);
  if (!services) {
    // 无工作区文件夹：命令保留但全部提示（不做任何事）
    registerWithNoWorkspace(context);
    return;
  }
  registerAll(context, services);
}

function registerAll(context: vscode.ExtensionContext, services: TriviumServices): void {
  const health = new HealthProvider(services);
  // Cockpit 单例（AGY-02/CLAUDE-07）：重复命令 reveal 既有面板，不重复建实例与监听
  const cockpit = new Cockpit(services);
  const history = new HistoryProvider(services, nodeFsApi(), () => services.env.loadConfig().then((c) => c.runRoot ?? ''));
  context.subscriptions.push(cockpit);

  // 批注状态栏（FR-6b/D4′：当前批注来源；点击 QuickPick 切换 run）
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'trivium.reviews.focus';
  context.subscriptions.push(
    status,
    services.annotationHub.onScopeChange((state) => {
      if (!state.topic) {
        status.text = 'Trivium 批注：（无）';
        status.tooltip = '暂无批注：运行结束后自动挂载，或在运行历史树点击回放';
      } else {
        status.text = `Trivium 批注：${state.topic}/${state.stage} · ${state.runId ?? '—'} · ${state.threads} 线程/${state.diagnostics} 诊断`;
        status.tooltip = '点击切换要回放的运行轮次';
      }
      status.show();
    }),
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('triviumHealth', health),
    vscode.window.createTreeView('triviumHistory', { treeDataProvider: history }),
    vscode.commands.registerCommand('trivium.refreshHealth', () => void health.refresh()),
    vscode.commands.registerCommand('trivium.history.refresh', () => history.refresh()),
    vscode.commands.registerCommand('trivium.openCockpit', () => void cockpit.open()),
    // 运行历史：点击 run → 回放该轮全部意见（FR-7；驾驶舱经 Hub 订阅自动刷新）
    vscode.commands.registerCommand('trivium.history.replay', (node: unknown) => {
      const n = node as { topic?: string; run?: { runId: string; stage: string } } | undefined;
      if (n?.topic && n?.run) void history.replayRun(n.topic, n.run);
    }),
    // 打开该轮某审查者的正文（md 工件）
    vscode.commands.registerCommand('trivium.openManual', () => void openRepoDoc(services.root, [
      'doc/07_manuals/使用手册.md',
    ])),
    vscode.commands.registerCommand('trivium.openDeployManual', () => void openRepoDoc(services.root, [
      'doc/06_deployment/部署手册.md',
      'doc/07_manuals/部署手册.md', // 兜底：文档目录可能重排
    ])),
    // 状态栏：QuickPick 切换焦点 run（D4′）
    vscode.commands.registerCommand('trivium.reviews.focus', () => void focusRunPicker(services)),
    // 逐家开关（D3′：QuickPick 多选；空选 = 全部启用）
    vscode.commands.registerCommand('trivium.critics.filter', () => void criticsFilterPicker(services)),
    // Diff 视图（FR-6d）：意见列表/命令调用
    vscode.commands.registerCommand('trivium.openDiff', (args: { runId?: string | null; relPath?: string; startLine?: number; endLine?: number }) => {
      void (async () => {
        if (!args?.relPath) return;
        const diff = services.annotationHub.diffOf(args.runId ?? null);
        const reveal = args.startLine !== undefined ? { startLine: args.startLine, endLine: args.endLine ?? args.startLine } : undefined;
        const outcome = await openDiffFor(services.root, diff, args.relPath, reveal);
        vscode.window.showInformationMessage(`Trivium Diff：${outcome.note}`);
      })();
    }),
  );
  status.show();
}

/** QuickPick：切换焦点 run（scope 内全部 run 可选，最新在前） */
async function focusRunPicker(services: TriviumServices): Promise<void> {
  const hub = services.annotationHub;
  const scope = hub.currentScope;
  if (!scope) {
    vscode.window.showInformationMessage('暂无批注 scope：先在运行历史树点击一个运行节点回放。');
    return;
  }
  const runs = hub.runIds();
  if (runs.length === 0) {
    vscode.window.showInformationMessage(`主题 ${scope.topic}/${scope.stage} 暂无审查工件。`);
    return;
  }
  const items = runs.map((runId) => ({
    label: runId === hub.currentRunId ? `$(check) ${runId}` : runId,
    description: runId === hub.currentRunId ? '当前回放' : '',
    runId,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: `选择要回放的运行（${scope.topic}/${scope.stage}）` });
  if (picked) await hub.setActiveRun(picked.runId);
}

/** QuickPick：逐家开关（canPickMany；空选 = 全部启用） */
async function criticsFilterPicker(services: TriviumServices): Promise<void> {
  const hub = services.annotationHub;
  const critics = hub.criticsInScope();
  if (critics.length === 0) {
    vscode.window.showInformationMessage('当前 scope 暂无审查者工件。');
    return;
  }
  const current = hub.getEnabledCritics();
  const picked = await vscode.window.showQuickPick(
    critics.map((c) => ({ label: c, picked: current.size === 0 || current.has(c) })),
    { canPickMany: true, placeHolder: '选择要展示的审查者（全不选 = 全部展示）' },
  );
  if (picked !== undefined) await hub.setEnabledCritics(new Set(picked.map((p) => p.label)));
}

function nodeFsApi() {
  return {
    async readdir(p: string): Promise<string[]> {
      const { promises: fs } = await import('node:fs');
      return fs.readdir(p);
    },
    async readFile(p: string): Promise<string> {
      const { promises: fs } = await import('node:fs');
      return fs.readFile(p, 'utf8');
    },
  };
}

function registerWithNoWorkspace(context: vscode.ExtensionContext): void {
  const hint = () => vscode.window.showWarningMessage('Trivium 驾驶舱需要先打开一个工作区文件夹。');
  context.subscriptions.push(
    vscode.commands.registerCommand('trivium.openCockpit', hint),
    vscode.commands.registerCommand('trivium.refreshHealth', hint),
    vscode.commands.registerCommand('trivium.history.refresh', hint),
    vscode.commands.registerCommand('trivium.openManual', hint),
    vscode.commands.registerCommand('trivium.openDeployManual', hint),
  );
}

/** 打开工作区内文档；都不存在则如实提示（CLAUDE-10：链接必须真实存在） */
async function openRepoDoc(root: string, candidates: string[]): Promise<void> {
  const { promises: fs } = await import('node:fs');
  const pathMod = await import('node:path');
  for (const c of candidates) {
    const abs = pathMod.join(root, c);
    try {
      await fs.access(abs);
      await vscode.window.showTextDocument(vscode.Uri.file(abs), { preview: true });
      return;
    } catch {
      /* 下一个候选 */
    }
  }
  vscode.window.showWarningMessage(`未找到文档（已尝试：${candidates.join('、')}）。请在 TriviumCode 仓库中打开本工作区。`);
}
