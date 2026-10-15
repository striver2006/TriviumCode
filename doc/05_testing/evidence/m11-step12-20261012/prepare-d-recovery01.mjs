/** 发布获批D单次恢复；只核对与发布，不启动预检、审查或审批。 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,old=JSON.parse(fs.readFileSync(here+'/client-batch-d.json'));
const plan=JSON.parse(fs.readFileSync(here+'/budget-plan.json'));
const fixture=old.fixture,topic='m11-s12-capacity',id='D-Claude-recovery-01';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const count=()=>Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const before=count(),caps={admission:838,review:401};
if(before.admission!==832||before.review!==397||plan.revision!==3||caps.admission>plan.absolute_step_caps.admission||caps.review>plan.absolute_step_caps.review||caps.admission-plan.baseline.admission.used+caps.review-plan.baseline.review.used>80)throw Error('预算变化，停止发布');
const installed=os.homedir()+'/.claude/skills/dual-critic/scripts/trivium.cjs';
const entries=JSON.parse(fs.readFileSync(here+'/baseline.json')).entries.map(e=>({path:e.path,expected:e.expected,actual:hash(e.path)}));
if(hash(installed)!==old.installed_sha256||entries.some(e=>e.expected!==e.actual))throw Error('安装或入口变化');
const task=JSON.parse(fs.readFileSync(fixture+'/.reviews/'+topic+'/task.json'));
if(task.runs.some(r=>r.stage==='bug'))throw Error('已有bug正式运行，禁止作为首轮恢复');
const subject=fixture+'/.reviews/'+topic+'/bug/2026-10-15-'+topic+'-claude.md';
if(!fs.statSync(subject).isFile())throw Error('已有原稿不存在');
const repro=JSON.parse(fs.readFileSync(here+'/d-local-reproduction.json'));
if(hash(fixture+'/src/stack.js')!==repro.source_sha256)throw Error('源码与根因复现不一致');
const local=fixture+'/.trivium/config.local.yaml',config=YAML.parse(fs.readFileSync(local,'utf8'));
const refreshed=JSON.parse(fs.readFileSync(here+'/agy-refresh-20261015-result.json'));
if(config.probe?.cli?.agy?.version!=='1.3.5'||config.probe.cli.agy.probed_at!==refreshed.baseline_after.agy.probed_at||config.probe.cli.agy.headless_read_ok!==true||config.probe.cli.agy.json_schema_ok!==true)throw Error('新agy探针不匹配');
const statusCommand=[fixture+'/.trivium/bin/trivium','status','--json'];
const status=spawnSync(statusCommand[0],statusCommand.slice(1),{cwd:fixture,encoding:'utf8'});
if(status.status!==0||JSON.parse(status.stdout).topics.some(t=>t.open_gates.length))throw Error('状态读取失败或有未关闭闸门');
if(JSON.stringify(count())!==JSON.stringify(before))throw Error('准备期间预算发生变化');
const at=new Date().toISOString();
const decision={at,decision:'approved',batch_id:id,fixture,topic,stage:'bug',
 user_answer:'批准准备并发布 D 单次恢复批次：admission 最多6次、review最多4次，计入原总额80，不跨池、不自动重试。由原Claude Code测试会话执行，逐条裁决后停 awaiting_approval；不审批、不修业务。',
 before,hard:{admission:6,review:4},caps,total_step_limit:80,executor:'原Claude Code测试会话',approval_authorized:false,business_change_authorized:false};
saveEvidence(here+'/d-recovery01-user-decision.json',decision);
const batch={...old,at,id,topics:[topic],before,caps,expected:{admission:6,review:4},hard:decision.hard,
 resume_receipt:'d-recovery01-user-decision.json',approval_receipt:null,subject_path:subject,subject_sha256:hash(subject),stage:'bug',rerun_index:1,
 agy_probe:{version:config.probe.cli.agy.version,probed_at:config.probe.cli.agy.probed_at,headless_read_ok:true,json_schema_ok:true,path_deny_supported:config.probe.cli.agy.path_deny.supported},
 stop:'单次恢复；正式preflight与review --start各最多一次；首个失败/69/漂移/预算拒绝立即停，不自动重试；裁决后停awaiting_approval，不审批、不修业务、不提交',
 scope_note:'复用2026-10-15 bug原稿，不重建主题/原稿。agy定向刷新已消耗5次另计；doctor总体69的唯一blocker为受控预算wrapper形态，不改wrapper、不运行init、不重跑doctor，不豁免正式preflight。最坏本步71/80，余admission1/review8，不能承诺后续其它批次预算足够。'};
saveEvidence(here+'/d-recovery01-preparation.json',{at,before,after:count(),installed_sha256:hash(installed),entries,
 subject:{path:subject,sha256:hash(subject)},source_sha256:hash(fixture+'/src/stack.js'),test_sha256:hash(fixture+'/test/stack.test.js'),
 config_sha256:hash(local),wrapper_sha256:hash(fixture+'/.trivium/bin/trivium'),status:{command:statusCommand,code:status.status,stdout:status.stdout,stderr:status.stderr},
 agy_probe:batch.agy_probe,formal_bug_runs:[],vendor_starts:0});
saveEvidence(here+'/client-batch-d-recovery01.json',batch);
const tmp=here+'/client-batch-d-recovery01.tmp';
fs.writeFileSync(tmp,JSON.stringify(batch,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,here+'/client-batch.json');
console.log(JSON.stringify({published:id,before,caps,hard:batch.hard,subject:batch.subject_path,vendor_starts:0}));
