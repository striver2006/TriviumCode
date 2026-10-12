/** 24B批准与首批已完成验证留痕；原审查字节副本、脱敏扫描及完整hash。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {scanSecrets} from '../../../../dist/test/src/trivium/secrets.js';
const root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口',run='20261011T171203Z';
const req=createRequire(import.meta.url),{openBudget}=req('../../../../scripts/agent-access-budget.cjs');
const external='/Users/chenzhenbo/.trivium/evidence/agent-access-20261011-closeout-r3';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const metaPath='.reviews/'+topic+'/plan/_meta/run-'+run+'.json',meta=JSON.parse(fs.readFileSync(metaPath));
const task=JSON.parse(fs.readFileSync('.reviews/'+topic+'/task.json'));
const approval=task.approvals.findLast(a=>a.stage==='plan'&&a.run_id===run);
if(meta.status!=='success'||approval?.decision!=='approved')throw Error('当前审查或批准资格不符');
const sources=[metaPath,...meta.artifacts.map(a=>'.reviews/'+a.path),
 '.reviews/'+topic+'/plan/2026-10-12-'+topic+'-r26-codex.md',
 '.reviews/'+topic+'/plan/2026-10-12-'+topic+'-r12-revised-codex.md'];
fs.mkdirSync(root+'/review24-originals',{recursive:true});
const copies=[];
for(const source of sources){const text=fs.readFileSync(source,'utf8');const leaks=scanSecrets(text);if(leaks.length)throw Error('原件扫描发现敏感数据，不复制');
 const target=root+'/review24-originals/'+path.basename(source);if(fs.existsSync(target)){if(hash(source)!==hash(target))throw Error('既有副本不符');}else fs.writeFileSync(target,text,{flag:'wx',mode:0o600});if(hash(source)!==hash(target))throw Error('副本不符');copies.push({source,target:path.relative(root,target),sha256:hash(source)});}
const budgets={};for(const pool of ['admission','review']){const b=openBudget(external+'/budget',pool),names=fs.readdirSync(b.dir);budgets[pool]={used:names.filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed:names.filter(n=>/^launch-\d+\.json$/.test(n)).length,limit:b.limit()};}
const design='doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md';
saveEvidence(root+'/plan24-approved-checkpoint.json',{at:new Date().toISOString(),script_sha256:hash(new URL(import.meta.url)),run_id:run,approval,formal:{used:task.runs.length,limit:25,next:'25C完整代码重审未启动'},copies,budgets,
 qualifications:{status:meta.status,subject_sha256:meta.snapshot.subject_sha256,tree_equal:meta.snapshot.tree_hash===meta.snapshot.after_tree_hash,readonly_breach:meta.guard.readonly_breach,peer_artifact_read:meta.guard.peer_artifact_read,evidence_ok:Object.fromEntries(Object.entries(meta.critics).map(([id,c])=>[id,c.evidence_ok])),repairs:Object.fromEntries(Object.entries(meta.critics).map(([id,c])=>[id,c.parse_repairs]))},
 dispositions:{accepted:12,rejected:1,deferred:0},authority_and_doc_checks:{path:'authority-and-doc-checks.json',sha256:hash(root+'/authority-and-doc-checks.json'),pass:44,skipped:1,fail:0,typecheck:0},
 post_sync_format_fix:{path:design,sha256:hash(design),change:'仅新附录尾空白与已批准状态措辞；git diff --check通过，sync原采样记录保留'},
 current_original_matrix:{passed:0,untested:12,local_config:'fb64a35a5ea1b3ebfe791435a32a715ca28cc5062fa794b330f1ac46f536a232'},previous_original_matrix:{passed:7,untested:5,local_config:'496eed89fe1daf113196ea7a304831e47740432d3b9437f5850e56a1877249a7'},
 controlled_pilot:'未执行',timestamp_applicability_diagnostic:'未执行',criteria_change_authorized:false,prerequisite_complete:false,m11_step12_started:false,new_vendor_starts:0});
console.log(JSON.stringify({copies:copies.length,budgets,formal:task.runs.length,criteria_change_authorized:false}));
