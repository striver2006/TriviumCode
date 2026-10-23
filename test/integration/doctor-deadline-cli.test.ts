/**
 * EV-251：经真实打包 CLI 的 `doctor --deadline-s` 与预检的自动校准字段（预检失败自动校准计划 r2；第三节 I1 / I5 / I7）。
 *
 * 零配额：agy 入口显式指向本测试写的假 agy（不显式给的话 doctor 会按候选表与 `which` 找到真实 CLI）；
 * HOME 与 TMPDIR 钉到夹具。真实进程带本次随机标记，`finally` 按组号兜底结束。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import YAML from 'yaml';
import { BUNDLE, ASSET_ROOT, cli, makeFixture, seedFakeProbes, bundleMissing, bundleSkipReason } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { groupsWithMark, killMarked } from '../helpers/proc.js';
import { emptyEntryScanHome } from '../helpers/entry-scan-home.js';
import { ENTRY_SCAN_HOME_ENV } from '../../src/trivium/entry-collisions.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { DOCTOR_RERUN_ENTRY } from '../../src/trivium/doctor.js';

const MARK = `trivium-i-dlcli-${process.pid}-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const skip = bundleMissing ? bundleSkipReason : false;

/** 与 doctor-deadline 单测同一个假 agy：模型调用按 FAKE_AGY_MODE 挂住或秒败 */
async function fakeAgy(dir: string): Promise<string> {
  const p = path.join(dir, 'agy-hang');
  await fs.writeFile(p, [
    `#!${process.execPath}`,
    "const a = process.argv.slice(2);",
    "if (a[0] === '--version') { console.log('agy 0.0.1'); process.exit(0); }",
    "if (a[0] === 'models') { console.log('gemini-3.8-flash-high'); process.exit(0); }",
    "if (process.env.FAKE_AGY_MODE === 'fail') { console.error('fake model failure'); process.exit(3); }",
    "require('child_process').spawn('/bin/sh', ['-c', 'trap \"\" TERM; sleep 600; : \"$0\"', process.env.FAKE_AGY_MARK], { stdio: 'ignore' });",
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'), { mode: 0o755 });
  return p;
}

/** 夹具：探针种子 + agy 入口显式指向假 agy；HOME / TMPDIR 各一份 */
async function project(topic: string) {
  const fx = await makeFixture({ topic });
  await seedFakeProbes(fx.root);
  const side = await scratchDir('trivium-dlcli-side-');
  for (const d of ['home', 'tmp', 'bin']) await fs.mkdir(path.join(side, d));
  const agy = await fakeAgy(path.join(side, 'bin'));
  const p = path.join(fx.root, '.trivium', 'config.local.yaml');
  const doc = (YAML.parse(await fs.readFile(p, 'utf8')) ?? {}) as Record<string, any>;
  doc['agents'] = { ...(doc['agents'] ?? {}), gemini: { vendor: 'antigravity', bin: agy, agent: 'trivium-critic' } };
  doc['runtime'] = { ...(doc['runtime'] ?? {}), run_root: fx.runRoot };
  await fs.writeFile(p, YAML.stringify(doc), 'utf8');
  return { fx, home: path.join(side, 'home'), tmp: path.join(side, 'tmp') };
}

test('I1 --deadline-s 越界或非整数退 64；不给时与原来一样不带 deadline 段', { skip }, async () => {
  const { fx } = await project('dlcli-i1');
  for (const bad of ['29', '901', '1.5', 'abc']) {
    const r = await cli(fx.root, ['doctor', '--only', 'env', '--no-model-calls', '--deadline-s', bad, '--json']);
    assert.equal(r.code, EXIT.USAGE, `${bad}: ${r.stderr}`);
    assert.match(r.stderr, /--deadline-s 只接受 30～900 的整数秒/);
  }
  const ok = await cli(fx.root, ['doctor', '--only', 'env', '--no-model-calls', '--json']);
  assert.ok(ok.code === EXIT.OK || ok.code === EXIT.ENV, ok.stderr);
  assert.equal((JSON.parse(ok.stdout) as { deadline?: unknown }).deadline, undefined);
  const withDl = await cli(fx.root, ['doctor', '--only', 'env', '--no-model-calls', '--deadline-s', '30', '--json']);
  const d = (JSON.parse(withDl.stdout) as { deadline: { hit: boolean; sections: unknown[] } }).deadline;
  assert.equal(d.hit, false);
  assert.deepEqual(d.sections, [], '--only env 不探任何一家');
});

test('I7 带时限运行中收到 SIGTERM：协作式收尾，退 76、reason=signal，假 agy 的进程组已结束、探针临时目录已删', { skip }, async () => {
  const { fx, home, tmp } = await project('dlcli-i7');
  const mark = `${MARK}-i7`;
  const child = spawn(process.execPath, [BUNDLE, 'doctor', '--only', 'agy', '--deadline-s', '60', '--json'], {
    cwd: fx.root,
    env: {
      ...process.env, HOME: home, TMPDIR: tmp, FAKE_AGY_MODE: 'hang', FAKE_AGY_MARK: mark,
      TRIVIUM_ASSET_ROOT: ASSET_ROOT, [ENTRY_SCAN_HOME_ENV]: emptyEntryScanHome(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  try {
    const deadline = Date.now() + 30_000;
    while (groupsWithMark(mark).length === 0 && Date.now() < deadline) await sleep(100);
    assert.ok(groupsWithMark(mark).length > 0, `假 agy 的模型调用没起来：${stderr}`);
    child.kill('SIGTERM');
    const code = await exited;
    assert.equal(code, EXIT.DOCTOR_PARTIAL, stderr);
    const d = (JSON.parse(stdout) as { deadline: { hit: boolean; reason: string; sections: Array<{ only: string; state: string }> } }).deadline;
    assert.equal(d.hit, true);
    assert.equal(d.reason, 'signal');
    assert.deepEqual(d.sections.map((s) => [s.only, s.state]), [['agy', 'in_progress']]);
    assert.match(stderr, /收到 SIGTERM：doctor 按到点处置/);
    const until = Date.now() + 3000;
    while (groupsWithMark(mark).length > 0 && Date.now() < until) await sleep(100);
    assert.deepEqual(groupsWithMark(mark), [], '假 agy 拉起的后代应已按组结束');
    assert.deepEqual((await fs.readdir(tmp)).filter((n) => n.startsWith('trivium-')), [], '探针临时目录应已删');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    killMarked(mark);
  }
});

test('I12 读覆盖的段（codex）：预检给出的带路线与模型旗标的 args 照抄喂给打包 CLI，不被判参数错误（代码三审 GLM-04）', { skip }, async () => {
  const { fx, home, tmp } = await project('dlcli-i12');
  const mark = `${MARK}-i12`;
  // 钉住 CODEX_HOME：放一份名单用的空 profile 文件（不含凭据），不读本机真实配置
  const codexHome = path.join(home, '.codex');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, 'qwen.config.toml'), '# 离线名称夹具\n');
  const p = path.join(fx.root, '.trivium', 'config.local.yaml');
  const doc = YAML.parse(await fs.readFile(p, 'utf8')) as Record<string, any>;
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (const c of Object.values(doc['probe']['cli'] as Record<string, any>)) c.probed_at = old;
  // 显式给假 codex 入口：不给的话 doctor 的候选表会先命中本机真实 codex（花配额）
  doc['agents'] = { ...(doc['agents'] ?? {}), codex: { vendor: 'openai', bin: doc['probe']['cli']['codex']['entrypoint'], profile: 'qwen' } };
  // 时限压到下限，假 codex 挂住时用例也在半分钟左右结束
  doc['preflight'] = { ...(doc['preflight'] ?? {}), recalibrate_deadline_s: 30 };
  await fs.writeFile(p, YAML.stringify(doc), 'utf8');

  const env = { HOME: home, TMPDIR: tmp, CODEX_HOME: codexHome, FAKE_AGY_MODE: 'fail', FAKE_AGY_MARK: mark };
  try {
    const pf = await cli(fx.root, ['preflight', '--stage', 'plan', '--critics', 'codex', '--skip-auth-check', '--json'], null, 120_000, env);
    const j = JSON.parse(pf.stdout) as {
      exit_code: number; checks: Array<{ ok: boolean; name: string }>;
      recalibration?: { eligible: boolean; invocations: Array<{ only: string; args: string[] }> };
    };
    assert.equal(j.exit_code, EXIT.ENV, pf.stdout);
    assert.equal(j.recalibration?.eligible, true, pf.stdout);
    const inv = j.recalibration!.invocations.find((i) => i.only === 'codex')!;
    assert.ok(inv, pf.stdout);
    assert.ok(inv.args.includes('--profile-codex') || inv.args.includes('--native-codex'), inv.args.join(' '));
    assert.ok(inv.args.includes('--model-codex'), inv.args.join(' '));

    const d = await cli(fx.root, inv.args, null, 120_000, env);
    assert.notEqual(d.code, EXIT.USAGE, `照抄的 args 被判参数错误：${d.stderr}`);
    const dj = JSON.parse(d.stdout) as { deadline: { sections: Array<{ only: string; rerun: string }> } };
    assert.equal(dj.deadline.sections[0]?.only, 'codex');
    for (const flag of inv.args.filter((a) => /^--(profile|native|model|effort)-codex$/.test(a))) {
      assert.ok(dj.deadline.sections[0]!.rerun.includes(flag), `rerun 应带上 ${flag}：${dj.deadline.sections[0]!.rerun}`);
    }
  } finally {
    killMarked(mark);
  }
});

test('I5 预检 JSON 的 recalibration.invocations[*].args 照抄即可执行；重跑预检不再报探针过期', { skip }, async () => {
  const { fx, home, tmp } = await project('dlcli-i5');
  const mark = `${MARK}-i5`;
  // 把 agy 的结论拨旧（全部登记 CLI 都过期才触发「探针结论未过期」）
  const p = path.join(fx.root, '.trivium', 'config.local.yaml');
  const doc = YAML.parse(await fs.readFile(p, 'utf8')) as Record<string, any>;
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (const c of Object.values(doc['probe']['cli'] as Record<string, any>)) c.probed_at = old;
  await fs.writeFile(p, YAML.stringify(doc), 'utf8');

  const env = { HOME: home, TMPDIR: tmp, FAKE_AGY_MODE: 'fail', FAKE_AGY_MARK: mark };
  try {
    const pf = await cli(fx.root, ['preflight', '--stage', 'plan', '--critics', 'gemini', '--skip-auth-check', '--json'], null, 120_000, env);
    assert.equal(pf.code, EXIT.ENV, pf.stderr);
    const j = JSON.parse(pf.stdout) as {
      checks: Array<{ ok: boolean; name: string; recalibrate?: { fixable: boolean } }>;
      recalibration: { eligible: boolean; invocations: Array<{ only: string; args: string[]; deadline_s: number; bash_timeout_ms: number }> };
    };
    assert.equal(j.checks.find((c) => !c.ok)?.name, '探针结论未过期');
    assert.equal(j.checks.find((c) => !c.ok)?.recalibrate?.fixable, true);
    assert.equal(j.recalibration.eligible, true);
    assert.deepEqual(j.recalibration.invocations.map((i) => i.only), ['agy']);
    const inv = j.recalibration.invocations[0]!;
    assert.equal(inv.deadline_s, 900);
    assert.equal(inv.bash_timeout_ms, 960_000);
    // 打包 CLI 输出的原文里播报句先于调用清单（EV-252）：cli.ts 不重排键序
    const before = pf.stdout.indexOf('"announce_before"');
    assert.ok(before !== -1 && before < pf.stdout.indexOf('"invocations"'), pf.stdout);

    const doc2 = await cli(fx.root, inv.args, null, 120_000, env);
    assert.notEqual(doc2.code, EXIT.USAGE, `照抄的 args 被判参数错误：${doc2.stderr}`);
    const dj = JSON.parse(doc2.stdout) as { deadline: { hit: boolean; sections: Array<{ state: string; rerun: string }> } };
    assert.equal(dj.deadline.hit, false);
    assert.equal(dj.deadline.sections[0]?.state, 'finished');
    // 项目里的入口：`trivium` 不在 PATH 上（代码三审 GLM-02）
    assert.equal(dj.deadline.sections[0]?.rerun, `${DOCTOR_RERUN_ENTRY} doctor --only agy`);

    const pf2 = await cli(fx.root, ['preflight', '--stage', 'plan', '--critics', 'gemini', '--skip-auth-check', '--json'], null, 120_000, env);
    const j2 = JSON.parse(pf2.stdout) as { checks: Array<{ ok: boolean; name: string }> };
    assert.ok(!j2.checks.some((c) => !c.ok && c.name === '探针结论未过期'), pf2.stdout);
  } finally {
    killMarked(mark);
  }
});
