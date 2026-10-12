/** 正常27C预检后的新采样；旧矩阵和停止批次原字节保留。 */
import fs from 'node:fs';import path from 'node:path';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),ref=n=>({path:root+'/'+n,sha256:hash(root+'/'+n)});
const old=JSON.parse(fs.readFileSync(root+'/matrix-after-mode3-first.json')),auth=JSON.parse(fs.readFileSync(root+'/auth-diagnostic-after27-preflight.json'));
if(!auth.applicable_diagnostic||auth.hops.length!==4||auth.current_complete_config_sha256!==hash('.trivium/config.local.yaml'))throw Error('当前四跳事实不符');
const rows=old.rows.map(r=>({...r,controlled_mode3_historical_status:r.controlled_mode3_status,controlled_mode3_historical_config_sha256:old.current_complete_config_sha256,controlled_mode3_historical_cli_model:r.controlled_mode3_cli_model,controlled_mode3_status:r.controlled_mode3_status==='不适用本批'?'不适用本批':'未测',controlled_mode3_cli_model:null,auth_diagnostic_applicable:true,auth_criterion_adopted:false,restricted_criterion_adopted:false}));
saveEvidence(root+'/matrix-after27-preflight.json',{...old,at:new Date().toISOString(),previous_matrix_ref:ref('matrix-after-mode3-first.json'),current_complete_config_sha256:auth.current_complete_config_sha256,auth_diagnostic_ref:ref('auth-diagnostic-after27-preflight.json'),rows,counts:{historical_pass:7,historical_untested:5,current_pass:0,current_untested:12,controlled_mode3_historical_proof_pass:1,controlled_mode3_current_proof_pass:0,controlled_mode3_current_untested:5},criterion_adopted:false,prerequisite_complete:false,previous_batch_stopped:true,previous_batch_resumed:false,new_vendor_starts:0});
console.log(JSON.stringify({rows:rows.length,current:'0通过/12未测',auth_hops:4,new_vendor_starts:0}));
