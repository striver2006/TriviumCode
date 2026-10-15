/** 交付前只读审计；只新增本批审计结果，不重跑冻结实验或候选执行器。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {read,hash,inventory,budget,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
import {scanSecrets} from '../../../../../../dist/test/src/trivium/secrets.js';
const here=import.meta.dirname,repo=path.resolve(here,'../../../../../..'),base=path.resolve(here,'../..');
function git(args){const r=spawnSync('git',['-c','core.quotePath=false',...args],{cwd:repo,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;}
const packageNames=['client-start-readonly-20261016-01','parent-budget-prep-20261016-01'];
const manifestCounts={};
for(const n of packageNames){
  const dir=path.resolve(here,'..',n),m=read(dir+'/manifest.json');
  for(const f of m.files)assert.equal(hash(dir+'/'+(f.path??f.file)),f.sha256);
  manifestCounts[n]=m.files.length;
}
const check=read(here+'/delivery-check.json');
assert.equal(check.exit_code,0);assert.equal(check.error,null);assert.equal(check.postcheck_error,null);
assert.deepEqual(check.before,check.after);
assert.deepEqual(inventory(path.resolve(here,'../parent-budget-prep-20261016-01')),check.after.candidate_files);
assert.deepEqual(budget(),{admission:838,review:401});
const matrixPath=path.relative(repo,base+'/matrix.json');
const prior=JSON.parse(git(['show','HEAD:'+matrixPath])),current=read(base+'/matrix.json');
const unchanged=o=>Object.fromEntries(Object.entries(o).filter(([k])=>!['rows','at'].includes(k)));
assert.deepEqual(unchanged(current),unchanged(prior));
assert.equal(current.rows.length,68);assert.equal(new Set(current.rows.map(x=>x.criterion)).size,68);
assert.deepEqual(current.rows.map(x=>x.criterion),prior.rows.map(x=>x.criterion));
for(let i=0;i<68;i++){
  const a={...current.rows[i]},b={...prior.rows[i]};
  if(['5.2','5.3','5.4','5.5'].includes(a.criterion))for(const k of ['evidence','observation']){delete a[k];delete b[k];}
  assert.deepEqual(a,b);
  for(const f of current.rows[i].evidence)assert(fs.existsSync(base+'/'+f));
}
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').filter(l=>/^\| \d+ \|/.test(l)).map(l=>l.split(/(?<!\\)\|/).slice(1,-1).map(c=>c.trim()));
assert.equal(md.length,68);
for(let i=0;i<68;i++){
  assert.equal(md[i][1],current.rows[i].criterion);assert.equal(md[i].at(-1),current.rows[i].status);
  assert.equal(md[i][7],(current.rows[i].evidence.join(', ')||'尚无本轮满足判据的证据').replaceAll('|','\\|'));
}
git(['diff','--check']);
const testArgs=['--test','dist/test/test/contract/doc-archive-index.test.js','dist/test/test/contract/evolution-ledger-parity.test.js'];
const tests=spawnSync(process.execPath,testArgs,{cwd:repo,encoding:'utf8',timeout:30000});assert.equal(tests.status,0,tests.stderr);
const tracked=git(['diff','--name-only','HEAD','-z']).split('\0').filter(Boolean);
const untracked=git(['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
const files=[...new Set([...tracked,...untracked])].sort();
const standalone=['doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md',matrixPath,path.relative(repo,base+'/matrix.md')];
const roots=[...packageNames,'delivery-plan-20261016-01'].map(n=>path.relative(repo,path.resolve(here,'..',n))+'/');
for(const f of files){
  assert(standalone.includes(f)||roots.some(r=>f.startsWith(r)),'范围外变更：'+f);
  assert(fs.lstatSync(repo+'/'+f).isFile());assert.equal(scanSecrets(fs.readFileSync(repo+'/'+f,'utf8')).length,0,'脱敏扫描失败：'+f);
}
const plan=fs.readFileSync(here+'/NEXT_DEVELOPMENT_PLAN.md','utf8');
for(const match of plan.matchAll(/\]\(([^)]+)\)/g)){
  const target=path.resolve(here,match[1]);
  assert(target===here+'/delivery-audit.json'||fs.existsSync(target),'计划链接不存在');
}
saveEvidence(here+'/delivery-audit.json',{at:new Date().toISOString(),head_before:git(['rev-parse','HEAD']).trim(),branch:git(['branch','--show-current']).trim(),manifest_counts:manifestCounts,
  full_check:{exit_code:check.exit_code,result:'delivery-check.json',sha256:hash(here+'/delivery-check.json')},
  docs_after_final_update:{command:[process.execPath,...testArgs],exit_code:tests.status,stdout:tests.stdout,stderr:tests.stderr},
  matrix:{rows:68,status_changes:[],only_evidence_observation_rows:['5.2','5.3','5.4','5.5']},
  secrets:0,baseline_and_true_ledger_unchanged:true,budget:budget(),authorized_vendor_increment:{admission:0,review:0},verified_start_upper_bound:null,
  files:files.map(f=>({file:f,sha256:hash(repo+'/'+f),bytes:fs.statSync(repo+'/'+f).size})),
  self_excluded:true,scope:'提交前审计；文件清单不含本审计自身，Git提交含本审计。不是启动或配置生效授权。'});
console.log(JSON.stringify({audited:true,files_before_audit:files.length,manifestCounts,budget:budget(),status_changes:[],secrets:0}));
