#!/usr/bin/env node
/**
 * EV-112 E2（计划 r3 §6.3）：真实配额验收之后的**只读**核对。
 *
 * 被核运行：run `20260924T172304Z`（主题 `EV-112-E2验收`，单侧 glm，plan 阶段），审查运行期间 `~/.zcode/cli/config.json`
 * 被暂时改名（2026-09-24T17:22:37Z～17:39:51Z），由此进入无副本一支。
 *
 * 读三处，只输出字段值、文件名、计数，不输出任何日志或会话内容：
 *   ① 归档 run.json 的 critics.glm 段；
 *   ② 运行目录 `glm/home/.zcode/cli/` 的落点与 `glm/scrub.json`；
 *   ③ 真实 HOME：`~/.zcode/cli/{log,rollout,artifacts,sessions,db}` 按本次 sessionId 查（log 只看运行窗口内改过的文件）。
 * 不写、不删任何文件；输出写到同目录 e2-output.json。
 *
 * 用法：node doc/05_testing/evidence/ev112-acceptance-20260925/e2-check.mjs
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const RUN_ID = '20260924T172304Z';
const WINDOW_START = Date.parse('2026-09-24T17:22:37Z');
const REAL_HOME = os.userInfo().homedir;

const runJson = JSON.parse(await fs.readFile(path.join(ROOT, '.reviews/EV-112-E2验收/plan', '_' + 'meta', `run-${RUN_ID}.json`), 'utf8'));
const g = runJson.critics.glm;
const sid = g.session_id;

const runDir = path.join(REAL_HOME, '.trivium/runs/TriviumCode-2217d505', RUN_ID);
const cli = path.join(runDir, 'glm/home/.zcode/cli');
async function countDir(d) {
  try { return (await fs.readdir(d)).length; } catch { return null; }
}
const landing = {};
for (const sub of ['log', 'rollout', 'db', 'artifacts', 'sessions', 'memories', 'plugins']) landing[sub] = await countDir(path.join(cli, sub));
const betaInRun = (await countDir(path.join(runDir, 'glm/home/.zcode-beta'))) !== null;
let scrub = null;
try {
  const s = JSON.parse(await fs.readFile(path.join(runDir, 'glm/scrub.json'), 'utf8'));
  scrub = { ok: s.ok, complete: s.complete, logs_redacted: Object.keys(s.logs_redacted ?? {}), scanned_files: s.scanned_files, removed_on_hit: (s.removed_on_hit ?? []).length, errors: s.errors };
} catch (e) {
  scrub = { unreadable: e.message };
}

const homeCli = path.join(REAL_HOME, '.zcode/cli');
const real = { log_files_in_window: 0, log_files_with_session: [], rollout: false, artifacts: false, sessions: false, db_hits: {} };
for (const f of (await fs.readdir(path.join(homeCli, 'log')).catch(function () { return []; })).filter(function (n) { return n.endsWith('.jsonl'); })) {
  const p = path.join(homeCli, 'log', f);
  const st = await fs.stat(p);
  if (st.mtimeMs < WINDOW_START) continue;
  real.log_files_in_window++;
  const text = await fs.readFile(p, 'utf8');
  if (text.includes(sid)) real.log_files_with_session.push(f);
}
const exists = async function (p) { try { await fs.access(p); return true; } catch { return false; } };
real.rollout = await exists(path.join(homeCli, 'rollout', `model-io-${sid}.jsonl`));
real.artifacts = await exists(path.join(homeCli, 'artifacts', sid));
real.sessions = await exists(path.join(homeCli, 'sessions', sid));
for (const f of (await fs.readdir(path.join(homeCli, 'db')).catch(function () { return []; })).filter(function (n) { return n.startsWith('db.sqlite'); })) {
  const buf = await fs.readFile(path.join(homeCli, 'db', f));
  real.db_hits[f] = buf.toString('latin1').split(sid).length - 1;
}

// ── 补核（E2 载体稿审查意见 GLM-01～08，均为事后只读） ──
// GLM-03：进入成因
const trace = JSON.parse(await fs.readFile(path.join(runDir, 'glm/out/trace.json'), 'utf8'));
// GLM-04：运行目录会话库按内容核
const runDbHits = {};
for (const f of (await fs.readdir(path.join(cli, 'db')).catch(function () { return []; })).filter(function (n) { return n.startsWith('db.sqlite'); })) {
  runDbHits[f] = (await fs.readFile(path.join(cli, 'db', f))).toString('latin1').split(sid).length - 1;
}
// GLM-01：memories 正查（运行目录）与反查（真实 HOME 里运行窗口内改过的项目记忆目录）
const runMemories = await fs.readdir(path.join(cli, 'memories/projects')).catch(function () { return []; });
const realMemoriesInWindow = [];
for (const d of await fs.readdir(path.join(homeCli, 'memories/projects')).catch(function () { return []; })) {
  const st = await fs.stat(path.join(homeCli, 'memories/projects', d));
  if (st.mtimeMs >= WINDOW_START) realMemoriesInWindow.push(d);
}
// GLM-05：个人 provider 配置在（只核存在性）；GLM-02：副本源已复原（名、大小、修改时间；挪开与挪回都只是改名）
const personalExists = await exists(path.join(REAL_HOME, '.zcode/v2/provider_config.json'));
const cfgStat = await fs.stat(path.join(homeCli, 'config.json')).catch(function () { return null; });
const leftover = await exists(path.join(homeCli, 'config.json.ev112-e2'));
const extra = {
  entry_reason: trace.modelSelection?.reason ?? null,
  run_db_hits: runDbHits,
  run_memories_projects: runMemories,
  real_memories_changed_in_window: realMemoriesInWindow,
  personal_provider_config_exists: personalExists,
  cli_config_restored: cfgStat ? { size: cfgStat.size, mtime: cfgStat.mtime.toISOString() } : null,
  cli_config_backup_leftover: leftover,
  tool_calls_total: Object.values(g.tool_calls ?? {}).filter(function (v) { return typeof v === 'number'; }).reduce(function (a, b) { return a + b; }, 0) - (g.tool_calls?.project_reads ?? 0),
};

const out = {
  generated_at: new Date().toISOString(),
  extra,
  run_id: RUN_ID,
  run_json_glm: {
    status: g.status,
    model_requested: g.model_requested,
    model_effective: g.model_effective,
    model_effective_source: g.model_effective_source,
    model_route: g.model_route,
    model_override_applied_present: Object.prototype.hasOwnProperty.call(g, 'model_override_applied'),
    carriers_landed: g.carriers_landed ?? null,
    tool_calls: g.tool_calls,
    evidence_ok: g.evidence_ok,
    session_id: sid,
  },
  gate_warnings: runJson.gate?.warnings ?? [],
  landing_counts: landing,
  beta_dir_in_run: betaInRun,
  scrub,
  real_home: real,
  verdicts: {
    route_global: g.model_route === 'global',
    effective_from_trace: Boolean(g.model_effective) && g.model_effective_source === 'trace',
    carriers_all_landed_no_leak: JSON.stringify(g.carriers_landed) === JSON.stringify({ log: true, rollout: true, leaked_to_home: { log: false, rollout: false } }),
    landing_has_log_rollout_db: ['log', 'rollout', 'db'].every(function (k) { return (landing[k] ?? 0) > 0; }),
    landing_has_artifacts: (landing.artifacts ?? 0) > 0,
    no_beta_dir: !betaInRun,
    real_home_untouched: real.log_files_with_session.length === 0 && !real.rollout && !real.artifacts && !real.sessions
      && Object.values(real.db_hits).every(function (x) { return x === 0; }),
    entered_via_missing_source: typeof extra.entry_reason === 'string' && extra.entry_reason.includes('未找到'),
    run_db_has_session: Object.values(runDbHits).some(function (x) { return x > 0; }),
    memories_landed_in_run_dir: runMemories.length > 0,
    real_memories_untouched: realMemoriesInWindow.length === 0,
    tool_calls_happened: extra.tool_calls_total > 0,
    cli_config_restored: Boolean(cfgStat) && !leftover,
  },
};
await fs.writeFile(path.join(HERE, 'e2-output.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(out, null, 2));
