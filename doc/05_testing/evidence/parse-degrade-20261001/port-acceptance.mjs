// 新用例移植进改前构建（计划 r2 §5.3）：新行为格必须红、〔回归〕格必须绿。
// 改前构建 = git archive d418ce7 导出到 scratchpad（node_modules 软链工作树），只叠加本主题的测试文件，
// 用它自己的 scripts/build.mjs --with-tests 构建，再逐套件跑、按用例名分类。
// 用法（在仓库根）：node port-acceptance.mjs 〈改前构建根〉 〈输出 JSON〉
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = path.resolve(process.argv[2]);
const OUT = process.argv[3];
if (!BASE || !OUT) throw new Error('用法：node port-acceptance.mjs 〈改前构建根〉 〈输出 JSON〉');
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const baseHead = execFileSync('git', ['-C', process.cwd(), 'rev-parse', 'd418ce7'], { encoding: 'utf8' }).trim();
// 前提：改前构建的 src 与 d418ce7 逐字节相同（只叠加测试文件，不碰 src）
for (const f of ['src/trivium/parse.ts', 'src/trivium/gate.ts', 'src/trivium/review.ts', 'src/trivium/render.ts', 'src/trivium/brief.ts']) {
  const orig = execFileSync('git', ['show', `d418ce7:${f}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (fs.readFileSync(path.join(BASE, f), 'utf8') !== orig) throw new Error(`改前构建的 ${f} 与 d418ce7 不同`);
}

// 叠加的测试文件：四份新文件 + 两份改过的既有文件
const PORTED = [
  'test/unit/parse-degrade.test.ts',
  'test/unit/gate-degrade.test.ts',
  'test/unit/render-degrade.test.ts',
  'test/unit/brief-output-contract.test.ts',
  'test/unit/parse.test.ts',
  'test/integration/fault-injection.test.ts',
];
for (const f of PORTED) fs.copyFileSync(f, path.join(BASE, f));
execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { cwd: BASE, stdio: 'ignore' });
const bundle = path.join(BASE, 'skills/dual-critic/scripts/trivium.cjs');
const newBundle = path.join(process.cwd(), 'skills/dual-critic/scripts/trivium.cjs');

// 逐套件：期望红的格。parse.test.ts 只有两格是按新语义改写的；fault-injection 只跑 I1 / I2
const SUITES = [
  { suite: 'dist/test/test/unit/parse-degrade.test.js' },
  { suite: 'dist/test/test/unit/gate-degrade.test.js' },
  { suite: 'dist/test/test/unit/render-degrade.test.js' },
  { suite: 'dist/test/test/unit/brief-output-contract.test.js' },
  { suite: 'dist/test/test/unit/parse.test.js', red: ['意见缺必填字段 ⇒ 这一条逐条降级（原编号保留、点名缺的字段），不再整份回退', 'severity / confidence 取值受枚举约束：表外值让这一条降级，不做语义映射'] },
  { suite: 'dist/test/test/integration/fault-injection.test.js', pattern: '^I[12] ' },
];

const rows = [];
for (const s of SUITES) {
  const args = ['--test', '--test-reporter=spec', '--test-timeout=120000', ...(s.pattern ? ['--test-name-pattern', s.pattern] : []), s.suite];
  const r = spawnSync(process.execPath, args, { cwd: BASE, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 900_000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const body = out.split('✖ failing tests:')[0];
  const pass = [...body.matchAll(/^✔ (.+?) \(\d/gm)].map((m) => m[1]);
  const fail = [...body.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]);
  for (const name of [...pass, ...fail]) {
    const got = pass.includes(name) ? 'green' : 'red';
    const want = s.red ? (s.red.includes(name) ? 'red' : 'green') : name.includes('〔回归〕') ? 'green' : 'red';
    rows.push({ suite: s.suite, name, want, got, ok: want === got });
  }
  if (s.red) for (const n of s.red) if (![...pass, ...fail].includes(n)) rows.push({ suite: s.suite, name: n, want: 'red', got: 'missing', ok: false });
}
const summary = {
  base: BASE, base_commit: baseHead,
  bundle_sha256_old: sha(bundle), bundle_sha256_new: fs.existsSync(newBundle) ? sha(newBundle) : null,
  total: rows.length, ok: rows.filter((x) => x.ok).length,
  red_expected: rows.filter((x) => x.want === 'red').length, green_expected: rows.filter((x) => x.want === 'green').length,
  mismatches: rows.filter((x) => !x.ok),
};
if (summary.bundle_sha256_old === summary.bundle_sha256_new) throw new Error('新旧 bundle 哈希相同：改前构建没导对');
fs.writeFileSync(OUT, JSON.stringify({ ...summary, rows }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 1));
process.exitCode = summary.mismatches.length === 0 ? 0 : 1;
