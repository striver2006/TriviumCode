import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { splitArguments, inferTopic, resolveTopicArgs } from '../../src/trivium/topic-args.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';

async function fakeCtx(): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-args-'));
  await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
  await initFixtureRepo(root);
  return {
    config: defaultConfig(),
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'),
    sources: ['<test>'],
  };
}

// ── 参数切分 ──

test('切出具名参数，其余为提示语', () => {
  const r = splitArguments('重点看并发与回滚 --topic 登录重构 --context src,doc');
  assert.equal(r.named['topic'], '登录重构');
  assert.equal(r.named['context'], 'src,doc');
  assert.equal(r.rest, '重点看并发与回滚');
});

test('支持 --k=v 形式', () => {
  const r = splitArguments('--topic=登录重构 --model-glm=GLM-5.3 看并发');
  assert.equal(r.named['topic'], '登录重构');
  assert.equal(r.named['model-glm'], 'GLM-5.3');
  assert.equal(r.rest, '看并发');
});

test('引号内的空格被保留', () => {
  const r = splitArguments('--topic "登录 重构" --focus "重点看 A 与 B"');
  assert.equal(r.named['topic'], '登录 重构');
  assert.equal(r.named['focus'], '重点看 A 与 B');
});

test('提示语正文里出现 -- 不会被误当参数（关键用例）', () => {
  const r = splitArguments('注意 --dangerously-skip-permissions 这个参数绝不能用 --topic X');
  assert.equal(r.named['topic'], 'X');
  assert.match(r.rest, /--dangerously-skip-permissions/);
  assert.equal(r.named['dangerously-skip-permissions' as 'topic'], undefined);
});

test('参数名后紧跟另一个已知参数时，值为空而不吞掉下一个', () => {
  const r = splitArguments('--topic --focus 看并发');
  assert.equal(r.named['topic'], '');
  assert.equal(r.named['focus'], '看并发');
});

test('中文提示语与中文主题都正常', () => {
  const r = splitArguments('--topic 登录重构 重点审查并发安全与回滚路径');
  assert.equal(r.named['topic'], '登录重构');
  assert.equal(r.rest, '重点审查并发安全与回滚路径');
});

test('主题推导：去标点、连字符化、截断', () => {
  assert.equal(inferTopic('把登录改造为 OIDC，并补充回滚', 64), '把登录改造为-OIDC-并补充回滚');
  assert.equal(inferTopic('', 64), '未命名主题');
  assert.ok(inferTopic('x'.repeat(100), 64).length <= 32);
});

// ── 按 stage 的输出契约（AGY-04）──

test('plan 阶段：定位到原稿', async () => {
  const ctx = await fakeCtx();
  const dir = path.join(ctx.archiveRoot, '登录重构/plan');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '2026-09-10-登录重构-claude.md'), '# 计划\n');

  const r = await resolveTopicArgs({
    ctx, scope: 'plan', rawArgs: '--topic 登录重构 重点看并发',
  });
  assert.equal(r.topic, '登录重构');
  assert.equal(r.prompt_hint, '重点看并发');
  assert.ok(r.subject_path?.endsWith('2026-09-10-登录重构-claude.md'));
  assert.equal(r.topic_inferred, false);
});

test('plan 阶段：找不到原稿退 65 并列出目录现状', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'plan', rawArgs: '--topic 不存在 x' }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.MISSING_ARTIFACT);
      assert.match(e.message, /找不到主题/);
      return true;
    },
  );
});

test('all 阶段（命令 A）：subject_path 为 null，不因原稿不存在而报错', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: '--topic 新功能 把登录改造为 OIDC',
  });
  assert.equal(r.subject_path, null);
  assert.ok(r.notes.some((n) => n.includes('S1')));
});

test('code 阶段：subject_path 为 null，输出 base 与 diff_available', async () => {
  const ctx = await fakeCtx();
  // 造一个未提交的改动，让 diff 非空
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: '--topic 登录重构 看安全' });
  assert.equal(r.subject_path, null);
  assert.equal(r.base, 'HEAD');
  assert.equal(r.diff_available, true);
});

test('code 阶段：无变更时退 65', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: '--topic t 看安全' }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.MISSING_ARTIFACT);
      assert.match(e.message, /无代码变更可审/);
      return true;
    },
  );
});

// ── 纯只读（AGY-01 / GLM-03）──

test('关键用例：resolve 新主题后 .reviews/ 下无任何新增', async () => {
  const ctx = await fakeCtx();
  const before = await fs.readdir(ctx.projectRoot);
  // all 阶段不需要原稿，是最容易被实现成「顺手建目录」的路径
  await resolveTopicArgs({ ctx, scope: 'all', rawArgs: '--topic 全新主题 做点什么' });
  const after = await fs.readdir(ctx.projectRoot);
  assert.deepEqual(after.sort(), before.sort(), 'topic resolve 必须是纯只读');
  await assert.rejects(fs.access(ctx.archiveRoot), '不得创建归档根');
});

test('非法主题名退 64 并给出修正建议', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'all', rawArgs: '--topic 登录重构-r2 x' }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE);
      assert.match(e.message, /保留后缀/);
      assert.match(e.message, /建议改为：登录重构/);
      return true;
    },
  );
});

test('主题缺省时推导并标记 topic_inferred，便于 skill 回显确认', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: '把登录改造为 OIDC' });
  assert.equal(r.topic_inferred, true);
  assert.ok(r.topic.length > 0);
  assert.ok(r.notes.some((n) => n.includes('请向用户回显确认')));
});

test('--focus 与 prompt_hint 的对应统一（AGY-04）', async () => {
  const ctx = await fakeCtx();
  const a = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: '--topic T --focus 看并发' });
  const b = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: '--topic T 看并发' });
  assert.equal(a.prompt_hint, '看并发');
  assert.equal(b.prompt_hint, '看并发', '不带 --focus 时取剩余正文');
});
