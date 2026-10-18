// A-1 安装器新旧对照（主题 M12-共享根残留检测，计划 r2 §5）。形态照搬 evidence/m12-batch5-20261018/a1-installer.mjs。
// 只写脚本所在目录下 a1/ 里的夹具家目录，不读写真实家目录；重放时先把本脚本拷到临时目录再跑。
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
  fs.rmSync(path.join(WORK, name), { recursive: true, force: true }); // 只删本脚本在 a1/ 下建的
  fs.mkdirSync(home, { recursive: true });
  for (const h of AGENT_HOMES) if (!missing.includes(h)) fs.mkdirSync(path.join(home, h), { recursive: true });
  return home;
}
const ours = (repo, agent, name) => fs.readFileSync(path.join(repo, 'skills/dual-critic/entry', agent, name, 'SKILL.md'), 'utf8');
function plant(dir, md) {
  fs.mkdirSync(dir, { recursive: true });
  if (md !== null) fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
}
/** 10-16 形态的运行时根拷贝：身份行 + schema/ + scripts/，不含 entry/ */
function runtimeCopy(dir) {
  plant(dir, '---\nname: dual-critic\ndescription: 过时的拷贝\n---\n');
  fs.mkdirSync(path.join(dir, 'schema'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'schema', 'x.json'), '{}');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'trivium.cjs'), '// 过时');
}
function tree(dir) {
  const out = [];
  const walk = (d, rel) => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { out.push(`${r}/`); walk(p, r); }
      // 运行时根里的编排器产物新旧本就不同（本主题改了它），只比在不在；夹具摆的过时拷贝只有几个字节，照常比内容
      else if (r.endsWith('scripts/trivium.cjs') && fs.statSync(p).size > 1024) out.push(`${r} <bundle>`);
      else out.push(`${r} ${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)}`);
    }
  };
  walk(dir, '');
  return out;
}

// group：same = 新旧应逐字相同；differ = 共享根有残留，新旧应不同
const CASES = [
  { group: 'same', name: 'clean-install', setup: () => ({}), steps: [['check'], ['install']] },
  { group: 'same', name: 'install-root-residue', setup: (home) => {
      plant(path.join(home, '.codex/skills/dual-critic'), null);
      return {};
    }, steps: [['check'], ['install']] },
  { group: 'same', name: 'install-root-entry-third-party', setup: (home) => {
      plant(path.join(home, '.codex/skills/entry'), '---\nname: entry\ndescription: 别家的\n---\n');
      return {};
    }, steps: [['check'], ['install']] },
  { group: 'same', name: 'shared-third-party-entry-and-dual-critic', setup: (home) => {
      plant(path.join(home, '.agents/skills/entry'), '---\nname: entry\ndescription: 别家的\n---\n');
      plant(path.join(home, '.agents/skills/dual-critic'), '---\nname: dual-critic\ndescription: 别家的，没有 schema/\n---\n');
      return {};
    }, steps: [['check'], ['install']] },
  { group: 'same', name: 'shared-same-name-third-party', setup: (home) => {
      plant(path.join(home, '.agents/skills/dual-status'), '---\nname: dual-status\ndescription: 用户自己的\n---\n');
      return {};
    }, steps: [['check'], ['install']] },
  { group: 'same', name: 'shared-foreign-entry', setup: (home, repo) => {
      plant(path.join(home, '.agents/skills/dual-status'), ours(repo, 'glm', 'dual-status'));
      return {};
    }, steps: [['check'], ['install']] },
  { group: 'same', name: 'runtime-foreign', setup: (home) => {
      const rt = path.join(home, '..', 'foreign-rt');
      fs.mkdirSync(rt, { recursive: true });
      fs.writeFileSync(path.join(rt, 'keep.txt'), 'x');
      return { TRIVIUM_ASSET_ROOT: rt };
    }, steps: [['install']] },
  { group: 'same', name: 'runtime-overlap', setup: (_home, repo) => ({ TRIVIUM_ASSET_ROOT: path.join(repo, 'skills/dual-critic') }), steps: [['install']] },
  { group: 'same', name: 'asset-root-in-shared', setup: (home) => ({ TRIVIUM_ASSET_ROOT: path.join(home, '.agents/skills/dual-critic') }),
    steps: [['install'], ['check'], ['install']] },
  { group: 'same', name: 'targets-missing-family', missing: ['.gemini'], setup: () => ({}), steps: [['install', '--targets', 'gemini'], ['install', '--targets', 'claude,glm']] },
  { group: 'differ', name: 'shared-runtime-copy-1016', setup: (home) => {
      runtimeCopy(path.join(home, '.agents/skills/dual-critic'));
      return {};
    }, steps: [['check'], ['install']] },
  { group: 'differ', name: 'shared-entry-subtree', setup: (home, repo) => {
      for (const n of ['dual-run', 'dual-status']) plant(path.join(home, '.agents/skills/entry/codex', n), ours(repo, 'codex', n));
      return {};
    }, steps: [['check'], ['install']] },
  { group: 'differ', name: 'shared-residue-and-foreign-entry', setup: (home, repo) => {
      runtimeCopy(path.join(home, '.agents/skills/dual-critic'));
      plant(path.join(home, '.agents/skills/dual-status'), ours(repo, 'glm', 'dual-status'));
      return {};
    }, steps: [['check'], ['install']] },
];

