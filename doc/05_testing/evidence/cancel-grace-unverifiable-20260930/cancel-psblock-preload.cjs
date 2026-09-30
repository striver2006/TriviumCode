/**
 * 跨进程验收的 `--cancel` 侧预载桩（取消宽限期判不了仍放锁，EV-176，计划 r2 §5.2；改自 EV-175 的 `psblock-preload.cjs`）。
 * 以 `NODE_OPTIONS=--require 〈本文件〉` 注入 `--cancel` 那个 CLI 进程：
 *   - ps 桩：只拦 `/bin/ps -p 〈TRIVIUM_EV176_TARGET_PID〉`（别的 pid 与 `ps -axo` 照常），改派不存在的可执行文件（派生失败）；
 *     何时开始拦：`TRIVIUM_EV176_PS=after1` 放过第 1 次（入口判定）之后拦；`onTerm` / `onKill` 观察到本进程向目标组发 SIGTERM /
 *     SIGKILL 之后拦；不设或 `off` 不拦；
 *   - `process.kill` 包装：记下发给目标 pid / 组的每个非 0 信号；`TRIVIUM_EV176_DROP_KILL=1` 时把 SIGKILL 记下而不投递。
 * esbuild 的 CJS 产物在调用时经 `(0, import_node_child_process.spawn)(…)` 取属性，与这里改的是同一个模块对象，改属性即生效；
 * `process.kill` 是全局对象上的方法，同理。进程退出时把放过 / 拦下次数与信号序列追加到 TRIVIUM_EV176_LOG（自证用）。
 */
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');

const target = Number(process.env.TRIVIUM_EV176_TARGET_PID || 0);
const mode = process.env.TRIVIUM_EV176_PS || 'off';
const dropKill = process.env.TRIVIUM_EV176_DROP_KILL === '1';
const log = process.env.TRIVIUM_EV176_LOG;
const st = { armed: false, allowed: 0, blocked: 0, signals: [] };

const origSpawn = cp.spawn;
cp.spawn = function (bin, args, opts) {
  if (target > 1 && mode !== 'off' && bin === '/bin/ps' && Array.isArray(args)) {
    const i = args.indexOf('-p');
    if (i >= 0 && Number(args[i + 1]) === target) {
      if (mode === 'after1' && !st.armed && st.allowed >= 1) st.armed = true;
      if (st.armed) {
        st.blocked++;
        return origSpawn.call(this, '/nonexistent/trivium-ev176-preload-ps', args, opts);
      }
      st.allowed++;
    }
  }
  return origSpawn.apply(this, arguments);
};

const origKill = process.kill.bind(process);
process.kill = function (pid, sig) {
  if (target > 1 && (pid === target || pid === -target) && sig !== 0 && sig !== undefined) {
    st.signals.push(String(sig));
    if (sig === 'SIGTERM' && mode === 'onTerm') st.armed = true;
    if (sig === 'SIGKILL' && mode === 'onKill') st.armed = true;
    if (sig === 'SIGKILL' && dropKill) return true;
  }
  return origKill(pid, sig);
};

process.on('exit', () => {
  if (log) fs.appendFileSync(log, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2, 5), ...st }) + '\n');
});
