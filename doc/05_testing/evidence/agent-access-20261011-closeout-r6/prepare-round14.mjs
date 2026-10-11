/** 14C批次发布与有效13B审批核验；不启动厂商CLI，不扩正式轮数。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { assertFormalRound } from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),topic='Agent双模式接入真实准入收口',root=path.dirname(new URL(import.meta.url).pathname);
const layout={archiveRoot:path.join(repo,'.reviews'),topic},task=await readTask(layout),runs=await listRecordedRuns(layout);
if(task.runs.length!==13||!task.approvals.some(a=>a.run_id==='20261011T061256Z'&&a.stage==='plan'&&a.decision==='approved'))throw Error('13B有效审批未齐');
const auth=JSON.parse(fs.readFileSync(path.join(root,'../agent-access-20261011-closeout-r3/formal-round-authorization-v6.json')));
const args=['review','--start','--entry','C','--stage','code','--topic',topic,'--driver','codex','--critics','claude,gemini,glm'];
if(assertFormalRound(auth,task,runs,args)!==14)throw Error('14C授权不符');
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const b=openBudget(path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/budget'),'review');
const used=fs.readdirSync(b.dir).filter(n=>n.startsWith('reserved-')).length;
if(used!==168||b.limit()!==183)throw Error('review台账与批次预期不同');
saveEvidence(path.join(root,'review-round14-code-batch.json'),{at:new Date().toISOString(),pool:'review',before:used,expected:10,hard_limit:15,batch_stop:183,pool_limit:183,
  formal:{used:13,limit:14,this_round:14,entry:'C',stage:'code'},admission:{used:547,limit:563,new_starts:0},
  routes:['claude/Qwen flash现配置','gemini现flash-high配置','glm现GLM-5.3配置'],base:'39ed20530d64a72f81f183095c6d9516632d0228',
  counting:'版本/帮助/失败/超时/包装器/native/重试全部计启动；上限前停止，CLI扩容须另记但不扩大正式14轮',
  approvals:task.approvals.filter(a=>a.run_id==='20261011T061256Z'),criteria_change_authorized:false});
console.log(JSON.stringify({formal:'13/14',review:'168/183',expected:10,hard:15,admission_new:0}));
