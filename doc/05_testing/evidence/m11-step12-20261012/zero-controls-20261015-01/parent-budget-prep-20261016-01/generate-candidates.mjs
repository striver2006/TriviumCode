/** 一次性产生候选源码及全文差异。只写本证据目录，不安装/授权/执行候选。 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {read,hash,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
import {ledgerSnapshot} from './budget-binding.mjs';
const here=import.meta.dirname,old=path.resolve(here,'../s5-client-plan-20261016-01');
function put(name,text){fs.writeFileSync(here+'/'+name,text,{flag:'wx',mode:0o600});}
let runtime=fs.readFileSync(old+'/runtime.mjs','utf8');
runtime=runtime.replace('here,base,repo,','here,oldHere,base,repo,');
runtime=runtime.replace("read(here+'/preparation.json')","read(oldHere+'/preparation.json')");
runtime=runtime.replace("const init=JSON.stringify(args)===JSON.stringify(['init','--json']);","const init=false; // setup已完成，新候选不提供init入口。");
runtime=runtime.replace("authorization(here+(init?'/setup-authorization.json':'/client-authorization.json'),init?'s5-setup':'s5-client');","authorization(here+'/client-authorization.json','s5-client-v2');");
runtime=runtime.replace("read(here+'/lifecycle-readback.json')","read(oldHere+'/lifecycle-readback.json')");
runtime=runtime.replace("fs.existsSync(here+'/setup-'","fs.existsSync(oldHere+'/setup-'");
runtime=runtime.replace("const dir=p.root+'/calls'","const dir=here+'/calls'");
runtime=runtime.replace("scope:'采集层回执；没有独立客户端关联或行为等价证据时仅作辅助，不自动更新矩阵'","scope:'v2采集层回执；未完成真实客户端等价性核验，不自动更新矩阵'");
runtime=runtime.replace("process.exitCode=loaded&&JSON.stringify(before)===JSON.stringify(after)?code??1:2;","if(!loaded||JSON.stringify(before)!==JSON.stringify(after))throw Error('CAPTURE_BUDGET_OR_PRELOAD_MISMATCH');\nif(signal)process.kill(process.pid,signal);else process.exitCode=code??75;");
const at=runtime.indexOf("const p=read(");assert(at>0);
runtime=runtime.slice(0,at)+'async function main(){\n'+runtime.slice(at)+'\n}\nmain().catch(error=>{\n const file=here+\'/capture-refusal-\'+crypto.randomUUID()+\'.json\';\n saveEvidence(file,{at:new Date().toISOString(),kind:\'capture-layer-refusal\',reason:error.message,exit_code:75,production_hook_exit:null});\n process.stderr.write(\'M11 capture layer refused; see separate capture-refusal evidence.\\n\');process.exitCode=75;\n});\n';
put('runtime.mjs',runtime);
for(const name of ['checkpoint.mjs','fixture-step.mjs']){
 let text=fs.readFileSync(old+'/'+name,'utf8').replace('here,read,','here,oldHere,expectedBaseline,read,');
 text=text.replaceAll("read(here+'/preparation.json')","read(oldHere+'/preparation.json')");
 text=text.replaceAll("authorization(here+'/client-authorization.json','s5-client')","authorization(here+'/client-authorization.json','s5-client-v2')");
 text=text.replaceAll("read(here+'/setup-'+name+'-after.json').files","expectedBaseline(p,name)").replaceAll("read(here+'/setup-archive-after.json').files","expectedBaseline(p,'archive')");
 text=text.replaceAll("p.root+'/calls'","here+'/calls'").replaceAll("p.root+'/removed-review'","here+'/removed-review'");
 if(name==='fixture-step.mjs')text=text.replace("authorization(here+'/client-authorization.json','s5-client-v2');verifyAnchors(p);","authorization(here+'/fault-authorization.json','s5-fault-v2');verifyAnchors(p);");
 if(name==='checkpoint.mjs')text=text.replace("budget_before:before?.budget_after??p.budget_after","budget_before:before?.budget_after??read(here+'/launch-binding.json').expected_counts");
 put(name,text);
}
put('proposed-wrapper.sh','#!/bin/sh\nexec "/opt/homebrew/opt/node/bin/node" "'+here+'/runtime.mjs" "$@"\n');
saveEvidence(here+'/deployment.json',{enabled:false,actual_extension_host_coverage_verified:null,coverage_evidence:null,coverage_evidence_sha256:null,reason:'仅零厂商独立准备；父级真实加载未验证，禁止配置生效'});
saveEvidence(here+'/ledger-baseline.json',ledgerSnapshot(read(path.resolve(here,'../../budget-plan.json')).budgetRoot));
saveEvidence(here+'/authorization-template.json',{template_only:true,decision:'not-authorized',scope:'s5-client-v2',batch_id:null,user_instruction:null,hook_vendor_increment:{admission:0,review:0},allowed_starts:null,expected_counts:null,budget_binding_sha256:null,old_proposal_sha256:hash(old+'/proposal-manifest.json'),candidate_manifest_sha256:null});
const p=read(old+'/preparation.json');
saveEvidence(here+'/activation-diff.json',{active:false,backups:Object.entries(p.fixtures).map(([name,cwd])=>({name,file:cwd+'/.trivium/bin/trivium',sha256:hash(cwd+'/.trivium/bin/trivium'),mode:fs.statSync(cwd+'/.trivium/bin/trivium').mode&0o777,content:fs.readFileSync(cwd+'/.trivium/bin/trivium','utf8')})),changes:Object.values(p.fixtures).map(cwd=>({file:cwd+'/.trivium/bin/trivium',before_sha256:hash(cwd+'/.trivium/bin/trivium'),after:fs.readFileSync(here+'/proposed-wrapper.sh','utf8'),after_sha256:hash(here+'/proposed-wrapper.sh'),after_mode:0o755})),hook_config_changes:[],global_config_changes:[],old_package_changes:[],authorization_created:false,parent_bridge_implemented:false});
const diffs=[];
for(const file of ['common.mjs','runtime.mjs','checkpoint.mjs','fixture-step.mjs','proposed-wrapper.sh']){
 const r=spawnSync('/usr/bin/diff',['-u',old+'/'+file,here+'/'+file],{encoding:'utf8',maxBuffer:1024*1024});assert([0,1].includes(r.status));
 diffs.push({file,base_sha256:hash(old+'/'+file),candidate_sha256:hash(here+'/'+file),command:['/usr/bin/diff','-u',old+'/'+file,here+'/'+file],exit_code:r.status,diff:r.stdout});
}
saveEvidence(here+'/candidate-diffs.json',{at:new Date().toISOString(),diffs,added_files:['budget-binding.mjs','deployment.json','ledger-baseline.json','authorization-template.json','activation-diff.json'],scope:'全文源码差异和激活差异，尚未部署'});
put('candidate.patch',diffs.map(x=>x.diff).join('\n'));
console.log(JSON.stringify({candidates_prepared:true,activated:false,old_package_modified:false}));
