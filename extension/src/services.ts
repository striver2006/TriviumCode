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
import { SaveGuard } from './guard/saveGuard';
import { PresetStore } from './presets/presetStore';

export interface TriviumServices {
  root: string;
  env: TriviumEnv;
  cli: TriviumCli;
  cmds: TriviumCommands;
  relay: TerminalRelay;
  stateWatch: StateWatch;
  /** 批注宿主（Phase 2 FR-6：服务级，独立于驾驶舱面板生命周期） */
  annotationHub: AnnotationHub;
  /** 保存防护与三色灯（Phase 3 FR-10：已 init 的工作区才有；服务级） */
  saveGuard: SaveGuard | null;
  /** 预设存储（Phase 3 FR-11：globalState + workspaceState 双作用域） */
  presets: PresetStore;
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
  // Phase 3（计划 r2 §D4 激活）：已 init 的工作区启动即装配保存防护与三色灯
  // （onStartupFinished 激活 + 此处判定，不开任何视图也生效，CLAUDE-01）
  let saveGuard: SaveGuard | null = null;
  if (await env.inited()) {
    saveGuard = new SaveGuard(root, stateWatch);
    context.subscriptions.push(saveGuard);
  }
  const presets = new PresetStore(
    { get: (k) => Promise.resolve(context.globalState.get(k)), update: (k, v) => context.globalState.update(k, v) },
    { get: (k) => Promise.resolve(context.workspaceState.get(k)), update: (k, v) => context.workspaceState.update(k, v) },
  );
  // 渲染产物兜底候选恒为工作区根（工作区即 TriviumCode 仓时命中 skills/ 产品）
  return {
    root,
    env,
    cli,
    cmds: new TriviumCommands(cli),
    relay,
    stateWatch,
    annotationHub,
    saveGuard,
    presets,
    repoRoot: root,
    disposables: context.subscriptions,
  };
}
