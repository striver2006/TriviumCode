/**
 * 跨进程验收的工作进程侧预载桩（取消宽限期判不了仍放锁，EV-176，计划 r2 §5.2）：以 `NODE_OPTIONS=--require 〈本文件〉` 注入
 * `review --start`，经环境继承到它派生的工作进程。**只在 argv 含 `--worker` 的进程里生效**（`--start` 自己与桩审查员 CLI 不受影响）：
 * 把之后注册的 SIGTERM 监听器包一层，收到 SIGTERM 时延后 `TRIVIUM_EV176_WORKER_TERM_DELAY_MS` 毫秒才调用原监听器——
 * 造出「对 SIGTERM 延迟数秒才退出」（宽限期形态）或「实际上不响应 SIGTERM」（延迟取极大值，SIGKILL 形态）的真实工作进程。
 * `removeListener` / `off` 按原监听器找回包装，工作进程收尾时的移除照常生效。生效时往 TRIVIUM_EV176_WORKER_LOG 追加一行（自证用）。
 */
'use strict';
const fs = require('node:fs');

const delay = Number(process.env.TRIVIUM_EV176_WORKER_TERM_DELAY_MS || 0);
if (delay > 0 && process.argv.includes('--worker')) {
  const wrapped = new Map();
  const wrap = (fn) => {
    const w = function (...a) {
      setTimeout(() => fn.apply(this, a), Math.min(delay, 2 ** 31 - 1));
    };
    wrapped.set(fn, w);
    return w;
  };
  const origOn = process.on.bind(process);
  const origOnce = process.once.bind(process);
  const origRemove = process.removeListener.bind(process);
  process.on = process.addListener = function (ev, fn) {
    return ev === 'SIGTERM' ? origOn(ev, wrap(fn)) : origOn(ev, fn);
  };
  process.once = function (ev, fn) {
    return ev === 'SIGTERM' ? origOnce(ev, wrap(fn)) : origOnce(ev, fn);
  };
  process.removeListener = process.off = function (ev, fn) {
    return origRemove(ev, (ev === 'SIGTERM' && wrapped.get(fn)) || fn);
  };
  const log = process.env.TRIVIUM_EV176_WORKER_LOG;
  if (log) fs.appendFileSync(log, JSON.stringify({ pid: process.pid, delay, argv: process.argv.slice(2, 5) }) + '\n');
}
