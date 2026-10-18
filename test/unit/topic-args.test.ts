import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  splitArguments, inferTopic, resolveTopicArgs, findSwallowedFlags, findLiteralQuoteWrapped,
} from '../../src/trivium/topic-args.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';
import { ALL_AGENT_IDS, DEFAULT_DRIVER } from '../../src/trivium/agents/registry.js';
import { selectableCritics } from '../../src/trivium/critics.js';
import { SELECTABLE, assertSelectableUsable } from '../helpers/critic-fixtures.js';
import { scratchDir } from '../helpers/scratch.js';

/*
 * ── 入参是 argv 数组，不是字符串（EV-18）──
 *
 * 每个元素就是 shell 交付的一个 token。**本文件刻意不写「按空白切字符串」的 helper**：
 * 那等于把刚删掉的分词器搬进测试——用例看起来在测新契约，实际又在测旧的。
 * 带空格的正文写成一个元素，就像用户在 shell 里用单引号包住它一样。
 */

async function fakeCtx(): Promise<Ctx> {
  const root = await scratchDir('trivium-args-');
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
  const r = splitArguments(['重点看并发与回滚', '--topic', '登录重构', '--context', 'src,doc']);
  assert.equal(r.named['topic'], '登录重构');
  assert.equal(r.named['context'], 'src,doc');
  assert.equal(r.rest, '重点看并发与回滚');
});

test('支持 --k=v 形式', () => {
  const r = splitArguments(['--topic=登录重构', '--model-glm=GLM-5.3', '看并发']);
  assert.equal(r.named['topic'], '登录重构');
  assert.equal(r.named['model-glm'], 'GLM-5.3');
  assert.equal(r.rest, '看并发');
});

test('单个 argv token 内的空格原样保留（shell 引号已经把它包成一个参数）', () => {
  const r = splitArguments(['--topic', '登录 重构', '--focus', '重点看 A 与 B']);
  assert.equal(r.named['topic'], '登录 重构');
  assert.equal(r.named['focus'], '重点看 A 与 B');
});

test('提示语正文里出现 -- 不会被误当参数（关键用例）', () => {
  const r = splitArguments(['注意', '--dangerously-skip-permissions', '这个参数绝不能用', '--topic', 'X']);
  assert.equal(r.named['topic'], 'X');
  assert.match(r.rest, /--dangerously-skip-permissions/);
  assert.equal(r.named['dangerously-skip-permissions' as 'topic'], undefined);
});

test('参数名后紧跟另一个已知参数时，值为空而不吞掉下一个', () => {
  const r = splitArguments(['--topic', '--focus', '看并发']);
  assert.equal(r.named['topic'], '');
  assert.equal(r.named['focus'], '看并发');
});

test('中文提示语与中文主题都正常', () => {
  const r = splitArguments(['--topic', '登录重构', '重点审查并发安全与回滚路径']);
  assert.equal(r.named['topic'], '登录重构');
  assert.equal(r.rest, '重点审查并发安全与回滚路径');
});

test('主题推导：去标点、连字符化、截断', () => {
  assert.equal(inferTopic('把登录改造为 OIDC，并补充回滚', 64), '把登录改造为-OIDC-并补充回滚');
  assert.equal(inferTopic('', 64), '未命名主题');
  assert.ok(inferTopic('x'.repeat(100), 64).length <= 32);
});

/*
 * ── EV-18 的实撞形态：正文含裸引号 ──
 *
 * 2026-09-15 的焦点含 `~[^/\s"'` + 反引号 + `]+` 这个字符类。旧分词器遇到 `"` 进入引号态、
 * 此后所有空白失效，`--topic X` 被粘进同一 token 落进正文，主题回落推断，
 * 报的却是推断结果「不得包含路径分隔符」。现在 token 由 shell 切好，引号只是字符。
 */
const CHAR_CLASS_FOCUS = '焦点含 ~[^/\\s"\'`]+ 这个字符类，重点看它会不会打乱边界';

test('EV-18：正文含裸双引号与单引号时，--topic 仍被识别，正文逐字保留', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: [CHAR_CLASS_FOCUS, '--topic', '安全主题'] });
  assert.equal(r.topic, '安全主题');
  assert.equal(r.topic_inferred, false, '主题是显式给的，不得回落推断');
  assert.equal(r.task_goal, CHAR_CLASS_FOCUS, 'FR-20：正文逐字，引号一个不丢');
});

test('EV-18：--focus 的值含裸引号同样逐字进 prompt_hint', () => {
  const r = splitArguments(['--topic', 'T', '--focus', CHAR_CLASS_FOCUS]);
  assert.equal(r.named['focus'], CHAR_CLASS_FOCUS);
  assert.equal(r.named['topic'], 'T');
});

// ── 响亮失败：给了 --topic 却被包进了同一个参数 ──

test('EV-18：--topic 被包进正文参数且未显式给主题 → 退 64，不回落推断', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['重点看 X --topic 主题甲'] }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE);
      assert.match(e.message, /--topic 字样/);
      assert.match(e.message, /引号之外/, '要告诉用户正确写法');
      return true;
    },
  );
});

test('GLM-03：--topic 被包进 --focus 的值里也要退 64（贪婪旗标的值同样是「同一个 shell 参数」）', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['--focus', '重点核实 --topic 透传是否准确'] }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE);
      assert.match(e.message, /focus/, '要说出字样落在哪个字段里');
      return true;
    },
  );
});

