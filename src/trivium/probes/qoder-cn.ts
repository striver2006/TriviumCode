/** 显式 CN 路由探针；不会据此开放只读审核准入。 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommonProbe, NativeModelFacts } from '../types.js';
import { parseQoderCatalog, QoderModelMonitor, qoderHash } from '../adapters/qoder-cn-model.js';
import { qoderConfiguration, withQoderHome, qoderRun as run, qoderOfficialBinding, qoderAuthenticationHash, qoderConfigRoot, pinQoderExecutable, prepareQoderReadonly } from '../adapters/qoder-cn-native.js';
import { loadQoderCustom, installQoderCustom, qoderIsolationHash, qoderCustomSource } from '../adapters/qoder-cn-custom.js';
import { customSelector } from '../adapters/qoder-cn-model.js';
import {makeTempDir,tryRemoveTempDir} from '../util/fsx.js';
import {parseQoderTrace,QODER_READING_TOOLS} from '../adapters/qoder-cn-trace.js';
import type { RunResult } from '../util/exec.js';

/** 已由 1.1.80 隔离真机执行证实的无工具路线；生产适配器原样消费，不重建。 */
export const QODER_MODEL_ARGS = ['--setting-sources','user','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--output-format','stream-json'];

export const QODER_REVIEW_ARGS=[...QODER_MODEL_ARGS];
QODER_REVIEW_ARGS[QODER_REVIEW_ARGS.indexOf('--tools')+1]=QODER_READING_TOOLS.join(',');
QODER_REVIEW_ARGS.push('--permission-mode','dont_ask');

/** 模型可调用与审核读取分别实测，后者才产生review_invocation_args。 */
async function reviewPositive(entry:string,home:string,config:string,env:Record<string,string|undefined>,model:string,routeLabels:string[],models:string[],custom:import('../types.js').NativeRouteDescriptor|null=null):Promise<RunResult>{
  const project=await makeTempDir('trivium-cn-review-probe');
  try{
    const file=path.join(project,'normal.txt');await fs.writeFile(file,'QODER_REVIEW_CANARY',{mode:0o600});await prepareQoderReadonly(home,config,[],project);
    const monitor=new QoderModelMonitor(model,routeLabels,models,custom);
    const result=await run(entry,['--config-dir',config,...QODER_REVIEW_ARGS,'--model',custom?.native_key??model,'-p'],{cwd:project,env,stdin:`Use Read on ${JSON.stringify(file)}; then Grep pattern QODER_REVIEW_CANARY path ${JSON.stringify(file)} output_mode content; then Glob pattern normal.txt path ${JSON.stringify(project)}. Call each tool once and reply OK.`,timeoutMs:90000,killTree:true,onStdoutLine:l=>monitor.line(l),onStderrLine:l=>monitor.line(l)});
    monitor.finish();const trace=parseQoderTrace(result.stdout);
    if(result.code!==0||result.timedOut||result.truncated||!monitor.sawResult||monitor.resultError||trace.errors.length||trace.init?.tools.length!==QODER_READING_TOOLS.length||trace.init.tools.some(t=>!(QODER_READING_TOOLS as readonly string[]).includes(t))||QODER_READING_TOOLS.some(t=>!trace.calls.some(c=>c.name===t&&c.result&&!c.result.is_error)))throw new Error('Qoder CN 审核配方最小读取正控制未通过');
    return result;
  }finally{if(await tryRemoveTempDir(project,[]))throw new Error('Qoder CN 审核正控制夹具清理失败');}
}

