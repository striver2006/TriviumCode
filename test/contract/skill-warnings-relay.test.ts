import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';

/**
 * skill 契约：只警告的提示要有人念（EV-123）。
 *
 * 预检与 `review --start` 都把只警告项汇总进 `warnings`，`ok` 与退出码不受影响——
 * 于是 skill 若只写「失败则原样转述」，警告就躺在工具结果里没人念，
 * EV-82 第三段那条运行期选模警告就是这样从未有过转述约定。
 *
 * 论域取**全目录扫描**（仿 `disposition-role-assets` 的先例）：新加一份 SKILL.md 自动进论域，
 * 不靠人记得把它加进清单。dual-run 的开场播报是**委托**写法（「按 `/dual-review-*` 的第 3 步执行」），
 * 不含 `review --start` 字面，所以单独断言它的继承句（仿 `skill-flag-parity` 对 dual-run 的专属断言）。
 */

const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const skills = readdirSync(SKILLS_DIR).filter((d) => existsSync(path.join(SKILLS_DIR, d, 'SKILL.md')));
const readSkill = (name: string): string => readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');

const PREFLIGHT_RELAY = /通过时若 `warnings` 非空，把每一条的 `detail` 原样念给用户，\*\*然后继续\*\*/;
const START_RELAY = /`--start` 返回的 `warnings` 非空时，在开场播报里逐条原样念出 `detail`/;

test('论域非空：至少四份 skill 带预检步骤（防止扫描本身空转）', () => {
  const withPreflight = skills.filter((s) => /preflight --stage/.test(readSkill(s)));
  assert.ok(withPreflight.length >= 4, `只扫到 ${withPreflight.join('、')}`);
});

for (const name of skills) {
  const md = readSkill(name);
  if (/preflight --stage/.test(md)) {
    test(`${name}：预检步骤约定了 warnings 的转述`, () => {
      assert.match(md, PREFLIGHT_RELAY, `${name} 跑预检却没约定念 warnings——警告会躺在工具结果里没人念`);
    });
  }
  if (/review --start/.test(md)) {
    test(`${name}：开场播报约定了 --start 返回的 warnings 的转述`, () => {
      assert.match(md, START_RELAY, `${name} 跑 --start 却没约定在开场播报里念 warnings`);
      assert.match(md, /review --cancel <run_id>/, '要告诉用户怎么中止：警告到达时审查已经拉起');
    });
  }
}

test('dual-run：委托继承句点名了 warnings（S2 / S6 的开场播报随委托继承）', () => {
  const md = readSkill('dual-run');
  assert.match(
    md,
    /开场播报（含 `warnings` 的逐条转述）与每次 `--wait` 后的进度播报，随委托一并继承/,
    'dual-run 的开场播报走委托，继承句里不点名 warnings，S2 / S6 的警告就没有转述约定',
  );
});
