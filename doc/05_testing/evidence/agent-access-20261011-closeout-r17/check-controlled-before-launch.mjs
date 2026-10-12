/** 零供应商启动：测试专用构建、typecheck和受控guard回归原输出。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {run} from '../../../../dist/test/src/trivium/util/exec.js';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before={bundle_sha256:hash('skills/dual-critic/scripts/trivium.cjs'),stamp:await computeBuildStamp(process.cwd())};
saveEvidence(root+'/controlled-initial-zero-cli-failures.json',{observed_tool_chunks:['de086f','16382c'],type:'tool-output-summary-only',initial_tests:{pass:32,fail:1,cause:'模拟终态只有structured_output，生产finalReviewText实际消费result字符串；fixture修正，不改生产解析'},typecheck:{code:2,cause:'Ajv2020默认导入不是构造类型，改仓库现有具名导入'},full_initial_stdout_retained:false,new_vendor_starts:0});
const checks=await Promise.all([run('npm',['run','typecheck'],{timeoutMs:120000,killTree:true}),run(process.execPath,['scripts/build.mjs','--tests-only'],{timeoutMs:120000,killTree:true})]);
if(checks.every(c=>c.code===0))checks.push(await run(process.execPath,['--test','dist/test/test/unit/agent-access-controlled-mechanism.test.js','dist/test/test/unit/agent-access-recovery.test.js'],{timeoutMs:120000,killTree:true}));
const after={bundle_sha256:hash('skills/dual-critic/scripts/trivium.cjs'),stamp:await computeBuildStamp(process.cwd())},unchanged=before.bundle_sha256===after.bundle_sha256&&before.stamp.inputs_sha256===after.stamp.inputs_sha256;
saveEvidence(root+'/controlled-before-launch-checks.json',{at:new Date().toISOString(),script_sha256:hash(new URL(import.meta.url)),before,after,unchanged,checks,new_vendor_starts:0,simulation_not_capability_evidence:true});
console.log(JSON.stringify({checks:checks.map(c=>({code:c.code,timedOut:c.timedOut,summary:c.stdout.split('\n').filter(l=>/^ℹ (tests|pass|fail|skipped)/.test(l))})),unchanged}));if(!unchanged||checks.some(c=>c.code!==0))process.exitCode=1;
