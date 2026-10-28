/** 原生路线与候选审核适配器；只有组合台账通过后才允许审核派生。 */
import { promises as fs } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type { Config, NativeModelRequest, NativeModelResult } from '../types.js';
import { redactSecrets } from '../secrets.js';
import { failedResult, EFFORT_UNVERIFIED, type CriticAdapter } from './base.js';
import { QoderModelMonitor, qoderModelRequest, validateQoderFacts, normalizeQoderSelection } from './qoder-cn-model.js';
import { loadQoderCustom, installQoderCustom, QoderSecretGuard } from './qoder-cn-custom.js';
import { verifyQoderBinding, checkQoderBinding, withQoderHome, qoderRun as run, prepareQoderReadonly, qoderAuthenticationHash, pinQoderExecutable } from './qoder-cn-native.js';
import { qoderAdmission } from './qoder-cn-admission.js';
import { parseQoderTrace, qoderTraceEvidence } from './qoder-cn-trace.js';
import { withCredentialLeaseScope, reapCredentialLeases } from '../util/credential-lease.js';
import { stopQoderHomeHelpers,reapQoderUnscopedCredentials } from './qoder-cn-native.js';
import type { RunResult } from '../util/exec.js';
import { tryRemoveTempDir } from '../util/fsx.js';

function routeFacts(cfg:Config) {const p=cfg.probe.cli['qoderclicn'];return [...(p?.native_default?[p.native_default]:[]),...(p?.native_routes??[])];}
function factsFor(cfg:Config,model?:string) {
  if(model===undefined)return cfg.probe.cli['qoderclicn']?.native_default;
  const selected=normalizeQoderSelection(model,routeFacts(cfg));
  return routeFacts(cfg).find(f=>f.model===selected&&(selected.startsWith('custom:')?f.route_kind==='custom':f.route_kind!=='custom'))??cfg.probe.cli['qoderclicn']?.native_default;
}
function binFor(cfg:Config) {const a=cfg.agents['qoder-cn'];return a?.vendor==='qoder-cn'?a.bin:null;}

export function qoderFailureMessage(error:unknown):string {
  const message=error instanceof AggregateError?[error.message,...error.errors.map(qoderFailureMessage)].join('；'):error instanceof Error?error.message:String(error);
  return redactSecrets(message).content;
}

function unstartedOutcome(durationMs:number):RunResult {
  return {spawned:false,code:null,signal:null,stdout:'',stderr:'',durationMs,timedOut:false,earlyStopped:false,truncated:false,commandLine:''};
}

/** 取证脚本可直接调用这个真实执行边界制造无效模型故障；产品不提供跳过目录校验旗标。 */
export async function invokeQoderModel(opts:{request:NativeModelRequest;cwd:string;prompt:string;timeoutMs:number;readonlyDenyPaths?:readonly string[]}) {
  validateQoderFacts(opts.request.facts);
  const executionArgs=opts.readonlyDenyPaths?opts.request.facts.review_invocation_args:opts.request.facts.invocation_args;
  const custom=opts.request.facts.route_kind==='custom'?opts.request.facts.route_descriptor!:null;
  const monitor=new QoderModelMonitor(opts.request.requested,opts.request.facts.route_labels,opts.request.facts.models,custom);
  const guard=new QoderSecretGuard();
  let observedOutcome:RunResult|null=null,cleanupFailure:string|null=null;
  let stopObservation:NativeModelResult['stop_observation']=null;
  const started=Date.now();
  try {if(!executionArgs?.length)throw new Error('Qoder CN 缺少独立已测审核配方');await withQoderHome(async(_home,config,env)=>{
    const {executable}=await pinQoderExecutable(opts.request.facts.entrypoint,_home,opts.request.facts.cli_sha256);
    for(const name of ['user','machine_id'])guard.addCredential(await fs.readFile(path.join(config,'.auth',name),'utf8'));
    if(opts.readonlyDenyPaths)await prepareQoderReadonly(_home,config,opts.readonlyDenyPaths,opts.cwd);
    if(custom){const selected=await loadQoderCustom(executable,custom.native_key,custom);guard.merge(selected.secrets);if(qoderAuthenticationHash(config)!==selected.descriptor.authentication_sha256)throw new Error('Qoder CN 准备期间认证来源变化');await installQoderCustom(selected,config);}
    let stop:(()=>void)|undefined;
    const line=(s:string,channel:'stdout'|'stderr')=>{
      monitor.line(s);
      if(monitor.failure && stopObservation===null){stopObservation={channel,after_result:monitor.sawResult,elapsed_ms:Date.now()-started};stop?.();}
    };
    observedOutcome=await run(executable,['--config-dir',config,...executionArgs,
      '--model',custom?.native_key??opts.request.requested,'-p'],{cwd:opts.cwd,env,stdin:opts.prompt,timeoutMs:opts.timeoutMs,killTree:true,
        stopEarly:s=>{stop=s;},onStdoutLine:s=>line(s,'stdout'),onStderrLine:s=>line(s,'stderr')});
  });}catch(e){
    cleanupFailure=`Qoder CN ${observedOutcome?'清理':'准备'}失败：${qoderFailureMessage(e)}`;
    if(!observedOutcome)observedOutcome=unstartedOutcome(Date.now()-started);
  }
  // 在任何原生结果返回上层（worker日志/归档/结构化结论）前统一净化。
  const safe=completeQoderModelRun(opts.request,monitor,observedOutcome??unstartedOutcome(Date.now()-started),stopObservation,Date.now()-started,cleanupFailure);
  safe.outcome.stdout=guard.scrub(safe.outcome.stdout);safe.outcome.stderr=guard.scrub(safe.outcome.stderr);
  safe.monitor.resultText=safe.monitor.resultText===null?null:guard.scrub(safe.monitor.resultText);
  safe.evidence=JSON.parse(guard.scrub(JSON.stringify(safe.evidence))) as NativeModelResult;
  for(const labels of [safe.monitor.labels,safe.monitor.usageLabels])labels.splice(0,labels.length,...labels.map(x=>guard.scrub(x)));
  if(safe.monitor.initLabel)safe.monitor.initLabel=guard.scrub(safe.monitor.initLabel);
  if(safe.monitor.failure)safe.monitor.failure=guard.scrub(safe.monitor.failure);
  safe.effective=JSON.parse(guard.scrub(JSON.stringify(safe.effective))) as typeof safe.effective;
  if(guard.leaked){safe.ok=false;safe.evidence.execution_failure='Qoder CN 输出命中已知凭据，已脱敏并拒绝';safe.monitor.resultText=null;}
  if(!safe.ok)safe.monitor.resultText=null;
  return safe;
}

