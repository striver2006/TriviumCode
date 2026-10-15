/** 未生效的具名夹具采集入口。只允许正式init或现有五个Hook，不开放审核/审批等命令。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {here,base,repo,read,hash,budget,verifyAnchors,authorization,saveEvidence,digest} from './common.mjs';
import {primaryLoaded} from '../../../../../../scripts/agent-access-evidence.mjs';
const p=read(here+'/preparation.json'),args=process.argv.slice(2),cwd=fs.realpathSync(process.cwd());
const name=Object.keys(p.fixtures).find(n=>p.fixtures[n]===cwd);assert(name,'cwd必须为具名新夹具，禁止原工程/伪造目录');
assert(!fs.existsSync(here+'/rollback-'+name+'.json'),'该夹具已回滚，禁止重新激活历史批次');
const init=JSON.stringify(args)===JSON.stringify(['init','--json']);
const hooks=Object.values(p.hooks).flatMap(es=>es.flatMap(e=>e.hooks.map(h=>h.command.match(/gate (hook-[a-z-]+)/)?.[1]))).filter(Boolean);
assert(init||(args.length===2&&args[0]==='gate'&&hooks.includes(args[1])),'命令不在本批白名单');
authorization(here+(init?'/setup-authorization.json':'/client-authorization.json'),init?'s5-setup':'s5-client');
verifyAnchors(p);
const lifecycle=read(here+'/lifecycle-readback.json');
assert(!fs.existsSync(lifecycle.buckets.find(b=>b.name===name).path),'新夹具运行桶已出现，先核对生命周期副作用');
if(fs.existsSync(cwd+'/.trivium/state.json'))assert(Object.values(read(cwd+'/.trivium/state.json').gates).every(g=>['idle','approved'].includes(g.state)),'出现运行中/待裁决闸门，停止');
if(!init){assert(fs.existsSync(here+'/setup-'+name+'-after.json'));assert.equal(hash(cwd+'/.trivium/bin/trivium'),hash(here+'/proposed-wrapper.sh'));}
const token=crypto.randomUUID(),pool='review',before=budget();
let stdin=null,input=null;
if(!init){stdin=fs.readFileSync(0);input=JSON.parse(stdin.toString('utf8'));}
const dir=p.root+'/calls';fs.mkdirSync(dir,{recursive:true,mode:0o700});
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
 scope:'采集层回执；没有独立客户端关联或行为等价证据时仅作辅助，不自动更新矩阵'});
process.exitCode=loaded&&JSON.stringify(before)===JSON.stringify(after)?code??1:2;
