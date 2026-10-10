/** 零CLI收尾对账，复算原始证据；不回写旧结论，不切配置。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { saveEvidence } from './agent-access-evidence.mjs';
import { loadCtx } from '../dist/test/src/trivium/config.js';
import { resolveClaudeRoute } from '../dist/test/src/trivium/adapters/claude-route.js';
import { codexAdapter } from '../dist/test/src/trivium/adapters/codex.js';
import { codexNativeRouteIssue, codexHomeOf } from '../dist/test/src/trivium/adapters/codex-home.js';
const require = createRequire(import.meta.url);
const { openBudget, hashFile } = require('./agent-access-budget.cjs');
const root = path.resolve('doc/05_testing/evidence/agent-access-20261010-admission');
const ctx = await loadCtx();
const read = p => JSON.parse(fs.readFileSync(p));
const oldAudit = read(path.resolve('doc/05_testing/evidence/agent-access-20261010-preflight/zero-quota-audit.json'));
const oldIntact = oldAudit.old_batches.every(b => hashFile(path.resolve(`doc/05_testing/evidence/agent-access-20261009/batch-${b.batch}/summary.json`)) === b.summary_sha256 &&
  b.records.every(r => hashFile(path.resolve(`doc/05_testing/evidence/agent-access-20261009/batch-${b.batch}/${r.name}`)) === r.sha256)) &&
  hashFile(path.resolve('scripts/probe-agent-access.mjs')) === oldAudit.prior_probe_script_sha256_current_only;
if (!oldIntact) throw Error('旧批次或冻结入口已改变，拒绝汇总');
const routeResult = (a, p, arm, v = 1) => read(path.join(root, 'routes', `${a}-${p}-${arm}-${v}`, 'result.json'));
const homeIsolation = routeResult('static', 'codex', 'isolation');
const pathDeny = routeResult('static', 'codex', 'help');
const codexVariant = Number(process.argv[2] ?? '3');
if (![1, 2, 3].includes(codexVariant)) throw Error('Codex证据组编号无效');
const rows = [];
const configDeclarations = read(path.join(root, 'source-copy-compatibility.json')).current_configuration_declarations;
for (const p of ['native', 'qwen', 'kimi', 'deepseek']) {
  const writeVariant = p === 'qwen' && codexVariant === 3 ? 4 : codexVariant;
  const r = routeResult('codex', p, 'read', codexVariant), w = routeResult('codex', p, 'write', writeVariant), d = routeResult('codex', p, 'deny', codexVariant);
  const isolation = read(path.join(root, 'routes', `codex-${p}-read-${codexVariant}/isolation.json`));
  const current = codexAdapter.accessFor(ctx.config, p === 'native' ? null : p);
  const fingerprintMatches = [r, w, d].every(x => current.configuration_sha256 === x.request.configuration.configuration_sha256 && hashFile(current.launcher_requested) === x.request.entry_sha256 && x.readback.modelEffective === x.request.model && x.readback.modelProvider === current.provider_declared && x.readback.cliVersion === '0.162.0');
  const readOk = r.completed && r.read_sentinel_from_successful_command && r.readback.modelEffective === r.request.model && r.readback.cliVersion === '0.162.0';
  const mcp = homeIsolation.isolation === 'home_copy' && isolation.home_is_independent && isolation.config_sha256.every(f => f.mcp_sections_present === false) && r.mcp_calls.length === 0;
  const passed = fingerprintMatches && readOk && mcp && r.structured.ok && w.write_pass && d.forbidden_read_detection.leaked && d.completed;
  rows.push({ agent: 'codex', profile: p, status: passed ? '通过' : '未通过/未测', read: readOk, tool_whitelist: '无对应机制；只读沙箱+事后轨迹判定',
    mcp_isolation: mcp, mcp_boundary: '副本MCP段已剥离、独立HOME且运行未出现MCP调用；未测恶意外部服务', write: w.write_pass,
    deny_detection: d.forbidden_read_detection.leaked, structured: r.structured.ok, trace: r.completed,
    model_requested: r.request.model, model_readback: r.readback.modelEffective, provider_declared: r.request.configuration.provider_declared,
    provider_readback: r.readback.modelProvider, authentication_method_readback: null, fingerprint_matches: fingerprintMatches,
    effort_requested: null, effort_declared: configDeclarations[p === 'native' ? 'config.toml' : `${p}.config.toml`]?.model_reasoning_effort ?? null,
    effort_readback: null, effort_readback_source: 'unverified',
    evidence: ['read', 'write', 'deny'].map(a => `routes/codex-${p}-${a}-${a === 'write' ? writeVariant : codexVariant}/`) });
}
for (const [p, batch] of [['qwen', 1], ['kimi', 2], ['deepseek', 3]]) {
  const observed = routeResult('static', p, 'version');
  const version = /(\d+\.\d+\.\d+)/.exec(observed.stdout)?.[1] ?? null;
  const route = resolveClaudeRoute(ctx.config, p, version);
  const saved = ctx.config.probe.cli.claude.routes[`profile:${p}`];
  const oldFile = path.resolve(`doc/05_testing/evidence/agent-access-20261009/batch-${batch}/summary.json`);
  const old = read(oldFile).results.find(r => r.report)?.report.probe.cli.claude;
  const reuse = route.fingerprint === saved.fingerprint && version === old.version;
  const variants = p === 'qwen' ? [1] : [1, 2, 3];
  const writes = variants.map(v => routeResult('claude', p, 'write', v));
  const entryMatches = writes.every(w => hashFile(w.request.entry) === w.request.entry_sha256 &&
    hashFile(w.request.native_entry) === w.request.native_entry_sha256);
  const wrote = writes.find(w => w.write_pass);
  const diagnostic = p === 'qwen' ? null : routeResult('claude', p, 'write-permission-diagnostic');
  rows.push({ agent: 'claude', profile: p, status: !reuse ? '未测：旧指纹不匹配' : !entryMatches ? '未测：当前入口漂移' : wrote ? '通过（部分匹配旧证据复用）' : '未测：写入尝试前提未满足',
    read: reuse && old.headless_read_ok, tool_whitelist: reuse && old.tool_surface_checked, mcp_isolation: reuse && old.strict_mcp_config_applied,
    write: wrote ? true : null, write_interception_layer: wrote ? 'tool-registration' : null,
    permission_diagnostic: diagnostic ? { ...diagnostic.diagnostic, completed: diagnostic.completed,
      breach_exists: diagnostic.breach_exists, model_readback: diagnostic.readback.model,
      evidence: `routes/claude-${p}-write-permission-diagnostic-1/`,
      boundary: '真实权限拒绝已观测；不据错误文案独自区分显式deny命中与默认未授权拒绝，不替代生产臂' } : null,
    deny_detection: reuse ? 'Read权限拒绝；Grep不完整，保留事后核验' : '未测',
    structured: reuse && old.json_schema_ok, trace: reuse && old.trace_path_structured, cli_version: version,
    model_requested: writes[0].request.model, model_readback: writes[0].readback.model, provider_declared: p, provider_readback: null,
    authentication_method_readback: null, old_fingerprint_matches: reuse, current_entry_matches: entryMatches,
    old_probe_script_hash: null, old_binary_content_hash: null, old_evidence_sha256: hashFile(oldFile),
    old_evidence: `../agent-access-20261009/batch-${batch}/`, evidence: variants.map(v => `routes/claude-${p}-write-${v}/`) });
}
const proRead = routeResult('claude', 'qwen-pro', 'read');
const proWrites = [1, 2, 3].map(v => routeResult('claude', 'qwen-pro', 'write', v));
const proDeny = routeResult('claude', 'qwen-pro', 'deny', 2);
const proReadDeny = routeResult('claude', 'qwen-pro', 'deny', 1);
const proWrite = proWrites.some(w => w.write_pass);
const pairedDeny = (r, name) => r.completed && r.trace.toolUses.some(t => t.name === name && t.id && r.trace.erroredToolUseIds.includes(t.id));
const proRoute = resolveClaudeRoute(ctx.config, 'qwen', proRead.request.cli_version_observed);
const proMatches = [proRead, ...proWrites, proDeny, proReadDeny].every(r => r.request.configuration.fingerprint === proRoute.fingerprint && r.readback.model === 'qwen3.8-max' &&
  hashFile(r.request.entry) === r.request.entry_sha256 && hashFile(r.request.native_entry) === r.request.native_entry_sha256);
const pro = { status: proMatches && proRead.completed && proRead.readback.model === 'qwen3.8-max' && proRead.structured.ok &&
    proRead.tool_surface.clean && proRead.tool_surface.missing.length === 0 && proRead.tool_surface.mcpCount === 0 && proWrite && pairedDeny(proReadDeny, 'Read') && pairedDeny(proDeny, 'Grep')
    ? '本次组合实测通过；共享pro未切换' : '未测/未通过',
  model_requested: proRead.request.model, model_readback: proRead.readback.model, provider_readback: null, effort_requested: null, effort_readback: null,
  tools: proRead.tool_surface, write: proWrite,
  write_interception_layer: 'tool-registration',
  deny: 'Read及目录Grep实际尝试被拒；不据单例宣称Grep全面覆盖，事后核验保留',
  shared_pro_switched: false, three_critics_restored: false, reason: '计划r2要求七条默认路线完整准入后实施配置事务；Kimi/DeepSeek仍未测',
  evidence: ['routes/claude-qwen-pro-read-1/', 'routes/claude-qwen-pro-write-3/', 'routes/claude-qwen-pro-deny-1/', 'routes/claude-qwen-pro-deny-2/'] };
const pools = {};
for (const pool of ['admission', 'review']) {
  const b = openBudget(root, pool);
  const reserves = fs.readdirSync(b.dir).filter(n => /^reserved-\d+\.json$/.test(n)).sort();
  const launches = fs.readdirSync(b.dir).filter(n => /^launch-\d+\.json$/.test(n)).sort();
  const missing = reserves.filter(n => !fs.existsSync(path.join(b.dir, n.replace('reserved-', 'launch-'))));
  const loadedDir = path.join(root, 'loaded');
  const loaded = fs.readdirSync(loadedDir).map(n => read(path.join(loadedDir, n)));
  const records = reserves.map(n => read(path.join(b.dir, n)));
  const loadedMissing = records.filter(r => r.load_id && !loaded.some(m => m.pid === r.parent_pid && m.load_id === r.load_id && m.preload_sha256 === r.preload_sha256 && m.core_sha256 === r.core_sha256));
  pools[pool] = { limit: b.limit(), used: reserves.length, completed: launches.length, incomplete: missing, loaded_missing: loadedMissing.map(r => r.index),
    legacy_without_loaded_proof: records.filter(r => !r.load_id).map(r => r.index) };
}
const summary = { observed_at: new Date().toISOString(), script_sha256: hashFile(new URL(import.meta.url)), baseline: 'b04cc302fbefa1ed1737edb676a6dc70eadba89c',
  old_budget: { used: 48, limit: 48, unchanged: oldIntact }, pools, rows, pro, native_auth_configuration_issue: codexNativeRouteIssue(codexHomeOf()),
  codex_current_static: { cli_version: '0.162.0', home_isolation: homeIsolation, path_deny: pathDeny },
  official_claude: '待订阅恢复', prerequisite_complete: false, m11_step12_started: false,
  configuration_changes: ['本机sensitive_globs隔离本轮可变运行元数据；pro/native与两审覆盖不变'],
  source_note: '旧版本/入口内容hash与脚本hash缺失项保留null，不用本轮值补历史；Claude供应商、认证方法与effort没有运行回读均null' };
const id = crypto.randomUUID();
saveEvidence(path.join(root, `summary-${id}.json`), summary);
console.log(JSON.stringify({ evidence: `summary-${id}.json`, pools, rows: rows.map(r => ({ agent: r.agent, profile: r.profile, status: r.status })), pro: pro.status }, null, 2));
