/** 定向验证24B已批准的授权测试和规范；不重建/安装CLI、不启动供应商。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
const root=path.dirname(new URL(import.meta.url).pathname);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const bundle='skills/dual-critic/scripts/trivium.cjs',before={stamp:await computeBuildStamp(process.cwd()),bundle_sha256:hash(bundle)};
async function run(bin,args){const r=await new Promise((resolve,reject)=>{const p=spawn(bin,args,{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('close',(code,signal)=>resolve({bin,args,code,signal,stdout,stderr}));});return r;}
const checks=await Promise.all([run('npm',['run','typecheck']),run(process.execPath,['scripts/build.mjs','--tests-only'])]);
if(checks.every(c=>c.code===0))checks.push(await run(process.execPath,['--test','dist/test/test/unit/agent-access-recovery.test.js','dist/test/test/contract/doc-archive-index.test.js','dist/test/test/contract/evolution-ledger-parity.test.js']));
const after={stamp:await computeBuildStamp(process.cwd()),bundle_sha256:hash(bundle)};
const unchanged=before.bundle_sha256===after.bundle_sha256&&before.stamp.inputs_sha256===after.stamp.inputs_sha256;
saveEvidence(root+'/authority-and-doc-checks.json',{at:new Date().toISOString(),script_sha256:hash(new URL(import.meta.url)),before,after,unchanged_install_inputs_and_bundle:unchanged,checks,current_full_check:'未执行；完整夹具/诊断实施完后按影响范围检查',new_vendor_starts:0,criteria_change_authorized:false});
console.log(JSON.stringify({checks:checks.map(c=>({args:c.args,code:c.code,summary:c.stdout.split('\n').filter(l=>/^ℹ (tests|pass|fail|skipped)/.test(l))})),unchanged_install_inputs_and_bundle:unchanged,new_vendor_starts:0}));
if(checks.some(c=>c.code!==0)||!unchanged)process.exitCode=1;
