/** 本批唯一一次准备：新完整副本/备份、空Git夹具、未生效的配置提案。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {here,base,repo,read,hash,inventory,budget,saveEvidence} from './common.mjs';
const old=read(path.dirname(here)+'/preparation.json');
const prior=read(path.dirname(here)+'/hook-readback-01/s5-client-assessment.json');
const source=old.source,root=old.root+'/s5-client-plan-20261016-01';
assert(!fs.existsSync(root));assert(!fs.existsSync(here+'/preparation.json'));
const before=budget();assert.deepEqual(before,{admission:838,review:401});
const files=inventory(source);assert.deepEqual(files,prior.original_full_inventory);
const installed=old.installed,assets=path.dirname(path.dirname(installed));
const node='/opt/homebrew/opt/node/bin/node';assert(fs.statSync(node).isFile());
const anchorPaths=[installed,node,base+'/client-tv.mjs',base+'/cap-preload.cjs',base+'/budget-plan.json',
 repo+'/scripts/agent-access-budget.cjs',repo+'/scripts/agent-access-budget-preload.cjs',
 ...['hooks/hooks.json','protocol/gitignore.snippet','protocol/driver.snippet','protocol/critic.snippet'].map(n=>assets+'/'+n)];
const anchors=anchorPaths.map(file=>({file,sha256:hash(file)}));
assert.equal(hash(installed),old.installed_sha256);
const hooks=read(source+'/.claude/settings.json').hooks;
assert.deepEqual(hooks,read(assets+'/hooks/hooks.json').hooks,'实际Hook与安装资产不一致，先停止评估');
fs.mkdirSync(root,{mode:0o700});
for(const name of ['archive','backup']) {
 fs.cpSync(source,root+'/'+name,{recursive:true,errorOnExist:true,force:false});
 assert.deepEqual(inventory(root+'/'+name),files);
 for(const x of files)assert.notEqual(fs.statSync(source+'/'+x.path).ino,fs.statSync(root+'/'+name+'/'+x.path).ino,'禁止硬链接副本');
}
const empty=root+'/empty';fs.mkdirSync(empty,{mode:0o700});
const args=['-c','core.quotePath=false','init','--quiet',empty];
const r=spawnSync('git',args,{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
saveEvidence(here+'/empty-git-init.json',{at:new Date().toISOString(),command:['git',...args],exit_code:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,error:r.error?.message??null,scope:'仅新空夹具Git初始化；未执行Trivium init'});
assert.equal(r.status,0);assert(!r.error);assert(!fs.existsSync(empty+'/.reviews'));
fs.cpSync(empty,root+'/empty-backup',{recursive:true,errorOnExist:true,force:false});
const emptyFiles=inventory(empty);assert.deepEqual(inventory(root+'/empty-backup'),emptyFiles);
const wrapper='#!/bin/sh\nexec '+JSON.stringify(node)+' '+JSON.stringify(here+'/runtime.mjs')+' "$@"\n';
const standard='#!/bin/sh\n# 由 `trivium init` 生成。node 路径写死是刻意的：\n# GUI 进程（VS Code）不读 ~/.zshrc，依赖 PATH 会在插件里失效（设计 §10.5）。\nexec "'+node+'" "'+installed+'" "$@"\n';
fs.writeFileSync(here+'/proposed-wrapper.sh',wrapper,{flag:'wx',mode:0o600});
fs.writeFileSync(here+'/expected-init-wrapper.sh',standard,{flag:'wx',mode:0o600});
fs.copyFileSync(source+'/.git/index',root+'/archive.index',fs.constants.COPYFILE_EXCL);
const targets=Object.fromEntries(['missing','changed'].map(k=>[k,old.targets[k]]));
const run=read(source+'/.reviews/m11-s12-capacity/plan/_meta/run-'+old.run_id+'.json');
for(const f of Object.values(targets))assert(run.artifacts.some(a=>'.reviews/'+a.path===f&&a.sha256===hash(source+'/'+f)));
const after=budget();assert.deepEqual(after,before);assert.deepEqual(inventory(source),files);
saveEvidence(here+'/preparation.json',{
 at:new Date().toISOString(),date_context:'2026-10-16 Asia/Singapore',source,root,fixtures:{archive:root+'/archive',empty},
 original_files:files,empty_files:emptyFiles,targets,run_id:old.run_id,installed,assets,node,anchors,hooks,
 copies_equal:true,original_unchanged:true,symlinks:false,hardlinks_to_source:false,
 archive_index:{path:root+'/archive.index',sha256:hash(root+'/archive.index')},empty_index:{path:root+'/empty.index',exists:false},
 budget_before:before,budget_after:after,vendor_increment:{admission:0,review:0},
 actual_client_exit_codes:null,product_init_executed:false,configuration_activated:false,client_started:false,
 binding:{source:'client-tv.mjs: process.cwd() !== cfg.fixture',product_wrapper_has_fixed_cwd:false,
 proposal:'在具名新副本以正式init生成标准wrapper，核对差异后安装独立采集wrapper；原wrapper/配置不修改，不伪造cwd',
 instrumentation:'拟议采集层尚未执行或证明行为等价；诊断结果不能自动升级为原配置集成通过'},
 proposal_diff:{archive_wrapper:{before:fs.readFileSync(source+'/.trivium/bin/trivium','utf8'),after_init:standard,after_capture:wrapper,mode_before:0o755,mode_after:0o755},
 hooks:{before:hooks,after:hooks,remove:[],reorder:false},
 init_possible_paths:['.trivium/bin/trivium','.trivium/config.yaml','.claude/settings.json','.zcode/config.json','.gitignore','CLAUDE.md','AGENTS.md','GEMINI.md','.reviews/README.md'],
 archive_config_policy:'已有v2共享/本机配置必须字节不变；真实审查工件/运行清单/state全部保持原样',
 empty_config_policy:'正式init缺省配置；保留全部Hook；只允许README，不生成审查记录'},
 authorization:{preparation:true,setup:false,client:false,protected_mutation:false,new_client_start_boundaries:null},
 stop:'方案与脚本审阅后另行授权setup；新客户端启动预算尚未知，不把Hook侧车0增量当作Driver启动授权'
});
console.log(JSON.stringify({root,archive_files:files.length,empty_files:emptyFiles.length,budget:after,init:false,client:false}));
