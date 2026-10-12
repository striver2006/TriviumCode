/** 关闭消费者调用实际唯一状态机；模拟普通审批/布尔不能开消费。 */
import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
async function module(){return import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r21/criteria-consumer-v3.mjs')).href);}
for(const input of [null,{}, {sourceFactsVerified:true}, {criterionVersion:'restricted-tool-surface-and-path-v3',sourceFactsVerified:true}, {criterionVersion:'auth-cache-timestamp-applicability-v1',sourceFactsVerified:true}, {criterionVersion:'restricted-tool-surface-and-path-v2',sourceFactsVerified:true}, {approval:{schema:'trivium.approval.v1',decision:'approved'},sourceFactsVerified:true}])test('消费者拒绝缺独立批准及自报事实：'+JSON.stringify(input),async()=>{
 const m=await module(),r=await m.inspectCriterionConsumption(input);assert.equal(r.approval_valid,false);assert.equal(r.source_facts_recomputed,false);assert.equal(r.candidate_report_consumable,false);assert.equal(r.production_consumer_enabled,false);assert.equal(r.changes_canonical_original_status,false);assert.equal(r.real_model_attempt,null);
});
test('实际消费者依赖集合精确hash，缺项、多项、未知或漂移均拒绝',async()=>{
 const m=await module(),all={...m.CONSUMER_DEPENDENCIES};assert.equal(m.verifyConsumerDependencies(all),true);
 const missing={...all};delete missing[Object.keys(missing)[0]!];assert.equal(m.verifyConsumerDependencies(missing),false);
 assert.equal(m.verifyConsumerDependencies({...all,extra:'a'.repeat(64)}),false);
 const changed={...all};changed[Object.keys(changed)[0]!]='b'.repeat(64);assert.equal(m.verifyConsumerDependencies(changed),false);assert.equal(m.verifyConsumerDependencies(null),false);
});
test('缺批准时不能触发外部source verifier或隐式模型调用',async()=>{
 const m=await module(),context:Record<string,unknown>={sourceFactsVerified:true};Object.defineProperty(context,'authFactContext',{get(){throw Error('must-not-replay-without-approval');},enumerable:false});
 const r=await m.inspectCriterionConsumption(context);assert.equal(r.candidate_report_consumable,false);
});
