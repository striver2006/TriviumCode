/** 26B/r30：设计#agent-access-inline-mode3-contract；候选v3尚未采用。 */
import {evaluateControlledWithLifecycle} from '../agent-access-20261011-closeout-r19/controlled-mechanism.mjs';
import {verifyInlineModeSettings} from './controlled-inline-mode.mjs';
export function evaluateControlledMode3(raw,context){
 const result=evaluateControlledWithLifecycle(raw,context),inline=verifyInlineModeSettings(context?.inline_binding,context?.baseline_options,context?.controlled_options,context?.liveInit);
 const reasons=[...result.reasons,...inline.reasons];
 return {...result,schema:'controlled-mechanism-mode3.v1',criteria_candidate:'restricted-tool-surface-and-path-v3',inline_mode:inline,mechanism_pass:reasons.length===0,reasons:[...new Set(reasons)]};
}
