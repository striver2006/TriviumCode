/** 本次交付检查：只读真实锚点，运行仓库本地检查；证据独立保存，不激活候选。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {read,hash,inventory,budget,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname,repo=path.resolve(here,'../../../../../..');
const old=path.resolve(here,'../s5-client-plan-20261016-01');
const prior=path.resolve(here,'../client-start-readonly-20261016-01');
const candidate=path.resolve(here,'../parent-budget-prep-20261016-01');
const baseline=read(candidate+'/after-state.json');
function inspect() {
  for(const x of baseline.anchors)assert.equal(hash(x.file),x.sha256);
  for(const x of baseline.frozen)assert.equal(hash(old+'/'+x.file),x.sha256);
  for(const tree of baseline.trees)assert.deepEqual(inventory(tree.cwd),tree.files);
  for(const x of baseline.indexes){assert.equal(fs.existsSync(x.path),x.actual_exists);if(x.actual_exists)assert.equal(hash(x.path),x.actual_sha256);}
  for(const x of baseline.roots)assert.equal(fs.existsSync(x.path),false);
  const p=read(old+'/preparation.json');
  assert.deepEqual(inventory(p.root+'/calls'),baseline.original_calls);
  assert.deepEqual(inventory(old),baseline.old_package);
  assert.deepEqual(inventory(prior),baseline.prior_package);
  const budgetRoot=read(path.resolve(here,'../../budget-plan.json')).budgetRoot;
  assert.deepEqual(inventory(budgetRoot+'/ledger'),baseline.live_ledger);
  assert.deepEqual(budget(),{admission:838,review:401});
  assert.equal(read(candidate+'/deployment.json').enabled,false);
  for(const dir of [old,candidate])for(const n of ['client-authorization.json','fault-authorization.json','launch-binding.json'])assert(!fs.existsSync(dir+'/'+n));
  return {budget:budget(),candidate_files:inventory(candidate),all_baseline_comparisons_pass:true};
}
const before=inspect(),started=new Date().toISOString();
saveEvidence(here+'/delivery-before.json',{at:started,...before});
const child=spawn('npm',['run','check'],{cwd:repo,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',error=null;
child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
child.on('error',e=>{error=e.message;});
const timer=setInterval(()=>console.log(JSON.stringify({running:true,elapsed_seconds:Math.round((Date.now()-Date.parse(started))/1000),completed_output_lines:stdout.split('\n').length})),40000);
const result=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({exit_code:code,signal})));
clearInterval(timer);
let after=null,postcheck_error=null;
try {after=inspect();assert.deepEqual(after,before);}catch(e){postcheck_error=e.message;}
saveEvidence(here+'/delivery-check.json',{started,finished:new Date().toISOString(),command:['npm','run','check'],cwd:repo,...result,error,stdout,stderr,before,after,postcheck_error,authorized_vendor_increment:{admission:0,review:0},client_started:false,configuration_activated:false,real_parent_coverage:null,verified_start_upper_bound:null});
console.log(JSON.stringify({...result,error,postcheck_error,summary:stdout.split('\n').filter(s=>/^(ℹ |# )(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(s)),budget:after?.budget??null}));
assert.equal(error,null);assert.equal(postcheck_error,null);assert.equal(result.exit_code,0);
