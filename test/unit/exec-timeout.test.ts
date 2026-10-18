import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/trivium/util/exec.js';

// WIN_FILE_SKIP（Windows 移植）：活体 POSIX 进程语义（进程组信号/SIGTERM 阶梯/僵尸/ps 形态）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 活体 POSIX 进程语义（进程组信号/SIGTERM 阶梯/僵尸/ps 形态）');
} else {

/*
 * 子进程超时与收尾的两个真实缺陷（审核 M8）：
 *   · 超时只杀直接子进程，真正烧配额的孙进程被遗弃给 init；
 *   · `close` 要等全部 stdio 关闭，留下孙进程时永不触发，Promise 永不 resolve。
 */

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('killTree：超时时整棵进程树一起死，孙进程不被遗弃', async () => {
  // sh 派生 sleep 30 并把它的 pid 打出来，然后 wait 住
  const r = await run('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], { timeoutMs: 300, killGraceMs: 200, killTree: true });
  assert.equal(r.timedOut, true);
  const grandchild = Number.parseInt(r.stdout.trim(), 10);
  assert.ok(Number.isInteger(grandchild) && grandchild > 1, `拿不到孙进程 pid：${r.stdout}`);
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(alive(grandchild), false, `孙进程 ${grandchild} 仍活着——超时只杀了直接子进程`);
});

test('不开 killTree 时的对照：孙进程会被遗弃（记录旧行为的形状）', async () => {
  const r = await run('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], { timeoutMs: 300, killGraceMs: 200 });
  const grandchild = Number.parseInt(r.stdout.trim(), 10);
  const left = alive(grandchild);
  if (left) process.kill(grandchild, 'SIGKILL');
  assert.equal(left, true, '这是对照：不开 killTree 就是这种形状，适配器必须打开它');
});

test('子进程已退出但孙进程还占着管道：exit 兜底让 run 在两秒内返回，不等 close', async () => {
  const started = Date.now();
  // sh 立刻退出，但后台 sleep 继承了 stdout 管道，close 要等它结束
  const r = await run('/bin/sh', ['-c', 'sleep 6 & exit 0']);
  const took = Date.now() - started;
  assert.equal(r.code, 0);
  assert.ok(took < 5_000, `等了 ${took}ms——说明还在等 close，孙进程一天不退 Promise 一天不 resolve`);
});

}
