// A-1 安装器新旧对照（M12 批次 5，计划 r2 §5）。只写 SP/a1 下的夹具家目录，不读写真实家目录。
// 用法：node a1-installer.mjs <旧仓库导出目录> <新仓库根> <输出 JSON>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const [OLD, NEW, OUT] = process.argv.slice(2);
const SP = path.dirname(new URL(import.meta.url).pathname);
const WORK = path.join(SP, 'a1');
const AGENT_HOMES = ['.claude', '.codex', '.gemini', '.zcode'];

function freshHome(name, missing = []) {
  const home = path.join(WORK, name, 'home');
  fs.rmSync(path.join(WORK, name), { recursive: true, force: true }); // 只删本脚本在 SP/a1 下建的
  fs.mkdirSync(home, { recursive: true });
  for (const h of AGENT_HOMES) if (!missing.includes(h)) fs.mkdirSync(path.join(home, h), { recursive: true });
  return home;
}
const ours = (repo, agent, name) => fs.readFileSync(path.join(repo, 'skills/dual-critic/entry', agent, name, 'SKILL.md'), 'utf8');
function plant(dir, md) {
  fs.mkdirSync(dir, { recursive: true });
  if (md !== null) fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
}
function tree(dir) {
  const out = [];
  const walk = (d, rel) => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      // 运行时根里的编排器产物新旧本就不同（本批改了它），只比在不在；其余文件比内容
      else if (r.endsWith('scripts/trivium.cjs')) out.push(`${r} <bundle>`);
      else out.push(`${r} ${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)}`);
    }
  };
  walk(dir, '');
  return out;
}

// 每格：setup(home, repo) 摆夹具并返回额外环境；steps 为依次执行的命令
const CASES = [
  { name: 'clean-install', setup: () => ({}), steps: [['install']] },
  { name: 'reinstall-upgrade', setup: () => ({}), steps: [['install'], ['install']] },
  { name: 'three-kinds', setup: (home, repo) => {
      plant(path.join(home, '.codex/skills/dual-critic'), null);
      plant(path.join(home, '.agents/skills/dual-run'), '---\nname: dual-run\ndescription: 用户自己的\n---\n');
      plant(path.join(home, '.agents/skills/dual-status'), ours(repo, 'glm', 'dual-status'));
      return {};
    }, steps: [['check'], ['install']] },
  { name: 'install-root-third-party', setup: (home) => {
      plant(path.join(home, '.zcode/skills/dual-approve'), '---\nname: dual-approve\n---\n别人的\n');
      plant(path.join(home, '.gemini/config/skills/entry'), null);
      return {};
    }, steps: [['check'], ['install']] },
  { name: 'targets-missing-family', missing: ['.gemini'], setup: () => ({}), steps: [['install', '--targets', 'gemini'], ['install', '--targets', 'claude,glm']] },
  { name: 'runtime-foreign', setup: (home) => {
      const rt = path.join(home, '..', 'foreign-rt');
      fs.mkdirSync(rt, { recursive: true });
      fs.writeFileSync(path.join(rt, 'keep.txt'), 'x');
      return { TRIVIUM_ASSET_ROOT: rt };
    }, steps: [['install']] },
  { name: 'runtime-overlap', setup: (_home, repo) => ({ TRIVIUM_ASSET_ROOT: path.join(repo, 'skills/dual-critic') }), steps: [['install'], ['uninstall']] },
  { name: 'codex-home-elsewhere', setup: (home) => {
      const ch = path.join(home, '..', 'codexhome');
      plant(path.join(ch, 'skills/entry'), null);
      plant(path.join(home, '.agents/skills/dual-approve'), '---\nname: dual-approve\n---\n');
      return { CODEX_HOME: ch };
    }, steps: [['check'], ['install']] },
  { name: 'install-then-uninstall', setup: (home) => {
      plant(path.join(home, '.codex/skills/dual-run'), '---\nname: dual-run\n---\n别人的\n');
      return {};
    }, steps: [['install', '--targets', 'claude,glm,gemini'], ['uninstall']] },
];

function runOne(repo, home, extraEnv, step) {
  const [cmd, ...args] = step;
  const script = cmd === 'check' ? path.join(repo, 'scripts/install-check.mjs') : path.join(repo, 'dist/install.cjs');
  const argv = cmd === 'uninstall' ? ['--uninstall'] : cmd === 'install' ? args : [];
  const r = spawnSync(process.execPath, [script, ...argv], {
    cwd: repo, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...extraEnv },
  });
  const norm = (s) => s.split(repo).join('<REPO>').split(path.dirname(home)).join('<CASE>');
  return { step: step.join(' '), code: r.status, stdout: norm(r.stdout), stderr: norm(r.stderr) };
}

const results = [];
for (const c of CASES) {
  const sides = {};
  for (const [label, repo] of [['old', OLD], ['new', NEW]]) {
    const home = freshHome(c.name, c.missing ?? []);
    const extraEnv = c.setup(home, repo);
    const norm = (v) => String(v).split(repo).join('<REPO>');
    const steps = c.steps.map((s) => runOne(repo, home, extraEnv, s));
    sides[label] = { env: Object.fromEntries(Object.entries(extraEnv).map(([k, v]) => [k, norm(v).split(path.dirname(home)).join('<CASE>')])), steps, tree: tree(path.dirname(home)) };
  }
  const same = JSON.stringify(sides.old) === JSON.stringify(sides.new);
  const h = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
  results.push({
    case: c.name, identical: same, codes: sides.new.steps.map((s) => `${s.step} ⇒ ${s.code}`),
    // 一致时也留指纹：证明比的不是两份空输出
    fingerprints: sides.new.steps.map((s) => ({ step: s.step, stdout: `${s.stdout.length}B ${h(s.stdout)}`, stderr: `${s.stderr.length}B ${h(s.stderr)}` })),
    tree_files: sides.new.tree.length,
    ...(same ? {} : { old: sides.old, new: sides.new }),
  });
}
fs.rmSync(WORK, { recursive: true, force: true });
fs.writeFileSync(OUT, JSON.stringify({ old: OLD, new: NEW, cases: results.length, all_identical: results.every((r) => r.identical), results }, null, 2) + '\n');
console.log(results.map((r) => `${r.identical ? '✓' : '✗'} ${r.case}  ${r.codes.join(' ; ')}`).join('\n'));
