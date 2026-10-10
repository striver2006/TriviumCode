import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {saveEvidence} from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import {computeBuildStamp} from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/build-stamp.js';
import {scanSecrets} from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/secrets.js';
const repo='/Users/chenzhenbo/Work/TriviumCode';
const root=path.join(repo,'doc/05_testing/evidence/agent-access-20261010-codex-native-tiers');
const require=createRequire(import.meta.url);
const {hashFile,openBudget}=require(path.join(repo,'scripts/agent-access-budget.cjs'));
const checks=[1,2].map(n=>JSON.parse(fs.readFileSync(path.join(root,`check-${n}.json`))));
if(checks.some(x=>x.code!==0||x.stats.fail!==0))throw Error('两次检查尚未通过');
const env={...process.env};delete env.TRIVIUM_ASSET_ROOT;
for(const [name,bin,args] of [
 ['rebuild','npm',['run','build']],
 ['install',process.execPath,['dist/install.cjs','--targets','claude']],
 ['selftest',path.join(repo,'.trivium/bin/trivium'),['doctor','--selftest','--json']],
]){
 const start=new Date().toISOString();const child=spawn(bin,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const [code,signal]=await new Promise(resolve=>child.once('close',(...x)=>resolve(x)));
 const pass=name==='selftest'?/14\/14/.test(stdout+'\n'+stderr):null;
 saveEvidence(path.join(root,name+'.json'),{start,end:new Date().toISOString(),bin,args,code,signal,selftest_14_of_14:pass,stdout,stderr});
 console.log(JSON.stringify({name,code,selftest_14_of_14:pass}));if(code!==0||pass===false)throw Error(name+'未通过');
}
const baseline=JSON.parse(fs.readFileSync(path.join(root,'baseline.json')));
const installed=path.join(process.env.HOME,'.claude/skills/dual-critic/scripts/trivium.cjs');
const repository=path.join(repo,'skills/dual-critic/scripts/trivium.cjs');
const marker=fs.readFileSync(installed,'utf8').match(/define_TRIVIUM_BUILD_default = (\{[^;]+\});/);
if(!marker)throw Error('安装构建标记缺失');
const embedded=JSON.parse(marker[1].replace(/([{,]\s*)([a-z_][a-z0-9_]*):/g,'$1"$2":'));
const stamp=await computeBuildStamp(repo);
const ledger=fs.readdirSync(path.join(root,'ledger/admission'));
const globalHash=hashFile(path.join(process.env.HOME,'.codex/config.toml'));
const authHash=hashFile(path.join(process.env.HOME,'.codex/auth.json'));
let scanned=0,candidates=0;
function scan(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,ent.name);if(ent.isDirectory())scan(file);else{scanned++;candidates+=scanSecrets(fs.readFileSync(file,'utf8')).length;}}}scan(root);
const final={observed_at:new Date().toISOString(),requested:baseline.requested,resolved_rows:baseline.resolved_rows,
 script_sha256:{launcher:hashFile(path.join(root,'launch.mjs')),checks:hashFile(path.join(root,'checks.mjs')),finalize:hashFile(path.join(root,'finalize.mjs'))},
 checks:checks.map(x=>({start:x.start,end:x.end,code:x.code,stats:x.stats})),
 selftest:'14/14',bundle_match:hashFile(repository)===hashFile(installed),installed_bundle_sha256:hashFile(installed),embedded_build:embedded,observed_build:stamp,
 budget:{reserved:ledger.filter(f=>f.startsWith('reserved-')).length,completed:ledger.filter(f=>f.startsWith('launch-')).length,limit:openBudget(root,'admission').limit(),formal_reviews:0},
 global_config_sha256:globalHash,global_stable_since_baseline:globalHash===baseline.global_config_sha256,
 auth_sha256:authHash,auth_stable_since_baseline:authHash===baseline.auth_sha256,
 scan:{files:scanned,candidates},software_version:JSON.parse(fs.readFileSync(path.join(repo,'package.json'))).version,
 runtime_model:null,runtime_provider:null,new_models_full_capability_admission:'未测',m11_precondition_complete:false,commit_push:false};
saveEvidence(path.join(root,'final.json'),final);
console.log(JSON.stringify({bundle_match:final.bundle_match,input_match:embedded.inputs_sha256===stamp.inputs_sha256,budget:final.budget,scan:final.scan,global_stable:final.global_stable_since_baseline}));
if(!final.bundle_match||embedded.inputs_sha256!==stamp.inputs_sha256||candidates)throw Error('最终核对未通过');
