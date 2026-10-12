/** 接线补强独立落盘manifest消费；初次派生件/来源记录保留。 */
import fs from 'node:fs';import path from 'node:path';
import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),sourceFile=root+'/controlled-fixture.mjs';let source=fs.readFileSync(sourceFile,'utf8');
if(hash(sourceFile)!=='bbcd6f7f4ba78ba637c5c3f0d767c5cd729e7081a32b94c1164913263a8c9539')throw Error('首次mode2派生件变化');
function replace(a,b){if(source.split(a).length!==2)throw Error('manifest接线锚点不唯一');source=source.replace(a,b);}
replace('productionDenyAfter,productionTargetsAfter;', 'productionDenyAfter,productionTargetsAfter,requestedFileHash;');
replace("save('requested.json',requested);process.env", "save('requested.json',requested);requestedFileHash=hash(out+'/requested.json');process.env");
replace('diagnostic=evaluateControlledWithLifecycle(raw??null,',"let manifest=null;try{if(!requestedFileHash||hash(out+'/requested.json')!==requestedFileHash)throw Error('requested-manifest-drift');manifest=JSON.parse(fs.readFileSync(out+'/requested.json','utf8')).target_manifest;}catch(error){failure=failure?new AggregateError([failure,error],'主失败与manifest失败'):error;}\ndiagnostic=evaluateControlledWithLifecycle(raw??null,");
replace('manifest_targets:targets??null,', 'manifest_targets:manifest?.targets??null,manifest_deny:manifest?.deny??null,');
const target=root+'/controlled-fixture-v2.mjs';fs.writeFileSync(target,source,{flag:'wx',mode:0o600});
saveEvidence(root+'/mode2-fixture-v2-origin.json',{at:new Date().toISOString(),prior_ref:{path:sourceFile,sha256:hash(sourceFile)},current_ref:{path:target,sha256:hash(target)},generator_sha256:hash(new URL(import.meta.url)),guard_sha256:hash(root+'/controlled-mechanism.mjs'),helper_sha256:hash(root+'/controlled-runtime.mjs'),actual_production_invoker:true,persisted_manifest_revalidated:true,new_vendor_starts:0});
console.log(JSON.stringify({fixture_sha256:hash(target),new_vendor_starts:0}));
