/** 五组合当前正向来源；原配方、不重试、不采用判据，供随后受控机制逐一绑定。 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
const here=path.dirname(fileURLToPath(import.meta.url)),read=f=>JSON.parse(fs.readFileSync(f)),a=read(here+'/batch-a.json');
const {openBudget,hashFile}=createRequire(import.meta.url)(a.repo+'/scripts/agent-access-budget.cjs'),budget=openBudget(a.budget_root,'admission');
const count=()=>{const ns=fs.readdirSync(budget.dir);return{used:ns.filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed:ns.filter(n=>/^launch-\d+\.json$/.test(n)).length,limit:budget.limit()};};
async function frozen(b){for(const[f,h]of Object.entries(b.files))if(hashFile(f)!==h)throw Error('冻结来源变化:'+f);const stamp=await computeBuildStamp(a.repo);if(stamp.dirty||stamp.git_head!==b.git_head||stamp.inputs_sha256!==a.source_stamp.inputs_sha256)throw Error('生产输入变化');if(hash(fileURLToPath(import.meta.url))!==b.controller_sha256)throw Error('控制脚本变化');const c=count();if(c.used!==c.completed||c.used>b.batch_stop)throw Error('台账未闭合或超限');}
const file=here+'/batch-b.json';
if(process.argv[2]==='prepare'){
 const c=count(),stamp=await computeBuildStamp(a.repo);if(c.used!==783||c.completed!==783||c.limit!==815)throw Error('批次基线变化');
 const allocated=new Set(fs.readdirSync(a.evidence_root+'/routes')),jobs=[];
 for(const [agent,combo,arm,profile,model]of [['claude','qwen-pro','read','qwen','qwen3.8-max'],['static','kimi','version','kimi',null],['claude','kimi-pro','read','kimi','k3'],['claude','kimi','read','kimi','kimi-for-coding'],['static','deepseek','version','deepseek',null],['claude','deepseek','read','deepseek','deepseek-flash'],['claude','deepseek-pro','read','deepseek','deepseek-v4-pro']]){
  const key=`${agent}-${combo}-${arm}`;let variant=1;while(allocated.has(`${key}-${variant}`))variant++;const route_directory=`${key}-${variant}`;allocated.add(route_directory);jobs.push({name:key,args:[agent,combo,arm,String(variant)],profile,model,route_directory,expected_starts:1,hard_starts:3});
 }
 const q=read(here+'/version-claude-qwen-proof.json');
 const b={at:new Date().toISOString(),authorization:'Bob：提交，推送，然后继续完成剩下的问题；沿本轮免双审，不含判据采用',criteria_adopted:false,before:c,batch_stop:804,expected_starts:7,hard_starts:21,git_head:stamp.git_head,files:a.files,controller_sha256:hash(fileURLToPath(import.meta.url)),qwen_version:q.reference,jobs,purpose:'为五个受限组合的受控机制批提供当前真实模型/工具面/default权限模式来源；不补生产真实写尝试'};await frozen(b);saveEvidence(file,b);console.log(JSON.stringify({prepared:true,jobs:7,expected:7,hard:21,stop:804,pool:815}));
}else if(process.argv[2]==='run'){
 const b=read(file);await frozen(b);if(count().used!==b.before.used)throw Error('批前台账变化');saveEvidence(here+'/batch-b-started.json',{at:new Date().toISOString(),batch_sha256:hash(file)});
 const versions={qwen:b.qwen_version},proofs=[];let failed=null;
 for(const j of b.jobs){try{
  await frozen(b);const before=count(),out=a.evidence_root+'/routes/'+j.route_directory;if(fs.existsSync(out)||before.used+j.hard_starts>b.batch_stop)throw Error('重复目标或预算不足');
  const env={...process.env};delete env.TRIVIUM_ACCESS_SELECTION;
  if(j.args[0]!=='static'){if(!versions[j.profile])throw Error('版本来源缺失');const p=here+'/batch-b-'+j.name+'-selection.json';saveEvidence(p,{schema:'trivium.access.selection.v1',routes:{},versions:{['static-'+j.profile+'-version']:versions[j.profile]}});env.TRIVIUM_ACCESS_SELECTION=p;}
  saveEvidence(here+'/batch-b-'+j.name+'-started.json',{at:new Date().toISOString(),job:j,before});console.log(JSON.stringify({starting:j.name,budget:before}));
  const child=spawn(process.execPath,[a.repo+'/'+a.launcher,'admission','convergence-b-'+j.name,'probe',...j.args],{cwd:a.repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',e=>stderr+='spawn:'+e.code);
  const timer=setInterval(()=>console.log(JSON.stringify({running:j.name,budget:count()})),30000);const[code,signal]=await new Promise(r=>child.once('close',(...x)=>r(x)));clearInterval(timer);saveEvidence(here+'/batch-b-'+j.name+'-dispatch.json',{at:new Date().toISOString(),code,signal,stdout,stderr,before,after:count()});if(code!==0||signal)throw Error('包装器/配方未完成');
  await frozen(b);const r=read(out+'/result.json'),after=read(out+'/fingerprints-after.json'),reasons=[];if(!r.completed||!after.unchanged)reasons.push('未完整完成或指纹漂移');if(count().used-before.used>j.hard_starts)reasons.push('单项启动超限');
  const reference={variant:Number(j.args[3]),...Object.fromEntries(['requested.json','result.json','fingerprints-after.json'].map(n=>[n,hash(out+'/'+n)]))};
  let sourceUsable=null;if(j.args[0]==='static')versions[j.profile]=reference;else{
   if(!r.actual_read||!r.strict_first_word||!r.structured.ok||r.readback.model!==j.model)reasons.push('原正向读取条件未通过');
   const c=read(out+'/cleanup.json'),fx=read(out+'/fixture-before.json');if(c.fixture_residue!==null||!c.scratch_removed||fs.existsSync(fx.root))reasons.push('夹具清理不完整');
   sourceUsable=r.trace.init?.permissionMode==='default'&&r.tool_surface.clean&&r.tool_surface.missing.length===0&&r.tool_surface.mcpCount===0&&read(out+'/production-shape.json').readonlyArgs.includes('--strict-mcp-config');if(!sourceUsable)reasons.push('受控机制所需生产工具面/default模式缺失');
  }
  const p={at:new Date().toISOString(),job:j.name,combination:j.args[1],model:j.model,profile:j.profile,pass:reasons.length===0,reasons,source_usable:sourceUsable,reference,directory:out,actual_starts:count().used-before.used,criteria_changed:false};saveEvidence(here+'/batch-b-'+j.name+'-proof.json',p);proofs.push(p);console.log(JSON.stringify({finished:j.name,pass:p.pass,reasons,budget:count()}));if(!p.pass)throw Error(reasons.join('；'));
 }catch(e){failed={job:j.name,error:e.message};break;}}
 saveEvidence(here+'/batch-b-result.json',{at:new Date().toISOString(),failed,proofs,budget:count(),new_starts:count().used-b.before.used,criteria_adopted:false,prerequisite_complete:false});console.log(JSON.stringify({finished:true,failed,completed_jobs:proofs.length,budget:count()}));if(failed)process.exitCode=1;
}else throw Error('prepare | run');
