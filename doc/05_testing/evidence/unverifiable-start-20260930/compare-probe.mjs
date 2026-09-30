#!/usr/bin/env node
/**
 * 探针新旧对照（取不到启动时刻当不在，计划 r2 §5.2，CODEX-03 的硬断言）：
 *   - 每份读数、每种模式格数 = 15；
 *   - psfail 模式下派生失败形态的格自证全过（超时形态不做自证，见探针注释）；
 *   - control 模式逐格签名新旧相同（改动只落在「活着而取不到」那一格）；
 *   - 打印 psfail 逐格签名（改前 / 改后）与 control 签名，供报告引用。
 * 签名只取结局事实，去掉 pid、时刻、耗时与人读文案。
 *
 * 用法：node compare-probe.mjs 〈改前 JSON〉 〈改后 JSON〉 [--out 〈JSON〉]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [preP, postP] = process.argv.slice(2);
const outI = process.argv.indexOf('--out');
const OUT = outI > 0 ? process.argv[outI + 1] : null;
const pre = JSON.parse(readFileSync(preP, 'utf8'));
const post = JSON.parse(readFileSync(postP, 'utf8'));

function sig(r) {
  const s = {};
  if (r.reading) s.reading = r.reading.kind + (r.reading.reason ? `/${r.reading.reason}` : '');
  if (r.workerConfirmedGone) {
    s.gone = r.workerConfirmedGone.gone;
    s.admit = r.scrubAdmission.admit;
  }
  if (r.io) {
    if (r.io.ok === false) s.threw = r.io.error?.code ?? 'error';
    else if ('exitCode' in r.io) s.exit = r.io.exitCode;
    for (const k of ['removed', 'kept', 'scrubbed', 'deferred', 'alive']) if (k in r.io) s[k] = r.io[k];
  }
  if (r.after) {
    const a = r.after;
    if (a.status) s.phase = a.status.phase + (a.status.lost ? `/${a.status.lost.reason}` : '');
    for (const k of ['carrier_present', 'run_dir_present', 'lock_present', 'gate']) if (k in a) s[k] = a[k];
  }
  if (r.next_acquire !== undefined) s.next = typeof r.next_acquire === 'string' ? r.next_acquire : `threw:${r.next_acquire.error?.code}`;
  s.worker_alive = r.worker_alive_after;
  if (r.cli_groups_alive_after?.length) s.cli_alive = r.cli_groups_alive_after.every(Boolean);
  if (r.probe_error) s.probe_error = true;
  return JSON.stringify(s);
}

const failures = [];
const byMode = (j, m) => j.results.filter((r) => r.mode === m);
for (const [name, j] of [['pre', pre], ['post', post]]) {
  for (const m of ['psfail', 'control']) {
    const n = byMode(j, m).length;
    if (n !== 15) failures.push(`${name} ${m} 格数 ${n} ≠ 15`);
  }
  for (const r of byMode(j, 'psfail')) {
    if (r.ps_block_form === 'fail' && !r.selfCheck?.ok) failures.push(`${name} ${r.id} 桩自证失败`);
    if (!(r.ps_blocked > 0)) failures.push(`${name} ${r.id} 没拦到 ps`);
    if (r.probe_error) failures.push(`${name} ${r.id} 探针出错`);
  }
}
const rows = [];
for (const r of byMode(pre, 'psfail')) {
  const q = byMode(post, 'psfail').find((x) => x.id === r.id);
  const c0 = byMode(pre, 'control').find((x) => x.id === r.id);
  const c1 = byMode(post, 'control').find((x) => x.id === r.id);
  if (!q || !c0 || !c1) {
    failures.push(`${r.id} 缺格`);
    continue;
  }
  if (sig(c0) !== sig(c1)) failures.push(`${r.id} 对照组新旧不同：${sig(c0)} ≠ ${sig(c1)}`);
  rows.push({
    id: r.id, pre_psfail: sig(r), post_psfail: sig(q), control: sig(c1),
    post_equals_control: sig(q) === sig(c1), pre_ms: r.ms ?? null, post_ms: q.ms ?? null,
  });
}
const summary = { pre: preP, post: postP, failures, rows };
if (OUT) writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');
for (const x of rows) {
  console.log(`${x.id}\n  改前 ${x.pre_psfail}\n  改后 ${x.post_psfail}\n  对照 ${x.control}${x.post_equals_control ? '  ← 改后 = 对照' : ''}${x.post_ms !== null ? `\n  耗时 改前 ${x.pre_ms} ms / 改后 ${x.post_ms} ms` : ''}`);
}
console.log(failures.length === 0 ? '硬断言全过' : `硬断言失败 ${failures.length} 条：\n  ${failures.join('\n  ')}`);
process.exitCode = failures.length === 0 ? 0 : 1;
