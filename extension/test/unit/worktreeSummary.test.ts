/** 提示性工作树摘要单测（r2 计划 D9）：porcelain -z 解析、编排器目录过滤、失败降级 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePorcelainZ, filterExcluded, summarizeWorktreeHint, authoritativeFiles, statusText, type GitRunner } from '../../src/approval/worktreeSummary';

test('porcelain -z 解析：普通/未跟踪/重命名双段（新路径在前、旧路径 NUL 在后）', () => {
  const raw = ['M  src/a.ts', '?? new.txt', 'R  renamed.ts', 'old.ts', 'A  add.ts', ''].join('\0');
  const out = parsePorcelainZ(raw);
  assert.deepEqual(out, [
    { status: 'M ', path: 'src/a.ts' },
    { status: '??', path: 'new.txt' },
    { status: 'R ', path: 'renamed.ts' }, // 旧路径段被跳过
    { status: 'A ', path: 'add.ts' },
  ]);
});

test('编排器目录前缀过滤：.reviews/.trivium/.git 不出现在结果（AGY-05）', () => {
  const out = filterExcluded([
    { status: '??', path: '.reviews/T/plan/x-claude.md' },
    { status: '??', path: '.trivium/state.json' },
    { status: 'M ', path: '.gitignore' },
    { status: 'M ', path: 'src/b.ts' },
  ]);
  assert.deepEqual(out, [
    { status: 'M ', path: '.gitignore' }, // .gitignore 是文件不是 .git/ 前缀
    { status: 'M ', path: 'src/b.ts' },
  ]);
});

test('summarize：可用路径 + 排序 + 截断', async () => {
  const run: GitRunner = async () => ({ code: 0, stdout: ['M  src/b.ts', 'M  src/a.ts', '?? .reviews/x.md'].join('\0') + '\0', stderr: '' });
  const hint = await summarizeWorktreeHint(run);
  assert.equal(hint.available, true);
  assert.equal(hint.total, 2);
  assert.deepEqual(hint.files.map((f) => f.path), ['src/a.ts', 'src/b.ts']);
});

test('summarize：非零退出降级（非 git 仓库）', async () => {
  const run: GitRunner = async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository' });
  const hint = await summarizeWorktreeHint(run);
  assert.equal(hint.available, false);
  assert.ok(hint.reason!.includes('128'));
});

test('summarize：调用异常降级', async () => {
  const run: GitRunner = async () => {
    throw new Error('spawn git ENOENT');
  };
  const hint = await summarizeWorktreeHint(run);
  assert.equal(hint.available, false);
  assert.ok(hint.reason!.includes('ENOENT'));
});

test('权威摘要（approve 输出）→ 展示形态：不可用时如实呈现原因', () => {
  assert.deepEqual(authoritativeFiles(undefined), null);
  const bad = authoritativeFiles({ available: false, reason: '基线 tree 已被清理', total: 0, truncated: false, files: [] });
  assert.equal(bad!.kind, 'unavailable');
  assert.equal((bad as { reason: string }).reason, '基线 tree 已被清理');
  const ok = authoritativeFiles({ available: true, reason: null, total: 3, truncated: true, files: [{ status: 'M', path: 'a.ts' }] });
  assert.equal(ok!.kind, 'ok');
  assert.equal((ok as { truncated: boolean }).truncated, true);
});

test('状态码中文标签', () => {
  assert.equal(statusText('??'), '未跟踪');
  assert.equal(statusText('M '), '修改');
  assert.equal(statusText('A '), '新增');
  assert.equal(statusText('D '), '删除');
  assert.equal(statusText('R '), '重命名');
});

test("statusText：未暂存修改 ' M'（首位空格）看 y 位（AGY-05）", () => {
  assert.equal(statusText(' M'), '修改');
  assert.equal(statusText(' D'), '删除');
  assert.equal(statusText('MM'), '修改');
  assert.equal(statusText('??'), '未跟踪');
});
