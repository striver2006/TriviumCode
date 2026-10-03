// 「doctor探针走副本HOME」（EV-194）改前改后真实对照（计划 r2 §6.3；用户 2026-10-03 授权配额，上限四次真实调用）。
//
// 一次性脚本：第一次真实调用之前落防重跑锁 <基目录>/.acceptance-ran，锁在就拒跑——判据写死、不达标不调措辞重跑。
// 用法（在仓库根，先 node scripts/build.mjs 让当前工作树的 bundle 是最新的；全量与变异都不在跑）：
//   node doc/05_testing/evidence/doctor-probe-home-20261003/acceptance.mjs <基目录（scratchpad 下）> <读数 JSON 路径>
//
// 做什么：
//   1. 改前构建：git archive 292fa79 导出到 <基目录>/old-src、node_modules 软链仓库、构建；改后构建即仓库当前的 bundle。
//      两份 bundle 记 sha256 并断言不同。
//   2. 两个独立的临时项目（git init + 仓库 .trivium 的 config.yaml / config.local.yaml 拷贝），仓库里的探针结论文件不动。
//      跑前把临时项目里 zcode 段的 response_field / model_id_form / path_deny.method 改成哨兵，「被刷新」才可判。
//   3. 开跑前读档位 glm.plan（active_profile）并按副本源 provider 键限定，作为判据里的「档位模型」；
//      只读核个人配置的 defaultModelSelection 一个键（故障现场是否还在）。
//   4. 各跑一次 `node <bundle> doctor --only zcode --json`；每次前后列真实 ~/.zcode/cli/{log,rollout}（名、大小、mtime）。
//   5. 判据（写死）：
//      改前：headless 报 Model creation failed；
//      改后：①headless 通过（无失败 note、有 envelope note）；②「探的是」那行写的是档位模型；
//           ③response_field 刷新为 response，model_id_form 刷新且 modelId 段 = 档位 modelId、前缀 = 副本源 provider 键；
//           ④改后那次跑前后真实 log 与 rollout 的文件数不变（大小 / mtime 只作补充读数）。
//      改前不复现：判「不可对照」，改后照跑（其判据独立），不追加调用。
// 输出里的家目录一律归一成 ~。不打印任何配置文件的值，只取上面点名的键。
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO = process.cwd();
const BASE = process.argv[2];
const OUT = process.argv[3];
if (!BASE || !OUT) throw new Error('用法：node acceptance.mjs <基目录> <读数 JSON 路径>');
const require = createRequire(path.join(REPO, 'package.json'));
const YAML = require('yaml');

const OLD_COMMIT = '292fa79';
const HOME = os.homedir();
const tilde = (s) => String(s).split(HOME).join('~');
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

fs.mkdirSync(BASE, { recursive: true });
// 锁在第一次真实调用之前才落：准备步骤（导出、构建、读配置）失败不花配额，不该占掉这一次
const LOCK = path.join(BASE, '.acceptance-ran');
if (fs.existsSync(LOCK)) {
  console.error(`锁 ${LOCK} 在：本对照已跑过一次，判据写死、不重跑。`);
  process.exit(3);
}

const readout = { started_at: new Date().toISOString(), old_commit: OLD_COMMIT };

// ── 1. 两份 bundle ──
const oldSrc = path.join(BASE, 'old-src');
fs.mkdirSync(oldSrc);
execSync(`git archive ${OLD_COMMIT} | tar -x -C ${JSON.stringify(oldSrc)}`, { cwd: REPO, stdio: 'ignore' });
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(oldSrc, 'node_modules'));
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: oldSrc, stdio: 'ignore' });
const BUNDLE_REL = 'skills/dual-critic/scripts/trivium.cjs';
const oldBundle = path.join(oldSrc, BUNDLE_REL);
const newBundle = path.join(REPO, BUNDLE_REL);
readout.bundles = { old: { path: tilde(oldBundle), sha256: sha(oldBundle) }, new: { path: tilde(newBundle), sha256: sha(newBundle) } };
if (readout.bundles.old.sha256 === readout.bundles.new.sha256) throw new Error('改前改后 bundle 相同，对照无意义');

// ── 3. 档位模型与故障现场（只取点名的键）──
const repoCfg = YAML.parse(fs.readFileSync(path.join(REPO, '.trivium/config.yaml'), 'utf8'));
const active = repoCfg.active_profile ?? 'default';
const planModel = repoCfg.profiles?.[active]?.glm?.plan ?? null;
if (!planModel) throw new Error('档位没给 glm.plan，本对照前提不成立');
const cliCfg = JSON.parse(fs.readFileSync(path.join(HOME, '.zcode/cli/config.json'), 'utf8'));
const owners = Object.entries(cliCfg.provider ?? {}).filter(([, p]) => Object.keys(p?.models ?? {}).includes(planModel)).map(([k]) => k);
if (owners.length !== 1) throw new Error(`档位模型 ${planModel} 在副本源里的拥有者不是恰好一个：${owners.length}`);
const qualified = `${owners[0]}/${planModel}`;
const personal = JSON.parse(fs.readFileSync(path.join(HOME, '.zcode/v2/provider_config.json'), 'utf8'));
readout.premise = {
  active_profile: active,
  plan_model: planModel,
  qualified,
  personal_default_selection: personal?.config?.defaultModelSelection ?? null,
};

