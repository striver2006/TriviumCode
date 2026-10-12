/** 26B/r30批准的1..32显式链；设计#agent-access-inline-mode3-contract。不采用准入判据。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {AUTH_ROUTE_KEYS,evaluateAuthTimestamp,differingPaths} from '../agent-access-20261011-closeout-r17/auth-timestamp-applicability.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const allowed=new Set(AUTH_ROUTE_KEYS.map(k=>JSON.stringify(['probe','auth_routes',k,'checked_at']))),iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const MAX_AUTH_HOPS=32;
class AuthChainError extends Error {}
/** 来源叶文件无软链，使用同fd读/hash并核前后身份；不输出私有内容。 */
export function loadAuthObservation(ref){
 if(!object(ref)||!path.isAbsolute(ref.path??'')||!sha(ref.sha256))throw new AuthChainError('invalid-observation-reference');
 let fd,bytes;
 try{
  const named=fs.lstatSync(ref.path);if(!named.isFile()||named.isSymbolicLink())throw new AuthChainError('nonregular-observation-source');
  fd=fs.openSync(ref.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const before=fs.fstatSync(fd);bytes=fs.readFileSync(fd);const after=fs.fstatSync(fd),again=fs.lstatSync(ref.path);
  if(!before.isFile()||!again.isFile()||again.isSymbolicLink()||named.dev!==before.dev||named.ino!==before.ino||before.dev!==again.dev||before.ino!==again.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||again.size!==after.size||again.mtimeMs!==after.mtimeMs||again.ctimeMs!==after.ctimeMs||hash(bytes)!==ref.sha256)throw new AuthChainError('observation-source-changed-or-hash-mismatch');
  let stored;try{stored=JSON.parse(bytes.toString('utf8'));}catch(error){if(error instanceof SyntaxError)throw new AuthChainError('damaged-observation-json');throw error;}
  if(!object(stored)||!Array.isArray(stored.changes))throw new AuthChainError('damaged-observation-shape');
  // 24B旧字段仅在permitted缺席时映射；两个字段矛盾不能通过覆盖隐藏。
  return {...stored,changes:stored.changes.map(change=>{if(!object(change))throw new AuthChainError('damaged-observation-change');if(Object.hasOwn(change,'auth_checked_at_only')&&Object.hasOwn(change,'permitted')&&change.auth_checked_at_only!==change.permitted)throw new AuthChainError('conflicting-observation-permission');return Object.hasOwn(change,'permitted')?change:{...change,permitted:change.auth_checked_at_only===true};})};
 }catch(error){if(['ENOENT','ENOTDIR','ELOOP','EACCES','EPERM'].includes(error?.code))throw new AuthChainError('missing-or-unreadable-observation-source');throw error;}
 finally{bytes?.fill(0);if(fd!==undefined)fs.closeSync(fd);}
}
/** 逐hop实读来源，不信caller声明；返回私有Buffer由caller清零。 */
export function reconstructAuthTimestampChain(c){
 if(!Buffer.isBuffer(c?.currentBytes)||!Array.isArray(c.hops)||c.hops.length<1||c.hops.length>MAX_AUTH_HOPS||!sha(c.expectedOldHash)||!sha(c.expectedCurrentHash)||hash(c.currentBytes)!==c.expectedCurrentHash)throw new AuthChainError('invalid-bounded-chain-or-current-hash');
 const refs=new Set(),refHashes=new Set(),configHashes=new Set(),hops=[];
 for(const hop of c.hops){const o=loadAuthObservation(hop?.ref);if(!object(hop.observation)||differingPaths(o,hop.observation).length)throw new AuthChainError('caller-observation-origin-mismatch');if(refs.has(hop.ref.path)||refHashes.has(hop.ref.sha256))throw new AuthChainError('duplicate-observation-reference');refs.add(hop.ref.path);refHashes.add(hop.ref.sha256);hops.push({...hop,observation:o});}
 configHashes.add(c.expectedOldHash);let expected=c.expectedOldHash;
 for(const hop of hops){const o=hop.observation;if(!sha(o.before_sha256)||!sha(o.current_sha256)||o.before_sha256!==expected||configHashes.has(o.current_sha256))throw new AuthChainError('noncontiguous-or-cyclic-config-chain');configHashes.add(o.current_sha256);expected=o.current_sha256;}
 if(expected!==c.expectedCurrentHash)throw new AuthChainError('latest-endpoint-hash-mismatch');
 let bytes=Buffer.from(c.currentBytes);const comparisons=[];
 try{
  for(let i=hops.length-1;i>=0;i--){const hop=hops[i],o=hop.observation;
   if(hash(bytes)!==o.current_sha256)throw new AuthChainError('intermediate-config-hash-mismatch');
   if(o.changes.length!==AUTH_ROUTE_KEYS.length||new Set(o.changes.map(x=>JSON.stringify(x.path))).size!==AUTH_ROUTE_KEYS.length||o.changes.some(x=>!allowed.has(JSON.stringify(x.path))||x.permitted!==true||!iso(x.old_value)||!iso(x.new_value)||Date.parse(x.new_value)<=Date.parse(x.old_value)))throw new AuthChainError('non-approved-hop-change');
   let text=bytes.toString('utf8');for(const change of o.changes){if(text.split(change.new_value).length!==2)throw new AuthChainError('nonunique-recorded-time-value');text=text.replace(change.new_value,change.old_value);}
   const old=Buffer.from(text);try{if(hash(old)!==o.before_sha256)throw new AuthChainError('reconstructed-hop-hash-mismatch');const result=evaluateAuthTimestamp({...c,oldBytes:old,currentBytes:bytes,expectedOldHash:o.before_sha256,expectedCurrentHash:o.current_sha256});if(!result.applicable_diagnostic)throw new AuthChainError('hop-semantic-comparison-failed');comparisons.unshift({observation_ref:hop.ref,old_complete_config_sha256:o.before_sha256,current_complete_config_sha256:o.current_sha256,raw_value_comparison:result.raw_value_comparison,changes:result.changes,applicable_diagnostic:true});bytes.fill(0);bytes=Buffer.from(old);}finally{old.fill(0);}
  }
  if(hash(bytes)!==c.expectedOldHash)throw new AuthChainError('end-to-end-origin-hash-mismatch');return {oldBytes:bytes,hops:comparisons};
 }catch(error){bytes.fill(0);throw error;}
}
export function evaluateAuthTimestampChain(c){
 let reconstructed;try{reconstructed=reconstructAuthTimestampChain(c);const result=evaluateAuthTimestamp({...c,oldBytes:reconstructed.oldBytes});return {...result,schema:'auth-timestamp-chain.v2',hops:reconstructed.hops,chain_reconstruction_verified:true,reconstructed_old_is_original_sample:false};}
 catch(error){if(!(error instanceof AuthChainError))throw error;return {...evaluateAuthTimestamp({...c,oldBytes:null}),schema:'auth-timestamp-chain.v2',hops:[],chain_reconstruction_verified:false,reconstructed_old_is_original_sample:false,applicable_diagnostic:false,reasons:['bounded-chain-not-applicable',error.message]};}
 finally{reconstructed?.oldBytes.fill(0);}
}
