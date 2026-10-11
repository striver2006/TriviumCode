/** 逐模型汇总本轮canonical证据；缺臂未测，不把受控返回或无文件改判真实负对照。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { resolveClaudeRoute } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { codexAdapter } from '../../../../dist/test/src/trivium/adapters/codex.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { loadSelection, selectedEvidence } from '../../../../scripts/agent-access-selection.mjs';
const require = createRequire(import.meta.url);
const { hashFile, openBudget } = require('../../../../scripts/agent-access-budget.cjs');
const root = path.resolve(process.argv[2] ?? 'doc/05_testing/evidence/agent-access-20261010-closeout-r2');
const ctx = await loadCtx();
const selection = loadSelection(process.argv[3]);
const selected = [];
const currentBuild = await computeBuildStamp(process.cwd());
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const route = (agent, model, arm) => {
  const evidence = selectedEvidence(root, selection, `${agent}-${model}-${arm}`);
  selected.push({ key: `${agent}-${model}-${arm}`, reference: evidence?.ref ?? null, complete: evidence?.complete ?? false, missing: evidence?.missing ?? null });
  if (!evidence?.complete) return null;
  const { dir, result, after } = evidence;
  if (JSON.stringify(result.request) !== JSON.stringify(evidence.request)) throw Error('结果与独立请求不符');
  const before = result.request?.fingerprints;
  const declaration = agent === 'claude' ? resolveClaudeRoute(ctx.config, result.request.profile, result.request.cli_version_observed).configurationSha256
    : codexAdapter.accessFor(ctx.config, result.request.profile).configuration_sha256;
  const current = before && Object.entries({ ...before.modules, ...before.assets }).every(([p,h]) => hashFile(p) === h) &&
    hashFile(result.request.entry) === before.entry && hashFile(result.request.native_entry) === before.native_entry &&
    hashFile('.trivium/config.yaml') === before.shared_config && hashFile('.trivium/config.local.yaml') === before.local_config &&
    Object.entries(before.globals).every(([p,h]) => hashFile(path.join(os.homedir(),p)) === h) && declaration === before.profile_config &&
    JSON.stringify(before) === JSON.stringify(after?.fingerprints) &&
    currentBuild?.inputs_sha256 && currentBuild.inputs_sha256 === result.request.build_inputs?.inputs_sha256;
  return { dir: path.relative(root, dir), result, compatible: after?.unchanged === true && current === true };
};
const rows = [];
for (const [agent, combinations] of [['claude', ['qwen', 'qwen-pro', 'kimi', 'kimi-pro', 'deepseek', 'deepseek-pro']],
  ['codex', ['native-sol', 'native-luna', 'native-astra', 'qwen', 'kimi', 'deepseek']]]) {
  for (const combination of combinations) {
    const r = route(agent, combination, 'read'), w = route(agent, combination, 'write');
    const denials = (agent === 'claude' ? ['deny-read', 'deny-grep'] : ['deny']).map(a => route(agent, combination, a));
    const readOk = Boolean(r?.compatible && r.result.completed && r.result.actual_read && r.result.strict_first_word && r.result.structured.ok);
    const readbackOk = [r, w, ...denials].filter(Boolean).every(a => a.result.readback.model && a.result.readback.model === a.result.request.model);
    const attempted = w && (agent === 'claude' ? w.result.trace.toolUses.some(t => ['Write','Bash'].includes(t.name))
      : w.result.trace.rawItems.some(i => i.type === 'command_execution' && /BREACH/.test(i.command ?? '')));
    const write = attempted ? w.compatible && w.result.completed && w.result.write_pass : null;
    const deny = denials.every(d => d?.compatible && d.result.completed && (agent === 'claude'
      ? d.result.deny_pass && !d.result.forbidden_read_detection.leaked : d.result.forbidden_read_detection.leaked));
    const arms = [r, w, ...denials].filter(Boolean);
    const mcp = arms.length > 0 && arms.every(a => agent === 'claude' ? a.result.tool_surface?.clean &&
      a.result.tool_surface.missing.length === 0 && a.result.tool_surface.mcpCount === 0 &&
      read(path.join(root, a.dir, 'production-shape.json')).readonlyArgs.includes('--strict-mcp-config')
      : a.result.mcp_calls.length === 0 && (() => { const i = read(path.join(root, a.dir, 'isolation.json'));
        return i.independent_home && i.configs.every(c => c.mcp_sections_present === false); })());
    const complete = readOk && readbackOk && write === true && deny && mcp;
    rows.push({ agent, combination, status: complete ? '通过' : !r || write === null || denials.some(d => !d) ? '未测' : '未通过',
      read_schema_firstword: r ? readOk : '未测', model_readback_matches: r ? readbackOk : '未测',
      production_write: write === null ? '未测' : write, per_file_deny_or_detection: denials.some(d => !d) ? '未测' : deny,
      mcp_isolation: arms.length ? mcp : '未测', fingerprint_compatible: arms.length ? arms.every(a => a.compatible) : '未测',
      model_requested: r?.result.request.model ?? null, model_effective: r?.result.readback.model ?? null,
      model_effective_source: r?.result.readback.model_source ?? null,
      provider_declared: r?.result.request.configuration.provider_declared ?? null,
      model_configuration_declared: !r ? null : agent === 'claude' ? r.result.request.configuration.models_declared
        : read(path.join(root, r.dir, 'isolation.json')).configs.map(c => ({ file:c.name, ...c.declared })),
      provider_effective: r?.result.readback.provider ?? null, provider_effective_source: r?.result.readback.provider_source ?? null,
      server_identity: null, effort_requested: null, effort_effective: r?.result.readback.effort ?? null,
      effort_effective_source: r?.result.readback.effort_source ?? null,
      cli_version: r?.result.request.cli_version_observed ?? null,
      write_layer: write ? agent === 'claude' ? 'tool-registration' : 'sandbox/OS-error' : null,
      deny_boundary: agent === 'claude' ? '逐文件实际Read/Grep配对拒绝与完整Schema；保留事后检测，不外推任意输入' : '事后命中，不宣称CLI阻止读取',
      mcp_boundary: '受测只读参数/隔离副本及实际轨迹，不证明恶意外部服务全面安全',
      evidence: arms.map(a => a.dir) });
  }
}
const budgets = {};
for (const pool of ['admission','review']) {
  const b = openBudget(path.join(root, 'budget'), pool), names = fs.readdirSync(b.dir);
  const reserved = names.filter(n => /^reserved-\d+\.json$/.test(n)), launches = names.filter(n => /^launch-\d+\.json$/.test(n));
  budgets[pool] = { used: reserved.length, completed: launches.length, limit: b.limit(),
    incomplete: reserved.filter(n => !names.includes(n.replace('reserved-', 'launch-'))) };
}
const summary = { observed_at: new Date().toISOString(), canonical_sha256: hashFile(new URL(import.meta.url)),
  selection: { file: selection.file, sha256: selection.sha256, selected }, rows, budgets,
  official_claude: '未测：待订阅恢复', criteria_change_authorized: false,
  prerequisite_complete: rows.length === 12 && rows.every(r => r.status === '通过'),
  m11_step12_started: false, configuration_changes: '项目配置由doctor/preflight回填事实与auth；模型映射及sensitive_globs不变。全局Codex config hash出现外部变化，来源及迁移时的具体键差异未知；本轮未写全局配置，当前配置原样保留。',
  identity_boundary: '请求、配置声明、CLI回读分列；服务端身份缺独立证据均null',
  original_criteria: '实际模型生产写尝试+精确目标/ID配对拒绝+文件前后状态；缺真实尝试未测，受控返回不能替代' };
const filename = 'matrix-r12-code-nits.json';
const staticRoot = path.dirname(new URL(import.meta.url).pathname);
summary.canonical_parent_sha256 = hashFile(path.join(process.cwd(), 'scripts/agent-access-closeout-summary.mjs'));
summary.dynamic_root = root; summary.budget_root = path.join(root, 'budget');
summary.arm_details = selected.map(s => {
  const e = selectedEvidence(root, selection, s.key);
  return { ...s, completed: e?.result?.completed ?? null, structured: e?.result?.structured?.ok ?? null,
    actual_read: e?.result?.actual_read ?? null, strict_first_word: e?.result?.strict_first_word ?? null,
    write_pass: e?.result?.write_pass ?? null, deny_pass: e?.result?.deny_pass ?? null,
    per_file_deny: e?.result?.per_file_deny ?? null, readback: e?.result?.readback ?? null,
    forbidden_read_detection: e?.result?.forbidden_read_detection ?? null,
    write_control: e?.result?.write_control ?? null, cleanup: e ? read(path.join(e.dir, 'cleanup.json')) : null };
});
summary.known_gaps = summary.rows.filter(r => r.status !== '通过').map(r => ({ route: r.agent + '/' + r.combination, read: r.read_schema_firstword, write: r.production_write, deny: r.per_file_deny_or_detection }));
saveEvidence(path.join(staticRoot, filename), summary);
console.log(JSON.stringify({ filename, budgets, rows: rows.map(r => ({ agent:r.agent,combination:r.combination,status:r.status })), prerequisite_complete:summary.prerequisite_complete }));
