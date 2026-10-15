/** 仅供Bob在系统终端显式执行。代理本轮不得执行：会改动隔离副本的受保护工件。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,prep=JSON.parse(fs.readFileSync(here+'/preparation.json'));
const phase=process.argv[2];
if(!['s5','s82'].includes(phase)||process.argv.length!==3)throw Error('用法：node user-terminal.mjs s5|s82；只由Bob系统终端执行');
const out=here+'/user-'+phase;
if(fs.existsSync(out+'-started.json')||fs.existsSync(out+'-finished.json'))throw Error('该一次性步骤已有记录；禁止重跑');
const copy=prep.root+'/archive-copy',backup=prep.root+'/backup';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const original=f=>prep.files.find(x=>x.path===f);
function check(dir,files){
 const list=(rel='')=>fs.readdirSync(dir+'/'+rel).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n;if(p==='.git')return [];
  const s=fs.lstatSync(dir+'/'+p);if(s.isSymbolicLink())throw Error('不接受链接：'+p);
  return s.isDirectory()?list(p):[p];
 });
 return JSON.stringify(list().sort())===JSON.stringify(files.map(f=>f.path).sort())&&files.every(f=>fs.existsSync(dir+'/'+f.path)&&hash(dir+'/'+f.path)===f.sha256&&(fs.statSync(dir+'/'+f.path).mode&0o777)===f.mode);
}
const protectedFiles=prep.files.filter(f=>!f.path.startsWith('.git/'));
if(!check(prep.source,protectedFiles)||!check(copy,protectedFiles)||!check(backup,protectedFiles))throw Error('原件、副本或备份偏离准备快照');
const budget=()=>{const p=JSON.parse(fs.readFileSync(here+'/../budget-plan.json'));return Object.fromEntries(['admission','review'].map(k=>[k,fs.readdirSync(p.budgetRoot+'/ledger/'+k).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));};
if(JSON.stringify(budget())!==JSON.stringify(prep.budget_before))throw Error('预算变化');
const actions=[],restoreSet=new Set();
function restore(rel){
 const b=backup+'/'+rel;if(hash(b)!==original(rel).sha256)throw Error('备份变化：'+rel);
 fs.copyFileSync(b,copy+'/'+rel);fs.chmodSync(copy+'/'+rel,original(rel).mode);
 actions.push({operation:'restore-copy-from-backup',path:rel,sha256:hash(copy+'/'+rel),mode:original(rel).mode});
}
function capture(mode){
 const command=[process.execPath,here+'/capture.mjs',mode];
 const r=spawnSync(command[0],command.slice(1),{encoding:'utf8',timeout:45000});
 actions.push({command,exit_code:r.status,stdout:r.stdout,stderr:r.stderr});
 if(r.status!==0)throw Error('取证未达预期，停止后续测试并仅恢复：'+mode);
}
saveEvidence(out+'-started.json',{at:new Date().toISOString(),phase,scope:'用户终端发起，仅改独立副本；零厂商，无审批、无提交',budget_before:budget()});
let failure=null;
try {
 if(phase==='s5'){
  const missing=prep.targets.missing;restoreSet.add(missing);
  fs.unlinkSync(copy+'/'+missing);actions.push({operation:'unlink-copy',path:missing});
  capture('artifact-missing');restore(missing);capture('restored-missing');
  const changed=prep.targets.changed;restoreSet.add(changed);
  fs.appendFileSync(copy+'/'+changed,'\n<!-- M11 local negative control -->\n');
  actions.push({operation:'append-copy',path:changed,content:'\n<!-- M11 local negative control -->\n',sha256:hash(copy+'/'+changed)});
  capture('artifact-changed');restore(changed);capture('restored-changed');
 }else{
  // gate --check会正常更新task的joint_checks；用户终端最后恢复该副本，原项目完全不动。
  restoreSet.add('.reviews/m11-s12-capacity/task.json');
  capture('disposition-baseline');
  const rel=prep.targets.disposition;restoreSet.add(rel);
  const text=fs.readFileSync(copy+'/'+rel,'utf8'),pattern=/^\| CODEX-04 \|[^\n]*\n/gm;
  if([...text.matchAll(pattern)].length!==1)throw Error('目标裁决行不唯一');
  fs.writeFileSync(copy+'/'+rel,text.replace(pattern,''));
  actions.push({operation:'remove-one-disposition-row',path:rel,id:'CODEX-04',sha256:hash(copy+'/'+rel)});
  capture('disposition-missing');restore(rel);capture('disposition-restored');
 }
}catch(e){failure=e.message;}
finally{
 for(const rel of restoreSet){try{restore(rel);}catch(e){actions.push({restore_error:e.message,path:rel});failure??=e.message;}}
 const restored=check(copy,protectedFiles),originals_unchanged=check(prep.source,protectedFiles),after=budget();
 const pass=!failure&&restored&&originals_unchanged&&JSON.stringify(after)===JSON.stringify(prep.budget_before);
 saveEvidence(out+'-finished.json',{at:new Date().toISOString(),phase,actions,failure,restored,originals_unchanged,
  budget_before:prep.budget_before,budget_after:after,pass,client_hook_event:false,
  scope:'独立真实归档副本的CLI负对照；不替代真实客户端Hook；所有非.git文件按准备快照恢复'});
 console.log(JSON.stringify({phase,pass,restored,originals_unchanged,failure,budget:after}));
 if(!pass)process.exitCode=1;
}
