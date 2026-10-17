/** M12批次2控制器（EV-241）：三条claude路线探针刷新 + 五组合档1/档2取证；逐项冻结复核，任一失败即停、不重试、不恢复。
 * 子命令按次序：authorize（R0，落具名授权）→ precheck（R0）→ refresh（R1）→ prepare（R2）→ run（R3～R5）。
 * 汇总（R6）用 scripts/agent-access-closeout-summary.mjs，参数见 run 结束时的输出。不含判据采用。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { hash } from '../../../../scripts/agent-access-selection.mjs';
import { judgeToolSurfaceUnregistered } from '../../../../scripts/agent-access-restricted.mjs';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { resolveClaudeRoute, claudeRouteKey } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { SENTINEL_PEER, SENTINEL_SECRET } from '../../../../dist/test/src/trivium/probes/fixture.js';
import { checkCopies, KNOWN_OPEN, PLAN_RUN_ID, POOL_LIMIT, TOPIC, AUTHORIZATION_INSTRUCTION } from './diff-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const evidenceRoot = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3');
const budgetRoot = path.join(evidenceRoot, 'budget');
const launcher = 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v21.mjs';
const controlledExternal = path.join(evidenceRoot, 'controlled-m12-20261017');
const planFinal = path.join(repo, `.reviews/${TOPIC}/plan/2026-10-17-${TOPIC}-r2-claude.md`);
const repoBundle = path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
const installedBundle = path.join(os.homedir(), '.claude/skills/dual-critic/scripts/trivium.cjs');
const prior = path.resolve(here, '../agent-access-convergence-20261012');
const R21 = ['agent-access-20261011-closeout-r21/controlled-mechanism-mode3.mjs', 'agent-access-20261011-closeout-r21/controlled-inline-mode.mjs',
  'agent-access-20261011-closeout-r21/controlled-mechanism-mode3.v1.schema.json', 'agent-access-20261011-closeout-r19/controlled-runtime.mjs',
  'agent-access-20261011-closeout-r19/controlled-mechanism.mjs', 'agent-access-20261011-closeout-r17/controlled-mechanism.mjs']
  .map(rel => path.resolve(here, '..', rel));
const CONTROLLERS = ['batch.mjs', 'diff-check.mjs', 'controlled-fixture.mjs', 'launch-mechanism.mjs', 'mechanism-launch-check.mjs', 'mechanism-proof.mjs']
  .map(n => path.join(here, n));
/** 固定次序与身份，与10-12 JOB_IDENTITIES一致：[组合, 模型, profile]。 */
const READS = [['qwen-pro', 'qwen3.8-max', 'qwen'], ['kimi-pro', 'k3', 'kimi'], ['kimi', 'kimi-for-coding', 'kimi'],
  ['deepseek', 'deepseek-flash', 'deepseek'], ['deepseek-pro', 'deepseek-v4-pro', 'deepseek']];
const PROFILES = ['qwen', 'kimi', 'deepseek'];
/** R1停点：路线只读结论（无头读取、工具面、路径禁读规则、JSON Schema、目录禁读）与刷新前不同即停（P-10）。 */
const ROUTE_CONCLUSIONS = ['headless_read_ok', 'tool_surface_checked', 'readonly_flags', 'readonly_breach', 'strict_mcp_config_applied',
  'path_deny', 'json_schema_ok', 'directory_deny_verified', 'directory_deny_shape'];
