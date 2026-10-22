import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';

/**
 * skill 契约：预检退 69 时的自动校准（EV-251，预检失败自动校准计划 r2 D4）。
 *
 * 四条命令（/dual-run 与三条 /dual-review-*）× 四家载体的渲染产物同一口径：照抄 `recalibration.invocations`、
 * 前台调用、按 `bash_timeout_ms` 设工具超时、重跑同一条预检一次、至多一轮、第二次不再校准。
 * 论域取全目录扫描：凡带 `preflight --stage` 的入口产物都进论域，新加的载体或命令自动覆盖。
 */

const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const ENTRY_DIR = path.join(SKILLS_DIR, 'dual-critic', 'entry');

function entryFiles(): string[] {
  const out: string[] = [];
  for (const d of readdirSync(SKILLS_DIR)) {
    const p = path.join(SKILLS_DIR, d, 'SKILL.md');
    if (existsSync(p)) out.push(p);
  }
  for (const carrier of existsSync(ENTRY_DIR) ? readdirSync(ENTRY_DIR) : []) {
    for (const cmd of readdirSync(path.join(ENTRY_DIR, carrier))) {
      const p = path.join(ENTRY_DIR, carrier, cmd, 'SKILL.md');
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

const withPreflight = entryFiles().filter((p) => /preflight --stage/.test(readFileSync(p, 'utf8')));

test('论域：四条命令 × 四家载体共 16 份入口产物带预检步骤（防止扫描空转）', () => {
  assert.equal(withPreflight.length, 16, withPreflight.map((p) => path.relative(REPO_ROOT, p)).join('\n'));
});

for (const p of withPreflight) {
  const rel = path.relative(REPO_ROOT, p);
  const md = readFileSync(p, 'utf8');
  test(`${rel}：预检退 69 时按 recalibration 自动校准一轮`, () => {
    assert.match(md, /recalibration\.eligible/);
    assert.match(md, /recalibration\.invocations/);
    assert.match(md, /\*\*不向用户确认\*\*/);
    assert.match(md, /\*\*前台调用\*\*，Bash 工具超时设为该条的 `bash_timeout_ms`/);
    assert.match(md, /不要放到后台，也不要拆成发起与等待两步/);
    assert.match(md, /用\*\*逐字相同\*\*的旗标重跑同一条预检命令\*\*一次\*\*/);
    assert.match(md, /即使可校准也\*\*不再\*\*自动校准——每次预检至多一轮/);
    assert.match(md, /`deadline\.sections` 里各段的 `state`、`notes` 与 `rerun`/);
    // 「原样转述并停止」只留在不可校准那一支：旧的无条件句不得残留
    assert.doesNotMatch(md, /^失败则\*\*原样转述\*\*(错误)?并停止/m);
    assert.match(md, /`recalibration` 键缺席、或 `recalibration\.eligible` 不为 `true`：\*\*原样转述\*\*/);
  });
}
