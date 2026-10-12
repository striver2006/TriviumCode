/** 25B/r28具名双跳只读守卫，设计#agent-access-evidence-guard-contract；不批准证据采用。 */
import crypto from 'node:crypto';
import {AUTH_ROUTE_KEYS,evaluateAuthTimestamp} from '../agent-access-20261011-closeout-r17/auth-timestamp-applicability.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const allowed=new Set(AUTH_ROUTE_KEYS.map(k=>JSON.stringify(['probe','auth_routes',k,'checked_at'])));
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
class AuthChainError extends Error {}
/** hops按旧到新，反向只替换已审原值，再逐跳验证完整字节hash。返回私有Buffer须由caller清空。 */
export function reconstructAuthTimestampChain(c){
 if(!Buffer.isBuffer(c?.currentBytes)||!Array.isArray(c.hops)||c.hops.length!==2||!sha(c.expectedOldHash)||!sha(c.expectedCurrentHash)||hash(c.currentBytes)!==c.expectedCurrentHash)throw new AuthChainError('invalid-double-hop-input-or-current-hash');
 let bytes=Buffer.from(c.currentBytes);const comparisons=[];
 try{
  for(let i=c.hops.length-1;i>=0;i--){
   const hop=c.hops[i],o=hop?.observation;
   if(!o||!sha(o.before_sha256)||!sha(o.current_sha256)||!hop.ref||typeof hop.ref.path!=='string'||!sha(hop.ref.sha256)||hash(bytes)!==o.current_sha256)throw new AuthChainError('missing-hop-origin-or-hash-mismatch');
   if(i>0&&c.hops[i-1]?.observation?.current_sha256!==o.before_sha256)throw new AuthChainError('noncontiguous-hop-chain');
   if(!Array.isArray(o.changes)||o.changes.length!==AUTH_ROUTE_KEYS.length||new Set(o.changes.map(x=>JSON.stringify(x.path))).size!==AUTH_ROUTE_KEYS.length||o.changes.some(x=>!allowed.has(JSON.stringify(x.path))||x.permitted!==true||!iso(x.old_value)||!iso(x.new_value)||Date.parse(x.new_value)<=Date.parse(x.old_value)))throw new AuthChainError('non-approved-hop-change');
   let text=bytes.toString('utf8');
   for(const change of o.changes){if(text.split(change.new_value).length!==2)throw new AuthChainError('nonunique-recorded-time-value');text=text.replace(change.new_value,change.old_value);}
   const old=Buffer.from(text);
   try{
    if(hash(old)!==o.before_sha256)throw new AuthChainError('reconstructed-hop-hash-mismatch');
    const result=evaluateAuthTimestamp({...c,oldBytes:old,currentBytes:bytes,expectedOldHash:o.before_sha256,expectedCurrentHash:o.current_sha256});
    if(!result.applicable_diagnostic)throw new AuthChainError('hop-semantic-comparison-failed');
    comparisons.unshift({observation_ref:hop.ref,old_complete_config_sha256:o.before_sha256,current_complete_config_sha256:o.current_sha256,raw_value_comparison:result.raw_value_comparison,changes:result.changes,applicable_diagnostic:true});
    bytes.fill(0);bytes=Buffer.from(old);
   }finally{old.fill(0);}
  }
  if(hash(bytes)!==c.expectedOldHash)throw new AuthChainError('end-to-end-origin-hash-mismatch');
  return {oldBytes:bytes,hops:comparisons};
 }catch(error){bytes.fill(0);throw error;}
}
export function evaluateAuthTimestampChain(c){
 let reconstructed;
 try{
  reconstructed=reconstructAuthTimestampChain(c);
  const result=evaluateAuthTimestamp({...c,oldBytes:reconstructed.oldBytes});
  return {...result,hops:reconstructed.hops,chain_reconstruction_verified:true,reconstructed_old_is_original_sample:false};
 }catch(error){
  if(!(error instanceof AuthChainError))throw error;
  // 只暴露本模块常量错误，不打印原始配置、YAML片段或凭据值。
  return {...evaluateAuthTimestamp({...c,oldBytes:null}),hops:[],chain_reconstruction_verified:false,reconstructed_old_is_original_sample:false,applicable_diagnostic:false,reasons:['double-hop-not-applicable',error instanceof Error?error.message:'unknown-double-hop-error']};
 }finally{reconstructed?.oldBytes.fill(0);}
}
