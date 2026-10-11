/** 本轮送审前零CLI审计；只读取现状并经脱敏扫描保存新证据，不修改历史。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { resolveClaudeRoute } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { codexAdapter } from '../../../../dist/test/src/trivium/adapters/codex.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const require = createRequire(import.meta.url);
const { openBudget } = require('../../../../scripts/agent-access-budget.cjs');
const root = path.dirname(fileURLToPath(import.meta.url));
const ctx = await loadCtx();
const old = path.join(ctx.projectRoot, 'doc/05_testing/evidence/agent-access-20261010-closeout-r2');
const topic = 'Agent双模式接入真实准入收口';
const hash = p => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };
const read = p => JSON.parse(fs.readFileSync(p));
function tree(dir) {
  const result = {};
  function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d,e.name);
    if (e.isDirectory()) walk(p); else result[path.relative(dir,p)] = hash(p);
  } }
  walk(dir); return result;
}
const stamp = await computeBuildStamp(ctx.projectRoot);
const bundle = path.join(os.homedir(), '.claude/skills/dual-critic/scripts/trivium.cjs');
const embedded = /define_TRIVIUM_BUILD_default = \{ repo_root_commit: "([a-f0-9]+)", git_head: "([a-f0-9]+)", dirty: (true|false), inputs_sha256: "([a-f0-9]+)", built_at: "([^"]+)" \}/.exec(fs.readFileSync(bundle,'utf8'));
const installedStamp = embedded ? { repo_root_commit:embedded[1], git_head:embedded[2],dirty:embedded[3]==='true',inputs_sha256:embedded[4],built_at:embedded[5] } : null;
const layout = { archiveRoot:ctx.archiveRoot,topic };
const task = await readTask(layout), runs = await listRecordedRuns(layout);
const oldSummary = read(path.join(old,'summary-c03fb637-02d0-446b-b2bc-cbf0045514a1.json'));
const ledgers = Object.fromEntries(['admission','review'].map(pool=>[pool,{used:fs.readdirSync(path.join(old,'ledger',pool)).filter(n=>n.startsWith('reserved-')).length,completed:fs.readdirSync(path.join(old,'ledger',pool)).filter(n=>n.startsWith('launch-')).length,limit:openBudget(old,pool).limit()}]));
const names = ['dual-abandon','dual-approve','dual-review-bug','dual-review-code','dual-review-plan','dual-run','dual-status'];
const entries = names.map(name=>({name,copies:['.agents','.codex','.zcode'].map(family=>{
  const p=path.join(os.homedir(),family,'skills',name,'SKILL.md');
  const s=fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';
  return {family,path:p,sha256:hash(p),symlink:fs.existsSync(p)?fs.lstatSync(p).isSymbolicLink():null,
    driver_literals:[...new Set([...s.matchAll(/--driver ([A-Za-z]+)/g)].map(m=>m[1]))],product_identity:s.startsWith(`---\nname: ${name}\n`)&&s.includes('.trivium/bin/trivium'),
    rendered_source_match:hash(p)===hash(path.join(ctx.projectRoot,'skills/dual-critic/entry',family==='.agents'?'codex':family.slice(1),name,'SKILL.md'))};
})}));
const routes = Object.fromEntries(['qwen','kimi','deepseek'].map(profile=>{
  const r=resolveClaudeRoute(ctx.config,profile);const saved=ctx.config.probe.cli.claude?.routes?.[`profile:${profile}`];
  return [profile,{entry:r.bin,native:r.nativeBin,entry_sha256:hash(r.bin),native_sha256:hash(r.nativeBin),wrapper_sha256:r.wrapperSha256,configuration_sha256:r.configurationSha256,route_fingerprint:r.fingerprint,models_declared:r.modelsDeclared,saved_version:saved?.probe.version??null,saved_directory_fingerprint:saved?.probe.directory_deny_fingerprint??null}];
}));
const codex = Object.fromEntries([null,'qwen','kimi','deepseek'].map(profile=>[profile??'native',codexAdapter.accessFor(ctx.config,profile)]));
saveEvidence(path.join(root,'baseline.json'),{at:new Date().toISOString(),real_cli_starts:0,stamp,installedStamp,
  bundle_sha256:hash(bundle),repo_bundle_sha256:hash(path.join(ctx.projectRoot,'skills/dual-critic/scripts/trivium.cjs')),
  inputs_match:stamp?.inputs_sha256===installedStamp?.inputs_sha256,head_match:stamp?.git_head===installedStamp?.git_head,
  config_hashes:Object.fromEntries(['.trivium/config.yaml','.trivium/config.local.yaml'].map(p=>[p,hash(path.join(ctx.projectRoot,p))])),
  global_hashes:Object.fromEntries(['.codex/config.toml','.codex/auth.json','.codex/hooks.json','.claude/settings.json'].map(p=>[p,hash(path.join(os.homedir(),p))])),
  scripts:Object.fromEntries(fs.readdirSync(path.join(ctx.projectRoot,'scripts')).filter(n=>n.startsWith('agent-access')||n==='probe-agent-access.mjs').map(n=>[n,hash(path.join(ctx.projectRoot,'scripts',n))])),
  configuration:{critics:ctx.config.review.default_critics,sensitive_globs:ctx.config.review.sensitive_globs,profiles:ctx.config.profiles,codex_profile:ctx.config.agents.codex.profile,claude_profile:ctx.config.agents.claude.profile},
  routes,codex,cli_versions_live:null,version_boundary:'本轮未启动CLI版本命令；已保存版本仅是历史声明，新增启动须重新取证',
  formal_runs:task.runs,archive_runs:runs.map(r=>({run_id:r.run_id,stage:r.stage,status:r.status})),budgets:ledgers,
  last_review:read(path.join(ctx.archiveRoot,topic,'code/_meta/run-20261010T170416Z.json')).status,
  current_full_admission:null,old_matrix:oldSummary.rows.map(r=>({agent:r.agent,combination:r.combination,status:r.status,model:r.model_effective}))});
saveEvidence(path.join(root,'shared-entry-audit.json'),{at:new Date().toISOString(),real_cli_starts:0,entries,creation_source:null,client_actual_duplicate_resolution:'未测',directories_modified:false,
  source_clues:['所有共享入口仍调用本产品wrapper；四条主入口含大写Codex，与渲染源的小写codex/glm不同','已有2026-10-09迁移备份线索，但不能证明现在七份入口由谁恢复'],
  dependency_scope:['HomeIn/AGENTS.md','KaiXinGuo-SEL-czb/AGENTS.md','TriviumCode/AGENTS.md','TriviumCode/doc/04_development/GUIDE_codex_development.md'],
  dependencies_boundary:'已读说明未找到依赖共享dual-*绝对路径；未覆盖全部仓库和客户端缓存，不宣称无依赖'});
saveEvidence(path.join(root,'historical-retention-before.json'),{at:new Date().toISOString(),real_cli_starts:0,old_root:old,old_files:tree(old),review_files:tree(path.join(ctx.archiveRoot,topic)),script_sha256:hash(fileURLToPath(import.meta.url))});
console.log(JSON.stringify({root,installedStamp,inputs_match:stamp?.inputs_sha256===installedStamp?.inputs_sha256,formal_runs:task.runs.length,budgets:ledgers,shared_conflicts:entries.length,real_cli_starts:0}));
