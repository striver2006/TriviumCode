/** 仅本轮编排元数据脚本派生；不实现待审inline/链/consumer。 */
import fs from 'node:fs';import path from 'node:path';import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),parent=path.resolve(root,'../agent-access-20261011-closeout-r18'),origins=[];
function derive(name,edits){let s=fs.readFileSync(parent+'/'+name,'utf8');for(const[from,to]of edits){if(!s.includes(from))throw Error('缺精确来源锚:'+name);s=s.split(from).join(to);}const target=name.replace('25','26');fs.writeFileSync(root+'/'+target,s,{flag:'wx',mode:0o600});origins.push({source:parent+'/'+name,source_sha256:hash(parent+'/'+name),target:root+'/'+target,target_sha256:hash(root+'/'+target)});}
const common=[['plan25','plan26'],['round25','round26'],['before25','before26'],['after25','after26'],['r36','r38'],['launch-v18','launch-v19']];
derive('invoke-plan25.mjs',[...common,['>333','>348'],['!==333','!==348']]);
let s=fs.readFileSync(parent+'/resolve-plan25.mjs','utf8');
const additional=[
 '.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r28-codex.md',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r20/consolidated-gap-plan-proposal.md',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r20/formal-round26-27-authorization-verification.json',
 ...['mode2-stop-export.json','mode2-readonly-diagnosis.json','controlled-fixture-v3.mjs','controlled-runtime.mjs','controlled-mechanism.mjs','auth-timestamp-chain.mjs','run-auth-timestamp-diagnostic-v3.mjs','auth-timestamp-diagnostic-v3.json','auth-v3-chain-schema-validation.json','auth-timestamp-chain.v1.schema.json','controlled-mechanism-mode2.v1.schema.json','mode2-launch-guard.mjs','mode2-launch-measurement.mjs','mode2-proof.mjs','launch-controlled-mode2.mjs','controlled-mode2-pilot-batch-v2.json','mode2-pilot-completion-v2.json','mode2-launch-static-v2-checks.json'].map(n=>'doc/05_testing/evidence/agent-access-20261011-closeout-r19/'+n),
 ...['00-raw.json','01-requested.json','02-result.json','03-transport-observations.json','04-bridge.json'].map(n=>'doc/05_testing/evidence/agent-access-20261011-closeout-r19/controlled-mode2-qwen-originals/'+n),
 'test/unit/agent-access-controlled-runtime.test.ts','test/unit/agent-access-mode2-launch.test.ts'];
const anchor='for(const f of context)';if(!s.includes(anchor))throw Error('缺context追加锚');s=s.replace(anchor,'context.push(...'+JSON.stringify(additional)+');\n'+anchor);
for(const[from,to]of [['plan25','plan26'],['r36','r38'],['launch-v18','launch-v19'],['formal-round-authorization-v14.json','formal-round-authorization-v15.json']]){if(!s.includes(from))throw Error('缺resolve来源锚:'+from);s=s.split(from).join(to);}
fs.writeFileSync(root+'/resolve-plan26.mjs',s,{flag:'wx',mode:0o600});origins.push({source:parent+'/resolve-plan25.mjs',source_sha256:hash(parent+'/resolve-plan25.mjs'),target:root+'/resolve-plan26.mjs',target_sha256:hash(root+'/resolve-plan26.mjs')});
saveEvidence(root+'/review26-assets-origin.json',{at:new Date().toISOString(),origins,source_sensitive_helpers_unchanged:true,only_orchestration_records:true,new_vendor_starts:0});console.log(JSON.stringify({assets:origins.length,new_vendor_starts:0}));
