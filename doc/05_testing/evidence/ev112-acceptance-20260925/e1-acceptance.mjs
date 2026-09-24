#!/usr/bin/env node
/**
 * EV-112 E1（计划 r3 §6.3）：零配额验收。代码提交 `1d80e23` 之后、干净工作树 build + install:local 之后跑。
 *
 *   N  无副本支，经 `zcodeAdapter.run`（`model: null`，`HOME` = 假 HOME）：CLI 产物应落在 `<C>/glm/home/.zcode/cli/…`，假 HOME 下没有
 *   A / B  无副本形态，经 `invokeZcode` 直调：只差 `storageRedirectRoot` 给不给（E0 那一对的重复取样，看 stderr 首行差异）
 *   C / D  副本支对照：同一份新代码，`prepareZcodeHome(…, { requestedFirst: true })` 各造一份副本，只差 `storageRedirectRoot` 给不给
 *          ⇒ 两者「模型调用前写出的落盘集合」应逐字相同（D2-(a) 的旁证）
 *   每组 3 次，每次新的 mkdtemp HOME，组间交替顺序（偶数轮 A B C D，奇数轮 B A D C），排除冷热缓存与固定先后
 *
 * 零配额：假 HOME 里只放合成的 `cli/config.json`（custom provider，`baseURL` 指向本脚本起的 127.0.0.1 服务，apiKey 是哨兵），
 * 本地服务对一切请求回 401。**不读任何真实配置的值**。
 *
 * 纪律（2026-09-20 事故 R1 / R8；计划 r3 §6.3）：
 * - 所有目录来自 `mkdtemp`；脚本**不含任何删除调用**，临时目录由用户决定去留；
 * - 宿主预置了任何 `ZCODE_*` 键即停止、不出读数（GLM-05）；
 * - 所有 argv 元素不得匹配包内 beta 改写的 argv 判据（CODEX-06；EV-112 代码双审 r1 实证过它会被送审文本触发）；
 * - 对真实 HOME 只读：按内容查本次会话，只输出文件名与计数，不输出内容；
 * - 最后跑一次 `trivium doctor --only zcode --no-model-calls`（零配额），只摘 EV-110 / EV-112 两条 note 的有无。
 *
 * 用法：node doc/05_testing/evidence/ev112-acceptance-20260925/e1-acceptance.mjs
 * 输出：同目录 e1-output.json
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium', p)).href);

const {
  zcodeAdapter, invokeZcode, prepareZcodeHome, readonlyArgsFromProbe, zcodeHomeUnder,
  ZCODE_BETA_ARGV_RE, ZCODE_DIR_ENV_KEYS, ZCODE_LANDING_SWITCH_ENV_KEYS,
} = await mod('adapters/zcode.js');
const { ZCODE_PROBE_SENTINEL_KEY } = await mod('probes/zcode.js');
const { redactSecrets } = await mod('secrets.js');
const { loadCtx } = await mod('config.js');

const ENTRY = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const NODE = process.execPath;
const PROMPT = '只回复 OK 两个字母，不要调用任何工具。';
const REAL_HOME = os.userInfo().homedir;
const ROUNDS = 3;

// ── 前置：宿主环境 ──
const hostZcodeKeys = Object.keys(process.env).filter((k) => k.startsWith('ZCODE_'));
if (hostZcodeKeys.length > 0) {
  console.error(`宿主预置了 ${hostZcodeKeys.join(' / ')}：两组的差异不止三键，停止、不出读数`);
  process.exit(2);
}

// ── 本地 401 服务 ──
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`);
  req.resume();
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'e1 local sentinel: unauthorized', type: 'invalid_request_error', code: 'invalid_api_key' } }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// 字段形态照本机 cli/config.json 的 custom provider（E0 已核：只看键名与 kind / source）
function syntheticCliConfig() {
  return {
    provider: {
      'e1-local': {
        name: 'E1 Local', kind: 'anthropic', source: 'custom', enabled: true,
        models: {
          'e1-model': {
            reasoning: { enabled: true, variants: ['low', 'max', 'high'], defaultVariant: 'max' },
            limit: { context: 200000, output: 8192 },
            modalities: { input: ['text'], output: ['text'] },
            zcode: { modified: false, priority: 99 },
          },
        },
        options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKeyRequired: true, ['api' + 'Key']: ZCODE_PROBE_SENTINEL_KEY },
      },
    },
    model: { main: 'e1-local/e1-model', lite: 'e1-local/e1-model' },
  };
}

const ctx = await loadCtx({ cwd: ROOT });
const readonlyArgs = readonlyArgsFromProbe(ctx.config.probe.cli.zcode?.readonly_flags ?? ['--mode plan', '--disallowed-tools x']);

const mk = (tag) => fs.mkdtemp(path.join(os.tmpdir(), `ev112-e1-${tag}-`));
async function fakeHome(tag) {
  const home = await mk(`${tag}-home`);
  await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
  await fs.writeFile(path.join(home, '.zcode/cli/config.json'), JSON.stringify(syntheticCliConfig(), null, 2), { encoding: 'utf8', mode: 0o600 });
  return home;
}

/** 递归列文件（相对路径）；`plugins` 子树只计数 */
async function listTree(root) {
  const files = [];
  let pluginFiles = 0;
  async function walk(dir, inPlugins) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs);
      const plug = inPlugins || /(^|\/)cli\/plugins$/.test(rel);
      if (e.isDirectory()) await walk(abs, plug);
      else if (plug) pluginFiles++;
      else files.push(rel);
    }
  }
  await walk(root, false);
  return { files: files.sort(), pluginFiles };
}

