/**
 * doctor 探针段在 Windows 上的「组」快照（`winSectionSnapshotFrom`，双平台统一时补 EV-251 的 win32 实现）。
 *
 * 纯函数，喂构造的进程表，两个平台都跑。Windows 没有进程组：组长退出后按「父 pid 等于组号、创建不早于
 * 我方派生时刻」认本组孤儿后代；表里还有同号进程判复用。真实进程表上的行为由 Windows 机器上的
 * `doctor --deadline-s` 实测确认（见部署手册的 Windows 验收项）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPAWN_CLOCK_SKEW_MS, winSectionSnapshotFrom, type WinProcRow } from '../../src/trivium/util/platform.js';

const SPAWNED = Date.parse('2026-10-24T01:00:00.000Z');
const at = (offsetMs: number): string => new Date(SPAWNED + offsetMs).toISOString().replace('Z', '000Z');
const row = (pid: number, ppid: number, creation: string): WinProcRow => ({ pid, ppid, creation });

test('W1 组长还在表：只报 leaderPresent，不数孤儿（调用方据句柄已知我方组长退了 ⇒ 判复用）', () => {
  const rows = [row(100, 1, at(-60_000)), row(200, 100, at(500))];
  assert.deepEqual(winSectionSnapshotFrom(rows, 100, SPAWNED), { members: 1, leaderPresent: true, orphanRoots: [] });
});

test('W2 组长已退：派生之后由它生的子进程连同其后代算本组成员，直接子进程列进 orphanRoots', () => {
  const rows = [
    row(201, 100, at(300)), // 组长生的子进程
    row(301, 201, at(900)), // 孙辈
    row(302, 301, at(1_500)), // 曾孙
    row(999, 4, at(-5_000)), // 无关进程
  ];
  assert.deepEqual(winSectionSnapshotFrom(rows, 100, SPAWNED), { members: 3, leaderPresent: false, orphanRoots: [201] });
});

test('W3 父 pid 残留指向组号、但创建早于派生时刻的：不是本组（pid 复用前的旧进程），不认', () => {
  const rows = [row(201, 100, at(-SPAWN_CLOCK_SKEW_MS - 1)), row(202, 100, at(-SPAWN_CLOCK_SKEW_MS + 10))];
  const s = winSectionSnapshotFrom(rows, 100, SPAWNED);
  assert.deepEqual(s.orphanRoots, [202], '容差内的算（时钟粒度），容差外的不算');
  assert.equal(s.members, 1);
});

test('W4 创建时刻取不到（空串）的不认：宁可漏杀不误杀；组内无成员即已不在', () => {
  const rows = [row(201, 100, ''), row(5, 0, '')];
  assert.deepEqual(winSectionSnapshotFrom(rows, 100, SPAWNED), { members: 0, leaderPresent: false, orphanRoots: [] });
});
