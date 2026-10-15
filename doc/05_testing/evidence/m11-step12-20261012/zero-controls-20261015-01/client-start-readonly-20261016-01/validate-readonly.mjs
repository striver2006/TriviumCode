/** 本轮零厂商检查：不执行候选入口、旧脚本、Hook或厂商程序。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {saveEvidence,read,hash,budget} from '../s5-client-plan-20261016-01/common.mjs';
import {scanSecrets} from '../../../../../../dist/test/src/trivium/secrets.js';
const here=import.meta.dirname,base=path.resolve(here,'../..'),repo=path.resolve(here,'../../../../../..');
const before=read(here+'/before-state.json'),after=read(here+'/after-state.json');
for(const key of ['trees','frozen','anchors','indexes','buckets','calls','configs','budget_after'])assert.deepEqual(after[key],before[key],key+'发生漂移');
assert.deepEqual(budget(),{admission:838,review:401});
const commands=[];
function run(bin,args){const r=spawnSync(bin,args,{cwd:repo,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});const out={command:[bin,...args],cwd:repo,exit_code:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr};commands.push(out);assert.equal(r.status,0);return out;}
for(const file of fs.readdirSync(here).filter(n=>n.endsWith('.mjs')))run(process.execPath,['--check',here+'/'+file]);
run('/bin/sh',['-n',here+'/capture-only-entry.sh']);
assert.equal(fs.statSync(here+'/capture-only-entry.sh').mode&0o777,0o644);
assert(!fs.existsSync(here+'/capture-only-authorization.json'));assert(!fs.existsSync(here+'/capture-only-observation.json'));
const proposal=read(here+'/configuration-proposal.json');assert(!fs.existsSync(proposal.isolation_root));
for(const item of proposal.independent_backups)assert.equal(hash(item.file),item.sha256);
assert.equal(hash(proposal.capture_entry.file),proposal.capture_entry.sha256);
const req=createRequire(import.meta.url),{vendorOf}=req(repo+'/scripts/agent-access-budget.cjs');
// 纯函数覆盖；绝不调用openBudget/reserve/spawn厂商，暴露现有分类器的范围。
const native=before.extensions[0].native.file;
const cases=[{name:'direct-native',bin:native,args:[],expected:'claude'},
 {name:'custom-wrapper-native-argument',bin:here+'/capture-only-entry.sh',args:[native],expected:null},
 {name:'node-runtime',bin:process.execPath,args:[path.resolve(here,'../s5-client-plan-20261016-01/runtime.mjs'),'gate','hook-pre-commit'],expected:null},
 {name:'shell-c-text',bin:'/bin/sh',args:['-c',native+' --version'],expected:null}];
const classifier=cases.map(c=>{const actual=vendorOf(c.bin,c.args);assert.equal(actual,c.expected);return {...c,actual,execution:'pure function only; argv not executed'};});
const matrix=read(base+'/matrix.json'),old=read(here+'/matrix-before.json');
const ids=matrix.rows.map(r=>r.criterion);assert.equal(ids.length,68);assert.equal(new Set(ids).size,68);
assert.deepEqual(ids,old.rows.map(r=>r.criterion));
assert.deepEqual(ids,[...fs.readFileSync(repo+'/doc/05_testing/CASE_manual_acceptance.md','utf8').matchAll(/^\| (\d+\.\d+) \|/gm)].map(m=>m[1]));
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').filter(l=>/^\| \d+ \|/.test(l)).map(l=>l.split(/(?<!\\)\|/).slice(1,-1).map(c=>c.trim()));
assert.equal(md.length,68);
for(let i=0;i<68;i++){
 assert.equal(md[i][1],ids[i]);assert.equal(md[i].at(-1),matrix.rows[i].status);
 const a={...matrix.rows[i]},b={...old.rows[i]};delete a.evidence;delete a.observation;delete b.evidence;delete b.observation;assert.deepEqual(a,b);
 assert.equal(md[i][7],(matrix.rows[i].evidence.length?matrix.rows[i].evidence.join(', '):'尚无本轮满足判据的证据').replaceAll('|','\\|'));
 for(const file of matrix.rows[i].evidence)assert(fs.existsSync(base+'/'+file));
}
run(process.execPath,['--test','dist/test/test/contract/doc-archive-index.test.js','dist/test/test/contract/evolution-ledger-parity.test.js']);
run('git',['-c','core.quotePath=false','diff','--check']);
const evidenceFiles=fs.readdirSync(here).map(n=>here+'/'+n);
for(const f of [...evidenceFiles,base+'/matrix.json',base+'/matrix.md',repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md'])assert.equal(scanSecrets(fs.readFileSync(f,'utf8')).length,0,'脱敏扫描失败：'+f);
saveEvidence(here+'/validation.json',{at:new Date().toISOString(),command:[process.execPath,import.meta.filename],commands,classifier,
 state_captures:[{command:before.command,exit_code:0},{command:after.command,exit_code:0}],
 preparation_commands:[{command:[process.execPath,here+'/prepare-proposal.mjs'],exit_code:0},{command:[process.execPath,here+'/reconcile.mjs'],exit_code:0}],
 state_capture_exit_source:'本轮实际工具输出，非从工件存在推断',matrix:{rows:68,unique:68,case_order_equal:true,json_markdown_order_status_equal:true,all_other_fields_unchanged:true,status_changes:[]},
 secrets_findings:0,budget_before:before.budget_before,budget_after:budget(),authorized_increment:{admission:0,review:0},
 frozen_files_unchanged:18,anchors_unchanged:11,fixtures_and_backups_unchanged:true,configuration_activated:false,candidate_executed:false,hook_executed:false,
 client_started_by_this_task:false,vendor_cli_started_by_this_task:false,actual_client_exit:null,verified_start_upper_bound:null,restoration_executed:false,
 full_npm_check:'未测；本轮只读取证和文档准备，执行定向文档检查',
 scope:'纯函数分类检查/语法/文档/矩阵/脱敏；不证明父级预算拦截、采集等价性或5.2～5.5客户端验收'});
saveEvidence(here+'/manifest.json',{at:new Date().toISOString(),authorization:false,files:[...evidenceFiles,here+'/validation.json'].map(file=>({file:path.basename(file),sha256:hash(file)}))});
console.log(JSON.stringify({validated:true,rows:68,status_changes:[],budget:budget(),vendor_calls:0,activation:false}));
