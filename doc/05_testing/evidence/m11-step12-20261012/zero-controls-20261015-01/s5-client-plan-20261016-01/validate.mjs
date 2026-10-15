/** 本批一次性零厂商准备检查。不运行init、Hook、故障注入或恢复。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {here,base,repo,read,hash,inventory,budget,verifyAnchors,saveEvidence} from './common.mjs';
import {scanSecrets} from '../../../../../../dist/test/src/trivium/secrets.js';
const p=read(here+'/preparation.json');verifyAnchors(p);
assert(!fs.existsSync(here+'/setup-authorization.json'));assert(!fs.existsSync(here+'/client-authorization.json'));
assert.deepEqual(inventory(p.fixtures.archive),p.original_files);assert.deepEqual(inventory(p.fixtures.empty),p.empty_files);
assert.deepEqual(inventory(p.root+'/empty-backup'),p.empty_files);
const commands=[];
const run=(cmd,args,cwd=repo)=>{
 const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 const v={command:[cmd,...args],cwd,exit_code:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr};
 commands.push(v);return v;
};
for(const f of fs.readdirSync(here).filter(n=>n.endsWith('.mjs')))assert.equal(run(p.node,['--check',here+'/'+f]).exit_code,0);
// 没有授权时必须在任何初始化/采集前终止；这不是Hook执行结果。
for(const [file,args,cwd] of [['setup.mjs',['archive'],repo],['runtime.mjs',['gate','hook-pre-commit'],p.fixtures.archive]]){
 const r=run(p.node,[here+'/'+file,...args],cwd);assert.equal(r.exit_code,1);assert(r.stderr.includes('未取得具名授权'));
}
assert(!fs.existsSync(p.root+'/calls'));assert(!fs.existsSync(here+'/setup-archive-before.json'));
assert.deepEqual(inventory(p.fixtures.archive),p.original_files);assert.deepEqual(inventory(p.fixtures.empty),p.empty_files);verifyAnchors(p);
const matrix=read(base+'/matrix.json'),old=read(here+'/matrix-before.json');
const ids=matrix.rows.map(r=>r.criterion);assert.equal(ids.length,68);assert.equal(new Set(ids).size,68);
assert.deepEqual(ids,old.rows.map(r=>r.criterion));
assert.deepEqual(ids,[...fs.readFileSync(repo+'/doc/05_testing/CASE_manual_acceptance.md','utf8').matchAll(/^\| (\d+\.\d+) \|/gm)].map(m=>m[1]));
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').filter(l=>/^\| \d+ \|/.test(l)).map(l=>l.split(/(?<!\\)\|/).slice(1,-1).map(c=>c.trim()));
assert.equal(md.length,68);
for(let i=0;i<68;i++){
 assert.equal(md[i][1],ids[i]);assert.equal(md[i].at(-1),matrix.rows[i].status);
 for(const k of ['requirement','expected','carrier','kind','routes','human','status'])assert.deepEqual(matrix.rows[i][k],old.rows[i][k]);
 for(const file of matrix.rows[i].evidence)assert(fs.existsSync(base+'/'+file));
}
const files=[...fs.readdirSync(here).map(f=>here+'/'+f),base+'/matrix.json',base+'/matrix.md',repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md'];
for(const f of files)assert.equal(scanSecrets(fs.readFileSync(f,'utf8')).length,0,'脱敏扫描失败：'+f);
assert.equal(run('git',['diff','--check']).exit_code,0);
assert.equal(run(p.node,['--test','dist/test/test/contract/doc-archive-index.test.js','dist/test/test/contract/evolution-ledger-parity.test.js']).exit_code,0);
saveEvidence(here+'/validation.json',{at:new Date().toISOString(),commands,matrix:{rows:68,unique:68,case_order_equal:true,markdown_equal:true,status_changes:[]},
 original_files_unchanged:p.original_files.length,copies_equal:true,empty_fixture_unchanged:true,secrets:0,budget_before:p.budget_before,budget_after:budget(),
 product_init_executed:false,hook_executed:false,client_started:false,protected_artifact_modified:false,
 scope:'未授权入口本地拒绝测试+语法/文档/矩阵检查；不证明初始化、采集层行为等价或客户端集成'});
console.log(JSON.stringify({validated:true,rows:68,original_files:141,unauthorized_entry_tests:2,budget:budget()}));
