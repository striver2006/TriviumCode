/**
 * Diff 视图集成测试（r2 计划 D9′：CLAUDE-04 落实——git 可用 + 三路降级 + 冻结基线）。
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { openDiffFor, resetGitApiCacheForTest, type GitApiShape } from '../../src/reviews/diffView';
import { parseChangesDiff } from '../../src/reviews/diffParse';
import { buildPhase2Fixture, waitFor, type Phase2Fixture } from './fixtureLib';

/**
 * 测试环境 `--disable-extensions` 连内置 git 扩展一并禁用——真实 git: scheme
 * 读取天然覆盖「降级」路径；「git 可用」路径用注入伪 API 测编排逻辑
 * （探测 → vscode.diff → 定位），真实 git 语义由 F5 走查与真实使用验证。
 */
const fakeGitApi = (): GitApiShape => ({
  toGitUri: (uri) => vscode.Uri.file(uri.fsPath + '.baseline'), // 夹具基线快照文件
});

suite('Diff 视图（FR-6d 冻结基线）', function () {
  this.timeout(60_000);
  let fx: Phase2Fixture;
  let diff: ReturnType<typeof parseChangesDiff>;

  suiteSetup(async () => {
    fx = await buildPhase2Fixture();
    diff = parseChangesDiff(fs.readFileSync(`${fx.metaDir}/changes-${fx.run2Id}.diff`, 'utf8'));
  });
  setup(() => resetGitApiCacheForTest(null));

  test('成员判定：真实 git diff（5 文件：改 3 + 增 1 + 删 1）（AGY-04/AGY-06）', () => {
    assert.equal(diff.head, fx.gitSha, '解析出冻结 head sha');
    assert.equal(diff.files.length, 5);
    assert.ok(diff.files.find((f) => f.relPath === 'src/sample.ts' && !f.added && !f.deleted));
    assert.ok(diff.files.find((f) => f.relPath === 'src/drifting.ts' && !f.added && !f.deleted));
    assert.ok(diff.files.find((f) => f.relPath === 'src/stale.ts' && !f.added && !f.deleted));
    assert.ok(diff.files.find((f) => f.relPath === 'src/added.ts' && f.added));
    assert.ok(diff.files.find((f) => f.relPath === 'src/gone.ts' && f.deleted));
    // hunk 正文与基线/工作区自洽（CLAUDE-02 送审内容重建的前提）
    const sample = diff.files.find((f) => f.relPath === 'src/sample.ts')!;
    assert.ok(sample.hunks.length > 0 && sample.hunks.every((h) => h.lines.length > 0));
  });

  test('git 可用：被审基线 diff 打开 + 定位（CODEX-01/CLAUDE-02/05）', async () => {
    resetGitApiCacheForTest(fakeGitApi());
    const out = await openDiffFor(fx.root, diff, 'src/sample.ts', { startLine: 3, endLine: 3 });
    assert.equal(out.opened, 'diff');
    assert.match(out.note, new RegExp(fx.gitSha.slice(0, 8)));
    // diff 打开后活动编辑器是右侧工作区文件，且已定位（diff 布局就绪是异步的）
    await waitFor(() => {
      const editor = vscode.window.activeTextEditor;
      return editor !== undefined && editor.document.uri.fsPath.endsWith('src/sample.ts');
    });
    assert.equal(vscode.window.activeTextEditor!.selection.start.line, 2, '定位到 L3');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('HEAD 前进后回放同一 run：基线仍是冻结 sha', async () => {
    fs.writeFileSync(`${fx.root}/later.txt`, 'later\n');
    execSync('git add later.txt && git commit -q -m later', { cwd: fx.root });
    resetGitApiCacheForTest(fakeGitApi()); // 左侧 = 冻结 sha（.baseline 不随 HEAD 前进变化）
    const out = await openDiffFor(fx.root, diff, 'src/sample.ts', { startLine: 2, endLine: 2 });
    assert.equal(out.opened, 'diff', 'HEAD 前进后仍可打开（基线 = 冻结 sha 而非当前 HEAD）');
    assert.match(out.note, new RegExp(fx.gitSha.slice(0, 8)));
    await waitFor(() => {
      const editor = vscode.window.activeTextEditor;
      return editor !== undefined && editor.document.uri.fsPath.endsWith('src/sample.ts');
    });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('新增文件：降级打开文件 + 明示（AGY-06）', async () => {
    const out = await openDiffFor(fx.root, diff, 'src/added.ts');
    assert.equal(out.opened, 'file');
    assert.match(out.note, /新增/);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('删除文件（真删，CLAUDE-06）：git 可用 → 打开被审基线只读；git 不可用 → 仅明示不抛', async () => {
    assert.equal(fs.existsSync(`${fx.root}/src/gone.ts`), false, '夹具工作区已删除 gone.ts');
    resetGitApiCacheForTest(fakeGitApi());
    const out1 = await openDiffFor(fx.root, diff, 'src/gone.ts');
    assert.equal(out1.opened, 'file');
    assert.match(out1.note, /已删除.*基线|基线.*只读/);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    resetGitApiCacheForTest(null); // git 不可用：不尝试打开已不存在的工作区路径
    const out2 = await openDiffFor(fx.root, diff, 'src/gone.ts');
    assert.equal(out2.opened, 'file');
    assert.match(out2.note, /已删除/);
  });

  test('非变更集成员 / 无 diff：直接打开 + 明示（降级不静默）', async () => {
    // 用磁盘上存在但不在变更集的文件（.trivium/config.yaml 夹具自带）
    const out1 = await openDiffFor(fx.root, diff, '.trivium/config.yaml');
    assert.equal(out1.opened, 'file');
    assert.match(out1.note, /不在本轮变更集/);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    const out2 = await openDiffFor(fx.root, null, 'src/sample.ts');
    assert.equal(out2.opened, 'file');
    assert.match(out2.note, /无 changes.diff/);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('自定义 base（CLAUDE-05）：40 位 sha → 用该 sha；ref 字面量 → 无法冻结降级明示', async () => {
    resetGitApiCacheForTest(fakeGitApi());
    const shaDiff = { ...diff, base: 'fedcba9876543210fedcba9876543210fedcba98' };
    const out1 = await openDiffFor(fx.root, shaDiff, 'src/sample.ts', { startLine: 1, endLine: 1 });
    assert.equal(out1.opened, 'diff', 'base 为 sha 时直接用该 sha 作基线');
    assert.match(out1.note, /fedcba98/);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    const refDiff = { ...diff, base: 'main' };
    const out2 = await openDiffFor(fx.root, refDiff, 'src/sample.ts');
    assert.equal(out2.opened, 'file');
    assert.match(out2.note, /自定义 base「main」未能冻结/);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('git 扩展不可用（或对象缺失）：降级打开文件 + 明示原因', async () => {
    // 伪 diff：head 指向不存在对象（模拟 GC/浅克隆）
    const fakeDiff = { ...diff, head: '0123456789012345678901234567890123456789' };
    const out = await openDiffFor(fx.root, fakeDiff, 'src/sample.ts');
    assert.equal(out.opened, 'file');
    assert.match(out.note, /不可读|不可用|无冻结/);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
