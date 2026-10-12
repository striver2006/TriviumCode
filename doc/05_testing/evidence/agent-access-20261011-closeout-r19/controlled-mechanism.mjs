/** 本取证accept/reject须具名敏感审查与批准：设计#agent-access-evidence-guard-contract，25B/r28。 */
import {evaluateControlled} from '../agent-access-20261011-closeout-r17/controlled-mechanism.mjs';
import {TRANSPORT_LIMITS} from './controlled-runtime.mjs';
const list=a=>Array.isArray(a)&&a.length>0&&a.every(p=>typeof p==='string'&&p.length>0)&&new Set(a).size===a.length;
const equal=(a,b)=>list(a)&&list(b)&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
/** 生产枚举及manifest两源交叉，最终限额/模式文件/全部清理不再由caller自行补布尔。 */
export function evaluateControlledWithLifecycle(raw,context){
 const result=evaluateControlled(raw,context),reasons=[...result.reasons],lifecycle=context?.lifecycle;
 const denyKnown=equal(context?.production_deny_before,context?.production_deny_after)&&equal(context?.production_deny_before,context?.manifest_deny)&&equal(context?.production_targets_before,context?.production_targets_after)&&equal(context?.production_targets_before,context?.targets)&&equal(context?.production_targets_before,context?.manifest_targets);
 if(!denyKnown)reasons.push('production-manifest-target-mismatch');
 const cleanup=context?.cleanup;if(!cleanup||Object.keys(cleanup).length!==4||['server_closed','home_removed','fixture_removed','mode_settings_removed'].some(k=>cleanup[k]!==true))reasons.push('cleanup-incomplete');
 const transport=context?.transport;
 if(!transport||transport.host!=='127.0.0.1'||transport.handlers_finished!==true||transport.server_closed!==true||transport.within_limits!==true||!Array.isArray(transport.errors)||transport.errors.length!==0||Object.entries(TRANSPORT_LIMITS).some(([k,v])=>transport.limits?.[k]!==v)||!Number.isSafeInteger(transport.requests)||transport.requests<1||transport.requests>TRANSPORT_LIMITS.requests||!Number.isSafeInteger(transport.bodyBytes)||transport.bodyBytes<0||transport.bodyBytes>TRANSPORT_LIMITS.total_body_bytes)reasons.push('transport-incomplete-or-limit-failure');
 if(!transport||!Number.isSafeInteger(transport.max_request_bytes)||transport.max_request_bytes<0||transport.max_request_bytes>TRANSPORT_LIMITS.per_request_bytes||!Number.isSafeInteger(transport.started_at)||!Number.isSafeInteger(transport.finished_at)||transport.finished_at<transport.started_at||transport.finished_at-transport.started_at>TRANSPORT_LIMITS.runtime_ms)reasons.push('transport-byte-or-runtime-fact-invalid');
 if(!lifecycle||lifecycle.before?.valid!==true||lifecycle.after?.valid!==true||lifecycle.before.single_key!==true||lifecycle.after.single_key!==true||lifecycle.before.mode!==0o600||lifecycle.after.mode!==0o600||typeof lifecycle.before.sha256!=='string'||!/^[a-f0-9]{64}$/.test(lifecycle.before.sha256)||lifecycle.before.sha256!==lifecycle.after.sha256||!Number.isSafeInteger(lifecycle.before.bytes)||lifecycle.before.bytes<=0||lifecycle.before.bytes!==lifecycle.after.bytes||lifecycle.removed!==true)reasons.push('mode-settings-lifecycle-invalid');
 if(context?.failure!==null)reasons.push('fixture-error');
 return {...result,file_states:{before:context?.before??null,after:context?.after??null},production_enumeration:{before:{deny:context?.production_deny_before??null,targets:context?.production_targets_before??null},after:{deny:context?.production_deny_after??null,targets:context?.production_targets_after??null}},production_target_count:denyKnown?context.production_targets_before.length:null,production_manifest_verified:denyKnown,mode_settings:lifecycle??null,limits:transport??null,cleanup:cleanup??null,mechanism_pass:reasons.length===0,reasons:[...new Set(reasons)]};
}