const carrierOf = (rel) => {
  const m = /\.zcode(?:-beta)?\/cli\/(log|rollout|debug|db|artifacts|memories|sessions)\//.exec(rel);
  return m ? m[1] : null;
};
const sessionOf = (files) => files.map((f) => /model-io-(.+)\.jsonl$/.exec(f)?.[1]).find(Boolean) ?? null;

async function builtinFiles(home) {
  const t = await listTree(path.join(home, '.zcode/v2'));
  const out = [];
  for (const f of t.files.filter((f) => /zcode-builtin[^/]*\.json$/.test(f))) {
    out.push({ file: f, mtime: (await fs.stat(path.join(home, '.zcode/v2', f))).mtime.toISOString() });
  }
  return out;
}

function assertArgvClean(args) {
  const bad = args.filter((a) => ZCODE_BETA_ARGV_RE.test(a));
  if (bad.length > 0) throw new Error(`argv 命中 beta 改写判据（CODEX-06），停止：${bad.length} 个元素`);
}

async function withHome(home, fn) {
  const saved = process.env['HOME'];
  process.env['HOME'] = home;
  try { return await fn(); } finally { if (saved === undefined) delete process.env['HOME']; else process.env['HOME'] = saved; }
}

async function summarize(label, home, landing, r) {
  const homeTree = await listTree(home);
  const landTree = landing ? await listTree(landing) : null;
  const all = [...homeTree.files, ...(landTree?.files ?? [])];
  const pick = (tree) => {
    const c = {};
    for (const f of tree.files) { const k = carrierOf(f); if (k) c[k] = (c[k] ?? 0) + 1; }
    return c;
  };
  const stderr = redactSecrets(r?.stderr ?? '').content;
  return {
    label,
    exit_code: r?.exitCode ?? r?.exit_code ?? null,
    stderr_first_line: stderr.split('\n')[0] ?? '',
    stderr_redacted: stderr,
    session_id: sessionOf(all),
    home_carriers: pick(homeTree),
    landing_carriers: landTree ? pick(landTree) : null,
    home_plugin_files: homeTree.pluginFiles,
    landing_plugin_files: landTree ? landTree.pluginFiles : null,
    home_beta_dir: homeTree.files.some((f) => f.startsWith('.zcode-beta/')),
    home_files: homeTree.files,
    landing_files: landTree ? landTree.files : null,
    builtin_files: await builtinFiles(home),
  };
}

// ── 无副本形态（A / B）：invokeZcode 直调 ──
async function noCopy(label, redirect) {
  const home = await fakeHome(label);
  const proj = await mk(`${label}-proj`);
  const landing = redirect ? zcodeHomeUnder(await mk(`${label}-side`)) : null;
  assertArgvClean([ENTRY, PROMPT, proj, ...(landing ? [landing] : [])]);
  hits.length = 0;
  const r = await withHome(home, () => invokeZcode({
    entry: ENTRY, node: NODE, cwd: proj, prompt: PROMPT, readonlyArgs,
    homeDir: null, userHome: home, storageRedirectRoot: landing, timeoutMs: 120_000,
  }));
  return { ...(await summarize(label, home, landing, r)), model_requests: [...hits] };
}

