/**
 * 跨进程验收的 ps 预载桩（取不到启动时刻当不在，计划 r2 §5.2）：以 `NODE_OPTIONS=--require 〈本文件〉` 注入 CLI 进程，
 * 只让 `/bin/ps -p 〈TRIVIUM_EV175_BLOCK_PIDS 里的 pid〉` 派生失败，别的 pid 与 `ps -axo` 照常。
 * esbuild 的 CJS 产物在调用时经 `(0, import_node_child_process.spawn)(…)` 取属性，与这里改的是同一个模块对象，所以改属性即生效。
 * 进程退出时把被拦次数追加到 TRIVIUM_EV175_BLOCK_LOG（自证：验收断言 > 0，防桩空转）。
 */
'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');

const pids = new Set(
  (process.env.TRIVIUM_EV175_BLOCK_PIDS || '').split(',').filter(Boolean).map(Number),
);
const log = process.env.TRIVIUM_EV175_BLOCK_LOG;
let blocked = 0;
const orig = cp.spawn;
cp.spawn = function (bin, args, opts) {
  if (bin === '/bin/ps' && Array.isArray(args)) {
    const i = args.indexOf('-p');
    if (i >= 0 && pids.has(Number(args[i + 1]))) {
      blocked++;
      return orig.call(this, '/nonexistent/trivium-ev175-preload-ps', args, opts);
    }
  }
  return orig.apply(this, arguments);
};
process.on('exit', () => {
  if (log) fs.appendFileSync(log, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2, 5), blocked }) + '\n');
});
