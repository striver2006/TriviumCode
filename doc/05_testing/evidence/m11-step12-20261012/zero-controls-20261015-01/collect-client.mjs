/** 新批次真实客户端事件只读采集；无匹配时不制造通过，独立文件不覆盖。 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,prep=JSON.parse(fs.readFileSync(here+'/preparation.json'));
const source=os.homedir()+'/.claude/projects/-Users-chenzhenbo-Work-trivium-m11-step12-20261012/52c58d79-eb90-4953-89dc-6ebd5923112e.jsonl';
const raw=fs.readFileSync(source,'utf8');
const events=raw.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.timestamp>=prep.at);
const blocks=events.flatMap(e=>(Array.isArray(e.message?.content)?e.message.content:[]).filter(b=>['tool_use','tool_result'].includes(b.type)).map(b=>({...b,at:e.timestamp})));
const requests=blocks.filter(b=>b.type==='tool_use'&&b.name==='Bash'&&b.input.command==='git log --oneline -1'&&b.input.description==='M11-Z01-6.7 hook-pre-bash independent event');
const pairs=requests.map(request=>({request,results:blocks.filter(b=>b.type==='tool_result'&&b.tool_use_id===request.id)}));
const debug=os.homedir()+'/.claude/debug/52c58d79-eb90-4953-89dc-6ebd5923112e.txt';
// debug存在也只记录有无，不凭文本中出现Hook名把配置/命令回显认成已执行。
const matched=pairs.filter(p=>p.results.length===1&&p.results[0].is_error===true&&typeof p.results[0].content==='string'&&/PreToolUse:Bash hook error: \[.*gate hook-pre-bash.*\]: TriviumCode 护栏失效/s.test(p.results[0].content));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const restored=prep.files.filter(f=>!f.path.startsWith('.git/')).every(f=>fs.existsSync(prep.source+'/'+f.path)&&hash(prep.source+'/'+f.path)===f.sha256&&(fs.statSync(prep.source+'/'+f.path).mode&0o777)===f.mode);
const plan=JSON.parse(fs.readFileSync(here+'/../budget-plan.json'));
const budget=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const name='client-observation-'+crypto.randomUUID()+'.json';
saveEvidence(here+'/'+name,{at:new Date().toISOString(),criterion:'6.7',source,source_sha256:hash(source),since:prep.at,pairs,
 independent_pre_bash_error:matched.length===1,actual_exit_code:null,debug_source_exists:fs.existsSync(debug),restored,
 budget_before:prep.budget_before,budget_after:budget,
 status:matched.length===1?'发现具名真实Hook错误，退出码仍需原始事件佐证，待人工核对':'未取得独立hook-pre-bash真实事件；不得标通过',
 scope:'工具错误与实际Hook退出码分开；不从直调结果反推真实事件退出码；不启动客户端、不执行旧采集脚本'});
console.log(JSON.stringify({evidence:name,matches:matched.length,restored,budget}));
