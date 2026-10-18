// M12 批次 5 照搬自 evidence/m12-batch4-20261018/（逐字相同，只改本行）。
// M12 批次 1 变体：集成套件调的是打包产物（test/helpers/fixture.ts 的 BUNDLE），--tests-only 不重打 bundle，
// 变异进不了被测产物。这里改为 --with-tests 同时重打 bundle 与测试产物；其余与原脚本逐字相同。
// 逐条变异、带超时跑期望套件，存下**失败用例名与首行断言文案**（变异装置只记 fail 数、且不给套件加超时）。
// 照搬 evidence/cancel-cli-reach-20260928/mutation-names.mjs 的形态，另加 --test-timeout：
// 首轮装置跑到 M4 时 U12① 的等待没有超时、挂死一小时被强制终止（报告 §3），这里先逐条确认不挂。
// 逐条：备份 → 变异（find 须唯一）→ 只重建测试产物 → 跑期望套件 → 恢复并逐字节核对；收尾重建一次。
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