// ── 副本支（C / D）：同一份新代码，只差 storageRedirectRoot ──
async function copy(label, redirect) {
  const src = await fakeHome(`${label}-src`);
  const side = await mk(`${label}-side`);
  const proj = await mk(`${label}-proj`);
  const prep = await prepareZcodeHome(side, 'e1-model', {
    srcConfig: path.join(src, '.zcode/cli/config.json'), requestedFirst: true,
  });
  if (prep.homeDir === null || prep.route !== 'config_copy') throw new Error(`${label}：副本没建成（${prep.reason ?? prep.route}）`);
  assertArgvClean([ENTRY, PROMPT, proj, prep.homeDir]);
  hits.length = 0;
  const r = await invokeZcode({
    entry: ENTRY, node: NODE, cwd: proj, prompt: PROMPT, readonlyArgs,
    homeDir: prep.homeDir, userHome: src, omitPersonalProviderConfig: true,
    storageRedirectRoot: redirect ? prep.homeDir : null, timeoutMs: 120_000,
  });
  const s = await summarize(label, prep.homeDir, null, r);
  return { ...s, qualified: prep.qualified, reorder: prep.reorder, model_requests: [...hits] };
}

// ── N：无副本支经 zcodeAdapter.run ──
async function adapterNoCopy() {
  const home = await fakeHome('N');
  const runDir = await mk('N-run');
  const sideDir = path.join(runDir, 'glm');
  const proj = await mk('N-proj');
  assertArgvClean([ENTRY, PROMPT, proj]);
  const cfg = structuredClone(ctx.config);
  cfg.probe.cli.zcode.entrypoint = ENTRY;
  const req = {
    run_id: 'e1', topic: 'e1', stage: 'code', critic: 'glm',
    project_root: proj, subject_path: path.join(proj, 's.md'), deny_paths: [],
    out_dir: path.join(sideDir, 'out'), brief_path: path.join(proj, 'b.md'), brief_text: PROMPT,
    model: null, timeout_s: 120, schema_path: path.join(proj, 'schema.json'),
    min_tool_calls: 0, min_project_reads: 0, profile_requested: null,
  };
  hits.length = 0;
  const result = await withHome(home, () => zcodeAdapter.run({ cfg, nodePath: NODE }, req));
  const s = await summarize('N', home, zcodeHomeUnder(sideDir), { exitCode: result.exit_code, stderr: result.fail_reason ?? '' });
  return {
    ...s,
    status: result.status,
    model_route: result.model_route ?? null,
    carriers_landed: result.carriers_landed ?? '（缺席：失败早退，走不到自检，符合计划 r3 §6.3）',
    model_requests: [...hits],
  };
}

// ── 真实 HOME 只读核：按内容查本次各会话，只出文件名与计数 ──
async function realHomeCheck(sessionIds) {
  const cli = path.join(REAL_HOME, '.zcode/cli');
  const names = async (d) => { try { return await fs.readdir(path.join(cli, d)); } catch { return []; } };
  const out = { log_files_with_session: [], rollout_names: [], artifacts_dirs: [], sessions_dirs: [], db_hits: {}, beta_dir: null, mailbox_dir: null };
  for (const f of (await names('log')).filter((n) => n.endsWith('.jsonl'))) {
    const text = await fs.readFile(path.join(cli, 'log', f), 'utf8').catch(() => '');
    const n = sessionIds.filter((s) => text.includes(s)).length;
    if (n > 0) out.log_files_with_session.push({ file: f, sessions: n });
  }
  out.rollout_names = (await names('rollout')).filter((n) => sessionIds.some((s) => n.includes(s)));
  out.artifacts_dirs = (await names('artifacts')).filter((n) => sessionIds.includes(n));
  out.sessions_dirs = (await names('sessions')).filter((n) => sessionIds.includes(n));
  for (const f of (await names('db')).filter((n) => n.startsWith('db.sqlite'))) {
    const buf = await fs.readFile(path.join(cli, 'db', f)).catch(() => Buffer.alloc(0));
    const text = buf.toString('latin1');
    out.db_hits[f] = sessionIds.reduce((acc, s) => acc + text.split(s).length - 1, 0);
  }
  const stamp = async (p) => { try { return (await fs.stat(p)).mtime.toISOString(); } catch { return null; } };
  out.beta_dir = await stamp(path.join(REAL_HOME, '.zcode-beta'));
  out.mailbox_dir = await stamp(path.join(REAL_HOME, '.zcode/mailbox'));
  return out;
}

