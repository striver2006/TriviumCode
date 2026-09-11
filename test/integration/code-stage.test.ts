import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, listFiles, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { RunMeta } from '../../src/trivium/types.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

/**
 * `code` 阶段走真实打包 CLI（设计 §6.4 / §9.2 / §8.2 S6）。
 *
 * 与 plan 的关键差别：被审对象不是现成文件，而是一段变更，必须先物化成
 * `code/_meta/changes.diff`。因此这些用例必须真的动工作树、真的让 git 产出 diff。
 */

const TOPIC = '代码审';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

async function codeFixture() {
  const fx = await makeFixture({ topic: TOPIC, draft: false });
  const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
  return { ...fx, codeDir };
}

/** 跑完 --start → --wait，返回 run.json */
async function runCode(
  root: string,
  codeDir: string,
  extra: string[] = [],
): Promise<{ exitCode: number; meta: RunMeta; out: string }> {
  const started = await cli(
    root,
    ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', '看变更', '--json', ...extra],
    STUB,
  );
  assert.equal(started.code, EXIT.OK, `--start 失败：\n${started.stdout}\n${started.stderr}`);
  const cand = extractJsonCandidate(started.stdout);
  assert.ok(cand, `无可解析 JSON：\n${started.stdout}`);
  const js = JSON.parse(cand.json) as { run_id: string; finished_inline?: boolean };

  let exitCode: number = EXIT.STILL_RUNNING;
  let out = started.stdout;
  for (let i = 0; i < 12 && exitCode === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', js.run_id, '--timeout', '20'], STUB, 60_000);
    exitCode = w.code ?? EXIT.FAIL;
    out += w.stdout + w.stderr;
  }
  const meta = JSON.parse(
    await fs.readFile(path.join(codeDir, '_meta', `run-${js.run_id}.json`), 'utf8'),
  ) as RunMeta;
  return { exitCode, meta, out };
}

