/** 已公布新指纹版本批：13实际启动预估，无失败回退和隐式variant。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const external=path.join(os.homedir(),'.trivium/evidence/agent-access-20261011-closeout-r3');
const jobs=[['native','static','codex','version','9'],['qwen','static','codex','version','10','qwen'],
  ['kimi','static','codex','version','11','kimi'],['deepseek','static','codex','version','12','deepseek'],
  ['claude-qwen','static','qwen','version','3'],['claude-kimi','static','kimi','version','3'],
  ['claude-deepseek','static','deepseek','version','3'],['help','static','codex','help','3']];
const results=[];let cursor=0;
async function worker(){for(;;){const job=jobs[cursor++];if(!job)return;const [name,...args]=job;
  const label=`r12-post-code-version-${name}`;
  const env={...process.env};delete env.TRIVIUM_ACCESS_SELECTION;
  const child=spawn(process.execPath,[path.join(root,'quiet-launch.mjs'),'v4','admission',label,'probe',...args],{env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.once('error',e=>stderr+=`dispatch:${e.code??'unknown'}\n`);
  const [code,signal]=await new Promise(resolve=>child.once('close',(...v)=>resolve(v)));
  const record={name,label,args,code,signal,stdout,stderr,at:new Date().toISOString()};results.push(record);
  saveEvidence(path.join(external,`${label}-dispatch.json`),record);
  console.log(JSON.stringify({completed:results.length,total:8,name,code}));
}}
const settled=await Promise.allSettled([worker(),worker(),worker()]);
const errors=settled.filter(r=>r.status==='rejected').map(r=>String(r.reason.message));
saveEvidence(path.join(external,'post-code-versions-r12-dispatch.json'),{script_sha256:hash(fileURLToPath(import.meta.url)),results,errors,
  queue_complete:results.length===jobs.length,estimated_starts:13,automatic_retry:false});
if(errors.length||results.length!==jobs.length||results.some(r=>r.code!==0))process.exitCode=1;
