/** 记录Bob对D具名裁决的批准，发布零厂商CLI批次；不代客户端approve。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,read=n=>JSON.parse(fs.readFileSync(here+'/'+n));
const old=read('client-batch-d-recovery01.json'),negative=read('client-d-gate-results.json'),plan=read('budget-plan.json');
const topic='m11-s12-capacity',stage='bug',run_id='20261015T123051Z',fixture=old.fixture;
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const response_file=fixture+'/.reviews/'+topic+'/bug/2026-10-15-'+topic+'-revised-claude.md';
const response_sha256='0f4adc251a4336dfb8dc65d28611db593508ba9eca37b0e501911b7247e86a4f';
const task=JSON.parse(fs.readFileSync(fixture+'/.reviews/'+topic+'/task.json'));
if(!negative.passed||negative.run_id!==run_id||task.runs.filter(r=>r.stage===stage).at(-1)?.run_id!==run_id||task.approvals.some(a=>a.run_id===run_id)||hash(response_file)!==response_sha256)throw Error('运行、裁决或负对照状态变化');
const files=negative.files.map(f=>({...f,current:hash(f.file)}));
if(files.some(f=>f.current!==f.before))throw Error('源码/测试变化');
const counts=()=>Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const budget=counts();if(budget.admission!==838||budget.review!==401)throw Error('预算变化，停止发布');
const statusCommand=[fixture+'/.trivium/bin/trivium','status','--topic',topic,'--json'];
const status=spawnSync(statusCommand[0],statusCommand.slice(1),{cwd:fixture,encoding:'utf8'});
if(status.status!==0||!JSON.parse(status.stdout).topics.some(t=>t.topic===topic&&t.approvals===2&&t.open_gates.some(g=>g.stage===stage&&g.state==='awaiting_approval')))throw Error('审批前状态不符');
if(JSON.stringify(counts())!==JSON.stringify(budget))throw Error('零厂商准备出现预算变化');
const at=new Date().toISOString();
const reason='保留树外证据访问原因未证实的边界；仅审批及放行复测，不实施容量修复、不启动新审查、不提交';
const command_args=['approve','--topic',topic,'--stage',stage,'--reason',reason];
const approval={at,source:'Bob主会话直接明确批准',decision:'approved',
 user_answer:'批准 m11-s12-capacity / bug / 20261015T123051Z 本轮根因裁决，保留树外证据访问原因未证实的边界；仅授权原Claude Code会话审批及放行复测，零厂商CLI，不实施容量修复、不启动新审查、不提交。',
 fixture,topic,stage,run_id,command_args,response_file,response_sha256,negative_evidence:'client-d-gate-results.json',executor:'原Claude Code测试会话',
 scope:'只执行具名审批及同参数Edit插入/删除sentinel的放行复测，零厂商CLI；不实施容量修复、不启动新审查、不提交；树外证据访问原因仍未证实',budget_before:budget};
saveEvidence(here+'/approval-d.json',approval);
const batch={...old,at,id:'D-Claude-approval',before:budget,caps:budget,expected:{admission:0,review:0},hard:{admission:0,review:0},
 approval_receipt:'approval-d.json',command:'/dual-approve --topic '+topic+' --stage bug --reason "'+reason+'"',
 stop:'仅原Claude客户端执行审批及放行复测；每步一次，失败立即停；不重试、不修业务、不启动新审查、不提交',scope_note:approval.scope};
delete batch.resume_receipt;
saveEvidence(here+'/d-approval-preparation.json',{at,run_id,files,response_sha256,budget,status:{command:statusCommand,code:status.status,stdout:status.stdout,stderr:status.stderr},client_approve_executed:false,vendor_starts:0});
saveEvidence(here+'/client-batch-d-approved.json',batch);
const tmp=here+'/client-batch-d-approved.tmp';fs.writeFileSync(tmp,JSON.stringify(batch,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,here+'/client-batch.json');
console.log(JSON.stringify({published:batch.id,run_id,response_sha256,budget,hard:batch.hard,approve_executed:false,command:batch.command}));
