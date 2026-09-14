import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { splitArguments, inferTopic, resolveTopicArgs } from '../../src/trivium/topic-args.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { CRITICS, type Ctx } from '../../src/trivium/types.js';
import { ALL_AGENT_IDS } from '../../src/trivium/agents/registry.js';

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
 * ── 位置参数按命令语义定，旗标只做覆盖 ──
 *
 *   命令 A：正文 = 任务目标，`--focus` 可选
 *   B/C/D：正文 = 审查焦点（PRD 第 8 章「命令后面带的提示语」），`--goal` 可选
 *
 * 用户在 B/C/D 里最常打的就是焦点，几乎不会打目标——目标能从归档回退取回。
 * 显式旗标永远优先于正文。
 */

/*
 * 命令 A 明确拒绝选侧旗标（审查意见 GLM-02）。
 *
 * 修复前：`NAMED_FLAGS` 不分 scope，`/dual-run --critics glm` 会被解析成功，
 * 然后被 S2/S6 的交接说明静默丢弃（那里只交代 focus / context / models / profile）。
 * **拼错的当场退 64，写对的反而无声消失**——「错的报错、对的消失」。
 */
for (const flag of ['--critics glm', '--only glm']) {
  test(`命令 A 拒绝 ${flag.split(' ')[0]}：明确报错，不静默丢弃`, async () => {
    const ctx = await fakeCtx();
    await assert.rejects(
      resolveTopicArgs({ ctx, scope: 'all', rawArgs: `把登录改造为 OIDC ${flag}` }),
      (e: { code?: number; message: string }) => {
        assert.equal(e.code, EXIT.USAGE);
        assert.match(e.message, /命令 A/);
        assert.match(e.message, /dual-review/, '要告诉用户改用哪条命令');
        return true;
      },
    );
  });
}

test('B/C/D 不受影响：同样的旗标在这里照常生效', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 9;\n');
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: '看并发 --topic T --critics glm' });
  assert.deepEqual(r.critics, ['glm']);
});

test('命令 A：正文是任务目标，--focus 是可选补充', async () => {
  const ctx = await fakeCtx();
  const r = await resolveTopicArgs({
    ctx, scope: 'all', rawArgs: '--topic T 把登录改造为 OIDC --focus 重点看会话固定',
  });
  assert.equal(r.task_goal, '把登录改造为 OIDC');
  assert.equal(r.prompt_hint, '重点看会话固定');
  assert.notEqual(r.task_goal, r.prompt_hint, '两者同源会让 BRIEF 第 2 段与第 4 段雷同');
});

test('B/C/D：正文就是审查焦点，用户不必区分目标与焦点', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: '--topic T 重点看并发安全与回滚路径' });
  assert.equal(r.prompt_hint, '重点看并发安全与回滚路径');
  assert.equal(r.task_goal, null, '目标缺省，交给编排器回退 task.json / plan 原稿');
});

test('B/C/D：显式 --goal 是已知旗标且贪婪取值，不会被吞进焦点', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({
    ctx, scope: 'code', rawArgs: '--topic T 重点看并发 --goal 把登录改造为 OIDC 并补回滚',
  });
  assert.equal(r.prompt_hint, '重点看并发');
  assert.equal(r.task_goal, '把登录改造为 OIDC 并补回滚');
});

test('B/C/D：兼容显式写法 <任务目标> --focus <焦点>——给了 --focus，正文落到目标', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({
    ctx, scope: 'code', rawArgs: '--topic T 把登录改造为 OIDC --focus 重点看会话固定',
  });
  assert.equal(r.task_goal, '把登录改造为 OIDC');
  assert.equal(r.prompt_hint, '重点看会话固定');
});

