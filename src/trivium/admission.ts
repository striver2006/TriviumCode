/** 项目级组合准入。宿主可改全部文件，本模块不声称抗宿主篡改。 */
import { readFileSync, realpathSync, lstatSync, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AdmissionRecord, AdmissionReference, AdmissionEvidenceRef, CriticRequest } from './types.js';
import { agentById } from './agents/registry.js';
import { validateAdmission } from './schemas.js';
import { withGlobalLock } from './lock.js';
import { writeAtomic } from './util/fsx.js';

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export const admissionHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const bytesHash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
export type AdmissionRequest=Pick<CriticRequest,'critic'|'project_root'|'model'|'native_model'>&Partial<Pick<CriticRequest,'deny_paths'>>;
export function admissionRouteBinding(req:AdmissionRequest):string {
  const f=req.native_model?.facts;
  return admissionHash({agent:req.critic,model:req.model,platform:process.platform,arch:process.arch,
    native:f?{entrypoint:f.entrypoint,cli_sha256:f.cli_sha256,cli_version:f.cli_version,platform:f.platform,route_kind:f.route_kind??'official',route_descriptor:f.route_descriptor??null,
      configuration_sha256:f.configuration_sha256,invocation_args:f.invocation_args,review_invocation_args:f.review_invocation_args??null}:null});
}
export type LoadedAdmissionEvidence={ref:AdmissionEvidenceRef;data:unknown};
export type AdmissionVerifier=(check:string,evidence:readonly LoadedAdmissionEvidence[],record:AdmissionRecord)=>string[];

function readLedger(root:string):{schema:'trivium.admission.v1';records:AdmissionRecord[]} {
  try{
    const file=path.join(root,'.trivium/admission.local.json');if(realpathSync(file)!==file||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw new Error();
    const data=JSON.parse(readFileSync(file,'utf8'));
    if(validateAdmission(data).length)throw new Error();
    return data as {schema:'trivium.admission.v1';records:AdmissionRecord[]};
  }catch{throw new Error('本项目准入台账缺失或无效，拒绝；请完成真实验收');}
}

/** 只校验冻结记录，不回落其它记录；厂商验证器必须复核原生证据含义。 */
export function requireAdmission(req:AdmissionRequest,ttlDays:number,verify:AdmissionVerifier,frozen?:AdmissionReference,now=Date.now()):{reference:AdmissionReference;record:AdmissionRecord} {
  const root=realpathSync(req.project_root),ledger=readLedger(root),binding=admissionRouteBinding(req);
  const candidates=ledger.records.filter(r=>r.agent===req.critic&&r.project_root===root&&r.binding_sha256===binding);
  if(candidates.length!==1)throw new Error('当前平台/模型/隔离配方无唯一合格准入');
  const record=candidates[0]!,reference={record_id:record.record_id,record_sha256:admissionHash(record)};
  if(frozen&&(frozen.record_id!==reference.record_id||frozen.record_sha256!==reference.record_sha256))throw new Error('准入记录自冻结后已变化，拒绝重选');
  verifyAdmissionRecord(req,record,ttlDays,verify,now);
  return {reference,record};
}

/** 生成前与消费时使用同一验证器；不必先把候选记录写成可用台账。 */
export function verifyAdmissionRecord(req:AdmissionRequest,record:AdmissionRecord,ttlDays:number,verify:AdmissionVerifier,now=Date.now()):void {
  const root=realpathSync(req.project_root);
  if(validateAdmission({schema:'trivium.admission.v1',records:[record]}).length||record.agent!==req.critic||record.project_root!==root||record.binding_sha256!==admissionRouteBinding(req))throw new Error('准入候选形状/身份/项目/路线不符');
  const normalize=(p:string)=>{const file=path.resolve(root,p);try{return realpathSync(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return file;throw e;}};
  // 已验覆盖是冻结的路径，不随当前软链目标重新解释；请求同时核字面和规范目标。
  const covered=new Set(record.deny_paths.map(p=>path.resolve(root,p)));
  if(req.deny_paths?.some(p=>!covered.has(path.resolve(root,p))||!covered.has(normalize(p))))throw new Error('本次禁读矩阵超出准入已验覆盖，请重新验收');
  const tested=Date.parse(record.tested_at),expires=Date.parse(record.expires_at);
  if(!Number.isFinite(tested)||!Number.isFinite(expires)||tested>now||expires<=now||expires<=tested||expires>tested+ttlDays*86400000)throw new Error('准入证据过期、时间无效或超出TTL，请重验');
  const required=agentById(req.critic)?.admissionChecks;
  if(!required?.length)throw new Error('注册表未定义该侧的准入必需项');
  for(const check of required){
    const item=record.checks[check];
    if(item?.state!=='pass'||!item.evidence.length)throw new Error(`准入必需项未通过：${check}`);
    const evidence=item.evidence.map(ref=>{
      try{
        if(path.isAbsolute(ref.path)||ref.path.split(/[\\/]/).some(p=>p==='..'||p===''))throw new Error();
        const file=path.resolve(root,ref.path);
        if(realpathSync(file)!==file||!file.startsWith(root+path.sep)||!lstatSync(file).isFile())throw new Error();
        const bytes=readFileSync(file);if(bytesHash(bytes)!==ref.sha256)throw new Error();
        return {ref,data:JSON.parse(bytes.toString()) as unknown};
      }catch{throw new Error(`准入证据缺失、路径不安全、损坏或hash变化：${check}`);}
    });
    const failures=verify(check,evidence,record);if(failures.length)throw new Error(`准入原生证据不满足${check}：${failures.join('；')}`);
  }
}

/** 同组合覆盖，持项目全局锁原子替换；生成器仍须先验证全部真实证据。 */
export async function storeAdmission(projectRoot:string,record:AdmissionRecord):Promise<void>{
  const root=await fs.realpath(projectRoot),dir=path.join(root,'.trivium');
  if(record.project_root!==root)throw new Error('准入项目绑定不一致');
  await withGlobalLock({triviumDir:dir,heartbeatStaleMs:120000},async()=>{
    let ledger:{schema:'trivium.admission.v1';records:AdmissionRecord[]}={schema:'trivium.admission.v1',records:[]};
    try {await fs.lstat(path.join(dir,'admission.local.json'));ledger=readLedger(root);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const records=ledger.records.filter(r=>!(r.agent===record.agent&&r.binding_sha256===record.binding_sha256&&r.project_root===root));
    const next={schema:'trivium.admission.v1' as const,records:[...records,record]};
    if(validateAdmission(next).length)throw new Error('准入台账形状/身份不合法');
    const file=path.join(dir,'admission.local.json');await writeAtomic(file,JSON.stringify(next,null,2)+'\n');await fs.chmod(file,0o600);
  });
}
