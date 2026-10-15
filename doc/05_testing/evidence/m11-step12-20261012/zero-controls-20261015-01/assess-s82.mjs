/** 只读核验用户终端8.2结果；不重跑gate，不恢复工件，不调用厂商。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,parent=path.dirname(here),repo=path.resolve(here,'../../../../..');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if(fs.existsSync(here+'/s82-assessment.json'))throw Error('已有核验，不重复执行');
const prep=read(here+'/preparation.json'),finished=read(here+'/user-s82-finished.json');
const names=['disposition-baseline','disposition-missing','disposition-restored'];
const results=names.map(n=>read(here+'/'+n+'.json')),outputs=results.map(r=>JSON.parse(r.stdout));
const codes=[0,2,0],taskPath='.reviews/m11-s12-capacity/task.json';
if(!finished.pass||!finished.restored||!finished.originals_unchanged||finished.failure!==null)throw Error('用户步骤未闭合');
const commands=results.map(r=>JSON.stringify(r.command));
if(new Set(commands).size!==1)throw Error('三次gate参数不同');
for(const [i,r] of results.entries()){
 if(r.exit_code!==codes[i]||!r.pass||!r.detail_matched||r.client_hook_event!==false||!r.primary_budget_preload_loaded||JSON.stringify(r.changed_files)!==JSON.stringify([taskPath]))throw Error('逐项结果不符');
 if(JSON.stringify(r.budget_before)!==JSON.stringify(prep.budget_before)||JSON.stringify(r.budget_after)!==JSON.stringify(prep.budget_before))throw Error('预算结果不符');
 if(outputs[i].run_id!==prep.run_id||outputs[i].stage!=='plan'||outputs[i].warnings.length)throw Error('run/stage/warnings不符');
}
if(!outputs[0].ok||!outputs[2].ok||outputs[0].failures.length||outputs[2].failures.length||outputs[1].ok||outputs[1].failures.length!==1||outputs[1].failures[0].code!=='missing_findings'||JSON.stringify(outputs[1].failures[0].ids)!==JSON.stringify(['CODEX-04']))throw Error('未准确且仅报缺CODEX-04');
if(JSON.stringify(outputs[0].structured_ids)!==JSON.stringify(outputs[2].structured_ids))throw Error('恢复后意见集合变化');
const disp=prep.targets.disposition,original=fs.readFileSync(prep.root+'/backup/'+disp,'utf8');
const minus=original.replace(/^\| CODEX-04 \|[^\n]*\n/gm,'');
if([...original.matchAll(/^\| CODEX-04 \|[^\n]*\n/gm)].length!==1||crypto.createHash('sha256').update(minus).digest('hex')!==results[1].pre_state[disp].sha256)throw Error('故障副本不是仅删一条裁决');
const sourceRun=read(prep.source+'/.reviews/m11-s12-capacity/plan/_meta/run-'+prep.run_id+'.json');
const perCritic=Object.fromEntries(sourceRun.critics_selected.map(id=>{
 const review=read(prep.source+'/.reviews/m11-s12-capacity/plan/_meta/review-'+id+'-'+prep.run_id+'.json');
 return[id,(review.findings??[]).map(f=>f.id)];
}));
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
const matrix=read(parent+'/matrix.json');saveEvidence(here+'/matrix-before-s82-assessment.json',matrix);
const base='zero-controls-20261015-01/',row=matrix.rows.find(r=>r.criterion==='8.2');
row.evidence=[...new Set([...row.evidence,...names.map(n=>base+n+'.json'),base+'user-s82-finished.json',base+'s82-assessment.json'])];
row.status='两轮完整裁决gate通过；B2副本缺一行准确拒绝、恢复放行，8.2终端判据通过';
row.observation='Bob系统终端实测同参数gate退出0/2/0；唯一失败missing_findings、ids=[CODEX-04]。B2三侧意见共5条，Gemini零意见。只删一条裁决的hash与负例快照一致；副本裁决/task全部恢复，原件未变，预算838/401。B1 Codex证据不足仍在8.1保留；本结果不代表真实客户端Hook集成。';
matrix.at=new Date().toISOString();
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>'),header=fs.readFileSync(parent+'/matrix.md','utf8').split(/\n(?=\| \d+ \|)/)[0];
const rows=matrix.rows.map(r=>'| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.length?r.evidence.join(', '):'尚无本轮满足判据的证据',r.status].map(esc).join(' | ')+' |');
if(rows.length!==68||new Set(matrix.rows.map(r=>r.criterion)).size!==68)throw Error('矩阵数量/唯一性错误');
fs.writeFileSync(parent+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(parent+'/matrix.md',header+'\n'+rows.join('\n')+'\n');
fs.appendFileSync(repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md',`\n## Z01的8.2缺裁决行负对照闭环核实\n\nBob于2026-10-15 22:21（Asia/Singapore）在系统终端执行一次s82。[原始步骤](./evidence/m11-step12-20261012/${base}user-s82-finished.json)及[独立核验](./evidence/m11-step12-20261012/${base}s82-assessment.json)确认：对B2 plan run 20261012T154021Z三次使用完全相同的gate --check参数，退出码0→2→0。负例仅删除CODEX-04裁决表一行，独立复算内容hash与负例快照相等；唯一失败为missing_findings，ids精确为[CODEX-04]。恢复后五个意见编号齐备、failures/warnings均为空。Gemini零意见，GLM一条与Codex四条全部覆盖；不把零意见解释成缺前缀。\n\n三次gate只正常更新副本task.json的校验留痕，未改变闸门；用户脚本最终恢复裁决及task原字节。独立复核原工程、副本、备份的全部非.git文件集合、hash、权限及大小一致，预算保持838/401，增量0。8.2按CASE要求的终端判据记通过，B1 Codex证据不足继续在8.1保留。矩阵仍68行唯一且同步；场景5真实客户端集成、6.7真实hook-pre-bash独立事件及其它未闭合项不因此通过，M11仍未完成。本次只核验并更新文档，没有再次执行gate、恢复、审批、厂商CLI或提交推送。下一停点仍是用户控制原wrapper权限的6.7独立事件步骤。\n`);
saveEvidence(here+'/s82-assessment.json',{at:new Date().toISOString(),inputs:[...names.map(n=>n+'.json'),'user-s82-started.json','user-s82-finished.json'].map(n=>({file:n,sha256:hash(here+'/'+n)})),
 results:results.map((r,i)=>({mode:r.mode,command:r.command,exit_code:r.exit_code,output:outputs[i],stderr:r.stderr,changed_files:r.changed_files})),
 one_row_removal_verified:true,per_critic_findings:perCritic,restoration:{...checks,non_git_files:expected.length,checks:'exact file set, sha256, mode, bytes'},
 budget_before:prep.budget_before,budget_after:budget,delta:{admission:0,review:0},matrix:{rows:68,unique:68},
 client_hook_event:false,scope:'8.2按原终端判据通过；B1证据不足不追改；只读复核，不重跑任何负对照',pass:true});
console.log(JSON.stringify({pass:true,codes,checks,budget,rows:68,perCritic}));
