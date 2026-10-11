/** 第8次正式代码审前零CLI核对；旧件不改，敏感内容只保存hash。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hash } from '../../../../scripts/agent-access-selection.mjs';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { measureCodeStart, assertCodeStartMeasurement } from './formal-start-precheck.mjs';
const require = createRequire(import.meta.url);
const { openBudget } = require('../../../../scripts/agent-access-budget.cjs');
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../../..');
const external = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const historical = read(path.join(root, 'historical-retention-before.json'));
const changedHistory = Object.entries(historical.old_files).filter(([p,h]) => hash(path.join(historical.old_root,p)) !== h).map(([p]) => p);
const changedReviews = Object.entries(historical.review_files).filter(([p,h]) => hash(path.join(repo,'.reviews/Agent双模式接入真实准入收口',p)) !== h).map(([p]) => p);
if (changedHistory.length || changedReviews.some(p => p !== 'task.json' && p !== 'code/_meta/changes.diff')) throw Error('历史原件hash改变');
const ctx = await loadCtx({cwd:repo});
const baseline = read(path.join(root,'baseline.json'));
const configEqual = JSON.stringify(baseline.configuration) === JSON.stringify({critics:ctx.config.review.default_critics,
  sensitive_globs:ctx.config.review.sensitive_globs,profiles:ctx.config.profiles,codex_profile:ctx.config.agents.codex.profile,claude_profile:ctx.config.agents.claude.profile});
if (!configEqual) throw Error('模型声明或sensitive_globs改变');
const stamp = await computeBuildStamp(repo);
const source = path.join(repo,'skills/dual-critic/scripts/trivium.cjs');
const installed = path.join(os.homedir(),'.claude/skills/dual-critic/scripts/trivium.cjs');
const build = read(path.join(root,'final-build-r12-code-nits.json'));
if (hash(source) !== build.bundle_sha256 || hash(installed) !== hash(source) || stamp?.inputs_sha256 !== build.source_stamp?.inputs_sha256) throw Error('安装或构建输入不符');
const migration = read(path.join(root,'install-code-nits-r12.json'));
const entries = migration.entries.map(e=>({agent:e.agent,name:e.name,source:e.source,installed:e.installed}));
const homes={claude:'.claude/skills',codex:'.codex/skills',gemini:'.gemini/config/skills',glm:'.zcode/skills'};
for(const e of entries) if(hash(path.join(os.homedir(),homes[e.agent],e.name,'SKILL.md'))!==e.source) throw Error('专用入口改变');
const shared=['dual-abandon','dual-approve','dual-review-bug','dual-review-code','dual-review-plan','dual-run','dual-status'].map(name=>({name,exists:fs.existsSync(path.join(os.homedir(),'.agents/skills',name))}));
if(shared.some(e=>e.exists))throw Error('共享冲突入口重新出现');
const budgetRoot=path.join(external,'budget');
const budgets=Object.fromEntries(['admission','review'].map(pool=>{const b=openBudget(budgetRoot,pool),names=fs.readdirSync(b.dir);
  const reserved=names.filter(n=>/^reserved-/.test(n)),completed=names.filter(n=>/^launch-/.test(n));
  if(reserved.length!==completed.length)throw Error('仍有未收尾启动');
  return [pool,{used:reserved.length,completed:completed.length,limit:b.limit()}];}));
const git=(...args)=>execFileSync('git',['-c','core.quotePath=false',...args],{cwd:repo,encoding:'utf8'});
const paths=[...new Set([...git('diff','--name-only','HEAD','-z').split('\0'),...git('ls-files','--others','--exclude-standard','-z').split('\0')].filter(Boolean))];
const findings=paths.flatMap(p=>scanSecrets(fs.readFileSync(path.join(repo,p),'utf8')).map(f=>({file:p,rule:f.rule,line:f.line})));
if(findings.length)throw Error(`脱敏扫描发现${findings.length}项，拒绝冻结`);
git('diff','--check','--','.',' :(exclude).reviews'.trim());
const measurement=await measureCodeStart(repo,'Agent双模式接入真实准入收口',[]);assertCodeStartMeasurement(measurement);
const globals=Object.fromEntries(Object.keys(baseline.global_hashes).map(p=>[p,hash(path.join(os.homedir(),p))]));
const record={at:new Date().toISOString(),real_cli_starts:0,script_sha256:hash(fileURLToPath(import.meta.url)),
  git_head:git('rev-parse','HEAD').trim(),branch:git('branch','--show-current').trim(),stamp,source_bundle_sha256:hash(source),installed_bundle_sha256:hash(installed),
  historical_original_files_checked:Object.keys(historical.old_files).length,changed_historical_files:changedHistory,changed_historical_reviews:changedReviews, orchestrator_latest_pointer_note:'code/_meta/changes.diff is the normal latest patch pointer; run-specific originals remain unchanged',
  old_failed_runs:['20261010T130139Z','20261010T170416Z'].map(id=>({run_id:id,status:read(path.join(repo,`.reviews/Agent双模式接入真实准入收口/code/_meta/run-${id}.json`)).status})),
  model_and_globs_declarations_unchanged:configEqual,global_hashes:globals,global_changes_since_initial:Object.keys(globals).filter(p=>globals[p]!==baseline.global_hashes[p]),
  global_config_change_source:null,global_config_exact_key_diff:null,budgets,budget_root:budgetRoot,shared,installed_entries:entries,
  changed_files_scanned:paths.length,secret_findings:findings,measurement,
  frozen_file_hashes:Object.fromEntries(paths.map(p=>[p,hash(path.join(repo,p))])),
  formal_started:8,formal_limit:8,criterion_alternative_adopted:false};
saveEvidence(path.join(root,'final-closeout-state-r12.json'),record);
console.log(JSON.stringify({at:record.at,budgets,files:paths.length,history_changed:changedHistory,review_changed:changedReviews,inputs:stamp?.inputs_sha256,settings_bytes:measurement.settings_bytes,skipped:measurement.skipped_count}));
