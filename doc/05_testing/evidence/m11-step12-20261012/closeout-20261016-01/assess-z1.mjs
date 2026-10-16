/** Z1 只读核验：运行记录、阶段 Driver、审查件与裁决件 hash、台账增量、闸门状态。零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'..');
const F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012',T='m11-s12-cross',RUN=process.argv[2];
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const topicDir=path.join(F,'.reviews',T),planDir=path.join(topicDir,'plan');
const meta=JSON.parse(fs.readFileSync(path.join(planDir,'_'+'meta','run-'+RUN+'.json'),'utf8'));
const task=JSON.parse(fs.readFileSync(path.join(topicDir,'task'+'.json'),'utf8'));
const state=JSON.parse(fs.readFileSync(path.join(F,'.'+'trivium','state'+'.json'),'utf8'));
const plan=JSON.parse(fs.readFileSync(base+'/budget-plan.json','utf8'));
const count=p=>fs.readdirSync(path.join(plan.budgetRoot,'ledger',p)).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
const pick=(o,ks)=>Object.fromEntries(ks.filter(k=>k in o).map(k=>[k,o[k]]));
const files=fs.readdirSync(planDir).filter(n=>n.endsWith('.md')).sort().map(n=>({file:n,sha256:sha(path.join(planDir,n))}));
const sides=Object.fromEntries(Object.entries(meta.critics??{}).map(([k,v])=>[k,pick(v,['status','verdict','model_effective','model_effective_source','effort_requested','effort_effective','effort_effective_source','evidence_ok','project_reads','tool_calls','parse_fallback','peer_artifact_read','peer_deny_applied'])]));
const out={at:new Date().toISOString(),run_id:RUN,
 run:pick(meta,['status','review_mode','stage','driver','driver_enabled','driver_guard_level','driver_declaration','critics_selected','readonly_breach','family_comparisons','warnings']),
 snapshot_drift:meta.snapshot?.drift??null,sides,
 task_driver_plan:task.drivers?.plan??null,task_runs:(task.runs??[]).map(r=>pick(r,['run_id','stage','status','rerun_index'])),approvals_for_run:(task.approvals??[]).filter(a=>a.run_id===RUN).length,
 gates:state.gates??state,archive_files:files,ledger_now:{admission:count('admission'),review:count('review')}};
saveEvidence(here+'/'+(process.argv[3]??'z1-assessment.json'),out);
console.log(JSON.stringify(out,null,1).slice(0,6000));
