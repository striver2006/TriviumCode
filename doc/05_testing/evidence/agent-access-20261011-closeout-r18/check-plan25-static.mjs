/** 第25次计划审查前零CLI检查；保留旧资产，不重打包运行时。 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {run} from '../../../../dist/test/src/trivium/util/exec.js';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname);
const frozen=JSON.parse(fs.readFileSync(root+'/r17-preserved-snapshot.json','utf8'));
function snapshot(){return {bundle:hash(repo+'/skills/dual-critic/scripts/trivium.cjs'),installed:hash(process.env.HOME+'/.claude/skills/dual-critic/scripts/trivium.cjs')};}
const before={...snapshot(),stamp:await computeBuildStamp(repo)},runs=[];
for(const[name,bin,args]of [
 ['typecheck','npm',['run','typecheck']],
 ['tests-only-build',process.execPath,['scripts/build.mjs','--tests-only']],
 ['targeted-tests',process.execPath,['--test','dist/test/test/unit/agent-access-controlled-mechanism.test.js','dist/test/test/unit/agent-access-auth-applicability.test.js','dist/test/test/unit/agent-access-criteria-approval.test.js','dist/test/test/unit/agent-access-recovery.test.js','dist/test/test/contract/doc-archive-index.test.js']],
]){
 const result=await run(bin,args,{cwd:repo,timeoutMs:120000,killTree:true});
 const record={name,bin,args,code:result.code,timed_out:result.timedOut,stdout:result.stdout,stderr:result.stderr};runs.push(record);
 saveEvidence(root+'/static-check-'+name+'.json',record);
 if(record.code!==0||record.timed_out)throw Error(name+'失败，已保存原始结果');
}
const after={...snapshot(),stamp:await computeBuildStamp(repo)};
if(before.bundle!==after.bundle||before.installed!==after.installed||before.stamp.inputs_sha256!==after.stamp.inputs_sha256)throw Error('运行时或安装输入变化');
const {openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs');
const budgets=Object.fromEntries(['admission','review'].map(pool=>{const b=openBudget(process.env.HOME+'/.trivium/evidence/agent-access-20261011-closeout-r3/budget',pool),files=fs.readdirSync(b.dir);return [pool,{reserved:files.filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed:files.filter(n=>/^launch-\d+\.json$/.test(n)).length,limit:b.limit()}];}));
if(budgets.admission.reserved!==732||budgets.review.reserved!==313)throw Error('零CLI检查期间启动数变化');
saveEvidence(root+'/static-checks.json',{script_sha256:hash(new URL(import.meta.url)),before,after,runs,budgets,preserved_snapshot_ref:hash(root+'/r17-preserved-snapshot.json'),preserved_snapshot_shape:Object.keys(frozen),new_vendor_starts:0,full_npm_check_performed:false,new_review_started:false});
console.log(JSON.stringify({checks:runs.map(r=>({name:r.name,code:r.code})),test_summary:runs.at(-1).stdout.split('\n').filter(l=>/^ℹ (tests|pass|fail|skipped)/.test(l)),budgets,bundle_unchanged:true,install_inputs_unchanged:true,new_vendor_starts:0}));
