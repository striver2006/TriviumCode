/** 24B本轮独立资产检查；仅测试构建，不重打包或启动供应商CLI。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
import {run} from '../../../../dist/test/src/trivium/util/exec.js';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {approvalSchema,revocationSchema} from './criteria-contract.mjs';
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
saveEvidence(root+'/criteria-approval.v1.schema.json',approvalSchema);saveEvidence(root+'/criteria-revocation.v1.schema.json',revocationSchema);
const before={stamp:await computeBuildStamp(repo),bundle:hash(repo+'/skills/dual-critic/scripts/trivium.cjs'),installed:hash(path.join(process.env.HOME,'.claude/skills/dual-critic/scripts/trivium.cjs'))};
const runs=[];
for(const[name,bin,args]of [
 ['typecheck','npm',['run','typecheck']],
 ['tests-only-build',process.execPath,['scripts/build.mjs','--tests-only']],
 ['targeted-tests',process.execPath,['--test','dist/test/test/unit/agent-access-controlled-mechanism.test.js','dist/test/test/unit/agent-access-auth-applicability.test.js','dist/test/test/unit/agent-access-criteria-approval.test.js','dist/test/test/unit/agent-access-recovery.test.js','dist/test/test/contract/doc-archive-index.test.js']],
]){const r=await run(bin,args,{cwd:repo,timeoutMs:120000,killTree:true});runs.push({name,command:{bin,args},code:r.code,timed_out:r.timedOut,stdout:r.stdout,stderr:r.stderr});saveEvidence(root+'/diagnostic-check-'+name+'.json',runs.at(-1));if(r.code!==0||r.timedOut)throw Error(name+'失败，原始输出已保存');}
const after={stamp:await computeBuildStamp(repo),bundle:hash(repo+'/skills/dual-critic/scripts/trivium.cjs'),installed:hash(path.join(process.env.HOME,'.claude/skills/dual-critic/scripts/trivium.cjs'))};
if(before.stamp.inputs_sha256!==after.stamp.inputs_sha256||before.bundle!==after.bundle||before.installed!==after.installed)throw Error('只测试检查改变安装输入或bundle');
const budgetRoot=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/budget'),budgets=Object.fromEntries(['admission','review'].map(pool=>{const b=openBudget(budgetRoot,pool),names=fs.readdirSync(b.dir);return[pool,{reserved:names.filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed:names.filter(n=>/^launch-\d+\.json$/.test(n)).length,limit:b.limit()}];}));
if(budgets.admission.reserved!==732||budgets.review.reserved!==313)throw Error('零CLI检查期间供应商计数变化');
saveEvidence(root+'/approved-diagnostic-checks.json',{schema:'approved-diagnostic-checks.v1',script_sha256:hash(new URL(import.meta.url)),before,after,runs,budgets,new_vendor_starts:0,formal_code_review_started:false,independent_criterion_adopted:false});
console.log(JSON.stringify({checks:runs.map(r=>({name:r.name,code:r.code})),test_summary:runs.at(-1).stdout.split('\n').filter(l=>/^ℹ (tests|pass|fail|skipped)/.test(l)),budgets,install_inputs_unchanged:true,bundle_unchanged:true,new_vendor_starts:0}));
