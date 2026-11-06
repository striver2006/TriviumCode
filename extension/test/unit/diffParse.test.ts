/** diffParse 单测（r2 计划 D9′：头部/分界/hunk/新增删除判定） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseChangesDiff, diffMember, lineInHunks } from '../../src/reviews/diffParse';

const SAMPLE = `# trivium changes.diff
# run_id: 20261105T185028Z
# base: HEAD
# head: 7bae810026539e4382bdd6e22c90c3f0ec216c1f
# files: 3
#   src/a.ts
#   src/new.ts
#   src/gone.ts
diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,3 +10,4 @@
 context
-old
+new
+added
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 000..333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+line1
+line2
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 444..000
--- a/src/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-gone
`;

test('头部字段：run_id/base/head（冻结基线 sha）', () => {
  const d = parseChangesDiff(SAMPLE);
  assert.equal(d.runId, '20261105T185028Z');
  assert.equal(d.base, 'HEAD');
  assert.equal(d.head, '7bae810026539e4382bdd6e22c90c3f0ec216c1f');
});

test('diff --git 分界 + hunk 归属到文件（AGY-04）', () => {
  const d = parseChangesDiff(SAMPLE);
  assert.equal(d.files.length, 3);
  const a = diffMember(d, 'src/a.ts');
  assert.ok(a);
  assert.equal(a!.hunks.length, 1);
  const { lines: _l, ...hunkHead } = a!.hunks[0]!;
  assert.deepEqual(hunkHead, { oldStart: 10, oldLines: 3, newStart: 10, newLines: 4 });
  assert.equal(a!.added, false);
  assert.equal(a!.deleted, false);
});

test('新增/删除文件判定（AGY-06：/dev/null）', () => {
  const d = parseChangesDiff(SAMPLE);
  const added = diffMember(d, 'src/new.ts');
  assert.ok(added?.added);
  assert.equal(added!.deleted, false);
  const gone = diffMember(d, 'src/gone.ts');
  assert.ok(gone?.deleted);
});

test('成员判定与 hunk 区间', () => {
  const d = parseChangesDiff(SAMPLE);
  assert.equal(diffMember(d, 'src/other.ts'), null);
  const a = diffMember(d, 'src/a.ts')!;
  assert.ok(lineInHunks(a, 10));
  assert.ok(lineInHunks(a, 13));
  assert.ok(!lineInHunks(a, 14));
  assert.ok(!lineInHunks(a, 5));
});

test('精简 diff（无 diff --git 行）→ +++ b/ 兜底分界', () => {
  const d = parseChangesDiff('--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n');
  assert.equal(d.files.length, 1);
  assert.equal(d.files[0]!.relPath, 'src/x.ts');
  assert.equal(d.files[0]!.hunks.length, 1);
});

test('空/坏输入：尽力返回，不抛异常', () => {
  assert.deepEqual(parseChangesDiff(''), { runId: null, base: null, head: null, files: [] });
  const d = parseChangesDiff('random text\nno headers');
  assert.equal(d.files.length, 0);
});

test('主仓真实工件（存在即测）：头部与文件数', async () => {
  const p = path.join(process.cwd(), '..', '.reviews', 'VSCode插件Phase0-1', 'code', '_meta', 'changes-20261105T185028Z.diff');
  let text: string;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch {
    return; // 独立分发环境跳过
  }
  const d = parseChangesDiff(text);
  assert.equal(d.head, '7bae810026539e4382bdd6e22c90c3f0ec216c1f');
  assert.ok(d.files.length >= 60);
  const readme = diffMember(d, 'extension/README.md');
  assert.ok(readme, 'README 在变更集内');
  assert.ok(d.files.some((f) => f.added), '首轮变更含新增文件');
});

// ── S8 修订（CLAUDE-02/05、AGY-03）：hunk 正文 / applyHunks / resolveBaseRef / pendingAdded ──
import { applyHunks, resolveBaseRef } from '../../src/reviews/diffParse';

test('hunk 正文行收集（CLAUDE-02：送审内容重建的输入）', () => {
  const d = parseChangesDiff(SAMPLE);
  const a = diffMember(d, 'src/a.ts')!;
  assert.deepEqual(a.hunks[0]!.lines, [' context', '-old', '+new', '+added']);
});

test('applyHunks：base + 补丁段 → 送审工作树内容（CLAUDE-02 核心语义）', () => {
  const base = ['l1', 'l2', 'old', 'l4', 'l5'].join('\n');
  const d = parseChangesDiff('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -2,3 +2,4 @@\n l2\n-old\n+new\n+added\n l4\n');
  const sent = applyHunks(base, d.files[0]!.hunks);
  assert.equal(sent, ['l1', 'l2', 'new', 'added', 'l4', 'l5'].join('\n'));
  // 多 hunk 顺序应用
  const base2 = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
  const d2 = parseChangesDiff('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-a\n+A\n@@ -5,2 +5,2 @@\n-e\n+E\n f\n');
  assert.equal(applyHunks(base2, d2.files[0]!.hunks), ['A', 'b', 'c', 'd', 'E', 'f', 'g'].join('\n'));
  // 应用后 == 工作区 → consistent 判据成立；此处验证 CRLF 归一
  assert.equal(applyHunks(base.replace(/\n/g, '\r\n'), d.files[0]!.hunks), ['l1', 'l2', 'new', 'added', 'l4', 'l5'].join('\n'));
});

test('resolveBaseRef：base 字面 HEAD → head sha；40 位 sha → 自身；其它 ref → null（CLAUDE-05）', () => {
  assert.equal(resolveBaseRef({ runId: null, base: 'HEAD', head: 'abc123', files: [] }), 'abc123');
  const sha = '0123456789012345678901234567890123456789';
  assert.equal(resolveBaseRef({ runId: null, base: sha, head: 'def456', files: [] }), sha);
  assert.equal(resolveBaseRef({ runId: null, base: 'main', head: 'abc', files: [] }), null);
  assert.equal(resolveBaseRef({ runId: null, base: null, head: 'abc', files: [] }), null);
});

test('简化 patch（无 --git 头）新增文件：pendingAdded 兜底（AGY-03）', () => {
  const d = parseChangesDiff('--- /dev/null\n+++ b/src/new2.ts\n@@ -0,0 +1,1 @@\n+hello\n');
  const f = d.files[0]!;
  assert.equal(f.relPath, 'src/new2.ts');
  assert.ok(f.added, '无 --git 头时 --- /dev/null 也判新增');
  assert.deepEqual(f.hunks[0]!.lines, ['+hello']);
});

// ── r2 修订（AGY-02/CODEX-04）：\ No newline 不截断 hunk ──

test('`\\ No newline` 标记：跳过且不结束 hunk，后续行完整收集（AGY-02/CODEX-04）', () => {
  const text = [
    'diff --git a/f b/f',
    '--- a/f',
    '+++ b/f',
    '@@ -1,2 +1,3 @@',
    '-old',
    '\\ No newline at end of file',
    '+new1',
    '+new2',
    ' ctx',
  ].join('\n');
  const d = parseChangesDiff(text);
  const h = d.files[0]!.hunks[0]!;
  assert.deepEqual(h.lines, ['-old', '+new1', '+new2', ' ctx'], '\\ 标记跳过且 hunk 未被截断');
});

test('applyHunks + 末尾换行：`\\` 标记场景的重建行序正确（CODEX-04）', () => {
  // old 侧末尾无换行（-last + \）、new 侧补两行
  const d = parseChangesDiff('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -2,1 +2,2 @@\n-last\n\\ No newline at end of file\n+last\n+tail\n');
  const sent = applyHunks('base\nlast', d.files[0]!.hunks);
  assert.equal(sent, 'base\nlast\ntail', '\\ 标记不参与重建，行序完整（末尾换行差由 Hub 比对容差兜住）');
});
