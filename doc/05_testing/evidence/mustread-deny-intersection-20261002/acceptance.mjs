#!/usr/bin/env node
/**
 * 「必读与禁读交集校验」（EV-02）改前 / 改后零配额验收（计划 r2 §3.4）。
 *
 * 两个场景 × 旧 / 新两份构建，共四格；每格一棵独立的 mkdtemp 夹具（独立 git 仓库、独立 HOME，运行根钉在夹具旁），
 * 桩适配器经 TRIVIUM_STUB_CRITIC 注入（零配额），直接 `node <bundle>` 调：
 *
 * - 场景 X（`--context` 指向对端审查件）：
 *   旧构建 `review --start` 成功，gemini 侧任务书里**同一路径同时出现在第 4 段必读与 8.1**（复现矛盾）；
 *   新构建退 64，`.reviews/`、运行根、`.trivium/`（除锁外）前后逐字节一致，锁不残留。
 * - 场景 Y（建议核实撞上对端审查件：归档根 doc/reviews、ASCII 主题、原稿正文提到对端审查件路径）：
 *   旧构建同一路径同时出现在 gemini 侧第 4 段「建议核实」与 8.1；
 *   新构建退 0，gemini 侧第 4 段不含、8.1 含，glm 侧第 4 段照常含，`--start` 的 warnings 恰一条「必读清单剔除」。
 *
 * 旧构建跑成功的格子（X-old、Y-old、Y-new）把运行 `--wait` 到终态再整树丢弃（计划双审 r1 CODEX-02）：
 * 不在本仓与真实 HOME 留闸门、运行目录或任务文件。
 *
 * **旧构建的获取路径**：`git archive <BASE>` 解到 mkdtemp，`node_modules` 软链到本仓工作树（不联网、不 npm ci），
 * 在归档目录里 `node scripts/build.mjs`。新构建取本仓工作树的产物（先 `npm run build`）。两份 bundle 记 sha256 并断言不同；
 * 各自的 TRIVIUM_ASSET_ROOT 指向各自的 `skills/dual-critic`。
 *
 * 用法（在仓库根）：node doc/05_testing/evidence/mustread-deny-intersection-20261002/acceptance.mjs [输出 JSON 路径]
 * 清理：只删本脚本 mkdtemp 返回的目录（R1）。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const BASE = 'a9e7cdc';
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const made = [];
const tmp = async (prefix) => {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  made.push(d);
  return d;
};
const STUB = JSON.stringify({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } });
const DATE = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

async function listFiles(dir) {
  const out = [];
  const walk = async (d) => {
    let es;
    try { es = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else out.push(path.relative(dir, abs));
    }
  };
  await walk(dir);
  return out.sort();
}

/** `.reviews/`（或 doc/reviews）、运行根、`.trivium/`（除锁）三处的文件与内容 */
async function trace(proj, archiveRel) {
  const out = {};
  for (const [label, dir] of [['archive', path.join(proj, archiveRel)], ['runs', `${proj}-runs`], ['trivium', path.join(proj, '.trivium')]]) {
    for (const f of await listFiles(dir)) {
      if (label === 'trivium' && f.startsWith('lock/')) continue;
      out[`${label}:${f}`] = sha256Text(await fs.readFile(path.join(dir, f), 'utf8'));
    }
  }
  return out;
}
const sha256Text = (s) => createHash('sha256').update(s).digest('hex');

const reviewDoc = (topic) =>
  ['---', 'schema: trivium.review.v1', `topic: ${topic}`, 'stage: plan', 'role: glm', 'verdict: approve', '---', '', '# 审查', ''].join('\n');

