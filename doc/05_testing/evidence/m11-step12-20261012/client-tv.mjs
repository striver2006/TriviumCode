/** 独立验收项目的计数外壳：原安装编排器/适配器执行，原预算侧车负责每个厂商边界。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { saveEvidence,primaryLoaded } from '../../../../scripts/agent-access-evidence.mjs';
import { redactSecrets } from '../../../../dist/test/src/trivium/secrets.js';
const repo=path.resolve(import.meta.dirname,'../../../..'),here=import.meta.dirname;
const {openBudget,hashFile}=createRequire(import.meta.url)(repo+'/scripts/agent-access-budget.cjs');
const plan=JSON.parse(fs.readFileSync(here+'/budget-plan.json')),cfg=JSON.parse(fs.readFileSync(here+'/client-batch.json'));
const args=process.argv.slice(2),pool=args[0]==='preflight'||args[0]==='doctor'?'admission':'review';
if(process.cwd()!==cfg.fixture)throw Error('只允许在本轮具名独立验收项目运行');
if(args[0]==='doctor'&&!args.includes('--selftest'))throw Error('本批不授权重新探针');
let approvalEvidence=null;
if(args[0]==='abandon')throw Error('本批未授权放弃闸门');
if(args[0]==='approve'){
 // 验收外壳只消费Bob本次具名决定；生产approve仍自行核验裁决/工件完整性。
 const name=cfg.approval_receipt;
 if(typeof name!=='string'||!/^approval-[a-z0-9-]+\.json$/.test(name))throw Error('缺Bob当次具名批准回执，禁止自批');
 const file=path.join(here,name),a=JSON.parse(fs.readFileSync(file,'utf8'));
 if(a.decision!=='approved'||!a.user_answer||a.fixture!==cfg.fixture||!cfg.topics.includes(a.topic)||JSON.stringify(a.command_args)!==JSON.stringify(args))throw Error('审批回执与本次命令不匹配');
 const task=JSON.parse(fs.readFileSync(path.join(cfg.fixture,'.reviews',a.topic,'task.json')));
 const latest=task.runs.filter(r=>r.stage===a.stage).at(-1);
 if(latest?.run_id!==a.run_id||latest?.status!=='success'||task.approvals.some(r=>r.run_id===a.run_id))throw Error('批准不适用于当前轮或该轮已有审批');
 approvalEvidence={source:file,sha256:hashFile(file),run_id:a.run_id};
}
if(args[0]==='review'&&args.includes('--start')){
 const topic=args[args.indexOf('--topic')+1];
 if(!cfg.topics.includes(topic))throw Error('主题未列入本批清单');
}
const budget=openBudget(plan.budgetRoot,pool),token=crypto.randomUUID(),label='m11-s12-'+args[0];
const count=()=>fs.readdirSync(budget.dir).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
const installed=path.join(os.homedir(),'.claude/skills/dual-critic/scripts/trivium.cjs');
if(hashFile(installed)!==cfg.installed_sha256)throw Error('安装指纹改变，停止');
const preload=repo+'/scripts/agent-access-budget-preload.cjs',before=count();
const output=path.join(os.homedir(),'.trivium/evidence/m11-step12-20261012/calls');fs.mkdirSync(output,{recursive:true});
const invocation={at:new Date().toISOString(),load_id:token,pool,label,cwd:process.cwd(),command:[process.execPath,installed,...args],before,installed_sha256:hashFile(installed),script_sha256:hashFile(import.meta.filename),preload_sha256:hashFile(preload),core_sha256:hashFile(repo+'/scripts/agent-access-budget.cjs'),cap_sha256:hashFile(here+'/cap-preload.cjs'),approval_authorization:approvalEvidence};
const request=output+'/'+token+'-requested.json';saveEvidence(request,invocation);
const env={...process.env,TRIVIUM_ACCESS_BUDGET_ROOT:plan.budgetRoot,TRIVIUM_ACCESS_BUDGET_POOL:pool,TRIVIUM_ACCESS_LABEL:label,TRIVIUM_ACCESS_LOAD_TOKEN:token,TRIVIUM_ACCESS_SCRIPT_SHA256:invocation.script_sha256,TRIVIUM_ACCESS_MANIFEST:request,M11_BATCH_ABSOLUTE_CAP:String(cfg.caps[pool]),NODE_OPTIONS:`--require ${here}/cap-preload.cjs --require ${preload}`};
delete env.TRIVIUM_STUB_CRITIC;delete env.TRIVIUM_ASSET_ROOT;
const child=spawn(process.execPath,[installed,...args],{cwd:process.cwd(),env,stdio:['inherit','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
const [code,signal]=await new Promise(r=>child.once('close',(...v)=>r(v)));
const marks=fs.readdirSync(plan.budgetRoot+'/loaded').filter(n=>n.startsWith(token+'-')).map(n=>JSON.parse(fs.readFileSync(plan.budgetRoot+'/loaded/'+n)));
const loaded=primaryLoaded(marks,invocation,process.pid);
saveEvidence(output+'/'+token+'-completed.json',{...invocation,code,signal,after:count(),primary_loaded:loaded,stdout:redactSecrets(stdout).content,stderr:redactSecrets(stderr).content});
process.exitCode=loaded?(code??1):1;
