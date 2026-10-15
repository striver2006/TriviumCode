/** 本地合成数据测试预算绑定；不写真实ledger，不生成真实启动/审批回执。 */
import assert from 'node:assert/strict';
import {verifyBudgetBinding} from './budget-binding.mjs';
import {assertDeployment} from './common.mjs';
import {digest,saveEvidence,budget} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname,before=budget();
const snapshot=entries=>({entries,counts:{admission:entries.filter(x=>x.pool==='admission').length,review:entries.filter(x=>x.pool==='review').length},digest:digest(JSON.stringify(entries))});
const e=(pool,index)=>({pool,index,sha256:digest(pool+index)});
const baseline=snapshot([e('admission',1),e('review',1)]),current=snapshot([e('admission',1),e('admission',2),e('review',1)]);
const binding={schema:'s5-budget-binding.v2',baseline_digest:baseline.digest,expected_counts:current.counts,expected_digest:current.digest,driver_starts:[{pool:'admission',index:2,reserved_sha256:e('admission',2).sha256,start_receipt:here+'/local-lab/SYNTHETIC-NOT-A-REAL-RECEIPT',start_receipt_sha256:'0'.repeat(64)}]};
const cases=[];
function check(name,fn,denied=false){if(denied)assert.throws(fn);else fn();cases.push({name,passed:true,expected_refusal:denied});}
check('已绑定admission增量不再被旧等值校验误拒',()=>assert.equal(verifyBudgetBinding(binding,baseline,current).new_driver_boundaries,1));
check('零增量绑定',()=>verifyBudgetBinding({...binding,expected_counts:baseline.counts,expected_digest:baseline.digest,driver_starts:[]},baseline,baseline));
check('计数不符',()=>verifyBudgetBinding({...binding,expected_counts:baseline.counts},baseline,current),true);
check('未绑定启动',()=>verifyBudgetBinding({...binding,driver_starts:[]},baseline,current),true);
check('重复绑定',()=>verifyBudgetBinding({...binding,driver_starts:[...binding.driver_starts,...binding.driver_starts]},baseline,current),true);
check('历史预占内容变化',()=>{const c=snapshot([{...e('admission',1),sha256:'f'.repeat(64)},e('admission',2),e('review',1)]);verifyBudgetBinding({...binding,expected_digest:c.digest},baseline,c);},true);
check('不能动用review剩余额度',()=>{const c=snapshot([e('admission',1),e('review',1),e('review',2)]);verifyBudgetBinding({...binding,expected_counts:c.counts,expected_digest:c.digest},baseline,c);},true);
check('新预占hash不符',()=>verifyBudgetBinding({...binding,driver_starts:[{...binding.driver_starts[0],reserved_sha256:'f'.repeat(64)}]},baseline,current),true);
check('缺父级启动回执引用',()=>verifyBudgetBinding({...binding,driver_starts:[{...binding.driver_starts[0],start_receipt:null}]},baseline,current),true);
check('未激活在读取任何真实授权之前拒绝',()=>assertDeployment(),true);
assert.deepEqual(budget(),before);
saveEvidence(here+'/budget-binding-results.json',{at:new Date().toISOString(),command:[process.execPath,import.meta.filename],cases,total:cases.length,passed:cases.length,budget_before:before,budget_after:budget(),scope:'纯合成预算结构检查；回执来源真实性及真实采集等价性未测',real_launch_receipts_created:false});
console.log(JSON.stringify({tests:cases.length,passed:cases.length,budget:budget()}));
