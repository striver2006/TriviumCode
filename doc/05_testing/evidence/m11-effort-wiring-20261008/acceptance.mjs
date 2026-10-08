// M11 第 6 步零配额验收（计划 r2 §3.4）：本仓裸 slug 配置下，发往各家 CLI 的请求与 argv 与改前逐字相同。
//
// 两步：①`git archive 〈基线〉` 导出**旧源码**，在导出目录内（node_modules 软链本仓）用 scripts/build.mjs 现构建出旧 bundle——
// **旧构建 = 旧源码 + 现行工具链**，不是历史构建（计划三审 CODEX-03）；②新旧两份 bundle 各对同一份复刻本仓配置的夹具，
// 以桩模式跑 `review --start` 到终态（档位表 default / flash / pro × 阶段 plan / code），比 worker 交接文件里逐侧的
// model / effort / profile_requested 逐字相同；再用两边各自的纯函数（dist/test 下的编译产物）把同一组请求组成 argv 比对。
// 记两份 bundle 的 sha256 并断言不同（只证明跑的是两份不同构建）。
//
// 用法（在仓库根，先 `node scripts/build.mjs --with-tests`）：node acceptance.mjs 〈基线提交〉 〈输出 JSON〉
// 不花配额：三侧全部打桩（TRIVIUM_STUB_CRITIC），不拉起任何真实 CLI。临时目录在系统临时目录下、跑完删除（TRIVIUM_KEEP_FIXTURES=1 保留）。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

const ROOT = process.cwd();
const BASE = process.argv[2];
const OUT = process.argv[3];
if (!BASE || !OUT) throw new Error('用法：node acceptance.mjs 〈基线提交〉 〈输出 JSON〉');

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-m11s6-accept-')));
const results = { base: BASE, cells: [], argv: [], bundles: {}, ok: false };

