/**
 * EV-261：`--cancel` 判不了身份时给用户照抄的手工出路按平台给命令。
 *
 * win32 的 PowerShell / cmd 里没有 `ps` 与 `kill`，也没有负 pid 的进程组语义——此前 Windows 上照样教
 * `ps -p N -o command=`、`kill -TERM -N`（2026-10-27 Windows 全量原文）。三个函数都收 `win` 参数，
 * 所以两种形态在任一平台上都能锁住；POSIX 一侧逐字不变（集成用例 cancel-grace-unverifiable 另有逐字断言，只在 POSIX 跑）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IS_WIN } from '../helpers/platform.js';
import { manualCancelWayOut, manualKillWayOut, startTimeUnavailableCause } from '../../src/trivium/run-protocol.js';

const PID = 4321;
const RUN = '20261027T000000Z';

test('W1 POSIX 形态逐字不变：ps 查命令行、按组 kill -TERM / kill -KILL', () => {
  assert.equal(
    manualCancelWayOut(PID, RUN, false),
    `一直取不到时：先在终端确认 ${PID} 的命令行含 review --worker ${RUN}` +
      `（ps -p ${PID} -o command=），确认是它、要结束这一轮，就在终端按组结束它（kill -TERM -${PID}），` +
      '之后再跑一次 --cancel，会按「已不存在」回收锁与闸门、按记录结束审查员 CLI',
  );
  const kill = manualKillWayOut(PID, RUN, false);
  assert.ok(kill.includes(`kill -KILL -${PID}`) && !kill.includes('kill -TERM'), kill);
  assert.ok(kill.includes('SIGTERM 已经发过'), kill);
  assert.equal(startTimeUnavailableCause(false), 'ps 未返回');
});

test('W2 win32 形态：Get-CimInstance 查命令行、taskkill /T /F 结束进程树，不出现任何 POSIX 命令', () => {
  for (const msg of [manualCancelWayOut(PID, RUN, true), manualKillWayOut(PID, RUN, true)]) {
    assert.ok(msg.includes(`Get-CimInstance Win32_Process -Filter "ProcessId=${PID}"`), msg);
    assert.ok(msg.includes(`taskkill /PID ${PID} /T /F`), msg);
    assert.ok(msg.includes(`review --worker ${RUN}`), msg);
    assert.ok(msg.includes('之后再跑一次 --cancel'), msg);
    assert.doesNotMatch(msg, /\bps -p\b|\bkill -(TERM|KILL)\b|SIGTERM/, msg);
  }
  assert.ok(manualKillWayOut(PID, RUN, true).includes('关闭请求已经发过'), '发过信号那一格要说清已经发过关闭请求');
  assert.equal(startTimeUnavailableCause(true), '进程枚举未返回');
});

test('W3 缺省按当前平台取形态', () => {
  assert.equal(manualCancelWayOut(PID, RUN), manualCancelWayOut(PID, RUN, IS_WIN));
  assert.equal(manualKillWayOut(PID, RUN), manualKillWayOut(PID, RUN, IS_WIN));
  assert.equal(startTimeUnavailableCause(), startTimeUnavailableCause(IS_WIN));
});
