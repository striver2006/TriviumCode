/** D真实审批、同参Edit放行与原字节恢复核对；零厂商调用，不写验收项目。 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,read=n=>JSON.parse(fs.readFileSync(here+'/'+n));
const a=read('approval-d.json'),n=read('client-d-gate-results.json'),plan=read('budget-plan.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=os.homedir()+'/.claude/projects/-Users-chenzhenbo-Work-trivium-m11-step12-20261012/52c58d79-eb90-4953-89dc-6ebd5923112e.jsonl';
const raw=fs.readFileSync(source,'utf8');
const blocks=raw.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(e=>e.timestamp>=a.at).flatMap(e=>(Array.isArray(e.message?.content)?e.message.content:[]).filter(c=>['tool_use','tool_result'].includes(c.type)).map(c=>({...c,at:e.timestamp})));
const pairs=blocks.filter(c=>c.type==='tool_use').map(request=>({request,result:blocks.find(r=>r.type==='tool_result'&&r.tool_use_id===request.id)??null}));
const text=r=>typeof r?.content==='string'?r.content:(r?.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const canonical=v=>JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))));
const negative=n.pairs.find(p=>p.request.name==='Edit');
const edits=pairs.filter(p=>p.request.name==='Edit'&&canonical(p.request.input)===canonical(negative.request.input));
const restores=pairs.filter(p=>p.request.name==='Edit'&&p.request.input.file_path===negative.request.input.file_path&&p.request.input.old_string?.includes('// M11 D gate sentinel\n')&&p.request.input.old_string.replace('// M11 D gate sentinel\n','')===p.request.input.new_string);
if(edits.length!==1||!edits[0].result||edits[0].result.is_error||restores.length!==1||!restores[0].result||restores[0].result.is_error||restores[0].request.at<=edits[0].result.at)throw Error('放行/恢复唯一工具对及顺序未齐备');
const sourceEdits=pairs.filter(p=>p.request.name==='Edit'&&p.request.input.file_path===negative.request.input.file_path);
if(sourceEdits.length!==2)throw Error('出现额外源码Edit，需另核对');
const status=pairs.find(p=>p.request.input?.command==='.trivium/bin/trivium status --topic m11-s12-capacity --json'&&p.request.at<edits[0].request.at);
const state=JSON.parse(text(status?.result)||'{}');
if(!state.topics?.some(t=>t.topic===a.topic&&t.open_gates.length===0&&t.approvals===3))throw Error('缺真实闸门关闭记录');
const task=JSON.parse(fs.readFileSync(a.fixture+'/.reviews/'+a.topic+'/task.json'));
const approvals=task.approvals.filter(p=>p.run_id===a.run_id);
const reason=a.command_args[a.command_args.indexOf('--reason')+1];
if(approvals.length!==1||approvals[0].decision!=='approved'||approvals[0].stage!=='bug'||approvals[0].reason!==reason||task.gate?.run_id!==a.run_id||task.gate?.state!=='approved')throw Error('审批run、stage或边界附言不匹配');
if(hash(fs.readFileSync(a.response_file))!==a.response_sha256)throw Error('裁决件hash变化');
const files=n.files.map(f=>({...f,current:hash(fs.readFileSync(f.file))}));
if(files.some(f=>f.before!==f.current))throw Error('源码/测试未恢复原字节');
const budget=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(f=>/^reserved-\d+\.json$/.test(f)).length]));
if(Object.keys(budget).some(p=>budget[p]!==a.budget_before[p]))throw Error('零厂商预算出现增量');
const dir=os.homedir()+'/.trivium/evidence/m11-step12-20261012/calls';
const calls=fs.readdirSync(dir).filter(f=>f.endsWith('-completed.json')).map(f=>JSON.parse(fs.readFileSync(dir+'/'+f))).filter(c=>c.at>=a.at);
const approve=calls.filter(c=>JSON.stringify(c.command.slice(2))===JSON.stringify(a.command_args));
if(approve.length!==1||approve[0].code!==0||approve[0].approval_authorization?.run_id!==a.run_id||approve[0].approval_authorization?.sha256!==hash(fs.readFileSync(here+'/approval-d.json'))||approve[0].at>=status.request.at)throw Error('真实审批外壳回执或执行顺序不匹配');
const at=new Date().toISOString();
saveEvidence(here+'/client-d-unlock-results.json',{at,source,source_sha256:hash(raw),decision:a,task,pairs,calls,files,budget,batch_delta:{admission:0,review:0},response_sha256:a.response_sha256,passed:true,matched:{negative:negative.request.id,positive:edits[0].request.id,restore:restores[0].request.id},scope:'D真实审批与同参Edit放行/原字节恢复通过；保留树外证据访问原因未证实的边界，不实施容量修复、不代表M11全部完成'});
const matrix=read('matrix.json');matrix.at=at;
for(const row of matrix.rows.filter(r=>r.scenario===3)){
 row.observation='D run 20261015T123051Z：审查/裁决/停点、写前拦截、当次审批及同参Edit放行恢复均有真实证据；源码/测试和裁决hash未变，审批复测零厂商增量。';
 if(row.criterion==='3.4'){row.status='本轮B/C/D真实审批后同参数Edit均放行，恢复原字节核对通过';row.evidence=[...new Set([...row.evidence,'client-d-unlock-results.json'])];}
}
fs.writeFileSync(here+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>');
const header=fs.readFileSync(here+'/matrix.md','utf8').split(/\n(?=\| \d+ \|)/)[0];
fs.writeFileSync(here+'/matrix.md',header+'\n'+matrix.rows.map(r=>'| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.length?r.evidence.join(', '):'尚无本轮满足判据的证据',r.status].map(esc).join(' | ')+' |').join('\n')+'\n');
console.log(JSON.stringify({passed:true,run_id:a.run_id,budget,files_unchanged:true,disposition_unchanged:true,matched:{negative:negative.request.id,positive:edits[0].request.id,restore:restores[0].request.id}}));
