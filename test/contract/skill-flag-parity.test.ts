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

/**
 * `/dual-run` 没有自己的 `--start` 模板——S2/S6 委托给 B/C 的第 3 步执行。
 * 所以对它只能断言「委托说明里点名了模型覆盖要一并传下去」，
 * 否则命令 A 收到的 `--model-*` 会在委托的交接处丢掉。
 */
test('dual-run：委托 B/C 执行时要交代模型覆盖的去向', () => {
  const md = readSkill('dual-run');
  assert.ok(
    declaredFlags(md).includes('model-gemini'),
    '前提变了：dual-run 不再声明 --model-gemini，本测试需要重写',
  );
  assert.ok(
    /模型覆盖/.test(md),
    'dual-run 声明了 --model-gemini/--model-glm，但 S2/S6 的委托说明里没有交代' +
      '它们怎么传给 B/C 的第 3 步——交接处会把用户指定的模型丢掉。',
  );
});
