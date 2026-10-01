// 逐条变异、带超时跑期望套件，存下**失败用例名与首行断言文案**（变异装置只记 fail 数、且不给套件加超时）。
// 照搬 evidence/lock-reclaim-enoent-20260930/mutation-names.mjs，**唯一改动：重建用 --with-tests 而不是 --tests-only**——
// 本主题 M7 / M8 的期望套件是经打包产物跨进程跑的集成用例（fault-injection），只重建测试产物不会让变异进 bundle，
// 预跑会假绿。正式装置的 build() 本来就是 --with-tests，这里与它对齐。
// 逐条：备份 → 变异（find 须唯一）→ 重建（含 bundle）→ 跑期望套件 → 恢复并逐字节核对；收尾重建一次。
// 用法（在仓库根，变异装置与全量检查都不在跑）：node mutation-names.mjs <规格路径> [输出 JSON 路径]
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

const base = Object.fromEntries(spec.targets.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const baseHash = Object.fromEntries(spec.targets.map((f) => [f, sha(f)]));
const results = [];
try {
  for (const c of spec.cases) {
    const src = base[c.file];
    if (src.split(c.find).length - 1 !== 1) throw new Error(`${c.id} 的 find 不唯一`);
    fs.writeFileSync(c.file, src.replace(c.find, c.replace));
    try {
      build();
      const r = runSuite(c.expect);
      results.push({ id: c.id, desc: c.desc, suite: c.expect, ...r });
      console.error(`${c.id}：fail=${r.fail} cancelled=${r.cancelled} ${r.elapsed_s}s ⇒ ${r.red.join(' ｜ ')}`);
    } finally {
      fs.writeFileSync(c.file, src);
      if (sha(c.file) !== baseHash[c.file]) throw new Error(`恢复 ${c.file} 后哈希不符，停下人工处理`);
    }
  }
} finally {
  for (const f of spec.targets) if (sha(f) !== baseHash[f]) fs.writeFileSync(f, base[f]);
  build();
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
