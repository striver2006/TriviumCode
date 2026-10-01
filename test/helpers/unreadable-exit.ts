/**
 * 「运行留痕读不出」七处拒绝文案的共用断言（留痕读不出的出口计划 r2 §5，EV-148 文案部分）。
 *
 * 七处（`review --start`、`topic claim`、`topic resolve`、`hook-pre-write`、`gate` 一份都读不出、
 * `--await-approval` 与 `approve` 的复核）的出口一律以 `meta.ts` 的共用出口段收尾。
 * 每处用例都过同一组判据：
 *
 * - 含固定段 `UNREADABLE_RUN_META_EXIT_BODY`（逐字子串）——「语义同源」靠它，不靠各处措辞相近；
 * - 逐行列出读不出的那几份的**绝对路径**——② 档要用户原样复制给 `git restore`（计划双审 CODEX-02）；
 * - 不出现循环出口：「重跑……会（先）落一份可读 / 随即恢复 / 当场恢复」，以及「出口是重跑」。
 *   重跑在 `review --start` 入口就被同一个 `corrupt` 判定拒绝，那条出口指回自己。
 */
import assert from 'node:assert/strict';
import { UNREADABLE_RUN_META_EXIT_BODY } from '../../src/trivium/meta.js';

/** 循环出口的两种写法。源码契约（U2）与各处文案共用这一份 */
export const CIRCULAR_EXIT_PATTERNS: readonly RegExp[] = [
  /重跑[^\n]*(落一份可读|随即恢复|当场恢复)/,
  /出口是\**重跑/,
];

export function assertUnreadableExit(text: string, files: readonly string[], where: string): void {
  assert.ok(
    text.includes(UNREADABLE_RUN_META_EXIT_BODY),
    `${where}：出口没有以共用出口段收尾（七处要语义同源）：\n${text}`,
  );
  for (const f of files) {
    assert.ok(text.includes(`    · ${f}\n`), `${where}：没有逐行列出读不出的那一份 ${f}：\n${text}`);
  }
  for (const re of CIRCULAR_EXIT_PATTERNS) {
    assert.doesNotMatch(text, re, `${where}：又给出了指回自己的循环出口：\n${text}`);
  }
}
