/** 第27C实际批准取证；旧冻结面只读，保存到新独立目录。 */
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {loadCtx} from '../../../../dist/test/src/trivium/config.js';import {getGate,listOpenGates} from '../../../../dist/test/src/trivium/state.js';import {readTask} from '../../../../dist/test/src/trivium/meta.js';import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口',ctx=await loadCtx(),gate=await getGate(ctx.triviumDir,topic,'code'),task=await readTask({archiveRoot:repo+'/.reviews',topic}),runPath=repo+'/.reviews/'+topic+'/code/_meta/run-20261011T212239Z.json',run=JSON.parse(fs.readFileSync(runPath));
if(gate.state!=='approved'||gate.run_id!==run.run_id||(await listOpenGates(ctx.triviumDir)).length!==0)throw Error('缺27C批准');
const approval=task.approvals.find(a=>a.run_id===run.run_id&&a.stage==='code'&&a.decision==='approved');
if(!approval||!approval.reason.includes('66dd93befe3bb878e76b95ad79e5b335c44e6c0351c4719615b488ef0461d436'))throw Error('实际批准未绑定裁决');
const frozen=JSON.parse(fs.readFileSync('doc/05_testing/evidence/agent-access-20261011-closeout-r21/frozen-before-round27.json'));
for(const[p,h]of Object.entries(frozen.hashes))if(hash(p)!==h)throw Error('27冻结内容变更');
for(const a of run.artifacts)if(hash(repo+'/.reviews/'+a.path)!==a.sha256)throw Error('27审查原件改变');
const response=repo+'/.reviews/'+topic+'/code/2026-10-12-'+topic+'-r13-response-codex.md';
if(hash(response)!=='66dd93befe3bb878e76b95ad79e5b335c44e6c0351c4719615b488ef0461d436')throw Error('裁决变化');
const {openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs'),budgets={};
for(const pool of ['admission','review']){const b=openBudget(process.env.HOME+'/.trivium/evidence/agent-access-20261011-closeout-r3/budget',pool),n=fs.readdirSync(b.dir);budgets[pool]={used:n.filter(x=>/^reserved-\d+\.json$/.test(x)).length,completed:n.filter(x=>/^launch-\d+\.json$/.test(x)).length,limit:b.limit()};if(budgets[pool].used!==budgets[pool].completed)throw Error('仍有在途CLI');}
const hashes={};function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.isFile())hashes[path.relative(repo,p)]=hash(p);}}
walk(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r21'));
saveEvidence(root+'/r21-preserved-snapshot.json',{at:new Date().toISOString(),root:repo,hashes});
saveEvidence(root+'/code27-approved-checkpoint.json',{at:new Date().toISOString(),script_sha256:hash(new URL(import.meta.url)),gate,approval,ordinary_delegated_approval:true,actual_operator:'codex',actual_session_id:approval.session_id??null,run_ref:{path:runPath,sha256:hash(runPath)},response_ref:{path:response,sha256:hash(response)},artifacts:run.artifacts,guard:run.guard,snapshot:run.snapshot,frozen_files_verified:Object.keys(frozen.hashes).length,source_stamp:await computeBuildStamp(repo),bundle_sha256:hash('skills/dual-critic/scripts/trivium.cjs'),config_local_sha256:hash('.trivium/config.local.yaml'),budgets,formal:{used:task.runs.length,limit:27},criterion_adopted:false,previous_mode3_batch_stopped:true,prerequisite_complete:false,new_vendor_starts:0});
console.log(JSON.stringify({gate:gate.state,formal:task.runs.length,budgets,r21_files_preserved:Object.keys(hashes).length,actual_approval:approval}));
