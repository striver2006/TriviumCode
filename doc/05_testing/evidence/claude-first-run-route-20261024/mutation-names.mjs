// 逐条变异预跑（EV-254）：照搬 evidence/preflight-recalibrate-20261022/mutation-names-bundle.mjs，
// 另加一处：case 可以给 `edits: [{ file, find, replace }]` 同时改多个文件（M4 候选 B 要同时动探针与 doctor，
// 正式装置 scripts/mutation-check.mjs 一条只认一个文件）。单文件 case 仍写 file/find/replace。
// 逐条：备份 → 变异（每处 find 须唯一）→ 重建（--with-tests）→ 跑期望套件（带 --test-timeout）→ 恢复并逐字节核对；收尾重建一次。
// 存下失败用例名与首行断言文案（正式装置只记 fail 数）。
// 用法（在仓库根，变异装置与全量检查都不在跑）：
//   node doc/05_testing/evidence/claude-first-run-route-20261024/mutation-names.mjs 〈规格路径〉 [输出 JSON 路径]
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
  // spec 报告器把断言详情放在「failing tests」段之后：按用例名配对其后第一行带 Error 的文案
  const tail = out.split('✖ failing tests:')[1] ?? '';
  const firstLines = [...tail.matchAll(/^\s*✖ (.+?) \(\d[^\n]*\n(?:[^\n]*\n){0,3}?\s*([^\n]*Error[^\n]*)/gm)]
    .map((m) => `${m[1].split('：')[0]} ⇒ ${m[2].trim().slice(0, 200)}`);
  return {
    fail: Number(/ℹ fail (\d+)/.exec(out)?.[1] ?? (r.status === 0 ? 0 : -1)),
    timed_out: r.error?.code === 'ETIMEDOUT',
    cancelled: Number(/ℹ cancelled (\d+)/.exec(out)?.[1] ?? 0),
    red,
    firstLines,
    elapsed_s: Math.round((Date.now() - t0) / 1000),
  };
};

const editsOf = (c) => c.edits ?? [{ file: c.file, find: c.find, replace: c.replace }];
const base = Object.fromEntries(spec.targets.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const baseHash = Object.fromEntries(spec.targets.map((f) => [f, sha(f)]));
const results = [];
try {
  for (const c of spec.cases) {
    const edits = editsOf(c);
    for (const e of edits) {
      if (!(e.file in base)) throw new Error(`${c.id} 的 ${e.file} 不在 targets 里`);
      if (base[e.file].split(e.find).length - 1 !== 1) throw new Error(`${c.id} 在 ${e.file} 的 find 不唯一`);
    }
    try {
      for (const e of edits) fs.writeFileSync(e.file, base[e.file].replace(e.find, e.replace));
      build();
      const r = runSuite(c.expect);
      results.push({ id: c.id, desc: c.desc, suite: c.expect, ...r });
      console.error(`${c.id}：fail=${r.fail} cancelled=${r.cancelled} ${r.elapsed_s}s ⇒ ${r.red.join(' ｜ ')}`);
    } finally {
      for (const e of edits) {
        fs.writeFileSync(e.file, base[e.file]);
        if (sha(e.file) !== baseHash[e.file]) throw new Error(`恢复 ${e.file} 后哈希不符，停下人工处理`);
      }
    }
  }
} finally {
  for (const f of spec.targets) if (sha(f) !== baseHash[f]) fs.writeFileSync(f, base[f]);
  build();
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