const HARD_STARTS = 3;
const file = name => path.join(here, name);
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const { openBudget, hashFile } = createRequire(import.meta.url)(path.join(repo, 'scripts/agent-access-budget.cjs'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 台账：已用=全部预占；未闭合集合必须恰为已知3条（P-8）。 */
function ledger() {
  const budget = openBudget(budgetRoot, 'admission'), names = fs.readdirSync(budget.dir);
  const reserved = names.filter(n => /^reserved-\d+\.json$/.test(n)), launches = new Set(names.filter(n => /^launch-\d+\.json$/.test(n)));
  const open = reserved.filter(n => !launches.has(n.replace('reserved-', 'launch-'))).sort();
  return { used: reserved.length, completed: launches.size, limit: budget.limit(), open };
}
function assertLedger(c, stop) {
  if (!same(c.open, [...KNOWN_OPEN]) || c.used !== c.completed + KNOWN_OPEN.length) throw Error('台账未闭合集合不是已知3条');
  if (c.limit !== POOL_LIMIT) throw Error('台账上限变化');
  if (stop !== undefined && c.used > stop) throw Error('台账超过本批停止线');
}
function bundleStamp(f) {
  const m = /define_TRIVIUM_BUILD_default = \{ repo_root_commit: "([0-9a-f]+)", git_head: "([0-9a-f]+)", dirty: (true|false), inputs_sha256: "([0-9a-f]+)"/
    .exec(fs.readFileSync(f, 'utf8'));
  if (!m) throw Error('bundle缺构建标识');
  return { git_head: m[2], dirty: m[3] === 'true', inputs_sha256: m[4] };
}
const gitHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
/** 提交1之后：树非dirty、HEAD即授权绑定的提交、仓库与安装副本bundle同字节同标识（AGY-03）。 */
async function assertBuild(commit) {
  const stamp = await computeBuildStamp(repo);
  if (stamp.dirty !== false || stamp.git_head !== commit || gitHead() !== commit) throw Error('构建非提交1或dirty');
  if (hashFile(repoBundle) !== hashFile(installedBundle)) throw Error('仓库bundle与安装副本不一致');
  const b = bundleStamp(installedBundle);
  if (b.dirty || b.git_head !== commit || b.inputs_sha256 !== stamp.inputs_sha256) throw Error('安装副本构建标识不是提交1');
  return stamp;
}
function authorization() {
  const a = read(file('authorization.json'));
  if (a.user_instruction !== AUTHORIZATION_INSTRUCTION || a.review_waiver !== false || a.criteria_adoption_authorized !== false ||
    a.formal_approval_record?.plan_run_id !== PLAN_RUN_ID || typeof a.formal_approval_record?.code_run_id !== 'string' ||
    hashFile(a.plan_final?.path) !== a.plan_final?.sha256) throw Error('具名授权内容不符');
  return a;
}
const routeProbe = async profile => (await loadCtx({ cwd: repo })).config.probe.cli.claude?.routes?.[claudeRouteKey(profile)] ?? null;
const conclusions = entry => Object.fromEntries(ROUTE_CONCLUSIONS.map(k => [k, entry?.probe?.[k] ?? null]));

/** 只经预算包装器启动；记录派发结果，非零即抛。
 * 独立进程组 + 外层上限：内层超时之外的挂起也按失败即停处理，超限对整组SIGKILL（代码双审GLM-02）。 */
async function dispatch(args, label, env, record, limitMs = 15 * 60 * 1000) {
  const child = spawn(process.execPath, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
  child.on('error', e => { stderr += 'spawn:' + e.code; });
  const timer = setInterval(() => console.log(JSON.stringify({ running: label, budget: ledger() })), 30000);
  const watchdog = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') stderr += 'watchdog:' + e.code; }
  }, limitMs);
  const [code, signal] = await new Promise(r => child.once('close', (...x) => r(x)));
  clearInterval(timer); clearTimeout(watchdog);
  saveEvidence(record, { at: new Date().toISOString(), label, code, signal, timed_out: timedOut, limit_ms: limitMs, stdout, stderr, budget: ledger() });
  if (timedOut) throw Error(`${label}超过外层上限${limitMs}ms，已终止整组`);
  if (code !== 0 || signal) throw Error(`${label}未完成：code=${code} signal=${signal}`);
}

async function authorize() {
  const i = process.argv.indexOf('--code-run'), codeRun = process.argv[i + 1];
  if (i < 0 || !/^\d{8}T\d{6}Z$/.test(codeRun ?? '')) throw Error('用法：authorize --code-run <代码双审run id>');
  const commit = gitHead();
  await assertBuild(commit);
  saveEvidence(file('authorization.json'), {
    at: new Date().toISOString(), schema: 'm12-batch2-authorization.v1',
    user_instruction: AUTHORIZATION_INSTRUCTION,
    user_answers_verbatim: ['按照你的建议定context名称', AUTHORIZATION_INSTRUCTION],
    question_context: '计划定稿头部「用户 2026-10-17 补充答复」与§5具名授权形态（本文件plan_final绑定其sha256）',
    scope: 'M12批次2：三条claude路线探针刷新 + 五组合档1/档2取证；失败即停、不重试；不含判据采用',
    review_waiver: false, criteria_adoption_authorized: false,
    formal_approval_record: { plan_run_id: PLAN_RUN_ID, code_run_id: codeRun },
    plan_final: { path: planFinal, sha256: hashFile(planFinal) }, commit,
  });
  console.log(JSON.stringify({ authorized: true, commit, code_run_id: codeRun }));
}

async function precheck() {
  const a = authorization(), stamp = await assertBuild(a.commit);
  const c = ledger(); assertLedger(c);
  if (fs.readFileSync(path.join(budgetRoot, 'continuity.json'), 'utf8') !==
    fs.readFileSync(path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/budget-continuity-r12.json'), 'utf8')) throw Error('预算连续性冻结原件不符');
  const recorded = read(path.join(prior, 'mechanism-batch.json')).files;
  for (const f of R21) if (hashFile(f) !== recorded[f]) throw Error('r21/r19/r17模块与10-12记录不一致：' + f);
  const copies = checkCopies(); if (!copies.ok) throw Error('复制件差异超出登记批次参数：' + JSON.stringify(copies.results));
  const routes = Object.fromEntries(await Promise.all(PROFILES.map(async p => [p, await routeProbe(p)]))
    .then(x => x.map(([p, e]) => [p, { version: e?.probe?.version ?? null, fingerprint: e?.fingerprint ?? null, conclusions: conclusions(e) }])));
  saveEvidence(file('precheck.json'), { at: new Date().toISOString(), authorization_sha256: hash(file('authorization.json')),
    git_head: stamp.git_head, inputs_sha256: stamp.inputs_sha256, bundle_sha256: hashFile(installedBundle), ledger: c, copies, routes_before: routes });
  console.log(JSON.stringify({ precheck: true, ledger: c, routes: Object.fromEntries(Object.entries(routes).map(([p, r]) => [p, r.version])) }));
}

async function refresh() {
  const pre = read(file('precheck.json')), a = authorization();
  if (pre.authorization_sha256 !== hash(file('authorization.json'))) throw Error('授权文件在precheck之后变化');
  for (const profile of PROFILES) {
    const out = file(`refresh-${profile}.json`);
    if (fs.existsSync(out)) throw Error('该路线已刷新过，不重试：' + profile);
    await assertBuild(a.commit); const before = ledger(); assertLedger(before);
    const entryBefore = await routeProbe(profile);
    if (!same(conclusions(entryBefore), pre.routes_before[profile].conclusions)) throw Error('刷新前路线结论已变化：' + profile);
    await dispatch([path.join(repo, launcher), 'admission', `m12-refresh-${profile}`, 'tv', 'doctor', '--only', 'claude', '--profile-claude', profile],
      `refresh-${profile}`, { ...process.env }, file(`refresh-${profile}-dispatch.json`), 45 * 60 * 1000);
    const ctx = await loadCtx({ cwd: repo }), entry = ctx.config.probe.cli.claude?.routes?.[claudeRouteKey(profile)];
    const version = ctx.config.probe.cli.claude?.version, after = ledger(), reasons = [];
    if (!entry || entry.probe.version !== version) reasons.push('路线探针版本不是当前CLI版本');
    if (!entry || entry.fingerprint !== resolveClaudeRoute(ctx.config, profile, version).fingerprint) reasons.push('路线指纹不等于按当前版本重算');
    if (!same(conclusions(entry), pre.routes_before[profile].conclusions)) reasons.push('只读结论与刷新前不同');
    if (after.open.length !== KNOWN_OPEN.length || !same(after.open, [...KNOWN_OPEN])) reasons.push('本次启动未全部闭合');
    saveEvidence(out, { at: new Date().toISOString(), profile, pass: reasons.length === 0, reasons, version, fingerprint: entry?.fingerprint ?? null,
      before: pre.routes_before[profile], after: conclusions(entry), starts: after.used - before.used });
    console.log(JSON.stringify({ refreshed: profile, pass: reasons.length === 0, reasons, starts: after.used - before.used }));
    if (reasons.length) throw Error(`${profile}刷新后停止：${reasons.join('；')}`);
  }
}

async function prepare() {
  const a = authorization(), stamp = await assertBuild(a.commit);
  for (const p of PROFILES) if (read(file(`refresh-${p}.json`)).pass !== true) throw Error('路线刷新未全部通过：' + p);
  const c = ledger(); assertLedger(c);
  const prev = read(path.join(prior, 'batch-a.json')).files, files = {};
  for (const f of [...Object.keys(prev), ...R21, ...CONTROLLERS, file('authorization.json'), file('precheck.json'), installedBundle,
    ...PROFILES.map(p => file(`refresh-${p}.json`)), path.join(os.homedir(), '.claude/profiles/qwen.env'),
    path.join(os.homedir(), '.claude/profiles/kimi.env'), path.join(os.homedir(), '.claude/profiles/deepseek.env')]) files[f] = hashFile(f);
  if (Object.values(files).some(h => h === null)) throw Error('冻结清单有不可读文件');
  const allocated = new Set(fs.readdirSync(path.join(evidenceRoot, 'routes'))), jobs = [];
  const alloc = (key, extra) => { let v = 1; while (allocated.has(`${key}-${v}`)) v++; allocated.add(`${key}-${v}`); jobs.push({ name: key, variant: v, route_directory: `${key}-${v}`, hard_starts: HARD_STARTS, ...extra }); };
  for (const p of PROFILES) alloc(`static-${p}-version`, { args: ['static', p, 'version'], profile: p, model: null });
  for (const [combination, model, profile] of READS) alloc(`claude-${combination}-read`, { args: ['claude', combination, 'read'], combination, profile, model });
  const positiveHard = jobs.length * HARD_STARTS, mechanismHard = READS.length * HARD_STARTS;
  saveEvidence(file('batch.json'), { at: new Date().toISOString(), schema: 'm12-batch.v1', criteria_adopted: false,
    authorization_sha256: hash(file('authorization.json')), commit: a.commit, git_head: stamp.git_head, inputs_sha256: stamp.inputs_sha256,
    before: c, expected_starts: jobs.length + READS.length * 2, hard_starts: positiveHard + mechanismHard, batch_stop: c.used + positiveHard + mechanismHard,
    controller_sha256: hash(file('batch.mjs')), files, jobs, failure_policy: '停止本批，保留失败，不自动重试、不换配方、不恢复旧批' });
  console.log(JSON.stringify({ prepared: true, jobs: jobs.length, before: c.used, stop: c.used + positiveHard + mechanismHard, frozen_files: Object.keys(files).length }));
}

async function frozen(b) {
  for (const [f, h] of Object.entries(b.files)) if (hashFile(f) !== h) throw Error('冻结来源变化：' + f);
  if (hash(file('batch.mjs')) !== b.controller_sha256 || hash(file('authorization.json')) !== b.authorization_sha256) throw Error('控制器或授权变化');
  const stamp = await assertBuild(b.commit);
  if (stamp.inputs_sha256 !== b.inputs_sha256) throw Error('生产输入变化');
  const c = ledger(); assertLedger(c, b.batch_stop); return c;
}

async function run() {
  const b = read(file('batch.json'));
  if (fs.existsSync(file('run-started.json'))) throw Error('本批已启动过，不重试、不恢复');
  const start = await frozen(b);
  if (start.used !== b.before.used) throw Error('批前台账变化');
  saveEvidence(file('run-started.json'), { at: new Date().toISOString(), batch_sha256: hash(file('batch.json')) });
  const versions = {}, positives = [], mechanisms = [];
  let failed = null, mechanismBatch = null;
  try {
    for (const j of b.jobs) {
      const before = await frozen(b), out = path.join(evidenceRoot, 'routes', j.route_directory);
      if (fs.existsSync(out) || before.used + j.hard_starts > b.batch_stop) throw Error('重复目标或超出停止线：' + j.name);
      const env = { ...process.env }; delete env.TRIVIUM_ACCESS_SELECTION;
      if (j.args[0] !== 'static') {
        const key = `static-${j.profile}-version`;
        if (!versions[key]) throw Error('版本来源缺失：' + key);
        const selection = file(`${j.name}-selection.json`);
        saveEvidence(selection, { schema: 'trivium.access.selection.v1', routes: {}, versions: { [key]: versions[key] } });
        env.TRIVIUM_ACCESS_SELECTION = selection;
      }
      console.log(JSON.stringify({ starting: j.name, budget: before }));
      await dispatch([path.join(repo, launcher), 'admission', `m12-${j.name}`, 'probe', ...j.args, String(j.variant)], j.name, env, file(`${j.name}-dispatch.json`));
      await frozen(b);
      const r = read(path.join(out, 'result.json')), after = read(path.join(out, 'fingerprints-after.json')), now = ledger(), reasons = [];
      if (r.completed !== true || after.unchanged !== true) reasons.push('未完整完成或指纹漂移');
      if (now.used - before.used > j.hard_starts) reasons.push('单项启动超限');
      const reference = { variant: j.variant, ...Object.fromEntries(['requested.json', 'result.json', 'fingerprints-after.json'].map(n => [n, hash(path.join(out, n))])) };
      let toolSurface = null;
      if (j.args[0] === 'static') versions[j.name] = reference;
      else {
        if (!r.actual_read || !r.strict_first_word || !r.structured?.ok || r.readback?.model !== j.model) reasons.push('原正向读取条件未通过');
        const cleanup = read(path.join(out, 'cleanup.json')), fx = read(path.join(out, 'fixture-before.json'));
        if (cleanup.fixture_residue !== null || !cleanup.scratch_removed || fs.existsSync(fx.root)) reasons.push('夹具清理不完整');
        toolSurface = judgeToolSurfaceUnregistered({ result: r, compatible: after.unchanged === true }, read(path.join(out, 'production-shape.json')));
        if (toolSurface.value !== true) reasons.push('档1不成立：' + toolSurface.reasons.join(','));
      }
      const proof = { at: new Date().toISOString(), job: j.name, combination: j.combination ?? null, model: j.model, profile: j.profile,
        pass: reasons.length === 0, reasons, tool_surface_unregistered: toolSurface, reference, directory: out, actual_starts: now.used - before.used };
      saveEvidence(file(`${j.name}-proof.json`), proof); positives.push(proof);
      console.log(JSON.stringify({ finished: j.name, pass: proof.pass, reasons, budget: now }));
      if (!proof.pass) throw Error(reasons.join('；'));
    }
    // R5：受控机制批次文件在正向读取全部通过后才写，live来源只认本批R4读臂。
    const c = await frozen(b), files = { ...b.files };
    for (const n of ['batch.json', ...b.jobs.map(j => `${j.name}-proof.json`)]) files[file(n)] = hash(file(n));
    const mechanismJobs = READS.map(([combination, model, profile]) => {
      const p = positives.find(x => x.combination === combination && x.model === model), live = read(path.join(p.directory, 'result.json'));
      for (const n of fs.readdirSync(p.directory)) { const f = path.join(p.directory, n); if (fs.statSync(f).isFile()) files[f] = hash(f); }
      return { combination, model, profile, variant: '3', expected_starts: 2, hard_starts: 3, output: path.join(controlledExternal, `${combination}-mechanism-3`),
        claim: file(`mechanism-${combination}-claim.json`), live_cli_version: live.request.cli_version_observed,
        live_result_ref: { path: path.join(p.directory, 'result.json'), sha256: hash(path.join(p.directory, 'result.json')) },
        live_shape_ref: { path: path.join(p.directory, 'production-shape.json'), sha256: hash(path.join(p.directory, 'production-shape.json')) },
        sentinels: [SENTINEL_PEER, SENTINEL_SECRET] };
    });
    saveEvidence(file('mechanism-batch.json'), { at: new Date().toISOString(), schema: 'm12-mechanism-batch.v1', criteria_adopted: false,
      formal_plan_run_id: PLAN_RUN_ID, review_waived: false, authorization_sha256: hash(file('authorization.json')), git_head: b.git_head,
      inputs_sha256: b.inputs_sha256, before: c.used, expected_starts: 10, hard_starts: 15, batch_stop: c.used + 15, pool_limit: POOL_LIMIT,
      budget_root: budgetRoot, files, jobs: mechanismJobs });
    mechanismBatch = file('mechanism-batch.json');
    const { measureMode3Launch, schemaFile } = await import('./mechanism-launch-check.mjs');
    const { recomputeMode3Proof } = await import('./mechanism-proof.mjs');
    await measureMode3Launch(repo, 'admission', 'fixture', [READS[0][0], '3']);
    for (const j of mechanismJobs) {
      await frozen(b); await measureMode3Launch(repo, 'admission', 'fixture', [j.combination, '3']);
      const before = ledger();
      console.log(JSON.stringify({ starting: 'mechanism-' + j.combination, budget: before }));
      await dispatch([path.join(here, 'launch-mechanism.mjs'), 'admission', 'm12-mechanism-' + j.combination, 'fixture', j.combination, '3'],
        'mechanism-' + j.combination, process.env, file(`mechanism-${j.combination}-dispatch.json`));
      const proof = await recomputeMode3Proof(j, schemaFile), now = ledger();
      if (now.used - before.used > j.hard_starts) throw Error('单任务超过公布硬上限');
      assertLedger(now, b.batch_stop);
      saveEvidence(file(`mechanism-${j.combination}-proof.json`), proof); mechanisms.push(proof);
      console.log(JSON.stringify({ finished: 'mechanism-' + j.combination, recomputed_pass: proof.recomputed_pass, budget: now }));
    }
  } catch (e) { failed = { error: e.message }; }
  const end = ledger(), outputs = {};
  if (!failed) {
    const routes = Object.fromEntries(positives.filter(p => p.combination).map(p => [p.job, p.reference]));
    saveEvidence(file('selection.json'), { schema: 'trivium.access.selection.v1', routes, versions });
    const { schemaFile } = await import('./mechanism-launch-check.mjs');
    saveEvidence(file('controlled.json'), { schema: 'trivium.access.restricted-controlled.v1',
      proof_module: { path: file('mechanism-proof.mjs'), sha256: hash(file('mechanism-proof.mjs')) },
      schema_file: { path: schemaFile, sha256: hash(schemaFile) }, batch: { path: mechanismBatch, sha256: hash(mechanismBatch) } });
    outputs.summary_command = ['node', 'scripts/agent-access-closeout-summary.mjs', evidenceRoot, file('selection.json'), file('controlled.json')];
  }
  saveEvidence(file('mechanism-result.json'), { at: new Date().toISOString(), failed, positives: positives.map(p => ({ job: p.job, pass: p.pass })),
    mechanisms, budget: end, new_starts: end.used - b.before.used, ledger_closed: same(end.open, [...KNOWN_OPEN]),
    criteria_adopted: false, actual_provider_inference_in_mechanisms: false, ...outputs });
  console.log(JSON.stringify({ finished: true, failed, positives: positives.length, mechanisms: mechanisms.length, budget: end, ...outputs }));
  if (failed) process.exitCode = 1;
}

const commands = { authorize, precheck, refresh, prepare, run };
const command = commands[process.argv[2]];
if (!command) throw Error('用法：authorize --code-run <id> | precheck | refresh | prepare | run');
await command();
