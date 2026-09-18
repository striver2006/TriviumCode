import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  resolveTopicName, resolveTopicReadOnly, resolveTopic, listTopics, locateSubject, topicExists,
} from '../../src/trivium/topic.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';

/*
 * topic.ts 原先只被集成用例间接覆盖。它决定「审的是哪份原稿」与「什么时候建目录」，
 * 出错的形态是静默审错文件、或预检失败却留下空目录（AC-16）。
 */

async function fakeCtx(): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-topic-'));
  return { config: defaultConfig(), projectRoot: root, archiveRoot: path.join(root, '.reviews'), triviumDir: path.join(root, '.trivium'), sources: ['<test>'] };
}

test('主题名规范化：空格转连字符；非法名退 64 并带建议', async () => {
  const ctx = await fakeCtx();
  assert.equal(resolveTopicName(ctx, '登录 重构'), '登录-重构');
  assert.throws(() => resolveTopicName(ctx, '登录重构-r2'), (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.USAGE);
    assert.match(e.message, /建议改为：登录重构/);
    return true;
  });
});

test('resolveTopicReadOnly 不创建任何目录；resolveTopic 才建阶段目录', async () => {
  const ctx = await fakeCtx();
  const ro = await resolveTopicReadOnly(ctx, 't', 'plan');
  assert.equal(ro.stageDirAbs, path.join(ctx.archiveRoot, 't', 'plan'));
  await assert.rejects(fs.access(ctx.archiveRoot), '只读解析不得建归档根');
  const rw = await resolveTopic(ctx, 't', 'plan');
  await fs.access(rw.stageDirAbs);
});

test('listTopics：跳过 . 与 _ 前缀目录与普通文件；归档根不存在返回空', async () => {
  const ctx = await fakeCtx();
  assert.deepEqual(await listTopics(ctx), []);
  for (const d of ['b主题', 'a主题', '.hidden', '_meta']) await fs.mkdir(path.join(ctx.archiveRoot, d), { recursive: true });
  await fs.writeFile(path.join(ctx.archiveRoot, 'README.md'), 'x');
  assert.deepEqual(await listTopics(ctx), ['a主题', 'b主题']);
});

test('locateSubject：显式路径不存在退 65；存在则原样返回绝对路径', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopicReadOnly(ctx, 't', 'plan');
  await assert.rejects(locateSubject(ref, 'nope.md', ctx.projectRoot), (e: { code?: number }) => e.code === EXIT.MISSING_ARTIFACT);
  await fs.writeFile(path.join(ctx.projectRoot, 'draft.md'), '# x');
  assert.equal(await locateSubject(ref, 'draft.md', ctx.projectRoot), path.join(ctx.projectRoot, 'draft.md'));
});

test('locateSubject：取轮次最大的原稿，忽略裁决件、别的主题与审查文档', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopic(ctx, 't', 'plan');
  for (const f of [
    '2026-09-10-t-claude.md', '2026-09-11-t-r2-claude.md', '2026-09-12-t-r2-revised-claude.md',
    '2026-09-12-t-gemini.md', '2026-09-12-别的-r9-claude.md', 'notes.txt',
  ]) await fs.writeFile(path.join(ref.stageDirAbs, f), '#');
  assert.equal(path.basename(await locateSubject(ref, null, ctx.projectRoot)), '2026-09-11-t-r2-claude.md');
});

/*
 * ───────── CODEX-07：审查件不得被当成原稿（M9 第 5 步，T-5b）─────────
 *
 * 这一组钉的是 `topic.ts` 的 `locateSubject`——**`review --start` 真实走的那条**。
 * `topic-args.ts` 里另有一个同形的 `locateSubjectReadOnly`（命令 A 与 topic resolve 走它），
 * 两处判据逐项同形、必须同改，各自都有用例：只改一处时另一处会静默漏判，
 * 而「只覆盖了只读那条」恰好是计划第 2 轮被指出来的形态。
 */
const REVIEW_FM = '---\nschema: trivium.review.v1\nrole: claude\n---\n\n# 计划审查\n';

test('locateSubject：换过 Driver 的主题里，顶着 Driver 后缀的审查件不得被当原稿', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopic(ctx, 't', 'plan');
  /*
   * 真实场景：上一轮由 gemini 当 Driver、claude 当审核者，于是归档里留下一份
   * **顶着 `-claude.md` 后缀的审查件**，而且日期更晚。
   * 候选排序是 `rerunIndex desc, fileName desc`——它会排在真原稿前面。
   */
  await fs.writeFile(path.join(ref.stageDirAbs, '2026-09-10-t-claude.md'), '# 我才是原稿\n');
  await fs.writeFile(path.join(ref.stageDirAbs, '2026-09-12-t-claude.md'), REVIEW_FM);

  assert.equal(
    path.basename(await locateSubject(ref, null, ctx.projectRoot)),
    '2026-09-10-t-claude.md',
    '日期更晚的那份是审查件（front-matter 为 trivium.review.v1），应被剔除；' +
      '选中它会让这一轮审的是「对意见的意见」',
  );
});

