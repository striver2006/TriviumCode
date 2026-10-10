/** 本轮审批前交付核对：零厂商启动，不改历史原件/业务配置。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {scanSecrets} from '../../../../dist/test/src/trivium/secrets.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const baseline=read(path.join(here,'baseline.json'));
const historical=baseline.historical_roots.map(root=>({name:root.name,files:Object.keys(root.files).length,
  unchanged:Object.entries(root.files).every(([p,h])=>sha(path.join(repo,'doc/05_testing/evidence',root.name,p))===h)}));
if(historical.some(x=>!x.unchanged))throw Error('旧证据发生改变，拒绝宣称保留');
const budget={};
for(const pool of ['admission','review']){
  const dir=path.join(here,'ledger',pool),names=fs.readdirSync(dir);
  const reserved=names.filter(n=>n.startsWith('reserved-')),completed=names.filter(n=>n.startsWith('launch-'));
  const launches=completed.map(n=>read(path.join(dir,n)));
  budget[pool]={reserved:reserved.length,completed:completed.length,limit:read(path.join(here,'approval.json')).initial_limits[pool],
    incomplete:reserved.filter(n=>!names.includes(n.replace('reserved-','launch-'))),
    version_starts:launches.filter(l=>l.kind==='version').length,nonzero_exits:launches.filter(l=>l.code!==0).length};
  if(budget[pool].incomplete.length)throw Error('台账未收尾');
}
const globals=Object.fromEntries(Object.entries(baseline.global_hashes).map(([name,hash])=>[name,{sha256:sha(path.join(os.homedir(),name)),unchanged:sha(path.join(os.homedir(),name))===hash}]));
const calls=fs.readdirSync(path.join(here,'calls')).filter(n=>n.endsWith('-completed.json')).map(n=>read(path.join(here,'calls',n)));
if(calls.some(c=>!c.primary_loaded||c.script_sha256!==c.execution_sha256))throw Error('装载或执行hash声明不匹配');
const observed=Object.fromEntries(calls.filter(c=>c.label==='s06-preflight').map(c=>['preflight',JSON.parse(c.stdout)]));
const reviews=['claude','gemini','glm'].map(role=>{
 const name=`2026-10-10-Agent双模式接入真实准入收口-${role}.md`;
 const file=path.join(repo,'.reviews/Agent双模式接入真实准入收口/plan',name);
 const text=fs.readFileSync(file,'utf8');
 const value=key=>new RegExp('^'+key+': (.+)$','m').exec(text)?.[1]??null;
 return {role,path:path.relative(repo,file),sha256:sha(file),agent_cli:value('agent_cli'),model_requested:value('model_requested'),
  model_effective:value('model_effective'),model_effective_source:value('model_effective_source'),verdict:value('verdict'),
  provider_effective:null,server_identity:null,consulted_unverified:value('consulted_unverified')==='true'};
});
const combinations=[
 ['codex','native','gpt-6.1-sol'],['codex','native','gpt-6-luna'],['codex','native','gpt-6-astra'],
 ['codex','qwen','qwen3.8-flash'],['codex','kimi','kimi-for-coding'],['codex','deepseek','deepseek-flash'],
 ['claude','qwen','qwen3.8-flash'],['claude','qwen','qwen3.8-max'],['claude','kimi','kimi-for-coding'],['claude','kimi','k3'],
 ['claude','deepseek','deepseek-flash'],['claude','deepseek','deepseek-v4-pro'],['claude','native',null]
].map(([agent,route,model])=>({agent,route,model_requested_for_future_arm:model,
  cli_version_current:agent==='codex'?'0.162.1':'2.1.296',
  model_effective_this_round:agent==='claude'&&route==='qwen'&&model==='qwen3.8-flash'?'qwen3.8-flash':null,
  model_effective_source:agent==='claude'&&route==='qwen'&&model==='qwen3.8-flash'?'formal-plan-review/envelope':null,
  provider_declared:route==='native'?(agent==='codex'?'openai':null):route,
  provider_effective:null,server_identity:null,effort_effective:null,
  current_full_schema_capability_arms:'未测',current_production_write_control:'未测',current_per_file_deny_arms:'未测',
  reason:route==='native'&&agent==='claude'?'待订阅恢复':agent==='claude'&&['kimi-for-coding','k3','deepseek-flash'].includes(model)?
   '旧真实模型无生产写调用；新版本能力未测，不降判据':'旧能力版本/完整指纹不匹配，不复用为当前准入'}));
let files=0;function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else{if(scanSecrets(fs.readFileSync(p,'utf8')).length)throw Error('证据扫描有候选，拒绝交付');files++;}
}}scan(here);
const output={observed_at:new Date().toISOString(),client_date:'2026-10-10',timezone:'Asia/Singapore',
 status:'awaiting_this_round_plan_approval',run_id:'20261010T062559Z',driver:'codex',entry:'A',
 git:{head:execFileSync('git',['-c','core.quotePath=false','rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
  tracked_diff:execFileSync('git',['-c','core.quotePath=false','diff','--stat'],{cwd:repo,encoding:'utf8'}).trim()},
 baseline_zero_starts:true,bundle_unchanged:baseline.bundles.every(b=>sha(b.path)===b.sha256),
 native_entry_unchanged:baseline.claude.every(r=>sha(r.native_entry)===r.entry_sha256),historical_preserved:historical,
 globals,budget,launcher_hash_declaration_consistent:true,all_calls_primary_loaded:true,preflight:observed.preflight,
 formal_plan_review:{completed:true,rounds_used:1,rounds_max:4,reviews,findings:16,all_accepted:true,
  verdicts_remain_request_changes:true,gate_check:JSON.parse(calls.find(c=>c.label==='plan-gate-check').stdout),
  await_approval:JSON.parse(calls.find(c=>c.label==='plan-await-approval').stdout)},
 combinations,configuration_changes:{business:false,global_manually_edited:false,project_probe_auth:'doctor agy refresh and preflight auth cache update',route_models_effort:'unchanged'},
 new_check_runs:'未测',new_selftest:'未测',new_install:'未测',code_review:'未测',criteria_change_authorized:false,
 no_business_implementation:true,commit_push_performed:false,M11_precondition_complete:false,
 scan:{files,candidates:0},next_step:'用户本轮人工审批后先整改与回归，再当前版本补测；候选判据改变另行明确审批'};
saveEvidence(path.join(here,'delivery-pending-approval.json'),output);
console.log(JSON.stringify({budget,gate_check:output.formal_plan_review.gate_check.ok,awaiting_approval:output.formal_plan_review.await_approval,
 historical_preserved:true,globals_unchanged:Object.values(globals).every(x=>x.unchanged),M11_precondition_complete:false,scan:output.scan}));