test('B/C/D：主题缺省时从焦点推导，note 说明来源', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  const r = await resolveTopicArgs({ ctx, scope: 'code', rawArgs: '重点看并发安全' });
  assert.equal(r.topic_inferred, true);
  assert.ok(r.notes.some((n) => n.includes('由审查焦点推导')), JSON.stringify(r.notes));
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

test('B/C/D 什么都没写（无正文、无 --focus）才退 64（FR-20）', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 2;\n');
  for (const raw of ['--topic T', '--topic T --goal 只给了目标']) {
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
  const r = await resolveTopicArgs({ ctx, scope: 'all', rawArgs: '--topic T 把登录改造为 OIDC' });
  assert.equal(r.prompt_hint, null);
  assert.equal(r.task_goal, '把登录改造为 OIDC');
});

// ── AGY-04：only / allow-single / session-id 曾不在白名单里 ──

test('AGY-04：三个旗标被识别，不再被当成正文吞进审查焦点', () => {
  const r = splitArguments('重点看并发 --only glm --allow-single --session-id S-1 --topic T');
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
  const r = splitArguments('--allow-single 重点看并发安全');
  assert.ok(r.booleans.has('allow-single'));
  assert.equal(r.rest, '重点看并发安全');

  // 贪婪旗标也要在它面前停下
  const g = splitArguments('--focus 重点看并发 --allow-single --topic T');
  assert.equal(g.named['focus'], '重点看并发');
  assert.ok(g.booleans.has('allow-single'));
  assert.equal(g.named['topic'], 'T');

  // 显式否定
  assert.ok(!splitArguments('--allow-single=false x').booleans.has('allow-single'));
});

test('AGY-04：resolveTopicArgs 把三者输出，不静默丢弃', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 3;\n');
  const r = await resolveTopicArgs({
    ctx, scope: 'code',
    rawArgs: '重点看并发 --topic T --only gemini --allow-single --session-id S-9',
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
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: '重点看并发 --topic T --only gemmini' }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE);
      /*
       * 断言锚在**意图**上：拼错要当场退 64，且错误里要列出合法值。
       * M7b 第 5 步把校验收敛进 `resolveCriticSelection` 后措辞变了
       * （从「只接受 X | Y」变成「含未登记的 Agent…可用：X | Y」），
       * 原先逐字匹配措辞的断言会为一次纯文案调整变红——那是脆断言。
       */
      assert.match(e.message, /gemmini/, '要点名拼错的那个值');
      for (const c of CRITICS) {
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
    const r = splitArguments(`看并发 --model-${id} m-1 --topic T`);
    assert.equal(
      r.named[`model-${id}` as 'model-gemini'], 'm-1',
      `--model-${id} 必须被识别为旗标——漏一家就意味着那家的模型覆盖会被静默吞进正文`,
    );
    assert.equal(r.rest, '看并发', `--model-${id} 不得残留在焦点正文里`);
  }
});

test('给非审核者指定模型 → 退 64 并列出当前可用，而不是解析成功后被悄悄丢弃', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 4;\n');
  /*
   * 白名单的论域是「全部已登记 Agent」，取值的论域是「当前可用审核者」。
   * 两者之差（Driver 自身、尚未启用的第三家）必须当场报错：
   * 放任它走到「解析成功、随后被丢弃」，留痕里就看不出用户指定过模型——
   * 这正是 `--base` 漏传那一族的形状。
   */
  const driverSide = ALL_AGENT_IDS.find((id) => !(CRITICS as readonly string[]).includes(id));
  assert.ok(driverSide, '注册表里应当至少有一个未启用为审核者的 Agent（当前是 claude / codex）');

  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'code', rawArgs: `看并发 --topic T --model-${driverSide} m-9` }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE, '参数错误一律退 64');
      assert.match(e.message, new RegExp(`model-${driverSide}`), '报错要点名是哪个旗标');
      for (const c of CRITICS) {
        assert.match(e.message, new RegExp(c), '要列出当前可用的审核者，别让用户再猜一次');
      }
      return true;
    },
  );
});

test('可用审核者的模型覆盖照常生效（上一条不得误伤正常路径）', async () => {
  const ctx = await fakeCtx();
  await fs.writeFile(path.join(ctx.projectRoot, 'a.ts'), 'export const a = 5;\n');
  const side = CRITICS[0]!;
  const r = await resolveTopicArgs({
    ctx, scope: 'code', rawArgs: `看并发 --topic T --model-${side} m-7`,
  });
  assert.equal(r.models[side], 'm-7');
});
