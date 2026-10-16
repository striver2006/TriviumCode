/** 收口池（user-decision-02.json D4：不设额度）：全局台账经既有 extend 追加大额，budget-plan.json 升 revision 4。旧账不清零、不重分类。零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'..');
const {openBudget,hashFile}=createRequire(import.meta.url)('../../../../../scripts/agent-access-budget.cjs');
const old=JSON.parse(fs.readFileSync(base+'/budget-plan.json'));
if(old.revision!==3)throw Error('前置分池不是 revision 3，不重复执行');
const count=p=>fs.readdirSync(path.join(old.budgetRoot,'ledger',p)).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
const used={admission:count('admission'),review:count('review')};
if(used.admission!==838||used.review!==401)throw Error('台账已变化，停止：'+JSON.stringify(used));
const pools={admission:openBudget(old.budgetRoot,'admission'),review:openBudget(old.budgetRoot,'review')};
const before={admission:pools.admission.limit(),review:pools.review.limit()};
const reason='Bob 2026-10-16 答复「新预算池可以更加宽松，可以不设额度，该用多少就多少」；见 TriviumCode/doc/05_testing/evidence/m11-step12-20261012/closeout-20261016-01/user-decision-02.json；逐次计数照旧，旧账不重分类';
const receipts={};
for(const p of ['admission','review'])receipts[p]=pools[p].extend('m11-closeout-unbounded-'+p,1000,reason);
const after={admission:pools.admission.limit(),review:pools.review.limit()};
saveEvidence(here+'/closeout-pool-extension-receipts.json',{at:new Date().toISOString(),used_at_start:used,limits_before:before,limits_after:after,receipts,decision_sha256:hashFile(here+'/user-decision-02.json'),note:'+1000 只为让既有 reserve 循环不设实际上限；每次启动仍写 reserved/launch 回执'});
const revised={...old,at:new Date().toISOString(),revision:4,authorization:'Bob：不设额度，该用多少就多少（user-decision-02.json）',
 baseline:{admission:{used:used.admission,completed:used.admission,limit:after.admission},review:{used:used.review,completed:used.review,limit:after.review}},
 step_limits:{admission:null,review:null,total:null},absolute_step_caps:after,
 extension:'收口池：admission '+before.admission+'→'+after.admission+'，review '+before.review+'→'+after.review+'；不设本步总额',
 sealed_previous:{plan:'budget-plan-revision-03.json',ledger_at_seal:used,step_used:{admission:43,review:28,total:71}},
 batches:JSON.parse(fs.readFileSync(here+'/budget-pool-proposal.json')).batches.map(b=>({batch:b.batch,criteria:b.criteria??null,estimate:b.hard,status:'估算，不作上限；具名 client-batch 发布后才执行'})),
 previous_plan:'budget-plan-revision-03.json',decision:'closeout-20261016-01/user-decision-02.json'};
saveEvidence(base+'/budget-plan-revision-04.json',revised);
const tmp=base+'/budget-plan-revision-04.tmp';
fs.writeFileSync(tmp,JSON.stringify(revised,null,2)+'\n',{flag:'wx',mode:0o600});
fs.renameSync(tmp,base+'/budget-plan.json');
console.log(JSON.stringify({used,limits_before:before,limits_after:after}));
