// 「claude探针两臂同源」（EV-46、EV-47，本批未走双审）原样沿用 evidence/reclaimed-lock-settle-20261006/mutation-names.mjs（下为原文）。
// 「回收遗留锁收尾旧运行」（EV-151，本批未走双审）原样沿用 evidence/lost-cancel-exit-code-20261006/mutation-names.mjs（下为原文）。
// 「失联取消未确认退69」（EV-177 ②，本批未走双审）原样沿用 evidence/run-meta-read-cause-20261006/mutation-names.mjs（下为原文）。
// 「留痕读不出的成因」（EV-04，本批未走双审）原样沿用 evidence/lost-cancel-unverifiable-20261006/mutation-names.mjs（下为原文）。
// 「失联取消判不了不升级」（EV-177 ①，本批未走双审）原样沿用 evidence/cancel-grace-ready-20261005/mutation-names.mjs（下为原文）。
// 「cancel-grace 夹具等就绪」（EV-217，本批未走双审）原样沿用 evidence/type-comment-truth-20261005/mutation-names.mjs（下为原文）。
// 「类型与注释失实收口」（EV-59 + EV-70）原样沿用 evidence/codex-header-poll-20261005/mutation-names.mjs（下为原文）。
// 「header探测计时器收尾」（EV-205）原样沿用 evidence/goal-fallback-plan-final-20261005/mutation-names.mjs（下为原文）。
// 「目标回退取计划定稿」（EV-212）原样沿用 evidence/plan-final-recheck-20261005/mutation-names.mjs（下为原文）。
// 「计划定稿复核」（EV-215）原样沿用 evidence/plan-final-required-20261005/mutation-names.mjs（下为原文）。
// 「计划定稿强制产出」（EV-214）原样沿用 evidence/task-goal-fulltext-20261005/mutation-names.mjs（下为原文）。
// 「任务目标全文送审」（EV-210）原样沿用 evidence/fixture-repo-init-20261005/mutation-names.mjs（下为原文）。
// 「建仓步骤失败显式化」（EV-209）原样沿用 evidence/test-scratch-cleanup-20261004/mutation-names.mjs（下为原文）。
// 「单测临时目录收尾」（EV-208）原样沿用 evidence/fixture-runs-cleanup-20261004/mutation-names.mjs（下为原文）。
// 「夹具运行目录收尾」（EV-207）原样沿用 evidence/temp-index-cleanup-20261004/mutation-names.mjs（下为原文）。
// 「临时索引与清扫删除收尾」（EV-204）原样沿用 evidence/probe-fixture-cleanup-20261004/mutation-names.mjs（下为原文）。
// 「探针夹具删除收尾」（EV-199）原样沿用 evidence/auth-fingerprint-guard-20261004/mutation-names.mjs（下为原文）。
// 「探活指纹读盘兜底」（EV-202）原样沿用 evidence/codex-probe-cleanup-20261003/mutation-names.mjs（下为原文）。
// 「codex探活删除收尾」（EV-200）沿用 evidence/zcode-probe-arm-cleanup-20261003/mutation-names.mjs，唯一改动：
// 规格条目可带 `also`（套件数组），变异态下顺带跑这些套件、记进 `also` 结果——计划 r2 §3.2 的「亦红」观察；装置忽略该字段。
// 下面是原注释。
// 逐条变异、带超时跑期望套件，存下**失败用例名与首行断言文案**（变异装置只记 fail 数、且不给套件加超时）。
// 逐条：备份 → 变异（find 须唯一）→ 重建（含 bundle）→ 跑期望套件 → 恢复并逐字节核对；收尾重建一次。
// 用法（在仓库根，变异装置与全量检查都不在跑）：node mutation-names.mjs <规格路径> [输出 JSON 路径]
//
// **哨兵**（代码双审 r1 CODEX-04）：恢复靠 try/finally，进程被信号强制终止时 finally 不执行，src/ 会停在变异态。
// 开跑落 .mutation-names-running（内容 = 各目标文件变异前的 sha256），正常收尾删除；开跑时发现它还在就拒跑。
// 被强杀后的处置：按哨兵里的哈希逐个核对目标文件（不符的用 git 或本仓备份恢复到该哈希），核对一致后再删哨兵重跑。
// 输出 JSON 同时带目标文件的 sha256，供事后对账。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3] ?? null;
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const build = () => execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { stdio: 'ignore' });
const runSuite = (suite) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=60000', suite], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900_000,
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const body = out.split('✖ failing tests:')[0];
  const red = [...new Set([...body.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
  const msgs = [...body.matchAll(/^✖ .+?\(\d[^\n]*\n(?:[^\n]*\n){0,3}?\s*([^\n]*Error[^\n]*)/gm)].map((m) => m[1].trim().slice(0, 200));
  return {
    fail: Number(/ℹ fail (\d+)/.exec(out)?.[1] ?? (r.status === 0 ? 0 : -1)),
    timed_out: r.error?.code === 'ETIMEDOUT',
    cancelled: Number(/ℹ cancelled (\d+)/.exec(out)?.[1] ?? 0),
    red,
    firstLines: [...new Set(msgs)].slice(0, 8),
    elapsed_s: Math.round((Date.now() - t0) / 1000),
  };
};

const SENTINEL = '.mutation-names-running';
if (fs.existsSync(SENTINEL)) {
  console.error(`哨兵 ${SENTINEL} 还在：上一次运行没有正常收尾，src/ 可能停在变异态。按哨兵里的 sha256 逐个核对恢复后再删哨兵重跑。`);
  process.exit(3);
}
const base = Object.fromEntries(spec.targets.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const baseHash = Object.fromEntries(spec.targets.map((f) => [f, sha(f)]));
fs.writeFileSync(SENTINEL, JSON.stringify(Object.fromEntries(spec.targets.map((f) => [f, sha(f)])), null, 2) + '\n');
const results = [];
try {
  for (const c of spec.cases) {
    const src = base[c.file];
    if (src.split(c.find).length - 1 !== 1) throw new Error(`${c.id} 的 find 不唯一`);
    fs.writeFileSync(c.file, src.replace(c.find, c.replace));
    try {
      build();
      const r = runSuite(c.expect);
      const also = (c.also ?? []).map((s) => ({ suite: s, ...runSuite(s) }));
      results.push({ id: c.id, desc: c.desc, suite: c.expect, ...r, also });
      console.error(`${c.id}：fail=${r.fail} cancelled=${r.cancelled} ${r.elapsed_s}s ⇒ ${r.red.join(' ｜ ')}`);
      for (const a of also) console.error(`  亦跑 ${a.suite}：fail=${a.fail} ⇒ ${a.red.join(' ｜ ')}`);
    } finally {
      fs.writeFileSync(c.file, src);
      if (sha(c.file) !== baseHash[c.file]) throw new Error(`恢复 ${c.file} 后哈希不符，停下人工处理`);
    }
  }
} finally {
  for (const f of spec.targets) if (sha(f) !== baseHash[f]) fs.writeFileSync(f, base[f]);
  build();
}
for (const f of spec.targets) if (sha(f) !== baseHash[f]) throw new Error(`收尾后 ${f} 与变异前哈希不符，哨兵保留，停下人工处理`);
fs.rmSync(SENTINEL);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ targets_sha256: baseHash, results }, null, 2) + '\n');
