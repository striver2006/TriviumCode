/** 只读核实用户终端s5证据，同步报告与矩阵；不重跑负对照或恢复。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,parent=path.dirname(here),repo=path.resolve(here,'../../../../..');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if(fs.existsSync(here+'/s5-assessment.json'))throw Error('已有核验，不重复执行');
const prep=read(here+'/preparation.json'),finished=read(here+'/user-s5-finished.json');
const names=['artifact-missing','restored-missing','artifact-changed','restored-changed'];
const results=names.map(n=>read(here+'/'+n+'.json'));
const codes=[2,0,2,0];
if(!finished.pass||!finished.restored||!finished.originals_unchanged||finished.failure!==null)throw Error('用户步骤未闭合');
for(const [i,r] of results.entries()){
 if(r.exit_code!==codes[i]||!r.pass||!r.detail_matched||r.client_hook_event!==false||!r.primary_budget_preload_loaded||r.changed_files.length)throw Error('逐项结果不符');
 if(JSON.stringify(r.budget_before)!==JSON.stringify(prep.budget_before)||JSON.stringify(r.budget_after)!==JSON.stringify(prep.budget_before))throw Error('预算结果不符');
}
const missing=results[0],changed=results[2];
if(!missing.stderr.includes('已丢失：'+prep.targets.missing.replace(/^\.reviews\//,''))||!missing.stderr.includes(prep.run_id))throw Error('缺件输出缺文件/run');
const changedPath=prep.targets.changed;
const oldHash=changed.pre_state[changedPath].sha256,newHash=prep.files.find(f=>f.path===changedPath).sha256;
if(oldHash===newHash||!changed.stderr.includes('记录 '+newHash.slice(0,12)+'，现为 '+oldHash.slice(0,12)))throw Error('改件输出哈希不匹配');
function inventory(root,rel=''){
 return fs.readdirSync(path.join(root,rel)).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n;if(p==='.git')return [];
  const f=path.join(root,p),s=fs.lstatSync(f);if(s.isSymbolicLink())throw Error('发现链接：'+p);
  return s.isDirectory()?inventory(root,p):[{path:p,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
const expected=prep.files.filter(f=>!f.path.startsWith('.git/'));
const checks=Object.fromEntries([['source',prep.source],['copy',prep.root+'/archive-copy'],['backup',prep.root+'/backup']].map(([k,root])=>[k,JSON.stringify(inventory(root))===JSON.stringify(expected)]));
if(Object.values(checks).some(v=>!v))throw Error('原件、副本或备份未完整恢复');
const plan=read(parent+'/budget-plan.json'),budget=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
if(JSON.stringify(budget)!==JSON.stringify(prep.budget_before))throw Error('当前预算变化');
const pending=['user-s82-started.json','user-s82-finished.json','disposition-baseline.json','disposition-missing.json','disposition-restored.json'];
if(pending.some(n=>fs.existsSync(here+'/'+n)))throw Error('8.2已经产生新证据，需单独核验');
const matrix=read(parent+'/matrix.json');
saveEvidence(here+'/matrix-before-s5-assessment.json',matrix);
const base='zero-controls-20261015-01/';
for(const r of matrix.rows.filter(r=>['5.2','5.3','5.4'].includes(r.criterion))){
 const ns=r.criterion==='5.2'?['artifact-missing']:r.criterion==='5.3'?['artifact-changed']:['restored-missing','restored-changed'];
 r.evidence=[...new Set([...r.evidence,...ns.map(n=>base+n+'.json'),base+'user-s5-finished.json',base+'s5-assessment.json'])];
 r.status=r.criterion==='5.2'?'真实归档副本CLI缺件退出2，点名路径与run；客户端集成未测':r.criterion==='5.3'?'真实归档副本CLI改件退出2，前后hash匹配；客户端集成未测':'缺件/改件两次恢复后CLI均退出0，副本完整恢复；客户端集成未测';
 r.observation='Bob在系统终端执行s5，Hook退出码依次2/0/2/0；原工程、副本和备份的全部非.git文件路径/hash/权限/大小复核一致；预算838/401不变。8.2和6.7真实事件未因此补绿。';
}
matrix.at=new Date().toISOString();
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>');
const header=fs.readFileSync(parent+'/matrix.md','utf8').split(/\n(?=\| \d+ \|)/)[0];
const rows=matrix.rows.map(r=>'| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.length?r.evidence.join(', '):'尚无本轮满足判据的证据',r.status].map(esc).join(' | ')+' |');
if(rows.length!==68||new Set(matrix.rows.map(r=>r.criterion)).size!==68)throw Error('矩阵数量/唯一性错误');
fs.writeFileSync(parent+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(parent+'/matrix.md',header+'\n'+rows.join('\n')+'\n');
fs.appendFileSync(repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md',`\n## Z01场景5用户终端负对照闭环核实\n\nBob于2026-10-15 22:13（Asia/Singapore）在系统终端执行一次s5。[逐步记录](./evidence/m11-step12-20261012/${base}user-s5-finished.json)与[独立核验](./evidence/m11-step12-20261012/${base}s5-assessment.json)确认：副本gemini审查件删除后hook-pre-commit退出2，点名路径及run 20261012T154021Z；恢复后退出0。副本glm审查件内容改变后退出2，输出记录6272030c1fe2、现为5fb4313ff6be，与完整hash快照匹配；恢复后再次退出0。四次CLI均实际装载既有预算侧车，Hook未执行JSON中的git commit。\n\n原工程、完整副本和备份的全部非.git文件集合、hash、权限与大小均与准备快照一致；预算仍838/401，增量0。5.2～5.4的CLI直接调用格已取得本轮证据，连同已有5.1/5.5，场景5五项均有CLI证据；真实客户端Hook集成仍未测，不将本结果提升为客户端集成通过。矩阵继续68个唯一判据，状态一致。8.2缺行负对照尚未执行，当前停在用户终端s82之前；6.7真实pre-bash独立事件仍未闭合。未修改业务代码、未运行新审查或审批、未提交推送，M11仍未完成。\n`);
saveEvidence(here+'/s5-assessment.json',{at:new Date().toISOString(),inputs:[...names.map(n=>n+'.json'),'user-s5-started.json','user-s5-finished.json'].map(n=>({file:n,sha256:hash(here+'/'+n)})),
 results:results.map(r=>({mode:r.mode,criterion:r.criterion,command:r.command,input:r.input,exit_code:r.exit_code,stdout:r.stdout,stderr:r.stderr,client_hook_event:false})),
 restoration:{...checks,non_git_files:expected.length,checks:'exact file set, sha256, mode, bytes'},
 budget_before:prep.budget_before,budget_after:budget,delta:{admission:0,review:0},matrix:{rows:68,unique:68},
 s82_not_started:true,scope:'只读复核用户已执行的s5；CLI与客户端集成分列；不执行恢复或其它负对照',pass:true});
console.log(JSON.stringify({pass:true,codes,checks,budget,rows:68,s82_not_started:true}));
