/** 25B批准后的独立资产检查；不重打包、不启动供应商，全部结果独立追加。 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {loadCtx} from '../../../../dist/test/src/trivium/config.js';import {getGate} from '../../../../dist/test/src/trivium/state.js';
import {run} from '../../../../dist/test/src/trivium/util/exec.js';import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';import {hash} from '../../../../scripts/agent-access-selection.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口',ctx=await loadCtx(),gate=await getGate(ctx.triviumDir,topic,'plan');
const checkpoint=JSON.parse(fs.readFileSync(root+'/plan25-approved-checkpoint.json','utf8'));
if(gate?.run_id!==checkpoint.run_id||gate.state!=='approved'||hash(checkpoint.final.path)!==checkpoint.final.sha256)throw Error('有效25B批准/定稿漂移');
const {openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs');
const budgets=()=>Object.fromEntries(['admission','review'].map(pool=>{const b=openBudget(os.homedir()+'/.trivium/evidence/agent-access-20261011-closeout-r3/budget',pool),names=fs.readdirSync(b.dir);return[pool,{reserved:names.filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed:names.filter(n=>/^launch-\d+\.json$/.test(n)).length,limit:b.limit()}];}));
const snapshot=async()=>({bundle:hash(repo+'/skills/dual-critic/scripts/trivium.cjs'),installed:hash(os.homedir()+'/.claude/skills/dual-critic/scripts/trivium.cjs'),stamp:await computeBuildStamp(repo),budgets:budgets()});
const before=await snapshot(),runs=[];
for(const[name,bin,args]of [
 ['fixture-syntax',process.execPath,['--check',root+'/controlled-fixture-v2.mjs']],
 ['typecheck','npm',['run','typecheck']],
 ['tests-only-build',process.execPath,['scripts/build.mjs','--tests-only']],
 ['targeted-tests',process.execPath,['--test','dist/test/test/unit/agent-access-controlled-runtime.test.js','dist/test/test/unit/agent-access-controlled-mechanism.test.js','dist/test/test/unit/agent-access-auth-applicability.test.js','dist/test/test/unit/agent-access-criteria-approval.test.js','dist/test/test/unit/agent-access-recovery.test.js','dist/test/test/contract/doc-archive-index.test.js']],
]){
 const result=await run(bin,args,{cwd:repo,timeoutMs:120000,killTree:true}),record={name,bin,args,code:result.code,timed_out:result.timedOut,stdout:result.stdout,stderr:result.stderr};runs.push(record);saveEvidence(root+'/mode2-static-'+name+'.json',record);
 if(record.code!==0||record.timed_out)throw Error(name+'失败，原始结果已保存');
}
const after=await snapshot();if(before.bundle!==after.bundle||before.installed!==after.installed||before.stamp.inputs_sha256!==after.stamp.inputs_sha256||JSON.stringify(before.budgets)!==JSON.stringify(after.budgets))throw Error('零CLI检查中运行时/安装输入/额度变化');
const preserved=JSON.parse(fs.readFileSync(root+'/r18-preserved-snapshot.json','utf8'));for(const[p,h]of Object.entries(preserved.hashes))if(hash(path.join(preserved.root,p))!==h)throw Error('r18历史变化');
saveEvidence(root+'/mode2-static-checks.json',{at:new Date().toISOString(),script_sha256:hash(new URL(import.meta.url)),before,after,runs,asset_hashes:Object.fromEntries(['controlled-fixture-v2.mjs','controlled-mechanism.mjs','controlled-runtime.mjs'].map(p=>[p,hash(root+'/'+p)])),preserved_r18:true,new_vendor_starts:0,full_npm_check_performed:false,mechanism_pilot_started:false,prerequisite_complete:false});
console.log(JSON.stringify({checks:runs.map(r=>({name:r.name,code:r.code})),test_summary:runs.at(-1).stdout.split('\n').filter(l=>/^(ℹ |# )(tests|pass|fail|skipped)/.test(l)),budgets:after.budgets,bundle_unchanged:true,installation_inputs_unchanged:true,new_vendor_starts:0}));
