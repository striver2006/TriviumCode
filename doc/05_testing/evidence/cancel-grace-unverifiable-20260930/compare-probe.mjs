#!/usr/bin/env node
/**
 * 探针新旧对照（取消宽限期判不了仍放锁，EV-176，计划 r2 §5.2，GLM-04）：同一份十格 `probe-cancel-grace.mjs` 在改前
 * （`d1e6408`）与改后两份构建上各跑一次，这里做硬断言并出对照表。
 *
 * 硬断言：
 *   1. 两份的格集合相同（十格）、构建指纹不同（run-protocol.js / exec.js 的 sha 前 16 位）；
 *   2. 每格拦截点命中：装了 ps 桩的格 ps 拦下次数 > 0；不装桩的格记到信号 > 0；夹具启动时刻都取到；收尾清场成功；
 *   3. 对照格（K2、C0）新旧结局逐项相同（退出、信号序列、status / 锁 / 闸门 / 载体 / 归档 / 登记）；
 *   4. 改后按计划 r2 的处置：未确认格（Z1、G2、G2-timeout、K1、K4、K4-timeout）抛 69、status running、锁在、闸门 running、
 *      载体在、归档与登记 running；确认格（G1、G3、K2、C0）退 0 且收尾完整；Z1 零信号且 stderr 不含「发送 SIGTERM」；
 *      G2 类无 SIGKILL；带 CLI 记录的未确认格 CLI 返回时已不在（被按记录结束）。
 *
 * 用法：node compare-probe.mjs 〈改前读数〉 〈改后读数〉 [输出 JSON]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [preP, postP, outP] = process.argv.slice(2);
const pre = JSON.parse(readFileSync(preP, 'utf8'));
const post = JSON.parse(readFileSync(postP, 'utf8'));
const fails = [];
const check = (ok, what) => {
  if (!ok) fails.push(what);
};

const ids = (r) => r.results.map((c) => c.id);
check(JSON.stringify(ids(pre)) === JSON.stringify(ids(post)), `格集合不同：${ids(pre)} / ${ids(post)}`);
check(ids(post).length === 10, `应为十格：${ids(post).length}`);
check(pre.run_protocol_js_sha16 !== post.run_protocol_js_sha16, 'run-protocol.js 指纹应不同');
check(pre.exec_js_sha16 !== post.exec_js_sha16, 'exec.js 指纹应不同');

const exitOf = (c) => (c.io.ok ? c.io.exitCode : (c.io.error.code ?? 'throw'));
const sig = (c) => ({
  exit: exitOf(c), signals: c.signals.join(','), ...c.after,
});
for (const side of [['改前', pre], ['改后', post]]) {
  for (const c of side[1].results) {
    const tag = `${side[0]} ${c.id}`;
    check(c.recorded.legacy && c.recorded.canonical, `${tag}：夹具启动时刻没取到`);
    if (c.recorded.cli_started_at !== null) check(c.recorded.cli_started_at, `${tag}：CLI 启动时刻没取到`);
    if (c.ps_block_form) check(c.ps.blocked > 0, `${tag}：ps 桩没拦到`);
    else check(c.signals.length > 0, `${tag}：没记到信号`);
    check(c.cleaned, `${tag}：收尾清场失败`);
  }
}
for (const id of ['K2', 'C0']) {
  const a = pre.results.find((c) => c.id === id);
  const b = post.results.find((c) => c.id === id);
  check(JSON.stringify(sig(a)) === JSON.stringify(sig(b)), `对照格 ${id} 新旧结局不同：${JSON.stringify(sig(a))} / ${JSON.stringify(sig(b))}`);
}

const UNTOUCHED = { status_phase: 'running', lock_present: true, gate: 'running', carrier_present: true, archive_run_status: 'running', task_entry_status: 'running' };
const FINALIZED = { status_phase: 'cancelled', lock_present: false, gate: 'idle', carrier_present: false, archive_run_status: 'cancelled', task_entry_status: 'cancelled' };
const pick = (a) => Object.fromEntries(Object.keys(UNTOUCHED).map((k) => [k, a[k]]));
for (const c of post.results) {
  const tag = `改后 ${c.id}`;
  if (['Z1', 'G2', 'G2-timeout', 'K1', 'K4', 'K4-timeout'].includes(c.id)) {
    check(exitOf(c) === 69, `${tag}：应抛 69，实为 ${exitOf(c)}`);
    check(JSON.stringify(pick(c.after)) === JSON.stringify(UNTOUCHED), `${tag}：应什么收尾都不做：${JSON.stringify(pick(c.after))}`);
    check(c.io.out === '', `${tag}：stdout 应为空`);
    check(c.worker_alive_at_return === true, `${tag}：工作进程返回时应仍活着`);
    if (c.cli_alive_at_return !== null && c.id !== 'Z1') check(c.cli_alive_at_return === false, `${tag}：CLI 应已被按记录结束`);
  } else {
    check(exitOf(c) === 0, `${tag}：应退 0，实为 ${exitOf(c)}`);
    check(JSON.stringify(pick(c.after)) === JSON.stringify(FINALIZED), `${tag}：应收尾完整：${JSON.stringify(pick(c.after))}`);
  }
  if (c.id === 'Z1') {
    check(c.signals.length === 0, `${tag}：应零信号`);
    check(!c.io.out.includes('发送 SIGTERM') && !c.io.err.includes('发送 SIGTERM'), `${tag}：没发就不能说发了`);
  }
  if (c.id.startsWith('G2')) check(!c.signals.some((s) => s.startsWith('SIGKILL')), `${tag}：不应升级 SIGKILL`);
}

const yn = (b) => (b === null ? '—' : b ? '在' : '不在');
const row = (c) => {
  const a = c.after;
  return `${exitOf(c)} ｜ ${c.signals.join('、') || '无'} ｜ ${a.status_phase} ｜ 锁${yn(a.lock_present)} ｜ ${a.gate} ｜ 载体${yn(a.carrier_present)} ｜ ${a.archive_run_status}/${a.task_entry_status} ｜ worker ${yn(c.worker_alive_at_return)} ｜ CLI ${yn(c.cli_alive_at_return)} ｜ ${c.ms} ms ｜ 再拿锁 ${typeof c.next_acquire === 'string' ? '拿到' : `抛 ${c.next_acquire.error?.code}`}`;
};
const table = post.results.map((b) => {
  const a = pre.results.find((c) => c.id === b.id);
  return { id: b.id, pre: row(a), post: row(b) };
});
const readout = {
  at: new Date().toISOString(), pre: { root: pre.root, sha: pre.run_protocol_js_sha16, exec: pre.exec_js_sha16 },
  post: { root: post.root, sha: post.run_protocol_js_sha16, exec: post.exec_js_sha16 },
  hard_assertions_failed: fails, table,
};
if (outP) writeFileSync(outP, JSON.stringify(readout, null, 2) + '\n');
for (const r of table) console.log(`${r.id}\n  改前：${r.pre}\n  改后：${r.post}`);
console.log(fails.length === 0 ? '硬断言全过' : `硬断言失败 ${fails.length} 条：\n- ${fails.join('\n- ')}`);
process.exitCode = fails.length === 0 ? 0 : 1;
