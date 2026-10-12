/** 真实客户端旁观采样。只读进程与具名项目；不启动厂商、不写归档。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const cfg=JSON.parse(fs.readFileSync(import.meta.dirname+'/client-batch.json'));
const plan=JSON.parse(fs.readFileSync(import.meta.dirname+'/budget-plan.json'));
const root=os.homedir()+'/.trivium/evidence/m11-step12-20261012/observations';
fs.mkdirSync(root,{recursive:true});
const repoId=path.basename(cfg.fixture)+'-'+crypto.createHash('sha256').update(cfg.fixture).digest('hex').slice(0,8);
const runRoot=os.homedir()+'/.trivium/runs/'+repoId;
function inventory(dir,prefix='') {
 if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const file=path.join(dir,e.name),name=prefix+e.name;
  if(e.isDirectory())return inventory(file,name+'/');
  const s=fs.lstatSync(file);return [{path:name,bytes:s.size,mtime_ms:s.mtimeMs}];
 });
}
function command(bin,args){try{return {code:0,stdout:execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})};}catch(e){return {code:e.status??null,stdout:String(e.stdout??''),stderr:String(e.stderr??'')};}}
let stopping=false;process.on('SIGTERM',()=>stopping=true);process.on('SIGINT',()=>stopping=true);
const start=Date.now();let n=0,last='';
while(!stopping&&Date.now()-start<30*60*1000){
 const at=new Date().toISOString(),ps=command('/bin/ps',['-axo','pid=,ppid=,command=']);
 const processes=ps.stdout.split('\n').flatMap(line=>{
  const m=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);if(!m)return [];
  const raw=m[3];
  if(!(/\bagy\b/.test(raw)||/zcode-cli/.test(raw)||raw.includes(cfg.fixture)))return [];
  if(/observe-client|exec_command|python3 -/.test(raw))return [];
  // argv只收判据字段，避免hub令牌、其它会话prompt/账号信息进入证据。
  const pid=Number(m[1]),kind=/\bagy\b/.test(raw)?'agy':/zcode-cli/.test(raw)?'zcode-cli':'fixture-related';
  const cwd=command('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn']);
  const born=command('/bin/ps',['-p',String(pid),'-o','lstart=']);
  return [{pid,ppid:Number(m[2]),kind,lstart:born.stdout.trim(),hub:/--hub(?:\s|$|=)/.test(raw),
   project_in_argv:raw.includes(cfg.fixture),add_dir:raw.includes('--add-dir='+cfg.fixture)?cfg.fixture:null,
   cwd:cwd.stdout.split('\n').find(s=>s.startsWith('n'))?.slice(1)??null,cwd_exit:cwd.code}];
 });
 const budgets=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(f=>/^reserved-\d+\.json$/.test(f)).length]));
 const state={processes,budgets,archive:inventory(cfg.fixture+'/.reviews'),run_files:inventory(runRoot)};
 const signature=JSON.stringify(state);
 if(signature!==last||n%15===0){saveEvidence(root+'/'+Date.now()+'-'+String(n).padStart(5,'0')+'.json',{at,commands:[['/bin/ps','-axo','pid=,ppid=,command='],['/usr/sbin/lsof','-a','-p','<each selected pid>','-d','cwd','-Fn'],['/bin/ps','-p','<each selected pid>','-o','lstart=']],ps_exit:ps.code,argv_projection:true,fixture:cfg.fixture,run_root:runRoot,...state});last=signature;}
 if(n%15===0)console.log(JSON.stringify({at,sample:n,budgets,archive:state.archive.length,run_files:state.run_files.length}));
 n++;await new Promise(r=>setTimeout(r,2000));
}
console.log(JSON.stringify({stopped:true,samples:n}));
