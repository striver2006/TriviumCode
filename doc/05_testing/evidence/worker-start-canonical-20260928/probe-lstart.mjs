#!/usr/bin/env node
// 零配额实测（worker启动时刻规范化 计划 §2）：同一进程在不同 TZ / 区域设置下的 ps lstart，缺省形态与规范化形态各取一次。
// 用法：node probe-lstart.mjs
import { execFileSync, spawn } from 'node:child_process';

const child = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' });
const pid = child.pid;
const envs = [
  ['缺省（本会话）', {}],
  ['TZ=UTC', { TZ: 'UTC' }],
  ['TZ=Asia/Tokyo', { TZ: 'Asia/Tokyo' }],
  ['TZ=America/New_York', { TZ: 'America/New_York' }],
  ['LC_ALL=fr_FR.UTF-8', { LC_ALL: 'fr_FR.UTF-8' }],
  ['LC_TIME=zh_CN.UTF-8', { LC_TIME: 'zh_CN.UTF-8' }],
  ['LANG=de_DE.UTF-8 TZ=Europe/Berlin', { LANG: 'de_DE.UTF-8', TZ: 'Europe/Berlin' }],
];
const ps = (env) => {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
  } catch (e) {
    return `ERR ${e.status}`;
  }
};
const rows = [];
for (const [label, env] of envs) {
  const legacy = ps(env);
  // 规范化：与 processStartTime(pid, { canonical: true }) 同形——调用方环境之上覆盖 LC_ALL=C、TZ=UTC0
  const canonical = ps({ ...env, LC_ALL: 'C', TZ: 'UTC0' });
  rows.push({ env: label, legacy, canonical });
}
const canon = new Set(rows.map((r) => r.canonical));
const legacySet = new Set(rows.map((r) => r.legacy));
console.log(JSON.stringify({
  node: process.version, platform: process.platform, pid, rows,
  distinct_legacy: legacySet.size, distinct_canonical: canon.size,
}, null, 2));
try { process.kill(-pid, 'SIGKILL'); } catch { /* 已不在 */ }
