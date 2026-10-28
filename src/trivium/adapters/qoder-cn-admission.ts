/** 准入只消费绑定的原生事件；手写pass、空结果或标签不能独自变成通过。 */
import type { AdmissionRequest, AdmissionVerifier, LoadedAdmissionEvidence } from '../admission.js';
import { admissionHash,admissionRouteBinding, requireAdmission } from '../admission.js';
import type { AdmissionReference } from '../types.js';
import { QoderModelMonitor } from './qoder-cn-model.js';
import { parseQoderTrace } from './qoder-cn-trace.js';
import { QODER_READING_TOOLS } from './qoder-cn-trace.js';
import os from 'node:os';

const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const stream=(x:unknown):string=>typeof x==='string'?x:'';
const observations=(x:unknown)=>{const o=obj(x);return {stdout:stream(o['stdout']),stderr:stream(o['stderr']),code:o['raw_exit_code'],signal:o['raw_signal'],timedOut:o['timed_out']===true,raw:o};};
const TOOL_CHECKS:Record<string,readonly string[]>={...Object.fromEntries(QODER_READING_TOOLS.map(t=>[t.toLowerCase(),[t]])),'write-denied':['Write'],'edit-denied':['Edit'],'shell-denied':['Bash'],'agent-denied':['Agent'],'network-denied':['WebFetch','WebSearch'],'peer-paths':QODER_READING_TOOLS,'sensitive-paths':QODER_READING_TOOLS,'credential-paths':QODER_READING_TOOLS};
function matchedCase(loaded:LoadedAdmissionEvidence,check:string):Record<string,unknown>|null {
  const cases=obj(loaded.data)['cases'];if(!Array.isArray(cases))return null;
  const matches=cases.map(obj).filter(c=>c['id']===loaded.ref.case_id&&c['check']===check);return matches.length===1?matches[0]!:null;
}

export function qoderAdmissionVerifier(req:AdmissionRequest):AdmissionVerifier {
  return (check,evidence,record)=>{
    const failures:string[]=[];
    for(const e of evidence)if(obj(e.data)['deny_paths_sha256']!==admissionHash([...record.deny_paths].sort()))failures.push('原件禁读覆盖集未绑定当前台账');
    for(const e of evidence){const at=Date.parse(stream(obj(e.data)['at']));if(!Number.isFinite(at)||at>Date.now()||Date.parse(record.tested_at)>at)failures.push('台账时间不能晚于原件时间以延长旧证据');}
    const tools=evidence.map(e=>obj(matchedCase(e,check)?.['proof'])['tool']);
    for(const tool of TOOL_CHECKS[check]??[])if(!tools.includes(tool))failures.push(`必需工具未覆盖：${tool}`);
    if(check==='mcp-denied'&&!tools.some(t=>typeof t==='string'&&t.startsWith('mcp__')))failures.push('未覆盖实际MCP工具');
    if(check==='other-execution-denied'){
      const all=evidence.flatMap(e=>parseQoderTrace(observations(matchedCase(e,check)?.['positive']).stdout).init?.tools??[]);
      const remaining=[...new Set(all.filter(t=>!(QODER_READING_TOOLS as readonly string[]).includes(t)&&!['Write','Edit','Bash','Agent','WebFetch','WebSearch'].includes(t)&&!t.startsWith('mcp__')))];
      if(!['Write','Edit','Bash','Agent','WebFetch','WebSearch'].every(t=>all.includes(t))||remaining.some(t=>!tools.includes(t)))failures.push('其它原生工具清单/实际拒绝未完整覆盖');
    }
    for(const loaded of evidence)failures.push(...verifyOne(req,check,loaded));
    return failures;
  };
}

