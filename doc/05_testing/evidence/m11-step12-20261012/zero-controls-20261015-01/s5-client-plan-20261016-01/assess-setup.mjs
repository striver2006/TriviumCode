/** 独立只读核对Bob已执行的两个setup；不重跑init、Hook、旧脚本或恢复。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {here,base,read,hash,digest,inventory,budget,verifyAnchors,authorization,saveEvidence} from './common.mjs';
import {primaryLoaded} from '../../../../../../scripts/agent-access-evidence.mjs';
const p=read(here+'/preparation.json');
authorization(here+'/setup-authorization.json','s5-setup');verifyAnchors(p);
assert(!fs.existsSync(here+'/setup-assessment.json'));
assert.deepEqual(inventory(p.root+'/empty-backup'),p.empty_files);
assert.equal(hash(p.archive_index.path),p.archive_index.sha256);assert(!fs.existsSync(p.empty_index.path));
const names=fs.readdirSync(p.root+'/calls').sort();
assert.equal(names.length,4);assert(names.every(n=>/^[a-f0-9-]+-(requested|completed)\.json$/.test(n)));
const receipts=names.filter(n=>n.endsWith('-completed.json')).map(n=>({file:p.root+'/calls/'+n,sha256:hash(p.root+'/calls/'+n),record:read(p.root+'/calls/'+n)}));
assert.equal(receipts.length,2);
const preview=read(here+'/configuration-preview.json'),results=[];
for(const name of ['archive','empty']) {
 const cwd=p.fixtures[name],before=read(here+'/setup-'+name+'-before.json'),init=read(here+'/setup-'+name+'-init-result.json'),after=read(here+'/setup-'+name+'-after.json');
 const standard=read(here+'/setup-'+name+'-standard-wrapper.json'),current=inventory(cwd);
 assert.deepEqual(before.files,name==='archive'?p.original_files:p.empty_files);
 assert.equal(init.cwd,cwd);assert.equal(init.exit_code,0);assert.equal(init.signal,null);assert.equal(init.error,null);
 assert.deepEqual(init.command,[p.node,here+'/runtime.mjs','init','--json']);
 assert.deepEqual(current,after.files);assert.equal(after.init_exit,0);
 const expected=preview.diffs.filter(d=>d.fixture===name);
 for(const d of expected)assert.equal(init.files.find(f=>f.path===d.file)?.sha256,d.after_sha256,d.file);
 const changed=[...new Set([...before.files,...init.files].map(x=>x.path))].filter(f=>JSON.stringify(before.files.find(x=>x.path===f))!==JSON.stringify(init.files.find(x=>x.path===f)));
 assert.deepEqual(changed.sort(),expected.filter(d=>d.changed).map(d=>d.file).sort());
 const unwrapped=v=>v.filter(f=>f.path!=='.trivium/bin/trivium');assert.deepEqual(unwrapped(init.files),unwrapped(current));
 assert.equal(standard.sha256,hash(here+'/expected-init-wrapper.sh'));assert.equal(digest(standard.content),standard.sha256);assert.equal(standard.mode,0o755);
 assert.equal(hash(cwd+'/.trivium/bin/trivium'),hash(here+'/proposed-wrapper.sh'));assert.equal(fs.statSync(cwd+'/.trivium/bin/trivium').mode&0o777,0o755);
 assert.deepEqual(read(cwd+'/.claude/settings.json').hooks,p.hooks);
 const matched=receipts.filter(x=>x.record.cwd===cwd);assert.equal(matched.length,1);
 const entry=matched[0],r=entry.record,requestPath=entry.file.replace('-completed.json','-requested.json'),request=read(requestPath);
 for(const [k,v]of Object.entries(request))assert.deepEqual(r[k],v);
 assert.deepEqual(r.command,[p.node,p.installed,'init','--json']);assert.equal(r.code,0);assert.equal(r.signal,null);assert.equal(r.spawn_error,null);
 assert.equal(r.stdout,init.stdout);assert.equal(r.stderr,init.stderr);assert.equal(r.primary_loaded,true);
 assert.equal(r.installed_sha256,hash(p.installed));assert.equal(r.script_sha256,hash(here+'/runtime.mjs'));
 assert.deepEqual(r.budget_before,p.budget_before);assert.deepEqual(r.budget_after,p.budget_after);
 assert(before.at<=r.at&&r.finished<=init.at&&init.at<=after.at);
 const root=read(base+'/budget-plan.json').budgetRoot;
 const marks=fs.readdirSync(root+'/loaded').filter(n=>n.startsWith(r.load_id+'-')).map(n=>({file:root+'/loaded/'+n,sha256:hash(root+'/loaded/'+n),record:read(root+'/loaded/'+n)}));
 assert(primaryLoaded(marks.map(x=>x.record),r,r.parent_pid));
 assert(marks.some(x=>x.record.pid===r.pid&&x.record.parent_pid===r.parent_pid));
 results.push({name,cwd,at:r.at,finished:r.finished,installed_init_exit:r.code,capture_process_exit:init.exit_code,
 outer_terminal_setup_exit:null,outer_exit_note:'终端顶层退出码未单独录制；after工件及当前全树核验表明安装步骤已完成，不伪造顶层退出码',
 current_files:current.length,actual_init_changed_paths:changed,final_wrapper_sha256:hash(cwd+'/.trivium/bin/trivium'),wrapper_mode:0o755,
 hooks_equal:true,all_init_diffs_match_preview:true,current_equals_after:true,request:{path:requestPath,sha256:hash(requestPath)},receipt:entry,loaded_marks:marks,
 evidence:['before','init-result','standard-wrapper','after'].map(s=>({file:'setup-'+name+'-'+s+'.json',sha256:hash(here+'/setup-'+name+'-'+s+'.json')}))});
}
assert.deepEqual(fs.readdirSync(p.fixtures.empty+'/.reviews'),['README.md']);
for(const b of read(here+'/lifecycle-readback.json').buckets)assert(!fs.existsSync(b.path));
assert(!fs.existsSync(here+'/client-authorization.json'));
assert(!fs.readdirSync(here).some(n=>/^(operation-|checkpoint-|rollback-)/.test(n)));
verifyAnchors(p);
saveEvidence(here+'/setup-assessment.json',{at:new Date().toISOString(),date_context:'2026-10-16 Asia/Singapore',results,
 original_files_unchanged:141,archive_backup_equal:true,empty_backup_equal:true,external_indexes_unchanged:true,empty_has_no_recorded_reviews:true,
 call_receipts:{init:2,hook:0},actual_hook_exit_codes:null,client_acceptance_pass:null,
 client_authorization_present:false,new_run_buckets_absent:true,fault_injection_records:0,restoration:'无异常漂移；未执行恢复',
 budget_before:p.budget_before,budget_after:budget(),vendor_increment:{admission:0,review:0},
 setup_complete:true,ready_for_client:false,scope:'仅本地setup完成；不证明采集层Hook行为等价或5.2～5.5客户端集成'});
console.log(JSON.stringify({setup_complete:true,init_exit_codes:results.map(x=>x.installed_init_exit),files:results.map(x=>x.current_files),budget:budget(),ready_for_client:false}));
