/** 零供应商启动批：既有预算入口负责装载与留痕，本脚本保存完整命令与退出状态。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),here=path.join(repo,'doc/05_testing/evidence/m11-step12-20261012');
const launcher='doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v21.mjs';
const jobs=[
 ['installed-selftest',['doctor','--selftest'],0],
 ['status',['status','--json'],0],
 ['negative-tier',['preflight','--stage','plan','--driver','claude','--critics','codex,gemini','--tier-codex','m11-nonexistent-tier','--json'],64],
 ['negative-effort',['preflight','--stage','plan','--driver','claude','--critics','codex,gemini','--effort-codex','m11-invalid-effort','--json'],64],
 ['negative-glm-effort',['preflight','--stage','plan','--driver','claude','--critics','codex,glm','--effort-glm','high','--json'],64],
 ['negative-profile',['preflight','--stage','plan','--driver','claude','--critics','codex,gemini','--profile-codex','m11-nonexistent-profile','--json'],64],
];
const root=JSON.parse(fs.readFileSync(here+'/budget-plan.json')).budgetRoot;
const used=()=>Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(root+'/ledger/'+p).filter(n=>n.startsWith('reserved-')).length]));
for(const [label,args,expected] of jobs){
 const before=used(),command=[process.execPath,launcher,'admission','m11-step12-'+label,'tv',...args],at=new Date().toISOString();
 const child=spawn(command[0],command.slice(1),{cwd:repo,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const [code,signal]=await new Promise(r=>child.once('close',(...v)=>r(v)));const after=used();
 saveEvidence(here+'/'+label+'.json',{at,command,cwd:repo,code,signal,expected,stdout,stderr,before,after,zero_vendor_starts:JSON.stringify(before)===JSON.stringify(after)});
 console.log(JSON.stringify({label,code,expected,before,after}));
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('零配额批意外启动，停止');
}
