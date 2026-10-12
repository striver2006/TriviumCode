/** 26B实施静态检查；真实子进程只用于本地检查，供应商启动0。 */
import fs from 'node:fs';import path from 'node:path';
import {run} from '../../../../dist/test/src/trivium/util/exec.js';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),before={bundle:hash('skills/dual-critic/scripts/trivium.cjs'),stamp:await computeBuildStamp(process.cwd())},runs=[];
for(const[name,bin,args]of [
 ['typecheck','npm',['run','typecheck']],['tests-only',process.execPath,['scripts/build.mjs','--tests-only']],
 ['mode3-tests',process.execPath,['--test',...['agent-access-inline-mode','agent-access-auth-chain-v2','agent-access-criteria-v3','agent-access-mode3-mechanism','agent-access-mode3-launch'].map(n=>'dist/test/test/unit/'+n+'.test.js'),'dist/test/test/contract/doc-archive-index.test.js']],
 ...fs.readdirSync(root).filter(n=>n.endsWith('.mjs')).map(n=>['syntax-'+n,process.execPath,['--check',root+'/'+n]]),
 ['diff-check','git',['-c','core.quotePath=false','diff','--check']]]){
 const r=await run(bin,args,{timeoutMs:120000,killTree:true}),record={name,code:r.code,timed_out:r.timedOut,stdout:r.stdout,stderr:r.stderr};runs.push(record);saveEvidence(root+'/mode3-check-'+name+'.json',record);if(r.code!==0||r.timedOut)throw Error(name+'验证失败');
}
const after={bundle:hash('skills/dual-critic/scripts/trivium.cjs'),stamp:await computeBuildStamp(process.cwd())};if(before.bundle!==after.bundle||before.stamp.inputs_sha256!==after.stamp.inputs_sha256)throw Error('独立检查改变生产作用面');
saveEvidence(root+'/mode3-current-checks.json',{at:new Date().toISOString(),script_sha256:hash(new URL(import.meta.url)),before,after,runs,new_vendor_starts:0,actual_mode3_started:false,full_npm_check_performed:false,criterion_adopted:false,earlier_verification_failures:[{kind:'typecheck',exit:2,cause:'新测试context过宽，已补精确交集类型'},{kind:'unit',pass:100,fail:2,cause:'模拟options数组共享引用与新Schema strictTypes缺项，已修正并102/102复核'}]});
console.log(JSON.stringify({checks:runs.map(r=>({name:r.name,code:r.code})),summary:runs.find(r=>r.name==='mode3-tests').stdout.split('\n').filter(l=>/^ℹ (tests|pass|fail|skipped)/.test(l)),bundle_unchanged:true,new_vendor_starts:0}));
