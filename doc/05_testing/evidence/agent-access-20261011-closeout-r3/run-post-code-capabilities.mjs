/** 执行已公布新bundle的一遍38臂；原失败保留，配方不改，不自动重试。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const batch=JSON.parse(fs.readFileSync(path.join(root,'post-code-fingerprint-r12-batch.json')));
const external=path.join(os.homedir(),'.trivium/evidence/agent-access-20261011-closeout-r3');
const jobs=batch.rows.flatMap(row=>row.arms.map(arm=>({agent:row.agent,combination:row.combination,arm,key:`${row.agent}-${row.combination}-${arm}`})));
if(jobs.length!==38)throw Error('公布清单不符');
const count=()=>fs.readdirSync(path.join(batch.budget_root,'ledger/admission')).filter(n=>/^reserved-/.test(n)).length;
const results=[];let cursor=0;
async function worker(){for(;;){const job=jobs[cursor++];if(!job)return;
  if(count()+(job.agent==='codex'?2:1)>batch.before+batch.hard_max_starts)throw Error('公布硬上限不足，停止队列');
  const profile=job.agent==='claude'||job.combination.startsWith('native-')?'native':job.combination;
  const selection=path.join(root,`selection-r12-post-code-${profile}.json`);
  const label=`r12-post-code-cap-${job.key}`;
  const child=spawn(process.execPath,[path.join(root,'quiet-launch.mjs'),'v4','admission',label,'probe',job.agent,job.combination,job.arm,'2'],
    {env:{...process.env,TRIVIUM_ACCESS_SELECTION:selection},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.once('error',e=>stderr+=`dispatch:${e.code??'unknown'}\n`);
  const [code,signal]=await new Promise(resolve=>child.once('close',(...v)=>resolve(v)));
  const record={...job,label,code,signal,stdout,stderr,selection_sha256:hash(selection),at:new Date().toISOString()};
  results.push(record);saveEvidence(path.join(external,`${label}-dispatch.json`),record);
  console.log(JSON.stringify({completed:results.length,total:jobs.length,key:job.key,process_code:code,admission_starts:count()}));
}}
const settled=await Promise.allSettled([worker(),worker(),worker()]);
const errors=settled.filter(r=>r.status==='rejected').map(r=>String(r.reason.message));
saveEvidence(path.join(external,'post-code-capabilities-r12-dispatch.json'),{script_sha256:hash(fileURLToPath(import.meta.url)),
  batch_sha256:hash(path.join(root,'post-code-fingerprint-r12-batch.json')),results,errors,queue_complete:results.length===jobs.length,
  admission_starts:count(),prompt_changed:false,automatic_retry:false,original_criterion_unchanged:true});
if(errors.length||results.length!==jobs.length)process.exitCode=1;
