/** 补充核验真实run契约字段；初次静态件保留，缺字段不得判零违规。 */
import fs from 'node:fs';import path from 'node:path';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),runPath='.reviews/Agent双模式接入真实准入收口/plan/_meta/run-20261011T171203Z.json',run=JSON.parse(fs.readFileSync(runPath));
for(const key of ['readonly_breach','peer_artifact_read','forged_role_file'])if(run.guard[key]!==false)throw Error('原运行guard缺失或不通过:'+key);
for(const key of ['peer_leak_via_command','peer_leak_via_path'])for(const id of run.critics_selected)if(run.guard[key]?.[id]?.hit!==false)throw Error('原运行peer核验缺失或命中');
const plan='.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r26-codex.md',planHash=hash(plan);
if(planHash!=='af93c0bb996da1b2125e70f66784b1151dc6d09c87853d2c8a77c718672ea2f9')throw Error('24B已批准完整计划变化');
const task=JSON.parse(fs.readFileSync('.reviews/Agent双模式接入真实准入收口/task.json'));
if(!task.approvals.some(a=>a.run_id===run.run_id&&a.stage==='plan'&&a.decision==='approved'&&a.reason.includes(planHash)))throw Error('缺计划与审批hash绑定');
saveEvidence(root+'/static-audit-guard-contract-supplement.json',{at:new Date().toISOString(),script_sha256:hash(new URL(import.meta.url)),initial_audit_sha256:hash(root+'/static-audit-before25.json'),initial_audit_limitation:'初稿读取不存在的peer_read_detected字段，不能独立证明peer零违规；本补件按实际契约显式要求false，初件保留。',run_path:runPath,run_sha256:hash(runPath),actual_guard:run.guard,approved_plan_path:plan,approved_plan_sha256:planHash,approved_plan_hash_binding:true,new_vendor_starts:0});
console.log(JSON.stringify({actual_guard_verified:true,approved_plan_hash_binding:true,new_vendor_starts:0}));
