/** S5C01只读核对并同步文档；不重跑客户端、Hook、检查点或恢复。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {saveEvidence} from '../../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'../..'),repo=path.resolve(here,'../../../../../..');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),hash=f=>sha(fs.readFileSync(f));
const before=read(here+'/s5-client-before.json'),after=read(here+'/s5-client-after.json'),prep=read(here+'/next-preparation.json');
assert(!fs.existsSync(here+'/s5-client-assessment.json'));
assert(before.ready&&after.ready);assert.equal(before.pairs.length,0);assert.equal(after.pairs.length,1);
assert.deepEqual(before.files,after.files);assert.deepEqual(before.files,prep.files);
assert.deepEqual(after.budget_after,{admission:838,review:401});
const pair=after.pairs[0];assert.equal(pair.results.length,1);
const id='toolu_3fb0ff3d5be3421980559972';assert.equal(pair.request.block.id,id);
assert.deepEqual(pair.request.block.input,prep.client_proposal.input);
assert(pair.request.at>before.at&&pair.results[0].at<after.at);
const raw=fs.readFileSync(after.transcript.path),events=raw.toString().split('\n').filter(Boolean).map((l,i)=>({line:i+1,event:JSON.parse(l)}));
const blocks=events.flatMap(({line,event:e})=>(Array.isArray(e.message?.content)?e.message.content:[]).filter(b=>['tool_use','tool_result'].includes(b.type)).map(block=>({line,at:e.timestamp,cwd:e.cwd,session_id:e.sessionId,block})));
const requests=blocks.filter(x=>x.block.type==='tool_use'&&x.at>=before.at&&x.at<=after.at);
assert.equal(requests.length,1);assert.deepEqual(requests[0],pair.request);
const results=blocks.filter(x=>x.block.type==='tool_result'&&x.block.tool_use_id===id);assert.deepEqual(results,pair.results);
assert.equal(pair.request.cwd,prep.source);assert.equal(pair.request.session_id,prep.client_proposal.session_id);
const gitResult=pair.results[0].block;
assert(gitResult.is_error);assert.match(gitResult.content,/^Exit code 1\n/);assert(gitResult.content.includes('no changes added to commit'));
const old=read(here+'/readback.json'),logFile=old.sources.z01.file,logRaw=fs.readFileSync(logFile);
const allLines=logRaw.toString().split('\n').map((text,i)=>({line:i+1,text,at:text.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/)?.[0]??null}));
const windowLines=allLines.filter(l=>l.at&&l.at>=pair.request.at&&l.at<=pair.results[0].at);
const settings=read(prep.source+'/.claude/settings.json');
const hookCommands=settings.hooks.PreToolUse.filter(x=>x.matcher==='Bash').flatMap(x=>x.hooks).map(x=>x.command);
const finish=/\[DEBUG\] Hooks: (PreToolUse:Bash) \[(.*)\] finished with status (-?\d+) \((\d+)ms\)$/;
const completions=windowLines.flatMap(l=>{
 const m=finish.exec(l.text);if(!m)return [];
 const hook=m[2].match(/gate (hook-[a-z-]+)/)?.[1];if(!hook)return [];
 assert(hookCommands.includes(m[2]));
 return [{...l,hook,command:m[2],actual_exit_code:Number(m[3]),duration_ms:Number(m[4]),pid:null,tool_use_id_in_completion:null}];
});
assert.deepEqual(completions.map(x=>x.hook).sort(),['hook-pre-bash','hook-pre-commit']);assert(completions.every(x=>x.actual_exit_code===0));
const dispatch=windowLines.filter(l=>l.text.includes('toolUseId='+id));assert(dispatch.some(l=>l.text.includes('tool_dispatch_start')));assert(dispatch.some(l=>l.text.includes('tool_dispatch_end')));
const channels=allLines.filter(l=>/(?:Launching|Closing) Claude on channel:|Spawning Claude with SDK/.test(l.text));
assert(channels.at(-1).text.includes('resume: '+prep.client_proposal.session_id));
const callsDir=os.homedir()+'/.trivium/evidence/m11-step12-20261012/calls';
const receipts=fs.readdirSync(callsDir).filter(n=>n.endsWith('-completed.json')).flatMap(n=>{
 const file=callsDir+'/'+n,v=read(file);
 return v.at>=pair.request.at&&v.at<=pair.results[0].at&&['hook-pre-bash','hook-pre-commit'].includes(v.command?.at(-1))?[{file,sha256:hash(file),record:v}]:[];
});
assert.equal(receipts.length,2);
assert.deepEqual(receipts.map(x=>x.record.command.at(-1)).sort(),['hook-pre-bash','hook-pre-commit']);
for(const {record:r}of receipts){assert.equal(r.cwd,prep.source);assert.equal(r.code,0);assert.equal(r.signal,null);assert.equal(r.primary_loaded,true);assert.equal(r.before,401);assert.equal(r.after,401);assert.equal(r.stdout,'');assert.equal(r.stderr,'');}
function inventory(dir,rel=''){
 return fs.readdirSync(path.join(dir,rel)).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n,f=path.join(dir,p),s=fs.lstatSync(f);assert(!s.isSymbolicLink());
  return s.isDirectory()?inventory(dir,p):[{path:p,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
const current=inventory(prep.source);assert.deepEqual(current,before.files);
for(const name of ['archive-copy','backup'])assert.deepEqual(inventory(prep.root+'/'+name),prep.files);
assert.equal(hash(prep.client_index.path),after.client_index_sha256);
const budgetPlan=read(base+'/budget-plan.json'),budget=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(budgetPlan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
assert.deepEqual(budget,before.budget_before);
const zp=read(path.dirname(here)+'/preparation.json');assert.equal(hash(zp.installed),zp.installed_sha256);
const matrix=read(base+'/matrix.json');assert.equal(matrix.rows.length,68);assert.equal(new Set(matrix.rows.map(r=>r.criterion)).size,68);
const oldStatuses=matrix.rows.map(r=>[r.criterion,r.status]);
saveEvidence(here+'/matrix-before-s5-client.json',matrix);
saveEvidence(here+'/s5-client-assessment.json',{
 at:new Date().toISOString(),criterion:'5.1',inputs:['s5-client-before.json','s5-client-after.json','next-preparation.json'].map(file=>({file,sha256:hash(here+'/'+file)})),
 transcript:{path:after.transcript.path,sha256:sha(raw)},pair,tool_requests_in_checkpoint_window:requests,
 log:{path:logFile,sha256:sha(logRaw),bytes:logRaw.length,channels,completions,dispatch},runtime_receipts:receipts,
 correlation:'同一恢复会话、原cwd、检查点窗口唯一工具；Hook完成在request/result之间，之后有相同toolUseId的dispatch。Hook完成行不带PID/tool_use_id，不补造直接进程ID关联。',
 actual_hook_exit_codes:{'hook-pre-bash':0,'hook-pre-commit':0},git_exit_code:1,git_exit_reason:'无暂存变更；非Hook拒绝',
 original_full_inventory:current,all_141_original_files_unchanged:true,source_copy_backup_equal:true,
 original_git_index_unchanged:true,head_refs_objects_unchanged:true,real_commit_created:false,
 external_index:{path:prep.client_index.path,before:before.client_index_sha256,after:after.client_index_sha256,current:hash(prep.client_index.path),changed:before.client_index_sha256!==after.client_index_sha256},
 restoration:'无原工程变更，无恢复操作；临时索引保留',budget_before:before.budget_before,budget_after:budget,delta:{admission:0,review:0},
 pass:true,scope:'5.1完整真实归档的客户端提交前Hook放行通过；dry-run不证明Git原生pre-commit脚本或缺/改件分支；5.2～5.5客户端集成仍未测'
});
const row=matrix.rows.find(r=>r.criterion==='5.1'),prefix='zero-controls-20261015-01/hook-readback-01/';
row.evidence=[...new Set([...row.evidence,prefix+'s5-client-before.json',prefix+'s5-client-after.json',prefix+'s5-client-assessment.json'])];
row.status='完整真实归档的客户端提交前Hook放行通过（独立临时索引dry-run；无真实提交）';
row.observation='S5C01唯一Bash toolu_3fb0ff3d5be3421980559972：pre-bash/pre-commit实际均退出0，扩展完成记录及安装运行时回执一致，预算侧车已加载。Git退出1仅因无暂存变更；原工程141文件含.git和外部临时索引均未变，无恢复。预算838/401不变，5.2～5.5客户端格不因此通过。';
matrix.at=new Date().toISOString();
assert.deepEqual(matrix.rows.filter((r,i)=>r.status!==oldStatuses[i][1]).map(r=>r.criterion),['5.1']);
const header=fs.readFileSync(base+'/matrix.md','utf8').split(/\n(?=\| \d+ \|)/)[0],esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>');
const rows=matrix.rows.map(r=>'| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.length?r.evidence.join(', '):'尚无本轮满足判据的证据',r.status].map(esc).join(' | ')+' |');
fs.writeFileSync(base+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(base+'/matrix.md',header+'\n'+rows.join('\n')+'\n');
fs.appendFileSync(repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md',`\n## S5C01：完整归档的真实客户端提交前Hook放行\n\nBob完成前后检查点及原会话唯一Bash后，[独立核验](./evidence/m11-step12-20261012/${prefix}s5-client-assessment.json)确认2026-10-15 23:17:39（Asia/Singapore）的toolu_3fb0ff3d5be3421980559972按原参数执行独立临时索引git commit --dry-run。扩展日志第4005/4009行分别记录hook-pre-bash、hook-pre-commit实际退出0，两个安装运行时回执也均为code 0、stdout/stderr空、预算侧车加载成功；之后出现同toolUseId的Bash dispatch记录。Git实际退出1仅因无暂存变更，不是Hook拦截。\n\n检查点窗口只有这一次工具请求，关联基于同一恢复会话、原cwd及完成时间窗；Hook完成行的PID/直接tool_use_id仍null。原工程141个文件（含.git索引、HEAD、refs与objects）的集合/hash/权限/大小前后及当前均一致，完整副本与备份一致，外部临时索引本次也未变化；未创建真实提交、未恢复文件。预算保持838/401，增量0。矩阵5.1据实记客户端放行通过，5.2～5.5仍为CLI格有证据、客户端未测；本结果不证明Git原生pre-commit脚本或负对照分支。\n\n本次只归集已执行事件并同步报告/矩阵，不重跑检查点、Hook、旧脚本或厂商CLI，不自动提交推送。下一步先准备合法绑定自身cwd的独立客户端夹具与5.2～5.5的备份恢复方案，禁止在复制wrapper上绕过cwd限制；配置、初始化、新客户端及受保护工件操作均停在另行明确范围之前。M11尚未完成。\n`);
fs.appendFileSync(here+'/README.md','\n## S5C01执行后更新\n\nBob已于2026-10-15 23:17（Asia/Singapore）完成上面的唯一客户端步骤；before/after均ready。新增[s5-client-assessment.json](./s5-client-assessment.json)确认pre-bash/pre-commit实际均退出0，Git退出1仅因无暂存变更；原工程141文件与外部临时索引均未变化，预算838/401。5.1已通过，上面的操作步骤作为历史留痕保留，禁止重复运行。5.2～5.5客户端集成仍未测，下一停点是合法独立夹具及备份恢复方案，未执行新初始化、配置修改或客户端启动。\n');
console.log(JSON.stringify({criterion:'5.1',pass:true,hook_exit_codes:[0,0],git_exit:1,files_unchanged:141,budget}));
