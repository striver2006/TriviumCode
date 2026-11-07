/**
 * 保存防护集成测试（FR-10，r2 计划 D9）：激活即装配（不开 UI）、running 期保存
 * 业务文件 → 警示 + 快照 + 一键恢复后磁盘不变、放行目录、损坏 state 保守锁闭、
 * reason 分流（自动保存不弹编辑期 modal——silent 计数验证）。
 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { SaveGuard } from '../../src/guard/saveGuard';
import { StateWatch } from '../../src/monitor/stateWatch';
import { waitFor } from './fixtureLib';

const STATE = (gates: Record<string, unknown>) =>
  JSON.stringify({ schema: 'trivium.state.v1', updated_at: new Date().toISOString(), gates }, null, 2);

/**
 * 独立 tmpdir 不在 VS Code 工作区内——workspace watcher 对区外路径事件不可靠
 * （Phase 1 已实测踩坑）。StateWatch 支持注入 readFile：本套件统一注入 node fs，
 * 状态推进由各用例显式 `await watch.rescan()` 驱动（生产环境工作区内事件可靠）。
 */
const makeWatch = (rootDir: string): StateWatch => new StateWatch(rootDir, (p) => fs.readFile(p, 'utf8'));

/** 在夹具工作区内建一个业务文件并返回 uri */
async function bizFile(root: string, rel: string, content: string): Promise<vscode.Uri> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
  return vscode.Uri.file(abs);
}

suite('保存防护与三色灯（FR-10）', function () {
  this.timeout(90_000);
  let root: string;
  let statePath: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    const os = await import('node:os');
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-guard-fx-'));
    await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
    statePath = path.join(root, '.trivium', 'state.json');
    await fs.writeFile(statePath, STATE({
      'T/plan': { topic: 'T', stage: 'plan', state: 'running', run_id: 'r1', rerun_index: 1, since: 'x', driver: 'glm', session_id: null },
    }));
  });

  test('灯：running → 红；终态 → 绿；unreadable → 红且提示不可读', async () => {
    const watch = makeWatch(root);
    const guard = new SaveGuard(root, watch, () => true, true);
    try {
      await watch.rescan();
      await waitFor(() => guard.lampState.color === 'red', 15_000);
      // 迁移到 approved → 绿
      await fs.writeFile(statePath, STATE({
        'T/plan': { topic: 'T', stage: 'plan', state: 'approved', run_id: 'r1', rerun_index: 1, since: 'x', driver: 'glm', session_id: null },
      }));
      await watch.rescan();
      await waitFor(() => guard.lampState.color === 'green', 15_000);
      // 损坏 JSON → unreadable → 红（CLAUDE-02：不静默绿灯）
      await fs.writeFile(statePath, '{"schema": ');
      await watch.rescan();
      await waitFor(() => guard.lampState.color === 'red' && guard.lampState.label.includes('状态不可读'), 15_000);
      await fs.writeFile(statePath, STATE({
        'T/plan': { topic: 'T', stage: 'plan', state: 'running', run_id: 'r1', rerun_index: 1, since: 'x', driver: 'glm', session_id: null },
      }));
      await watch.rescan();
      await waitFor(() => guard.lampState.color === 'red' && !guard.lampState.label.includes('不可读'), 15_000);
    } finally {
      guard.dispose();
      watch.dispose();
    }
  });

  test('拦截判定：业务文件拦；.reviews/.trivium/.vscode 与工作区外放行', async () => {
    const watch = makeWatch(root);
    const guard = new SaveGuard(root, watch, () => true, true);
    try {
      await watch.rescan();
      await waitFor(() => guard.lampState.color === 'red', 15_000);
      assert.equal(guard.isProtected(vscode.Uri.file(path.join(root, 'src/a.ts'))), true);
      assert.equal(guard.isProtected(vscode.Uri.file(path.join(root, '.reviews/T/plan/x.md'))), false);
      assert.equal(guard.isProtected(vscode.Uri.file(path.join(root, '.trivium/state.json'))), false);
      assert.equal(guard.isProtected(vscode.Uri.file(path.join(root, '.vscode/settings.json'))), false);
      assert.equal(guard.isProtected(vscode.Uri.file('/tmp/outside.ts')), false);
      assert.equal(guard.isProtected(vscode.Uri.parse('untitled:Some')), false);
    } finally {
      guard.dispose();
      watch.dispose();
    }
  });

  test('三段式：编辑预警 → 保存快照+警示 → 一键恢复后磁盘回到保存前', async () => {
    const watch = makeWatch(root);
    const guard = new SaveGuard(root, watch, () => true, true);
    try {
      await watch.rescan();
      await waitFor(() => guard.lampState.color === 'red', 15_000);
      const uri = await bizFile(root, 'src/biz.ts', '保存前内容\n');
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      // 第 1 段：编辑触发预警（silent：进 toastLog 不弹窗）
      await editor.edit((b) => b.insert(new vscode.Position(0, 0), '修改'));
      await waitFor(() => guard.toastLog.some((t) => t.includes('编辑期预警')), 15_000);
      // 第 2 段：保存触发快照与警示；waitUntil 必须被同步注册（CLAUDE-01 竞态回归）
      const waitsBefore = guard.waitUntilCalls;
      await doc.save();
      await waitFor(() => guard.toastLog.some((t) => t.includes('已保存到')), 15_000);
      assert.ok(guard.waitUntilCalls > waitsBefore, '保存事件经 e.waitUntil 挂起（快照先于落盘）');
      assert.equal(guard.pendingSnapshots, 1);
      assert.equal(await fs.readFile(doc.uri.fsPath, 'utf8'), '修改保存前内容\n', '保存已发生（VS Code 无取消 API——如实）');
      // 第 3 段：一键恢复（测试通道直接触发）
      assert.equal(await guard.restoreForTest(doc), true);
      await waitFor(async () => (await fs.readFile(doc.uri.fsPath, 'utf8')) === '保存前内容\n', 15_000);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    } finally {
      guard.dispose();
      watch.dispose();
    }
  });

  test('总开关关闭 → 不拦', async () => {
    const watch = makeWatch(root);
    const guard = new SaveGuard(root, watch, () => false, true);
    try {
      await watch.rescan();
      await waitFor(() => guard.lampState.color === 'red', 15_000, );
      assert.equal(guard.isProtected(vscode.Uri.file(path.join(root, 'src/a.ts'))), false, '开关关：红灯仍显示但不拦');
    } finally {
      guard.dispose();
      watch.dispose();
    }
  });
});
