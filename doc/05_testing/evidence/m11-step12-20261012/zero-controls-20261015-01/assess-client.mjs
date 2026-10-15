/** 核对Z01真实客户端事件及恢复，仅更新证据/文档；不执行Hook或重新采集。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,parent=path.dirname(here),repo=path.resolve(here,'../../../../..');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if(fs.existsSync(here+'/client-assessment.json'))throw Error('已有核验，不重跑');
const name='client-observation-838d9ff9-c134-4ffb-8410-5a6517d84aa4.json',obs=read(here+'/'+name),prep=read(here+'/preparation.json');
if(obs.pairs.length!==1||obs.pairs[0].results.length!==1)throw Error('具名工具对不唯一');
const pair=obs.pairs[0],result=pair.results[0];
if(pair.request.id!=='toolu_7ea1cacd34e54a649b00cd9e'||result.tool_use_id!==pair.request.id||result.is_error!==true||!result.content.includes('gate hook-pre-commit')||!result.content.includes('护栏失效')||result.content.includes('gate hook-pre-bash'))throw Error('事件与已核对内容不同');
function inventory(root,rel=''){
 return fs.readdirSync(path.join(root,rel)).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n;if(p==='.git')return [];
  const f=path.join(root,p),s=fs.lstatSync(f);if(s.isSymbolicLink())throw Error('发现链接：'+p);
  return s.isDirectory()?inventory(root,p):[{path:p,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
const expected=prep.files.filter(f=>!f.path.startsWith('.git/'));
const restoration=Object.fromEntries([['source',prep.source],['copy',prep.root+'/archive-copy'],['backup',prep.root+'/backup']].map(([k,root])=>[k,JSON.stringify(inventory(root))===JSON.stringify(expected)]));
if(Object.values(restoration).some(v=>!v))throw Error('原件、副本或备份变化，停止同步');
const wrapper=prep.source+'/.trivium/bin/trivium';
const plan=read(parent+'/budget-plan.json'),budget=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
if(JSON.stringify(budget)!==JSON.stringify(prep.budget_before))throw Error('当前预算变化');
// 独立检查该具名工具前后10秒的全部原始事件，不仅检查tool_result。
const from=Date.parse(pair.request.at)-10000,to=Date.parse(result.at)+10000;
const raw=fs.readFileSync(obs.source,'utf8'),events=raw.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(e=>Date.parse(e.timestamp)>=from&&Date.parse(e.timestamp)<=to);
const counts=events.reduce((a,e)=>(a[e.type]=(a[e.type]??0)+1,a),{});
const progress=events.filter(e=>e.type==='progress');
const debug=os.homedir()+'/.claude/debug/52c58d79-eb90-4953-89dc-6ebd5923112e.txt';
const matrix=read(parent+'/matrix.json');saveEvidence(here+'/matrix-before-client-assessment.json',matrix);
const base='zero-controls-20261015-01/',row=matrix.rows.find(r=>r.criterion==='6.7');
row.evidence=[...new Set([...row.evidence,base+name,base+'client-assessment.json'])];
row.status='部分：真实Edit/pre-commit/Stop已有证据；Z01仍只呈现pre-commit错误，pre-bash独立事件未证实；wrapper已恢复';
row.observation='Z01唯一具名Bash toolu_7ea1cacd34e54a649b00cd9e实际报gate hook-pre-commit护栏失效；无pre-bash独立结果，实际退出码null；不推断其未执行或已执行。wrapper原hash/755，原件/副本/备份完整，预算838/401不变。停止同形重试，下一步先准备逐Hook原始事件取证。';
matrix.at=new Date().toISOString();
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>'),header=fs.readFileSync(parent+'/matrix.md','utf8').split(/\n(?=\| \d+ \|)/)[0];
const rows=matrix.rows.map(r=>'| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.length?r.evidence.join(', '):'尚无本轮满足判据的证据',r.status].map(esc).join(' | ')+' |');
if(rows.length!==68||new Set(matrix.rows.map(r=>r.criterion)).size!==68)throw Error('矩阵数量错误');
fs.writeFileSync(parent+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(parent+'/matrix.md',header+'\n'+rows.join('\n')+'\n');
saveEvidence(here+'/client-assessment.json',{at:new Date().toISOString(),criterion:'6.7',observation:{file:name,sha256:hash(here+'/'+name)},
 request:pair.request,result,source_current_sha256:hash(obs.source),window:{from:new Date(from).toISOString(),to:new Date(to).toISOString(),event_counts:counts,progress_event_count:progress.length},
 debug_source_exists:fs.existsSync(debug),independent_pre_bash_event:false,actual_pre_bash_exit_code:null,
 actual_pre_commit_exit_code:null,pre_commit_error_observed:true,
 wrapper:{sha256:hash(wrapper),mode:(fs.statSync(wrapper).mode&0o777).toString(8)},restoration,
 budget_before:prep.budget_before,budget_after:budget,delta:{admission:0,review:0},matrix:{rows:68,unique:68},
 conclusion:'恢复及零预算核验通过；6.7的pre-bash独立事件仍未证实，不升级为通过',
 next_stop:'不再重复本故障注入；先取得逐Hook真实事件/实际退出码的采集能力。不得改序、移除其它守卫或用shell直调替代客户端集成。'});
fs.appendFileSync(repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md',`\n## Z01的6.7真实事件采集：恢复已核实，独立证据仍缺\n\nBob报告已恢复755后，新采集器记录2026-10-15 22:28（Asia/Singapore）的唯一具名Bash，tool_use_id=toolu_7ea1cacd34e54a649b00cd9e，参数为git log --oneline -1、description=M11-Z01-6.7 hook-pre-bash independent event。[原始工具对](./evidence/m11-step12-20261012/${base}${name})实际返回的是hook-pre-commit护栏失效，没有hook-pre-bash独立结果。具名debug文件仍不存在；不能从命令字符串中的exit 2当作实际进程退出码，实际退出码保留null，也不能据此断言pre-bash未执行或已执行。\n\n[独立核验](./evidence/m11-step12-20261012/${base}client-assessment.json)确认wrapper恢复原hash 07ac4e37315b252f103fd4bf475d6c60c896f97230f27d24194bc4a78644be80与755权限，原工程、副本和备份全部非.git文件集合/hash/权限/大小一致，预算仍838/401、增量0。矩阵6.7继续部分完成，不改成通过；68行状态同步。场景5的CLI负对照和8.2终端判据结果不受影响，真实客户端提交护栏集成仍未测。\n\n不再重复相同故障注入。下一停点改为逐Hook真实事件与退出码取证准备：保留全部守卫及执行顺序，先核对客户端是否能暴露每个Hook的启动/完成事件；若需新客户端启动、诊断开关或局部取证改动，先给出具体变更和恢复方案，并按新增范围取得授权。当前未启动客户端或厂商CLI、未改任何Hook配置、未重复恢复或负对照，M11仍未完成。\n`);
console.log(JSON.stringify({restoration,budget,pre_bash_event:false,wrapper_mode:'755',rows:68}));