/** 一棵夹具：git 仓库 + 两侧配置 + 原稿 + glm 侧审查件。返回项目根、阶段目录与对端审查件相对路径 */
async function makeProject(prefix, topic, archiveRel, draftBody) {
  const proj = await tmp(prefix);
  const home = await tmp(`${prefix}home-`);
  await fs.mkdir(path.join(proj, 'src'), { recursive: true });
  await fs.writeFile(path.join(proj, 'src/a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(proj, 'README.md'), '# 夹具\n');
  await fs.mkdir(path.join(proj, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(proj, '.trivium/config.yaml'), [
    'runtime:', `  run_root: ${proj}-runs`,
    'review:', '  default_critics: [gemini, glm]',
    '  timeout_s:', '    plan: 120', '    code: 120', '    bug: 120', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []',
    `archive_root: ${archiveRel}`, '',
  ].join('\n'));
  made.push(`${proj}-runs`);
  const stageDir = path.join(proj, archiveRel, topic, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  const peer = `${archiveRel}/${topic}/plan/${DATE}-${topic}-glm.md`;
  await fs.writeFile(path.join(proj, peer), reviewDoc(topic));
  await fs.writeFile(path.join(stageDir, `${DATE}-${topic}-${'claude'}.md`), draftBody(peer));
  const git = (args) => execFileSync('git', args, { cwd: proj, stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'acc@triviumcode.local']);
  git(['config', 'user.name', 'acc']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'acceptance baseline', '--no-verify']);
  return { proj, home, stageDir, peer };
}

function cliRun(bundle, assetRoot, proj, home, args) {
  const r = spawnSync(process.execPath, [bundle, ...args], {
    cwd: proj, encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, HOME: home, TRIVIUM_ASSET_ROOT: assetRoot, TRIVIUM_STUB_CRITIC: STUB },
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const jsonOf = (s) => JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));

async function finish(bundle, assetRoot, proj, home, runId) {
  let code = 73;
  for (let i = 0; i < 12 && code === 73; i++) {
    code = cliRun(bundle, assetRoot, proj, home, ['review', '--wait', runId, '--timeout', '20']).code;
  }
  return code;
}

async function sections(stageDir, critic, runId) {
  const t = await fs.readFile(path.join(stageDir, '_meta', `brief-${critic}-${runId}.md`), 'utf8');
  const s4 = t.slice(t.indexOf('## 4. '), t.indexOf('## 5. '));
  const s8 = t.slice(t.indexOf('## 8. '));
  const s81 = s8.slice(0, s8.indexOf('### 8.2'));
  return { s4, s81 };
}
const bullet = (p) => `- \`${p}\``;
/** 报告里留的输出尾巴：夹具路径与 run_id 归一 */
const norm = (s, proj) => s.split(proj).join('<PROJ>').replace(/\d{8}T\d{6}Z/g, '<RUN>').split('\n').slice(-12);

const readout = { base: BASE, bundles: {}, cells: [], pass: 0, total: 0 };
try {
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
  if (readout.bundles.old.sha256 === readout.bundles.new.sha256) throw new Error('新旧 bundle 哈希相同：新构建没包含本主题改动');

  const record = (cell) => {
    cell.ok = Object.values(cell.checks).every(Boolean);
    readout.cells.push(cell);
    readout.total += 1;
    if (cell.ok) readout.pass += 1;
    console.log(`${cell.ok ? '✓' : '✗'} ${cell.scenario} × ${cell.build}：exit=${cell.exit} ${JSON.stringify(cell.checks)}`);
  };

  // ── 场景 X：--context 指向对端审查件 ──
  for (const b of ['old', 'new']) {
    const topic = 'acc-ctx';
    const { proj, home, stageDir, peer } = await makeProject(`trivium-acc-x-${b}-`, topic, '.reviews', () => '# 待审计划\n\n验证编排器行为。\n');
    const { bundle, asset } = builds[b];
    const before = await trace(proj, '.reviews');
    const r = cliRun(bundle, asset, proj, home, ['review', '--start', '--stage', 'plan', '--topic', topic, '--focus', 'x', '--context', peer, '--json']);
    const cell = { scenario: 'X', build: b, exit: r.code, stdout_tail: norm(r.stdout, proj), stderr_tail: norm(r.stderr, proj) };
    if (b === 'old') {
      const runId = r.code === 0 ? jsonOf(r.stdout).run_id : null;
      const gem = runId ? await sections(stageDir, 'gemini', runId) : { s4: '', s81: '' };
      cell.checks = {
        exit0: r.code === 0,
        same_path_in_s4: gem.s4.includes(bullet(peer)),
        same_path_in_s81: gem.s81.includes(bullet(peer)),
        finished: runId ? (await finish(bundle, asset, proj, home, runId)) === 0 : false,
      };
    } else {
      const after = await trace(proj, '.reviews');
      const locks = (await listFiles(path.join(proj, '.trivium'))).filter((f) => f.startsWith('lock/'));
      cell.checks = {
        exit64: r.code === 64,
        names_path: r.stderr.includes(`「${peer}」`),
        names_side: r.stderr.includes('涉及 gemini 侧'),
        zero_artifacts: JSON.stringify(after) === JSON.stringify(before),
        no_lock_left: locks.length === 0,
      };
    }
    record(cell);
  }

  // ── 场景 Y：建议核实撞上对端审查件 ──
  for (const b of ['old', 'new']) {
    const topic = 'acc-sugg';
    const { proj, home, stageDir, peer } = await makeProject(
      `trivium-acc-y-${b}-`, topic, 'doc/reviews', (p) => `# 待审计划\n\n参考 ${p} 与 src/a.ts。\n`,
    );
    const { bundle, asset } = builds[b];
    const r = cliRun(bundle, asset, proj, home, ['review', '--start', '--stage', 'plan', '--topic', topic, '--focus', 'x', '--json']);
    const js = r.code === 0 ? jsonOf(r.stdout) : null;
    const gem = js ? await sections(stageDir, 'gemini', js.run_id) : { s4: '', s81: '' };
    const glm = js ? await sections(stageDir, 'glm', js.run_id) : { s4: '', s81: '' };
    const cell = { scenario: 'Y', build: b, exit: r.code, warnings: js?.warnings ?? null, stderr_tail: norm(r.stderr, proj) };
    cell.checks = b === 'old'
      ? {
          exit0: r.code === 0,
          same_path_in_s4: gem.s4.includes(bullet(peer)),
          same_path_in_s81: gem.s81.includes(bullet(peer)),
        }
      : {
          exit0: r.code === 0,
          gemini_s4_pruned: !gem.s4.includes(peer),
          gemini_s81_kept: gem.s81.includes(bullet(peer)),
          glm_s4_kept: glm.s4.includes(bullet(peer)),
          one_warning: (js?.warnings ?? []).length === 1 && js.warnings[0].name === '必读清单剔除'
            && js.warnings[0].detail.includes(`「${peer}」（来源：建议核实）落在 gemini 侧的禁读集里`),
        };
    cell.checks.finished = js ? (await finish(bundle, asset, proj, home, js.run_id)) === 0 : false;
    if (cell.warnings) cell.warnings = cell.warnings.map((w) => ({ name: w.name, detail: w.detail.split(proj).join('<PROJ>') }));
    record(cell);
  }
} finally {
  for (const d of made) await fs.rm(d, { recursive: true, force: true });
}
console.log(`结果：${readout.pass}/${readout.total}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
process.exit(readout.pass === readout.total ? 0 : 1);
