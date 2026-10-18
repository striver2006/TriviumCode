// 新旧对照验收（主题 doctor旗标提示与start共享根检查，计划 r2 §4）。形态照搬 evidence/m12-shared-residue-20261018/a2-readings.mjs。
// 零真实模型调用：doctor 只跑 --only env --no-model-calls；review --start 走桩审查员（TRIVIUM_STUB_CRITIC）。
// 全部子进程共用一份隔离环境：HOME 指向夹具里单独的 home-cli/，家目录覆盖类变量一律删掉；
// 共享根扫描另经 TRIVIUM_ENTRY_SCAN_HOME 指向各格的夹具家目录。不读真实家目录。
// 用法：node a-readings.mjs <旧仓库导出目录> <新仓库根> <输出 JSON>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [OLD, NEW, OUT] = process.argv.slice(2);
const T = (p) => path.join(NEW, 'dist/test', p);
const { makeFixture } = await import(T('test/helpers/fixture.js'));
const { encodeStubConfig, STUB_ENV_VAR } = await import(T('src/trivium/adapters/stub.js'));

const assetOf = (repo) => path.join(repo, 'skills/dual-critic');
const bundleIn = (asset) => path.join(asset, 'scripts/trivium.cjs');
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const SCAN_ENV = 'TRIVIUM_ENTRY_SCAN_HOME';
const STUB = encodeStubConfig({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } });

