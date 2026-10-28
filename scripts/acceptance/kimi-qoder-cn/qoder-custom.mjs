/** 真实Custom四臂，复用生产最小加载/隔离codec；采集成功不等于审核准入。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {compareSnapshots,checkAbsence} from './qoder-evidence.mjs';
const key=process.argv[2]?.replace(/^custom:/,'');
if(!key||!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(key))throw Error('须显式提供provider/modelID，不预设默认');
const repo=path.resolve(import.meta.dirname,'../../..'),source=path.join(os.homedir(),'.qoder-cn'),bin=path.join(os.homedir(),'.local/bin/qoderclicn');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'trivium-cn-custom-v2-'));await fs.chmod(temp,0o700);
const roots=new Set(),paths=new Map(),snapshots=new Map();
const evidence={schema:'trivium.native-acceptance.v1',source_kind:'real-model',at:new Date().toISOString(),project_root:repo,platform:process.platform,requested:key,admission:false,windows:'未测',environment_policy:'replace-v1',cases:[]};
let runtime,guard,selected,bytes,pinned,probe,positive,stage='prepare';
const safe=s=>guard?guard.scrub(s):s;
try{
  await build({stdin:{contents:"export {withQoderHome,qoderRun as run,prepareQoderReadonly} from './src/trivium/adapters/qoder-cn-native.ts';export {loadQoderCustom,installQoderCustom,extractQoderCodec,qoderCustomSource} from './src/trivium/adapters/qoder-cn-custom.ts';export {probeQoderCustom,QODER_MODEL_ARGS,QODER_REVIEW_ARGS} from './src/trivium/probes/qoder-cn.ts';export {QoderModelMonitor} from './src/trivium/adapters/qoder-cn-model.ts';export {defaultProbe} from './src/trivium/config.ts';export {admissionRouteBinding,admissionHash} from './src/trivium/admission.ts';export {observeTempDirs} from './src/trivium/util/fsx.ts';",resolveDir:repo},bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'runtime.cjs'),logLevel:'silent'});
  runtime=(await import(pathToFileURL(path.join(temp,'runtime.cjs')).href)).default;
  runtime.observeTempDirs({created:async p=>roots.add(p),removed:async()=>{}});
  const original=await runtime.qoderCustomSource();guard=original.guard;
  for(const [label,p] of [['settings.json',path.join(source,'settings.json')],['auth-user',path.join(source,'.auth/user')],['auth-machine',path.join(source,'.auth/machine_id')],['models-default',path.join(source,'.models/default')],['models-customs',original.file]]){paths.set(label,p);snapshots.set(label,hash(await fs.readFile(p)));}
  bytes=await fs.readFile(bin);pinned=path.join(temp,'qoder-native');await fs.writeFile(pinned,bytes,{mode:0o700,flag:'wx'});
  evidence.cli_sha256=hash(bytes);evidence.script_sha256=hash(await fs.readFile(import.meta.filename));
  evidence.secret_guard_source='src/trivium/adapters/qoder-cn-custom.ts';
  evidence.secret_guard_sha256=hash(await fs.readFile(path.join(repo,evidence.secret_guard_source)));
  evidence.environment_sources=Object.fromEntries(await Promise.all(['src/trivium/adapters/qoder-cn-native.ts','src/trivium/util/exec.ts'].map(async p=>[p,hash(await fs.readFile(path.join(repo,p)))])));
  stage='load';selected=await runtime.loadQoderCustom(pinned,key);guard.merge(selected.secrets);
  evidence.declaration={key,provider:selected.declaration.provider,model:selected.declaration.model,display_name:selected.declaration.display_name,source:'native-encrypted-customs',selected_records:1};
  evidence.codec={...selected.descriptor.codec,public_api:false,execution:'replace-env-child',transport:'ephemeral-aes-256-gcm'};
  stage='positive';
  probe=await runtime.probeQoderCustom(pinned,runtime.defaultProbe().cli.qoderclicn,key,observation=>{positive=observation;});
  const facts=structuredClone(probe.native_routes.find(f=>f.model==='custom:'+key));facts.entrypoint=bin;
  evidence.facts=facts;evidence.cli_version=facts.cli_version;evidence.binding_sha256=runtime.admissionRouteBinding({critic:'qoder-cn',project_root:repo,model:facts.model,native_model:{facts,requested:facts.model,override:'custom:'+key,origin:'diagnostic'}});
  const normalized=r=>({stdout:safe(r.stdout),stderr:safe(r.stderr),raw_exit_code:r.code,raw_signal:r.signal,timed_out:r.timedOut,early_stopped:r.earlyStopped,truncated:r.truncated,spawned:r.spawned,duration_ms:r.durationMs,command_line:r.commandLine});
  const legacy=r=>({...r,code:r.code,stdout:safe(r.stdout),stderr:safe(r.stderr)});
  const positiveObservation=normalized(positive.review);evidence.deny_paths_sha256=runtime.admissionHash([]);evidence.recipe_kind='review';
  evidence.cases.push({id:'positive',arm:'positive',check:'model-positive',positive:positiveObservation,candidate:positiveObservation,catalog:legacy(positive.catalog),out:legacy(positive.review),model_effective:null,provider_effective:null});
  const codec=runtime.extractQoderCodec(bytes);
  const mutation=String.raw`
import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
let s='';for await(const b of process.stdin)s+=b;
try{const x=JSON.parse(s),n=await import(pathToFileURL(x.module).href);await n.default({module_or_path:await fs.readFile(x.wasm)});
const machine=(await fs.readFile(path.join(x.config,'.auth/machine_id'),'utf8')).trim(),p=path.join(x.config,'.models',x.uid,'customs'),records=JSON.parse(n.model_cache_decrypt(await fs.readFile(p,'utf8'),machine));if(records.length!==1)throw Error();
if(x.arm==='invalid-key')records[0].parameters={api_key:'test_key_invalid_fixture'};
else {records[0].key=x.invalidKey;records[0].model=x.invalidKey.split('/')[1];}
await fs.writeFile(p,n.model_cache_encrypt(JSON.stringify(records),machine),{mode:0o600});
}catch{process.stderr.write('fixture mutation failed');process.exitCode=1;}
`;
  for(const arm of ['missing-config','invalid-key','invalid-model']){
    stage=arm;
    const invalidId='trivium-invalid-model-fixture',invalidKey=key.split('/')[0]+'/'+invalidId,requested=arm==='invalid-model'?invalidKey:key;
    const observation=await runtime.withQoderHome(async(home,config,env)=>{
      if(arm!=='missing-config'){
        await runtime.installQoderCustom(selected,config);
        const module=path.join(home,'codec.mjs'),wasm=path.join(home,'codec.wasm'),runner=path.join(home,'mutate.mjs');
        await fs.writeFile(module,codec.source,{mode:0o600,flag:'wx'});await fs.writeFile(wasm,codec.wasm,{mode:0o600,flag:'wx'});await fs.writeFile(runner,mutation,{mode:0o600,flag:'wx'});
        const changed=await runtime.run(process.execPath,[runner],{cwd:home,env,stdin:JSON.stringify({module,wasm,config,uid:selected.account.uid,arm,invalidKey}),timeoutMs:15000,killTree:true});
        if(changed.code!==0)throw Error('私有夹具变更失败');
      }
      const descriptor={...selected.descriptor,native_key:requested,selector:'custom:'+requested,model_id:requested.split('/')[1]};
      const monitor=new runtime.QoderModelMonitor(descriptor.selector,['Auto','Fast'],[],descriptor);
      let fallback=null;const begun=Date.now();
      const line=(s,channel)=>{monitor.line(s);if(monitor.failure&&!fallback)fallback={channel,elapsed_ms:Date.now()-begun,after_init:monitor.initLabel===descriptor.display_name||monitor.initLabel===descriptor.native_key,after_result:monitor.sawResult};};
      await runtime.prepareQoderReadonly(home,config,[],temp);
      const out=await runtime.run(pinned,['--config-dir',config,...runtime.QODER_REVIEW_ARGS,'--model',requested,'-p','Reply OK only.'],{cwd:temp,env,timeoutMs:180000,killTree:true,onStdoutLine:s=>line(s,'stdout'),onStderrLine:s=>line(s,'stderr')});
      for(const l of [...out.stdout.split(/\r?\n/),...out.stderr.split(/\r?\n/)])monitor.line(l);
      let verified=true;try{monitor.finish();}catch{verified=false;}
      return {out,fallback,orchestration_ok:verified&&out.code===0&&!out.timedOut&&!out.truncated&&!out.earlyStopped&&monitor.sawResult&&!monitor.resultError,model_failure:monitor.failure};
    });
    const candidate=normalized(observation.out);candidate.fallback_observation=observation.fallback;candidate.requested_native_key=requested;
    const check=arm==='missing-config'?'configuration-invalid':arm==='invalid-key'?'authentication-failed':'model-invalid';
    evidence.cases.push({id:arm,arm,check,positive:positiveObservation,candidate,out:legacy(observation.out),declaration_present:arm!=='missing-config',invalid_model_id:arm==='invalid-model'?invalidId:null,orchestration_ok:observation.orchestration_ok,model_failure:observation.model_failure,model_effective:null,provider_effective:null});
    console.log(JSON.stringify({arm,raw_exit_code:observation.out.code,orchestration_ok:observation.orchestration_ok,timed_out:observation.out.timedOut}));
  }
}catch(e){evidence.error={stage,name:e.name,message:['load','prepare'].includes(stage)?'原生准备失败，原文不输出':safe(e.message)};process.exitCode=1;}
finally{
  runtime?.observeTempDirs(null);
  const checked=await compareSnapshots(snapshots,label=>fs.readFile(paths.get(label)),hash);evidence.sources_unchanged=checked.unchanged;evidence.source_checks=checked.files;
  evidence.credentials_unchanged=checked.files.filter(x=>x.file.startsWith('auth-')).length===2&&checked.files.filter(x=>x.file.startsWith('auth-')).every(x=>x.unchanged===true);
  const removed=await checkAbsence(roots,p=>fs.stat(p));evidence.temporary_roots_removed=removed.absent;evidence.root_cleanup_checks=removed.files;
  try{await fs.rm(temp,{recursive:true,force:true});}catch(e){evidence.cleanup_error_code=e.code??'unknown';process.exitCode=1;}
  evidence.script_root_removed=(await checkAbsence([temp],p=>fs.stat(p))).absent;
  const dir=path.join(repo,'doc/05_testing/evidence/qoder-cn-admission-20261028');await fs.mkdir(dir,{recursive:true});
  const file=path.join(dir,'custom-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex')+'.json');
  safe(JSON.stringify(evidence));evidence.known_secret_found=guard?.leaked??null;
  await fs.writeFile(file,safe(JSON.stringify(evidence,null,2)).split(os.homedir()).join('~')+'\n',{flag:'wx',mode:0o600});
  if(guard?.leaked||checked.unchanged!==true||removed.absent!==true||evidence.script_root_removed!==true)process.exitCode=1;
  console.log(JSON.stringify({file,error:evidence.error,known_secret_found:evidence.known_secret_found,sources_unchanged:evidence.sources_unchanged,credentials_unchanged:evidence.credentials_unchanged,temporary_roots_removed:evidence.temporary_roots_removed,admission:false}));
}