/** 防御性收尾独立于流回调；缺回调的合成结果只用于验证 final 兜底，不冒充真机早停。 */
export function completeQoderModelRun(request:NativeModelRequest,monitor:QoderModelMonitor,outcome:RunResult,
  stop:NativeModelResult['stop_observation'],elapsedMs:number,boundaryFailure:string|null=null) {
  let stopObservation=stop;
  // 包含未换行尾部，重复观测不重置首因。
  for(const line of [...outcome.stdout.split(/\r?\n/),...outcome.stderr.split(/\r?\n/)])monitor.line(line);
  let effective=monitor.readback();
  let verificationFailure:string|null=null;
  try {effective=monitor.finish();}catch(e){if(!monitor.failure)verificationFailure=(e as Error).message;}
  if(monitor.failure&&stopObservation===null)stopObservation={channel:'final',after_result:monitor.sawResult,elapsed_ms:elapsedMs};
  const executionFailure=boundaryFailure??(outcome.spawned===false?'Qoder CN 启动失败':outcome.timedOut?'Qoder CN 执行超时':outcome.truncated?'Qoder CN 输出截断':
    !monitor.failure&&outcome.code!==0?`Qoder CN 退出失败：${outcome.code??outcome.signal}`:!monitor.failure&&!monitor.sawResult?'Qoder CN 断流/缺少最终结果':!monitor.failure&&monitor.resultError?'Qoder CN 原生结果失败':null);
  const evidence:NativeModelResult={request,labels:monitor.labels,usage_labels:monitor.usageLabels,failure:monitor.failure,
    execution_failure:executionFailure,verification_failure:verificationFailure,stop_observation:stopObservation,raw_exit_code:outcome.code,raw_signal:outcome.signal};
  const ok=outcome.code===0&&!outcome.timedOut&&!outcome.truncated&&!outcome.earlyStopped&&!monitor.failure&&!verificationFailure&&!executionFailure&&monitor.sawResult&&!monitor.resultError;
  return {outcome,monitor,effective,evidence,ok};
}

