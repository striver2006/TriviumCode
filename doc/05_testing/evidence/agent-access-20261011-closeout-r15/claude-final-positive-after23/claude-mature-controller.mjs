import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { saveEvidence } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import { hash } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
const root=path.dirname(new URL(import.meta.url).pathname);
const batch=JSON.parse(fs.readFileSync(root+'/claude-mature-remainder-batch.json'));
const names=batch.jobs.map(j=>j.name);
for(const n of names){const job=batch.jobs.find(j=>j.name===n);if(fs.existsSync(root+'/'+n+'-dispatch.json')||fs.existsSync(batch.evidence_root+'/routes/'+job.route_directory))throw Error('已请求任务');}
saveEvidence(root+'/mature-controller-start.json',{at:new Date().toISOString(),names,batch_sha256:hash(root+'/claude-mature-remainder-batch.json'),controller_sha256:hash(new URL(import.meta.url)),automatic_retry:false,new_jobs:false,criteria_changed:false});
async function call(script,name){const started_at=new Date().toISOString(),c=spawn(process.execPath,[root+'/'+script,name],{cwd:batch.repo,env:process.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.once('error',e=>stderr+='child:'+String(e.code??'unknown'));const heartbeat=setInterval(()=>console.log(JSON.stringify({running:name,phase:script,at:new Date().toISOString()})),30000);const [code,signal]=await new Promise(r=>c.once('close',(...v)=>r(v)));clearInterval(heartbeat);const record={name,script,started_at,finished_at:new Date().toISOString(),code,signal,stdout,stderr};saveEvidence(root+'/controller-'+name+'-'+(script.startsWith('audit')?'audit':'dispatch')+'.json',record);if(code===0)console.log(stdout.trim());else console.log(JSON.stringify({name,script,code,signal,record_saved:true}));return code;}
const completed=[];let failure=null;
for(const name of names){const d=await call('claude-mature-remainder.mjs',name);if(d!==0){failure={name,phase:'dispatch',code:d};break;}const a=await call('audit-claude-mature-remainder.mjs',name);if(a!==0){failure={name,phase:'audit',code:a};break;}completed.push(name);}
saveEvidence(root+'/mature-controller-terminal.json',{at:new Date().toISOString(),completed,failure,automatic_retry:false,criteria_changed:false});
console.log(JSON.stringify({terminal:true,completed,failure}));if(failure)process.exitCode=1;
