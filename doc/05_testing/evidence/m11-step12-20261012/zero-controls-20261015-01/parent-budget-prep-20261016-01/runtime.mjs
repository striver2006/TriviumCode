/** 未生效v2采集入口。仅现有五个Hook，不提供setup/init、审核或审批。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {here,oldHere,base,repo,read,hash,budget,verifyAnchors,authorization,saveEvidence,digest} from './common.mjs';
import {primaryLoaded} from '../../../../../../scripts/agent-access-evidence.mjs';
async function main(){
const p=read(oldHere+'/preparation.json'),args=process.argv.slice(2),cwd=fs.realpathSync(process.cwd());
const name=Object.keys(p.fixtures).find(n=>p.fixtures[n]===cwd);assert(name,'cwd必须为具名新夹具，禁止原工程/伪造目录');
assert(!fs.existsSync(here+'/rollback-'+name+'.json'),'该夹具已回滚，禁止重新激活历史批次');
const init=false; // setup已完成，新候选不提供init入口。
const hooks=Object.values(p.hooks).flatMap(es=>es.flatMap(e=>e.hooks.map(h=>h.command.match(/gate (hook-[a-z-]+)/)?.[1]))).filter(Boolean);
assert(init||(args.length===2&&args[0]==='gate'&&hooks.includes(args[1])),'命令不在本批白名单');
authorization(here+'/client-authorization.json','s5-client-v2');
verifyAnchors(p);
const lifecycle=read(oldHere+'/lifecycle-readback.json');
assert(!fs.existsSync(lifecycle.buckets.find(b=>b.name===name).path),'新夹具运行桶已出现，先核对生命周期副作用');
if(fs.existsSync(cwd+'/.trivium/state.json'))assert(Object.values(read(cwd+'/.trivium/state.json').gates).every(g=>['idle','approved'].includes(g.state)),'出现运行中/待裁决闸门，停止');
if(!init){assert(fs.existsSync(oldHere+'/setup-'+name+'-after.json'));assert.equal(hash(cwd+'/.trivium/bin/trivium'),hash(here+'/proposed-wrapper.sh'));}
const token=crypto.randomUUID(),pool='review',before=budget();
let stdin=null,input=null;
if(!init){stdin=fs.readFileSync(0);input=JSON.parse(stdin.toString('utf8'));}
const binding=read(here+'/client-binding-'+name+'.json');
assert.equal(binding.cwd,cwd);assert.equal(input.cwd,cwd,'HOOK_INPUT_CWD_MISMATCH');
assert(typeof binding.session_id==='string'&&binding.session_id.length>0);
assert.equal(input.session_id,binding.session_id,'HOOK_INPUT_SESSION_MISMATCH');
const dir=here+'/calls';fs.mkdirSync(dir,{recursive:true,mode:0o700});
const request=dir+'/'+token+'-requested.json',preload=repo+'/scripts/agent-access-budget-preload.cjs';
const invocation={at:new Date().toISOString(),load_id:token,pool,label:'m11-s5-next-'+args.join('-'),cwd,
 command:[p.node,p.installed,...args],parent_pid:process.pid,installed_sha256:hash(p.installed),
 script_sha256:hash(import.meta.filename),preload_sha256:hash(preload),core_sha256:hash(repo+'/scripts/agent-access-budget.cjs'),
 cap_sha256:hash(base+'/cap-preload.cjs'),before:before.review,
 hook_input:input?{sha256:digest(stdin),session_id:input.session_id??null,tool_use_id:input.tool_use_id??null,
 tool_name:input.tool_name??null,cwd:input.cwd??null,tool_input:input.tool_input??null}:null};
saveEvidence(request,invocation);
const env={...process.env,TRIVIUM_ACCESS_BUDGET_ROOT:read(base+'/budget-plan.json').budgetRoot,
 TRIVIUM_ACCESS_BUDGET_POOL:pool,TRIVIUM_ACCESS_LABEL:invocation.label,TRIVIUM_ACCESS_LOAD_TOKEN:token,
 TRIVIUM_ACCESS_SCRIPT_SHA256:invocation.script_sha256,TRIVIUM_ACCESS_MANIFEST:request,
 M11_BATCH_ABSOLUTE_CAP:String(before.review),NODE_OPTIONS:`--require ${base}/cap-preload.cjs --require ${preload}`};
delete env.TRIVIUM_STUB_CRITIC;delete env.TRIVIUM_ASSET_ROOT;
const child=spawn(p.node,[p.installed,...args],{cwd,env,stdio:['pipe','pipe','pipe']});
let stdout='',stderr='',spawnError=null;
child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
child.on('error',e=>{spawnError={code:e.code??null,message:e.message};});
child.stdin.on('error',()=>{});child.stdin.end(stdin??undefined);
const [code,signal]=await new Promise(r=>child.once('close',(...v)=>r(v)));
const budgetRoot=env.TRIVIUM_ACCESS_BUDGET_ROOT;
const marks=fs.readdirSync(budgetRoot+'/loaded').filter(n=>n.startsWith(token+'-')).map(n=>read(budgetRoot+'/loaded/'+n));
const loaded=primaryLoaded(marks,invocation,process.pid),after=budget();
saveEvidence(dir+'/'+token+'-completed.json',{...invocation,finished:new Date().toISOString(),pid:child.pid??null,
 code,signal,spawn_error:spawnError,primary_loaded:loaded,stdout,stderr,budget_before:before,budget_after:after,
 scope:'v2采集层回执；未完成真实客户端等价性核验，不自动更新矩阵'});
if(!loaded||JSON.stringify(before)!==JSON.stringify(after))throw Error('CAPTURE_BUDGET_OR_PRELOAD_MISMATCH');
if(signal)process.kill(process.pid,signal);else process.exitCode=code??75;

}
main().catch(error=>{
 const file=here+'/capture-refusal-'+crypto.randomUUID()+'.json';
 saveEvidence(file,{at:new Date().toISOString(),kind:'capture-layer-refusal',reason:error.message,exit_code:75,production_hook_exit:null});
 process.stderr.write('M11 capture layer refused; see separate capture-refusal evidence.\n');process.exitCode=75;
});