export const qoderCnAdapter:CriticAdapter={
  critic:'qoder-cn',capability:{traceShape:'tool-trace',rejectionRecorded:false},commandExecution:'none',
  effortReadback:()=>EFFORT_UNVERIFIED,
  admissionFor(ctx,req,frozen){if(!req.native_model)throw new Error('Qoder CN 路线事实缺失');checkQoderBinding(req.native_model.facts,binFor(ctx.cfg));return qoderAdmission(req,ctx.cfg.probe_ttl_days,frozen);},
  scrubUnscoped:()=>reapQoderUnscopedCredentials(),
  async scrubRunDir(sideDir){
    const reaped=await reapCredentialLeases('qoder-cn',sideDir,async home=>{await stopQoderHomeHelpers(home);if(await tryRemoveTempDir(home,[]))throw new Error('Qoder CN 租约私有根清理失败');});
    return {deleted:[],unscannableDeleted:[],scanned:0,removedOnHit:[],redacted:{},warnings:reaped.deleted.length?[`已回收${reaped.deleted.length}个租约绑定的外部私有根`]:[],skipped:0,errors:reaped.errors};
  },
  defaultModelFor(cfg) {
    try {const f=factsFor(cfg);if(!f)throw new Error('请显式运行 doctor --only qoderclicn 取得官方默认');validateQoderFacts(f);return {kind:'resolved',model:f.model};}
    catch(e){return {kind:'missing',reason:(e as Error).message};}
  },
  nativeModelFor(cfg,model,origin) {const f=factsFor(cfg,model);if(!f)throw new Error('Qoder CN 路线探针缺失');return qoderModelRequest(f,model,origin);},
  normalizeModelForCatalog(cfg,model){try{return normalizeQoderSelection(model,routeFacts(cfg));}catch{return model;}},
  catalogModelsFor(cfg) {
    try{const all=routeFacts(cfg);if(!all.length)throw new Error('模型目录缺失');return {kind:'catalog',models:[...new Set(all.flatMap(f=>validateQoderFacts(f).models))],source:'分离的官方/Custom隔离目录探针',match:'exact'};}
    catch(e){return {kind:'unverifiable',why:`${(e as Error).message}；请 doctor --only qoderclicn 重探`};}
  },
  availability(ctx) {
    try {
      const fresh=routeFacts(ctx.cfg).some(f=>{try{validateQoderFacts(f);const age=Date.now()-Date.parse(f.prepared_at);if(!Number.isFinite(age)||age<0||age>ctx.cfg.probe_ttl_days*86400000)return false;checkQoderBinding(f,binFor(ctx.cfg));return true;}catch{return false;}});
      if(!fresh)throw new Error('缺少有效且绑定本机的官方/Custom路线探针');
      return {ok:true,note:'仅确认候选路线存在；具体请求仍须组合准入'};
    }catch(e){return {ok:false,reason:(e as Error).message,fix:'doctor'};}
  },
  async run(ctx,req) {
    return withCredentialLeaseScope(path.dirname(req.out_dir),async()=>{
    const fail=(reason:string)=>{
      const result=failedResult('qoder-cn',{status:'failed',reason,processStarted:false});
      if(req.native_model)result.native_model={request:req.native_model,labels:[],usage_labels:[],failure:null,execution_failure:reason,
        verification_failure:null,stop_observation:null,raw_exit_code:null,raw_signal:null};
      return result;
    };
    if(!req.native_model)return fail('Qoder CN 原生请求快照缺失，拒绝重新解析默认');
    // 对直接调用也执行目录检查，不能只依赖主进程预检。
    try {
      const expected=qoderModelRequest(req.native_model.facts,req.native_model.override??req.model,req.native_model.origin);
      if(expected.requested!==req.model || !isDeepStrictEqual(expected,req.native_model))throw new Error('Qoder CN 请求与冻结快照不一致');
      await verifyQoderBinding(req.native_model.facts,binFor(ctx.cfg));
      if(!req.admission)throw new Error('Qoder CN 准入请求快照缺失');
      qoderAdmission(req,ctx.cfg.probe_ttl_days,req.admission);
    }catch(e){return fail(qoderFailureMessage(e));}
    const invoked=await invokeQoderModel({request:req.native_model,cwd:req.project_root,prompt:req.brief_text,timeoutMs:req.timeout_s*1000,
      readonlyDenyPaths:[...req.deny_paths,path.join(req.project_root,'.trivium/admission.local.json')]});
    const parsed=parseQoderTrace(invoked.outcome.stdout);
    if(parsed.errors.length){invoked.ok=false;invoked.evidence.verification_failure='Qoder CN 工具/终态轨迹不完整';}
    invoked.evidence.route_verified=invoked.ok;
    await fs.mkdir(req.out_dir,{recursive:true});
    const stdout=path.join(req.out_dir,'stdout.ndjson'),trace=path.join(req.out_dir,'trace.json');
    await fs.writeFile(stdout,redactSecrets(invoked.outcome.stdout).content,{mode:0o600});
    await fs.writeFile(path.join(req.out_dir,'stderr.txt'),redactSecrets(invoked.outcome.stderr).content,{mode:0o600});
    await fs.writeFile(trace,JSON.stringify({...invoked.evidence,tool_trace:parsed},null,2),{mode:0o600});
    const result=failedResult('qoder-cn',{status:invoked.outcome.timedOut?'timeout':'failed',reason:invoked.evidence.execution_failure??invoked.evidence.failure??invoked.evidence.verification_failure??'Qoder CN 执行未完成',
      exitCode:invoked.outcome.code,durationS:invoked.outcome.durationMs/1000,processStarted:invoked.outcome.spawned===true,
      rawStdoutPath:stdout,tracePath:trace,cliVersion:req.native_model.facts.cli_version,commandLine:invoked.outcome.commandLine});
    result.native_model=invoked.evidence;
    result.native_model.route_verified=invoked.ok;
    Object.assign(result,qoderTraceEvidence(parsed,req.project_root));result.session_id=parsed.session_id;
    result.model_effective=invoked.effective.effective;result.model_effective_source=invoked.effective.source;
    if(invoked.ok){result.status='ok';result.fail_reason=null;result.raw_response_text=invoked.monitor.resultText;}
    return result;
    });
  },
};
