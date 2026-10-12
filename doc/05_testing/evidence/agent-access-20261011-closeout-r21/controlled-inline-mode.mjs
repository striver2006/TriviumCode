/** 26B/r30批准；主设计#agent-access-inline-mode3-contract。只构造独立fixture配置，不改生产。 */
import crypto from 'node:crypto';
import {buildClaudeArgs} from '../../../../dist/test/src/trivium/adapters/claude.js';
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,wanted)=>object(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify([...wanted].sort());
class InlineModeError extends Error {}
function parseOriginal(json,liveInit){
 if(typeof json!=='string'||!json.length||!object(liveInit)||liveInit.permissionMode!=='default')throw new InlineModeError('missing-settings-or-live-default');
 let settings;try{settings=JSON.parse(json);}catch(error){if(error instanceof SyntaxError)throw new InlineModeError('damaged-original-json');throw error;}
 if(!keys(settings,['permissions'])||!keys(settings.permissions,['deny']))throw new InlineModeError('non-production-settings-shape');
 const deny=settings.permissions.deny;
 if(!Array.isArray(deny)||!deny.length||deny.some(v=>typeof v!=='string'||!v.length)||new Set(deny).size!==deny.length)throw new InlineModeError('invalid-original-deny');
 return deny;
}
export function buildInlineModeSettings(originalJson,liveInit){
 const deny=parseOriginal(originalJson,liveInit),proposedJson=JSON.stringify({permissions:{deny:[...deny],defaultMode:'default'}});
 return {schema:'controlled-inline-mode.v1',original_json:originalJson,proposed_json:proposedJson,original_sha256:digest(originalJson),proposed_sha256:digest(proposedJson),deny_sha256:digest(JSON.stringify(deny)),deny_count:deny.length,defaultMode:'default',explicit_deviation:'CLI inline adds permissions.defaultMode; original deny unchanged; not byte-identical production settings'};
}
/** 重算全部字段且逐项比较实际argv；未知内部错误不转为拒绝结果。 */
export function verifyInlineModeSettings(binding,baselineOptions,controlledOptions,liveInit){
 try{
  if(!object(binding)||!object(baselineOptions)||!object(controlledOptions))throw new InlineModeError('missing-inline-binding-or-options');
  const expected=buildInlineModeSettings(baselineOptions.settingsJson,liveInit);
  if(JSON.stringify(Object.keys(binding).sort())!==JSON.stringify(Object.keys(expected).sort())||Object.keys(expected).some(k=>binding[k]!==expected[k])||controlledOptions.settingsJson!==expected.proposed_json)throw new InlineModeError('inline-binding-or-proposed-settings-mismatch');
  const before=buildClaudeArgs(baselineOptions),after=buildClaudeArgs(controlledOptions),settings=before.flatMap((v,i)=>v==='--settings'?[i]:[]),actualSettings=after.flatMap((v,i)=>v==='--settings'?[i]:[]);
  if(settings.length!==1||actualSettings.length!==1||settings[0]!==actualSettings[0]||before.length!==after.length||before[settings[0]+1]!==expected.original_json||after[settings[0]+1]!==expected.proposed_json)throw new InlineModeError('nonunique-or-misplaced-settings-argument');
  const differences=before.flatMap((v,i)=>v!==after[i]?[i]:[]);
  if(differences.length!==1||differences[0]!==settings[0]+1)throw new InlineModeError('other-production-argv-difference');
  return {verified:true,reasons:[],binding:expected,baseline_argv_sha256:digest(JSON.stringify(before)),controlled_argv_sha256:digest(JSON.stringify(after)),changed_argument_indices:differences,deny_exactly_unchanged:true};
 }catch(error){if(!(error instanceof InlineModeError))throw error;return {verified:false,reasons:[error.message],binding:null,baseline_argv_sha256:null,controlled_argv_sha256:null,changed_argument_indices:[],deny_exactly_unchanged:false};}
}
