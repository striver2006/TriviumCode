/** 只读回收已存在的客户端日志；不启动客户端/Hook，不改夹具，不覆盖旧证据。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {saveEvidence} from '../../../../../../scripts/agent-access-evidence.mjs';

const here=import.meta.dirname, zero=path.dirname(here), base=path.dirname(zero);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const hash=f=>sha(fs.readFileSync(f));
const prep=read(zero+'/preparation.json'),plan=read(base+'/budget-plan.json');
const budget=()=>Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const before=budget();
assert.deepEqual(before,{admission:838,review:401});
if(fs.existsSync(here+'/readback.json'))throw Error('本次证据已存在，禁止覆盖/重跑');
const session='52c58d79-eb90-4953-89dc-6ebd5923112e';
const transcript=os.homedir()+'/.claude/projects/-Users-chenzhenbo-Work-trivium-m11-step12-20261012/'+session+'.jsonl';
const raw=fs.readFileSync(transcript);
const events=raw.toString().split('\n').filter(Boolean).map((l,i)=>({line:i+1,event:JSON.parse(l)}));
const logs={h2:'20261009T142322/window12',z01:'20261015T143003/window3'};
const sources=Object.fromEntries(Object.entries(logs).map(([k,v])=>{
 const file=os.homedir()+'/Library/Application Support/Code/logs/'+v+'/exthost/Anthropic.claude-code/Claude VSCode.log';
 const bytes=fs.readFileSync(file);
 return [k,{file,sha256:sha(bytes),bytes:bytes.length,lines:bytes.toString().split('\n')}];
}));
const blocks=events.flatMap(({line,event:e})=>(Array.isArray(e.message?.content)?e.message.content:[])
 .filter(b=>['tool_use','tool_result'].includes(b.type)).map(block=>({line,at:e.timestamp,session_id:e.sessionId,cwd:e.cwd,version:e.version,entrypoint:e.entrypoint,block})));
function pair(id){
 const requests=blocks.filter(x=>x.block.type==='tool_use'&&x.block.id===id);
 const results=blocks.filter(x=>x.block.type==='tool_result'&&x.block.tool_use_id===id);
 assert.equal(requests.length,1);assert.equal(results.length,1);
 return {request:requests[0],result:results[0]};
}
const pairs={h2_edit:pair('toolu_5ed319fb857843e781838641'),h2_bash:pair('toolu_1c67de3552aa4f4c9e521d6d'),z01_bash:pair('toolu_7ea1cacd34e54a649b00cd9e')};
const hooks=read(prep.source+'/.claude/settings.json').hooks;
const commands=Object.fromEntries(Object.values(hooks).flatMap(rs=>rs.flatMap(r=>r.hooks)).map(h=>[h.command.match(/gate (hook-[a-z-]+)/)?.[1],h.command]));
// 必须匹配客户端结束记录的尾部，不能从命令正文的 exit 2 取退出码。
const finish=/\[DEBUG\] Hooks: ([^\[]+) \[(.*)\] finished with status (-?\d+) \((\d+)ms\)$/;
const time=l=>l.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/)?.[0]??null;
function windowRecord(key,from,to,expected,toolPair=null){
 const source=sources[key];
 const lines=source.lines.map((text,i)=>({line:i+1,text,at:time(text)})).filter(l=>l.at&&l.at>=from&&l.at<=to);
 const completions=lines.flatMap(l=>{
  const m=finish.exec(l.text);if(!m)return [];
  const hook=m[2].match(/gate (hook-[a-z-]+)/)?.[1];if(!hook)return [];
  assert.equal(m[2],commands[hook]);
  return [{...l,event:m[1],hook,command:m[2],actual_exit_code:Number(m[3]),duration_ms:Number(m[4]),pid:null,tool_use_id_in_log:null}];
 });
 assert.deepEqual(completions.map(x=>x.hook).sort(),[...expected].sort());
 assert(completions.every(x=>x.actual_exit_code===2));
 const errors=lines.filter(l=>l.text.includes('[ERROR]')&&l.text.includes('error: status code 2')&&l.text.includes('护栏失效'));
 assert.equal(errors.length,expected.length);
 assert(errors.every(l=>l.text.includes(prep.source+'/.trivium/bin/trivium')));
 const uses=blocks.filter(x=>x.block.type==='tool_use'&&x.at>=from&&x.at<=to);
 if(toolPair){
  assert.equal(uses.length,1);assert.equal(uses[0].block.id,toolPair.request.block.id);
  assert(completions.every(x=>x.at>=toolPair.request.at&&x.at<=toolPair.result.at));
  assert.equal(toolPair.request.session_id,session);assert.equal(toolPair.request.cwd,prep.source);
  assert.equal(toolPair.result.block.is_error,true);
 }
 return {source:key,from,to,completions,stderr_records:errors,tool_uses_in_window:uses,tool_pair:toolPair,
  correlation:toolPair?'同一扩展进程日志、同一项目/会话、唯一工具时间窗；完成时间夹在request/result之间。日志未带tool_use_id/PID，不声称直接ID关联。':'Stop使用会话system.stop_hook_summary与时间窗关联；不是Bash子工具。'};
}
const observations=[
 windowRecord('h2','2026-10-12T22:19:13.000Z','2026-10-12T22:19:15.000Z',['hook-pre-write'],pairs.h2_edit),
 windowRecord('h2','2026-10-12T22:19:19.000Z','2026-10-12T22:19:21.000Z',['hook-pre-bash','hook-pre-commit'],pairs.h2_bash),
 windowRecord('h2','2026-10-12T22:19:51.000Z','2026-10-12T22:19:52.000Z',['hook-stop']),
 windowRecord('z01','2026-10-15T14:28:05.000Z','2026-10-15T14:28:07.000Z',['hook-pre-bash','hook-pre-commit'],pairs.z01_bash),
 windowRecord('z01','2026-10-15T14:28:13.000Z','2026-10-15T14:28:14.000Z',['hook-stop']),
];
const stops=events.filter(({event:e})=>e.type==='system'&&e.subtype==='stop_hook_summary'&&
 observations.filter(x=>x.completions.some(c=>c.hook==='hook-stop')).some(w=>e.timestamp>=w.from&&e.timestamp<=w.to));
assert.equal(stops.length,2);
assert(stops.every(({event:e})=>e.sessionId===session&&e.cwd===prep.source&&e.hookErrors.some(x=>x.includes('护栏失效'))));
const processBindings=Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,s.lines.flatMap((text,i)=>
 text.includes('Spawning Claude')||text.includes(session)?[{line:i+1,text}]:[])]));
assert.equal(processBindings.h2.filter(l=>l.text.includes('Spawning Claude')).length,1);
assert(processBindings.z01.some(l=>l.text.includes('Spawning Claude')&&l.text.includes('resume: '+session)));
// 原日志不包含某个Hook的stdout记录时保持null，禁止把未记录解释为空输出。
function inventory(root,rel=''){
 return fs.readdirSync(path.join(root,rel)).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n;if(p==='.git')return [];
  const f=path.join(root,p),s=fs.lstatSync(f);assert(!s.isSymbolicLink());
  return s.isDirectory()?inventory(root,p):[{path:p,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
const expected=prep.files.filter(f=>!f.path.startsWith('.git/'));
const inventories=Object.fromEntries([['source',prep.source],['copy',prep.root+'/archive-copy'],['backup',prep.root+'/backup']].map(([k,root])=>[k,inventory(root)]));
for(const entries of Object.values(inventories))assert.deepEqual(entries,expected);
const after=budget();assert.deepEqual(after,before);
const h2prep=read(base+'/h2-preparation.json'),h2result=read(base+'/client-h2-results.json');
assert(h2result.restored); // 旧恢复证据保持不动，新鲜恢复另由全树清单校验。
const matrix=read(base+'/matrix.json');assert.equal(matrix.rows.length,68);assert.equal(new Set(matrix.rows.map(r=>r.criterion)).size,68);
saveEvidence(here+'/matrix-before.json',matrix);
saveEvidence(here+'/readback.json',{
 at:new Date().toISOString(),criterion:'6.7',scope:'已存在原始日志只读回收；无新触发、无配置差异、无厂商启动',
 sources:{transcript:{file:transcript,sha256:sha(raw),bytes:raw.length},...Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,{file:s.file,sha256:s.sha256,bytes:s.bytes}]))},
 processBindings,observations,stop_summaries:stops,
 result:{four_hooks_actual_exit_codes:{'hook-pre-write':2,'hook-pre-bash':2,'hook-pre-commit':2,'hook-stop':2},
  z01_tool_result_displays:'hook-pre-commit',z01_pre_bash:'已执行并退出2，错误未在该tool_result独立呈现',
  diagnosis:'原始扩展日志已保存逐Hook结果；先前仅查会话JSONL与具名debug路径，检索来源不完整。不是Hook未执行，也不是所有日志均未保存。',
  pid:null,stdout:null,explicit_tool_id_in_process_log:null,
  status:'6.7四个拦截Hook真实事件已齐备；保留时间窗关联边界，不重跑'},
 precondition:{h2_preparation:base+'/h2-preparation.json',h2_files:h2prep.files,z01_preparation:zero+'/preparation.json',fault_mode_measured_during_event:null,
  fault_evidence:'既有用户故障注入记录及每Hook的护栏失效stderr；不补造故障期间stat'},
 restoration:{all_non_git_files_equal:true,files_per_tree:expected.length,inventories,
 wrapper:expected.find(x=>x.path==='.trivium/bin/trivium'),settings:expected.find(x=>x.path==='.claude/settings.json')},
 budget_before:before,budget_after:after,delta:{admission:0,review:0},new_configuration_diff:[],
 previous_evidence_unchanged:['client-h2-results.json','zero-controls-20261015-01/client-assessment.json'],
 references:[{url:'https://code.claude.com/docs/en/hooks#debug-hooks',use:'说明v2.1.296完成日志格式；不是本轮执行证据'}]
});
console.log(JSON.stringify({evidence:here+'/readback.json',four_hooks:[2,2,2,2],budget:after,restoration:true}));
