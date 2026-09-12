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
