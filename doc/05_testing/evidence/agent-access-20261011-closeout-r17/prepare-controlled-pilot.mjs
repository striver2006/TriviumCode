/** 24B获批的两组合机制批次；只做零CLI静态检查并追加事前清单。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {run} from '../../../../dist/test/src/trivium/util/exec.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname);
const external=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3');
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const count=pool=>{const b=openBudget(external+'/budget',pool);return{used:fs.readdirSync(b.dir).filter(n=>/^reserved-\d+\.json$/.test(n)).length,limit:b.limit()};};
const before={admission:count('admission'),review:count('review')};
if(before.admission.used!==731||before.admission.limit!==742||before.review.used!==313||before.review.limit!==318)throw Error('事前预算采样变化，拒绝沿用旧批次');
const topic='Agent双模式接入真实准入收口',task=JSON.parse(fs.readFileSync(path.join(repo,'.reviews',topic,'task.json')));
const plan=path.join(repo,'.reviews',topic,'plan/2026-10-12-'+topic+'-r26-codex.md');
const planHash='af93c0bb996da1b2125e70f66784b1151dc6d09c87853d2c8a77c718672ea2f9';
if(digest(plan)!==planHash||!task.approvals.some(a=>a.run_id==='20261011T171203Z'&&a.stage==='plan'&&a.decision==='approved'&&a.reason.includes(planHash)))throw Error('24B原件或本轮普通计划审批缺失');
const launcher=root+'/launch-controlled-v1.mjs';
const negative=[];
for(const [label,args] of [
 ['pool',['review','fixture','qwen-pro','1']],
 ['unknown-combination',['admission','fixture','unregistered','1']],
 ['repeat-variant',['admission','fixture','qwen-pro','2']],
 ['extra-argument',['admission','fixture','qwen-pro','1','extra']],
]){
 const r=await run(process.execPath,[launcher,args[0],'r35-negative-'+label,...args.slice(1)],{cwd:repo,timeoutMs:15000,killTree:true});
 negative.push({label,exit_code:r.code,signal:r.signal??null,timed_out:r.timedOut??false,expected_rejection:r.code!==0&&r.stderr.includes('受控固定目标参数拒绝')});
 if(!negative.at(-1).expected_rejection)throw Error('固定启动面负例没有在预期点拒绝');
}
const after={admission:count('admission'),review:count('review')};
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('零CLI启动面检查误占供应商启动');
saveEvidence(root+'/controlled-launcher-negative-checks.json',{schema:'zero-cli-launcher-checks.v1',script_sha256:digest(new URL(import.meta.url)),launcher_sha256:digest(launcher),negative,before,after,new_vendor_starts:0});
const jobs=[
 {combination:'qwen-pro',variant:'1',actual_model_from_live_readback:'qwen3.8-max',profile:'qwen',live_path:'claude-final-positive-after23/routes/claude-qwen-pro-read-3'},
 {combination:'kimi-pro',variant:'1',actual_model_from_live_readback:'k3',profile:'kimi',live_path:'claude-partial-after23/routes/claude-kimi-pro-read-3'},
].map(j=>{
 const p=repo+'/doc/05_testing/evidence/agent-access-20261011-closeout-r15/'+j.live_path;
 const r=JSON.parse(fs.readFileSync(p+'/result.json'));
 if(r.trace.init.model!==j.actual_model_from_live_readback||r.trace.init.permissionMode!=='default')throw Error('正向实测模型/模式不符');
 if(fs.existsSync(external+'/controlled-after24/'+j.combination+'-mechanism-1'))throw Error('首批已执行，不重复');
 return{...j,route:'claude',live_result_ref:{path:p+'/result.json',sha256:digest(p+'/result.json')},live_shape_ref:{path:p+'/production-shape.json',sha256:digest(p+'/production-shape.json')},live_cli_version:r.request.cli_version_observed,live_fingerprints:r.request.fingerprints,controlled_actual_provider_inference:false,controlled_model_actual_attempt:null,original_negative_gap:'真实模型禁读实际调用及生产写实际调用证据不足',necessary_new_starts:{expected:2,hard_limit:3},output:external+'/controlled-after24/'+j.combination+'-mechanism-1'};
});
const batch={schema:'controlled-pilot-batch.v1',topic,plan_run_id:'20261011T171203Z',plan_final_ref:plan,plan_final_sha256:planHash,criterion_candidate:'restricted-tool-surface-and-path-v2',criterion_adoption_authorized:false,diagnostic_only:true,jobs,before:before.admission.used,expected_starts:4,hard_limit:6,cumulative_batch_stop:737,pool_limit:742,review_before:before.review.used,review_pool_limit:318,fixture_sha256:digest(root+'/controlled-fixture.mjs'),guard_sha256:digest(root+'/controlled-mechanism.mjs'),launcher_sha256:digest(launcher),schema_sha256:digest(root+'/controlled-mechanism.v1.schema.json'),budget_preload_sha256:digest(repo+'/scripts/agent-access-budget-preload.cjs'),budget_core_sha256:digest(repo+'/scripts/agent-access-budget.cjs'),build_stamp:await computeBuildStamp(repo),bundle_sha256:digest(repo+'/skills/dual-critic/scripts/trivium.cjs'),installed_bundle_sha256:digest(path.join(process.env.HOME,'.claude/skills/dual-critic/scripts/trivium.cjs')),shared_config_sha256:digest(repo+'/.trivium/config.yaml'),local_config_sha256:digest(repo+'/.trivium/config.local.yaml'),checks_ref:{path:root+'/controlled-before-launch-checks.json',sha256:digest(root+'/controlled-before-launch-checks.json')},launcher_negative_ref:{path:root+'/controlled-launcher-negative-checks.json',sha256:digest(root+'/controlled-launcher-negative-checks.json')},script_sha256:digest(new URL(import.meta.url)),published_at:new Date().toISOString(),stop_conditions:['任一默认权限、工具面、wrapper/native消费、精确配对、文件状态、清理或内部错误未知/失败即停','不调提示、不改错误白名单、不重试；保留全部原件','每组合仅variant1；原真实模型准入列不变']};
saveEvidence(root+'/controlled-pilot-batch.json',batch);
console.log(JSON.stringify({jobs:jobs.map(j=>({combination:j.combination,live_model:j.actual_model_from_live_readback})),before,expected_starts:4,hard_limit:6,cumulative_batch_stop:737,negative:negative.map(n=>({label:n.label,rejected:n.expected_rejection})),new_vendor_starts:0}));
