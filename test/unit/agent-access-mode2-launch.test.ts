/** 25B批准的敏感固定启动守卫；纯样本与实际Node拒绝均不启动供应商。 */
import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';import {run} from '../../src/trivium/util/exec.js';

// WIN_FILE_SKIP（Windows 移植）：断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物');
} else {
async function guard(){return import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r19/mode2-launch-guard.mjs')).href);}
async function sample(){
 const {PLAN25}=await guard(),final=path.resolve('.reviews',PLAN25.topic,'plan',PLAN25.basename),job=(combination:string,model:string,profile:string)=>({combination,model,profile,variant:'2',route:'claude',hard_starts:3});
 const batch={schema:'controlled-mode2-batch.v1',phase:'pilot',topic:PLAN25.topic,plan_run_id:PLAN25.run_id,plan_final_sha256:PLAN25.sha256,plan_final_ref:final,criterion_adoption_authorized:false,diagnostic_only:true,jobs:[job('qwen-pro','qwen3.8-max','qwen'),job('kimi-pro','k3','kimi')],before:732,expected_starts:4,hard_limit:6,cumulative_batch_stop:738,pool_limit:742};
 const approval={stage:'plan',run_id:PLAN25.run_id,decision:'approved',reason:[PLAN25.run_id,final,PLAN25.sha256,'本轮敏感取证守卫范围已明确覆盖','临时单键模式','HTTP限额','全清理','mode2','生产枚举/N/manifest','模拟测试不是实际批准'].join(' ')};
 const c:Record<string,any>={pool:'admission',mode:'fixture',args:['qwen-pro','2'],batch,approval,gate:{run_id:PLAN25.run_id,state:'approved'},run:{run_id:PLAN25.run_id,topic:PLAN25.topic,stage:'plan',driver:'codex',status:'success',guard:{readonly_breach:false,peer_artifact_read:false,forged_role_file:false},critics_selected:['claude','gemini','glm'],critics:Object.fromEntries(['claude','gemini','glm'].map(id=>[id,{status:'ok',evidence_ok:true}]))},final_sha256:PLAN25.sha256,output_exists:false,claim_exists:false,used:732,completed:732,pool_limit:742,source_hashes_verified:true,build_inputs_verified:true,live_source_verified:true,historical_retention_verified:true,previous_proofs:[]};return c;
}
test('模式2纯启动合同绑定当前有效计划批准与限定批次；第二组合必须先复算首样本',async()=>{
 const {assertMode2Launch}=await guard(),c=await sample();assert.equal(assertMode2Launch(c).model,'qwen3.8-max');c.args=['kimi-pro','2'];assert.throws(()=>assertMode2Launch(c),/previous-proof/);c.used=c.completed=733;c.previous_proofs=[{recomputed_pass:true,actual_provider_inference:false,real_model_attempt:null}];assert.equal(assertMode2Launch(c).model,'k3');
});
test('实际审批记录的仓库相对完整路径与绝对路径绑定同一计划，不能只认basename',async()=>{
 const {assertMode2Launch,PLAN25}=await guard(),c=await sample(),relative='.reviews/'+PLAN25.topic+'/plan/'+PLAN25.basename;c.approval.reason=c.approval.reason.replace(c.batch.plan_final_ref,relative);assert.equal(assertMode2Launch(c).model,'qwen3.8-max');c.approval.reason=c.approval.reason.replace(relative,PLAN25.basename);assert.throws(()=>assertMode2Launch(c),/approval-scope/);
});
test('同basename的错主题计划不能因hash与run字面相同而通过',async()=>{
 const {assertMode2Launch}=await guard(),c=await sample();c.batch.plan_final_ref=c.batch.plan_final_ref.replace('/Agent双模式接入真实准入收口/','/other-topic/');assert.throws(()=>assertMode2Launch(c),/plan-binding/);
});
const mutations:Record<string,(c:Record<string,any>)=>void>={
 'review池':c=>c.pool='review','非fixture入口':c=>c.mode='tv','旧variant':c=>c.args[1]='1','多参数':c=>c.args.push('extra'),'未知组合':c=>c.args[0]='unknown',
 '错plan运行':c=>c.batch.plan_run_id='old','错plan原hash':c=>c.batch.plan_final_sha256='a'.repeat(64),'当前定稿漂移':c=>c.final_sha256='a'.repeat(64),'无本轮批准':c=>c.gate.state='awaiting_approval','错批准运行':c=>c.approval.run_id='old','批准拒绝':c=>c.approval.decision='rejected','批准范围缺项':c=>c.approval.reason=c.approval.reason.replace('HTTP限额',''),'失败审查':c=>c.run.status='failed','只读越界':c=>c.run.guard.readonly_breach=true,'引用泄漏':c=>c.run.guard.peer_artifact_read=true,'只读未知':c=>delete c.run.guard.readonly_breach,'侧证据不足':c=>c.run.critics.glm.evidence_ok=false,
 '越批组合':c=>c.args[0]='deepseek','批次增项':c=>c.batch.jobs.push({...c.batch.jobs[0],combination:'deepseek'}),'启动声明缺项':c=>delete c.batch.jobs[0].hard_starts,'已有输出':c=>c.output_exists=true,'已有认领':c=>c.claim_exists=true,'预算在途':c=>c.completed=731,'预算不足':c=>{c.used=c.completed=736;},'错误基线':c=>c.batch.before=731,'错误池上限':c=>c.pool_limit=743,'扩大批次':c=>c.batch.hard_limit=8,'原件hash漂移':c=>c.source_hashes_verified=false,'构建输入漂移':c=>c.build_inputs_verified=false,'live模式未知':c=>c.live_source_verified=false,'历史删除':c=>c.historical_retention_verified=false,'提前第二组合':c=>c.args[0]='kimi-pro','批准判据误采用':c=>c.batch.criterion_adoption_authorized=true,
};
for(const[name,mutate]of Object.entries(mutations))test('模式2独立启动拒绝：'+name,async()=>{const{assertMode2Launch}=await guard(),c=await sample();mutate(c);assert.throws(()=>assertMode2Launch(c),/mode2-/);});
for(const[description,pool,mode,...args]of [['错误池','review','fixture','qwen-pro','2'],['未知组合','admission','fixture','unknown','2'],['旧模式','admission','fixture','qwen-pro','1'],['多参数','admission','fixture','qwen-pro','2','extra']] as const)test('实际Node固定入口零CLI拒绝：'+description,async()=>{
 const launcher=path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r19/launch-controlled-mode2.mjs'),r=await run(process.execPath,[launcher,pool,'mode2-zero-cli-'+pool+'-'+args.length,mode,...args],{cwd:process.cwd(),timeoutMs:15000,killTree:true});assert.notEqual(r.code,0);assert.equal(r.timedOut,false);assert.match(r.stderr,/mode2-fixed-arguments-rejected/);
});

}
