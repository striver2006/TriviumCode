/** 本轮定向校验；不运行任何旧采集器、Hook、厂商CLI或审批。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {saveEvidence} from '../../../../../../scripts/agent-access-evidence.mjs';
import {scanSecrets} from '../../../../../../dist/test/src/trivium/secrets.js';
const here=import.meta.dirname,zero=path.dirname(here),base=path.dirname(zero),repo=path.resolve(here,'../../../../../..');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert(!fs.existsSync(here+'/validation.json'));
const prep=read(here+'/next-preparation.json'),old=read(here+'/matrix-before.json'),matrix=read(base+'/matrix.json'),r=read(here+'/readback.json'),zp=read(zero+'/preparation.json');
function inventory(dir,rel=''){
 return fs.readdirSync(path.join(dir,rel)).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n,f=path.join(dir,p),s=fs.lstatSync(f);assert(!s.isSymbolicLink());
  return s.isDirectory()?inventory(dir,p):[{path:p,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
const original=inventory(prep.source);assert.deepEqual(original,prep.files);
for(const suffix of ['archive-copy','backup'])assert.deepEqual(inventory(prep.root+'/'+suffix),prep.files);
const failedRoot=zp.root+'/s5-client-preparation-01';assert.deepEqual(inventory(failedRoot+'/backup'),prep.files);
const failed=inventory(failedRoot+'/archive-copy');
const failedChanges=failed.filter(x=>JSON.stringify(x)!==JSON.stringify(prep.files.find(y=>y.path===x.path)));
assert.deepEqual(failedChanges.map(x=>x.path),['.git/index']);
assert.equal(failed.length,prep.files.length);
assert.equal(hash(zp.installed),zp.installed_sha256);
const ids=matrix.rows.map(x=>x.criterion);assert.equal(ids.length,68);assert.equal(new Set(ids).size,68);
assert.deepEqual(ids,old.rows.map(x=>x.criterion));
const caseIds=[...fs.readFileSync(repo+'/doc/05_testing/CASE_manual_acceptance.md','utf8').matchAll(/^\| (\d+\.\d+) \|/gm)].map(x=>x[1]);
assert.deepEqual(ids,caseIds);
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').filter(l=>/^\| \d+ \|/.test(l)).map(l=>l.split(/(?<!\\)\|/).slice(1,-1).map(c=>c.trim()));
assert.equal(md.length,68);
for(let i=0;i<68;i++){
 assert.equal(md[i][1],ids[i]);assert.equal(md[i].at(-1),matrix.rows[i].status);
 for(const k of ['requirement','expected','carrier','kind','routes','human'])assert.equal(matrix.rows[i][k],old.rows[i][k]);
 if(ids[i]!=='6.7')assert.equal(matrix.rows[i].status,old.rows[i].status);
 for(const file of matrix.rows[i].evidence)assert(fs.existsSync(base+'/'+file));
}
const channelSources={};
for(const key of ['h2','z01']){
 const source=r.sources[key];assert.equal(hash(source.file),source.sha256);
 channelSources[key]=fs.readFileSync(source.file,'utf8').split('\n').flatMap((text,i)=>
  /(?:Launching|Closing) Claude on channel:|Spawning Claude with SDK/.test(text)?[{line:i+1,text}]:[]);
}
assert(channelSources.z01.some(x=>x.line===391&&x.text.includes('Closing Claude on channel: zrui9hskn4j')));
assert(channelSources.z01.some(x=>x.line===418&&x.text.includes('resume: 52c58d79-eb90-4953-89dc-6ebd5923112e')));
saveEvidence(here+'/channel-binding.json',{sources:{h2:r.sources.h2,z01:r.sources.z01},channel_events:channelSources,
 conclusion:'Z01先前新会话通道已在恢复原会话前关闭；之后没有额外Spawning Claude记录。进程PID仍null，关联不升级为直接ID连接。'});
const commands=[];
for(const file of fs.readdirSync(here).filter(x=>x.endsWith('.mjs'))){
 const args=['--check',here+'/'+file],v=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8',timeout:10000});
 commands.push({command:[process.execPath,...args],exit_code:v.status,stdout:v.stdout,stderr:v.stderr});assert.equal(v.status,0);
}
const args=['--test','dist/test/test/contract/doc-archive-index.test.js','dist/test/test/contract/evolution-ledger-parity.test.js'];
const tests=spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
commands.push({command:[process.execPath,...args],exit_code:tests.status,stdout:tests.stdout,stderr:tests.stderr});assert.equal(tests.status,0);
const diff=spawnSync('git',['-c','core.quotePath=false','diff','--check'],{cwd:repo,encoding:'utf8'});
commands.push({command:['git','-c','core.quotePath=false','diff','--check'],exit_code:diff.status,stdout:diff.stdout,stderr:diff.stderr});assert.equal(diff.status,0);
const scan=fs.readdirSync(here).filter(f=>fs.statSync(here+'/'+f).isFile()).map(file=>({file,matches:scanSecrets(fs.readFileSync(here+'/'+file,'utf8')).length}));
assert(scan.every(x=>x.matches===0));
const plan=read(base+'/budget-plan.json'),budget=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
assert.deepEqual(budget,{admission:838,review:401});
const state=read(prep.source+'/.trivium/state.json'),task=read(prep.source+'/.reviews/m11-s12-capacity/task.json');
assert.equal(state.gates['m11-s12-capacity/bug'].state,'approved');
assert(task.approvals.some(x=>x.run_id==='20261015T123051Z'&&x.stage==='bug'&&x.decision==='approved'));
const s5=read(zero+'/s5-assessment.json'),s82=read(zero+'/s82-assessment.json');assert(s5.pass&&s82.pass);
saveEvidence(here+'/validation.json',{at:new Date().toISOString(),commands,scan,
 matrix:{json:68,markdown:68,case:68,unique:68,order_equal:true,requirements_unchanged:true,status_changed_only:['6.7']},
 baseline:{bug_run_id:'20261015T123051Z',bug_state:state.gates['m11-s12-capacity/bug'].state,s5_existing_assessment_pass:s5.pass,s82_existing_assessment_pass:s82.pass,all_read_only:true},
 original_full_tree_unchanged:true,new_full_copy_and_backup_equal:true,installed_runtime_unchanged:true,
 failed_dry_run_copy:{root:failedRoot,changed_files:failedChanges,original_index:prep.files.find(x=>x.path==='.git/index'),restored:false,scope:'失败现场保留；原工程与backup全树相等'},
 budget_before:prep.budget_after,budget_after:budget,delta:{admission:0,review:0},client_trigger_executed:false,full_npm_check_rerun:false,
 stop:'既有客户端一次健康归档dry-run待用户操作；任何新客户端/配置/独立绑定或厂商批次须另行明确范围'});
console.log(JSON.stringify({commands:commands.length,tests_exit:tests.status,matrix:68,budget,original_unchanged:true}));
