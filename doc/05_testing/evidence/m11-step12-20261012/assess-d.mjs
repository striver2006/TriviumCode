/** D恢复批归集后的核对；不审批、不运行厂商、不修改测试项目。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname;
const read=n=>JSON.parse(fs.readFileSync(here+'/'+n));
const cfg=read('client-batch-d-recovery01.json'),prep=read('d-recovery01-preparation.json'),data=read('client-d-runs.json'),r=data.record,plan=read('budget-plan.json');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const gateCall=data.calls.find(c=>c.command[2]==='gate'&&c.command.includes('--check'));
const gate=JSON.parse(gateCall?.stdout??'{}');
const state=JSON.parse(data.gate_observation.stdout);
const disposition=gate.disposition;
const subjectUnchanged=hash(cfg.subject_path)===cfg.subject_sha256&&r.snapshot.subject_sha256===cfg.subject_sha256;
const files=[['src/stack.js',prep.source_sha256],['test/stack.test.js',prep.test_sha256]].map(([p,before])=>({file:cfg.fixture+'/'+p,before,current:hash(cfg.fixture+'/'+p)}));
const budget=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const delta=Object.fromEntries(['admission','review'].map(p=>[p,budget[p]-cfg.before[p]]));
const used=Object.fromEntries(['admission','review'].map(p=>[p,budget[p]-plan.baseline[p].used]));
const remaining=Object.fromEntries(['admission','review'].map(p=>[p,plan.absolute_step_caps[p]-budget[p]]));
const phaseArtifacts=r.artifacts.every(a=>a.path.startsWith('m11-s12-capacity/bug/'));
const atGate=state.topics.some(t=>t.topic===cfg.topics[0]&&t.open_gates.some(g=>g.stage==='bug'&&g.state==='awaiting_approval'));
if(r.run_id!=='20261015T123051Z'||r.status!=='success'||r.review_mode!=='full'||!atGate||gateCall?.code!==0||gate.ok!==true||gate.warnings.length||gate.failures.length||
 JSON.stringify(gate.structured_ids)!==JSON.stringify(['GLM-01','GLM-02','GLM-03','GLM-04'])||!subjectUnchanged||!phaseArtifacts||files.some(f=>f.before!==f.current)||delta.admission!==6||delta.review!==4)throw Error('D核对未满足，停止');
const criticSummary=Object.fromEntries(Object.entries(r.critics).map(([id,c])=>[id,{status:c.status,evidence_ok:c.evidence_ok,project_reads:c.tool_calls.project_reads,model_effective:c.model_effective,model_effective_source:c.model_effective_source,effort_requested:c.effort_requested,effort_effective:c.effort_effective,effort_effective_source:c.effort_effective_source}]));
const at=new Date().toISOString();
saveEvidence(here+'/d-assessment.json',{at,run_id:r.run_id,status:r.status,review_mode:r.review_mode,awaiting_approval:atGate,gate,disposition_sha256:hash(disposition),subject_unchanged:subjectUnchanged,files,phase_artifacts_only_bug:phaseArtifacts,
 critics:criticSummary,guard:r.guard,drift:r.snapshot.drift,budget:{before:cfg.before,after:budget,delta,step_used:used,total_used:used.admission+used.review,step_remaining:remaining,batch_caps_reached:true},
 corrections:['预检4次版本边界与2次探活均计admission；review为agy1次、zcode3次边界，不按2个审核者折为2次。','当前分池44/36，review本步28/36，未顶满；仅本批review4/4已满。'],process_samples:read('client-d-processes.json').observations.length,
 limits:'正式停点成立；D的客户端写前拦截、当次审批和放行复测尚未执行。根因裁决内审查侧无法读取外部原件的原因不因gate通过而自动证实。'});
const matrix=read('matrix.json');matrix.at=at;
const statuses={'3.1':'本轮B/C/D均实跑至awaiting_approval，未自动继续','3.2':'部分：B/C真实Edit拦截通过；D已到闸门，真实Edit负对照未测','3.3':'本轮B/C/D裁决均通过真实客户端落盘','3.4':'部分：B/C审批放行通过；D未审批、放行未测','3.5':'本轮D原稿、审查件及裁决均落bug/，未串入plan/'};
for(const row of matrix.rows){if(statuses[row.criterion]){row.status=statuses[row.criterion];row.evidence=[...new Set([...row.evidence,'client-d-runs.json','client-session-06.json','d-assessment.json'])];row.observation='D run 20261015T123051Z：success/full；gate通过、四意见齐备；awaiting_approval。D写前拦截与审批放行仍未测。';row.estimated_starts='D恢复批实耗admission6/review4；本步累计43/28=71/80，余1/8；本批已满，不自行续跑';}}
fs.writeFileSync(here+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>');
const header=fs.readFileSync(here+'/matrix.md','utf8').split(/\n(?=\| \d+ \|)/)[0];
fs.writeFileSync(here+'/matrix.md',header+'\n'+matrix.rows.map(r=>'| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.length?r.evidence.join(', '):'尚无本轮满足判据的证据',r.status].map(esc).join(' | ')+' |').join('\n')+'\n');
saveEvidence(here+'/d-gate-preparation.json',{at,run_id:r.run_id,topic:r.topic,stage:'bug',fixture:cfg.fixture,files,budget,disposition_sha256:hash(disposition),vendor_hard_limit:0,scope:'只准备真实客户端Edit写前拦截负对照；不审批、不修业务；意外成功立即停，不自行恢复'});
console.log(JSON.stringify({run_id:r.run_id,awaiting_approval:atGate,budget,delta,step_used:used,remaining,subjectUnchanged,source_unchanged:files.every(f=>f.before===f.current)}));
