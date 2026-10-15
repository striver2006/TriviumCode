/** 独立准备：完整复制/备份，验证git dry-run不写仓库，只读重估冷缓存预算。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {saveEvidence} from '../../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,zero=path.dirname(here),base=path.dirname(zero);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const prep=read(zero+'/preparation.json'),plan=read(base+'/budget-plan.json');
const budget=()=>Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const root=prep.root+'/s5-client-preparation-01';
assert(!fs.existsSync(root));assert(!fs.existsSync(here+'/next-preparation.json'));
const before=budget();assert.deepEqual(before,{admission:838,review:401});
function inventory(dir,rel=''){
 return fs.readdirSync(path.join(dir,rel)).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n,f=path.join(dir,p),s=fs.lstatSync(f);
  assert(!s.isSymbolicLink());assert(s.isDirectory()||s.isFile());
  return s.isDirectory()?inventory(dir,p):[{path:p,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
const originals=inventory(prep.source);
assert.deepEqual(originals.filter(x=>!x.path.startsWith('.git/')),prep.files.filter(x=>!x.path.startsWith('.git/')));
fs.mkdirSync(root,{mode:0o700});
for(const name of ['archive-copy','backup']){
 fs.cpSync(prep.source,root+'/'+name,{recursive:true,errorOnExist:true,force:false});
 assert.deepEqual(inventory(root+'/'+name),originals);
}
const cwd=root+'/archive-copy';
const args=['-c','core.quotePath=false','--no-optional-locks','commit','--dry-run'];
// 没有运行任何Trivium Hook；只检查Git的安全触发命令在副本上不产生提交/索引变化。
const result=spawnSync('git',args,{cwd,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
assert.equal(result.signal,null);assert(!result.error);assert([0,1].includes(result.status));
const afterFiles=inventory(cwd);assert.deepEqual(afterFiles,originals);
assert.deepEqual(inventory(prep.source),originals);assert.deepEqual(inventory(root+'/backup'),originals);
const config=YAML.parse(fs.readFileSync(prep.source+'/.trivium/config.yaml','utf8'));
const local=YAML.parse(fs.readFileSync(prep.source+'/.trivium/config.local.yaml','utf8'));
const probe=local.probe;
const probeFacts=Object.fromEntries(Object.entries(probe.cli).map(([name,p])=>[name,{
 recorded_version:p.version,probed_at:p.probed_at,entrypoint:p.entrypoint,
 entry_sha256:p.entrypoint&&fs.existsSync(p.entrypoint)?hash(p.entrypoint):null,
 live_cli_version:null,version_query_executed:false
}]));
const samples=[];
for(const [pool,nums]of [['admission',[810,811,812,813,814,815,816,817,833,834,835,836,837,838]],['review',[388,389,390,391,392,393,398,399,400,401]]]){
 for(const n of nums){
  const file=plan.budgetRoot+'/ledger/'+pool+'/reserved-'+String(n).padStart(4,'0')+'.json',v=read(file);
  samples.push({file,sha256:hash(file),pool,index:n,cli:v.cli,kind:v.kind,boundary_parent:v.boundary_parent,entry:v.entry,entry_sha256:v.entry_sha256});
 }
}
const after=budget();assert.deepEqual(after,before);
saveEvidence(here+'/next-preparation.json',{
 at:new Date().toISOString(),source:prep.source,root,files:originals,
 copies_equal:true,original_unchanged:true,git_dry_run:{command:['git',...args],cwd,exit_code:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,
 all_files_including_git_unchanged:true,real_commit_created:false,client_hook_event:false,scope:'仅安全命令验证，不重跑s5 CLI Hook，不证明客户端放行'},
 client_proposal:{entry:'原VS Code Claude Code既有会话',session_id:'52c58d79-eb90-4953-89dc-6ebd5923112e',cwd:prep.source,
 tool:'Bash',input:{command:'git -c core.quotePath=false --no-optional-locks commit --dry-run',description:'M11-S5C01 healthy archive dry-run'},
 expected_hook_pre_commit_exit:0,expected_git_exit:[0,1],real_client_executed:false,configuration_diff:[],
 stop:'客户端触发前停；副本wrapper绑定原cwd，不在副本调用、不伪造cwd、不改绑定。5.2/5.3仍需合法独立客户端夹具方案。'},
 future_vendor_plan:{authorization:false,allowed_increment:{admission:0,review:0},probeFacts,
 probe_ttl_days:config.probe_ttl_days,auth_ttl_hours:config.preflight.auth_cache_ttl_h,
 latest_auth_checked_at:Object.values(probe.auth_routes??{}).map(x=>x.checked_at).sort().at(-1)??null,
 cache_assumption:'全部冷缓存，不借用历史认证成功；不改时间戳',boundary_samples:samples,
 batches:[
 {name:'ZCode Driver + 跨Driver code',critics:['gemini','codex'],routes:{gemini:'gemini-3.8-flash-high / low',codex:'deepseek / deepseek-flash / high'},
 version_boundaries:4,cold_auth_boundaries:3,admission_core:7,review_core:3,
 fresh_driver_start_reserve:3,admission_planning_envelope:10,driver_start_verified:false},
 {name:'Codex L2 plan',critics:['gemini','glm'],routes:{gemini:'gemini-3.8-flash-high / low',glm:'GLM-5.3'},
 version_boundaries:4,cold_auth_boundaries:2,admission_core:6,review_core:4,
 fresh_driver_start_reserve:2,admission_planning_envelope:8,driver_start_verified:false}],
 total_core:{admission:13,review:7},with_unverified_driver_reserves:{admission:18,review:7},
 note:'Driver预留只是拟议admission分类和估算，不是已测边界或授权硬限；启动包装器/SDK/native计数链尚需只读核对与单独批准。版本漂移/能力探针刷新另计，失败即停不自动追加。'},
 budget_before:before,budget_after:after,delta:{admission:0,review:0}
});
saveEvidence(here+'/preparation-errors.json',{errors:[
 {command:['node',here+'/readback.mjs'],exit_code:1,error:'SyntaxError: Unexpected end of input',effect:'首次脚本解析前失败，无证据写入/夹具操作；补齐inventory函数括号后语法检查及一次采集成功'},
 {command:'临时只读YAML字段提取',exit_code:1,error:"TypeError: Cannot read properties of undefined (reading 'cli')",effect:'误从共享config.yaml取probe；改为只读config.local.yaml中的所需字段，无文件变化'}
],vendor_increment:{admission:0,review:0}});
console.log(JSON.stringify({root,files:originals.length,dry_run_exit:result.status,unchanged:true,budget:after}));
