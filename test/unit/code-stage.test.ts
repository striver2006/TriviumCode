import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiffHeader,
  classifyDiff,
  diffExcludePrefixes,
  filesInDiff,
  renderSkipNotice,
  summarizeDiff,
} from '../../src/trivium/code-stage.js';
import { defaultConfig } from '../../src/trivium/config.js';

/**
 * `code` 阶段的两件专属逻辑：补丁头部与 FR-23 路径分类（设计 §6.4 / §9.2）。
 *
 * 分类的关键不是「分得细」，而是**该不可跳过的一定不可跳过**。
 * 跳过判定放宽一点点，代价就是一次未经审查的代码变更通过了闸门。
 */

const cfg = () => defaultConfig();

// ── 文件清单提取 ──

test('从 diff 头提取文件路径', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 111..222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/docs/x.md b/docs/x.md',
    '--- /dev/null',
    '+++ b/docs/x.md',
  ].join('\n');
  assert.deepEqual(filesInDiff(diff), ['docs/x.md', 'src/a.ts']);
});

test('重命名的两侧路径都收', () => {
  const diff = 'diff --git a/old/name.ts b/new/name.ts\nsimilarity index 95%\n';
  assert.deepEqual(filesInDiff(diff), ['new/name.ts', 'old/name.ts']);
});

test('/dev/null 不会被当成文件', () => {
  // --- /dev/null 出现在新增文件的 diff 里；只认 `diff --git` 行就不会误收
  const diff = 'diff --git a/新增.ts b/新增.ts\n--- /dev/null\n+++ b/新增.ts\n';
  assert.deepEqual(filesInDiff(diff), ['新增.ts']);
});

test('空 diff 得到空清单，不抛异常', () => {
  assert.deepEqual(filesInDiff(''), []);
});

// ── 补丁头部 ──