test('locateSubject：剔到没有候选时退 65，并点名被剔掉的是哪些', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopic(ctx, 't', 'plan');
  await fs.writeFile(path.join(ref.stageDirAbs, '2026-09-12-t-claude.md'), REVIEW_FM);
  await assert.rejects(locateSubject(ref, null, ctx.projectRoot), (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.MISSING_ARTIFACT);
    // 不点名的话，「明明有一份同名文件却说找不到」会把人引去查文件名规则
    assert.match(e.message, /已排除/, '要说明有候选被剔除了');
    assert.match(e.message, /2026-09-12-t-claude\.md/, '要点名是哪一份');
    return true;
  });
});

test('locateSubject：显式指定一份审查件 → 硬拒，不静默换成别的', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopic(ctx, 't', 'plan');
  await fs.writeFile(path.join(ref.stageDirAbs, '2026-09-10-t-claude.md'), '# 我才是原稿\n');
  const bad = path.join(ref.stageDirAbs, '2026-09-12-t-gemini.md');
  await fs.writeFile(bad, REVIEW_FM);
  /*
   * 显式路径**没有「下一个候选」可退**：静默换成别的就是「解析成功、随后被悄悄替换」
   * 那一族缺口。所以这一路是硬拒，不是过滤。
   */
  await assert.rejects(locateSubject(ref, bad, ctx.projectRoot), (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.MISSING_ARTIFACT);
    assert.match(e.message, /审查件/, '要说清拒的理由是「它是审查件」，不是「文件不存在」');
    return true;
  });
});

test('locateSubject：显式指定旧 Driver 后缀的**原稿**必须放行（R-1 的逃生门）', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopic(ctx, 't', 'plan');
  /*
   * **判据只认 `trivium.review.v1`，不是「后缀对不上就拒」**。
   *
   * 这条钉的是把判据写过宽的那种实现：沿用 freeze 侧 fail-closed 的直觉
   * （「不是当轮 Driver 的产出就拒」）会把这份合法原稿判死——
   * 而换过 Driver 的主题上，用 --plan-file 指向旧 Driver 后缀的原稿
   * 正是 R-1 给用户留的唯一自救出口（改名会破坏文件名解析）。
   */
  const oldDraft = path.join(ref.stageDirAbs, '2026-09-01-t-gemini.md');
  await fs.writeFile(oldDraft, '# 上一轮由 gemini 执笔时的原稿，没有 front-matter\n');
  assert.equal(await locateSubject(ref, oldDraft, ctx.projectRoot), oldDraft);
});

test('locateSubject：front-matter 缺失/损坏/空文件一律按原稿放行，不抛错', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopic(ctx, 't', 'plan');
  /*
   * 四类损坏形态在 `parseFrontMatter` 里全部坍缩为「没有可辨识的 schema」且不抛异常
   * （不以 `---` 开头 / 没有闭合 `---` / YAML 解析失败 / 空文件）。
   * 计划第 2 轮我担心的是「换底会不会把已知问题换成未知问题」——
   * 答案是不会炸，代价在别处（见 EV-63：被剥掉 front-matter 的真审查件会被当原稿）。
   */
  for (const [name, body] of [
    ['2026-09-02-t-claude.md', ''],
    ['2026-09-03-t-claude.md', '---\nschema: trivium.review.v1\n'],   // 没有闭合 ---
    ['2026-09-04-t-claude.md', '---\n: : :\n---\n'],                   // YAML 坏
  ] as const) {
    await fs.writeFile(path.join(ref.stageDirAbs, name), body);
  }
  // 三份都不是「可辨识的审查件」，按轮次/日期取最新那份，且不抛
  assert.equal(
    path.basename(await locateSubject(ref, null, ctx.projectRoot)),
    '2026-09-04-t-claude.md',
  );
});

test('locateSubject：同轮多份按文件名倒序取最新日期', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopic(ctx, 't', 'bug');
  for (const f of ['2026-09-10-t-claude.md', '2026-09-12-t-claude.md']) await fs.writeFile(path.join(ref.stageDirAbs, f), '#');
  assert.equal(path.basename(await locateSubject(ref, null, ctx.projectRoot)), '2026-09-12-t-claude.md');
});

test('locateSubject：没有原稿退 65 并列出目录现状，目录不存在也不抛别的错', async () => {
  const ctx = await fakeCtx();
  const ref = await resolveTopic(ctx, 't', 'plan');
  await fs.writeFile(path.join(ref.stageDirAbs, '2026-09-12-t-revised-claude.md'), '#');
  await assert.rejects(locateSubject(ref, null, ctx.projectRoot), (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.MISSING_ARTIFACT);
    assert.match(e.message, /revised-claude\.md/, '要列出现有文件帮人定位');
    return true;
  });
  const missing = await resolveTopicReadOnly(ctx, 'never', 'plan');
  await assert.rejects(locateSubject(missing, null, ctx.projectRoot), (e: { code?: number }) => e.code === EXIT.MISSING_ARTIFACT);
});

test('topicExists 只看主题目录', async () => {
  const ctx = await fakeCtx();
  assert.equal(await topicExists(ctx, 't'), false);
  await resolveTopic(ctx, 't', 'plan');
  assert.equal(await topicExists(ctx, 't'), true);
});