export async function probeQoderCn(bin:string|null,base:CommonProbe,skipModelCalls=false,selectedModel:string|null=null):Promise<CommonProbe> {
  const entry=path.resolve(bin??path.join(os.homedir(),'.local/bin/qoderclicn'));
  if(selectedModel&&(selectedModel.startsWith('custom:')||selectedModel.includes('/'))){
    if(skipModelCalls)throw new Error('Custom必要正对照需要真实模型调用，不能以无调用探针标为已验证');
    return probeQoderCustom(entry,base,selectedModel.replace(/^custom:/,''));
  }
  const configuration=await qoderConfiguration();
  return withQoderHome(async(home,config,env)=>{
    const pinned=await pinQoderExecutable(entry,home),execution=pinned.executable;
    const authentication=qoderAuthenticationHash(config);
    if(authentication!==qoderAuthenticationHash())throw new Error('Qoder CN 认证来源在准备期间变化');
    const version=await run(execution,['--version'],{cwd:home,env,timeoutMs:15000,killTree:true});
    if(version.code!==0 || !/^\d+\.\d+\.\d+$/.test(version.stdout.trim()))throw new Error('Qoder CN 版本探测失败');
    const catalog=await run(execution,['--config-dir',config,'--setting-sources','user','--list-models'],{cwd:home,env,timeoutMs:90000,killTree:true});
    if(catalog.code!==0||catalog.timedOut||catalog.truncated)throw new Error('Qoder CN 官方目录获取失败');
    const parsed=parseQoderCatalog(catalog.stdout);
    if(skipModelCalls)return {...base,entrypoint:entry,version:version.stdout.trim(),models:parsed.models,native_default:undefined};
    const configured=parsed.models.find(x=>x.toLowerCase()===configuration.model?.toLowerCase())??null;
    const monitor=new QoderModelMonitor(configured,parsed.routeLabels,parsed.models);
    const result=await run(execution,['--config-dir',config,...QODER_MODEL_ARGS,...(configured?['--model',configured]:[]),'-p','Reply OK only.'],{cwd:home,env,timeoutMs:90000,killTree:true,
      onStdoutLine:line=>monitor.line(line),onStderrLine:line=>monitor.line(line)});
    if(result.spawned===false)throw new Error('Qoder CN 默认模型进程启动失败');
    if(result.timedOut)throw new Error('Qoder CN 默认模型探测超时');
    if(result.truncated)throw new Error('Qoder CN 默认模型探测输出截断');
    if(result.code!==0)throw new Error(`Qoder CN 默认模型探测退出失败：${result.code??result.signal}`);
    if(!monitor.sawResult||monitor.resultError)throw new Error('Qoder CN 默认模型探测缺少成功最终结果');
    monitor.finish();
    const defaultLabel=parsed.models.find(x=>x.toLowerCase()===monitor.initLabel?.toLowerCase());
    if(result.code!==0||result.timedOut||result.truncated||!monitor.sawResult||monitor.resultError||!defaultLabel)throw new Error('Qoder CN 默认路由未验证');
    // 不从目录顺序猜默认；省略 --model 的 init 标签与目录项相互验证。
    if(authentication!==qoderAuthenticationHash())throw new Error('Qoder CN 认证来源在探测期间变化');
    if((await qoderConfiguration()).hash!==configuration.hash)throw new Error('Qoder CN 设置在探测期间变化，请重探');
    await reviewPositive(execution,home,config,env,defaultLabel,parsed.routeLabels,parsed.models);
    if(authentication!==qoderAuthenticationHash()||(await qoderConfiguration()).hash!==configuration.hash)throw new Error('Qoder CN 来源在审核正控制期间变化，请重探');
    if(qoderHash(await fs.readFile(entry))!==pinned.sha256)throw new Error('Qoder CN CLI在探测期间变化，请重探');
    const binding=qoderOfficialBinding(defaultLabel,parsed.models);
    const native:NativeModelFacts={binding_version:2,route_kind:'official',route_descriptor:{selector:`official:${defaultLabel}`,native_key:defaultLabel,display_name:defaultLabel,provider_id:null,model_id:defaultLabel,
      source_ref:path.join(qoderConfigRoot(),'settings.json'),declaration_sha256:binding,credential_source_sha256:authentication,authentication_sha256:authentication,recipe_sha256:qoderIsolationHash(),codec:null},model:defaultLabel,source:configured?'config':'catalog-default',observed_user_model:configuration.model,
      models:parsed.models,route_labels:parsed.routeLabels,catalog_sha256:parsed.semanticHash,catalog_raw_sha256:qoderHash(catalog.stdout),
      configuration_sha256:binding,configuration_raw_sha256:configuration.hash,entrypoint:entry,cli_sha256:pinned.sha256,cli_version:version.stdout.trim(),
      platform:process.platform,prepared_at:new Date().toISOString(),default_verified:true,invocation_args:[...QODER_MODEL_ARGS],review_invocation_args:[...QODER_REVIEW_ARGS]};
    return {...base,entrypoint:entry,version:native.cli_version,version_probe:{runner:null,args:['--version'],extract:null},probed_at:native.prepared_at,models:parsed.models,native_default:native};
  });
}

