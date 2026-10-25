// EV-256 零配额验收的判读半边：读 accept-run.mjs 的六份输出，逐条断言并打印结论（不打印任何值）。
// A-1 未开启：基线与新构建四组调用的 argv、环境、干扰键逐条相等（零变化）。
// A-1 开启：基线 argv 含网关值（复现缺陷）；新构建 argv 不含、环境里前缀键恰为预期四键且值相等；
//          新构建 argv 恰等于「基线 argv 去掉 --settings 里的 env 段（去完为空则连 --settings 一并去掉）」。
// A-2：基线进程表采到网关值，新构建零命中，且两边都确实采到了子进程（采样有效）。
// 另记两棵树被测模块的 sha256，断言不同（对拍的是两份不同的产物）。
// 用法（仓库根）：node accept-readout.mjs 〈基线树根〉
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const E = 'doc/05_testing/evidence/gateway-env-injection-20261025';
const baseTree = process.argv[2];
const read = (n) => JSON.parse(fs.readFileSync(`${E}/${n}.json`, 'utf8'));
const EXPECTED = { ANTHROPIC_BASE_URL: 'https://gw-ev256.invalid/api', ANTHROPIC_AUTH_TOKEN: 'gw-ev256-auth-01',
  ANTHROPIC_MODEL: 'gw-ev256-model-01', CLAUDE_CODE_SUBAGENT_MODEL: 'gw-ev256-sub-01' };
const VALUES = [...Object.values(EXPECTED), 'gw-ev256-extra-01'];
const leaks = (argv) => argv.some((a) => VALUES.some((v) => a.includes(v)));
const out = {};

// 被测产物确实不同
const sha = (root) => Object.fromEntries(['adapters/claude.js', 'adapters/claude-route.js', 'probes/claude.js'].map((p) =>
  [p, createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/test/src/trivium', p))).digest('hex')]));
out.sha256 = { base: sha(baseTree), new: sha('.') };
for (const p of Object.keys(out.sha256.base)) assert.notEqual(out.sha256.base[p], out.sha256.new[p], `${p} 两棵树相同`);

// A-1 未开启：逐条相等
const bOff = read('accept-base-off'), nOff = read('accept-new-off');
assert.deepEqual(nOff.groups, bOff.groups, '未开启时新旧构建的 argv / 环境须逐条相等');
out.off = Object.fromEntries(Object.entries(nOff.groups).map(([k, v]) => [k, { calls: v.length, identical: true,
  envEmpty: v.every((r) => Object.keys(r.env).length === 0) }]));
for (const g of Object.values(out.off)) assert.ok(g.envEmpty, '未开启时环境里不得有前缀键');

// A-1 开启
const bOn = read('accept-base-on'), nOn = read('accept-new-on');
const stripEnv = (argv) => {
  const i = argv.indexOf('--settings');
  if (i < 0) return argv;
  const { env: _env, ...rest } = JSON.parse(argv[i + 1]);
  return Object.keys(rest).length ? [...argv.slice(0, i + 1), JSON.stringify(rest), ...argv.slice(i + 2)]
    : [...argv.slice(0, i), ...argv.slice(i + 2)];
};
const isModelCall = (r) => !r.argv.includes('--version') && !r.argv.includes('--help');
out.on = {};
for (const k of Object.keys(nOn.groups)) {
  const b = bOn.groups[k], n = nOn.groups[k];
  assert.equal(n.length, b.length, `${k}：调用次数不同`);
  const bm = b.filter(isModelCall), nm = n.filter(isModelCall);
  const row = { calls: n.length, modelCalls: nm.length,
    baseArgvLeak: bm.filter((r) => leaks(r.argv)).length, newArgvLeak: nm.filter((r) => leaks(r.argv)).length,
    newEnvExact: nm.every((r) => JSON.stringify(Object.keys(r.env).sort()) === JSON.stringify(Object.keys(EXPECTED).sort()) &&
      Object.entries(EXPECTED).every(([key, v]) => r.env[key] === v) && r.extra === false),
    baseEnvEmpty: bm.every((r) => Object.keys(r.env).length === 0),
    argvOnlyLostEnv: n.every((r, i) => JSON.stringify(r.argv) === JSON.stringify(stripEnv(b[i].argv))) };
  out.on[k] = row;
  assert.equal(row.baseArgvLeak, row.modelCalls, `${k}：基线每次模型调用的 argv 都应含网关值（复现缺陷）`);
  assert.equal(row.newArgvLeak, 0, `${k}：新构建 argv 不得含网关值`);
  assert.ok(row.newEnvExact, `${k}：新构建环境里的前缀键须恰为预期四键`);
  assert.ok(row.baseEnvEmpty, `${k}：基线不经环境注入`);
  assert.ok(row.argvOnlyLostEnv, `${k}：新旧 argv 的差别须恰为去掉 --settings 的 env 段`);
}

// A-2 进程表
const bPs = read('accept-base-on-ps').ps, nPs = read('accept-new-on-ps').ps;
out.ps = { base: bPs, new: nPs };
assert.ok(bPs.lines > 0 && nPs.lines > 0, '两边都须采到子进程命令行（采样有效）');
assert.ok(bPs.leakLines > 0, '基线进程表应能看到网关值（证明采样方法有效）');
assert.equal(nPs.leakLines, 0, '新构建进程表不得出现网关值');

console.log(JSON.stringify(out, null, 2));
console.log('A-1 / A-2 全部断言通过');
