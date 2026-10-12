/** 消费Bob对40/40的明确批准；不改旧台账、不重分类、不增加总80。 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,repo=path.resolve(here,'../../../..');
const {openBudget}=createRequire(import.meta.url)(repo+'/scripts/agent-access-budget.cjs');
const old=JSON.parse(fs.readFileSync(here+'/budget-plan.json'));
const proposal=JSON.parse(fs.readFileSync(here+'/budget-repartition-proposal.json'));
if(old.step_limits.admission!==20||old.step_limits.review!==60)throw Error('分池已变化，不重复执行');
const decision={at:new Date().toISOString(),source:'Bob主会话对budget-repartition-proposal.json的直接答复',answer:'同意修订为40/40，总上限80',approved_step_limits:proposal.proposed_step_limits,approved_absolute_caps:proposal.proposed_absolute_caps,scope:'仅本步分池重划；旧admission/review台账与已使用归属不变；每批上限另行发布；不是对任何审查运行的审批'};
saveEvidence(here+'/budget-repartition-user-decision.json',decision);
saveEvidence(here+'/budget-plan-initial.json',old);
const receipts=[];
for(const pool of ['admission','review']){
 const b=openBudget(old.budgetRoot,pool),e=proposal.necessary_extensions[pool];
 if(b.limit()!==e.from)throw Error(pool+'现有上限变化，停止并保留已发布回执');
 receipts.push(b.extend('m11-step12-40x40-'+pool,e.additional,'2026-10-12 Bob明确同意修订为40/40，总上限80；见TriviumCode/doc/05_testing/evidence/m11-step12-20261012/budget-repartition-user-decision.json；旧台账不重分类'));
}
saveEvidence(here+'/budget-repartition-extension-receipts.json',{at:new Date().toISOString(),receipts,legacy_authorized_by_note:'既有extend函数的authorized_by固定为旧授权文案；本次独立批准来源为user-decision及各记录reason，不改历史机制或字段。'});
const revised={...old,at:new Date().toISOString(),revision:2,authorization:'Bob明确答复：同意修订为40/40，总上限80；原始授权与20/60提案保留',step_limits:proposal.proposed_step_limits,absolute_step_caps:proposal.proposed_absolute_caps,extension:'本次admission815→835、review398→413，旧记录只追加；本步总80及各批硬上限持续生效',batches:proposal.batches.map(b=>({...b,status:b.id==='A实际'?'实际完成':'估算；仅具名client-batch发布的批次可执行'})),initial_plan:'budget-plan-initial.json',decision:'budget-repartition-user-decision.json'};
saveEvidence(here+'/budget-plan-revision-02.json',revised);
const tmp=here+'/budget-plan.tmp';fs.writeFileSync(tmp,JSON.stringify(revised,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,here+'/budget-plan.json');
console.log(JSON.stringify({step_limits:revised.step_limits,absolute_caps:revised.absolute_step_caps,extensions:receipts.map(r=>({pool:r.pool,from:r.previous_limit,to:r.new_limit}))}));
