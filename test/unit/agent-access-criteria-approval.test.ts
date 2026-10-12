/** 模拟批准谱系只验证校验器；不产生真实用户批准或启用判据。 */
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {scratchDir} from '../helpers/scratch.js';
import {Ajv2020} from 'ajv/dist/2020.js';
type Value=Record<string,any>;
const hash=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function validator(){return import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r17/criteria-approval-validation.mjs')).href);}
async function sample(){
 const {scopeDigest}=await validator(),root=await scratchDir('trivium-criteria-test-');const events=root+'/events';fs.mkdirSync(events);
 const ref=(name:string,content:any)=>{const p=root+'/'+name;fs.writeFileSync(p,typeof content==='string'?content:JSON.stringify(content));return{path:p,sha256:hash(p)};};
 const scope=[{route:'codex',model:'simulated-model',arm:'diagnostic',source_refs:[ref('source.json',{simulation:true})]}];
 const decision=ref('user-decision.json',{schema:'explicit-user-criterion-decision.v1',source_kind:'user_message',initiator:'Bob',delegated:false,decision:'approved',criterion_version:'auth-cache-timestamp-applicability-v1',topic:'simulated-topic',scope_sha256:scopeDigest(scope),statement_exact:'仅测试模拟独立批准，不是用户实际授权',received_at:'2026-10-11T17:00:00.000Z'});
 const plan=ref('plan.md','simulation plan'),consumer=ref('consumer.mjs','simulation consumer');
 const approval:Value={schema:'criteria-approval.v1',decision_id:'simulated-decision',topic:'simulated-topic',criterion_version:'auth-cache-timestamp-applicability-v1',decision:'approved',scope,plan_run_id:'simulated-plan-run',plan_final_ref:plan,user_decision_ref:decision,user_statement_exact:'仅测试模拟独立批准，不是用户实际授权',initiator:'Bob',performed_by:'codex',delegated:false,session_id:null,reason:'simulated exact scope',approved_at:'2026-10-11T17:01:00.000Z',revocation_conditions:['any fingerprint change'],consumer_version:'simulation-v1',consumer_sha256:consumer.sha256,can_prove:['simulated local validation'],cannot_prove:['user identity or model capability']};
 const eventFile=events+'/approved.json';fs.writeFileSync(eventFile,JSON.stringify(approval));
 const manifestFile=root+'/manifest.json';
 const context:Value={approval,criterionVersion:approval.criterion_version,topic:approval.topic,scope:structuredClone(scope),planRunId:approval.plan_run_id,planRef:plan,consumerVersion:'simulation-v1',consumerRef:consumer,trustedUserDecisionRef:decision,eventDir:events,eventManifestRef:{path:manifestFile,sha256:''},sourceFactsVerified:true};
 const syncManifest=()=>{fs.writeFileSync(manifestFile,JSON.stringify({schema:'criteria-events.v1',complete:true,decision_id:approval.decision_id,criterion_version:approval.criterion_version,events:fs.readdirSync(events).map(n=>({path:events+'/'+n,sha256:hash(events+'/'+n)}))}));context.eventManifestRef.sha256=hash(manifestFile);};
 const syncApproval=()=>{fs.writeFileSync(eventFile,JSON.stringify(approval));syncManifest();};syncManifest();
 return{root,events,ref,approval,context,eventFile,manifestFile,syncManifest,syncApproval};
}
test('完整模拟独立批准校验有效，产品消费者仍未启用且身份证明边界明确',async()=>{
 const s=await sample(),{validateCriterionApproval}=await validator(),r=validateCriterionApproval(s.context);assert.equal(r.approval_valid,true,JSON.stringify(r.reasons));assert.equal(r.production_consumer_enabled,false);assert.match(r.identity_proof,/no cryptographic/);
});
const mutations:Record<string,(s:Awaited<ReturnType<typeof sample>>)=>void>={
 '普通审批替代':s=>{s.approval.schema='trivium.approval.v1';},
 '正式轮数授权替代':s=>{s.approval.schema='formal-round-authorization.v13';},
 '委托为true':s=>{s.approval.delegated=true;},
 '自行推荐来源':s=>{s.approval.initiator='Driver';},
 '明确拒绝':s=>{s.approval.decision='rejected';},
 '错主题':s=>{s.approval.topic='other';},
 '旧候选版本':s=>{s.approval.criterion_version='component-scoped-evidence-v1';},
 '错scope模型':s=>{s.context.scope[0].model='other';},
 '未登记route':s=>{s.approval.scope[0].route='unknown';s.context.scope=structuredClone(s.approval.scope);},
 '缺scope':s=>{delete s.context.scope;},
 '错plan运行':s=>{s.approval.plan_run_id='other-run';},
 '错consumer版本':s=>{s.context.consumerVersion='other';},
 'consumer字节漂移':s=>{fs.writeFileSync(s.context.consumerRef.path,'changed');},
 'plan字节漂移':s=>{fs.writeFileSync(s.context.planRef.path,'changed');},
 '源证据字节漂移':s=>{fs.writeFileSync(s.approval.scope[0].source_refs[0].path,'changed');},
 '缺可信用户消息':s=>{delete s.context.trustedUserDecisionRef;},
 '用户原文字节漂移':s=>{fs.writeFileSync(s.approval.user_decision_ref.path,'changed');},
 '原文与声明不一致':s=>{s.approval.user_statement_exact='ordinary approve';},
 '早于消息审批':s=>{s.approval.approved_at='2026-10-11T16:59:00.000Z';},
 '日期损坏':s=>{s.approval.approved_at='bad';},
 '机制事实尚未核验':s=>{s.context.sourceFactsVerified=false;},
 '重复作用面':s=>{s.approval.scope.push(structuredClone(s.approval.scope[0]));s.context.scope=structuredClone(s.approval.scope);},
 '重复来源':s=>{s.approval.scope[0].source_refs.push(structuredClone(s.approval.scope[0].source_refs[0]));s.context.scope=structuredClone(s.approval.scope);},
};
for(const[name,mutate]of Object.entries(mutations))test('独立批准变异拒绝：'+name,async()=>{
 const s=await sample(),{validateCriterionApproval}=await validator();mutate(s);s.syncApproval();const r=validateCriterionApproval(s.context);assert.equal(r.approval_valid,false,name);assert.equal(r.production_consumer_enabled,false);
});
test('明确撤销、未知事件、冲突批准、重复批准及缺批准事件均拒绝',async()=>{
 const {validateCriterionApproval}=await validator();for(const kind of ['revoked','unknown','conflict','duplicate','empty']){
  const s=await sample();let event:Value;
  if(kind==='empty')fs.unlinkSync(s.eventFile);
  else{event=kind==='revoked'?{schema:'criteria-revocation.v1',event_id:'revoke-1',decision_id:s.approval.decision_id,criterion_version:s.approval.criterion_version,source_ref:s.ref('revoke-source.json',{simulation:true}),reason:'simulation revoke',at:'2026-10-11T17:02:00.000Z'}:kind==='unknown'?{schema:'unknown'}:{...structuredClone(s.approval),...(kind==='conflict'?{reason:'conflicting'}:{})};fs.writeFileSync(s.events+'/extra.json',JSON.stringify(event));}
  s.syncManifest();assert.equal(validateCriterionApproval(s.context).approval_valid,false,kind);
 }
});
test('完整清单遗漏、重复、损坏、错hash、越域或事后追加事件均拒绝',async()=>{
 const {validateCriterionApproval}=await validator();for(const kind of ['incomplete','duplicate','damage','hash','escape','late']){
  const s=await sample(),m=JSON.parse(fs.readFileSync(s.manifestFile,'utf8'));
  if(kind==='incomplete')m.complete=false;if(kind==='duplicate')m.events.push(m.events[0]);if(kind==='hash')m.events[0].sha256='c'.repeat(64);if(kind==='escape')m.events[0]=s.ref('outside-event.json',s.approval);
  fs.writeFileSync(s.manifestFile,kind==='damage'?'{':JSON.stringify(m));s.context.eventManifestRef.sha256=hash(s.manifestFile);
  if(kind==='late')fs.writeFileSync(s.events+'/late.json','{}');assert.equal(validateCriterionApproval(s.context).approval_valid,false,kind);
 }
});
test('关键来源软链不消费；缺批准输入不能发生隐式批准',async()=>{
 const s=await sample(),{validateCriterionApproval}=await validator(),p=s.approval.scope[0].source_refs[0].path,target=p+'.original';fs.renameSync(p,target);fs.symlinkSync(target,p);assert.equal(validateCriterionApproval(s.context).approval_valid,false);for(const c of [null,{},s.context.approval])assert.equal(validateCriterionApproval(c).approval_valid,false);
});
test('未知撤销形状完整进入事件清单仍拒绝，不当作无撤销',async()=>{
 const s=await sample(),{validateCriterionApproval}=await validator();fs.writeFileSync(s.events+'/unknown-revocation.json',JSON.stringify({schema:'criteria-revocation.v99',decision_id:s.approval.decision_id,criterion_version:s.approval.criterion_version,at:'2026-10-11T17:02:00.000Z'}));s.syncManifest();assert.equal(validateCriterionApproval(s.context).approval_valid,false);
});
test('落盘批准与撤销Schema真实对账唯一合同，重复数组形状由同源拒绝',async()=>{
 const root=path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r17'),{approvalSchema,revocationSchema}=await import(pathToFileURL(root+'/criteria-contract.mjs').href);
 for(const[name,expected]of [['criteria-approval.v1.schema.json',approvalSchema],['criteria-revocation.v1.schema.json',revocationSchema]] as const)assert.deepEqual(JSON.parse(fs.readFileSync(root+'/'+name,'utf8')),expected);
 const validate=new Ajv2020({strict:true}).compile(approvalSchema),s=await sample();assert.equal(validate(s.approval),true);s.approval.scope.push(structuredClone(s.approval.scope[0]));assert.equal(validate(s.approval),false);
 s.approval.scope.pop();s.approval.scope[0].source_refs.push(structuredClone(s.approval.scope[0].source_refs[0]));assert.equal(validate(s.approval),false);
});