test('显式给了 --topic 时，正文里谈论 --topic 是合法的，逐字保留且不报错', async () => {
  const ctx = await fakeCtx();
  const focus = '重点核实 --topic 透传是否准确';
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['--topic', 'T', '--focus', focus] });
  assert.equal(r.topic, 'T');
  assert.equal(r.prompt_hint, focus);
  assert.ok(!r.notes.some((n) => n.includes('--topic 字样')), '显式给了就不该再提醒');
});

test('CODEX-09：其余已知旗标被包进正文时进 notes，不退 64', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['--topic', 'T', '看 --base 与 --critics 的透传'] });
  assert.equal(r.task_goal, '看 --base 与 --critics 的透传', '正文逐字');
  assert.ok(r.notes.some((n) => n.includes('--base 字样')), JSON.stringify(r.notes));
  assert.ok(r.notes.some((n) => n.includes('--critics 字样')), JSON.stringify(r.notes));
});

test('GLM-04：旗标字样与中文黏连时同样检得出（承诺写的是「字样」，不是「空白界定的字样」）', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['重点看--topic 主题甲 的解析'] }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE);
      assert.match(e.message, /--topic 字样/);
      return true;
    },
  );
  // 更长的旗标名不得被误伤：`--topic-x` 不是 `--topic`
  const ok = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['谈论 --topic-x 这个不存在的旗标', '--topic', 'T'] });
  assert.equal(ok.topic, 'T');
  assert.ok(!ok.notes.some((n) => n.includes('--topic 字样')), '--topic-x 不该被当成 --topic');
});

test('findSwallowedFlags：论域是 rest 与两个贪婪旗标的值，已显式给的不算', () => {
  // 正文放在贪婪旗标之前：`--goal` 会贪婪吃到下一个已知旗标为止，放后面就成了它的值
  const b = splitArguments(['正文提 --critics', '--topic', 'T', '--focus', '看 --base', '--goal', '让 --profile 生效']);
  const hits = findSwallowedFlags(b).map((s) => `${s.flag}@${s.where}`).sort();
  assert.deepEqual(hits, ['base@focus', 'critics@rest', 'profile@goal']);
  assert.equal(b.named['goal'], '让 --profile 生效', '前提：正文没被 --goal 贪婪吃掉');
  assert.ok(!hits.some((h) => h.startsWith('topic@')), 'topic 已显式给出');
});

// ── 旧写法指纹：首尾成对字面引号（CODEX-08）──

test('CODEX-08：token 首尾带成对字面引号时给 note，不退 64、不剥引号', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['"让 --base 真正进入冻结"', '--topic', 'T'] });
  assert.equal(r.task_goal, '"让 --base 真正进入冻结"', '新解析器不剥引号：逐字');
  assert.ok(r.notes.some((n) => n.includes('字面引号')), JSON.stringify(r.notes));
  assert.deepEqual(findLiteralQuoteWrapped(splitArguments(["'x'", 'y', '"z"'])), ["'x'", '"z"']);
  assert.deepEqual(findLiteralQuoteWrapped(splitArguments(['"', 'a"b', '"a\''])), []);
});

// ── 按 stage 的输出契约（AGY-04）──

test('plan 阶段：定位到原稿', async () => {
  const ctx = await fakeCtx();
  const dir = path.join(ctx.archiveRoot, '登录重构/plan');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '2026-09-10-登录重构-claude.md'), '# 计划\n');

  const r = await resolveTopicArgs({
    ctx, scope: 'plan', rawArgs: ['--topic', '登录重构', '--focus', '重点看并发'],
  });
  assert.equal(r.topic, '登录重构');
  assert.equal(r.prompt_hint, '重点看并发');
  assert.ok(r.subject_path?.endsWith('2026-09-10-登录重构-claude.md'));
  assert.equal(r.topic_inferred, false);
});

test('plan 阶段：找不到原稿退 65 并列出目录现状', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'plan', rawArgs: ['--topic', '不存在', '--focus', 'x'] }),
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
    ctx, scope: 'all', rawArgs: ['--topic', '新功能', '把登录改造为 OIDC'],
  });
  assert.equal(r.subject_path, null);
  assert.ok(r.notes.some((n) => n.includes('S1')));
});

test('code 阶段：subject_path 为 null，输出 base 与 diff_available', async () => {
  const ctx = await fakeCtx();
  // 造一个未提交的改动，让 diff 非空
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['--topic', '登录重构', '--focus', '看安全'] });
  assert.equal(r.subject_path, null);
  assert.equal(r.base, 'HEAD');
  assert.equal(r.diff_available, true);
});

test('code 阶段：无变更时退 65', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['--topic', 't', '--focus', '看安全'] }),
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
  await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['--topic', '全新主题', '做点什么'] });
  const after = await fs.readdir(ctx.projectRoot);
  assert.deepEqual(after.sort(), before.sort(), 'topic resolve 必须是纯只读');
  await assert.rejects(fs.access(ctx.archiveRoot), '不得创建归档根');
});

test('非法主题名退 64 并给出修正建议', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['--topic', '登录重构-r2', 'x'] }),
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
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['把登录改造为 OIDC'] });
  assert.equal(r.topic_inferred, true);
  assert.ok(r.topic.length > 0);
  assert.ok(r.notes.some((n) => n.includes('请向用户回显确认')));
});

test('--focus 与 prompt_hint 的对应统一（AGY-04）', async () => {
  const ctx = await fakeCtx();
  const a = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['--topic', 'T', '--focus', '看并发'] });
  assert.equal(a.prompt_hint, '看并发');
});

