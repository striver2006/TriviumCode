/** P2 真实模型执行适配器。生产审核准入仍关闭；本阶段工具面固定为空。 */
import { promises as fs } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type { Config, NativeModelRequest, NativeModelResult } from '../types.js';
import { run } from '../util/exec.js';
import { redactSecrets } from '../secrets.js';
import { failedResult, EFFORT_UNVERIFIED, type CriticAdapter } from './base.js';
import { nativeDefaultIsFresh } from '../config.js';
import { QoderModelMonitor, qoderModelRequest, validateQoderFacts } from './qoder-cn-model.js';
import { verifyQoderBinding, checkQoderBinding, withQoderHome } from './qoder-cn-native.js';
import type { RunResult } from '../util/exec.js';

function factsFor(cfg:Config) {return cfg.probe.cli['qoderclicn']?.native_default;}
function binFor(cfg:Config) {const a=cfg.agents['qoder-cn'];return a?.vendor==='qoder-cn'?a.bin:null;}

export function qoderFailureMessage(error:unknown):string {
  const message=error instanceof AggregateError?[error.message,...error.errors.map(qoderFailureMessage)].join('；'):error instanceof Error?error.message:String(error);
  return redactSecrets(message).content;
}

function unstartedOutcome(durationMs:number):RunResult {
  return {spawned:false,code:null,signal:null,stdout:'',stderr:'',durationMs,timedOut:false,earlyStopped:false,truncated:false,commandLine:''};
}

/** 取证脚本可直接调用这个真实执行边界制造无效模型故障；产品不提供跳过目录校验旗标。 */
export async function invokeQoderModel(opts:{request:NativeModelRequest;cwd:string;prompt:string;timeoutMs:number}) {
  validateQoderFacts(opts.request.facts);
  const monitor=new QoderModelMonitor(opts.request.requested,opts.request.facts.route_labels,opts.request.facts.models);
  let observedOutcome:RunResult|null=null,cleanupFailure:string|null=null;
  let stopObservation:NativeModelResult['stop_observation']=null;
  const started=Date.now();
  try {await withQoderHome(async(_home,config,env)=>{
    let stop:(()=>void)|undefined;
    const line=(s:string,channel:'stdout'|'stderr')=>{
      monitor.line(s);
      if(monitor.failure && stopObservation===null){stopObservation={channel,after_result:monitor.sawResult,elapsed_ms:Date.now()-started};stop?.();}
    };
    observedOutcome=await run(opts.request.facts.entrypoint,['--config-dir',config,...opts.request.facts.invocation_args,
      '--model',opts.request.requested,'-p'],{cwd:opts.cwd,env,stdin:opts.prompt,timeoutMs:opts.timeoutMs,killTree:true,
        stopEarly:s=>{stop=s;},onStdoutLine:s=>line(s,'stdout'),onStderrLine:s=>line(s,'stderr')});
  });}catch(e){
    cleanupFailure=`Qoder CN ${observedOutcome?'清理':'准备'}失败：${qoderFailureMessage(e)}`;
    if(!observedOutcome)observedOutcome=unstartedOutcome(Date.now()-started);
  }
  return completeQoderModelRun(opts.request,monitor,observedOutcome??unstartedOutcome(Date.now()-started),stopObservation,Date.now()-started,cleanupFailure);
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
  defaultModelFor(cfg) {
    try {const f=factsFor(cfg);if(!f)throw new Error('请显式运行 doctor --only qoderclicn 取得官方默认');validateQoderFacts(f);return {kind:'resolved',model:f.model};}
    catch(e){return {kind:'missing',reason:(e as Error).message};}
  },
  nativeModelFor(cfg,model,origin) {const f=factsFor(cfg);if(!f)throw new Error('Qoder CN 官方默认探针缺失');return qoderModelRequest(f,model,origin);},
  normalizeModelForCatalog(cfg,model){return factsFor(cfg)?.models.find(x=>x.toLowerCase()===model.toLowerCase())??model;},
  catalogModelsFor(cfg) {
    try{const f=factsFor(cfg);if(!f)throw new Error('官方目录缺失');return {kind:'catalog',models:validateQoderFacts(f).models,source:'官方隔离目录探针'};}
    catch(e){return {kind:'unverifiable',why:`${(e as Error).message}；请 doctor --only qoderclicn 重探`};}
  },
  availability(ctx) {
    try {
      const f=factsFor(ctx.cfg);if(!f)throw new Error('官方模型探针缺失');validateQoderFacts(f);
      if(!nativeDefaultIsFresh(ctx.cfg.probe.cli['qoderclicn'],ctx.cfg.probe_ttl_days))throw new Error('官方模型探针过期或绑定不符');
      checkQoderBinding(f,binFor(ctx.cfg));
      return {ok:true,note:'仅模型路由机制；严格只读审核准入尚未完成'};
    }catch(e){return {ok:false,reason:(e as Error).message,fix:'doctor'};}
  },
  async run(ctx,req) {
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
    }catch(e){return fail(qoderFailureMessage(e));}
    const invoked=await invokeQoderModel({request:req.native_model,cwd:req.project_root,prompt:req.brief_text,timeoutMs:req.timeout_s*1000});
    await fs.mkdir(req.out_dir,{recursive:true});
    const stdout=path.join(req.out_dir,'stdout.ndjson'),trace=path.join(req.out_dir,'trace.json');
    await fs.writeFile(stdout,redactSecrets(invoked.outcome.stdout).content,{mode:0o600});
    await fs.writeFile(path.join(req.out_dir,'stderr.txt'),redactSecrets(invoked.outcome.stderr).content,{mode:0o600});
    await fs.writeFile(trace,JSON.stringify(invoked.evidence,null,2),{mode:0o600});
    const result=failedResult('qoder-cn',{status:invoked.outcome.timedOut?'timeout':'failed',reason:invoked.evidence.execution_failure??invoked.evidence.failure??invoked.evidence.verification_failure??'Qoder CN 执行未完成',
      exitCode:invoked.outcome.code,durationS:invoked.outcome.durationMs/1000,processStarted:invoked.outcome.spawned===true,
      rawStdoutPath:stdout,tracePath:trace,cliVersion:req.native_model.facts.cli_version,commandLine:invoked.outcome.commandLine});
    result.native_model=invoked.evidence;
    result.model_effective=invoked.effective.effective;result.model_effective_source=invoked.effective.source;
    if(invoked.ok){result.status='ok';result.fail_reason=null;result.raw_response_text=invoked.monitor.resultText;}
    return result;
  },
};
