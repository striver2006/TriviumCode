/** 本批一次性检查；沿用户免审授权，不制造正式plan批准，不改变r21机制谓词。 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {loadCtx} from '../../../../dist/test/src/trivium/config.js';
import {listOpenGates} from '../../../../dist/test/src/trivium/state.js';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {resolveClaudeRoute} from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import {recomputeMode3Proof} from './mechanism-proof.mjs';
export const JOB_IDENTITIES=Object.freeze([['qwen-pro','qwen3.8-max','qwen'],['kimi-pro','k3','kimi'],['kimi','kimi-for-coding','kimi'],['deepseek','deepseek-flash','deepseek'],['deepseek-pro','deepseek-v4-pro','deepseek']]);
const root=path.dirname(fileURLToPath(import.meta.url));
export const schemaFile=path.resolve(root,'../agent-access-20261011-closeout-r21/controlled-mechanism-mode3.v1.schema.json');
const read=p=>{const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())throw Error('来源不是普通文件');return JSON.parse(fs.readFileSync(p,'utf8'));};
export function assertMode3Arguments(pool,mode,args){if(pool!=='admission'||mode!=='fixture'||!Array.isArray(args)||args.length!==2||!JOB_IDENTITIES.some(j=>j[0]===args[0])||args[1]!=='3')throw Error('固定实参不符');}
export function assertMeasuredBatch(c){
 const b=c.batch;if(!b||b.schema!=='convergence-mechanism-batch.v1'||b.criteria_adopted!==false||b.formal_plan_run_id!==null||b.review_waived!==true||JSON.stringify(b.jobs.map(j=>[j.combination,j.model,j.profile]))!==JSON.stringify(JOB_IDENTITIES)||b.jobs.some(j=>j.variant!=='3'||j.expected_starts!==2||j.hard_starts!==3))throw Error('批次身份不符');
 if(b.before!==790||b.expected_starts!==10||b.hard_starts!==15||b.batch_stop!==805||b.pool_limit!==815)throw Error('公布预算不符');
 if(!Number.isSafeInteger(c.used)||c.used<b.before||c.used!==c.completed||c.used+3>b.batch_stop||c.pool_limit!==b.pool_limit)throw Error('台账或限额不符');
 if(c.output_exists!==false||c.claim_exists!==false||c.batch_finished!==false)throw Error('禁止重复或恢复停止批次');
 if(c.frozen!==true||c.source_usable!==true||c.no_open_gate!==true||c.authorization_valid!==true)throw Error('来源或用户授权未证实');
 if(!Number.isSafeInteger(c.index)||c.index<0||c.index>=5||c.previous_proofs.length!==c.index||c.previous_proofs.some((p,i)=>p.combination!==b.jobs[i].combination||p.recomputed_pass!==true||p.inline_difference_verified!==true||p.actual_provider_inference!==false||p.real_model_attempt!==null))throw Error('前序完整复算未通过');
 return b.jobs[c.index];
}
export async function measureMode3Launch(repo,pool,mode,args){
 assertMode3Arguments(pool,mode,args);const batchFile=root+'/mechanism-batch.json',batch=read(batchFile),authorization=read(root+'/mechanism-authorization.json');
 const index=batch.jobs.findIndex(j=>j.combination===args[0]),job=batch.jobs[index];if(!job)throw Error('批次外组合');
 const authorizationValid=authorization.user_instruction==='提交，推送，然后继续完成剩下的问题'&&authorization.review_waiver===true&&authorization.criteria_adoption_authorized===false&&authorization.formal_approval_record===null&&hash(root+'/mechanism-authorization.json')===batch.authorization_sha256;
 const required=['controlled-fixture.mjs','mechanism-proof.mjs','mechanism-launch-check.mjs','launch-mechanism.mjs','execute-mechanism.mjs','mechanism-authorization.json'].map(n=>root+'/'+n);
 required.push(schemaFile,job.live_result_ref.path,job.live_shape_ref.path);
 if(required.some(f=>!Object.hasOwn(batch.files,f)))throw Error('来源覆盖不全');
 const {hashFile,openBudget}=createRequire(import.meta.url)(repo+'/scripts/agent-access-budget.cjs');
 const filesValid=Object.entries(batch.files).every(([f,h])=>hashFile(f)===h);
 const stamp=await computeBuildStamp(repo),ctx=await loadCtx({cwd:repo}),route=resolveClaudeRoute(ctx.config,job.profile,job.live_cli_version),live=read(job.live_result_ref.path);
 const sourceUsable=hash(job.live_result_ref.path)===job.live_result_ref.sha256&&hash(job.live_shape_ref.path)===job.live_shape_ref.sha256&&live.completed&&live.actual_read&&live.strict_first_word&&live.structured.ok&&live.trace.init?.permissionMode==='default'&&live.trace.init.model===job.model&&live.request.model===job.model&&route.configurationSha256===live.request.fingerprints.profile_config&&hashFile(route.bin)===live.request.fingerprints.entry&&hashFile(route.nativeBin)===live.request.fingerprints.native_entry;
 const budget=openBudget(batch.budget_root,pool),names=fs.readdirSync(budget.dir),previous=[];
 for(const j of batch.jobs.slice(0,index))previous.push(await recomputeMode3Proof(j,schemaFile));
 const facts={batch,index,authorization_valid:authorizationValid,frozen:filesValid&&stamp.dirty===false&&stamp.git_head===batch.git_head&&stamp.inputs_sha256===batch.inputs_sha256,source_usable:sourceUsable,no_open_gate:!(await listOpenGates(ctx.triviumDir)).some(g=>g.topic==='Agent双模式接入真实准入收口'),output_exists:fs.existsSync(job.output),claim_exists:fs.existsSync(job.claim),batch_finished:fs.existsSync(root+'/batch-c-result.json'),used:names.filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed:names.filter(n=>/^launch-\d+\.json$/.test(n)).length,pool_limit:budget.limit(),previous_proofs:previous};
 assertMeasuredBatch(facts);return{facts,job,batch_ref:{path:batchFile,sha256:hash(batchFile)}};
}