/*
 * ── 位置参数按命令语义定，旗标只做覆盖 ──
 *
 *   命令 A：正文 = 任务目标，`--focus` 可选
 *   B/C/D：正文 = 审查焦点（PRD 第 8 章「命令后面带的提示语」），`--goal` 可选
 *
 * 用户在 B/C/D 里最常打的就是焦点，几乎不会打目标——目标能从归档回退取回。
 * 显式旗标永远优先于正文。
 */

/*
 * ── 命令 A 接受选侧旗标（EV-125）──
 *
 * 此前这里钉的是「命令 A 明确拒绝 `--critics` / `--only`」（审查意见 GLM-02）：旗标会被解析成功、
 * 然后被 S2/S6 的交接静默丢弃，于是改为当场退 64。EV-125 定了「两轮共用同一组」的语义，
 * 契约在 S0.5 / S0.6 / S2 / S6 显式透传 `critics` 与 `allow_single`，拒绝随之撤销。
 *
 * 放开的是**旗标**，不是**判定**：入选仍走 `resolveCriticSelection` 那一处，
 * 含当轮 Driver、重复、未启用照旧退 64（下面第三条钉住）。
 */
test('命令 A 接受 --critics：入选即所写', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['把登录改造为 OIDC', '--critics', 'glm'] });
  assert.deepEqual(r.critics, ['glm']);
  assert.equal(r.only, null);
});

test('命令 A 接受 --only：并入 critics，输出的 only 恒为 null（与 B/C/D 同一处理）', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['把登录改造为 OIDC', '--only', 'glm'] });
  assert.deepEqual(r.critics, ['glm']);
  assert.equal(r.only, null, '两个字段都非空时，契约照抄会同时拼出 --critics 与 --only 而撞上互斥');
});

test('命令 A 的 --critics 含当轮 Driver ⇒ 退 64：放开的是旗标，不是判定', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({
      ctx, scope: 'all', rawArgs: ['把登录改造为 OIDC', '--driver', DEFAULT_DRIVER, '--critics', DEFAULT_DRIVER],
    }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE, e.message);
      assert.doesNotMatch(e.message, /命令 A（全流程）不接受/, '撞上的应当是选侧判定，不是已撤销的旗标拒绝');
      return true;
    },
  );
});

test('命令 A 的 --allow-single ⇒ allow_single 为 true（契约据此在 S2 / S6 透传）', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['把登录改造为 OIDC', '--allow-single'] });
  assert.equal(r.allow_single, true);
  assert.equal(r.task_goal, '把登录改造为 OIDC', '布尔旗标不得吞掉后面的正文');
});

test('命令 A：非缺省 Driver 下用 --critics 把原 Driver 加进来，并给它指定模型 ⇒ 通过（EV-125 缺口 1）', async () => {
  assertSelectableUsable();
  const other = SELECTABLE[0]!;
  const ctx = await fakeCtx();
  // 前提：原 Driver 能入选、却不在缺省集合里——EV-125 之前命令 A 对它没有任何入选出口
  assert.ok(selectableCritics(ctx.config, other).includes(DEFAULT_DRIVER), `前提：${DEFAULT_DRIVER} 能当审核者`);
  assert.ok(!ctx.config.review.default_critics.includes(DEFAULT_DRIVER), `前提：${DEFAULT_DRIVER} 不在缺省集合里`);
  const r = await resolveTopicArgs({
    ctx, scope: 'all',
    rawArgs: ['做个功能', '--driver', other, '--critics', DEFAULT_DRIVER, `--model-${DEFAULT_DRIVER}`, 'm-9'],
  });
  assert.equal(r.driver, other);
  assert.deepEqual(r.critics, [DEFAULT_DRIVER]);
  assert.equal(r.models[DEFAULT_DRIVER], 'm-9');
});

test('B/C/D 不受影响：同样的旗标在这里照常生效', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 9;\n');
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['看并发', '--topic', 'T', '--critics', 'glm'] });
  assert.deepEqual(r.critics, ['glm']);
});

test('命令 A：正文是任务目标，--focus 是可选补充', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: ['--topic', 'T', '把登录改造为 OIDC', '--focus', '重点看会话固定'],
  });
  assert.equal(r.task_goal, '把登录改造为 OIDC');
  assert.equal(r.prompt_hint, '重点看会话固定');
  assert.notEqual(r.task_goal, r.prompt_hint, '两者同源会让 BRIEF 第 2 段与第 4 段雷同');
});

test('B/C/D：正文就是审查焦点，用户不必区分目标与焦点', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['--topic', 'T', '重点看并发安全与回滚路径'] });
  assert.equal(r.prompt_hint, '重点看并发安全与回滚路径');
  assert.equal(r.task_goal, null, '目标缺省，交给编排器回退 task.json / 本主题计划定稿');
});

test('B/C/D：显式 --goal 是已知旗标且贪婪取值，不会被吞进焦点', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({
    ctx, scope: 'code', rawArgs: ['--topic', 'T', '重点看并发', '--goal', '把登录改造为', 'OIDC', '并补回滚'],
  });
  assert.equal(r.prompt_hint, '重点看并发');
  assert.equal(r.task_goal, '把登录改造为 OIDC 并补回滚');
});

test('B/C/D：兼容显式写法 <任务目标> --focus <焦点>——给了 --focus，正文落到目标', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({
    ctx, scope: 'code', rawArgs: ['--topic', 'T', '把登录改造为 OIDC', '--focus', '重点看会话固定'],
  });
  assert.equal(r.task_goal, '把登录改造为 OIDC');
  assert.equal(r.prompt_hint, '重点看会话固定');
});

test('B/C/D：主题缺省时从焦点推导，note 说明来源', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['重点看并发安全'] });
  assert.equal(r.topic_inferred, true);
  assert.ok(r.notes.some((n) => n.includes('由审查焦点推导')), JSON.stringify(r.notes));
});

