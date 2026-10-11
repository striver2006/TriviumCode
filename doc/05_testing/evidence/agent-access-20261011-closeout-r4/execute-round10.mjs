/** 原样透传唯一resolve输出；启动前核第9次有效审批，绝不绕过编排器。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {scanSecrets} from '../../../../dist/test/src/trivium/secrets.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const mode=process.argv[2];if(!['preflight','start','freeze'].includes(mode))throw Error('mode');
const topic='Agent双模式接入真实准入收口',repo=process.cwd(),here=path.dirname(new URL(import.meta.url).pathname);
const dir=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/calls');
const files=fs.readdirSync(dir).filter(n=>n.startsWith('r14-code-resolve-')&&n.endsWith('-completed.json'));
if(files.length!==1)throw Error('resolve不唯一');
const resolved=JSON.parse(JSON.parse(fs.readFileSync(path.join(dir,files[0]))).stdout);
if(!resolved.ok||resolved.allow_single||resolved.base!=='39ed20530d64a72f81f183095c6d9516632d0228'||
 resolved.topic!==topic||resolved.driver!=='codex'||resolved.critics.join(',')!=='claude,gemini,glm')throw Error('resolve不适用');
const args=mode==='preflight'?['preflight','--stage','code','--driver',resolved.driver,'--critics',resolved.critics.join(','),'--json']:
 ['review','--start','--entry','C','--stage','code','--topic',resolved.topic,'--driver',resolved.driver,'--critics',resolved.critics.join(','),
  '--focus',resolved.prompt_hint,'--base',resolved.base,'--context',resolved.context_paths.join(','),'--json'];
for(const [key,flag]of[['profile','--profile'],['driver_model','--driver-model'],['driver_provider','--driver-provider'],...(mode==='preflight'?[]:[['task_goal','--goal']])])if(resolved[key]!=null)args.push(flag,resolved[key]);
for(const [field,prefix]of[['models','--model-'],['tiers','--tier-'],['efforts','--effort-'],['vendor_profiles','--profile-']])for(const [id,v]of Object.entries(resolved[field]??{})){
 if(v===null&&field==='vendor_profiles')args.push('--native-'+id);else if(v!=null)args.push(prefix+id,v);
}
if(mode!=='preflight'){
 const task=JSON.parse(fs.readFileSync(`.reviews/${topic}/task.json`));
 const run=JSON.parse(fs.readFileSync(`.reviews/${topic}/plan/_meta/run-20261011T020308Z.json`));
 if(task.runs.length!==9||run.status!=='success'||!task.approvals.some(a=>a.run_id===run.run_id&&a.stage==='plan'&&a.decision==='approved'))throw Error('第9次有效审批未具备');
 const plan=fs.readFileSync(`.reviews/${topic}/plan/2026-10-11-${topic}-r14-codex.md`);
 if(crypto.createHash('sha256').update(plan).digest('hex')!=='9245a852c36798b723dfd8ffb2cf9753a559ed95ad41c167ea64cfe571f7f2df')throw Error('获批计划漂移');
 if(mode==='freeze'){
  const inventory=[];
  for(const name of fs.readdirSync(here)){const p=path.join(here,name);if(fs.statSync(p).isFile()){const b=fs.readFileSync(p);if(scanSecrets(b.toString('utf8')).length)throw Error('静态扫描失败');inventory.push({path:p,sha256:crypto.createHash('sha256').update(b).digest('hex')});}}
  saveEvidence(path.join(here,'round10-static-freeze.json'),{at:new Date().toISOString(),inventory,base:resolved.base,prior_valid_run:run.run_id,
   plan_approved:true,criterion_adopted:false,formal_used_before:9,formal_limit:10,real_cli_starts:0});process.exit(0);
 }
 const frozen=JSON.parse(fs.readFileSync(path.join(here,'round10-static-freeze.json')));
 for(const f of frozen.inventory)if(crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')!==f.sha256)throw Error('静态范围漂移');
}
const child=spawn(process.execPath,['doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v6.mjs','review',
 mode==='preflight'?'r14-code-preflight':'r14-code-start','tv',...args],{stdio:'inherit'});
process.exitCode=await new Promise(resolve=>child.once('close',c=>resolve(c??1)));