let CLI_HOME = null;
const baseEnv = () => {
  const e = { ...process.env, HOME: CLI_HOME };
  for (const k of ['TRIVIUM_ASSET_ROOT', SCAN_ENV, STUB_ENV_VAR, 'CODEX_HOME', 'ZCODE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME']) delete e[k];
  return e;
};
function tv(repo, cwd, args, extra = {}) {
  const r = spawnSync(process.execPath, [bundleIn(assetOf(repo)), ...args], {
    cwd, encoding: 'utf8', timeout: 240_000, env: { ...baseEnv(), TRIVIUM_ASSET_ROOT: assetOf(repo), ...extra },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const lastJson = (s) => JSON.parse(s.slice(s.indexOf('{')));

const out = {
  bundles: { old: sha(bundleIn(assetOf(OLD))), new: sha(bundleIn(assetOf(NEW))) },
  isolation: { HOME: '<FX>/home-cli', removed: ['TRIVIUM_ASSET_ROOT', SCAN_ENV, STUB_ENV_VAR, 'CODEX_HOME', 'ZCODE_HOME', 'XDG_*'] },
};
if (out.bundles.old === out.bundles.new) throw new Error('新旧 bundle 哈希相同：对照无效');

// 扫描家目录：干净、摆了别家同名入口（codex / glm 读的 ~/.agents/skills）
async function homes(base) {
  const clean = path.join(base, 'scan-clean');
  const dirty = path.join(base, 'scan-dirty');
  fs.mkdirSync(path.join(clean, '.agents/skills'), { recursive: true });
  fs.mkdirSync(path.join(dirty, '.agents/skills/dual-approve'), { recursive: true });
  fs.writeFileSync(path.join(dirty, '.agents/skills/dual-approve/SKILL.md'), '---\nname: dual-approve\n---\n别家的\n');
  return { clean, dirty };
}

// 规范化：夹具路径、run_id、pid、ISO 时间戳、构建标识（新旧必然不同，单列比对之外）
const norm = (s, fx) => s
  .split(fx).join('<FX>')
  .replace(/\d{8}T\d{6}Z/g, '<RUN>')
  // 运行根下的项目目录名按项目根路径取哈希（新旧各用一个夹具，必然不同）
  .replace(/\/runs\/repo-[0-9a-f]{8}\//g, '/runs/repo-<HASH>/')
  .replace(/("worker_pid":\s*)\d+/g, '$1"<PID>"')
  .replace(/工作进程 pid \d+/g, '工作进程 pid <PID>')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TS>')
  .replace(/编排器构建标识[^\n"]*/g, '编排器构建标识<STAMP>');

// ── A-1 doctor ──────────────────────────────────────────────────────
const HINT = '以下命令行覆盖本次没有用上';
const FLAGS = ['--model-gemini', 'x', '--tier-glm', 'high', '--effort-glm', 'high'];
const a1 = [];
{
  const fx = await makeFixture({ topic: 'A1', draft: false });
  const FX = path.dirname(fx.root);
  CLI_HOME = path.join(FX, 'home-cli');
  fs.mkdirSync(CLI_HOME, { recursive: true });
  const { clean } = await homes(FX);
  const doc = (repo, extra, json) => {
    const r = tv(repo, fx.root, ['doctor', '--only', 'env', '--no-model-calls', ...extra, ...(json ? ['--json'] : [])], { [SCAN_ENV]: clean });
    return { code: r.code, stdout: norm(r.stdout, FX), stderr: norm(r.stderr, FX) };
  };
  for (const json of [true, false]) {
    for (const withFlags of [false, true]) {
      const o = doc(OLD, withFlags ? FLAGS : [], json);
      const n = doc(NEW, withFlags ? FLAGS : [], json);
      const cell = { cell: `doctor ${json ? '--json' : '人读'} ${withFlags ? '带覆盖' : '不带覆盖'}`, old_code: o.code, new_code: n.code };
      if (!withFlags) {
        cell.identical = o.code === n.code && o.stdout === n.stdout && o.stderr === n.stderr;
        cell.expect = '逐字节相同';
        cell.as_expected = cell.identical;
      } else if (json) {
        const oj = lastJson(o.stdout), nj = lastJson(n.stdout);
        const hint = nj.warnings.at(-1);
        cell.keys_same = JSON.stringify(Object.keys(oj).sort()) === JSON.stringify(Object.keys(nj).sort());
        cell.old_warnings = oj.warnings.length;
        cell.new_warnings = nj.warnings.length;
        cell.rest_identical = JSON.stringify({ ...oj, warnings: oj.warnings }) === JSON.stringify({ ...nj, warnings: nj.warnings.slice(0, -1) });
        cell.hint = hint;
        cell.expect = '退出码相同、顶层键相同、warnings 恰多末尾一条提示、其余逐字节相同';
        cell.as_expected = o.code === n.code && cell.keys_same && cell.rest_identical && typeof hint === 'string' && hint.startsWith(HINT);
      } else {
        const ol = (o.stdout + o.stderr).split('\n'), nl = (n.stdout + n.stderr).split('\n');
        const extra = nl.filter((l) => !ol.includes(l));
        const missing = ol.filter((l) => !nl.includes(l));
        cell.lines_only_in_new = extra;
        cell.lines_only_in_old = missing;
        cell.expect = '退出码相同；新版多出的只有提示几行（及其后的空行），旧版行一条不少';
        cell.as_expected = o.code === n.code && missing.length === 0 && extra.length > 0 && extra.some((l) => l.includes(HINT))
          && extra.every((l) => l.includes(HINT) || l.startsWith('  · ') || l.trim() === '');
      }
      a1.push(cell);
    }
  }
}
out.a1 = a1;

// ── A-2 review --start（桩）──────────────────────────────────────────
const a2 = [];
let n = 0;
async function startCell(repo, json, scan) {
  const topic = 'A2';
  const fx = await makeFixture({ topic });
  const FX = path.dirname(fx.root);
  CLI_HOME = path.join(FX, 'home-cli');
  fs.mkdirSync(CLI_HOME, { recursive: true });
  const h = await homes(FX);
  const extra = { [SCAN_ENV]: h[scan], [STUB_ENV_VAR]: STUB };
  const r = tv(repo, fx.root, ['review', '--start', '--stage', 'plan', '--topic', topic, '--focus', 'x', ...(json ? ['--json'] : [])], extra);
  const runId = json ? lastJson(r.stdout).run_id : /已启动运行 (\S+)（/.exec(r.stdout)?.[1];
  // 等到终态，别让 worker 留在后台
  let code = 73;
  for (let i = 0; i < 12 && code === 73; i++) code = tv(repo, fx.root, ['review', '--wait', runId, '--timeout', '20'], extra).code;
  n++;
  return { code: r.code, wait_code: code, stdout: norm(r.stdout, FX), stderr: norm(r.stderr, FX) };
}
for (const json of [true, false]) {
  for (const scan of ['clean', 'dirty']) {
    const o = await startCell(OLD, json, scan);
    const nw = await startCell(NEW, json, scan);
    const cell = { cell: `--start ${json ? '--json' : '人读'} 扫描家目录${scan === 'clean' ? '干净' : '有同名入口'}`, old_code: o.code, new_code: nw.code, old_wait: o.wait_code, new_wait: nw.wait_code };
    if (scan === 'clean') {
      cell.identical = o.code === nw.code && o.stdout === nw.stdout && o.stderr === nw.stderr;
      cell.expect = '规范化后逐字节相同（焦点 4）';
      cell.as_expected = cell.identical;
      if (!cell.identical) cell.diff = { old: o, new: nw };
    } else if (json) {
      const oj = lastJson(o.stdout), nj = lastJson(nw.stdout);
      cell.old_warnings = oj.warnings;
      cell.new_warnings = nj.warnings;
      cell.rest_identical = JSON.stringify({ ...oj, warnings: [] }) === JSON.stringify({ ...nj, warnings: [] }) && o.stderr === nw.stderr;
      cell.expect = '旧版无此项；新版恰一项「共享读取面同名入口」，结尾「本次运行」；其余相同';
      cell.as_expected = o.code === nw.code && oj.warnings.length === 0 && nj.warnings.length === 1
        && nj.warnings[0].name === '共享读取面同名入口' && nj.warnings[0].detail.endsWith('（不影响本次运行）') && cell.rest_identical;
    } else {
      const ol = o.stdout.split('\n'), nl = nw.stdout.split('\n');
      cell.lines_only_in_new = nl.filter((l) => !ol.includes(l));
      cell.lines_only_in_old = ol.filter((l) => !nl.includes(l));
      cell.expect = '新版恰多一行告警，其余行相同';
      cell.as_expected = o.code === nw.code && cell.lines_only_in_old.length === 0 && cell.lines_only_in_new.length === 1
        && cell.lines_only_in_new[0].startsWith('  ⚠️ 共享读取面') && o.stderr === nw.stderr;
    }
    a2.push(cell);
  }
}
out.a2 = a2;
out.starts = n;
out.all_as_expected = [...a1, ...a2].every((c) => c.as_expected);
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`all_as_expected=${out.all_as_expected}（A-1 ${a1.length} 格、A-2 ${a2.length} 格）`);
for (const c of [...a1, ...a2]) console.log(`${c.as_expected ? '✓' : '✗'} ${c.cell}`);
