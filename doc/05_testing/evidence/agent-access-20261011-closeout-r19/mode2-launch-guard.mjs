/** 25B/r28敏感取证启动合同；设计#agent-access-evidence-guard-contract。 */
export const PLAN25=Object.freeze({topic:'Agent双模式接入真实准入收口',run_id:'20261011T184407Z',sha256:'f6b92255f1182e63905ed837ddf9fb1262eb84bdd38b13e80e17292a4687a406',basename:'2026-10-12-Agent双模式接入真实准入收口-r28-codex.md'});
const combinations=['qwen-pro','kimi-pro','kimi','deepseek','deepseek-pro'];
export function assertMode2Arguments(pool,mode,args){if(pool!=='admission'||mode!=='fixture'||!Array.isArray(args)||args.length!==2||!combinations.includes(args[0])||args[1]!=='2')throw Error('mode2-fixed-arguments-rejected');}
/** 事实由独立filesystem测量取得；缺项/未知严格拒绝，不启动任何CLI。 */
export function assertMode2Launch(c){
 assertMode2Arguments(c?.pool,c?.mode,c?.args);const b=c.batch,a=c.approval,r=c.run;
 const planReasonPath='.reviews/'+PLAN25.topic+'/plan/'+PLAN25.basename;
 if(!b||b.schema!=='controlled-mode2-batch.v1'||b.phase!=='pilot'||b.topic!==PLAN25.topic||b.plan_run_id!==PLAN25.run_id||b.plan_final_sha256!==PLAN25.sha256||c.final_sha256!==PLAN25.sha256||!b.plan_final_ref?.endsWith('/'+planReasonPath)||b.criterion_adoption_authorized!==false||b.diagnostic_only!==true)throw Error('mode2-plan-binding-rejected');
 if(c.gate?.run_id!==PLAN25.run_id||c.gate?.state!=='approved'||!a||a.stage!=='plan'||a.run_id!==PLAN25.run_id||a.decision!=='approved'||typeof a.reason!=='string'||![PLAN25.run_id,planReasonPath,PLAN25.sha256,'本轮敏感取证守卫范围已明确覆盖','临时单键模式','HTTP限额','全清理','mode2','生产枚举/N/manifest'].every(s=>a.reason.includes(s)))throw Error('mode2-approval-scope-rejected');
 if(!r||r.run_id!==PLAN25.run_id||r.topic!==PLAN25.topic||r.stage!=='plan'||r.driver!=='codex'||r.status!=='success'||r.guard?.readonly_breach!==false||r.guard?.peer_artifact_read!==false||r.guard?.forged_role_file!==false||!Array.isArray(r.critics_selected)||JSON.stringify([...r.critics_selected].sort())!==JSON.stringify(['claude','gemini','glm'])||r.critics_selected.some(id=>r.critics?.[id]?.status!=='ok'||r.critics[id].evidence_ok!==true))throw Error('mode2-effective-review-rejected');
 const jobs=b.jobs;if(!Array.isArray(jobs)||JSON.stringify(jobs.map(j=>j.combination))!==JSON.stringify(['qwen-pro','kimi-pro'])||jobs.some(j=>j.variant!=='2'||j.route!=='claude'||typeof j.model!=='string'||!j.model||typeof j.profile!=='string'||!j.profile||j.hard_starts!==3))throw Error('mode2-batch-jobs-rejected');
 const index=jobs.findIndex(j=>j.combination===c.args[0]);if(index<0)throw Error('mode2-out-of-batch-rejected');
 if(c.output_exists!==false||c.claim_exists!==false)throw Error('mode2-once-only-rejected');
 if(b.before!==732||b.expected_starts!==4||b.hard_limit!==6||b.cumulative_batch_stop!==738||b.pool_limit!==742||!Number.isSafeInteger(c.used)||c.used<b.before||c.completed!==c.used||c.used+jobs[index].hard_starts>b.cumulative_batch_stop||c.pool_limit!==b.pool_limit)throw Error('mode2-budget-rejected');
 if(c.source_hashes_verified!==true||c.build_inputs_verified!==true||c.live_source_verified!==true||c.historical_retention_verified!==true)throw Error('mode2-fingerprint-source-rejected');
 if(!Array.isArray(c.previous_proofs)||c.previous_proofs.length!==index||c.previous_proofs.some(p=>p.recomputed_pass!==true||p.actual_provider_inference!==false||p.real_model_attempt!==null))throw Error('mode2-previous-proof-rejected');
 return jobs[index];
}
