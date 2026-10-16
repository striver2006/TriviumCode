import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { groupsWithMark, killGroup, leaderGroupsWithMark } from '../helpers/proc.js';

/**
 * `leaderGroupsWithMark` 的过滤口径（BACKLOG EV-193）。
 *
 * 竞态本身窗口极窄（并发实验约万次派生撞一次，见 `doc/05_testing/evidence/ev193-pgid-race-20261016/`），
 * 不能拿它当确定性用例。这里改为直接造出「带标记、但不是组长」的进程——不 detached 派生的 `sh`
 * 沿用本测试进程的组号，形态与竞态窗口里那一行相同——钉住两条口径：
 * 宽口径 `groupsWithMark` 收它（收尾清理要宽），只认组长的 `leaderGroupsWithMark` 不收（采样判据要准）。
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 起一个带标记的 `sh`；等到它出现在进程表里（至多 5 s） */
async function startMarked(mark: string, detached: boolean): Promise<ChildProcess> {
  const c = spawn('/bin/sh', ['-c', 'sleep 30; : "$0"', mark], { detached, stdio: 'ignore' });
  for (let i = 0; i < 100 && !groupsWithMark(mark).length; i++) await sleep(50);
  assert.ok(groupsWithMark(mark).length > 0, `带标记的 sh 没起来（用例前提）：${mark}`);
  return c;
}

test('EV-193：detached 派生的组长 ⇒ 两种口径都收，且组号就是它的 pid', async () => {
  const mark = `trivium-proc-helpers-leader-${process.pid}`;
  const c = await startMarked(mark, true);
  try {
    assert.deepEqual(groupsWithMark(mark), [c.pid]);
    assert.deepEqual(leaderGroupsWithMark(mark), [c.pid]);
  } finally {
    killGroup(c.pid!);
  }
});

test('EV-193：带标记但不是组长（沿用父进程组号）⇒ 宽口径收、只认组长的口径不收', async () => {
  const mark = `trivium-proc-helpers-member-${process.pid}`;
  const c = await startMarked(mark, false);
  try {
    const wide = groupsWithMark(mark);
    assert.equal(wide.length, 1, `宽口径应恰好收到一组：${JSON.stringify(wide)}`);
    assert.notEqual(wide[0], c.pid, '前提：不 detached 派生的 sh 不是组长，组号不等于它的 pid');
    assert.deepEqual(leaderGroupsWithMark(mark), [], '非组长的带标记进程不能算成一组');
  } finally {
    // 不在独立组里，不能按组结束（那会打到测试进程自己）：先结束 sh 名下的 sleep，再结束 sh
    try { execFileSync('/usr/bin/pkill', ['-KILL', '-P', String(c.pid)]); } catch { /* 已不在 */ }
    c.kill('SIGKILL');
  }
});