test('焦点里出现白名单旗标字样不再被静默吞掉', async () => {
  const ctx = await fakeCtx();
  // base 字段只在 code 阶段计算，所以造一个未提交改动走真实路径
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const focus = '核实 --base 透传说明是否准确';
  const r = await resolveTopicArgs({
    ctx, scope: 'code', rawArgs: ['--topic', 'T', '--focus', focus, '--base', 'HEAD'],
  });
  assert.equal(r.prompt_hint, focus, '焦点被 --base 截断——FR-20 的逐字承诺落空');
  assert.equal(r.base, 'HEAD', '焦点里的 --base 字样不该影响真正的 --base');
});

/*
 * ── 边界契约：贪婪取值解决的是「空格」，不是「旗标字样」──
 *
 * 焦点里出现 `--base` 这类**已知旗标名**、且它在 argv 里**裸露**（是独立的一个 token）时，
 * 贪婪循环仍会在那里停住。这是命令行固有的语义，不是缺陷：一个独立的 `--base` token
 * 无法区分「用户在谈论 --base」和「用户在传 --base」。
 *
 * 固定成用例是为了别让后人把它当 bug「修」掉——真正的防线是 SKILL.md 要求执行者
 * 把整段正文放进**一个** shell 参数（单引号包住），以及下游校验（坏 base / 坏档位
 * / 非法 slug 都退 64）兜住大部分误吞。EV-18 之后引号不再由本模块处理：
 * 它们在 shell 那一层就把正文包成了一个 token。
 */
test('主题被推成单字时给出「疑似被旗标截断」的提示', async () => {
  const ctx = await fakeCtx();
  // 「让 --base 真正进入冻结」没包成一个参数：--base 吞掉「真正进入冻结」，正文只剩「让」
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: ['让', '--base', '真正进入冻结', '--focus', '看看还有没有同类缺口'],
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
    ctx, scope: 'all', rawArgs: ['把登录改造为 OIDC', '--focus', '看会话固定'],
  });
  assert.ok(!r.notes.some((n) => n.includes('异常短')), '不该对正常主题误报');
});

test('argv 里裸露的已知旗标就是真旗标——这是预期行为，靠 shell 引号把正文包成一个参数', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: ['--topic', 'T', '目标', '--focus', '核实', '--base', '透传是否准确'],
  });
  assert.equal(r.prompt_hint, '核实', '没有引号包裹时，--base 就是真旗标');
  assert.equal(
    r.task_goal, '目标',
    '「透传是否准确」既没进焦点也没回到正文——它成了 --base 的值，' +
      '也正因如此，这类误吞在 code 阶段会被坏 base 的校验挡下来',
  );
});

test('--focus 贪婪取到下一个已知旗标为止，多个 token 用空格相连', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: ['--topic', 'T', '--focus', '重点看', '并发', '与', '会话安全', '--model-glm', 'GLM-5.3'],
  });
  assert.equal(r.prompt_hint, '重点看 并发 与 会话安全');
  assert.equal(r.models.glm, 'GLM-5.3');
});

test('B/C/D 什么都没写（无正文、无 --focus）才退 64（FR-20）', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  for (const raw of [['--topic', 'T'], ['--topic', 'T', '--goal', '只给了目标']]) {
    await assert.rejects(
      resolveTopicArgs({ ctx, scope: 'code', rawArgs: raw }),
      (e: { code?: number; message: string }) => {
        assert.equal(e.code, EXIT.USAGE);
        assert.match(e.message, /缺少审查焦点/);
        assert.match(e.message, /dual-review-<plan\|code\|bug> <本次重点看什么>/, '报错要直接给出最自然的写法');
        return true;
      },
    );
  }
});

test('命令 A 不要求 --focus：它的焦点本就是可选补充', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['--topic', 'T', '把登录改造为 OIDC'] });
  assert.equal(r.prompt_hint, null);
  assert.equal(r.task_goal, '把登录改造为 OIDC');
});

// ── AGY-04：only / allow-single / session-id 曾不在白名单里 ──

test('AGY-04：三个旗标被识别，不再被当成正文吞进审查焦点', () => {
  const r = splitArguments(['重点看并发', '--only', 'glm', '--allow-single', '--session-id', 'S-1', '--topic', 'T']);
  assert.equal(r.rest, '重点看并发', '旗标不得残留在正文里');
  assert.equal(r.named['only'], 'glm');
  assert.equal(r.named['session-id'], 'S-1');
  assert.ok(r.booleans.has('allow-single'));
});

test('AGY-04：--allow-single 是布尔旗标，绝不能吃掉后面的正文', () => {
  /*
   * 若让它走「取下一个 token 当值」的默认路径，补白名单反倒制造出一个
   * 新的静默截断——焦点会变成空，而用户看不到任何报错。
   */
  const r = splitArguments(['--allow-single', '重点看并发安全']);
  assert.ok(r.booleans.has('allow-single'));
  assert.equal(r.rest, '重点看并发安全');

  // 贪婪旗标也要在它面前停下
  const g = splitArguments(['--focus', '重点看并发', '--allow-single', '--topic', 'T']);
  assert.equal(g.named['focus'], '重点看并发');
  assert.ok(g.booleans.has('allow-single'));
  assert.equal(g.named['topic'], 'T');

  // 显式否定
  assert.ok(!splitArguments(['--allow-single=false', 'x']).booleans.has('allow-single'));
});

