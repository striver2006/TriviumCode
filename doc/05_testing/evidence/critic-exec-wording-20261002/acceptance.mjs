#!/usr/bin/env node
/**
 * 「审查侧实测措辞约束」（EV-95 前半）改前 / 改后任务书对照（计划 r2 §3.1 ④，零配额）。
 *
 * 旧 / 新两份构建各跑一次同步 `review --stage plan`，每次一棵独立的 mkdtemp 夹具（内容相同的 git 仓库、独立 HOME，
 * 运行根钉在夹具旁），桩经 TRIVIUM_STUB_CRITIC 注入：gemini 侧 `command_trace`、glm 侧 `ok`（两种形态各一侧）。
 * 直接 `node <bundle>` 调；各自的 TRIVIUM_ASSET_ROOT 指向各自那棵树的 `skills/dual-critic`（计划双审 CODEX-01）。
 *
 * 前置断言：旧树与工作树的 package.json / package-lock.json 逐字节相同（CODEX-06）；两份 bundle 的 sha256 不同。
 * 逐侧断言：
 *   - 切掉第 7 节后，旧 / 新任务书归一化后逐字相同（归一化只抹夹具路径、HOME、资产根、run_id、十六进制哈希）；
 *   - 第 7 节：旧版的每一行在新版里按序仍在；新版多出来的行恰为该侧那一种说法（gemini 一条只读 shell、glm 两条不能执行命令），
 *     另一种说法的特征句不出现。
 *
 * **旧构建的获取路径**：`git archive <BASE>` 解到 mkdtemp，`node_modules` 软链到本仓工作树（不联网、不 npm ci），
 * 在归档目录里 `node scripts/build.mjs`。新构建取本仓工作树的产物（先 `npm run build`）。
 *
 * 用法（在仓库根）：node doc/05_testing/evidence/critic-exec-wording-20261002/acceptance.mjs [输出 JSON 路径]
 * 清理：只删本脚本 mkdtemp 返回的目录（R1）。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const BASE = 'a03a056';
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const made = [];
const tmp = async (prefix) => {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  made.push(d);
  return d;
};
const STUB = JSON.stringify({ gemini: { mode: 'command_trace' }, glm: { mode: 'ok' } });
const TOPIC = 'acc-exec-wording';
const DATE = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const NONE_LINES = [
  '- **你这一侧没有执行命令的能力**，只能读文件与检索。不要用「实测」「复测」「直调」「跑了」「执行结果」一类说法描述你的判断；需要运行才能确认的结论写明是推理，并在 `not_covered` 里列出没能验证的部分。',
  '- 第 2 节的焦点若要求实测或复测而你做不到，如实说明后照常交付结论，**不要停下来等放行**。',
];
const SHELL_LINES = [
  '- 你这一侧可以执行只读命令。凡写「实测」「复测」的判断，`evidence` 里写出你本轮实际执行的命令；没执行、靠推理得出的写明是推理。',
];
const EXPECT = { gemini: { added: SHELL_LINES, absent: NONE_LINES }, glm: { added: NONE_LINES, absent: SHELL_LINES } };

async function makeProject(prefix) {
  const proj = await tmp(prefix);
  const home = await tmp(`${prefix}home-`);
  await fs.mkdir(path.join(proj, 'src'), { recursive: true });
  await fs.writeFile(path.join(proj, 'src/a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(proj, 'README.md'), '# 夹具\n');
  await fs.writeFile(path.join(proj, '.env'), 'X=1\n');
  await fs.mkdir(path.join(proj, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(proj, '.trivium/config.yaml'), [
    'runtime:', `  run_root: ${proj}-runs`,
    'review:', '  default_critics: [gemini, glm]',
    '  timeout_s:', '    plan: 120', '    code: 120', '    bug: 120', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  made.push(`${proj}-runs`);
  const stageDir = path.join(proj, '.reviews', TOPIC, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${DATE}-${TOPIC}-${'claude'}.md`), '# 待审计划\n\n参考 src/a.ts。\n');
  const git = (args) => execFileSync('git', args, { cwd: proj, stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'acc@triviumcode.local']);
  git(['config', 'user.name', 'acc']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'acceptance baseline', '--no-verify']);
  return { proj, home, stageDir };
}

function cliRun(bundle, assetRoot, proj, home, args) {
  const r = spawnSync(process.execPath, [bundle, ...args], {
    cwd: proj, encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, HOME: home, TRIVIUM_ASSET_ROOT: assetRoot, TRIVIUM_STUB_CRITIC: STUB },
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function briefOf(stageDir, critic) {
  const meta = path.join(stageDir, '_meta');
  const f = (await fs.readdir(meta)).filter((n) => n.startsWith(`brief-${critic}-`) && n.endsWith('.md'));
  if (f.length !== 1) throw new Error(`${critic} 侧任务书应恰有一份：${f.join('、')}`);
  return fs.readFile(path.join(meta, f[0]), 'utf8');
}
const s7Of = (t) => t.slice(t.indexOf('## 7. 反谄媚约束'), t.indexOf('## 8. '));

const readout = { base: BASE, bundles: {}, asset_roots: {}, preconditions: {}, sides: {}, pass: 0, total: 0 };
try {
  const depsSame = spawnSync('git', ['diff', '--quiet', BASE, '--', 'package.json', 'package-lock.json'], { cwd: ROOT }).status === 0;
  readout.preconditions.deps_same = depsSame;
  if (!depsSame) throw new Error('旧树与工作树的依赖清单不同，软链 node_modules 的对照不成立，中止');

  const oldRoot = await tmp('trivium-acc-old-');
  execFileSync('sh', ['-c', `git archive ${BASE} | tar -x -C "${oldRoot}"`], { cwd: ROOT });
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldRoot, 'node_modules'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: oldRoot, stdio: 'ignore' });
  const builds = {
    old: { bundle: path.join(oldRoot, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(oldRoot, 'skills/dual-critic') },
    new: { bundle: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), asset: path.join(ROOT, 'skills/dual-critic') },
  };
  readout.bundles = {
    old: { commit: BASE, sha256: await sha(builds.old.bundle) },
    new: { commit: 'working-tree', sha256: await sha(builds.new.bundle) },
  };
  readout.asset_roots = { old: '<旧树>/skills/dual-critic', new: '<本仓工作树>/skills/dual-critic' };
  readout.preconditions.bundles_differ = readout.bundles.old.sha256 !== readout.bundles.new.sha256;
  if (!readout.preconditions.bundles_differ) throw new Error('新旧 bundle 哈希相同：新构建没包含本主题改动');

  const briefs = {};
  for (const b of ['old', 'new']) {
    const { proj, home, stageDir } = await makeProject(`trivium-acc-${b}-`);
    const { bundle, asset } = builds[b];
    const r = cliRun(bundle, asset, proj, home, ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', '请独立复测那条退出码断言']);
    if (r.code !== 0) throw new Error(`${b} 构建同步 review 退 ${r.code}：\n${r.stdout}\n${r.stderr}`);
    const norm = (t) => t.split(proj).join('<PROJ>').split(home).join('<HOME>').split(asset).join('<ASSET>')
      .replace(/\d{8}T\d{6}Z/g, '<RUN>').replace(/[0-9a-f]{12,64}/g, '<HASH>');
    briefs[b] = {};
    for (const c of ['gemini', 'glm']) briefs[b][c] = norm(await briefOf(stageDir, c));
  }

  for (const c of ['gemini', 'glm']) {
    const o = briefs.old[c];
    const n = briefs.new[c];
    const os7 = s7Of(o);
    const ns7 = s7Of(n);
    const oLines = os7.split('\n');
    const nLines = ns7.split('\n');
    // 旧版每一行按序出现在新版里，多出来的行收进 added
    const added = [];
    let i = 0;
    for (const l of nLines) {
      if (i < oLines.length && l === oLines[i]) i += 1;
      else added.push(l);
    }
    const checks = {
      outside_s7_identical: o.replace(os7, '') === n.replace(ns7, ''),
      old_s7_preserved_in_order: i === oLines.length,
      added_exactly_expected: JSON.stringify(added) === JSON.stringify(EXPECT[c].added),
      other_variant_absent: EXPECT[c].absent.every((l) => !ns7.includes(l.slice(2, 20))),
    };
    const ok = Object.values(checks).every(Boolean);
    readout.sides[c] = { checks, added, ok };
    readout.total += 1;
    if (ok) readout.pass += 1;
    console.log(`${ok ? '✓' : '✗'} ${c}：${JSON.stringify(checks)}`);
    if (!checks.added_exactly_expected) console.log(`  added = ${JSON.stringify(added)}`);
  }
} finally {
  for (const d of made) await fs.rm(d, { recursive: true, force: true });
}
console.log(`结果：${readout.pass}/${readout.total}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
process.exit(readout.pass === readout.total && readout.total === 2 ? 0 : 1);
