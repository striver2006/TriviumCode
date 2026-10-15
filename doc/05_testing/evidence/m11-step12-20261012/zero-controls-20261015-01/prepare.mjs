/** 一次性零厂商准备。只新建副本和证据，不改真实项目及历史工件。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,parent=path.dirname(here);
const source='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const root='/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01';
const read=f=>JSON.parse(fs.readFileSync(f));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const plan=read(parent+'/budget-plan.json'),batch=read(parent+'/client-batch.json');
const budget=()=>Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
function inventory(dir,relative='') {
 return fs.readdirSync(path.join(dir,relative)).sort().flatMap(n=>{
  const rel=path.join(relative,n),f=path.join(dir,rel),s=fs.lstatSync(f);
  if(s.isSymbolicLink())throw Error('拒绝链接：'+rel);
  if(s.isDirectory())return inventory(dir,rel);
  if(!s.isFile())throw Error('拒绝特殊文件：'+rel);
  return [{path:rel,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
const before=budget();
if(before.admission!==838||before.review!==401||batch.hard.admission!==0||batch.hard.review!==0)throw Error('预算/授权基线变化');
if(fs.existsSync(root))throw Error('副本已存在；禁止重复准备或覆盖');
const files=inventory(source); // 含独立.git，无硬链接、无认证目录复制。
const installed=path.join(os.homedir(),'.claude/skills/dual-critic/scripts/trivium.cjs');
if(hash(installed)!==batch.installed_sha256)throw Error('安装指纹变化');
fs.mkdirSync(root,{mode:0o700});
for(const name of ['archive-copy','backup'])fs.cpSync(source,path.join(root,name),{recursive:true,errorOnExist:true,force:false});
for(const name of ['archive-copy','backup'])if(JSON.stringify(inventory(path.join(root,name)))!==JSON.stringify(files))throw Error('复制字节或权限不一致');
const init=[];
for(const name of ['no-reviews','missing-wrapper']){
 const dir=path.join(root,name);fs.mkdirSync(dir);fs.mkdirSync(dir+'/.trivium');
 fs.copyFileSync(source+'/.trivium/config.yaml',dir+'/.trivium/config.yaml',fs.constants.COPYFILE_EXCL);
 const args=['-c','core.quotePath=false','init','--quiet',dir];
 const r=spawnSync('git',args,{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
 init.push({command:['git',...args],exit_code:r.status,stdout:r.stdout,stderr:r.stderr});
 if(r.status!==0)throw Error('空仓初始化失败');
}
const run=read(source+'/.reviews/m11-s12-capacity/plan/_meta/run-20261012T154021Z.json');
const targets={missing:'.reviews/'+run.artifacts.find(a=>a.path.endsWith('-r2-gemini.md')).path,
 changed:'.reviews/'+run.artifacts.find(a=>a.path.endsWith('-r2-glm.md')).path,
 disposition:'.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-revised-claude.md'};
const settings=read(source+'/.claude/settings.json');
const shellHook=settings.hooks.PreToolUse.flatMap(e=>e.hooks).find(h=>h.command.includes('gate hook-pre-bash')).command;
const after=budget();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('准备期间预算变化');
saveEvidence(here+'/preparation.json',{at:new Date().toISOString(),source,root,installed,installed_sha256:hash(installed),files,targets,
 run_id:run.run_id,critics_selected:run.critics_selected,omitted_id:'CODEX-04',shell_hook_pre_bash:shellHook,
 budget_before:before,budget_after:after,batch_caps:batch.caps,init,
 originals_unchanged:JSON.stringify(inventory(source))===JSON.stringify(files),copies_byte_mode_equal:true,
 scope:'完整独立副本与备份；未运行复制的wrapper、未改原件、未跑gate --check；原wrapper只接受原cwd，副本CLI用固定参数取证入口。'});
console.log(JSON.stringify({root,files:files.length,budget:after,copies_byte_mode_equal:true}));
