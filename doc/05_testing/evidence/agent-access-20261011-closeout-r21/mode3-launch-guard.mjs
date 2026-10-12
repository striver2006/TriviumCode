/** 26B/r30敏感取证启动合同；设计#agent-access-inline-mode3-contract。 */
export const PLAN26=Object.freeze({topic:'Agent双模式接入真实准入收口',run_id:'20261011T200004Z',sha256:'9c457711d4146644d9dedd976cbdf854128283df0802ddf32ba6f4bc0cf75d5c',basename:'2026-10-12-Agent双模式接入真实准入收口-r30-codex.md'});

export const APPROVAL_SCOPE_TOKENS=Object.freeze(['本轮敏感取证守卫范围已明确覆盖','CLI inline模式输入','原deny精确不变','mode3一次性启动绑定','1..32显式逐跳认证链','Schema/来源核验','restricted-tool-surface-and-path-v3','关闭消费者/独立批准边界','HTTP限额','全清理','生产枚举/N/manifest','review池348','首批预计4硬6止739池742','后批预计6硬9止748池至少748']);
const combinations=['qwen-pro','kimi-pro','kimi','deepseek','deepseek-pro'];
export function assertMode3Arguments(pool,mode,args){if(pool!=='admission'||mode!=='fixture'||!Array.isArray(args)||args.length!==2||!combinations.includes(args[0])||args[1]!=='3')throw Error('mode3-fixed-arguments-rejected');}
/** 事实由独立filesystem测量取得；缺项/未知严格拒绝，不启动任何CLI。 */
export function assertMode3Launch(c){
 assertMode3Arguments(c?.pool,c?.mode,c?.args);const b=c.batch,a=c.approval,r=c.run;
 const planReasonPath='.reviews/'+PLAN26.topic+'/plan/'+PLAN26.basename;
 if(!b||b.schema!=='controlled-mode3-batch.v1'||b.phase!=='pilot'||b.topic!==PLAN26.topic||b.plan_run_id!==PLAN26.run_id||b.plan_final_sha256!==PLAN26.sha256||c.final_sha256!==PLAN26.sha256||!b.plan_final_ref?.endsWith('/'+planReasonPath)||b.criterion_adoption_authorized!==false||b.diagnostic_only!==true)throw Error('mode3-plan-binding-rejected');
 if(c.gate?.run_id!==PLAN26.run_id||c.gate?.state!=='approved'||!a||a.stage!=='plan'||a.run_id!==PLAN26.run_id||a.decision!=='approved'||typeof a.reason!=='string'||![PLAN26.run_id,planReasonPath,PLAN26.sha256,...APPROVAL_SCOPE_TOKENS].every(s=>a.reason.includes(s)))throw Error('mode3-approval-scope-rejected');
 if(!r||r.run_id!==PLAN26.run_id||r.topic!==PLAN26.topic||r.stage!=='plan'||r.driver!=='codex'||r.status!=='success'||r.guard?.readonly_breach!==false||r.guard?.peer_artifact_read!==false||r.guard?.forged_role_file!==false||!Array.isArray(r.critics_selected)||JSON.stringify([...r.critics_selected].sort())!==JSON.stringify(['claude','gemini','glm'])||r.critics_selected.some(id=>r.critics?.[id]?.status!=='ok'||r.critics[id].evidence_ok!==true))throw Error('mode3-effective-review-rejected');
 const jobs=b.jobs,expectedJobs=[['qwen-pro','qwen3.8-max','qwen'],['kimi-pro','k3','kimi']];if(!Array.isArray(jobs)||JSON.stringify(jobs.map(j=>[j.combination,j.model,j.profile]))!==JSON.stringify(expectedJobs)||jobs.some(j=>j.variant!=='3'||j.route!=='claude'||j.expected_starts!==2||j.hard_starts!==3))throw Error('mode3-batch-jobs-rejected');
 const index=jobs.findIndex(j=>j.combination===c.args[0]);if(index<0)throw Error('mode3-out-of-batch-rejected');
 if(c.output_exists!==false||c.claim_exists!==false)throw Error('mode3-once-only-rejected');
 if(b.before!==733||b.expected_starts!==4||b.hard_limit!==6||b.cumulative_batch_stop!==739||b.pool_limit!==742||!Number.isSafeInteger(c.used)||c.used<b.before||c.completed!==c.used||c.used+jobs[index].hard_starts>b.cumulative_batch_stop||c.pool_limit!==b.pool_limit)throw Error('mode3-budget-rejected');
 if(c.source_hashes_verified!==true||c.build_inputs_verified!==true||c.live_source_verified!==true||c.historical_retention_verified!==true)throw Error('mode3-fingerprint-source-rejected');
 if(!Array.isArray(c.previous_proofs)||c.previous_proofs.length!==index||c.previous_proofs.some(p=>p.recomputed_pass!==true||p.inline_difference_verified!==true||p.actual_provider_inference!==false||p.real_model_attempt!==null))throw Error('mode3-previous-proof-rejected');
 return jobs[index];
}