// ── 2. 临时项目 ──
const SENT = { response_field: null, model_id_form: 'pre-run/SENTINEL', method: 'pre-run-sentinel' };
function makeProject(name) {
  const dir = path.join(BASE, name);
  fs.mkdirSync(path.join(dir, '.trivium'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.copyFileSync(path.join(REPO, '.trivium/config.yaml'), path.join(dir, '.trivium/config.yaml'));
  const local = YAML.parse(fs.readFileSync(path.join(REPO, '.trivium/config.local.yaml'), 'utf8'));
  const z = local.probe.cli.zcode;
  z.response_field = SENT.response_field;
  z.model_id_form = SENT.model_id_form;
  z.path_deny.method = SENT.method;
  fs.writeFileSync(path.join(dir, '.trivium/config.local.yaml'), YAML.stringify(local));
  return dir;
}
const zcodeProbeOf = (dir) => {
  const z = YAML.parse(fs.readFileSync(path.join(dir, '.trivium/config.local.yaml'), 'utf8')).probe.cli.zcode;
  return { probed_at: z.probed_at, response_field: z.response_field, model_id_form: z.model_id_form, path_deny_method: z.path_deny?.method ?? null };
};

const listCli = () => {
  const out = {};
  for (const sub of ['log', 'rollout']) {
    const d = path.join(HOME, '.zcode/cli', sub);
    let names = [];
    try { names = fs.readdirSync(d); } catch { names = []; }
    out[sub] = names.sort().map((n) => {
      const st = fs.statSync(path.join(d, n));
      return { name: n, size: st.size, mtime: st.mtime.toISOString() };
    });
  }
  return out;
};

function runDoctor(label, bundle, dir) {
  const before = listCli();
  const probeBefore = zcodeProbeOf(dir);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [bundle, 'doctor', '--only', 'zcode', '--json'], {
    cwd: dir, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024,
  });
  const after = listCli();
  fs.writeFileSync(path.join(path.dirname(OUT), `doctor-${label}.stdout.json`), tilde(r.stdout ?? ''));
  fs.writeFileSync(path.join(path.dirname(OUT), `doctor-${label}.stderr.txt`), tilde(r.stderr ?? ''));
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { report = null; }
  const notes = (report?.notes ?? []).map((n) => tilde(n)).filter((n) => n.startsWith('[zcode]'));
  return {
    exit: r.status, elapsed_s: Math.round((Date.now() - t0) / 1000),
    notes_of_interest: notes.filter((n) => /headless|探的是|envelope|生效模型回读|rollout|path_deny|scratch_paths|未能从会话日志/.test(n)),
    blockers: (report?.blockers ?? []).map(tilde),
    probe_before: probeBefore, probe_after: zcodeProbeOf(dir),
    cli_before: before, cli_after: after,
    allNotes: notes,
  };
}

const projOld = makeProject('proj-old');
const projNew = makeProject('proj-new');

// ── 4. 改前、改后各跑一次 ──
fs.writeFileSync(LOCK, new Date().toISOString() + '\n');
const oldRun = runDoctor('old', oldBundle, projOld);
const newRun = runDoctor('new', newBundle, projNew);

// ── 5. 判据 ──
const has = (run, re) => run.allNotes.some((n) => re.test(n));
const count = (l) => ({ log: l.log.length, rollout: l.rollout.length });
const oldReproduced = has(oldRun, /ZCode headless 失败.*Model creation failed/);
const tail = (s) => (typeof s === 'string' && s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s);
const head = (s) => (typeof s === 'string' && s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : null);
const mif = newRun.probe_after.model_id_form;
const verdict = {
  old_headless_model_creation_failed: oldReproduced,
  new_1_headless_ok: !has(newRun, /ZCode headless 失败/) && has(newRun, /envelope 字段=/),
  new_2_detail_names_plan_model: newRun.allNotes.some((n) => n.includes(`headless / path_deny 探的是：模型 ${qualified}`)),
  new_3a_response_field_refreshed: newRun.probe_after.response_field === 'response',
  new_3b_model_id_form_refreshed_and_matches: mif !== SENT.model_id_form && tail(mif) === planModel && head(mif) === owners[0],
  new_4_real_cli_file_counts_unchanged: JSON.stringify(count(newRun.cli_before)) === JSON.stringify(count(newRun.cli_after)),
  // 补充读数（不进判据）
  supplementary_new_real_cli_identical: JSON.stringify(newRun.cli_before) === JSON.stringify(newRun.cli_after),
  supplementary_old_real_cli_counts: { before: count(oldRun.cli_before), after: count(oldRun.cli_after) },
};
verdict.comparable = oldReproduced;
verdict.new_all_pass = ['new_1_headless_ok', 'new_2_detail_names_plan_model', 'new_3a_response_field_refreshed',
  'new_3b_model_id_form_refreshed_and_matches', 'new_4_real_cli_file_counts_unchanged'].every((k) => verdict[k] === true);

for (const r of [oldRun, newRun]) delete r.allNotes;
Object.assign(readout, { old: oldRun, new: newRun, verdict, finished_at: new Date().toISOString() });
fs.writeFileSync(OUT, JSON.stringify(readout, null, 2) + '\n');
console.log(JSON.stringify(verdict, null, 2));
