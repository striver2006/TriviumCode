/** 本次具名授权的一次性agy刷新：原外壳、原预算、最多6次边界，结束不恢复D。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import YAML from 'yaml';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname;
const cfg=JSON.parse(fs.readFileSync(here+'/client-batch.json'));
const plan=JSON.parse(fs.readFileSync(here+'/budget-plan.json'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const count=()=>Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(plan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
const installed=os.homedir()+'/.claude/skills/dual-critic/scripts/trivium.cjs';
const fixture='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const before=count();
if(cfg.fixture!==fixture||before.admission!==827||before.review!==397||hash(installed)!==cfg.installed_sha256)throw Error('基线变化，停止刷新');
const taskPath=fixture+'/.reviews/m11-s12-capacity/task.json';
if(JSON.parse(fs.readFileSync(taskPath)).runs.some(r=>r.stage==='bug'))throw Error('出现bug正式运行，停止刷新');
const baseline=()=>{
 const local=fixture+'/.trivium/config.local.yaml';
 const config=YAML.parse(fs.readFileSync(local,'utf8'));
 const agy=config.probe?.cli?.agy;
 const remainder=structuredClone(config);
 if(remainder.probe){delete remainder.probe.generated_at;if(remainder.probe.cli)delete remainder.probe.cli.agy;delete remainder.probe.host;}
 return {config_sha256:hash(local),agy,other_config_sha256:crypto.createHash('sha256').update(JSON.stringify(remainder)).digest('hex'),
   installed_sha256:hash(installed),task_sha256:hash(taskPath),source_sha256:hash(fixture+'/src/stack.js'),test_sha256:hash(fixture+'/test/stack.test.js')};
};
const original=baseline();
const entries=JSON.parse(fs.readFileSync(here+'/baseline.json')).entries.map(e=>({path:e.path,expected:e.expected,actual:hash(e.path)}));
if(entries.some(e=>e.expected!==e.actual))throw Error('入口指纹变化，停止');
saveEvidence(here+'/agy-refresh-20261015-before.json',{at:new Date().toISOString(),before,baseline:original,entries});
const failed=os.homedir()+'/.trivium/evidence/m11-step12-20261012/calls/17fde84f-8d7a-4be5-8210-ea131b0cad82-completed.json';
saveEvidence(here+'/client-d-preflight-69-20261015.json',{source:failed,source_sha256:hash(failed),record:JSON.parse(fs.readFileSync(failed)),correction:'本次消耗4次版本查询边界；不是零厂商边界。没有正式bug运行。'});
saveEvidence(here+'/agy-refresh-20261015-approval.json',{at:new Date().toISOString(),decision:'approved',
 user_answer:'批准 agy 定向刷新，admission 最多 6 次，计入原总额 80；刷新后先报告，不启动 D。',
 fixture,before,hard:{admission:6,review:0},caps:{admission:833,review:397},command_args:['doctor','--only','agy','--json'],total_step_limit:80,
 scope:'只更新独立验收项目agy探针，沿用原预算与安装副本；不刷新其它厂商，不自动重跑，不启动D'});
const command=[fixture+'/.trivium/bin/trivium','doctor','--only','agy','--json'];
const child=spawn(command[0],command.slice(1),{cwd:fixture,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
const [code,signal]=await new Promise(r=>child.once('close',(...v)=>r(v)));
const after=count(),current=baseline();
const reservations=fs.readdirSync(plan.budgetRoot+'/ledger/admission').filter(n=>/^reserved-\d+\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(plan.budgetRoot+'/ledger/admission/'+n))).filter(r=>r.index>before.admission);
const completions=fs.readdirSync(plan.budgetRoot+'/ledger/admission').filter(n=>/^launch-\d+\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(plan.budgetRoot+'/ledger/admission/'+n))).filter(r=>r.index>before.admission);
const unchanged=Object.fromEntries(['installed_sha256','task_sha256','source_sha256','test_sha256','other_config_sha256'].map(k=>[k,current[k]===original[k]]));
const entryUnchanged=entries.every(e=>hash(e.path)===e.actual);
const result={at:new Date().toISOString(),command,cwd:fixture,code,signal,stdout,stderr,before,after,used:after.admission-before.admission,
 baseline_after:current,unchanged,entries_unchanged:entryUnchanged,reservations,completions,
 budget_ok:after.admission-before.admission<=6&&after.review===before.review&&after.admission-plan.baseline.admission.used+after.review-plan.baseline.review.used<=80,
 bug_runs:JSON.parse(fs.readFileSync(taskPath)).runs.filter(r=>r.stage==='bug'),d_started:false};
saveEvidence(here+'/agy-refresh-20261015-result.json',result);
console.log(JSON.stringify({code,signal,before,after,used:result.used,budget_ok:result.budget_ok,unchanged,entries_unchanged:entryUnchanged,agy:current.agy,d_started:false}));
process.exitCode=code??1;
