import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPO_ROOT } from '../helpers/fixture.js';
import { renderEntries } from '../../src/entry-render.js';
import { resolveNamedFlags } from '../../src/trivium/topic-args.js';

/**
 * skill 契约：`argument-hint` 声明的旗标必须在第 3 步的 `review --start`
 * 模板里有槽位（审查意见 AGY-01/AGY-02 ≡ GLM-01/GLM-02）。
 *
 * 这一族缺口的形状是固定的：argument-hint 声明了、`topic resolve` 也解析了、
 * `cli.ts` 也支持了，唯独第 3 步模板没有槽位。于是用户传的值在 resolve 里
 * 影响一次预检，之后被静默丢弃——**不报错、留痕正常、审的不是用户以为的东西**。
 * `--base` 是撞见的第一处，回头排查发现 `--model-*`、`--plan-file`、`--rca-file`
 * 都是同一个洞，所以修完个案还要有这条测试守住整族。
 *
 * 为什么断言方向是「声明 ⊆ 模板」而非双向：模板里的 `--goal` 不来自用户旗标，
 * 而是 resolve 输出的 `task_goal`，argument-hint 里本就不该有它。
 */

/** 有自己 `review --start` 模板的送审 skill。 */
const REVIEW_SKILLS = ['dual-review-code', 'dual-review-plan', 'dual-review-bug'];

/**
 * 豁免：声明了但**故意**不进模板的旗标。
 *
 * 目前为空。`--profile` 曾在此豁免（AGY-04 ≡ GLM-05，悬空于 argument-hint 而
 * CLI 不解析），项目负责人拍板「保留即实现」后已接上 `applyProfileOverride`，
 * 豁免随之删除——这一族缺口现在没有例外。
 */
const EXEMPT = new Set<string>([
  /*
   * `--only`：**用户可写，Driver 不得透传**（M7b 第 5 步，审查意见 AGY-01 ≡ GLM-01）。
   *
   * 它是 `--critics` 的单元素旧写法，设计 7.1 承诺长期保留为别名，所以
   * argument-hint 里必须留着它——那是「用户能写什么」的清单。
   * 但 `topic resolve` 会把它的结果并进 `critics` 数组并**把输出的 `only` 置 null**，
   * Driver 手上根本拿不到可传的值；若模板还留着这个槽位，照抄就会同时拼出
   * `--critics` 与 `--only` 而撞上互斥退 64——用户没写 `--critics`，报错却说他写了。
   *
   * 这条豁免与当年 `--profile` 那次**性质相反**：那次是「声明了却没人实现」的悬空，
   * 补上实现后豁免即删；这次是「声明给用户、刻意不进 Driver 模板」的分工，
   * 属于长期状态。两者都要求写明理由，不写就退化成掩盖没改完的模块。
   */
  'only',
]);

/**
 * 四家载体的产物（M10b 第 2 步：`skill-flag-parity` 扩为四家 × CLI 旗标对账，计划 r5 §5.1 ②）。
 * 取渲染器的内存产物而不是读盘：「盘上产物 = 源」由 `entry-render-parity` 守，这里只管旗标对账。
 */
const ENTRIES = await renderEntries(REPO_ROOT);
const entriesOf = (name: string) => ENTRIES.filter((e) => e.name === name);

/**
 * 抓出声明的所有 `--xxx`：claude 在 front-matter 的 argument-hint 行；
 * 另三家不输出该键，写进正文的「参数写法：`…`」一行（`skills-src/partials/args/line.transcribe.md`）。
 */
function declaredFlags(md: string): string[] {
  const line = md.split('\n').find((l) => l.startsWith('argument-hint:') || l.includes('参数写法：`'));
  assert.ok(line, 'SKILL.md 缺少 argument-hint 行（或正文的参数写法行）');
  return [...line.matchAll(/--([a-z][a-z0-9-]*)/g)].map((m) => m[1]!);
}