test('AGY-04：resolveTopicArgs 把三者输出，不静默丢弃', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 3;\n');
  const r = await resolveTopicArgs({
    ctx, scope: 'code',
    rawArgs: ['重点看并发', '--topic', 'T', '--only', 'gemini', '--allow-single', '--session-id', 'S-9'],
  });
  assert.equal(r.prompt_hint, '重点看并发');
  assert.equal(r.allow_single, true);
  assert.equal(r.session_id, 'S-9');
  /*
   * `--only` 的意图落在 `critics` 里，而不是回显到 `only` 字段（M7b 第 5 步）。
   * 本用例的意图是「这三个旗标都不被静默丢弃」——`--only` 的**意图没丢**，
   * 只是换了承载字段。断言随之锚到意图上：输出里要能看出用户选了 gemini 一侧。
   */
  assert.deepEqual(r.critics, ['gemini'], '--only 的意图必须体现在入选集合里');
  assert.equal(
    r.only, null,
    '输出的 only 要置 null：留着它，下游照抄就会同时拼出两个旗标而退 64',
  );
});

test('AGY-04：--only 取值当场校验，拼错不必等到 review --start', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['重点看并发', '--topic', 'T', '--only', 'gemmini'] }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE);
      /*
       * 断言锚在**意图**上：拼错要当场退 64，且错误里要列出合法值。
       * M7b 第 5 步把校验收敛进 `resolveCriticSelection` 后措辞变了
       * （从「只接受 X | Y」变成「含未登记的 Agent…可用：X | Y」），
       * 原先逐字匹配措辞的断言会为一次纯文案调整变红——那是脆断言。
       */
      assert.match(e.message, /gemmini/, '要点名拼错的那个值');
      /*
       * **锚在 `SELECTABLE` 而不是 `CRITICS`**（M9 第 4 步）。
       *
       * 这条路径走 `resolveCriticSelection`，其报错文案由 `legalList` 拼，
       * 而 `legalList` **排除当轮 Driver**（「第一个错误不得把用户引向第二个错误」）。
       * 翻开关后 `CRITICS` 含 claude 而文案里没有它——用 `CRITICS` 遍历会红，
       * 且红得莫名其妙：断言要的正是那条文案**不该**列出的值。
       *
       * 注意与本文件下方「给非审核者指定模型」那条的区别：那条的文案由
       * `topic-args.ts` 自己用 `CRITICS.join('、')` 拼、**不经 `legalList`**，
       * 所以它遍历 `CRITICS` 是对的，不要跟着一起改。
       */
      for (const c of SELECTABLE) {
        assert.match(e.message, new RegExp(c), `要列出合法值 ${c}，否则用户不知道该写什么`);
      }
      return true;
    },
  );
});

/*
 * ── `--model-<id>` 的白名单按注册表派生（M7b 第 6 步）──
 *
 * 此前 `NAMED_FLAGS` 里写死 `model-gemini` / `model-glm` 两条，而取值的循环
 * 早在第 2 步就改成了按集合拼名。两者之间的缝隙与本文件头部登记的那一族同形：
 * 第三家的 `--model-<id>` 不在白名单里 → 不报错、不退非零 → 整段被当成正文
 * 压进 `restParts`。症状是模型覆盖静默丢失，外加焦点正文里多出一截旗标字样。
 */
test('模型覆盖旗标的白名单按注册表派生，不是写死两条', () => {
  for (const id of ALL_AGENT_IDS) {
    const r = splitArguments(['看并发', `--model-${id}`, 'm-1', '--topic', 'T']);
    assert.equal(
      r.named[`model-${id}` as 'model-gemini'], 'm-1',
      `--model-${id} 必须被识别为旗标——漏一家就意味着那家的模型覆盖会被静默吞进正文`,
    );
    assert.equal(r.rest, '看并发', `--model-${id} 不得残留在焦点正文里`);
  }
});

/*
 * **M9 第 5 步：本分支重新可达了**（EV-53 收口）。
 *
 * 判据从「已登记 − **启用集合**」改成「已登记 − **本轮实际能入选谁**」。
 * 前者在四家全启用后是空集（M9 第 4 步起本条一直 skip）；后者永远至少含
 * 当轮 Driver ——它已登记、也已启用为审核者，但「自己不能审自己」让它
 * 在本轮**当不了审核者**，给它指定模型就是那条要防的「解析成功、随后被丢弃」。
 *
 * 这也是 EV-53 真正的修法：`topic-args.ts` 的白名单此前直读模块级 `CRITICS`，
 * 与 `critics.ts` 的 `legalList`（减 Driver）是两套派生。第 5 步把 driver 接进
 * 选侧之后，同一条命令里两段「当前可用」会互相矛盾——所以两处现在共用
 * `selectableCritics` 这一个派生。
 */
