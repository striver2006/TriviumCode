/** 待具名授权，仅Bob系统终端操作新副本的两个目标。绝不作用于原工程。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {here,read,hash,digest,inventory,budget,verifyAnchors,authorization,fixture,assertSameExcept,saveEvidence} from './common.mjs';
const action=process.argv[2];assert.equal(process.argv.length,3);
assert(['missing','restore-missing','changed','restore-changed'].includes(action));
const p=read(here+'/preparation.json'),cwd=fixture(p,'archive');
const restore=action.startsWith('restore-'),kind=action.replace('restore-','');
const rel=p.targets[kind],target=cwd+'/'+rel,backup=p.root+'/backup/'+rel;
const baseline=read(here+'/setup-archive-after.json').files,expected=baseline.find(x=>x.path===rel);assert(expected);
assert.equal(hash(backup),expected.sha256);assert.equal(fs.statSync(backup).mode&0o777,expected.mode);
const suffix=Buffer.from('\n<!-- M11 S5 isolated content-change control 20261016-01 -->\n');
const modified=Buffer.concat([fs.readFileSync(backup),suffix]),held=p.root+'/removed-review';
if(!restore) {
 authorization(here+'/client-authorization.json','s5-client');verifyAnchors(p);
 assert(read(here+'/checkpoint-baseline-after.json').structurally_ready,'新夹具健康前置不足');
 if(kind==='changed')assert(read(here+'/checkpoint-restored-missing-after.json').structurally_ready,'缺件恢复尚未核对');
 assert.deepEqual(inventory(cwd),baseline);assert.equal(hash(target),expected.sha256);
}else{
 assert(fs.existsSync(here+'/operation-'+kind+'-after.json'),'没有本批故障注入记录');
 if(kind==='missing'){assert(!fs.existsSync(target));assert.equal(hash(held),expected.sha256);}
 else assert.equal(hash(target),digest(modified),'目标不是本批预期改件；拒绝覆盖未知变更');
}
const before=inventory(cwd);assertSameExcept(baseline,before,[rel]);
saveEvidence(here+'/operation-'+action+'-before.json',{at:new Date().toISOString(),action,cwd,target:rel,files:before,budget:budget(),expected_sha256:expected.sha256});
if(action==='missing'){
 assert(!fs.existsSync(held));fs.renameSync(target,held);
}else if(action==='restore-missing')fs.renameSync(held,target);
else if(action==='changed')fs.appendFileSync(target,suffix);
else {fs.copyFileSync(backup,target);fs.chmodSync(target,expected.mode);}
const after=inventory(cwd);assertSameExcept(baseline,after,[rel]);
if(restore)assert.deepEqual(after,baseline);
else if(kind==='missing')assert(!fs.existsSync(target));
else assert.equal(hash(target),digest(modified));
saveEvidence(here+'/operation-'+action+'-after.json',{at:new Date().toISOString(),action,cwd,target:rel,files:after,
 actual_sha256:fs.existsSync(target)?hash(target):null,expected_original_sha256:expected.sha256,
 expected_changed_sha256:kind==='changed'?digest(modified):null,restored:restore,budget:budget(),
 scope:'仅系统终端故障状态记录；不证明客户端拦截/放行'});
console.log(JSON.stringify({action,restored:restore,next:restore?'只读核对后再触发恢复对照':'先检查点，再一次具名客户端Bash；异常停止并恢复'}));
