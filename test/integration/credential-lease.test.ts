/** 真实Node进程验证通用回收协议；不冒充厂商CLI的生命周期准入。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {reapQoderUnscopedCredentials} from '../../src/trivium/adapters/qoder-cn-native.js';
import {reapCredentialLeases} from '../../src/trivium/util/credential-lease.js';
import {processGroupMemberCount} from '../../src/trivium/util/exec.js';
import {AGENTS} from '../../src/trivium/agents/registry.js';
import {qoderCnAdapter} from '../../src/trivium/adapters/qoder-cn.js';
import {defaultConfig} from '../../src/trivium/config.js';
import {scrubAllRunRoot,pruneRunDirs} from '../../src/trivium/retention.js';
import {REPO_ROOT} from '../helpers/fixture.js';
import {scratchDir} from '../helpers/scratch.js';
const agent=AGENTS.find(a=>a.admissionChecks?.length)!.id;
const skip=process.platform==='win32';

for(const sideDir of ['fixture-side',null])test('两进程强杀后租约仍在，活CLI组阻止删除，退出后按私有标记回收 '+String(sideDir),{skip,timeout:30000},async()=>{
  const root=await fs.realpath(await scratchDir('trivium-lease-test-')),leases=path.join(root,'leases'),home=await fs.realpath(await scratchDir('trivium-lease-home-'));
  const bundle=path.join(root,'actor.cjs');let pgid:number|undefined;
  const contents=`import {withCredentialLeaseScope,registerCredentialLease,trackCredentialRun} from './src/trivium/util/credential-lease.ts';import {run,trackedTrees} from './src/trivium/util/exec.ts';import {promises as fs} from 'node:fs';
    withCredentialLeaseScope(${JSON.stringify(sideDir)},async()=>{await registerCredentialLease(${JSON.stringify(home)},${JSON.stringify(agent)});await fs.writeFile(${JSON.stringify(path.join(home,'fake-auth'))},'FIXTURE_ONLY',{mode:384});const p=trackCredentialRun(${JSON.stringify(home)},()=>run(process.execPath,['-e','setInterval(()=>{},1000)'],{killTree:true,timeoutMs:60000}));setTimeout(()=>console.log(JSON.stringify({pgid:trackedTrees()[0]?.pgid})),200);await p;},${JSON.stringify(leases)});`;
  await build({stdin:{contents,resolveDir:REPO_ROOT},bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
  const actor=spawn(process.execPath,[bundle],{stdio:['ignore','pipe','pipe'],windowsHide:true});let stderr='';actor.stderr.on('data',d=>{stderr+=String(d);});
  try{
    const ready=await new Promise<{pgid:number}>((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('actor readiness timeout '+stderr)),5000);actor.stdout.on('data',d=>{out+=String(d);if(out.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(out.trim()));}catch(e){reject(e);}}});actor.on('error',reject);});
    pgid=ready.pgid;assert.ok(pgid>0);
    const dead=new Promise<void>(resolve=>actor.once('exit',()=>resolve()));actor.kill('SIGKILL');await dead;
    const manifests=await fs.readdir(leases);assert.equal(manifests.length,1);
    const manifest=JSON.parse(await fs.readFile(path.join(leases,manifests[0]!),'utf8'));assert.equal(manifest.groups[0].pgid,pgid);assert.ok(manifest.groups[0].started_at);assert.doesNotMatch(JSON.stringify(manifest),/FIXTURE_ONLY/);
    const cleanup=(p:string)=>fs.rm(p,{recursive:true,force:true});
    const blocked=await reapCredentialLeases(agent,sideDir,cleanup,leases);assert.equal(blocked.deleted.length,0);assert.match(blocked.errors.join(),/尚未确认全部退出/);assert.equal(await fs.readFile(path.join(home,'fake-auth'),'utf8'),'FIXTURE_ONLY');
    process.kill(-pgid,'SIGTERM');for(let i=0;i<100&&await processGroupMemberCount(pgid)!==0;i++)await new Promise(r=>setTimeout(r,20));
    assert.equal(await processGroupMemberCount(pgid),0);
    // 标记不符时不能删，即使所有进程已退出。
    const marker=path.join(home,'.trivium-credential-lease'),original=await fs.readFile(marker);await fs.writeFile(marker,'{}');
    assert.match((await reapCredentialLeases(agent,sideDir,cleanup,leases)).errors.join(),/标记不符/);await fs.writeFile(marker,original);
    const reaped=sideDir===null?await reapQoderUnscopedCredentials(leases):await reapCredentialLeases(agent,sideDir,cleanup,leases);assert.deepEqual(reaped.errors,[]);assert.equal(reaped.deleted.length,1);assert.equal((await fs.readdir(leases)).length,0);await assert.rejects(fs.lstat(home),{code:'ENOENT'});
  }finally{actor.kill('SIGKILL');if(pgid)try{process.kill(-pgid,'SIGKILL');}catch{}await fs.rm(home,{recursive:true,force:true});await fs.rm(root,{recursive:true,force:true});}
});

test('没有运行目录也会调用无运行侧回收；dry-run不回收、失败可见',async()=>{
  const root=await scratchDir('trivium-unscoped-retention-'),cfg=defaultConfig();cfg.runtime.run_root=path.join(root,'absent');let calls=0;
  const adapter={...qoderCnAdapter,scrubUnscoped:async()=>{calls++;return {deleted:['fixture-lease'],errors:['fixture cleanup failure']};}};
  const lookup=(id:string)=>id===agent?adapter:undefined;
  const sweep=await scrubAllRunRoot(cfg,{adapters:lookup});assert.equal(calls,1);assert.equal(sweep.externalCredentials![0]!.deleted,1);assert.match(sweep.scrubFailed[0]!.reason,/fixture cleanup failure/);
  await scrubAllRunRoot(cfg,{adapters:lookup,dryRun:true});assert.equal(calls,1);
  await pruneRunDirs(cfg,root,{adapters:lookup});assert.equal(calls,2);
});
