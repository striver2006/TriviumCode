import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';

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
const EXEMPT = new Set<string>();

const readSkill = (name: string): string =>
  readFileSync(path.join(REPO_ROOT, 'skills', name, 'SKILL.md'), 'utf8');

/** 从 front-matter 的 argument-hint 行里抓出所有 `--xxx`。 */
function declaredFlags(md: string): string[] {
  const line = md.split('\n').find((l) => l.startsWith('argument-hint:'));
  assert.ok(line, 'SKILL.md 缺少 argument-hint 行');
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

for (const name of REVIEW_SKILLS) {
  test(`${name}：argument-hint 声明的旗标都在 --start 模板里有槽位`, () => {
    const md = readSkill(name);
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

  test(`${name}：模板要求把 resolve 输出的模型覆盖透传下去`, () => {
    const md = readSkill(name);
    assert.ok(
      /resolve 输出的 `models`/.test(md),
      `${name} 补了 --model-* 槽位还不够：正文必须指示 Driver 把 resolve 输出的 ` +
        '`models` 字段透传下去，否则 Driver 不知道该填什么。',
    );
  });
}

for (const name of REVIEW_SKILLS) {
  test(`${name}：--start 模板带 --entry，让 CLI 知道焦点必填与留痕来源`, () => {
    const letter = { 'dual-review-plan': 'B', 'dual-review-code': 'C', 'dual-review-bug': 'D' }[name];
    assert.ok(
      new RegExp(`--entry ${letter}\\b`).test(startTemplate(readSkill(name))),
      `${name} 的 --start 模板缺 --entry ${letter}：run.json 记不到发起命令`,
    );
  });
}

/**
 * `/dual-run` 没有自己的 `--start` 模板——S2/S6 委托给 B/C 的第 3 步执行。
 * 委托的交接处是所有旗标最容易丢的地方：argument-hint 里声明的每一个旗标，
 * 正文里都必须交代它怎么传下去；否则用户传的值在 S0 之后就静默消失。
 * 这正是 B2 缺口的形状：`--focus` / `--context` 声明了、正文一次没提，
 * 而 S2 委托的 `review --start` 又要求 `--focus`，命令 A 在 S2 必然退 64。
 */
test('dual-run：argument-hint 声明的每个旗标在正文里都有交代', () => {
  const md = readSkill('dual-run');
  const body = md.split('\n').filter((l) => !l.startsWith('argument-hint:')).join('\n');
  const missing = declaredFlags(md).filter((f) => !new RegExp(`--${f}\\b`).test(body));
  assert.deepEqual(
    missing,
    [],
    `dual-run 声明了 ${missing.map((f) => `--${f}`).join('、')}，但正文没有交代它们怎么传给 B/C 的第 3 步`,
  );
});

test('dual-run：有主题解析步骤，且委托执行时以命令 A 身份启动', () => {
  const md = readSkill('dual-run');
  assert.ok(/TV topic resolve --stage all/.test(md), 'dual-run 缺 topic resolve 步骤：主题名会由模型自由发挥');
  assert.ok(/--entry A\b/.test(md), 'dual-run 委托 B/C 第 3 步时必须传 --entry A，否则缺焦点会退 64');
  assert.ok(/模型覆盖/.test(md), 'S2/S6 的委托说明里没有交代模型覆盖怎么传下去');
  assert.ok(/不得自行调用 `agy` 或 `zcode`/.test(md), 'dual-run 缺「不得自行调用 agy / zcode」禁令，B/C/D 都有');
});
