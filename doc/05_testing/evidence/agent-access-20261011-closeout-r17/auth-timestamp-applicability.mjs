/** 24B具名时间戳候选的只读诊断；不修改canonical或消费任何批准。 */
import crypto from 'node:crypto';
import YAML from 'yaml';
export const AUTH_ROUTE_KEYS=Object.freeze([
 '27e1e0415da4ea47b713096a0367b63f1fac9b0b780cfb4d556bc8874a5182fb',
 'c9529bd415278c064fc7b5bf8b367870c72b53264d58cfad154af59e59600bd4',
 'ce0accbd74848643cf2f4e899d651d442af4410c42e6d185a42cb2a6dc53a671',
]);
export const COMPONENT_KINDS=Object.freeze(['build-inputs','source-bundle','installed-bundle','shared-config','globals','modules','assets','entry','native-entry','profile-config','route-configuration','canonical-source','cli-version-fact','model-effort']);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
/** 比较原值，输出只带路径；凭据值不得进入诊断。 */
export function differingPaths(a,b,at=[]){
 if(Object.is(a,b))return[];
 if(Array.isArray(a)&&Array.isArray(b)){
  if(a.length!==b.length)return[at];
  return a.flatMap((v,i)=>differingPaths(v,b[i],[...at,String(i)]));
 }
 if(object(a)&&object(b))return[...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(k=>
  !Object.hasOwn(a,k)||!Object.hasOwn(b,k)?[[...at,k]]:differingPaths(a[k],b[k],[...at,k]));
 return[at];
}
export function evaluateAuthTimestamp(c){
 const reasons=[],changes=[];let rawComparison=false;
 const done=()=>({schema:'auth-timestamp-applicability.v1',criteria_version:'auth-cache-timestamp-applicability-v1',diagnostic_only:true,raw_value_comparison:rawComparison,old_complete_config_sha256:Buffer.isBuffer(c?.oldBytes)?hash(c.oldBytes):null,current_complete_config_sha256:Buffer.isBuffer(c?.currentBytes)?hash(c.currentBytes):null,changes,components:c?.components??[],source_refs:c?.sourceRefs??[],configuration_consumption_refs:c?.consumptionRefs??[],criteria_approval_ref:null,applicable_diagnostic:reasons.length===0,reasons:[...new Set(reasons)],can_prove:['本次三具名认证checked_at更新前后，已列本机配置原值与证据指纹的有限适用性','只限显式原件及已采样读取/拒绝事实的指纹比较'],cannot_prove:['上游服务或服务端身份稳定','认证探活等于能力重测','未测或false负对照通过','未来版本、其它时间戳或其它配置变化适用'],changes_canonical_original_status:false});
 if(!object(c)||!Buffer.isBuffer(c.oldBytes)||!Buffer.isBuffer(c.currentBytes)){reasons.push('missing-raw-config-bytes');return done();}
 if(!/^[a-f0-9]{64}$/.test(c.expectedOldHash??'')||hash(c.oldBytes)!==c.expectedOldHash)reasons.push('old-config-origin-hash-mismatch');
 if(!/^[a-f0-9]{64}$/.test(c.expectedCurrentHash??'')||hash(c.currentBytes)!==c.expectedCurrentHash)reasons.push('current-config-hash-mismatch');
 const oldDoc=YAML.parseDocument(c.oldBytes.toString('utf8'),{uniqueKeys:true}),newDoc=YAML.parseDocument(c.currentBytes.toString('utf8'),{uniqueKeys:true});
 if(oldDoc.errors.length||newDoc.errors.length){reasons.push('damaged-yaml');return done();}
 const old=oldDoc.toJSON(),current=newDoc.toJSON();if(!object(old)||!object(current)){reasons.push('non-object-config');return done();}
 rawComparison=true;
 const diffs=differingPaths(old,current),allowed=new Set(AUTH_ROUTE_KEYS.map(k=>JSON.stringify(['probe','auth_routes',k,'checked_at'])));
 if(diffs.length!==AUTH_ROUTE_KEYS.length||diffs.some(p=>!allowed.has(JSON.stringify(p))))reasons.push('non-approved-config-difference');
 for(const key of AUTH_ROUTE_KEYS){
  const a=old.probe?.auth_routes?.[key],b=current.probe?.auth_routes?.[key];
  if(!object(a)||!object(b)||a.ok!==true||b.ok!==true){reasons.push('missing-or-unsuccessful-auth:'+key);continue;}
  if(!object(a.combination)||!object(b.combination)||!a.fingerprint||!a.cli_version)reasons.push('incomplete-auth-identity:'+key);
  if(!iso(a.checked_at)||!iso(b.checked_at)||Date.parse(b.checked_at)<=Date.parse(a.checked_at))reasons.push('invalid-or-nonincreasing-time:'+key);
  const ap={...a},bp={...b};delete ap.checked_at;delete bp.checked_at;
  if(differingPaths(ap,bp).length)reasons.push('auth-nontimestamp-change:'+key);
  changes.push({path:['probe','auth_routes',key,'checked_at'],old_value:a.checked_at??null,new_value:b.checked_at??null,old_ok:a.ok,new_ok:b.ok});
 }
 // 原值差异仅输出路径，不能先脱敏后作“相同”比较。
 for(const p of diffs.filter(p=>!allowed.has(JSON.stringify(p))))changes.push({path:p,unapproved_difference:true});
 if(!Array.isArray(c.sourceRefs)||!c.sourceRefs.length||c.sourceRefs.some(r=>!object(r)||typeof r.path!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256??'')))reasons.push('missing-source-origin');
 if(!Array.isArray(c.consumptionRefs)||!c.consumptionRefs.length||c.consumptionRefs.some(r=>typeof r.path!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256??'')))reasons.push('missing-configuration-consumption');
 if(!Array.isArray(c.components)||!c.components.length)reasons.push('missing-component-comparison');
 else{
  for(const kind of COMPONENT_KINDS)if(!c.components.some(x=>x.kind===kind))reasons.push('missing-component-kind:'+kind);
  for(const x of c.components)if(!object(x)||!COMPONENT_KINDS.includes(x.kind)||typeof x.name!=='string'||!Object.hasOwn(x,'expected')||!Object.hasOwn(x,'observed')||x.expected===null||x.observed===null||differingPaths(x.expected,x.observed).length)reasons.push('component-mismatch:'+String(x?.name));
 }
 if(c.latestLeak!==false||c.latestActualInterceptionFailure!==false)reasons.push('latest-safety-fact-missing-or-failed');
 return done();
}
