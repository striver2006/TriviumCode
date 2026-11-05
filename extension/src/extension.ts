/**
 * 插件激活入口。
 *
 * 注册命令、视图与配置；全部 Disposable 进 context.subscriptions 统一释放。
 */
import * as vscode from 'vscode';
import { createServices, type TriviumServices } from './services';
import { HealthProvider } from './ui/healthTree';
import { Cockpit } from './ui/cockpit';

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
  context.subscriptions.push(cockpit);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('triviumHealth', health),
    vscode.commands.registerCommand('trivium.refreshHealth', () => void health.refresh()),
    vscode.commands.registerCommand('trivium.openCockpit', () => void cockpit.open()),
    vscode.commands.registerCommand('trivium.openManual', () => void openRepoDoc(services.root, [
      'doc/07_manuals/使用手册.md',
    ])),
    vscode.commands.registerCommand('trivium.openDeployManual', () => void openRepoDoc(services.root, [
      'doc/06_deployment/部署手册.md',
      'doc/07_manuals/部署手册.md', // 兜底：文档目录可能重排
    ])),
  );
}

function registerWithNoWorkspace(context: vscode.ExtensionContext): void {
  const hint = () => vscode.window.showWarningMessage('Trivium 驾驶舱需要先打开一个工作区文件夹。');
  context.subscriptions.push(
    vscode.commands.registerCommand('trivium.openCockpit', hint),
    vscode.commands.registerCommand('trivium.refreshHealth', hint),
    vscode.commands.registerCommand('trivium.openManual', hint),
    vscode.commands.registerCommand('trivium.openDeployManual', hint),
  );
}

/** 打开工作区内文档；都不存在则如实提示（CLAUDE-10：链接必须真实存在） */
async function openRepoDoc(root: string, candidates: string[]): Promise<void> {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  for (const c of candidates) {
    const abs = path.join(root, c);
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

export function deactivate(): void {
  /* 订阅已由 context.subscriptions 统一释放 */
}
