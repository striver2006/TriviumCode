/** 调生产探针/路由/真实适配器的 macOS 取证。故障只在本脚本直调 invoke 边界。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const repo=path.resolve(import.meta.dirname,'../../..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'trivium-cn-accept-'));
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const userSettings=path.join(os.homedir(),'.qoder-cn/settings.json');
const before=hash(await fs.readFile(userSettings));
const created=new Set(),removed=new Set();
const evidence={at:new Date().toISOString(),platform:process.platform,settings_before:before,cases:[],windows:'未测'};
let runtime;
try {
  await build({stdin:{contents:`export {defaultConfig} from './src/trivium/config.ts';
export {probeQoderCn} from './src/trivium/probes/qoder-cn.ts';
export {qoderCnAdapter,invokeQoderModel} from './src/trivium/adapters/qoder-cn.ts';
export {resolveConfiguredTier} from './src/trivium/model-routing.ts';
export {observeTempDirs} from './src/trivium/util/fsx.ts';
export {redactSecrets} from './src/trivium/secrets.ts';`,resolveDir:repo},bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'runtime.cjs'),logLevel:'silent'});
  runtime=(await import(pathToFileURL(path.join(temp,'runtime.cjs')).href)).default;
  runtime.observeTempDirs({created:async p=>created.add(p),removed:async p=>removed.add(p)});
  const cfg=runtime.defaultConfig();
  cfg.probe.cli.qoderclicn=await runtime.probeQoderCn(null,cfg.probe.cli.qoderclicn);
  evidence.facts=cfg.probe.cli.qoderclicn.native_default;
  const facts=evidence.facts;
  for(const profile of ['default','flash','pro']) {
    cfg.active_profile=profile;cfg.profiles[profile]??={};
    evidence.cases.push({name:`profile-${profile}`,route:runtime.resolveConfiguredTier(cfg,'qoder-cn','plan')});
  }
  // 证明项目/本地模型不会被 --setting-sources user 合并。
  await fs.mkdir(path.join(temp,'.qoder'));
  for(const name of ['settings.json','settings.local.json'])await fs.writeFile(path.join(temp,'.qoder',name),JSON.stringify({model:{name:'trivium-project-invalid'}}));
  const req={run_id:'acceptance',topic:'模型路由取证',stage:'plan',critic:'qoder-cn',project_root:temp,subject_path:'',deny_paths:[],
    out_dir:path.join(temp,'out'),brief_path:'',brief_text:'Reply OK only.',timeout_s:90,schema_path:'',min_tool_calls:0,min_project_reads:0,
    profile_requested:null,tier:null,tier_source:'probe_default'};
  const selected=process.argv.slice(2).find(x=>!x.startsWith('--'))??facts.models.find(x=>!facts.route_labels.includes(x));
  for(const [name,model,origin] of [['default','Auto','probe_default'],['explicit',selected,'cli'],['invalid-before-spawn','trivium-invalid-model','cli']]) {
    try {
      const native=runtime.qoderCnAdapter.nativeModelFor(cfg,model,origin);
      const result=await runtime.qoderCnAdapter.run({cfg,nodePath:process.execPath},{...req,model:native.requested,native_model:native});
      evidence.cases.push({name,result,stdout:await fs.readFile(result.raw_stdout_path,'utf8')});
      console.log(JSON.stringify({name,status:result.status,exit_code:result.exit_code,native_model:result.native_model,model_effective:result.model_effective}));
    }catch(e){evidence.cases.push({name,error:e.message,process_started:false});console.log(JSON.stringify({name,error:e.message,process_started:false}));}
  }
  if(process.argv.includes('--native-config')) {
    const shadow=path.join(temp,'native-source');await fs.mkdir(path.join(shadow,'.auth'),{recursive:true,mode:0o700});
    const previous=process.env.QODERCN_CONFIG_DIR;
    const originalRoot=previous??path.join(os.homedir(),'.qoder-cn');
    for(const name of ['user','machine_id'])await fs.writeFile(path.join(shadow,'.auth',name),await fs.readFile(path.join(originalRoot,'.auth',name)),{mode:0o600});
    await fs.writeFile(path.join(shadow,'settings.json'),JSON.stringify({model:{name:selected}}),{mode:0o600});
    try {
      process.env.QODERCN_CONFIG_DIR=shadow;
      const configured=await runtime.probeQoderCn(null,cfg.probe.cli.qoderclicn);
      const configCfg={...cfg,probe:{...cfg.probe,cli:{...cfg.probe.cli,qoderclicn:configured}}};
      const native=runtime.qoderCnAdapter.nativeModelFor(configCfg,configured.native_default.model,'probe_default');
      const result=await runtime.qoderCnAdapter.run({cfg:configCfg,nodePath:process.execPath},{...req,model:native.requested,native_model:native});
      evidence.cases.push({name:'native-config-default',facts:configured.native_default,result});
      console.log(JSON.stringify({name:'native-config-default',source:configured.native_default.source,model:configured.native_default.model,status:result.status}));
    } finally {if(previous===undefined)delete process.env.QODERCN_CONFIG_DIR;else process.env.QODERCN_CONFIG_DIR=previous;}
  }
  const invalid={facts,requested:'trivium-invalid-model',override:'trivium-invalid-model',origin:'acceptance-fault'};
  const failure=await runtime.invokeQoderModel({request:invalid,cwd:temp,prompt:'Reply OK only.',timeoutMs:90000});
  evidence.cases.push({name:'runtime-fallback-current-cli',...failure});
  console.log(JSON.stringify({name:'runtime-fallback-current-cli',ok:failure.ok,earlyStopped:failure.outcome.earlyStopped,evidence:failure.evidence}));
} catch(e) {evidence.error=e.message;process.exitCode=1;}
finally {
  runtime?.observeTempDirs(null);
  evidence.settings_after=hash(await fs.readFile(userSettings));
  evidence.settings_unchanged=evidence.settings_after===before;
  evidence.temporary_auth_removed=await Promise.all([...created].map(async p=>!(await fs.stat(p).then(()=>true,()=>false)))).then(xs=>xs.every(Boolean));
  evidence.cleanup_observed={created:created.size,removed:removed.size};
  const safe=x=>runtime?runtime.redactSecrets(x).content:x;
  const root=path.join(repo,'doc/05_testing/evidence/qoder-cn-model-20261028');await fs.mkdir(root,{recursive:true});
  const file=path.join(root,`adapter-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}.json`);
  await fs.writeFile(file,safe(JSON.stringify(evidence,null,2)).split(os.homedir()).join('~')+'\n',{flag:'wx',mode:0o600});
  await fs.rm(temp,{recursive:true,force:true});
  console.log(JSON.stringify({file,settings_unchanged:evidence.settings_unchanged,temporary_auth_removed:evidence.temporary_auth_removed,error:evidence.error}));
}
