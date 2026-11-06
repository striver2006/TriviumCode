/**
 * 插件级共享服务（单一实例，activate 时创建、deactivate 时统一释放）。
 */
import * as vscode from 'vscode';
import { TriviumCli } from './cli/triviumCli';
import { TriviumCommands } from './cli/commands';
import { TriviumEnv } from './env/config';
import { TerminalRelay } from './launch/terminalRelay';
import { StateWatch } from './monitor/stateWatch';
import { AnnotationHub } from './reviews/annotationHub';

export interface TriviumServices {
  root: string;
  env: TriviumEnv;
  cli: TriviumCli;
  cmds: TriviumCommands;
  relay: TerminalRelay;
  stateWatch: StateWatch;
  /** 批注宿主（Phase 2 FR-6：服务级，独立于驾驶舱面板生命周期） */
  annotationHub: AnnotationHub;
  /** TriviumCode 仓根（工作区即本仓时才有值——渲染产物兜底用） */
  repoRoot: string | null;
  readonly disposables: { push(d: vscode.Disposable): void };
}

export function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath ?? null;
}

export async function createServices(context: vscode.ExtensionContext): Promise<TriviumServices | null> {
  const root = workspaceRoot();
  if (!root) return null;
  const env = new TriviumEnv(root);
  const cli = new TriviumCli(root);
  const relay = new TerminalRelay();
  const stateWatch = new StateWatch(root);
  const annotationHub = new AnnotationHub(root);
  context.subscriptions.push(relay, stateWatch, annotationHub);
  // 渲染产物兜底候选恒为工作区根（工作区即 TriviumCode 仓时命中 skills/ 产品）
  return {
    root,
    env,
    cli,
    cmds: new TriviumCommands(cli),
    relay,
    stateWatch,
    annotationHub,
    repoRoot: root,
    disposables: context.subscriptions,
  };
}