// ── doctor（零配额）：只摘两条 note 的有无 ──
async function doctorNotes() {
  const bin = path.join(ROOT, '.trivium', 'bin', 'trivium');
  const child = spawn(bin, ['doctor', '--only', 'zcode', '--no-model-calls'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((r) => child.on('close', r));
  return {
    exit_code: code,
    host_landing_note: out.includes('所有拉起路径都已清掉它们'),
    beta_entry_note: out.includes('ZCode 入口在 beta 渠道路径下'),
    legacy_persist_wording: out.includes('持久留存'),
  };
}

// ── 执行 ──
const runs = [];
runs.push(await adapterNoCopy());
for (let i = 0; i < ROUNDS; i++) {
  const order = i % 2 === 0 ? ['A', 'B', 'C', 'D'] : ['B', 'A', 'D', 'C'];
  for (const g of order) {
    const label = `${g}${i + 1}`;
    if (g === 'A') runs.push(await noCopy(label, false));
    if (g === 'B') runs.push(await noCopy(label, true));
    if (g === 'C') runs.push(await copy(label, false));
    if (g === 'D') runs.push(await copy(label, true));
  }
}
server.close();

const sessionIds = runs.map((r) => r.session_id).filter(Boolean);
const byLabel = Object.fromEntries(runs.map((r) => [r.label, r]));

// 副本支对照：C / D 同轮比落盘集合（相对副本 HOME 的路径，去掉会话 id 与日期差异）
const norm = (files, sid) => files.map((f) => (sid ? f.split(sid).join('<sid>') : f)).map((f) => f.replace(/\d{4}-\d{2}-\d{2}/g, '<date>')).sort();
const copyCompare = [];
for (let i = 1; i <= ROUNDS; i++) {
  const c = byLabel[`C${i}`], d = byLabel[`D${i}`];
  const cs = norm(c.home_files, c.session_id), ds = norm(d.home_files, d.session_id);
  const rolloutPrefix = (x) => x.home_files.find((f) => /model-io-/.test(f))?.replace(/model-io-.*$/, '') ?? null;
  copyCompare.push({
    round: i,
    same_file_set: JSON.stringify(cs) === JSON.stringify(ds),
    only_in_C: cs.filter((f) => !ds.includes(f)),
    only_in_D: ds.filter((f) => !cs.includes(f)),
    same_plugin_count: c.home_plugin_files === d.home_plugin_files,
    rollout_prefix_C: rolloutPrefix(c),
    rollout_prefix_D: rolloutPrefix(d),
  });
}

const n = byLabel['N'];
const verdicts = {
  N_landed_in_run_dir: ['log', 'rollout', 'db'].every((k) => (n.landing_carriers?.[k] ?? 0) > 0),
  N_nothing_in_fake_home: ['log', 'rollout', 'db', 'artifacts', 'memories', 'sessions', 'debug'].every((k) => !n.home_carriers[k]),
  B_landed_in_root_all_rounds: [1, 2, 3].every((i) => ['log', 'rollout', 'db'].every((k) => (byLabel[`B${i}`].landing_carriers?.[k] ?? 0) > 0)),
  B_nothing_in_fake_home_all_rounds: [1, 2, 3].every((i) => ['log', 'rollout', 'db'].every((k) => !byLabel[`B${i}`].home_carriers[k])),
  A_in_fake_home_all_rounds: [1, 2, 3].every((i) => ['log', 'rollout', 'db'].every((k) => (byLabel[`A${i}`].home_carriers[k] ?? 0) > 0)),
  copy_layout_same_all_rounds: copyCompare.every((x) => x.same_file_set && x.same_plugin_count && x.rollout_prefix_C === x.rollout_prefix_D),
  no_beta_dir_anywhere: runs.every((r) => !r.home_beta_dir),
  every_run_hit_local_server_only: runs.every((r) => r.model_requests.length > 0),
};

const realHome = await realHomeCheck(sessionIds);
verdicts.real_home_untouched =
  realHome.log_files_with_session.length === 0 && realHome.rollout_names.length === 0 &&
  realHome.artifacts_dirs.length === 0 && realHome.sessions_dirs.length === 0 &&
  Object.values(realHome.db_hits).every((x) => x === 0);

const stderrSampling = runs.map((r) => ({ label: r.label, first_line: r.stderr_first_line, builtin_files: r.builtin_files.map((b) => b.file) }));
const doctor = await doctorNotes();

const result = {
  generated_at: new Date().toISOString(),
  entry: ENTRY, node: NODE, node_version: process.version,
  host_zcode_env_keys: hostZcodeKeys,
  cleared_keys: [...ZCODE_DIR_ENV_KEYS, ...ZCODE_LANDING_SWITCH_ENV_KEYS],
  local_server: `127.0.0.1:${port}（一律回 401）`,
  verdicts,
  copy_compare: copyCompare,
  stderr_sampling: stderrSampling,
  real_home: realHome,
  doctor,
  runs,
};
await fs.writeFile(path.join(HERE, 'e1-output.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ verdicts, copy_compare: copyCompare.map((x) => ({ round: x.round, same: x.same_file_set })), doctor }, null, 2));