try {
  // ① 旧源码 → 旧构建
  const oldDir = path.join(work, 'old');
  fs.mkdirSync(oldDir);
  const tarBuf = execFileSync('git', ['archive', BASE], { cwd: ROOT, maxBuffer: 1 << 30 });
  const x = spawnSync('tar', ['-x', '-C', oldDir], { input: tarBuf });
  if (x.status !== 0) throw new Error(`解包失败：${x.stderr}`);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(oldDir, 'node_modules'));
  execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { cwd: oldDir, stdio: 'ignore' });

  const side = {
    old: { root: oldDir, bundle: path.join(oldDir, 'skills/dual-critic/scripts/trivium.cjs') },
    new: { root: ROOT, bundle: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs') },
  };
  for (const k of ['old', 'new']) results.bundles[k] = sha(side[k].bundle);
  if (results.bundles.old === results.bundles.new) throw new Error('新旧 bundle 的 sha256 相同——跑的不是两份构建');

  const own = YAML.parse(fs.readFileSync(path.join(ROOT, '.trivium', 'config.yaml'), 'utf8'));
  const STUB = JSON.stringify({ codex: { mode: 'ok' }, gemini: { mode: 'ok' }, glm: { mode: 'ok' } });
  const TOPIC = '现役请求不变验收';
  const today = new Date().toISOString().slice(0, 10);

  /** 复刻本仓配置的夹具：只改运行根与 verify（桩跑不需要），其余键原样 */
  function fixture(name) {
    const base = path.join(work, name);
    const repo = path.join(base, 'repo');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.trivium'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(repo, 'README.md'), '# 验收夹具\n');
    const cfg = structuredClone(own);
    cfg.runtime = { ...cfg.runtime, run_root: path.join(base, 'runs') };
    cfg.verify = { build: [], test: [] };
    fs.writeFileSync(path.join(repo, '.trivium', 'config.yaml'), YAML.stringify(cfg));
    const plan = path.join(repo, '.reviews', TOPIC, 'plan');
    fs.mkdirSync(plan, { recursive: true });
    fs.writeFileSync(path.join(plan, `${today}-${TOPIC}-claude.md`), '# 待审计划\n\n## 一、目标\n\n验收。\n');
    const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.email=a@b', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 2;\n'); // 代码阶段要有 diff
    return { repo, runRoot: path.join(base, 'runs') };
  }

  const run = (bundle, cwd, args) => spawnSync(process.execPath, [bundle, ...args], {
    cwd, encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, TRIVIUM_STUB_CRITIC: STUB, TRIVIUM_ASSET_ROOT: path.join(path.dirname(path.dirname(bundle))) },
  });

  function findRequest(runRoot, runId) {
    for (const bucket of fs.readdirSync(runRoot)) {
      const p = path.join(runRoot, bucket, runId, 'request.json');
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    throw new Error(`找不到 ${runId} 的交接文件`);
  }

  const pick = (q) => ({ model: q.model ?? null, effort: q.effort ?? null, profile_requested: q.profile_requested ?? null });
  for (const profile of Object.keys(own.profiles)) {
    for (const stage of ['plan', 'code']) {
      const got = {};
      for (const k of ['old', 'new']) {
        const fx = fixture(`${k}-${profile}-${stage}`);
        const s = run(side[k].bundle, fx.repo, ['review', '--start', '--stage', stage, '--topic', TOPIC, '--focus', 'x',
          '--critics', 'codex,gemini,glm', '--profile', profile, '--json']);
        if (s.status !== 0) throw new Error(`${k} ${profile}/${stage} --start 退 ${s.status}：${s.stdout}${s.stderr}`);
        const runId = /"run_id":\s*"([^"]+)"/.exec(s.stdout)[1];
        let code = 73;
        for (let i = 0; i < 12 && code === 73; i++) code = run(side[k].bundle, fx.repo, ['review', '--wait', runId, '--timeout', '20']).status;
        if (code !== 0) throw new Error(`${k} ${profile}/${stage} 运行没有正常结束（退 ${code}）`);
        const req = findRequest(fx.runRoot, runId).requests;
        got[k] = Object.fromEntries(['codex', 'gemini', 'glm'].map((c) => [c, pick(req[c])]));
      }
      const same = JSON.stringify(got.old) === JSON.stringify(got.new);
      results.cells.push({ profile, stage, same, old: got.old, new: got.new });
      if (!same) throw new Error(`${profile}/${stage} 请求不一致：${JSON.stringify(got)}`);
    }
  }

  // ② argv：两边各自的纯函数，喂同一组（已证相同的）请求
  const mod = async (k, rel) => import(pathToFileURL(path.join(side[k].root, 'dist/test/src/trivium', rel)).href);
  const [agyOld, agyNew, codexOld, codexNew] = await Promise.all([
    mod('old', 'adapters/agy.js'), mod('new', 'adapters/agy.js'), mod('old', 'adapters/codex.js'), mod('new', 'adapters/codex.js'),
  ]);
  for (const c of results.cells) {
    const g = c.new.gemini;
    const a1 = agyOld.buildAgyArgs({ prompt: 'x', timeoutMs: 600_000, model: g.model, effort: g.effort });
    const a2 = agyNew.buildAgyArgs({ prompt: 'x', timeoutMs: 600_000, model: g.model, effort: g.effort });
    const q = c.new.codex;
    // 改前 run() 的 -p 取 agents.codex.profile（= 改前请求的 profile_requested），effort 取请求
    const b1 = codexOld.buildCodexArgs({ profile: c.old.codex.profile_requested, model: q.model, effort: c.old.codex.effort, readonlyArgs: ['-s', 'read-only'], cwd: '/p' });
    const b2 = codexNew.buildCodexArgs({ ...codexNew.codexInvocationOf({ profile_requested: q.profile_requested, model: q.model, ...(q.effort ? { effort: q.effort } : {}) }), readonlyArgs: ['-s', 'read-only'], cwd: '/p' });
    const row = { profile: c.profile, stage: c.stage, agy_same: JSON.stringify(a1) === JSON.stringify(a2), codex_same: JSON.stringify(b1) === JSON.stringify(b2), agy: a2.slice(3), codex: b2 };
    results.argv.push(row);
    if (!row.agy_same || !row.codex_same) throw new Error(`${c.profile}/${c.stage} argv 不一致：${JSON.stringify({ a1, a2, b1, b2 })}`);
  }
  results.ok = true;
} finally {
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
  if (process.env.TRIVIUM_KEEP_FIXTURES !== '1') fs.rmSync(work, { recursive: true, force: true });
  console.log(results.ok ? `通过：${results.cells.length} 格请求、${results.argv.length} 格 argv 逐字相同；sha256 old=${results.bundles.old?.slice(0, 12)} new=${results.bundles.new?.slice(0, 12)}` : '未通过，见输出 JSON');
}
