/** 24B独立批准校验：只返回诊断；产品消费者始终未启用。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import {ALL_AGENT_IDS} from '../../../../dist/test/src/trivium/agents/registry.js';
import {approvalSchema,revocationSchema} from './criteria-contract.mjs';
const ajv=new Ajv2020({strict:true,allErrors:true}),approvalShape=ajv.compile(approvalSchema),revocationShape=ajv.compile(revocationSchema);
const candidates=new Set(['restricted-tool-surface-and-path-v2','auth-cache-timestamp-applicability-v1']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(object(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
export const scopeDigest=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function loadRef(ref){
 if(!object(ref)||!path.isAbsolute(ref.path??'')||!/^[a-f0-9]{64}$/.test(ref.sha256??''))return null;
 let s;try{s=fs.lstatSync(ref.path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(!s.isFile()||s.isSymbolicLink())return null;const b=fs.readFileSync(ref.path);return digest(b)===ref.sha256?b:null;
}
function decode(bytes){try{return JSON.parse(bytes.toString('utf8'));}catch(e){if(e instanceof SyntaxError)return null;throw e;}}
export function validateCriterionApproval(c){
 const reasons=[],fail=r=>reasons.push(r),end=()=>({schema:'criteria-approval-validation.v1',diagnostic_only:true,approval_valid:reasons.length===0,reasons:[...new Set(reasons)],production_consumer_enabled:false,identity_proof:'local-origin-and-hash-audit; no cryptographic user identity proof'});
 if(!object(c)||!object(c.approval)||!approvalShape(c.approval)||!Array.isArray(c.scope)||!c.scope.length){fail('missing-or-damaged-approval-shape');return end();}
 const a=c.approval;if(a.decision!=='approved'||a.delegated!==false||a.initiator!=='Bob'||!ALL_AGENT_IDS.includes(a.performed_by))fail('not-explicit-independent-approval');
 if(!candidates.has(a.criterion_version)||a.criterion_version!==c.criterionVersion||a.topic!==c.topic||scopeDigest(a.scope)!==scopeDigest(c.scope))fail('wrong-version-topic-or-scope');
 if(a.scope.some(s=>!ALL_AGENT_IDS.includes(s.route)))fail('unregistered-scope-identity');
 if(!Number.isFinite(Date.parse(a.approved_at))||new Date(a.approved_at).toISOString()!==a.approved_at)fail('invalid-approval-time');
 if(a.plan_run_id!==c.planRunId||a.plan_final_ref.path!==c.planRef?.path||a.plan_final_ref.sha256!==c.planRef?.sha256||!loadRef(a.plan_final_ref))fail('plan-origin-mismatch');
 if(a.consumer_version!==c.consumerVersion||a.consumer_sha256!==c.consumerRef?.sha256||!loadRef(c.consumerRef))fail('consumer-version-or-hash-mismatch');
 const decisionBytes=loadRef(a.user_decision_ref),decision=decisionBytes?decode(decisionBytes):null;
 if(!object(c.trustedUserDecisionRef)||a.user_decision_ref.path!==c.trustedUserDecisionRef.path||a.user_decision_ref.sha256!==c.trustedUserDecisionRef.sha256)fail('no-trusted-user-message-origin');
 if(!object(decision)||decision.schema!=='explicit-user-criterion-decision.v1'||decision.source_kind!=='user_message'||decision.initiator!=='Bob'||decision.delegated!==false||decision.decision!==a.decision||decision.criterion_version!==a.criterion_version||decision.topic!==a.topic||decision.scope_sha256!==scopeDigest(a.scope)||decision.statement_exact!==a.user_statement_exact||!Number.isFinite(Date.parse(decision.received_at))||Date.parse(a.approved_at)<Date.parse(decision.received_at))fail('independent-user-decision-origin-mismatch');
 for(const s of a.scope)for(const ref of s.source_refs)if(!loadRef(ref))fail('source-origin-hash-mismatch');
 const manifestBytes=loadRef(c.eventManifestRef),manifest=manifestBytes?decode(manifestBytes):null;
 if(!object(manifest)||manifest.schema!=='criteria-events.v1'||manifest.complete!==true||manifest.decision_id!==a.decision_id||manifest.criterion_version!==a.criterion_version||!Array.isArray(manifest.events)||!path.isAbsolute(c.eventDir??'')){fail('missing-or-damaged-complete-event-manifest');return end();}
 let dir;try{dir=fs.lstatSync(c.eventDir);}catch(e){if(e.code==='ENOENT'){fail('missing-event-directory');return end();}throw e;}
 if(!dir.isDirectory()||dir.isSymbolicLink()){fail('untrusted-event-directory');return end();}
 const files=fs.readdirSync(c.eventDir).sort(),listed=manifest.events.map(r=>r.path);
 if(listed.some(p=>typeof p!=='string'||path.dirname(p)!==c.eventDir)||new Set(listed).size!==listed.length||JSON.stringify(files)!==JSON.stringify(listed.map(p=>path.basename(p)).sort())){fail('incomplete-or-duplicate-event-list');return end();}
 let approved=0;const ids=new Set();
 for(const ref of manifest.events){
  const bytes=loadRef(ref),event=bytes?decode(bytes):null;if(!object(event)){fail('damaged-event-or-hash');continue;}
  if(event.schema==='criteria-approval.v1'){
   if(!approvalShape(event)||scopeDigest(event)!==scopeDigest(a)){fail('conflicting-approval-event');continue;}approved++;
  }else if(event.schema==='criteria-revocation.v1'){
   if(!revocationShape(event)||event.decision_id!==a.decision_id||event.criterion_version!==a.criterion_version||!loadRef(event.source_ref)||!Number.isFinite(Date.parse(event.at))||Date.parse(event.at)<Date.parse(a.approved_at))fail('damaged-or-conflicting-revocation');
   else fail('approval-revoked');
   if(ids.has(event.event_id))fail('duplicate-event-id');ids.add(event.event_id);
  }else fail('unknown-event-state');
 }
 if(approved!==1)fail('missing-or-duplicate-approval-event');
 // 原件与当前机制事实都必须完整；普通批准/受控pass绝不自动开消费。
 if(c.sourceFactsVerified!==true)fail('source-facts-not-verified');
 return end();
}