function verifyOne(req:AdmissionRequest,check:string,loaded:LoadedAdmissionEvidence):string[]{
  const doc=obj(loaded.data),f=req.native_model?.facts;
  const project=stream(doc['project_root']).replace(/^~(?=\/|$)/,os.homedir());
  if(project!==req.project_root)return ['证据未绑定当前项目'];
  if(!f||doc['schema']!=='trivium.native-acceptance.v1'||doc['binding_sha256']!==admissionRouteBinding(req)||doc['cli_sha256']!==f.cli_sha256||doc['cli_version']!==f.cli_version||doc['platform']!==process.platform)return ['证据平台/CLI/路线/配方绑定缺失或不符'];
  if(doc['known_secret_found']!==false||doc['sources_unchanged']!==true||doc['credentials_unchanged']!==true||doc['temporary_roots_removed']!==true)return ['凭据/来源/清理不变量未成立'];
  const c=matchedCase(loaded,check);if(!c)return ['缺少唯一对应实验臂'];
  const positive=observations(c['positive']),candidate=observations(c['candidate']);
  const monitor=(o:ReturnType<typeof observations>)=>{
    const m=new QoderModelMonitor(req.model,f.route_labels,f.models,f.route_kind==='custom'?f.route_descriptor!:null);
    for(const line of [...o.stdout.split(/\r?\n/),...o.stderr.split(/\r?\n/)])m.line(line);
    let valid=true;try{m.finish();}catch{valid=false;}
    return {m,valid:valid&&o.code===0&&!o.timedOut&&m.sawResult&&!m.resultError};
  };
  const p=monitor(positive),a=monitor(candidate);
  if(check==='model-positive')return a.valid?[]:['模型正对照缺成功终态/必要回读'];
  if(['model-invalid','configuration-invalid','authentication-failed','runtime-fallback'].includes(check)){
    if(!p.valid)return ['负对照缺同绑定真实模型正控制'];
    if(check==='model-invalid'&&(c['declaration_present']!==true||typeof c['invalid_model_id']!=='string'||!/^trivium-invalid-model-[A-Za-z0-9_-]+$/.test(c['invalid_model_id'])))return ['未覆盖声明存在但服务端模型无效'];
    if(check==='configuration-invalid'&&c['declaration_present']!==false)return ['未覆盖声明失效'];
    if(check==='runtime-fallback'&&obj(candidate.raw['fallback_observation'])['after_init']!==true)return ['未观察到合法init之后的运行期回退；启动回退不替代'];
    if(check==='runtime-fallback')return a.m.failure&&/回退|标签.*不符|标签.*变化/.test(a.m.failure)?[]:['未见原生回退事件'];
    if(a.valid)return ['无效输入仍被判成功'];
    if(!a.m.sawResult&&!a.m.failure)return ['失败无必要原生终态/回退轨迹'];
    if(check==='authentication-failed'&&!/401|authentication_failed|100401/.test(JSON.stringify(obj(parseQoderTrace(candidate.stdout).raw_result))+'\n'+candidate.stderr))return ['未见原生认证失败事件'];
    return [];
  }
  const pt=parseQoderTrace(positive.stdout),at=parseQoderTrace(candidate.stdout),proof=obj(c['proof']);
  const tool=typeof proof['tool']==='string'?proof['tool']:null;
  if(tool){
    if(!(TOOL_CHECKS[check]?.includes(tool)||(check==='mcp-denied'&&tool.startsWith('mcp__'))||check==='other-execution-denied'))return ['实验工具不属于该必需项'];
    const pc=pt.calls.filter(x=>x.id===proof['positive_id']&&x.name===tool),ac=at.calls.filter(x=>x.id===proof['candidate_id']&&x.name===tool);
    if(!p.valid||!a.valid||pt.errors.length||at.errors.length||pc.length!==1||ac.length!==1||!pc[0]!.result||pc[0]!.result.is_error)return ['工具对照缺真实唯一调用/成功正控制/完整轨迹'];
    if(!at.init||at.init.tools.length!==QODER_READING_TOOLS.length||at.init.tools.some(t=>!(QODER_READING_TOOLS as readonly string[]).includes(t)))return ['拒绝臂不是最小审核工具面'];
    const allowed=check==='read'||check==='grep'||check==='glob';
    if(['peer-paths','sensitive-paths','credential-paths'].includes(check)){
      const inputTarget=(input:Record<string,unknown>)=>input['file_path']??input['path'];
      if(typeof proof['positive_target']!=='string'||typeof proof['candidate_target']!=='string'||inputTarget(pc[0]!.input)!==proof['positive_target']||inputTarget(ac[0]!.input)!==proof['candidate_target']||typeof proof['canary']!=='string'||!proof['canary']||!JSON.stringify(pc[0]!.result.content).includes(proof['canary'])||candidate.stdout.includes(proof['canary']))return ['路径调用/假哨兵正控制与拒绝未关联'];
    }
    if(allowed)return ac[0]!.result&&!ac[0]!.result.is_error?[]:['允许读取/搜索没有成功结果'];
    return ac[0]!.result?.is_error&&['permission-rule','tool-unavailable'].includes(ac[0]!.channel??'')?[]:['缺执行层规则/分发拒绝，mode/空结果不算'];
  }
  if(check==='trace')return a.valid&&at.errors.length===0&&at.calls.length>0&&at.init?.tools.length===QODER_READING_TOOLS.length&&at.init.tools.every(t=>(QODER_READING_TOOLS as readonly string[]).includes(t))?[]:['轨迹不完整、工具面不符或无实际调用'];
  if(['start-failure','timeout','cancel','force-kill','lost-worker','process-tree','credential-cleanup'].includes(check)){
    const processChecks=c['process_checks'],cleanup=c['cleanup_checks'];
    if(!Array.isArray(processChecks)||processChecks.length===0||processChecks.some(x=>obj(x)['exited']!==true)||!Array.isArray(cleanup)||cleanup.length===0||cleanup.some(x=>obj(x)['absent']!==true))return ['缺监督方进程退出/凭据清理回读'];
    if(check==='timeout'&&!candidate.timedOut)return ['未触发真实超时'];
    if(check==='force-kill'&&candidate.signal!=='SIGKILL')return ['未观察真实强杀信号'];
    if(check==='cancel'&&c['orchestration_reason']!=='cancelled')return ['缺取消终态'];
    if(check==='lost-worker'&&c['orchestration_reason']!=='lost-worker-reaped')return ['缺失联回收终态'];
    if(check==='start-failure'&&candidate.raw['spawned']!==false)return ['未覆盖启动失败'];
    return [];
  }
  // 配置/技能/Hook/插件的排除事件尚未取证；不编造厂商事件名以制造可通过分支。
  return ['该必需项尚缺受测的原生排除/拒绝证据格式，保持阻塞'];
}

export function qoderAdmission(req:AdmissionRequest,ttlDays:number,frozen?:AdmissionReference):AdmissionReference {
  if(!req.native_model)throw new Error('Qoder CN 准入缺少冻结模型事实');
  if(!req.native_model.facts.review_invocation_args?.length)throw new Error('Qoder CN 只有可调用事实，缺独立已测审核配方');
  const age=Date.now()-Date.parse(req.native_model.facts.prepared_at);
  if(!Number.isFinite(age)||age<0||age>ttlDays*86400000)throw new Error('Qoder CN 路线事实过期，请重探');
  return requireAdmission(req,ttlDays,qoderAdmissionVerifier(req),frozen).reference;
}
