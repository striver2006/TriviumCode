import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';

/**
 * CLI 布尔旗标对账（BACKLOG EV-24）。
 *
 * `parseArgs` 原本按位置猜值：下一个 token 不以 `--` 开头就当值。于是 `--reject 理由`
 * 让 reject 拿到字符串、`=== true` 判假——拒绝静默变通过。修法是 `BOOLEAN_FLAGS` 集合：
 * 集合里的旗标永不吞下一个 token、`=` 传值只认 true/false 字面。
 *
 * 集合靠人维护就会漏：下次有人新增一个 `flags.get('x') === true` 的判据而忘了登记，
 * 那个旗标就悄悄回到吞值形态。所以两个方向都对：
 *   - 每个以 `=== true` 判定的旗标必须在集合里（漏登记 → 吞值）；
 *   - 集合里的每一项必须有判据（多登记 → 死条目，与 EV-30 那族同形）。
 *
 * **只扫源码文本、不 import `cli.ts`**：那个模块在加载时就执行 `main(process.argv)`。
 */
const CLI = readFileSync(path.join(REPO_ROOT, 'src/trivium/cli.ts'), 'utf8');

function declared(): Set<string> {
  const m = CLI.match(/const BOOLEAN_FLAGS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(m, 'cli.ts 缺少 BOOLEAN_FLAGS 声明');
  return new Set([...m![1]!.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((x) => x[1]!));
}

function judged(): Set<string> {
  const out = new Set<string>();
  for (const m of CLI.matchAll(/flags\.get\('([a-z][a-z0-9-]*)'\)\s*===\s*true/g)) out.add(m[1]!);
  for (const m of CLI.matchAll(/flags\.has\('([a-z][a-z0-9-]*)'\)/g)) out.add(m[1]!);
  return out;
}

test('每个以 === true 判定的旗标都登记在 BOOLEAN_FLAGS 里', () => {
  const d = declared();
  const missing = [...judged()].filter((f) => !d.has(f)).sort();
  assert.deepEqual(
    missing, [],
    `这些旗标按布尔判定却没登记进 BOOLEAN_FLAGS：${missing.join('、')}——` +
      '它们会继续吞掉下一个 token（`--x 附言` 静默让判定为假）',
  );
});

test('BOOLEAN_FLAGS 里没有死条目：每一项都有判据', () => {
  const j = judged();
  const dead = [...declared()].filter((f) => !j.has(f)).sort();
  assert.deepEqual(dead, [], `BOOLEAN_FLAGS 登记了却没人判定：${dead.join('、')}`);
});

test('parseArgs 对布尔旗标的两条路径都改了：不吞 token、= 只认 true/false', () => {
  assert.match(CLI, /if \(BOOLEAN_FLAGS\.has\(name\)\) \{\s*flags\.set\(name, true\);/, '`--x 值` 路径');
  assert.match(CLI, /只接受 true\/false/, '`--x=值` 路径要对乱值退 64');
});
