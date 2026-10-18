// A-2 doctor / preflight 新旧读数（主题 M12-共享根残留检测，计划 r2 §5）。形态照搬 evidence/m12-batch5-20261018/a23-readings.mjs 的 A-2 段。
// 零真实模型调用：doctor 带 --no-model-calls，预检带 --skip-auth-check，只会跑各家 CLI 的 --version。
// 扫描家目录一律经 TRIVIUM_ENTRY_SCAN_HOME 指向夹具，子进程的 HOME 也指向夹具（见 baseEnv），不读真实家目录。
// 用法：node a2-readings.mjs <旧仓库导出目录> <新仓库根> <输出 JSON>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const [OLD, NEW, OUT] = process.argv.slice(2);
const T = (p) => path.join(NEW, 'dist/test', p);
const { makeFixture } = await import(T('test/helpers/fixture.js'));
const YAML = createRequire(path.join(NEW, 'package.json'))('yaml');

const assetOf = (repo) => path.join(repo, 'skills/dual-critic');
const bundleIn = (asset) => path.join(asset, 'scripts/trivium.cjs');
const SCAN_ENV = 'TRIVIUM_ENTRY_SCAN_HOME';

function run(bundle, cwd, args, env) {
  const r = spawnSync(process.execPath, [bundle, ...args], { cwd, encoding: 'utf8', timeout: 240_000, env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
// 全部子进程（doctor、preflight、agy --version）共用一份隔离环境：HOME 指向夹具里单独的 home-cli/，
// 家目录覆盖类变量一律删掉、按格再设（代码三审 CODEX-01：原先只隔离了共享根扫描，HOME 仍是真实家目录）
let CLI_HOME = null;
const baseEnv = () => {
  const e = { ...process.env, HOME: CLI_HOME };
  for (const k of ['TRIVIUM_ASSET_ROOT', SCAN_ENV, 'CODEX_HOME', 'ZCODE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']) delete e[k];
  return e;
};
const tv = (repo, cwd, args, extra = {}) => run(bundleIn(assetOf(repo)), cwd, args, { ...baseEnv(), TRIVIUM_ASSET_ROOT: assetOf(repo), ...extra });
const lastJson = (s) => JSON.parse(s.slice(s.indexOf('{')));

const fx = await makeFixture({ topic: 'A2', draft: false });
CLI_HOME = path.join(path.dirname(fx.root), 'home-cli');
fs.mkdirSync(CLI_HOME, { recursive: true });
// 照搬本仓本机层的探针结论（只取 cli / host / generated_at，不拷 auth），让预检走得到只告警项
const local = YAML.parse(fs.readFileSync(path.join(NEW, '.trivium/config.local.yaml'), 'utf8'));
const probe = { generated_at: local.probe.generated_at, host: local.probe.host, cli: local.probe.cli };
const agyNow = spawnSync(probe.cli.agy.entrypoint, ['--version'], { encoding: 'utf8', env: baseEnv() }).stdout.trim().split('\n')[0];
const out = {
  isolation: { HOME: '<FX>/home-cli', removed: ['TRIVIUM_ASSET_ROOT', SCAN_ENV, 'CODEX_HOME', 'ZCODE_HOME', 'XDG_*'] },
  agy_version_fixture: { probe: probe.cli.agy.version, installed: agyNow },
};
probe.cli.agy.version = agyNow;
fs.writeFileSync(path.join(fx.root, '.trivium/config.local.yaml'), YAML.stringify({ probe }));

const FX = path.dirname(fx.root);
const mkHome = (name) => {
  const h = path.join(FX, `home-${name}`);
  fs.mkdirSync(path.join(h, '.agents/skills'), { recursive: true });
  return h;
};
const plant = (dir, md) => {
  fs.mkdirSync(dir, { recursive: true });
  if (md !== null) fs.writeFileSync(path.join(dir, 'SKILL.md'), md);
};
const runtimeCopy = (dir) => {
  plant(dir, '---\nname: dual-critic\ndescription: 过时的拷贝\n---\n');
  fs.mkdirSync(path.join(dir, 'schema'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
};
const homes = {
  clean: mkHome('clean'),
  entries: mkHome('entries'), // 只有同名入口（新旧应逐字相同）
  residue: mkHome('residue'), // 只有共享根残留
  mixed: mkHome('mixed'),
};
plant(path.join(homes.entries, '.agents/skills/dual-run'), '---\nname: dual-run\n---\n别家的\n');
plant(path.join(homes.entries, '.agents/skills/dual-status'), '---\nname: dual-status\n---\n./.trivium/bin/trivium\n');
runtimeCopy(path.join(homes.residue, '.agents/skills/dual-critic'));
plant(path.join(homes.residue, '.agents/skills/entry'), '---\nname: entry\ndescription: 别家的\n---\n'); // 别家 entry：不该报
runtimeCopy(path.join(homes.mixed, '.agents/skills/dual-critic'));
plant(path.join(homes.mixed, '.agents/skills/dual-run'), '---\nname: dual-run\n---\n别家的\n');

const norm = (s) => s.split(FX).join('<FX>');
const sharedW = (ws) => (ws ?? []).filter((w) => (typeof w === 'string' ? w : w.name).includes('共享读取面'));
const doc = (repo, home) => {
  const r = tv(repo, fx.root, ['doctor', '--only', 'env', '--no-model-calls', '--json'], { [SCAN_ENV]: home });
  const js = lastJson(r.stdout);
  return { code: r.code, blockers: js.blockers.length, shared_warnings: sharedW(js.warnings).map(norm) };
};
const pf = (repo, home, args) => {
  const r = tv(repo, fx.root, ['preflight', '--stage', 'plan', '--skip-auth-check', '--json', ...args], { [SCAN_ENV]: home });
  const js = lastJson(r.stdout);
  return { args: args.join(' '), code: r.code, ok: js.ok, shared: sharedW(js.warnings).map((w) => norm(w.detail)),
    failed: (js.checks ?? []).filter((c) => !c.ok).map((c) => c.name) };
};

const cells = [];
for (const [name, home] of Object.entries(homes)) {
  const o = doc(OLD, home), n = doc(NEW, home);
  cells.push({ kind: 'doctor', home: name, identical: JSON.stringify(o) === JSON.stringify(n), old: o, new: n });
}
// 不选 codex 当审核者：隔离 HOME 后夹具里没有 codex 的家目录配置，「档位组合合法」会先退 64；
// 那份配置含明文凭据，不拷进夹具。codex 读共享根这一侧由「codex 作 Driver」一格覆盖
const PF_ARGS = [
  ['--critics', 'gemini'], ['--critics', 'glm'], ['--driver', 'glm', '--critics', 'gemini'], ['--driver', 'codex', '--critics', 'gemini'],
];
for (const name of ['clean', 'entries', 'residue']) {
  for (const a of PF_ARGS) {
    const o = pf(OLD, homes[name], a), n = pf(NEW, homes[name], a);
    cells.push({ kind: 'preflight', home: name, args: a.join(' '), identical: JSON.stringify(o) === JSON.stringify(n), old: o, new: n });
  }
}
out.cells = cells;

// GLM-02：新产物的运行时根整棵放进夹具共享根的 dual-critic/，不设 TRIVIUM_ASSET_ROOT，
// ①从那份运行时里的 scripts/trivium.cjs 跑 doctor ⇒ 不报它；②从仓库产物跑（同一夹具、同样不设变量）⇒ 报它（§7 剩下的边界）
{
  const home = mkHome('self');
  const rt = path.join(home, '.agents/skills/dual-critic');
  fs.cpSync(assetOf(NEW), rt, { recursive: true, filter: (src) => path.basename(src) !== 'entry' || path.dirname(src) !== assetOf(NEW) });
  const env = { ...baseEnv(), [SCAN_ENV]: home };
  const self = run(bundleIn(rt), fx.root, ['doctor', '--only', 'env', '--no-model-calls', '--json'], env);
  const repoRun = run(bundleIn(assetOf(NEW)), fx.root, ['doctor', '--only', 'env', '--no-model-calls', '--json'], env);
  out.self_root = {
    from_shared_copy: { code: self.code, shared_warnings: sharedW(lastJson(self.stdout).warnings).map(norm) },
    from_repo_bundle: { code: repoRun.code, shared_warnings: sharedW(lastJson(repoRun.stdout).warnings).map(norm) },
  };
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
for (const c of cells) {
  const nw = c.kind === 'doctor' ? c.new.shared_warnings.length : c.new.shared.length;
  const ow = c.kind === 'doctor' ? c.old.shared_warnings.length : c.old.shared.length;
  console.log(`${c.identical ? '=' : '≠'} ${c.kind} ${c.home} ${c.args ?? ''}  code old/new ${c.old.code}/${c.new.code}  共享读取面条目 old/new ${ow}/${nw}`);
}
console.log('self_root', JSON.stringify(out.self_root));