const MODEL_FLAG_PENDING = ALL_AGENT_IDS.filter(
  (id) => !(selectableCritics(defaultConfig()) as readonly string[]).includes(id),
);
test(
  '给非审核者指定模型 → 退 64 并列出当前可用，而不是解析成功后被悄悄丢弃',
  {
    skip: MODEL_FLAG_PENDING.length === 0
      ? '「已登记」与「本轮可入选」之差为空集，本分支不可达'
      : false,
  },
  async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 4;\n');
  /*
   * 白名单的论域是「全部已登记 Agent」，取值的论域是「**本轮实际能入选谁**」。
   * 两者之差必须当场报错：放任它走到「解析成功、随后被丢弃」，
   * 留痕里就看不出用户指定过模型——这正是 `--base` 漏传那一族的形状。
   */
  const driverSide = MODEL_FLAG_PENDING[0]!;
  const legal = selectableCritics(defaultConfig());

  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: ['看并发', '--topic', 'T', `--model-${driverSide}`, 'm-9'] }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE, '参数错误一律退 64');
      assert.match(e.message, new RegExp(`model-${driverSide}`), '报错要点名是哪个旗标');
      for (const c of legal) {
        assert.match(e.message, new RegExp(c), '要列出本轮可用的审核者，别让用户再猜一次');
      }
      /*
       * **报错里不得出现被拒的那一家**（EV-53 ③）。
       *
       * 此前文案读 `CRITICS.join('、')`（含当轮 Driver），而判据读减 Driver 的那份：
       * 用户照着「当前可用」里列出的 claude 去写 `--critics claude`，
       * 会一头撞进「当轮 Driver 不得入选」——**第一个错误把用户引向第二个错误**。
       */
      /*
       * 锚点命中先断言（第 2 轮 GLM-03）：`indexOf` 不中时返回 −1，
       * `slice(-1)` 只剩一个字符，下面那条 `doesNotMatch` 会静默恒过。
       * 这不是假想——本步改判据时这处文案就从「当前可用」变过一次，
       * 现在两层统一回 `legalList`（见 critics.ts 的 assertModelOverrideKeys）。
       */
      const at = e.message.indexOf('当前可用');
      assert.ok(at >= 0, `报错里没有「当前可用」这个锚点，下面那条负例会静默恒过：${e.message}`);
      const tail = e.message.slice(at);
      assert.doesNotMatch(
        tail, new RegExp(driverSide),
        `「当前可用」里仍列着 ${driverSide}，而它正是刚被拒的那一个：${tail}`,
      );
      return true;
    },
  );
  },
);

/*
 * ───────── CODEX-07 的只读那一半（M9 第 5 步，T-5a）─────────
 *
 * `topic-args.ts` 的 `locateSubjectReadOnly` 与 `topic.ts` 的 `locateSubject`
 * 判据逐项同形，**必须同改**。两处各有用例：只改一处时另一处会静默漏判。
 * `topic.test.ts` 那组覆盖的是真实审查路径，这一组覆盖的是 `topic resolve`。
 */
test('topic resolve：顶着 Driver 后缀的审查件不得被当原稿（与 locateSubject 同形）', async () => {
  const ctx = await fakeCtx();
  const dir = path.join(ctx.archiveRoot, 'T', 'plan');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '2026-09-10-T-claude.md'), '# 我才是原稿\n');
  await fs.writeFile(
    path.join(dir, '2026-09-12-T-claude.md'),
    '---\nschema: trivium.review.v1\nrole: claude\n---\n\n# 计划审查\n',
  );
  const r = await resolveTopicArgs({ ctx, scope: 'plan', rawArgs: ['看并发', '--topic', 'T'] });
  assert.equal(
    path.basename(r.subject_path!), '2026-09-10-T-claude.md',
    '日期更晚的那份是审查件，应被剔除——只改了 topic.ts 一处时本条会红',
  );
});

test('topic resolve：显式指定审查件 → 退 65 并说明是审查件', async () => {
  const ctx = await fakeCtx();
  const dir = path.join(ctx.archiveRoot, 'T', 'plan');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '2026-09-10-T-claude.md'), '# 原稿\n');
  const bad = path.join(dir, '2026-09-12-T-gemini.md');
  await fs.writeFile(bad, '---\nschema: trivium.review.v1\n---\n\n# 计划审查\n');
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'plan', rawArgs: ['看并发', '--topic', 'T', '--plan-file', bad] }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.MISSING_ARTIFACT);
      assert.match(e.message, /审查件/);
      return true;
    },
  );
});

test('topic resolve：--driver 非缺省时回显；M10a 第 3 步起已启用，不再有「未启用」标注', async () => {
  assertSelectableUsable();
  const other = SELECTABLE[0]!;
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 7;\n');
  const r = await resolveTopicArgs({
    ctx, scope: 'code',
    rawArgs: ['看并发', '--topic', 'T', '--driver', other, '--critics', DEFAULT_DRIVER],
  });
  assert.equal(r.driver, other);
  /*
   * M9 时这里是「放行 + 标注」：`driver_enabled` 为 false、notes 里有一条「尚未启用为 Driver」。
   * M10a 第 3 步翻开关并把未启用收紧为退 64（桩用例见 critics.test.ts），走到这里的恒为 true，
   * 那条标注随分支一并删除——还留着就说明删漏了。
   */
  assert.equal(r.driver_enabled, true, `${other} 已于 M10a 第 3 步启用为 Driver`);
  assert.ok(
    !r.notes.some((n) => n.includes('尚未启用为 Driver')),
    `notes 里还有「尚未启用为 Driver」的标注：那条分支应当随收紧一并删除：${JSON.stringify(r.notes)}`,
  );
});

/*
 * M9 第 5 步到 M10b 第 2 步之间，这里钉的是「命令 A 不接受 --driver（接受即静默丢弃）」。
 * M10b 第 2 步把 `--driver` 渲染进命令 A 的六处交接（计划 r5 §5.3），前提消失，拒绝随之改为接受；
 * 两阶段交叉校验的冲突用例走真实子进程，见 `test/integration/driver-flag.test.ts`。
 */