/**
 * 抓出 `TV review --start …` 那一行命令模板。
 *
 * 必须锚定行首的 `TV review --start`，不能用 `includes('review --start')`：
 * 正文里提到这个命令名是常事（例如第 2 步解释「第 3 步的 review --start 走
 * 标准 argv 解析」），松匹配会取到那句引文，把整条契约测成一个假阳性。
 */
function startTemplate(md: string): string {
  const line = md.split('\n').find((l) => l.trimStart().startsWith('TV review --start'));
  assert.ok(line, 'SKILL.md 缺少 review --start 命令模板');
  return line;
}

for (const { name, agent, content: md } of REVIEW_SKILLS.flatMap(entriesOf)) {
  test(`${agent}/${name}：argument-hint 声明的旗标都在 --start 模板里有槽位`, () => {
    const tpl = startTemplate(md);
    const missing = declaredFlags(md)
      .filter((f) => !EXEMPT.has(f))
      .filter((f) => !new RegExp(`--${f}\\b`).test(tpl));
    assert.deepEqual(
      missing,
      [],
      `${name} 的 argument-hint 声明了 ${missing.map((f) => `--${f}`).join('、')}，` +
        `但第 3 步模板里没有槽位——用户传的值会在 resolve 之后被静默丢弃。\n  模板：${tpl.trim()}`,
    );
  });

  test(`${agent}/${name}：声明的旗标 CLI 都认（topic resolve 的具名旗标白名单）`, () => {
    const known = new Set(resolveNamedFlags());
    const unknown = declaredFlags(md).filter((f) => !known.has(f));
    assert.deepEqual(
      unknown, [],
      `${agent}/${name} 声明了 CLI 不认的旗标 ${unknown.map((f) => `--${f}`).join('、')}：` +
        '用户照写会被当成正文压进焦点。',
    );
  });

  test(`${agent}/${name}：模板要求把 resolve 输出的模型覆盖透传下去`, () => {
    assert.ok(
      /resolve 输出的 `models`/.test(md),
      `${name} 补了 --model-* 槽位还不够：正文必须指示 Driver 把 resolve 输出的 ` +
        '`models` 字段透传下去，否则 Driver 不知道该填什么。',
    );
  });

}

/**
 * 收 `--critics` 的入口：B / C / D 与 `/dual-run`（EV-125 起命令 A 也收）。
 * 下面两条正文断言原先只对 B / C / D 跑；命令 A 的透传写在 S0.5 / S0.6 / S2 / S6，
 * 同一族缺口（写了、解析了、交接处没交代）在它身上一样会发生。
 */
const CRITICS_RELAY_SKILLS = [...REVIEW_SKILLS, 'dual-run'];

for (const { name, agent, content: md } of CRITICS_RELAY_SKILLS.flatMap(entriesOf)) {
  /*
   * 与 `models` 同款的正文断言（审查意见 GLM-01）。
   *
   * **槽位存在 ≠ Driver 知道该填什么**，而 M7b 第 5 步的 major 恰恰出在正文：
   * 模板有 `--critics` 槽位、argument-hint 也声明了，唯独正文把透传规则写错了
   * （让 Driver 同时传 `--only`），于是 `--only` 场景整条链路必退 64。
   * 那次 flag-parity 全绿——它当时只校验槽位。
   */
  test(`${agent}/${name}：正文要交代把 resolve 输出的 critics 透传下去`, () => {
    assert.ok(
      /resolve 输出的 `critics`/.test(md),
      `${name} 有 --critics 槽位还不够：正文必须指示 Driver 把 resolve 输出的 ` +
        '`critics` 字段透传下去，否则用户选的侧数会在 resolve 之后静默丢失。',
    );
  });

  /*
   * 反向断言：正文**不得**指示 Driver 传 `--only`。
   *
   * 这条防的是「有人照旧文档把 `--only` 透传加回来」——`topic resolve` 已把
   * 输出的 `only` 置 null，加回来拿不到值；真要硬拼一个，就会撞上互斥退 64。
   */
  test(`${agent}/${name}：正文不得指示 Driver 透传 --only（它已并入 critics）`, () => {
    assert.doesNotMatch(
      md, /把它传给 `--only`/,
      `${name} 的正文又把 --only 透传写回来了。它是 --critics 的单元素旧写法，` +
        'resolve 会把结果并进 critics 并把 only 置 null——同时递两个旗标会退 64。',
    );
  });
}

