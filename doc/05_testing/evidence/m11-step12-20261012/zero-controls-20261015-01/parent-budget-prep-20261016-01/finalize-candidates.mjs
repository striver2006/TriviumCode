/** 封装最终候选、全文差异与原内容备份，不执行或激活。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {hash,read,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname,old=path.resolve(here,'../s5-client-plan-20261016-01');
const diffs=[];
for(const file of ['common.mjs','runtime.mjs','checkpoint.mjs','fixture-step.mjs','proposed-wrapper.sh']){
 const r=spawnSync('/usr/bin/diff',['-u',old+'/'+file,here+'/'+file],{encoding:'utf8',maxBuffer:2*1024*1024});assert([0,1].includes(r.status));
 diffs.push({file,old_sha256:hash(old+'/'+file),candidate_sha256:hash(here+'/'+file),exit_code:r.status,diff:r.stdout});
}
saveEvidence(here+'/candidate-diffs-final.json',{at:new Date().toISOString(),diffs,added_sources:[{file:'budget-binding.mjs',content:fs.readFileSync(here+'/budget-binding.mjs','utf8'),sha256:hash(here+'/budget-binding.mjs')}],activation_diff:'activation-diff.json',precedence:'本文件为最终差异；candidate-diffs.json保留首次生成快照'});
fs.writeFileSync(here+'/candidate-final.patch',diffs.map(x=>x.diff).join('\n'),{flag:'wx',mode:0o600});
const files=['common.mjs','runtime.mjs','checkpoint.mjs','fixture-step.mjs','proposed-wrapper.sh','budget-binding.mjs','deployment.json','ledger-baseline.json','activation-diff.json'];
saveEvidence(here+'/candidate-manifest.json',{at:new Date().toISOString(),activation_authorized:false,parent_control_verified:null,files:files.map(file=>({file,sha256:hash(here+'/'+file)})),old_proposal_sha256:hash(old+'/proposal-manifest.json')});
saveEvidence(here+'/launch-binding-template.json',{template_only:true,schema:'s5-budget-binding.v2',batch_id:null,baseline_digest:read(here+'/ledger-baseline.json').digest,expected_counts:null,expected_digest:null,driver_starts:null,scope:'只能由未来已验证父级的实际记录填充；本轮不生成launch-binding.json'});
console.log(JSON.stringify({final_candidate_files:files.length,activated:false}));