test('topic resolve：命令 A 接受 --driver 并回显（M10b 第 2 步放开）', async () => {
  assertSelectableUsable();
  const other = SELECTABLE[0]!;
  const ctx = await fakeCtx();
  /*
   * **缺省配置、不改 default_critics**：`other` 本身就在缺省审核者集合里。
   * 命令 A 当时不收 `--critics`（EV-125 起才收），此前这一格退 64、没有出口（M10b 第 2 步核出）；
   * 用户拍板后选侧对**缺省**集合减去当轮 Driver（`critics.ts`），这里钉住放开之后的真实路径。
   */
  assert.ok(ctx.config.review.default_critics.includes(other), '前提：当轮 Driver 在缺省集合里');
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做个功能', '--driver', other] });
  assert.equal(r.driver, other);
  assert.equal(r.driver_enabled, true);
  assert.deepEqual(r.critics, ctx.config.review.default_critics.filter((c) => c !== other));
});

test('EV-53：换掉 Driver 之后，原 Driver 那一家的模型覆盖就合法了', async () => {
  /*
   * 上一条的**正例**，钉的是「新判据是逐次运行的事实，不是又一个写死清单」。
   *
   * 第 5 步之前 `--model-claude` 恒合法（判据读启用集合），之后恒非法（判据减 Driver）——
   * 两种写死都不对。正确行为是：**跟着当轮 Driver 变**。
   * 把 Driver 换成别家，claude 就是个普通审核者，给它指定模型天经地义。
   *
   * 缺了这一条，把拒绝分支写得过宽（比如「非缺省 Driver 的都拒」）也能让上一条全绿。
   */
  assertSelectableUsable();
  const otherDriver = SELECTABLE[0]!;
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 6;\n');
  /*
   * 要显式给 `--critics`：配置的 `review.default_critics` 里含 `otherDriver`，
   * 不给的话会先撞上「默认集合含当轮 Driver」而退 64，验不到本条要验的东西。
   * （M10b 第 2 步起缺省集合会先减去当轮 Driver，上一句的退 64 已不再发生；
   * 显式 `--critics` 仍然要给——本条要验的是 `--model-<DEFAULT_DRIVER>` 在 claude 入选时合法，
   * 而缺省集合里没有 claude。）
   * 这里选 `DEFAULT_DRIVER` 当审核者，正好就是 M9 第 6 步验收的真实形态。
   */
  const r = await resolveTopicArgs({
    ctx, scope: 'code',
    rawArgs: [
      '看并发', '--topic', 'T', '--driver', otherDriver,
      '--critics', DEFAULT_DRIVER, `--model-${DEFAULT_DRIVER}`, 'm-1',
    ],
  });
  assert.equal(r.models[DEFAULT_DRIVER], 'm-1', `${DEFAULT_DRIVER} 不当 Driver 时，给它指定模型应当放行`);
  assert.equal(r.driver, otherDriver, '解析结果要回显本轮采信的 Driver');
  assert.deepEqual(r.critics, [DEFAULT_DRIVER], `换掉 Driver 之后 ${DEFAULT_DRIVER} 就是个普通审核者`);
});

test('可用审核者的模型覆盖照常生效（上一条不得误伤正常路径）', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 5;\n');
  /*
   * **采样取 `SELECTABLE[0]`，不是 `CRITICS[0]`**（代码双审 AGY-03 ≡ CODEX-09）。
   *
   * 两件事要分开：
   *   · 白名单的**论域**确实是「可用审核者」全集（含当轮 Driver），这一点没变；
   *   · 但本条用例的名字是「**正常路径**不得被误伤」，而 `CRITICS[0]` 是 claude——
   *     M9 之后**唯一永不能入选**的一家（`critics.ts` 的 Driver 检查恒拒）。
   *
   * 拿它当「正常路径」，验的其实是一次**解析成功后必然被丢弃**的覆盖（BACKLOG EV-53
   * 登记的正是这个缺口），而对「拒绝分支写得过宽、把所有非入选者一起拒掉」这种误伤
   * 没有任何分辨力——那恰恰是第 5 步按「本轮实际能入选谁」收口白名单时最可能引入的形态。
   *
   * （上一版这里写着「取 `CRITICS[0]` 是对的，不要跟着 SELECTABLE 一起改」，
   * 与 `critic-fixtures.ts` 里「凡是需要一个合法审核者的地方一律取这里」**直接冲突**，
   * 同一个仓库给出两条相反的指引。以本条为准：论域看 `CRITICS`，采样取 `SELECTABLE`。）
   */
  const side = SELECTABLE[0]!;
  const r = await resolveTopicArgs({
    ctx, scope: 'code', rawArgs: ['看并发', '--topic', 'T', `--model-${side}`, 'm-7'],
  });
  assert.equal(r.models[side], 'm-7');
});

/*
 * ───────── 能入选、但本轮没入选（M10b 第 2 步代码双审 CODEX-02，收 EV-67）─────────
 *
 * 判据从「本轮能入选谁」收紧到「本轮实际入选了谁」。两格：显式 `--critics` 排除掉的那一家，
 * 与命令 A 缺省路径上不在缺省集合里的那一家（非 claude Driver 时的 `--model-claude`）——
 * 后者正是三家入口资产曾经列在参数写法里的写法。上面那条「照常生效」是这两格的正例对照。
 */
test('--critics 排除掉的那一家，为它指定模型退 64，而不是静默丢弃', async () => {
  assertSelectableUsable(2);
  const [kept, dropped] = [SELECTABLE[0]!, SELECTABLE[1]!];
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 8;\n');
  await assert.rejects(
    resolveTopicArgs({
      ctx, scope: 'code',
      rawArgs: ['看并发', '--topic', 'T', '--critics', kept, `--model-${dropped}`, 'm-8'],
    }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE, e.message);
      assert.match(e.message, new RegExp(`--model-${dropped}：${dropped} 本轮没有入选`));
      assert.match(e.message, new RegExp(`本轮入选：${kept}$`, 'm'), '要列出本轮实际入选的那几家');
      assert.match(e.message, /--critics/, '要指出把它加进来的出口');
      return true;
    },
  );
});

