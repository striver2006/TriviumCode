/** 待用户客户端操作前后使用，只读原工程/日志，独占落新证据，不执行工具或恢复。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {saveEvidence} from '../../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'../..');
const phase=process.argv[2];assert(['before','after'].includes(phase));assert.equal(process.argv.length,3);
const file=here+'/s5-client-'+phase+'.json';assert(!fs.existsSync(file),'不覆盖、不重跑');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const prep=read(here+'/next-preparation.json'),plan=read(base+'/budget-plan.json');
function inventory(dir,rel=''){
 return fs.readdirSync(path.join(dir,rel)).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n,f=path.join(dir,p),s=fs.lstatSync(f);assert(!s.isSymbolicLink());
  return s.isDirectory()?inventory(dir,p):[{path:p,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
const files=inventory(prep.source),budget=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const before=phase==='after'?read(here+'/s5-client-before.json'):null;
const expected=before?.files??prep.files;
const changed=files.filter(x=>JSON.stringify(x)!==JSON.stringify(expected.find(y=>y.path===x.path))).map(x=>x.path);
const missing=expected.filter(x=>!files.some(y=>y.path===x.path)).map(x=>x.path);
const source=os.homedir()+'/.claude/projects/-Users-chenzhenbo-Work-trivium-m11-step12-20261012/'+prep.client_proposal.session_id+'.jsonl';
const raw=fs.readFileSync(source,'utf8');
const events=raw.split('\n').filter(Boolean).map((s,i)=>({line:i+1,e:JSON.parse(s)}));
const blocks=events.flatMap(({line,e})=>(Array.isArray(e.message?.content)?e.message.content:[]).filter(b=>['tool_use','tool_result'].includes(b.type)).map(b=>({line,at:e.timestamp,cwd:e.cwd,session_id:e.sessionId,block:b})));
const requests=blocks.filter(b=>b.block.type==='tool_use'&&b.block.name==='Bash'&&b.block.input?.description===prep.client_proposal.input.description);
const pairs=requests.map(request=>({request,results:blocks.filter(b=>b.block.type==='tool_result'&&b.block.tool_use_id===request.block.id)}));
const matching=phase==='before'?requests.length===0:pairs.length===1&&pairs[0].results.length===1&&pairs[0].request.at>=before.at&&JSON.stringify(pairs[0].request.block.input)===JSON.stringify(prep.client_proposal.input)&&pairs[0].request.cwd===prep.source&&pairs[0].request.session_id===prep.client_proposal.session_id;
const unchanged=changed.length===0&&missing.length===0;
const sameBudget=JSON.stringify(budget)===JSON.stringify(prep.budget_after);
const index=hash(prep.client_index.path);
const indexReady=phase==='after'||index===prep.client_index.sha256;
saveEvidence(file,{at:new Date().toISOString(),phase,files,changed,missing,unchanged,budget_before:before?.budget_after??prep.budget_after,budget_after:budget,
 same_budget:sameBudget,client_index_sha256:index,index_ready:indexReady,transcript:{path:source,sha256:hash(source)},pairs,matching,
 actual_hook_exit_code:null,scope:'检查点只记录tool_use/result；逐Hook实际退出码必须从扩展完成日志另行关联，不从Git退出码推断',
 ready:unchanged&&sameBudget&&matching&&indexReady});
if(!unchanged||!sameBudget||!matching||!indexReady)throw Error('检查点未满足：证据已保留，停止，不自动恢复或重试');
console.log(JSON.stringify({file,ready:true,hook_exit:null}));
