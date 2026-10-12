/** 仅归集本轮具名项目的公开运行输出；不读取隔离HOME或凭据副本。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,home=os.homedir(),fixture=home+'/Work/trivium-m11-step12-20261012';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const capture=file=>{const content=fs.readFileSync(file,'utf8');return {source:file,sha256:hash(content),bytes:Buffer.byteLength(content),content};};
const plan=JSON.parse(fs.readFileSync(here+'/budget-plan.json'));
const budget=Object.fromEntries(['admission','review'].map(pool=>{
 const dir=plan.budgetRoot+'/ledger/'+pool;
 const read=prefix=>fs.readdirSync(dir).filter(n=>n.startsWith(prefix)).map(n=>JSON.parse(fs.readFileSync(dir+'/'+n))).filter(r=>r.index>plan.baseline[pool].used).sort((a,b)=>a.index-b.index);
 return [pool,{baseline:plan.baseline[pool].used,reservations:read('reserved-'),completed:read('launch-')}];
}));
const callsDir=home+'/.trivium/evidence/m11-step12-20261012/calls';
const calls=fs.readdirSync(callsDir).filter(n=>n.endsWith('-completed.json')).map(n=>JSON.parse(fs.readFileSync(callsDir+'/'+n))).filter(r=>r.at>='2026-10-12T12:40:00.000Z').sort((a,b)=>a.at.localeCompare(b.at));
const runRoot=home+'/.trivium/runs/trivium-m11-step12-20261012-cfe48502';
const runs=[['plan','20261012T125354Z'],['code','20261012T130035Z']].map(([stage,id])=>{
 const runtime=runRoot+'/'+id,meta=fixture+'/.reviews/m11-s12-stack/'+stage+'/_meta/run-'+id+'.json';
 const record=JSON.parse(fs.readFileSync(meta));
 if(record.status!=='success')throw Error('尚未成功收尾：'+id);
 const raw=[];
 for(const side of ['gemini','glm'])for(const name of ['stdout.jsonl','stdout.json','trace.json','rollout.jsonl']){
  const file=runtime+'/'+side+'/out/'+name;if(fs.existsSync(file))raw.push(capture(file));
 }
 return {stage,id,record,raw,status:JSON.parse(fs.readFileSync(runtime+'/status.json')),worker_log:capture(runtime+'/worker.log')};
});
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const archive=files(fixture+'/.reviews/m11-s12-stack').map(capture);
const sessionFile=home+'/.claude/projects/-Users-chenzhenbo-Work-trivium-m11-step12-20261012/52c58d79-eb90-4953-89dc-6ebd5923112e.jsonl';
const sessionRaw=fs.readFileSync(sessionFile,'utf8');
const events=sessionRaw.split('\n').filter(Boolean).flatMap(l=>{try{return [JSON.parse(l)];}catch{return [];}})
 .filter(e=>e.timestamp>='2026-10-12T12:40:00.000Z'&&['user','assistant','system'].includes(e.type))
 .map(e=>({type:e.type,timestamp:e.timestamp,sessionId:e.sessionId,uuid:e.uuid,subtype:e.subtype,message:e.message}));
const obsDir=home+'/.trivium/evidence/m11-step12-20261012/observations';
const observations=fs.readdirSync(obsDir).map(n=>JSON.parse(fs.readFileSync(obsDir+'/'+n))).filter(o=>o.at>='2026-10-12T13:02:18.000Z').map(o=>({...o,
 processes:o.processes.filter(p=>p.cwd===fixture||p.project_in_argv),
 run_files:o.run_files.filter(f=>/\/(?:out\/|status\.json|worker\.log)/.test(f.path)&&!f.path.includes('/home/')),
 unrelated_processes_omitted:true}));
const command=['git','-c','core.quotePath=false','diff','--','src/stack.js','test/stack.test.js'];
const diff=execFileSync(command[0],command.slice(1),{cwd:fixture,encoding:'utf8'});
saveEvidence(here+'/client-a-runs.json',{at:new Date().toISOString(),budget,calls,runs,archive,business_diff:{cwd:fixture,command,code:0,stdout:diff},ui_window_switch:null});
saveEvidence(here+'/client-session-02.json',{at:new Date().toISOString(),source:sessionFile,source_sha256:hash(sessionRaw),events,source_note:'真实客户端会话原始message；统一脱敏。不补写原运行声明。'});
saveEvidence(here+'/client-a-processes.json',{at:new Date().toISOString(),observations,scope:'采样从代码阶段运行中开始。未采到计划阶段实时进程与物理目录，因此不以该记录声称计划阶段延迟落盘已实测。'});
console.log(JSON.stringify({runs:runs.map(r=>({id:r.id,status:r.record.status})),calls:calls.length,archive:archive.length,events:events.length,observations:observations.length,budget_delta:Object.fromEntries(Object.entries(budget).map(([p,v])=>[p,v.reservations.length]))}));
