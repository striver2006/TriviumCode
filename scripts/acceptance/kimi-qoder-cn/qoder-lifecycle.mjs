/** 原生CLI诊断生命周期；不冒充尚未准入的生产三审worker。 */
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {build} from 'esbuild';import {pathToFileURL} from 'node:url';
import {compareSnapshots,checkAbsence} from './qoder-evidence.mjs';
import {collectCredentialValues,secretGuard} from './qoder-secrets.mjs';
const model=process.argv[2];if(!model||!/^[A-Za-z0-9_.-]+$/.test(model))throw Error('须显式提供官方模型');
const repo=path.resolve(import.meta.dirname,'../../..'),source=path.join(os.homedir(),'.qoder-cn'),bin=path.join(os.homedir(),'.local/bin/qoderclicn');
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'trivium-cn-lifecycle-'));await fs.chmod(tmp,0o700);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),roots=new Set(),snapshots=new Map(),known=[],guard=secretGuard(known,s=>r?.redactSecrets(s).content??s);
const e={at:new Date().toISOString(),platform:process.platform,admission:false,scope:'native-cli-diagnostic-supervisor-not-production-review-worker',windows:'未测',model_requested:model,cases:[],script_sha256:hash(await fs.readFile(import.meta.filename))};let r;
try{
  for(const name of ['settings.json','.auth/user','.auth/machine_id']){const bytes=await fs.readFile(path.join(source,name));snapshots.set(name,hash(bytes));if(name.startsWith('.auth/'))collectCredentialValues(bytes.toString(),known,{skipped_metadata:0});}
  await build({stdin:{contents:"export {withQoderHome,qoderRun as run} from './src/trivium/adapters/qoder-cn-native.ts';export {withCredentialLeaseScope} from './src/trivium/util/credential-lease.ts';export {watchTrackedTrees,trackedTrees,withTreeTag,processMatchesRecord,processGroupMemberCount} from './src/trivium/util/exec.ts';export {observeTempDirs} from './src/trivium/util/fsx.ts';export {redactSecrets} from './src/trivium/secrets.ts';export {QODER_MODEL_ARGS} from './src/trivium/probes/qoder-cn.ts';",resolveDir:repo},bundle:true,platform:'node',format:'cjs',outfile:path.join(tmp,'runtime.cjs'),logLevel:'silent'});
  r=(await import(pathToFileURL(path.join(tmp,'runtime.cjs')).href)).default;r.observeTempDirs({created:async p=>roots.add(p),removed:async()=>{}});
  const bytes=await fs.readFile(bin),pinned=path.join(tmp,'qoder-native');await fs.writeFile(pinned,bytes,{mode:0o700,flag:'wx'});e.cli_sha256=hash(bytes);
  for(const arm of ['start-failure','timeout','cancel','force-kill']){
    const groups=new Map();const unwatch=r.watchTrackedTrees(()=>{for(const t of r.trackedTrees())if(t.tag===arm)groups.set(t.pgid,t);});let stopReason=null;
    try{
      const result=await r.withCredentialLeaseScope(null,()=>r.withQoderHome(async(home,config,env)=>{
        const version=await r.run(pinned,['--version'],{cwd:home,env,timeoutMs:15000,killTree:true});e.cli_version=version.stdout.trim();
        let timer;
        try{return await r.withTreeTag(arm,()=>r.run(arm==='start-failure'?path.join(home,'nonexistent-cli'):pinned,['--config-dir',config,...r.QODER_MODEL_ARGS,'--model',model,'-p','Think through a long harmless arithmetic exercise before replying OK. Do not use tools.'],{
          cwd:home,env,killTree:true,timeoutMs:arm==='timeout'?1500:30000,killGraceMs:500,
          stopEarly:stop=>{if(arm==='cancel')timer=setTimeout(()=>{stopReason='cancelled';stop();},1500);if(arm==='force-kill')timer=setTimeout(async()=>{const t=r.trackedTrees().find(x=>x.tag===arm);if(!t?.startedAt){stopReason='identity-unverified';stop();return;}const identity=await r.processMatchesRecord(t.pgid,{canonical:t.startedAt,legacy:null});if(identity.sameProcess){stopReason='diagnostic-forced-kill';try{process.kill(-t.pgid,'SIGKILL');}catch{stopReason='kill-failed';}}else{stopReason='identity-unverified';stop();}},1500);}
        }));}finally{clearTimeout(timer);}
      }),path.join(tmp,'leases'));
      const process_checks=[];for(const t of groups.values()){const count=await r.processGroupMemberCount(t.pgid);process_checks.push({pgid:t.pgid,started_at:t.startedAt,members_after:count,exited:count===0});}
      e.cases.push({arm,raw_exit_code:result.code,raw_signal:result.signal,timed_out:result.timedOut,early_stopped:result.earlyStopped,spawned:result.spawned,orchestration_reason:stopReason,duration_ms:result.durationMs,stdout:guard.scrub(result.stdout),stderr:guard.scrub(result.stderr),process_checks});
      console.log(JSON.stringify({arm,code:result.code,signal:result.signal,timed_out:result.timedOut,reason:stopReason,groups_exited:process_checks.every(x=>x.exited)}));
    }finally{unwatch();}
  }
}catch(err){e.error=guard.scrub(err.message);process.exitCode=1;}
finally{
  r?.observeTempDirs(null);e.source_checks=(await compareSnapshots(snapshots,n=>fs.readFile(path.join(source,n)),hash)).files;e.sources_unchanged=e.source_checks.every(x=>x.unchanged===true);e.credentials_unchanged=e.source_checks.filter(x=>x.file.startsWith('.auth/')).every(x=>x.unchanged===true);
  const clean=await checkAbsence(roots,p=>fs.stat(p));e.temporary_roots_removed=clean.absent;e.cleanup_checks=clean.files;
  e.lease_files_remaining=await fs.readdir(path.join(tmp,'leases')).catch(err=>err.code==='ENOENT'?[]:Promise.reject(err));
  await fs.rm(tmp,{recursive:true,force:true});e.script_root_removed=(await checkAbsence([tmp],p=>fs.stat(p))).absent;
  guard.scrub(JSON.stringify(e));e.known_secret_found=guard.leaked;const out=path.join(repo,'doc/05_testing/evidence/qoder-cn-admission-20261028','lifecycle-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex')+'.json');await fs.writeFile(out,guard.scrub(JSON.stringify(e,null,2)).split(os.homedir()).join('~')+'\n',{mode:0o600,flag:'wx'});
  if(guard.leaked||!e.sources_unchanged||!clean.absent||e.lease_files_remaining.length)process.exitCode=1;console.log(JSON.stringify({file:out,admission:false,temporary_roots_removed:clean.absent,known_secret_found:guard.leaked}));
}
