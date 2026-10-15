/** 待客户端阶段使用。只读夹具、原始日志与回执，不启动任何Hook，不自动修改矩阵。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {here,read,hash,inventory,budget,verifyAnchors,authorization,fixture,phases,toolInput,saveEvidence} from './common.mjs';
const [phase,when]=process.argv.slice(2);assert.equal(process.argv.length,4);assert(Object.hasOwn(phases,phase));assert(['before','after'].includes(when));
authorization(here+'/client-authorization.json','s5-client');
const p=read(here+'/preparation.json'),name=phases[phase].fixture,cwd=fixture(p,name);
const binding=read(here+'/client-binding-'+name+'.json');
assert.equal(binding.cwd,cwd);assert(binding.session_id&&binding.transcript&&binding.extension_log);
const output=here+'/checkpoint-'+phase+'-'+when+'.json';assert(!fs.existsSync(output));
const before=when==='after'?read(here+'/checkpoint-'+phase+'-before.json'):null;
const expectedInput=toolInput(p,phase),files=inventory(cwd),currentBudget=budget();
// 失败后的after也保存现场，不因漂移而丢弃已发生的事件。
let anchorError=null;try{verifyAnchors(p);}catch(e){anchorError=e.message;}
const expected=phase==='missing'||phase==='changed'?read(here+'/operation-'+phase+'-after.json').files:read(here+'/setup-'+name+'-after.json').files;
const unchanged=JSON.stringify(files)===JSON.stringify(before?.files??expected);
const index=p.root+'/'+name+'.index',indexHash=fs.existsSync(index)?hash(index):null;
const sourceErrors=[];
const readSource=file=>{try{return fs.readFileSync(file,'utf8');}catch(e){sourceErrors.push({file,error:e.code??e.message});return null;}};
const raw=readSource(binding.transcript);
const events=(raw??'').split('\n').flatMap((s,i)=>{if(!s)return [];try{return [{line:i+1,event:JSON.parse(s)}];}catch{sourceErrors.push({file:binding.transcript,line:i+1,error:'JSON解析失败'});return [];}});
const blocks=events.flatMap(({line,event:e})=>(Array.isArray(e.message?.content)?e.message.content:[])
 .filter(b=>['tool_use','tool_result'].includes(b.type)).map(block=>({line,at:e.timestamp,cwd:e.cwd,session_id:e.sessionId,block})));
const requests=blocks.filter(x=>x.block.type==='tool_use'&&x.block.input?.description===expectedInput.description);
const pairs=requests.map(request=>({request,results:blocks.filter(x=>x.block.type==='tool_result'&&x.block.tool_use_id===request.block.id)}));
const logRaw=readSource(binding.extension_log);
const lines=(logRaw??'').split('\n').map((text,i)=>({line:i+1,text,at:text.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/)?.[0]??null}));
let matching=when==='before'?requests.length===0:false,completions=[],receipts=[],dispatch=[],actualGitExit=null;
let windowTools=[];
if(when==='after'&&pairs.length===1&&pairs[0].results.length===1) {
 const {request,results:[result]}=pairs[0];
 windowTools=blocks.filter(x=>x.block.type==='tool_use'&&x.at>=before.at);
 matching=request.at>=before.at&&request.session_id===binding.session_id&&request.cwd===cwd&&request.block.name==='Bash'&&
  JSON.stringify(request.block.input)===JSON.stringify(expectedInput)&&windowTools.length===1;
 const window=lines.filter(l=>l.at&&l.at>=request.at&&l.at<=result.at);
 const commands=p.hooks.PreToolUse.filter(e=>e.matcher==='Bash').flatMap(e=>e.hooks.map(h=>h.command));
 for(const l of window){
  const m=/\[DEBUG\] Hooks: PreToolUse:Bash \[(.*)\] finished with status (-?\d+) \((\d+)ms\)$/.exec(l.text);
  if(m&&commands.includes(m[1]))completions.push({...l,hook:m[1].match(/gate (hook-[a-z-]+)/)[1],actual_exit_code:Number(m[2]),pid:null,tool_use_id:null});
 }
 dispatch=window.filter(l=>l.text.includes('toolUseId='+request.block.id));
 const dir=p.root+'/calls';
 receipts=fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('-completed.json')).flatMap(n=>{
  const f=dir+'/'+n,r=read(f);return r.cwd===cwd&&r.at>=request.at&&r.finished<=result.at&&['hook-pre-bash','hook-pre-commit'].includes(r.command.at(-1))?[{path:f,sha256:hash(f),record:r}]:[];
 }):[];
 const content=result.block.content;
 if(typeof content==='string'){const m=/^Exit code (\d+)\n/.exec(content);if(m)actualGitExit=Number(m[1]);}
 // 工具错误中的Hook状态不能冒充Git退出码。仅真实dispatch后允许记录Git退出。
 if(!dispatch.some(l=>l.text.includes('tool_dispatch_start')))actualGitExit=null;
}
const hookNames=['hook-pre-bash','hook-pre-commit'];
const codes=Object.fromEntries(hookNames.map(h=>[h,completions.filter(c=>c.hook===h).length===1?completions.find(c=>c.hook===h).actual_exit_code:null]));
const receiptsOk=receipts.length===2&&hookNames.every(h=>{
 const matches=receipts.filter(x=>x.record.command.at(-1)===h);if(matches.length!==1)return false;
 const r=matches[0].record;
 return r.code===codes[h]&&r.primary_loaded===true&&r.hook_input?.session_id===binding.session_id&&
  (r.hook_input?.tool_use_id==null||r.hook_input.tool_use_id===pairs[0]?.request.block.id);
});
const expectedCodes=codes['hook-pre-bash']===0&&codes['hook-pre-commit']===phases[phase].exit;
const diagnosticText=receipts.map(x=>x.record.stderr).join('\n');
const operation=phase==='changed'?read(here+'/operation-changed-after.json'):null;
const reasonOk=phase==='missing'?diagnosticText.includes(p.targets.missing.slice('.reviews/'.length))&&diagnosticText.includes(p.run_id):
 phase==='changed'?diagnosticText.includes(operation.expected_original_sha256)&&diagnosticText.includes(operation.expected_changed_sha256):true;
const dispatchOk=phases[phase].exit===2?!dispatch.some(l=>l.text.includes('tool_dispatch_start')):dispatch.some(l=>l.text.includes('tool_dispatch_start'))&&dispatch.some(l=>l.text.includes('tool_dispatch_end'));
const ready=!anchorError&&sourceErrors.length===0&&unchanged&&matching&&(when==='before'||(receiptsOk&&expectedCodes&&reasonOk&&dispatchOk));
saveEvidence(output,{at:new Date().toISOString(),phase,when,cwd,binding,files,unchanged,anchor_error:anchorError,
 expected_input:expectedInput,index_sha256:indexHash,index_changed:before?before.index_sha256!==indexHash:null,
 budget_before:before?.budget_after??p.budget_after,budget_after:currentBudget,
 transcript:{path:binding.transcript,sha256:raw===null?null:hash(binding.transcript)},log:{path:binding.extension_log,sha256:logRaw===null?null:hash(binding.extension_log)},source_errors:sourceErrors,
 pairs,window_tools:windowTools,completions,dispatch,receipts,actual_hook_exit_codes:codes,actual_git_exit_code:actualGitExit,
 channel_events:lines.filter(l=>/(?:Launching|Closing) Claude on channel:|Spawning Claude with SDK/.test(l.text)),
 structurally_ready:ready,acceptance_pass:null,
 scope:'结构核对不是验收结论；仍需人工核对通道归属、直接tool_use_id或唯一时间窗、错误原因、采集层行为与原Hook等价。未知PID/退出码保留null'});
assert(ready,'证据已保存但结构条件不足；停止，不重试、不改矩阵。若存在故障状态，先由Bob恢复');
console.log(JSON.stringify({file:output,structurally_ready:ready,acceptance_pass:null}));