test('命令 A 缺省路径：换了 Driver 后缺省集合外的那一家（原 Driver）指定模型退 64', async () => {
  assertSelectableUsable();
  const other = SELECTABLE[0]!;
  const ctx = await fakeCtx();
  // 前提：原 Driver 此时**能**入选（否则撞的是另一条「不是可用审核者」的报错，验不到本条）、却不在缺省集合里
  assert.ok(selectableCritics(ctx.config, other).includes(DEFAULT_DRIVER), `前提：${DEFAULT_DRIVER} 能当审核者`);
  assert.ok(!ctx.config.review.default_critics.includes(DEFAULT_DRIVER), `前提：${DEFAULT_DRIVER} 不在缺省集合里`);
  await assert.rejects(
    resolveTopicArgs({
      ctx, scope: 'all', rawArgs: ['做个功能', '--driver', other, `--model-${DEFAULT_DRIVER}`, 'm-9'],
    }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE, e.message);
      assert.match(e.message, /本轮没有入选/);
      /*
       * 报错给的出口是「用 --critics 把它列进来」。EV-125 之前这句对命令 A 是错的（A 不收 --critics，
       * 照做会撞上旗标拒绝）；放开之后它成立——上一条「把原 Driver 加进来」的正例就是照这个出口走通的。
       */
      assert.match(e.message, /--critics/);
      return true;
    },
  );
});

/*
 * ── EV-228（M12 批次 4）：`--model-〈id〉` 按「键在不在」判写了没写 ──
 *
 * 此前按真假过滤，空串（`=` 空、紧跟另一个已知旗标、位于末尾三种形态都记空串）被当成没写，模型覆盖无声消失。
 * 改后先键判定、再空值退 64，文案与档位旗标同一份（`tier-flags.ts` 的 `assertFlagValuesGiven`）。
 * 「同源」的可判形式：同一入口、同一形态，`--model-` 换成 `--tier-` 后逐字相等。
 */
async function usageMessage(p: Promise<unknown>): Promise<string> {
  let message: string | null = null;
  await assert.rejects(p, (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.USAGE, e.message);
    message = e.message;
    return true;
  });
  return message!;
}

test('EV-228 写了不给值的三种形态 × 两侧都退 64，文案与同形态的档位旗标逐字同源', async () => {
  const ctx = await fakeCtx();
  const forms: [string, (flag: string) => string[]][] = [
    ['= 空', (f) => [`--${f}=`]],
    ['紧跟另一个已知旗标', (f) => [`--${f}`, '--focus', '看']],
    ['位于末尾', (f) => [`--${f}`]],
  ];
  for (const id of ['gemini', 'glm']) {
    for (const [name, build] of forms) {
      const model = await usageMessage(resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做个功能', '--topic', 'T', ...build(`model-${id}`)] }));
      assert.equal(model, `--model-${id} 需要一个值，但没有给出。`, `${id} · ${name}`);
      const tier = await usageMessage(resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做个功能', '--topic', 'T', ...build(`tier-${id}`)] }));
      assert.equal(model.replace('--model-', '--tier-'), tier, `${id} · ${name}：与档位旗标同源`);
    }
  }
});

test('EV-228 正常写法与完全不写：解析结果逐字段不变', async () => {
  const ctx = await fakeCtx();
  const pick = (r: Awaited<ReturnType<typeof resolveTopicArgs>>) => ({
    models: r.models, tiers: r.tiers, efforts: r.efforts, vendor_profiles: r.vendor_profiles,
    critics: r.critics, prompt_hint: r.prompt_hint, task_goal: r.task_goal, topic: r.topic,
  });
  const none = pick(await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做个功能', '--topic', 'T'] }));
  assert.ok(none.critics.length > 0, '前提：缺省集合非空');
  assert.deepEqual(none, {
    models: {}, tiers: {}, efforts: {}, vendor_profiles: {},
    critics: none.critics, prompt_hint: null, task_goal: '做个功能', topic: 'T',
  });
  const normal = pick(await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: ['做个功能', '--topic', 'T', '--model-glm', 'GLM-5.3', '--model-gemini=g-x', '--focus', '看'],
  }));
  assert.deepEqual(normal, {
    models: { gemini: 'g-x', glm: 'GLM-5.3' }, tiers: {}, efforts: {}, vendor_profiles: {},
    critics: none.critics, prompt_hint: '看', task_goal: '做个功能', topic: 'T',
  }, '入选集合与不写时同一组');
});

test('EV-228 先键后值：给 Driver 自己写空值，报的是键判定那条（与档位旗标同序）', async () => {
  const ctx = await fakeCtx();
  const model = await usageMessage(resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做个功能', '--topic', 'T', `--model-${DEFAULT_DRIVER}`] }));
  assert.match(model, new RegExp(`^--model-${DEFAULT_DRIVER}：它是本轮的 Driver`), model);
  assert.ok(!model.includes('需要一个值'), model);
  const tier = await usageMessage(resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做个功能', '--topic', 'T', `--tier-${DEFAULT_DRIVER}`] }));
  assert.match(tier, new RegExp(`^--tier-${DEFAULT_DRIVER}：它是本轮的 Driver`), tier);
});

test('EV-228 紧跟一个未知的 --xxx：照旧当成值（只有已知旗标才截断取值）', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: ['做个功能', '--topic', 'T', '--model-glm', '--not-a-flag'] });
  assert.deepEqual(r.models, { glm: '--not-a-flag' });
});
