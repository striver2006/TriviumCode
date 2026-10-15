/** 新版采集公共校验；未激活，不改变旧18文件或旧授权。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {read,hash,digest,inventory,budget,fixture,assertSameExcept,phases,toolInput,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
import {ledgerSnapshot,verifyBudgetBinding} from './budget-binding.mjs';
export {read,hash,digest,inventory,budget,fixture,assertSameExcept,phases,toolInput,saveEvidence};
export const here=import.meta.dirname,oldHere=path.resolve(here,'../s5-client-plan-20261016-01'),base=path.resolve(here,'../..'),repo=path.resolve(here,'../../../../../..');
export function assertDeployment(){
 const d=read(here+'/deployment.json');
 assert.equal(d.enabled,true,'CAPTURE_NOT_ACTIVATED');
 assert.equal(d.actual_extension_host_coverage_verified,true,'PARENT_COVERAGE_UNVERIFIED');
 assert(typeof d.coverage_evidence==='string'&&path.isAbsolute(d.coverage_evidence));
 assert.equal(hash(d.coverage_evidence),d.coverage_evidence_sha256);
 const proof=read(d.coverage_evidence);
 assert.equal(proof.actual_extension_host_tested,true);assert.equal(proof.all_launch_boundaries_pre_reserved,true);
 assert.equal(proof.scope,'real-isolated-extension-host');
}
export function authorization(file,scope){
 assertDeployment();
 const a=read(file);assert.equal(a.decision,'approved');assert.equal(a.scope,scope);
 assert(typeof a.user_instruction==='string'&&a.user_instruction.trim());
 assert.equal(a.old_proposal_sha256,hash(oldHere+'/proposal-manifest.json'));
 for(const x of read(oldHere+'/proposal-manifest.json').files)assert.equal(hash(oldHere+'/'+x.file),x.sha256);
 assert.equal(a.candidate_manifest_sha256,hash(here+'/candidate-manifest.json'));
 for(const x of read(here+'/candidate-manifest.json').files)assert.equal(hash(here+'/'+x.file),x.sha256);
 assert.deepEqual(a.hook_vendor_increment,{admission:0,review:0});
 assert.equal(a.budget_binding_sha256,hash(here+'/launch-binding.json'));
 assert(typeof a.batch_id==='string'&&a.batch_id.length>0);
 assert(Array.isArray(a.allowed_starts));assert.deepEqual(a.expected_counts,read(here+'/launch-binding.json').expected_counts);
 return a;
}
export function verifyAnchors(p){
 // 不再把准备时838/401当新会话运行时的绝对相等条件；不可变文件仍按旧事实核验。
 for(const x of p.anchors)assert.equal(hash(x.file),x.sha256);
 assert.deepEqual(inventory(p.source),p.original_files);assert.deepEqual(inventory(p.root+'/backup'),p.original_files);
 assert.deepEqual(inventory(p.root+'/empty-backup'),p.empty_files);
 const auth=authorization(here+'/client-authorization.json','s5-client-v2');
 const binding=read(here+'/launch-binding.json'),plan=read(base+'/budget-plan.json');
 assert.equal(binding.batch_id,auth.batch_id);
 const current=ledgerSnapshot(plan.budgetRoot),baseline=read(here+'/ledger-baseline.json');
 verifyBudgetBinding(binding,baseline,current);
 assert(current.counts.admission<=plan.absolute_step_caps.admission&&current.counts.review<=plan.absolute_step_caps.review);
 assert(current.counts.admission-plan.baseline.admission.used+current.counts.review-plan.baseline.review.used<=80);
 assert.equal(auth.allowed_starts.length,binding.driver_starts.length);
 for(const s of binding.driver_starts){
  assert.equal(hash(s.start_receipt),s.start_receipt_sha256);const r=read(s.start_receipt);
  assert.equal(r.kind,'parent-pre-spawn.v2');assert.equal(r.phase,'spawned');assert.equal(r.batch_id,auth.batch_id);
  assert.equal(r.reserved_sha256,s.reserved_sha256);assert.equal(r.pool,s.pool);assert.equal(r.index,s.index);
  assert(Number.isSafeInteger(r.pid)&&r.pid>0&&Number.isSafeInteger(r.parent_pid)&&r.parent_pid>0);
  assert(typeof r.lstart==='string'&&r.lstart.length>0);assert.equal(r.pre_reserved,true);
  assert(auth.allowed_starts.some(x=>x.pool===s.pool&&x.index===s.index&&x.entry_sha256===r.entry_sha256&&x.cwd===r.cwd));
 }
}
export function expectedBaseline(p,name){
 const baseline=read(oldHere+'/setup-'+name+'-after.json').files;
 return baseline.map(x=>x.path==='.trivium/bin/trivium'?{...x,sha256:hash(here+'/proposed-wrapper.sh'),bytes:fs.statSync(here+'/proposed-wrapper.sh').size,mode:0o755}:x);
}
