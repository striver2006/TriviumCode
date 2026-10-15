/** 本轮最终定向核验；不重跑实验、不调用旧执行脚本、不执行任何候选入口。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {read,hash,digest,inventory,budget,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
import {scanSecrets} from '../../../../../../dist/test/src/trivium/secrets.js';
const here=import.meta.dirname,base=path.resolve(here,'../..'),repo=path.resolve(here,'../../../../../..');
const commands=[];
function run(bin,args){const r=spawnSync(bin,args,{cwd:repo,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});commands.push({command:[bin,...args],cwd:repo,exit_code:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,0,r.stderr);}
const before=read(here+'/before-state.json'),after=read(here+'/after-state.json');
for(const key of Object.keys(before).filter(k=>!['at','command'].includes(k)))assert.deepEqual(after[key],before[key]);
const candidates=read(here+'/candidate-manifest.json');
for(const x of candidates.files)assert.equal(hash(here+'/'+x.file),x.sha256);
const ad=read(here+'/activation-diff.json');
for(const b of ad.backups){assert.equal(digest(Buffer.from(b.content)),b.sha256);assert.equal(hash(b.file),b.sha256);assert.equal(fs.statSync(b.file).mode&0o777,b.mode);}
for(const c of ad.changes)assert.equal(hash(here+'/proposed-wrapper.sh'),c.after_sha256);
assert.equal(read(here+'/deployment.json').enabled,false);
assert.equal(read(here+'/deployment.json').actual_extension_host_coverage_verified,null);
for(const n of ['client-authorization.json','fault-authorization.json','launch-binding.json','calls','capture-only-authorization.json'])assert(!fs.existsSync(here+'/'+n));
assert.equal(fs.statSync(here+'/proposed-wrapper.sh').mode&0o111,0);
const lab=read(here+'/local-budget-results.json'),binding=read(here+'/budget-binding-results.json');
assert.equal(lab.passed,15);assert.equal(binding.passed,10);assert.equal(lab.actual_extension_host_tested,false);
for(const scenario of lab.results)for(const x of [...scenario.events,...scenario.ledger,...scenario.markers])assert.equal(hash(x.file),x.sha256);
for(const f of fs.readdirSync(here).filter(n=>/\.(?:mjs|cjs)$/.test(n)))run(process.execPath,['--check',here+'/'+f]);
run('/bin/sh',['-n',here+'/proposed-wrapper.sh']);
const matrix=read(base+'/matrix.json'),previous=read(here+'/matrix-before.json'),ids=matrix.rows.map(x=>x.criterion);
assert.equal(ids.length,68);assert.equal(new Set(ids).size,68);assert.deepEqual(ids,previous.rows.map(x=>x.criterion));
assert.deepEqual(ids,[...fs.readFileSync(repo+'/doc/05_testing/CASE_manual_acceptance.md','utf8').matchAll(/^\| (\d+\.\d+) \|/gm)].map(x=>x[1]));
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').filter(l=>/^\| \d+ \|/.test(l)).map(l=>l.split(/(?<!\\)\|/).slice(1,-1).map(c=>c.trim()));assert.equal(md.length,68);
for(let i=0;i<68;i++){
 const a={...matrix.rows[i]},b={...previous.rows[i]};delete a.evidence;delete a.observation;delete b.evidence;delete b.observation;assert.deepEqual(a,b);
 assert.equal(md[i][1],ids[i]);assert.equal(md[i].at(-1),matrix.rows[i].status);
 assert.equal(md[i][7],(matrix.rows[i].evidence.join(', ')||'尚无本轮满足判据的证据').replaceAll('|','\\|'));
 for(const file of matrix.rows[i].evidence)assert(fs.existsSync(base+'/'+file));
}
run(process.execPath,['--test','dist/test/test/contract/doc-archive-index.test.js','dist/test/test/contract/evolution-ledger-parity.test.js']);
run('git',['-c','core.quotePath=false','diff','--check']);
const files=inventory(here);
for(const x of files)assert.equal(scanSecrets(fs.readFileSync(here+'/'+x.path,'utf8')).length,0,x.path+'脱敏失败');
for(const file of [base+'/matrix.json',base+'/matrix.md',repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md'])assert.equal(scanSecrets(fs.readFileSync(file,'utf8')).length,0);
assert.deepEqual(budget(),before.budget);
saveEvidence(here+'/validation.json',{at:new Date().toISOString(),command:[process.execPath,import.meta.filename],commands,
 execution_receipts:[{command:before.command,exit_code:0},{command:lab.command,exit_code:0},{command:binding.command,exit_code:0},{command:after.command,exit_code:0}],
 receipt_source:'本轮工具实际退出码；非从文件存在推断',local_behavior_tests:25,local_behavior_passed:25,candidate_syntax_only:true,
 candidate_manifest_verified:true,independent_backups_byte_exact:true,old_packages_and_real_ledger_unchanged:true,
 matrix:{rows:68,unique:68,case_json_markdown_order_equal:true,status_changes:[],other_fields_unchanged:true},secrets:0,
 budget_before:before.budget,budget_after:budget(),authorized_vendor_increment:{admission:0,review:0},actual_extension_host_tested:false,actual_parent_coverage:null,verified_real_start_upper_bound:null,
 candidate_hook_equivalence:'未测',candidate_startup_session_binding:'未测且存在时序依赖',full_npm_check:'未测；证据/候选定向检查',
 client_started:false,configuration_activated:false,fault_injected_into_acceptance_fixture:false,restoration_executed:false});
saveEvidence(here+'/manifest.json',{at:new Date().toISOString(),authorization:false,scope:'零厂商准备证据与本地实验；不可部署授权',files:[...files,{path:'validation.json',sha256:hash(here+'/validation.json'),bytes:fs.statSync(here+'/validation.json').size,mode:0o600}]});
console.log(JSON.stringify({validated:true,local_tests:25,rows:68,status_changes:[],budget:budget(),activated:false,real_start_upper_bound:null}));