/** 显式Custom可调用事实，与只读准入分离，unknown底层身份不伪造。 */
export async function probeQoderCustom(entry:string,base:CommonProbe,key:string,onObservation?:(value:{catalog:RunResult;result:RunResult;review:RunResult})=>void):Promise<CommonProbe> {
  return withQoderHome(async(home,config,env)=>{
    const pinned=await pinQoderExecutable(entry,home),execution=pinned.executable;
    const selected=await loadQoderCustom(execution,key),descriptor=selected.descriptor;
    if(qoderAuthenticationHash(config)!==descriptor.authentication_sha256)throw new Error('Qoder CN Custom准备期间认证来源变化');
    await installQoderCustom(selected,config);
    const version=await run(execution,['--version'],{cwd:home,env,timeoutMs:15000,killTree:true});
    if(version.code!==0||!/^\d+\.\d+\.\d+$/.test(version.stdout.trim()))throw new Error('Qoder CN Custom版本探测失败');
    const catalog=await run(execution,['--config-dir',config,'--setting-sources','user','--list-models'],{cwd:home,env,timeoutMs:90000,killTree:true});
    if(catalog.code!==0||catalog.timedOut||catalog.truncated||!catalog.stdout.includes(key)||!catalog.stdout.includes(descriptor.display_name))throw new Error('Qoder CN Custom隔离目录未回读选中声明');
    const routeLabels=catalog.stdout.split(/\r?\n/).map(l=>l.trim()).filter(l=>/^(Auto|Fast)$/.test(l)).sort();
    const monitor=new QoderModelMonitor(descriptor.selector,routeLabels,[],descriptor);
    let stop:(()=>void)|undefined;
    const observe=(line:string)=>{monitor.line(line);if(monitor.failure)stop?.();};
    const out=await run(execution,['--config-dir',config,...QODER_MODEL_ARGS,'--model',key,'-p','Reply OK only.'],{cwd:home,env,timeoutMs:90000,killTree:true,stopEarly:s=>{stop=s;},onStdoutLine:observe,onStderrLine:observe});
    for(const line of [...out.stdout.split(/\r?\n/),...out.stderr.split(/\r?\n/)])monitor.line(line);
    // 探针不持久化原生正文，所有待抛信息也仅为固定文案。
    out.stdout=selected.secrets.scrub(out.stdout);out.stderr=selected.secrets.scrub(out.stderr);catalog.stdout=selected.secrets.scrub(catalog.stdout);catalog.stderr=selected.secrets.scrub(catalog.stderr);
    if(selected.secrets.leaked)throw new Error('Qoder CN Custom探针命中凭据，拒绝写入事实');
    try{monitor.finish();}catch{throw new Error('Qoder CN Custom回退或必要运行回读不足');}
    if(out.code!==0||out.timedOut||out.truncated||out.earlyStopped||!monitor.sawResult||monitor.resultError)throw new Error('Qoder CN Custom正对照未取得成功终态');
    const after=await qoderCustomSource();if(after.fingerprint!==descriptor.credential_source_sha256||after.authentication!==descriptor.authentication_sha256)throw new Error('Qoder CN Custom来源在探测期间变化');
    const review=await reviewPositive(execution,home,config,env,descriptor.selector,routeLabels,[],descriptor);
    review.stdout=selected.secrets.scrub(review.stdout);review.stderr=selected.secrets.scrub(review.stderr);
    if(selected.secrets.leaked)throw new Error('Qoder CN 审核正控制命中凭据');
    onObservation?.({catalog,result:out,review});
    const finalSource=await qoderCustomSource();if(finalSource.fingerprint!==descriptor.credential_source_sha256||finalSource.authentication!==descriptor.authentication_sha256)throw new Error('Qoder CN Custom来源在审核正控制期间变化');
    if(qoderHash(await fs.readFile(entry))!==pinned.sha256)throw new Error('Qoder CN CLI在探测期间变化，请重探');
    const models=[customSelector(key)];
    const native:NativeModelFacts={binding_version:2,route_kind:'custom',route_descriptor:descriptor,model:descriptor.selector,source:'native-config',observed_user_model:null,models,route_labels:routeLabels,
      catalog_sha256:qoderHash(JSON.stringify({models:[...models].sort(),routeLabels:[...routeLabels].sort()})),catalog_raw_sha256:qoderHash(catalog.stdout),configuration_sha256:descriptor.declaration_sha256,
      entrypoint:entry,cli_sha256:pinned.sha256,cli_version:version.stdout.trim(),platform:process.platform,prepared_at:new Date().toISOString(),default_verified:true,invocation_args:[...QODER_MODEL_ARGS],review_invocation_args:[...QODER_REVIEW_ARGS]};
    const old=(base.native_routes??[]).filter(f=>f.route_descriptor?.selector!==descriptor.selector);
    return {...base,entrypoint:entry,version:native.cli_version,version_probe:{runner:null,args:['--version'],extract:null},probed_at:base.probed_at??native.prepared_at,
      models:[...new Set([...base.models,descriptor.selector])],native_routes:[...old,native]};
  });
}
