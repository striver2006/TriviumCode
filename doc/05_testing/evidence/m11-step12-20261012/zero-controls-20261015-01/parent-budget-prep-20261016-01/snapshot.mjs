/** 本轮只读状态快照；不调用旧执行脚本、不运行客户端。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {read,hash,inventory,budget,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname,old=path.resolve(here,'../s5-client-plan-20261016-01'),previous=path.resolve(here,'../client-start-readonly-20261016-01');
const phase=process.argv[2];assert(['before','after'].includes(phase));assert.equal(process.argv.length,3);
const p=read(old+'/preparation.json');
const frozen=read(old+'/proposal-manifest.json').files.map(x=>({...x,actual:hash(old+'/'+x.file)}));assert(frozen.every(x=>x.sha256===x.actual));
const anchors=p.anchors.map(x=>({...x,actual:hash(x.file)}));assert(anchors.every(x=>x.sha256===x.actual));
const trees=[['source',p.source,p.original_files],['backup',p.root+'/backup',p.original_files],['empty-backup',p.root+'/empty-backup',p.empty_files],...Object.entries(p.fixtures).map(([n,cwd])=>[n,cwd,read(old+'/setup-'+n+'-after.json').files])].map(([name,cwd,expected])=>{const files=inventory(cwd);assert.deepEqual(files,expected);return {name,cwd,files};});
const indexes=[p.archive_index,p.empty_index].map(x=>({...x,actual_exists:fs.existsSync(x.path),actual_sha256:fs.existsSync(x.path)?hash(x.path):null}));assert.equal(indexes[0].actual_sha256,p.archive_index.sha256);assert(!indexes[1].actual_exists);
const roots=read(old+'/lifecycle-readback.json').buckets.map(x=>({...x,actual_exists:fs.existsSync(x.path)}));assert(roots.every(x=>!x.actual_exists));
const original_calls=inventory(p.root+'/calls');assert.equal(original_calls.length,4);
const prior_package=inventory(previous),old_package=inventory(old);
const budgetRoot=read(path.resolve(here,'../../budget-plan.json')).budgetRoot;
const live_ledger=inventory(budgetRoot+'/ledger');
const actual={at:new Date().toISOString(),command:[process.execPath,import.meta.filename,phase],budget:budget(),frozen,anchors,trees,indexes,roots,original_calls,prior_package,old_package,live_ledger,client_authorization_exists:fs.existsSync(old+'/client-authorization.json')};
assert.deepEqual(actual.budget,{admission:838,review:401});assert(!actual.client_authorization_exists);
if(phase==='after') {const b=read(here+'/before-state.json');for(const key of Object.keys(actual).filter(k=>!['at','command'].includes(k)))assert.deepEqual(actual[key],b[key],key+'漂移');}
saveEvidence(here+'/'+phase+'-state.json',actual);
if(phase==='before') {
 const files=['/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js',process.env.HOME+'/.vscode/extensions/anthropic.claude-code-2.1.296-darwin-arm64/extension.js',process.env.HOME+'/.vscode/extensions/anthropic.claude-code-2.1.300-darwin-arm64/extension.js'];
 const sources=files.map(file=>{
  const text=fs.readFileSync(file,'utf8'),needles=file.includes('desktop.main')?['function N$n(', 'this._environmentService.debugExtensionHost.env&&rm(n,','r.execArgv=["--nolazy"','async _tryFindDebugPort()']:['spawnLocalProcess(', 'delete V.NODE_OPTIONS','viaProcessWrapper:!0'];
  return {file,sha256:hash(file),excerpts:needles.map(needle=>{const offset=text.indexOf(needle);assert(offset>=0);return {needle,offset,excerpt:text.slice(Math.max(0,offset-140),offset+900)};})};
 });
 saveEvidence(here+'/parent-entry-static.json',{at:new Date().toISOString(),sources,parent_entry:'extension host child_process.spawn before original call',extension_host_env_scrub_static:true,sdk_env_scrub_static:true,
  injection_verified:false,debug_break_route:'静态存在inspect-brk分支；端口获取失败可返回0，未验证加载/暂停顺序，不能当安全入口',verified_start_upper_bound:null,client_executed:false});
 saveEvidence(here+'/matrix-before.json',read(path.resolve(here,'../../matrix.json')));
}
console.log(JSON.stringify({phase,budget:actual.budget,frozen:frozen.length,all_fixture_trees_unchanged:true}));
