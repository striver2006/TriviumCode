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
    ctx, scope: 'plan', rawArgs: '--topic 登录重构 --focus 重点看并发',
  });
  assert.equal(r.topic, '登录重构');
  assert.equal(r.prompt_hint, '重点看并发');
  assert.ok(r.subject_path?.endsWith('2026-09-10-登录重构-claude.md'));
  assert.equal(r.topic_inferred, false);
});

test('plan 阶段：找不到原稿退 65 并列出目录现状', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'plan', rawArgs: '--topic 不存在 --focus x' }),
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
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: '--topic 登录重构 --focus 看安全' });
  assert.equal(r.subject_path, null);
  assert.equal(r.base, 'HEAD');
  assert.equal(r.diff_available, true);
});

test('code 阶段：无变更时退 65', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: '--topic t --focus 看安全' }),
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
  assert.equal(a.prompt_hint, '看并发');
});

/*
 * ── 焦点只认 --focus，位置参数一律是任务目标 ──
 *
 * 旧实现 `named['focus'] ?? rest` 让焦点落在「具名参数挑剩下的残渣」上：
 * 焦点里出现白名单词就连同后一个 token 被抠走，正文静默缺一块，
 * 而第 2 段是 FR-20 / AC-09 承诺**逐字**嵌入的唯一落点。
 */

test('位置参数是任务目标，不再兼作焦点', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: '--topic T 把登录改造为 OIDC --focus 重点看会话固定',
  });
  assert.equal(r.task_goal, '把登录改造为 OIDC');
  assert.equal(r.prompt_hint, '重点看会话固定');
  assert.notEqual(r.task_goal, r.prompt_hint, '两者同源会让 BRIEF 第 2 段与第 4 段雷同');
});

test('焦点里出现白名单旗标字样不再被静默吞掉', async () => {
  const ctx = await fakeCtx();
  // base 字段只在 code 阶段计算，所以造一个未提交改动走真实路径
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const focus = '核实 --base 透传说明是否准确';
  const r = await resolveTopicArgs({
    ctx, scope: 'code', rawArgs: `--topic T --focus "${focus}" --base HEAD`,
  });
  assert.equal(r.prompt_hint, focus, '焦点被 --base 截断——FR-20 的逐字承诺落空');
  assert.equal(r.base, 'HEAD', '焦点里的 --base 字样不该影响真正的 --base');
});

/*
 * ── 边界契约：贪婪取值解决的是「空格」，不是「旗标字样」──
 *
 * 焦点里出现 `--base` 这类**已知旗标名**时，贪婪循环仍会在那里停住，
 * 必须靠字面引号保护。这是命令行固有的歧义，不是缺陷：不加引号就无法
 * 区分「用户在谈论 --base」和「用户在传 --base」。
 *
 * 固定成用例是为了别让后人把它当 bug「修」掉——真正的防线是
 * SKILL.md 要求执行者给自由文本加引号，以及下游校验（坏 base / 坏档位
 * / 非法 slug 都退 64）兜住大部分误吞。
 */
test('主题被推成单字时给出「疑似被旗标截断」的提示', async () => {
  const ctx = await fakeCtx();
  // 「让 --base 真正进入冻结」未加引号：--base 吞掉「真正进入冻结」，正文只剩「让」
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: '让 --base 真正进入冻结 --focus 看看还有没有同类缺口',
  });
  assert.equal(r.topic, '让', '前提：截断后主题确实被推成了单字');
  assert.ok(
    r.notes.some((n) => n.includes('异常短')),
    `单字主题是合法的、validateTopic 不会拦，只能靠 note 点破。实际 notes：${JSON.stringify(r.notes)}`,
  );
});

test('正常长度的推导主题不触发该提示', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: '把登录改造为 OIDC --focus 看会话固定',
  });
  assert.ok(!r.notes.some((n) => n.includes('异常短')), '不该对正常主题误报');
});

test('不加引号时焦点仍会在旗标字样处截断——这是预期行为，靠引号解决', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: '--topic T 目标 --focus 核实 --base 透传是否准确',
  });
  assert.equal(r.prompt_hint, '核实', '没有引号保护时，--base 就是真旗标');
  assert.equal(
    r.task_goal, '目标',
    '「透传是否准确」既没进焦点也没回到正文——它成了 --base 的值，' +
      '也正因如此，这类误吞在 code 阶段会被坏 base 的校验挡下来',
  );
});

test('--focus 贪婪取到下一个已知旗标为止，带空格无需引号', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: '--topic T --focus 重点看 并发 与 会话安全 --model-glm GLM-5.3',
  });
  assert.equal(r.prompt_hint, '重点看 并发 与 会话安全');
  assert.equal(r.models.glm, 'GLM-5.3');
});

test('B/C/D 缺 --focus 直接退 64，并提示首参会被当成任务目标', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: '--topic T 顺手把提示语写成了首参' }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE);
      assert.match(e.message, /缺少 --focus/);
      assert.match(e.message, /顺手把提示语写成了首参/, '应回显首参，点破这正是旧写法的迁移坑');
      return true;
    },
  );
});

test('命令 A 不要求 --focus：它的焦点本就是可选补充', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: '--topic T 把登录改造为 OIDC' });
  assert.equal(r.prompt_hint, null);
  assert.equal(r.task_goal, '把登录改造为 OIDC');
});
