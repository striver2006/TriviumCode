import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import { RECAL_ANNOUNCE_AFTER_PASS } from '../../src/trivium/preflight.js';

/**
 * skill 契约：预检退 69 时的自动校准（EV-251，预检失败自动校准计划 r2 D4；EV-252，自动校准播报与照抄计划 r2 D4）。
 *
 * 四条命令（/dual-run 与三条 /dual-review-*）× 四家载体的渲染产物同一口径：先照念 `announce_before`、再照抄
 * `recalibration.invocations`（命令行前后不加任何东西）、前台调用、按 `bash_timeout_ms` 设工具超时、重跑同一条预检一次、
 * 通过后第一句是定性句、至多一轮、第二次不再校准。
 * 论域取全目录扫描：凡带 `preflight --stage` 的入口产物都进论域，新加的载体或命令自动覆盖。
 * 断言只能证明「该说的说在了该说的位置」；模型是否照做只能靠真实会话验收（EV-252 残余）。
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

const SECTION_START = '**预检退 69 时先看能不能自动校准**';
const SECTION_END = '每次预检至多一轮。';

/** 自动校准一节的整段（起止句含在内）；找不到返回 null */
function section(md: string): string | null {
  const a = md.indexOf(SECTION_START);
  const b = a === -1 ? -1 : md.indexOf(SECTION_END, a);
  return b === -1 ? null : md.slice(a, b + SECTION_END.length);
}

/** `needle` 在 `md` 里的位置，不在就让断言当场失败（免得 -1 混进次序比较） */
function at(md: string, needle: string): number {
  const i = md.indexOf(needle);
  assert.notEqual(i, -1, `缺少：${needle}`);
  return i;
}

test('论域：四条命令 × 四家载体共 16 份入口产物带预检步骤（防止扫描空转）', () => {
  assert.equal(withPreflight.length, 16, withPreflight.map((p) => path.relative(REPO_ROOT, p)).join('\n'));
});

test('同一口径：16 份产物的自动校准一节逐字节相同（EV-252）', () => {
  const sections = withPreflight.map((p) => ({ rel: path.relative(REPO_ROOT, p), s: section(readFileSync(p, 'utf8')) }));
  for (const { rel, s } of sections) assert.ok(s, `${rel}：截不出自动校准一节`);
  const first = sections[0]!;
  for (const { rel, s } of sections.slice(1)) assert.equal(s, first.s, `${rel} 与 ${first.rel} 的自动校准一节不同`);
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

  test(`${rel}：先播报、后调用，通过后第一句是定性句（EV-252）`, () => {
    const s = section(md);
    assert.ok(s, '截不出自动校准一节');
    const gate = at(s, '**在这句话出现在对话里之前，不得发起任何 doctor 调用。**');
    assert.ok(at(s, '`recalibration.announce_before` **原样**') < gate);
    assert.ok(gate < at(s, '逐条执行 `recalibration.invocations`'), '闸门句要在调用那一步之前');
    // 旧的「先发一行文本」主步骤不得残留；自拟格式只出现在键缺席的回落句里
    assert.doesNotMatch(s, /先发一行文本/);
    assert.ok(at(s, '键缺席时') < at(s, '按格式「预检退 69，以下失败项可由 doctor 重新校准'));
    // 回落句同样受闸门约束（代码审 GLM-01）
    const fallbackGate = at(s, '同样先发后调');
    assert.ok(at(s, '键缺席时') < fallbackGate && fallbackGate < at(s, '逐条执行 `recalibration.invocations`'));
    // 定性句与源码常量逐字相等，且排在「仍失败」分支与外层的 warnings 句之前
    const pass = at(s, `**你在这之后写的第一句话就是「${RECAL_ANNOUNCE_AFTER_PASS}」**`);
    assert.ok(pass < at(s, '仍失败（任何退出码）'));
    assert.ok(pass < s.indexOf('然后才念 `warnings`'));
    assert.ok(md.indexOf(s) + s.length <= at(md, '通过时若 `warnings` 非空'), '外层 warnings 句在本节之后');
  });

  test(`${rel}：照抄调用，命令行前后不加任何东西（EV-252）`, () => {
    const s = section(md)!;
    assert.match(s, /\*\*命令文本恰好是字面的 `\.trivium\/bin\/trivium` 后接该条 `args` 的各项\*\*/);
    assert.match(s, /\*\*前后不加任何东西\*\*：不加重定向（`>`、`>>`、`2>&1`）、\n?\s*不接管道或 `tee`/);
    // 命令行前后之外，args 本身也不动（代码审 GLM-01）
    assert.ok(at(s, '**前后不加任何东西**') < at(s, '`args` 的各项也不改、不增删'));
    // 长输出的出口是条件句：四家载体不一定都截存
    assert.match(s, /输出已直接返回时就从返回里取；载体把输出截存成文件时，另起一次只读的读取去读那个文件/);
    // 理由对无 Hook 的载体也成立：不断言「必被拦」
    assert.match(s, /装有写入护栏的载体还会把带重定向的整条命令拦下/);
    assert.doesNotMatch(s, /Hook 会整条拦下|加了也跑不成/);
  });
}