test('头部记 base/head 与文件清单——离线补丁没有这几行就无从复核', () => {
  const h = buildDiffHeader({ runId: 'R1', base: 'main', head: 'abc123', files: ['a.ts', 'b.ts'] });
  assert.match(h, /# run_id: R1/);
  assert.match(h, /# base: main/);
  assert.match(h, /# head: abc123/);
  assert.match(h, /# files: 2/);
  assert.match(h, /#   a\.ts/);
  assert.match(h, /#   b\.ts/);
});

test('空仓库无 HEAD 时明示，而不是写成空串', () => {
  const h = buildDiffHeader({ runId: 'R1', base: 'HEAD', head: null, files: [] });
  assert.match(h, /# head: \(无 HEAD，空仓库\)/);
});

// ── FR-23 分类 ──

test('全部路径命中 skip_globs → doc_only，可跳过', () => {
  const v = classifyDiff(cfg(), ['README.md', 'docs/guide.md', 'notes.txt']);
  assert.equal(v.category, 'doc_only');
  assert.equal(v.skippable, true);
});

test('默认配置下可跳过也不跳过——skip_doc_only_review 默认 false', () => {
  const v = classifyDiff(cfg(), ['README.md']);
  assert.equal(v.skippable, true);
  assert.equal(v.skipped, false, 'FR-23 是 P2，默认关闭');
  assert.ok(v.reasons.some((r) => /skip_doc_only_review 为 false/.test(r)));
});

test('开了开关才真跳过', () => {
  const c = cfg();
  c.review.skip_doc_only_review = true;
  const v = classifyDiff(c, ['README.md', 'docs/a.md']);
  assert.equal(v.skipped, true);
});

test('掺一个源码文件即不可跳过', () => {
  const c = cfg();
  c.review.skip_doc_only_review = true;
  const v = classifyDiff(c, ['README.md', 'src/a.ts']);
  assert.equal(v.category, 'business');
  assert.equal(v.skippable, false);
  assert.equal(v.skipped, false);
  assert.deepEqual(v.nonDocPaths, ['src/a.ts']);
});

test('只改注释的 .ts 也不跳过——一期只做路径判定，宁可多审', () => {
  const c = cfg();
  c.review.skip_doc_only_review = true;
  // 「仅注释/格式变化」要语言感知，是二期的事
  assert.equal(classifyDiff(c, ['src/a.ts']).skippable, false);
});

test('依赖清单不可跳过，但锁文件本身不触发依赖类', () => {
  const c = cfg();
  c.review.skip_doc_only_review = true;
  const dep = classifyDiff(c, ['README.md', 'package.json']);
  assert.equal(dep.category, 'dependency');
  assert.equal(dep.skippable, false);
  assert.ok(dep.reasons.some((r) => /依赖清单/.test(r)));

  // 锁文件变更是依赖清单变更带出来的，单独审无意义（§6.4 表格括注）
  const lockOnly = classifyDiff(c, ['package-lock.json']);
  assert.notEqual(lockOnly.category, 'dependency');
});

test('各生态的依赖清单都认', () => {
  const c = cfg();
  for (const f of ['pubspec.yaml', 'Cargo.toml', 'pyproject.toml', 'requirements-dev.txt', 'go.mod']) {
    assert.equal(classifyDiff(c, ['README.md', f]).category, 'dependency', `${f} 应判依赖清单`);
  }
  for (const f of ['Cargo.lock', 'poetry.lock', 'go.sum', 'pnpm-lock.yaml']) {
    assert.notEqual(classifyDiff(c, [f]).category, 'dependency', `${f} 是锁文件`);
  }
});

test('never_skip_globs 优先于一切——CI 与权限配置永不跳过', () => {
  const c = cfg();
  c.review.skip_doc_only_review = true;
  for (const f of c.review.never_skip_globs.slice(0, 3)) {
    // 用 glob 的字面前缀造一个真实路径
    const probe = f.replace('**/', '').replace('/**', '/x');
    const v = classifyDiff(c, [probe]);
    assert.equal(v.skipped, false, `${probe}（来自 ${f}）不得被跳过`);
  }
});

test('.github 与 .trivium 下的变更不可跳过，哪怕文件名是 .md', () => {
  const c = cfg();
  c.review.skip_doc_only_review = true;
  for (const f of ['.github/workflows/ci.yml', '.trivium/config.yaml', '.claude/settings.json']) {
    const v = classifyDiff(c, [f]);
    assert.equal(v.skipped, false, `${f} 不得被跳过`);
    assert.equal(v.category, 'ci_or_permission');
  }
  // 关键用例：.github 下的 .md 命中 skip_globs，但必须被 never_skip 拦住
  const md = classifyDiff(c, ['.github/PULL_REQUEST_TEMPLATE.md']);
  assert.equal(md.skipped, false, '路径在 .github 下，扩展名是 .md 也不许跳过');
});

test('判定结果自带文件清单，渲染与落盘不必再传一遍', () => {
  const c = cfg();
  c.review.skip_doc_only_review = true;
  const v = classifyDiff(c, ['a.md', 'b.md']);
  assert.deepEqual(v.files, ['a.md', 'b.md']);
  const notice = renderSkipNotice(v);
  assert.match(notice, /2 个路径/);
  assert.match(notice, /未\*\*生成任何审查文档/);
});

test('规模摘要给出文件数与补丁大小', () => {
  const s = summarizeDiff({
    path: '/x/changes.diff', sha256: 'a', files: ['a.ts', 'b.ts'],
    base: 'main', head: 'deadbeefcafe', bytes: 2048,
  });
  assert.match(s, /相对 main/);
  assert.match(s, /deadbeef/);
  assert.match(s, /2 个文件/);
  assert.match(s, /2\.0 KB/);
});

// ── 补丁排除项（安全边界，不是优化）──

test('归档根与 .trivium 一律排除——否则对方产出会经补丁泄漏', () => {
  const ex = diffExcludePrefixes('.reviews');
  assert.ok(ex.includes('.reviews'), '归档根必须排除');
  assert.ok(ex.includes('.trivium'), '运行时状态必须排除');
  assert.ok(ex.includes('.git'));
});

test('自定义归档根也被排除', () => {
  assert.ok(diffExcludePrefixes('audit/reviews').includes('audit/reviews'));
  assert.ok(diffExcludePrefixes('./audit').includes('audit'));
  assert.ok(diffExcludePrefixes('audit/').includes('audit'));
});

test('归档根在项目外时不当成项目内前缀', () => {
  // path.relative 可能给出 ../x：那不在项目树内，加进 pathspec 只会让 git 报错
  const ex = diffExcludePrefixes('../elsewhere');
  assert.ok(!ex.some((p) => p.startsWith('..')), `不得包含上溯路径：${ex.join(', ')}`);
  assert.ok(ex.includes('.trivium'));
});