for (const { agent, content: md } of entriesOf('dual-run')) {
  /*
   * `allow_single` 是 EV-125 之前命令 A 唯一「解析了却被静默丢弃」的选侧旗标：它不在旗标拒绝之列，
   * 解析进了 `allow_single`，而 S2 / S6 的交接一句没提。B / C / D 的第 3 步有正文交代，这里补上同一条。
   */
  test(`${agent}/dual-run：正文交代把 resolve 输出的 allow_single 透传下去`, () => {
    assert.ok(
      /`allow_single`/.test(md) && /--allow-single/.test(md),
      'dual-run 声明了 --allow-single，但正文没有交代 `allow_single` 怎么传给 S2 / S6——用户要求的降级会被静默忽略。',
    );
  });

  /*
   * 交接点逐段锁（EV-125 变异设计时核出）：上面两条只查「整篇正文里有没有」，
   * 而 S0.5 的字段清单已经含「resolve 输出的 `critics`」「`allow_single`」——删掉 S2 或 S6 的那一条，
   * 整篇断言照样绿，两轮里的某一轮就会静默丢掉用户选的侧或降级许可。
   * 所以切出 S2、S6 两处**交接本身**，逐段要求点名这两个旗标。
   *
   * 切的是交接清单，不是整个 `### S2` 节（EV-125 契约变异 C1 / C3 核出）：S2 节里还有一段
   * 「模型覆盖、档位、入选集合（`--critics`）与降级许可（`--allow-single`）要一并传下去」的总述，
   * 按整节切时删掉清单里的那一条，这段总述照样让断言绿——正是本条要防的形状。
   * S2 的交接是「……第 3 步执行 `--start` / `--wait` 循环，但：」之后的那张清单；
   * S6 的交接是标题下「同 S2（……）」那一段；S0.6 的交接是该节命令代码块之后的那张清单。都到第一个空行为止。
   *
   * **三段、各自该有的旗标**（EV-125 代码双审 CODEX-01 ≈ AGY-01 / AGY-02）：第一版只锁 S2 / S6 两段、
   * 两个旗标，于是 S2 与 S6 都漏了 `--profile`、S0.6 那句「`profile` / `models` 怎么传」整句删掉，套件照样全绿。
   * 「S0.6 / S2 / S6 必须同一组」这条不变量里，每一项都要有机器看着。
   *
   * 锚点不放宽（AGY-02 的前一半未取）：锚点就在本仓自己的契约源里，改写时 `start >= 0` 那一条会响亮失败；
   * 按第一个空行截断只会让段落更短、断言更严，不会放过缺项。
   */
  test(`${agent}/dual-run：S0.6、S2、S6 的交接各自点名入选、档位、模型覆盖（S2 / S6 另含降级许可）`, () => {
    const paragraphAt = (start: number, label: string): string => {
      assert.ok(start >= 0, `找不到 ${label} 的交接起点`);
      const end = md.indexOf('\n\n', start);
      return end >= 0 ? md.slice(start, end) : md.slice(start);
    };
    const s06 = md.search(/^### S0\.6 /m);
    assert.ok(s06 >= 0, '找不到 ### S0.6');
    const fenceOpen = md.indexOf('```', s06);
    const fenceClose = md.indexOf('\n```\n', fenceOpen + 3);
    assert.ok(fenceOpen >= 0 && fenceClose >= 0, 'S0.6 的预检命令代码块不在了');
    const sections: [string, string, RegExp[]][] = [
      ['S0.6', paragraphAt(md.indexOf('- ', fenceClose), 'S0.6'), [/--critics\b/, /--profile\b/, /--model-/]],
      ['S2', paragraphAt(md.search(/循环，但：$/m), 'S2'), [/--critics\b/, /--allow-single\b/, /--profile\b/, /--model-/]],
      ['S6', paragraphAt(md.search(/^同 S2（/m), 'S6'), [/--critics\b/, /--allow-single\b/, /--profile\b/, /模型覆盖/]],
    ];
    for (const [name, sec, wants] of sections) {
      for (const re of wants) {
        assert.match(sec, re, `dual-run ${name} 的交接没点名 ${re.source}：这一项会在这一步静默丢失`);
      }
    }
  });

  /*
   * `notes` 的转述约定（EV-125 代码双审 CODEX-07）：命令 A 放开选侧后，`--only` + `--allow-single` 会往 `notes`
   * 推一条说明；「主题由任务目标推导」「主题异常短」两条本就在同一通道里。契约不交代，它们只停在 `--json` 里。
   */
  test(`${agent}/dual-run：交代 resolve 输出的 notes 要逐条念给用户`, () => {
    assert.match(md, /`notes` 非空时/, 'dual-run 没交代 notes 怎么处理：主题异常短这类提示会被静默吞掉');
  });

  test(`${agent}/dual-run：声明的旗标 CLI 都认（topic resolve 的具名旗标白名单）`, () => {
    const known = new Set(resolveNamedFlags());
    const unknown = declaredFlags(md).filter((f) => !known.has(f));
    assert.deepEqual(unknown, [], `${agent}/dual-run 声明了 CLI 不认的旗标 ${unknown.map((f) => `--${f}`).join('、')}`);
  });
}

for (const { name, agent, content } of REVIEW_SKILLS.flatMap(entriesOf)) {
  test(`${agent}/${name}：--start 模板带 --entry，让 CLI 知道焦点必填与留痕来源`, () => {
    const letter = { 'dual-review-plan': 'B', 'dual-review-code': 'C', 'dual-review-bug': 'D' }[name];
    assert.ok(
      new RegExp(`--entry ${letter}\\b`).test(startTemplate(content)),
      `${agent}/${name} 的 --start 模板缺 --entry ${letter}：run.json 记不到发起命令`,
    );
  });
}

/**
 * `/dual-run` 没有自己的 `--start` 模板——S2/S6 委托给 B/C 的第 3 步执行。
 * 委托的交接处是所有旗标最容易丢的地方：argument-hint 里声明的每一个旗标，
 * 正文里都必须交代它怎么传下去；否则用户传的值在 S0.5 之后就静默消失。
 * 这正是 B2 缺口的形状：`--focus` / `--context` 声明了、正文一次没提，
 * 而 S2 委托的 `review --start` 又要求 `--focus`，命令 A 在 S2 必然退 64。
 */
for (const { agent, content: md } of entriesOf('dual-run')) {
  test(`${agent}/dual-run：argument-hint 声明的每个旗标在正文里都有交代`, () => {
    const body = md.split('\n').filter((l) => !l.startsWith('argument-hint:') && !l.includes('参数写法：`')).join('\n');
    const missing = declaredFlags(md).filter((f) => !new RegExp(`--${f}\\b`).test(body));
    assert.deepEqual(
      missing,
      [],
      `${agent}/dual-run 声明了 ${missing.map((f) => `--${f}`).join('、')}，但正文没有交代它们怎么传给 B/C 的第 3 步`,
    );
  });
}

for (const { agent, content: md } of entriesOf('dual-run')) test(`${agent}/dual-run：有主题解析步骤，且委托执行时以命令 A 身份启动`, () => {
  assert.ok(/TV topic resolve --stage all/.test(md), 'dual-run 缺 topic resolve 步骤：主题名会由模型自由发挥');
  assert.ok(/--entry A\b/.test(md), 'dual-run 委托 B/C 第 3 步时必须传 --entry A，否则缺焦点会退 64');
  assert.ok(/模型覆盖/.test(md), 'S2/S6 的委托说明里没有交代模型覆盖怎么传下去');
  assert.ok(/不得自行调用 `agy` 或 `zcode`/.test(md), 'dual-run 缺「不得自行调用 agy / zcode」禁令，B/C/D 都有');
});
