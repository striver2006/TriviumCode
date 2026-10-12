/** 26B/r30关闭消费者；唯一状态机+实际来源重验，普通批准不采用判据。 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {validateCriterionApproval,scopeDigest} from './criteria-validation-core.mjs';
import {replayAuthTimestampEvidence,AuthReplayNotApplicable} from './auth-evidence-replay.mjs';
import {recomputeMode3Proof} from './mode3-proof.mjs';
import {PLAN26} from './mode3-launch-guard.mjs';
export const CONSUMER_VERSION='candidate-consumer-v3';
const root=path.dirname(fileURLToPath(import.meta.url));
export const CONSUMER_DEPENDENCIES=Object.freeze({
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/criteria-validation-core.mjs": "6f6af0134789aac59f88d60c1a55ba194935552973fab4a747e26a6d409f2d91",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/criteria-contract.mjs": "c902352f36292889a3a1dd908da1d8005b6c7ade70090bc451e2e8b1012cced2",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/auth-evidence-replay.mjs": "a64fd0f9b13f630be21ddebb42ec8840d67336c61ac6fe40f77821dc4370dbd6",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/auth-timestamp-chain-v2.mjs": "94094599c37dc34d371f85d8bf69a44fbd52ef2df68f36f8fdff24d8cbf76e36",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/mode3-proof.mjs": "4e3020c8f2c23ccc720f9594c1d4c43a2e4ef40761a1495a06174da5d727816d",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/mode3-launch-guard.mjs": "20b7e5ab378e27d737ba442ade2cdc1d2c8d6bd0581870eb12ea55d0fab1cc77",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/controlled-inline-mode.mjs": "5a3d3d0c4db19072fc4bfa613043497b7ce2707f7add9cd2d7698dbb30cc11be",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/controlled-mechanism-mode3.mjs": "82f700be0542dbec89f9c786f206bd63fc3462a1abfbc084c5d0951245c2c615",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/controlled-fixture-mode3.mjs": "9158d0a91fe9db4fbf10797e6d1a64891aa11add8c28a2f851a93b100886f9ec",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r17/controlled-mechanism.mjs": "b9ac50611033eabe7dc1860853caa744da1b0bb9cbee396a8143d2014f3c90c0",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r17/auth-timestamp-applicability.mjs": "0a9ceeb48c4e8e7b68c3c28d899e9037f152071687439c5be533527bcc065b6e",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r19/controlled-mechanism.mjs": "79aec9ead2498e9a03dd8e6437d55034be7abbe68357145d2f4b211b1a59f499",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r19/controlled-runtime.mjs": "e5d883d76b4ce3572d65540b37b8edc79884bdcd6a0cead7bcf9b4885b3861b6",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/auth-timestamp-chain.v2.schema.json": "0b76465b267ba4c4d90be719307a288839acda84c85f899d9ffecad06431653d",
 "doc/05_testing/evidence/agent-access-20261011-closeout-r21/controlled-mechanism-mode3.v1.schema.json": "55190850cf7dff678d7d43180174a3f1bf4286ed133177956bb8827d90e9536d"
});
export function verifyConsumerDependencies(observed){return observed!==null&&typeof observed==='object'&&JSON.stringify(Object.keys(observed).sort())===JSON.stringify(Object.keys(CONSUMER_DEPENDENCIES).sort())&&Object.entries(CONSUMER_DEPENDENCIES).every(([p,h])=>observed[p]===h);}

export async function inspectCriterionConsumption(c){
 const observed={};for(const p of Object.keys(CONSUMER_DEPENDENCIES)){try{const stat=fs.lstatSync(p);observed[p]=stat.isFile()&&!stat.isSymbolicLink()?hash(p):null;}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')observed[p]=null;else throw error;}}
 if(!verifyConsumerDependencies(observed))return {schema:'candidate-consumer-diagnostic.v3',criterion_version:c?.criterionVersion??null,diagnostic_only:true,approval_valid:false,source_facts_recomputed:false,candidate_report_consumable:false,production_consumer_enabled:false,changes_canonical_original_status:false,reasons:['consumer-dependency-origin-mismatch'],real_model_attempt:null,server_identity:null};
 const expected={...c,topic:PLAN26.topic,planRunId:PLAN26.run_id,planRef:{path:path.resolve('.reviews',PLAN26.topic,'plan',PLAN26.basename),sha256:PLAN26.sha256},consumerVersion:CONSUMER_VERSION,consumerRef:{path:fileURLToPath(import.meta.url),sha256:hash(fileURLToPath(import.meta.url))},sourceFactsVerified:false};
 const origin=validateCriterionApproval(expected),reasons=origin.reasons.filter(r=>r!=='source-facts-not-verified');
 const end=validation=>({schema:'candidate-consumer-diagnostic.v3',criterion_version:c?.criterionVersion??null,diagnostic_only:true,approval_valid:validation.approval_valid,source_facts_recomputed:validation.approval_valid,candidate_report_consumable:validation.approval_valid,production_consumer_enabled:false,changes_canonical_original_status:false,reasons:validation.reasons,real_model_attempt:null,server_identity:null});
 if(reasons.length)return end({...origin,approval_valid:false,reasons});
 let actualScope;
 try{
  if(c.criterionVersion==='auth-cache-timestamp-applicability-v1'){
   const ref=c.authDiagnosticRef;if(!ref||!path.isAbsolute(ref.path??'')||hash(ref.path)!==ref.sha256)throw new AuthReplayNotApplicable('auth-diagnostic-origin-mismatch');
   const stat=fs.lstatSync(ref.path);if(!stat.isFile()||stat.isSymbolicLink())throw new AuthReplayNotApplicable('auth-diagnostic-nonregular');
   const saved=JSON.parse(fs.readFileSync(ref.path,'utf8')),actual=await replayAuthTimestampEvidence(c.authFactContext);
   if(saved.schema!=='auth-timestamp-chain.v2'||actual.applicable_diagnostic!==true||saved.applicable_diagnostic!==true||saved.current_complete_config_sha256!==actual.current_complete_config_sha256||saved.old_complete_config_sha256!==actual.old_complete_config_sha256||scopeDigest(saved.hops)!==scopeDigest(actual.hops)||scopeDigest(saved.components)!==scopeDigest(actual.components)||scopeDigest(saved.scope)!==scopeDigest(actual.scope)||scopeDigest(saved.source_refs)!==scopeDigest(actual.source_refs)||scopeDigest(saved.configuration_consumption_refs)!==scopeDigest(actual.configuration_consumption_refs)||scopeDigest(saved.latest_safety)!==scopeDigest(actual.latest_safety))throw new AuthReplayNotApplicable('auth-full-facts-mismatch');
   actualScope=actual.scope.map(s=>({route:s.route,model:s.model_requested,arm:s.arm,source_refs:[s.source_ref,ref]}));
  }else if(c.criterionVersion==='restricted-tool-surface-and-path-v3'){
   if(!Array.isArray(c.mechanismJobs)||!c.mechanismJobs.length||c.mechanismJobs.length>5||new Set(c.mechanismJobs.map(j=>j.combination)).size!==c.mechanismJobs.length)throw new AuthReplayNotApplicable('mode3-explicit-jobs-missing-or-duplicate');
   actualScope=[];for(const job of c.mechanismJobs){const proof=await recomputeMode3Proof(job,root+'/controlled-mechanism-mode3.v1.schema.json');actualScope.push({route:'claude',model:job.model,arm:'controlled-mechanism-mode3',source_refs:[proof.result_ref,proof.requested_ref]});}
  }else throw new AuthReplayNotApplicable('unknown-criterion-version');
  if(scopeDigest(c.scope)!==scopeDigest(actualScope))throw new AuthReplayNotApplicable('recomputed-scope-mismatch');
 }catch(error){
  if(error instanceof AuthReplayNotApplicable||error instanceof SyntaxError||['ENOENT','ENOTDIR','ELOOP'].includes(error?.code)||/^mode3-(?:proof-|previous-full-proof-rejected)/.test(error?.message??''))return end({...origin,approval_valid:false,reasons:['source-facts-not-verified']});
  throw error;
 }
 return end(validateCriterionApproval({...expected,scope:actualScope,sourceFactsVerified:true}));
}
