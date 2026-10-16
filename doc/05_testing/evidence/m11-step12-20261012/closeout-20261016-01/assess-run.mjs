/** 通用只读核验：node assess-run.mjs <topic> <stage> <run_id> <输出文件名>。运行记录、阶段 Driver、归档 hash、台账、闸门。零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'..');
const F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const [T,S,RUN,OUT]=process.argv.slice(2);
if(!T||!S||!RUN||!OUT)throw Error('用法：<topic> <stage> <run_id> <输出文件名>');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const topicDir=path.join(F,'.reviews',T),stageDir=path.join(topicDir,S);
const meta=JSON.parse(fs.readFileSync(path.join(stageDir,'_'+'meta','run-'+RUN+'.json'),'utf8'));
const task=JSON.parse(fs.readFileSync(path.join(topicDir,'task'+'.json'),'utf8'));
const state=JSON.parse(fs.readFileSync(path.join(F,'.'+'trivium','state'+'.json'),'utf8'));
const plan=JSON.parse(fs.readFileSync(base+'/budget-plan.json','utf8'));
const count=p=>fs.readdirSync(path.join(plan.budgetRoot,'ledger',p)).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
const pick=(o,ks)=>Object.fromEntries(ks.filter(k=>o&&k in o).map(k=>[k,o[k]]));
const files=fs.readdirSync(stageDir).filter(n=>n.endsWith('.md')).sort().map(n=>({file:n,sha256:sha(path.join(stageDir,n))}));
const sideKeys=['status','failure_reason','verdict','model_effective','model_effective_source','provider','model_provider','profile_requested','effort_requested','effort_effective','effort_effective_source','evidence_ok','tool_calls','parse_fallback','parse_degraded','peer_artifact_read','peer_leak','peer_leak_via_command','peer_deny_applied','readonly_breach','void_reason','invalid_reason'];
const sides=Object.fromEntries(Object.entries(meta.critics??{}).map(([k,v])=>[k,pick(v,sideKeys)]));
const out={at:new Date().toISOString(),topic:T,stage:S,run_id:RUN,
 run:pick(meta,['status','review_mode','stage','driver','driver_enabled','driver_guard_level','driver_declaration','critics_selected','readonly_breach','family_comparisons','warnings','run_warnings','joint_check']),
 snapshot_drift:meta.snapshot?.drift??null,sides,
 task_driver:task.drivers?.[S]??null,task_runs:(task.runs??[]).filter(r=>r.stage===S).map(r=>pick(r,['run_id','stage','status','rerun_index'])),
 approvals_for_run:(task.approvals??[]).filter(a=>a.run_id===RUN).length,
 gate:state.gates?.[T+'/'+S]??null,archive_files:files,ledger_now:{admission:count('admission'),review:count('review')},
 meta_top_keys:Object.keys(meta),side_keys:Object.fromEntries(Object.entries(meta.critics??{}).map(([k,v])=>[k,Object.keys(v)]))};
saveEvidence(here+'/'+OUT,out);
console.log(JSON.stringify(out,null,1));
