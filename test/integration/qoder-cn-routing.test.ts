/** 真实执行适配器与隔离重打包 worker；所有模型/认证均为本地合成夹具。 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {defaultConfig,defaultProbe} from '../../src/trivium/config.js';
import {qoderCnAdapter,invokeQoderModel} from '../../src/trivium/adapters/qoder-cn.js';
import {parseQoderCatalog,qoderHash,qoderModelRequest} from '../../src/trivium/adapters/qoder-cn-model.js';
import {QODER_MODEL_ARGS,QODER_REVIEW_ARGS,probeQoderCn} from '../../src/trivium/probes/qoder-cn.js';
import {stopQoderHomeHelpers,withQoderHome,qoderRun,checkQoderBinding} from '../../src/trivium/adapters/qoder-cn-native.js';
import {run} from '../../src/trivium/util/exec.js';
import {extractJsonCandidate} from '../../src/trivium/parse.js';
import {admissionRouteBinding} from '../../src/trivium/admission.js';
import {copyProductionTree,linkDependencies} from '../fixtures/stub-agent-kit/overlay.js';
import {REPO_ROOT,makeFixture} from '../helpers/fixture.js';
import {scratchDir} from '../helpers/scratch.js';
import type {CriticRequest,NativeModelFacts} from '../../src/trivium/types.js';
const skip=process.platform==='win32';
let root='',source='',kit='';
const oldSource=process.env['QODERCN_CONFIG_DIR'];
const created:string[]=[];
before(async()=>{
  if(skip)return;
  root=await fs.realpath(await scratchDir('trivium-cn-test-'));
  source=path.join(root,'source');await fs.mkdir(path.join(source,'.auth'),{recursive:true});
  for(const n of ['user','machine_id'])await fs.writeFile(path.join(source,'.auth',n),'FAKE_AUTH');
  await fs.writeFile(path.join(source,'settings.json'),'{"model":{"name":"custom/test"}}');
  process.env['QODERCN_CONFIG_DIR']=source;
});
after(async()=>{if(oldSource===undefined)delete process.env['QODERCN_CONFIG_DIR'];else process.env['QODERCN_CONFIG_DIR']=oldSource;if(root)await fs.rm(root,{recursive:true,force:true});});

async function fake(script:string) {
  const entry=path.join(root,`cli-${created.length}.cjs`);created.push(entry);
  await fs.writeFile(entry,`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('1.1.80');process.exit(0);}\nif(process.argv.includes('--list-models')){console.log('MODEL\\nAuto\\nExact\\nOther');process.exit(0);}\nif(process.argv[process.argv.indexOf('--tools')+1]==='Read,Grep,Glob'){const model=process.argv[process.argv.indexOf('--model')+1]??'Auto';console.log(JSON.stringify({type:'system',subtype:'init',model,tools:['Read','Grep','Glob']}));for(const name of ['Read','Grep','Glob']){console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:name,name,input:{file_path:'normal.txt',path:'.'}}]}}));console.log(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:name,content:'QODER_REVIEW_CANARY'}]}}));}console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'OK'}));process.exit(0);}
${script}\n`,{mode:0o700});
  const parsed=parseQoderCatalog('MODEL\nAuto\nExact\nOther\n');
  const facts:NativeModelFacts={model:'Auto',source:'catalog-default',observed_user_model:'custom/test',models:parsed.models,route_labels:parsed.routeLabels,
    catalog_sha256:parsed.semanticHash,catalog_raw_sha256:qoderHash('raw'),configuration_sha256:qoderHash(await fs.readFile(path.join(source,'settings.json'))),
    entrypoint:entry,cli_sha256:qoderHash(await fs.readFile(entry)),cli_version:'1.1.80',platform:process.platform,prepared_at:new Date().toISOString(),default_verified:true,invocation_args:[...QODER_MODEL_ARGS],review_invocation_args:[...QODER_REVIEW_ARGS]};
  return facts;
}
const event=(model:string)=>JSON.stringify({type:'system',subtype:'init',model})+'\n';
const success=JSON.stringify({type:'result',subtype:'success',is_error:false,result:'OK'})+'\n';
const warning='Model "Exact" is not available right now; using "auto" instead. Use /model to choose another model.';

test('生产隔离环境经真实run派生后删除全部未知父键，运行注入不会生效', {skip},async()=>{
  const keys=['QODER_CANARY','TRIVIUM_ENV_CANARY','AWS_SECRET_ACCESS_KEY','NODE_OPTIONS','BUN_OPTIONS'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    for(const key of keys)process.env[key]=key==='NODE_OPTIONS'?'--require /trivium-fixture-never-exists.cjs':'test_key_parent_canary';
    const out=await withQoderHome((home,_config,env)=>qoderRun(process.execPath,['-e',`const keys=${JSON.stringify(keys)};console.log(JSON.stringify({present:keys.filter(k=>process.env[k]!==undefined),home:process.env.HOME,tmp:process.env.TMPDIR}));`],{cwd:home,env,timeoutMs:10000,killTree:true}));
    assert.equal(out.code,0,out.stderr);const observed=JSON.parse(out.stdout);assert.deepEqual(observed.present,[]);assert.equal(observed.tmp,path.join(observed.home,'tmp'));
  } finally {for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

test('完整替换阻止构造后新增父键；公共merge仍继承且undefined删除兼容', {skip},async()=>{
  const key='TRIVIUM_LATE_ENV_CANARY',old=process.env[key];delete process.env[key];
  try {
    await withQoderHome(async(home,_config,env)=>{
      process.env[key]='test_key_late_fixture';
      const args=['-e',`console.log(process.env.${key}===undefined?'ABSENT':'PRESENT')`];
      const isolated=await qoderRun(process.execPath,args,{cwd:home,env,timeoutMs:10000});
      assert.equal(isolated.code,0);assert.equal(isolated.stdout.trim(),'ABSENT');
      const merged=await run(process.execPath,args,{env:{},timeoutMs:10000});assert.equal(merged.stdout.trim(),'PRESENT');
      const removed=await run(process.execPath,args,{env:{[key]:undefined},timeoutMs:10000});assert.equal(removed.stdout.trim(),'ABSENT');
    });
  } finally {if(old===undefined)delete process.env[key];else process.env[key]=old;}
});

test('生产适配器缺准入快照必须在模型派生前失败；下层执行边界仍阻断退出0回退', {skip}, async()=>{
  const marker=path.join(root,'spawned');
  const f=await fake(`require('fs').writeFileSync(${JSON.stringify(marker)},'yes');process.stdout.write(${JSON.stringify(event('Exact')+success)});process.stderr.write(${JSON.stringify(warning)});process.exit(0);`);
  const cfg=defaultConfig(),request=qoderModelRequest(f,'Exact','cli');
  const req={critic:'qoder-cn',project_root:root,model:'Exact',native_model:request,out_dir:path.join(root,'out'),brief_text:'test',timeout_s:10} as CriticRequest;
  const blocked=await qoderCnAdapter.run({cfg,nodePath:process.execPath},req);
  assert.equal(blocked.process_started,false);assert.match(blocked.fail_reason!,/准入请求快照缺失/);assert.equal(await fs.stat(marker).then(()=>true,()=>false),false);
  const result=await invokeQoderModel({request,cwd:root,prompt:'x',timeoutMs:10000});
  assert.equal(result.ok,false);assert.match(result.evidence.failure!,/回退/);assert.equal(result.monitor.resultText,null);
  const invalid={...req,model:'bad',native_model:{...request,requested:'bad'}};
  await fs.rm(marker);
  assert.equal((await qoderCnAdapter.run({cfg,nodePath:process.execPath},invalid)).process_started,false);
  assert.equal(await fs.stat(marker).then(()=>true,()=>false),false);
});

test('真实执行边界：stdout/stderr 分块告警触发早停，末尾无换行同样失败', {skip},async()=>{
  for(const channel of ['stdout','stderr']) {
    const marker=path.join(root,`late-${channel}`);
    const f=await fake(`process.stdout.write(${JSON.stringify(event('Exact'))});process.${channel}.write(${JSON.stringify(warning.slice(0,20))});setTimeout(()=>process.${channel}.write(${JSON.stringify(warning.slice(20)+'\n')}),30);setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'late'),5000);`);
    const r=await invokeQoderModel({request:qoderModelRequest(f,'Exact','cli'),cwd:root,prompt:'x',timeoutMs:10000});
    assert.equal(r.ok,false);assert.equal(r.outcome.earlyStopped,true);assert.equal(await fs.stat(marker).then(()=>true,()=>false),false);
    assert.equal(r.evidence.stop_observation!.channel,channel);assert.equal(r.evidence.stop_observation!.after_result,false);assert.ok(r.evidence.stop_observation!.elapsed_ms>=0);
  }
  const f=await fake(`process.stdout.write(${JSON.stringify(event('Exact'))});process.stderr.write(${JSON.stringify(warning)});`);
  assert.equal((await invokeQoderModel({request:qoderModelRequest(f,'Exact','cli'),cwd:root,prompt:'x',timeoutMs:10000})).ok,false);
});

test('真实result先于告警时如实记after_result，回退摘要不被原生结果错误覆盖', {skip},async()=>{
  const errorResult=JSON.stringify({type:'result',subtype:'error',is_error:true})+'\n';
  const f=await fake(`process.stdout.write(${JSON.stringify(event('Exact')+errorResult)});setTimeout(()=>process.stderr.write(${JSON.stringify(warning+'\n')}),30);setTimeout(()=>{},5000);`);
  const native=qoderModelRequest(f,'Exact','cli');
  const req={model:'Exact',native_model:native,project_root:root,out_dir:path.join(root,'after-result'),brief_text:'x',timeout_s:10} as CriticRequest;
  const r=await invokeQoderModel({request:native,cwd:req.project_root,prompt:'x',timeoutMs:10000});
  assert.equal(r.evidence.stop_observation!.after_result,true);assert.equal(r.evidence.stop_observation!.channel,'stderr');assert.match(r.evidence.failure!,/回退/);
});

test('缺认证分别覆盖invoke准备失败与adapter版本验证失败，version在隔离HOME内', {skip},async()=>{
  const f=await fake(`process.stdout.write(${JSON.stringify(event('Exact')+success)});`);
  const bytes=await fs.readFile(f.entrypoint,'utf8');
  const isolated=bytes.replace("console.log('1.1.80')","if(!process.env.QODERCN_CONFIG_DIR?.startsWith(process.env.HOME)){process.exit(77);}console.log('1.1.80')");
  assert.notEqual(bytes,isolated);await fs.writeFile(f.entrypoint,isolated);f.cli_sha256=qoderHash(isolated);
  const cfg=defaultConfig(),native=qoderModelRequest(f,'Exact','cli');
  const req={model:'Exact',native_model:native,project_root:root,out_dir:path.join(root,'prepare-failure'),brief_text:'x',timeout_s:5} as CriticRequest;
  assert.equal((await invokeQoderModel({request:native,cwd:root,prompt:'x',timeoutMs:5000})).ok,true);
  const auth=path.join(source,'.auth/user');await fs.rename(auth,auth+'.saved');
  try {
    const invoked=await invokeQoderModel({request:native,cwd:root,prompt:'x',timeoutMs:1000});
    assert.equal(invoked.outcome.spawned,false);assert.equal(invoked.evidence.raw_exit_code,null);assert.match(invoked.evidence.execution_failure!,/准备失败/);assert.equal(invoked.evidence.request.requested,'Exact');
    const result=await qoderCnAdapter.run({cfg,nodePath:process.execPath},req);assert.equal(result.process_started,false);assert.ok(result.native_model);assert.equal(result.native_model.raw_exit_code,null);
    assert.match(result.native_model.execution_failure!,/ENOENT/);assert.doesNotMatch(result.native_model.execution_failure!,/准备失败/);
  }finally{await fs.rename(auth+'.saved',auth);}
});

test('真实执行边界：退出0且result成功但无模型回读仍判失败', {skip},async()=>{
  const f=await fake(`process.stdout.write(${JSON.stringify(success)});`);
  const r=await invokeQoderModel({request:qoderModelRequest(f,'Exact','cli'),cwd:root,prompt:'x',timeoutMs:5000});
  assert.equal(r.outcome.spawned,true);assert.equal(r.outcome.code,0);assert.equal(r.ok,false);
  assert.equal(r.evidence.failure,null);assert.equal(r.evidence.execution_failure,null);assert.deepEqual(r.evidence.labels,[]);
  assert.match(r.evidence.verification_failure!,/未核实/);assert.equal(r.effective.effective,null);assert.equal(r.effective.source,'unverified');
});

test('真实执行边界：成功正对照、超时、启动失败均保留原始事实并清理认证', {skip},async()=>{
  const f=await fake(`process.stdout.write(${JSON.stringify(event('Exact')+success)});`);
  const r=await invokeQoderModel({request:qoderModelRequest(f,'Exact','cli'),cwd:root,prompt:'x',timeoutMs:10000});
  assert.equal(r.ok,true);assert.equal(r.effective.effective,'Exact');
  const hanging=await fake('setInterval(()=>{},1000);');
  const timeout=await invokeQoderModel({request:qoderModelRequest(hanging,'Exact','cli'),cwd:root,prompt:'x',timeoutMs:50});
  assert.equal(timeout.outcome.timedOut,true);assert.equal(timeout.ok,false);
  const missing={...f,entrypoint:path.join(root,'absent')};
  const failed=await invokeQoderModel({request:qoderModelRequest(missing,'Exact','cli'),cwd:root,prompt:'x',timeoutMs:1000});
  assert.equal(failed.outcome.spawned,false);assert.equal(failed.outcome.code,null);
  assert.match(failed.evidence.execution_failure!,/准备失败/);assert.equal(failed.evidence.failure,null);
  assert.match(timeout.evidence.execution_failure!,/超时/);assert.equal(timeout.evidence.failure,null);
});

test('辅助进程已退出/身份复用不误杀；对象返回值只读sameProcess', {skip},async()=>{
  const kills:string[]=[];
  const base={list:async()=> '123 /fixture/home/.qodersec/helper',start:async()=>null as string|null,exists:async()=>false,
    alive:async()=>({alive:false,sameProcess:false,startedAt:null}),kill:(_pid:number,s:NodeJS.Signals)=>{kills.push(s);},wait:async()=>{}};
  await stopQoderHomeHelpers('/fixture/home',base);assert.deepEqual(kills,[]);
  await stopQoderHomeHelpers('/fixture/home',{...base,start:async()=> 'old',alive:async()=>({alive:true,sameProcess:false,startedAt:'new'})});assert.deepEqual(kills,[]);
  let checks=0;
  await stopQoderHomeHelpers('/fixture/home',{...base,start:async()=> 'old',alive:async()=>({alive:++checks===1,sameProcess:checks===1,startedAt:checks===1?'old':null})});assert.deepEqual(kills,['SIGTERM']);
});

test('执行前绑定漂移和直接快照篡改：入口/平台/hash/settings/version/override/origin均未派生', {skip},async()=>{
  const marker=path.join(root,'binding-model-started');
  const f=await fake(`require('fs').writeFileSync(${JSON.stringify(marker)},'yes');process.stdout.write(${JSON.stringify(event('Exact')+success)});`);
  const cfg=defaultConfig();const base=qoderModelRequest(f,'Exact','cli');
  const req={model:'Exact',native_model:base,project_root:root,out_dir:path.join(root,'binding-out'),brief_text:'x',timeout_s:5} as CriticRequest;
  for(const patch of [{cli_sha256:'b'.repeat(64)},{platform:'other'},{cli_version:'different'},{configuration_sha256:'b'.repeat(64)}]) {
    const bad={...req,native_model:{...base,facts:{...f,...patch}}};
    const r=await qoderCnAdapter.run({cfg,nodePath:process.execPath},bad);assert.equal(r.process_started,false);assert.match(r.fail_reason!,/重探/);
  }
  for(const patch of [{override:'tampered'},{origin:'probe_default'}]) {
    const r=await qoderCnAdapter.run({cfg,nodePath:process.execPath},{...req,native_model:{...base,...patch}});assert.equal(r.process_started,false);assert.match(r.fail_reason!,/不一致|不在官方目录/);
  }
  const settings=path.join(source,'settings.json'),originalSettings=await fs.readFile(settings);
  try {await fs.writeFile(settings,'{"model":{"name":"changed"}}');assert.equal((await qoderCnAdapter.run({cfg,nodePath:process.execPath},req)).process_started,false);}
  finally {await fs.writeFile(settings,originalSettings);}
  const binary=await fs.readFile(f.entrypoint);
  try {await fs.appendFile(f.entrypoint,'\n// replacement');assert.equal((await qoderCnAdapter.run({cfg,nodePath:process.execPath},req)).process_started,false);}
  finally {await fs.writeFile(f.entrypoint,binary);}
  cfg.agents['qoder-cn']={vendor:'qoder-cn',bin:'/different'};
  assert.equal((await qoderCnAdapter.run({cfg,nodePath:process.execPath},req)).process_started,false);
  assert.equal(await fs.stat(marker).then(()=>true,()=>false),false);
});

test('显式模型大小写归一后仍保留原始override，执行边界不误拒合法请求', {skip},async()=>{
  const f=await fake(`process.stdout.write(${JSON.stringify(event('Exact')+success)});`);
  const native=qoderModelRequest(f,'exact','cli');
  const r=await invokeQoderModel({request:native,cwd:root,prompt:'x',timeoutMs:5000});assert.equal(r.ok,true);assert.equal(r.evidence.request.override,'exact');
});

test('真实探针：init 路由声明不受后续具体回读影响；官方配置产config，Custom不继承', {skip},async()=>{
  const f=await fake(`const i=process.argv.indexOf('--model');const model=i>=0?process.argv[i+1]:'Auto';process.stdout.write(JSON.stringify({type:'system',subtype:'init',model})+'\\n');process.stdout.write(JSON.stringify({type:'assistant',message:{model:'Exact'}})+'\\n');process.stdout.write(${JSON.stringify(success)});`);
  const base=defaultProbe().cli['qoderclicn']!;
  const native=await probeQoderCn(f.entrypoint,base);
  assert.equal(native.native_default!.model,'Auto');assert.equal(native.native_default!.source,'catalog-default');
  const settings=path.join(source,'settings.json'),original=await fs.readFile(settings);
  try {
    await fs.writeFile(settings,'{"model":{"name":"Exact"}}');
    const configured=await probeQoderCn(f.entrypoint,base);assert.equal(configured.native_default!.model,'Exact');assert.equal(configured.native_default!.source,'config');
  }finally {await fs.writeFile(settings,original);}
});

test('旧事实保持全settings绑定且不回写；v2忽略无关设置、模型语义变化仍拒绝',{skip},async()=>{
  const f=await fake(`process.stdout.write(${JSON.stringify(event('Exact')+success)});`),settings=path.join(source,'settings.json'),original=await fs.readFile(settings);
  try{
    await fs.writeFile(settings,'{"model":{"name":"Exact"},"general":{"theme":"one"}}');
    const old={...f,configuration_sha256:qoderHash(await fs.readFile(settings))},snapshot=JSON.stringify(old);
    checkQoderBinding(old,null);
    const next=(await probeQoderCn(f.entrypoint,defaultProbe().cli['qoderclicn']!)).native_default!;assert.equal(next.binding_version,2);checkQoderBinding(next,null);
    await fs.writeFile(settings,'{"general":{"theme":"two"},"model":{"name":"Exact"}}');
    assert.throws(()=>checkQoderBinding(old,null),/重探/);checkQoderBinding(next,null);assert.equal(JSON.stringify(old),snapshot);
    const untouched=await fs.readFile(settings,'utf8');checkQoderBinding(next,null);assert.equal(await fs.readFile(settings,'utf8'),untouched);
    await fs.writeFile(settings,'{"model":{"name":"Other"}}');assert.throws(()=>checkQoderBinding(next,null),/重探/);
  }finally{await fs.writeFile(settings,original);}
});

test('实际审核argv等于准入绑定的独立review配方，无工具事实不能审核',{skip},async()=>{
  const argvFile=path.join(root,'review-argv.json'),f=await fake('');
  const source=await fs.readFile(f.entrypoint,'utf8');await fs.writeFile(f.entrypoint,source.replace("if(process.argv[process.argv.indexOf('--tools')+1]",`if(process.argv.includes('--model'))require('fs').writeFileSync(${JSON.stringify(argvFile)},JSON.stringify(process.argv.slice(2)));if(process.argv[process.argv.indexOf('--tools')+1]`));f.cli_sha256=qoderHash(await fs.readFile(f.entrypoint));
  const request=qoderModelRequest(f,'Exact','cli');
  const out=await invokeQoderModel({request,cwd:root,prompt:'x',timeoutMs:5000,readonlyDenyPaths:[]});assert.equal(out.ok,true);
  const argv=JSON.parse(await fs.readFile(argvFile,'utf8')) as string[],actual=argv.slice(2,argv.indexOf('--model'));
  assert.deepEqual(actual,f.review_invocation_args);assert.notDeepEqual(actual,f.invocation_args);
  const req={critic:'qoder-cn' as const,project_root:root,model:'Exact',native_model:request};
  assert.notEqual(admissionRouteBinding(req),admissionRouteBinding({...req,native_model:{...request,facts:{...f,review_invocation_args:[...actual,'--different-fixture']}}}));
  await fs.rm(argvFile);const missing=structuredClone(request);delete missing.facts.review_invocation_args;
  const refused=await invokeQoderModel({request:missing,cwd:root,prompt:'x',timeoutMs:5000,readonlyDenyPaths:[]});assert.equal(refused.outcome.spawned,false);assert.match(refused.evidence.execution_failure!,/缺少独立已测审核配方/);assert.equal(await fs.stat(argvFile).then(()=>true,()=>false),false);
});

test('隔离复制树重打包：真实父进程→worker 保留native请求；篡改在模型派生前失败', {skip,timeout:180000},async()=>{
  kit=path.join(root,'build');await copyProductionTree(REPO_ROOT,kit);await linkDependencies(REPO_ROOT,kit);
  const registry=path.join(kit,'src/trivium/agents/registry.ts');
  const original=await fs.readFile(registry,'utf8');
  const anchor=original.indexOf("id: 'qoder-cn'");assert.ok(anchor>0);
  const tail=original.slice(anchor);assert.ok(tail.includes('criticEnabled: false'));
  await fs.writeFile(registry,original.slice(0,anchor)+tail.replace('criticEnabled: false','criticEnabled: true'));
  // 只在隔离复制树注入台账替身，测父进程/worker冻结交接；不作为原生准入证据。
  await fs.writeFile(path.join(kit,'src/trivium/adapters/qoder-cn-admission.ts'),`import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import path from 'node:path';import type {AdmissionRequest} from '../admission.js';import type {AdmissionReference} from '../types.js';export function qoderAdmission(req:AdmissionRequest,_ttl:number,frozen?:AdmissionReference){const ref={record_id:'synthetic-transport-only',record_sha256:createHash('sha256').update(readFileSync(path.join(req.project_root,'.trivium/admission.local.json'))).digest('hex')};if(frozen&&JSON.stringify(ref)!==JSON.stringify(frozen))throw Error('准入记录自冻结后已变化');return ref;}`);
  const built=await run(process.execPath,['scripts/build.mjs'],{cwd:kit,timeoutMs:60000});assert.equal(built.code,0,built.stderr);
  const bundle=path.join(kit,'skills/dual-critic/scripts/trivium.cjs');
  for(const tamper of ['none','native','admission']) {
    const fx=await makeFixture({topic:'原生快照-'+tamper});
    for(const name of await fs.readdir(fx.stageDir))if(name.endsWith('-claude.md'))await fs.rename(path.join(fx.stageDir,name),path.join(fx.stageDir,name.replace(/-claude\.md$/,'-codex.md')));
    await fs.writeFile(path.join(fx.root,'.trivium/admission.local.json'),'synthetic-transport-only');
    const gate=path.join(fx.root,'worker-go');
    const shim=path.join(fx.root,'node-shim.cjs');
    await fs.writeFile(shim,`#!${process.execPath}\nconst fs=require('fs'),cp=require('child_process');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){clearInterval(timer);const c=cp.spawn(${JSON.stringify(process.execPath)},process.argv.slice(2),{stdio:'inherit'});c.on('exit',code=>process.exit(code??1));}},20);setTimeout(()=>process.exit(99),30000).unref();`,{mode:0o700});
    const marker=path.join(fx.root,'model-spawned');
    const f=await fake(`require('fs').writeFileSync(${JSON.stringify(marker)},'yes');process.stdout.write(${JSON.stringify(event('Auto')+success)});`);
    const fakeBytes=await fs.readFile(f.entrypoint,'utf8');await fs.writeFile(f.entrypoint,fakeBytes.replace("if(process.argv[process.argv.indexOf('--tools')+1]","if(process.argv.includes('--model'))require('fs').writeFileSync("+JSON.stringify(marker)+",'yes');if(process.argv[process.argv.indexOf('--tools')+1]"));f.cli_sha256=qoderHash(await fs.readFile(f.entrypoint));
    const cfg=defaultConfig();
    const local={runtime:{node:shim},agents:{'qoder-cn':{vendor:'qoder-cn',bin:f.entrypoint}},probe:{...cfg.probe,cli:{...cfg.probe.cli,qoderclicn:{...cfg.probe.cli['qoderclicn'],entrypoint:f.entrypoint,version:f.cli_version,probed_at:f.prepared_at,native_default:f}}}};
    await fs.writeFile(path.join(fx.root,'.trivium/config.local.yaml'),YAML.stringify(local));
    const env={TRIVIUM_ASSET_ROOT:path.join(kit,'skills/dual-critic'),TRIVIUM_STUB_CRITIC:undefined,QODERCN_CONFIG_DIR:source};
    const started=await run(process.execPath,[bundle,'review','--start','--entry','A','--stage','plan','--topic',fx.topic,'--driver','codex','--critics','qoder-cn','--goal','x','--json'],{cwd:fx.root,env,timeoutMs:30000});
    assert.equal(started.code,0,started.stdout+started.stderr);
    const info=JSON.parse(extractJsonCandidate(started.stdout)!.json);
    const handoffPath=path.join(info.run_dir,'request.json');
    const h=JSON.parse(await fs.readFile(handoffPath,'utf8'));
    assert.equal(h.requests['qoder-cn'].native_model.facts.model,'Auto');
    assert.equal(h.requests['qoder-cn'].admission.record_id,'synthetic-transport-only');
    if(tamper==='admission')await fs.appendFile(path.join(fx.root,'.trivium/admission.local.json'),'changed');
    if(tamper==='native') {h.requests['qoder-cn'].native_model.facts.configuration_sha256='b'.repeat(64);await fs.writeFile(handoffPath,JSON.stringify(h));}
    await fs.writeFile(gate,'go');
    const waited=await run(process.execPath,[bundle,'review','--wait',info.run_id,'--timeout','20','--json'],{cwd:fx.root,env,timeoutMs:30000});
    assert.notEqual(waited.code,73,waited.stdout+waited.stderr);
    const meta=JSON.parse(await fs.readFile(path.join(fx.stageDir,'_meta',`run-${info.run_id}.json`),'utf8'));
    assert.equal(meta.requested_routes['qoder-cn'].native_model.facts.configuration_sha256,f.configuration_sha256);
    const ran=await fs.stat(marker).then(()=>true,()=>false);assert.equal(ran,tamper==='none',JSON.stringify(meta.critics)+' '+waited.stdout+waited.stderr);
    if(tamper!=='none')assert.match(waited.stdout+waited.stderr,/不一致|失败|failed/);
    else assert.equal(meta.critics['qoder-cn'].native_model.raw_exit_code,0);
  }
  // 测试构建没有回写生产注册表开关。
  const production=await fs.readFile(path.join(REPO_ROOT,'src/trivium/agents/registry.ts'),'utf8');
  assert.match(production.slice(production.indexOf("id: 'qoder-cn'")),/criticEnabled: false/);
});
