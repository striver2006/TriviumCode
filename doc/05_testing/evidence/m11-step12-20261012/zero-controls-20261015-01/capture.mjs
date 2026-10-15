/** 固定参数取证入口。提交命令仅作为Hook输入，从不执行git commit。修改/恢复由Bob终端操作。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,parent=path.dirname(here),repo=path.resolve(here,'../../../../..');
const prep=JSON.parse(fs.readFileSync(here+'/preparation.json'));
const plan=JSON.parse(fs.readFileSync(parent+'/budget-plan.json'));
const mode=process.argv[2];
const specs={
 'copy-baseline':['archive-copy','commit',0,'5.1'],
 'no-reviews':['no-reviews','commit',0,'5.5'],
 'wrapper-missing':['missing-wrapper','shell',2,'6.7'],
 'artifact-missing':['archive-copy','commit',2,'5.2'],
 'restored-missing':['archive-copy','commit',0,'5.4'],
 'artifact-changed':['archive-copy','commit',2,'5.3'],
 'restored-changed':['archive-copy','commit',0,'5.4'],
 'disposition-missing':['archive-copy','gate',2,'8.2'],
 'disposition-baseline':['archive-copy','gate',0,'8.2'],
 'disposition-restored':['archive-copy','gate',0,'8.2'],
};
if(!Object.hasOwn(specs,mode)||process.argv.length!==3)throw Error('只接受具名步骤');
if(fs.existsSync(here+'/'+mode+'.json'))throw Error('证据已存在，拒绝重跑');
const [name,kind,expected,criterion]=specs[mode],cwd=path.join(prep.root,name);
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const budget=()=>Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const checkOriginals=()=>prep.files.filter(f=>!f.path.startsWith('.git/')).every(f=>fs.existsSync(prep.source+'/'+f.path)&&hash(prep.source+'/'+f.path)===f.sha256&&(fs.statSync(prep.source+'/'+f.path).mode&0o777)===f.mode);
const snapshot=()=>Object.fromEntries(prep.files.filter(f=>f.path.startsWith('.reviews/')||f.path.startsWith('.trivium/')||f.path.startsWith('src/')||f.path.startsWith('test/')).map(f=>{
 const p=cwd+'/'+f.path;return[f.path,fs.existsSync(p)?{sha256:hash(p),mode:fs.statSync(p).mode&0o777}:null];
}));
const before=budget(),pre=snapshot();
if(JSON.stringify(before)!==JSON.stringify(prep.budget_before)||!checkOriginals()||hash(prep.installed)!==prep.installed_sha256)throw Error('原件、运行时或预算变化');
const target=key=>cwd+'/'+prep.targets[key];
const originalHash=key=>prep.files.find(f=>f.path===prep.targets[key]).sha256;
if(mode==='artifact-missing'&&fs.existsSync(target('missing')))throw Error('请先由用户在终端移走指定副本');
if(mode==='artifact-changed'&&hash(target('changed'))===originalHash('changed'))throw Error('请先由用户在终端改动指定副本');
if(mode==='disposition-missing'&&/^\| CODEX-04 \|/m.test(fs.readFileSync(target('disposition'),'utf8')))throw Error('请先由用户在终端删指定裁决行');
if(mode.startsWith('restored-')||mode==='copy-baseline'||mode==='disposition-restored'){
 for(const key of Object.keys(prep.targets))if(hash(target(key))!==originalHash(key))throw Error('目标尚未恢复：'+key);
}
if(name==='no-reviews'&&fs.existsSync(cwd+'/.reviews'))throw Error('无审查记录对照混入归档');
const input={session_id:'m11-zero-controls-20261015-01',cwd,tool_name:'Bash',tool_input:{command:kind==='shell'?'git log --oneline -1':'git commit -m x'}};
const args=kind==='gate'?['gate','--stage','plan','--topic','m11-s12-capacity','--run-id',prep.run_id,'--check','--json']:['gate','hook-pre-commit','--agent','claude'];
const env={...process.env,GIT_OPTIONAL_LOCKS:'0',CLAUDE_PROJECT_DIR:cwd,
 TRIVIUM_ACCESS_BUDGET_ROOT:plan.budgetRoot,TRIVIUM_ACCESS_BUDGET_POOL:'review',TRIVIUM_ACCESS_LABEL:'m11-zero-'+mode,
 TRIVIUM_ACCESS_LOAD_TOKEN:crypto.randomUUID(),M11_BATCH_ABSOLUTE_CAP:'401',
 NODE_OPTIONS:`--require ${parent}/cap-preload.cjs --require ${repo}/scripts/agent-access-budget-preload.cjs`};
delete env.TRIVIUM_STUB_CRITIC;delete env.TRIVIUM_ASSET_ROOT;
const command=kind==='shell'?['/bin/sh','-c',prep.shell_hook_pre_bash]:[process.execPath,prep.installed,...args];
const result=spawnSync(command[0],command.slice(1),{cwd,env,input:kind==='gate'?'':JSON.stringify(input),encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
const marks=fs.readdirSync(plan.budgetRoot+'/loaded').filter(n=>n.startsWith(env.TRIVIUM_ACCESS_LOAD_TOKEN+'-')).map(n=>JSON.parse(fs.readFileSync(plan.budgetRoot+'/loaded/'+n)));
const loaded=kind==='shell'?null:marks.some(m=>m.parent_pid===process.pid&&m.preload_sha256===hash(repo+'/scripts/agent-access-budget-preload.cjs')&&m.core_sha256===hash(repo+'/scripts/agent-access-budget.cjs'));
const after=budget(),post=snapshot(),output=(result.stdout??'')+'\n'+(result.stderr??'');
const changed=Object.keys(pre).filter(f=>JSON.stringify(pre[f])!==JSON.stringify(post[f]));
let detail=true;
if(mode==='artifact-missing')detail=output.includes(path.basename(prep.targets.missing))&&output.includes(prep.run_id)&&output.includes('已丢失');
if(mode==='artifact-changed')detail=output.includes(path.basename(prep.targets.changed))&&output.includes(prep.run_id)&&output.includes('记录 '+originalHash('changed').slice(0,12)+'，现为 '+hash(target('changed')).slice(0,12));
if(mode==='disposition-missing'){
 try{const j=JSON.parse(result.stdout);detail=j.failures.some(f=>f.code==='missing_findings'&&JSON.stringify(f.ids)===JSON.stringify(['CODEX-04']));}catch{detail=false;}
}
if(kind==='shell')detail=output.includes('护栏失效');
const sameBudget=JSON.stringify(before)===JSON.stringify(after);
const evidence={at:new Date().toISOString(),criterion,mode,cwd,command,input:kind==='gate'?null:input,
 expected_exit:expected,exit_code:result.status,signal:result.signal,error:result.error?.message??null,
 stdout:result.stdout,stderr:result.stderr,pre_state:pre,post_state:post,changed_files:changed,
 budget_before:before,budget_after:after,budget_delta:{admission:after.admission-before.admission,review:after.review-before.review},
 original_files_unchanged:checkOriginals(),client_hook_event:false,embedded_command_executed:false,
 primary_budget_preload_loaded:loaded,budget_load_marks:marks,script_sha256:hash(import.meta.filename),installed_sha256:hash(prep.installed),
 detail_matched:detail,pass:result.status===expected&&detail&&sameBudget&&checkOriginals()&&(kind==='shell'||loaded===true)&&(kind==='gate'||changed.length===0),
 restoration:mode.startsWith('restored-')||mode==='disposition-restored'?'三个目标已逐字节恢复；gate自身可能更新副本task.json，整副本恢复另验':'本步未做破坏性写入；故障状态保留或无须恢复',
 scope:kind==='shell'?'项目原Hook shell命令独立调用；非真实客户端事件，不补绿6.7':'真实归档完整副本的CLI直接调用；不代表客户端Hook集成'};
saveEvidence(here+'/'+mode+'.json',evidence);
console.log(JSON.stringify({mode,exit_code:result.status,pass:evidence.pass,changed_files:changed,budget:after}));
if(!evidence.pass)process.exitCode=1;