test('无待审变更 → 退 65 且零工件', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  const before = await listFiles(fx.archiveRoot);

  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', 'x'],
    STUB,
  );
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `应退 65：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /没有待审变更/);
  assert.deepEqual(await listFiles(fx.archiveRoot), before, '失败出口不得留半套工件');
});

test('有变更 → 冻结 changes.diff，其 sha256 即 subject_sha256', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 999;\n', 'utf8');

  const { exitCode, meta } = await runCode(fx.root, fx.codeDir);
  assert.equal(exitCode, EXIT.OK, '双审应成功');

  const diffPath = path.join(fx.codeDir, '_meta', 'changes.diff');
  const diff = await fs.readFile(diffPath, 'utf8');
  assert.match(diff, /# trivium changes\.diff/);
  assert.match(diff, /# base: HEAD/);
  assert.match(diff, /#   src\/a\.ts/);
  assert.match(diff, /\+export const a = 999;/);

  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update(diff).digest('hex');
  assert.equal(meta.snapshot.subject_sha256, sha, 'subject_sha256 必须是补丁全文的 sha256');
});

test('两侧拿到同一份补丁——逐侧各自 git diff 会让两侧审到不同东西', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 1;\nexport const z = 2;\n', 'utf8');

  const { meta } = await runCode(fx.root, fx.codeDir);
  const briefs = (await fs.readdir(path.join(fx.codeDir, '_meta'))).filter((f) => f.startsWith('brief-'));
  assert.equal(briefs.length, 2);

  // 两份 brief 引用的被审对象 sha256 必须一致
  const shas = new Set<string>();
  for (const b of briefs) {
    const text = await fs.readFile(path.join(fx.codeDir, '_meta', b), 'utf8');
    const m = /([0-9a-f]{64})/.exec(text);
    assert.ok(m, `brief ${b} 里没有 sha256`);
    shas.add(m[1]!);
  }
  assert.equal(shas.size, 1, `两侧 brief 的被审对象 sha256 不一致：${[...shas].join(' / ')}`);
  assert.ok(shas.has(meta.snapshot.subject_sha256));
});

test('--base 指定基线', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n', 'utf8');

  const { meta, out } = await runCode(fx.root, fx.codeDir, ['--base', 'HEAD']);
  assert.equal(meta.status, 'success', out);
  const diff = await fs.readFile(path.join(fx.codeDir, '_meta', 'changes.diff'), 'utf8');
  assert.match(diff, /# base: HEAD/);
});

test('未跟踪的新文件也进补丁', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/新增.ts'), 'export const n = 1;\n', 'utf8');

  await runCode(fx.root, fx.codeDir);
  const diff = await fs.readFile(path.join(fx.codeDir, '_meta', 'changes.diff'), 'utf8');
  assert.match(diff, /新增\.ts/, '未跟踪文件必须纳入，否则新增代码完全逃过审查');
});

test('纯文档变更 + 开关打开 → 跳过，不派生 worker、不产审查文档', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({
    topic: TOPIC, draft: false,
    extraReview: ['skip_doc_only_review: true'],
  });
  const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 只改了文档\n', 'utf8');

  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', 'x', '--json'],
    STUB,
  );
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as {
    run_id: string; finished_inline?: boolean; skipped?: boolean; max_waits?: number;
  };
  /*
   * 关键断言：必须在同步窗口内收口。若这里还要 --wait，说明派生了 worker——
   * 而 worker 自己 rebuildContext、拿不到跳过判定，会照样跑完整双审，
   * 判定形同失效且白烧两侧配额。
   */
  assert.equal(js.finished_inline, true, '跳过必须在派生前收口');
  assert.equal(js.max_waits, 0, 'skill 不该再进 --wait 循环');

  const docs = await fs.readdir(codeDir);
  assert.ok(
    !docs.some((f) => f.endsWith('-gemini.md') || f.endsWith('-glm.md')),
    `跳过时不得生成任何审查文档，实际：${docs.join(', ')}`,
  );

  const meta = JSON.parse(
    await fs.readFile(path.join(codeDir, '_meta', `run-${js.run_id}.json`), 'utf8'),
  ) as RunMeta;
  assert.equal(meta.skipped, true);
  assert.ok(meta.skip_reason, '必须写明命中的规则');
  assert.match(meta.skip_reason!, /skip_globs/);
});

test('纯文档但开关关闭 → 照常送审', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture(); // 默认 skip_doc_only_review: false
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 只改了文档\n', 'utf8');

  const { exitCode, meta } = await runCode(fx.root, fx.codeDir);
  assert.equal(exitCode, EXIT.OK);
  assert.notEqual(meta.skipped, true, 'FR-23 是 P2，默认关闭');
  const docs = await fs.readdir(fx.codeDir);
  assert.ok(docs.some((f) => f.endsWith('-gemini.md')), `应照常产出审查文档：${docs.join(', ')}`);
});

test('文档里掺一个源码文件 → 不跳过', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({
    topic: TOPIC, draft: false,
    extraReview: ['skip_doc_only_review: true'],
  });
  const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 文档\n', 'utf8');
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 3;\n', 'utf8');

  const { exitCode, meta } = await runCode(fx.root, codeDir);
  assert.equal(exitCode, EXIT.OK);
  assert.notEqual(meta.skipped, true, '掺了源码就必须审');
});

test('未提交的对方审查产出不得进补丁（经被审对象泄漏）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 7;\n', 'utf8');

  /*
   * 摆一份「刚落盘还没 commit」的对方审查产出——这正是常态：
   * archive 写完文件，Driver 还没提交，此时就跑 code 审。
   * 未跟踪文件本来会被 `git ls-files --others` 收进补丁，
   * 于是对方结论经**被审对象本身**递到审查员手里，三道屏蔽全部绕过。
   */
  const planDir = path.join(fx.archiveRoot, TOPIC, 'plan');
  await fs.mkdir(planDir, { recursive: true });
  const SENTINEL = '哨兵串-对方结论-不该出现在补丁里';
  await fs.writeFile(path.join(planDir, '2026-09-11-代码审-glm.md'), `# GLM 审查\n\n${SENTINEL}\n`, 'utf8');
  await fs.writeFile(path.join(fx.root, '.trivium', 'state.json'), '{"gates":{}}\n', 'utf8');

  await runCode(fx.root, fx.codeDir);
  const diff = await fs.readFile(path.join(fx.codeDir, '_meta', 'changes.diff'), 'utf8');

  assert.doesNotMatch(diff, new RegExp(SENTINEL), '对方审查产出绝不能出现在被审补丁里');
  assert.doesNotMatch(diff, /\.reviews\//, '归档根下的任何路径都不该进补丁');
  assert.doesNotMatch(diff, /\.trivium\//, '运行时状态不该进补丁');
  assert.match(diff, /src\/a\.ts/, '真正的代码变更仍须在内');
});

test('坏 --base → 在冻结前失败且零工件（审查意见 GLM-r2-04）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 5;\n', 'utf8');
  // 造一个未跟踪文件：它的 diff 会让 body 非空，正是旧实现的空判定失效之处
  await fs.writeFile(path.join(fx.root, 'src/未跟踪.ts'), 'export const u = 1;\n', 'utf8');

  const before = await listFiles(fx.archiveRoot);
  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', 'x', '--base', '压根不存在的ref'],
    STUB,
  );

  /*
   * 旧实现吞掉 `git diff` 的非零退出：已跟踪变更全部消失，而未跟踪文件让 body
   * 非空，于是一份**缺失全部已跟踪变更**的残缺补丁带着错误的 base 照常送审，
   * 两侧「认真审完」的其实是一段不完整的变更。
   */
  assert.equal(r.code, EXIT.USAGE, `坏 base 应退 64：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /压根不存在的ref/, '要回显用户给的原值');
  assert.deepEqual(await listFiles(fx.archiveRoot), before, '失败在冻结之前，不得留任何工件');
});

test('未跟踪文件的引号路径也进补丁', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/含 空格.ts'), 'export const s = 1;\n', 'utf8');

  const { meta } = await runCode(fx.root, fx.codeDir);
  assert.equal(meta.status, 'success');
  const diff = await fs.readFile(path.join(fx.codeDir, '_meta', 'changes.diff'), 'utf8');
  assert.match(diff, /含 空格\.ts/);
});