function runOne(repo, home, extraEnv, step) {
  const [cmd, ...args] = step;
  const script = cmd === 'check' ? path.join(repo, 'scripts/install-check.mjs') : path.join(repo, 'dist/install.cjs');
  const argv = cmd === 'install' ? args : [];
  const r = spawnSync(process.execPath, [script, ...argv], {
    cwd: repo, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...extraEnv },
  });
  const norm = (s) => s.split(repo).join('<REPO>').split(path.dirname(home)).join('<CASE>');
  return { step: step.join(' '), code: r.status, stdout: norm(r.stdout), stderr: norm(r.stderr) };
}

const h = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
const results = [];
for (const c of CASES) {
  const sides = {};
  for (const [label, repo] of [['old', OLD], ['new', NEW]]) {
    const home = freshHome(c.name, c.missing ?? []);
    const extraEnv = c.setup(home, repo);
    const before = tree(path.dirname(home));
    const norm = (v) => String(v).split(repo).join('<REPO>');
    const steps = c.steps.map((s) => runOne(repo, home, extraEnv, s));
    const after = tree(path.dirname(home));
    sides[label] = {
      env: Object.fromEntries(Object.entries(extraEnv).map(([k, v]) => [k, norm(v).split(path.dirname(home)).join('<CASE>')])),
      steps, tree: after, unchanged: JSON.stringify(before) === JSON.stringify(after),
    };
  }
  const same = JSON.stringify(sides.old) === JSON.stringify(sides.new);
  const sharedLines = (side) => side.steps.flatMap((s) => s.stdout.split('\n').concat(s.stderr.split('\n')))
    .filter((l) => l.includes('整棵拷贝'));
  results.push({
    group: c.group, case: c.name, identical: same,
    expected: c.group === 'same' ? same : !same,
    codes: { old: sides.old.steps.map((s) => `${s.step} ⇒ ${s.code}`), new: sides.new.steps.map((s) => `${s.step} ⇒ ${s.code}`) },
    // 一致时也留指纹：证明比的不是两份空输出
    fingerprints: sides.new.steps.map((s) => ({ step: s.step, stdout: `${s.stdout.length}B ${h(s.stdout)}`, stderr: `${s.stderr.length}B ${h(s.stderr)}` })),
    tree_entries: sides.new.tree.length,
    new_tree_unchanged: sides.new.unchanged,
    ...(c.group === 'differ' ? { new_shared_residue_lines: sharedLines(sides.new).length, old_shared_residue_lines: sharedLines(sides.old).length } : {}),
    ...(same ? {} : { old: sides.old, new: sides.new }),
  });
}
fs.rmSync(WORK, { recursive: true, force: true });
fs.writeFileSync(OUT, JSON.stringify({
  old: OLD, new: NEW, cases: results.length, all_as_expected: results.every((r) => r.expected), results,
}, null, 2) + '\n');
console.log(results.map((r) => `${r.expected ? '✓' : '✗'} [${r.group}] ${r.case}  old: ${r.codes.old.join(' ; ')}  new: ${r.codes.new.join(' ; ')}${r.group === 'differ' ? `  新树不变=${r.new_tree_unchanged}` : ''}`).join('\n'));
