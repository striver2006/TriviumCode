/** M11 第12步零配额清点；只读生产输入，独立目录保存证据与逐判据矩阵。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
const repo=process.cwd(), here=path.join(repo,'doc/05_testing/evidence/m11-step12-20261012');
const prior=path.join(repo,'doc/05_testing/evidence/agent-access-convergence-20261012');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>{try{return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}catch{return null;}};
const save=(n,v)=>fs.writeFileSync(path.join(here,n),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const git=(...a)=>execFileSync('git',['-c','core.quotePath=false',...a],{encoding:'utf8'}).trim();
const {openBudget}=createRequire(import.meta.url)(path.join(repo,'scripts/agent-access-budget.cjs'));
const budgetRoot=path.join(os.homedir(),'.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const budgets=Object.fromEntries(['admission','review'].map(p=>{const b=openBudget(budgetRoot,p),ns=fs.readdirSync(b.dir);return[p,{used:ns.filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed:ns.filter(n=>/^launch-\d+\.json$/.test(n)).length,limit:b.limit()}];}));
const frozen=['batch-a.json','mechanism-batch.json'].map(n=>{const b=read(path.join(prior,n));return {manifest:n,sha256:hash(path.join(prior,n)),count:Object.keys(b.files).length,checks:Object.entries(b.files).map(([file,expected])=>({file,expected,actual:hash(file),match:expected===hash(file)}))};});
const installation=read(path.join(prior,'migration-install.json'));
const entries=installation.entries.flatMap(e=>e.inventory.map(i=>({agent:e.agent,path:path.join(e.target,i.path),expected:i.sha256,actual:hash(path.join(e.target,i.path))})));
const accepted=read(path.join(prior,'restricted-admission-acceptance.json'));
const stamp=await computeBuildStamp(repo);
save('baseline.json',{at:new Date().toISOString(),head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),status:git('status','--short'),stamp,budgetRoot,budgets,frozen,entries,installed_bundle:hash(path.join(installation.runtime_root,'scripts/trivium.cjs')),source_bundle:hash(path.join(repo,'skills/dual-critic/scripts/trivium.cjs')),shared_absent:installation.entries.filter(e=>e.agent==='codex').every(e=>!fs.existsSync(path.join(os.homedir(),'.agents/skills',e.name))),acceptance_sha256:hash(path.join(prior,'restricted-admission-acceptance.json')),original_standard:accepted.original_standard,exception:accepted.m11_prerequisite_accepted_under_user_exception});
const batches=[
 {id:'Z0',target:'零配额核验、安装自检、11.1负对照及Hook直调辅助证据',pool:null,expected:0,hard:0,stop:'来源失配则停受影响项；负对照意外触发厂商调用立即停'},
 {id:'A1',target:'仅必要的正式预检与认证刷新',pool:'admission',expected:6,hard:20,stop:'69、指纹失效或未知停止相应路线；不复用认证时间戳'},
 {id:'R1',target:'剧本1-6：Claude客户端A/B/C/D与模型换档，复用同轮进程证据',pool:'review',expected:24,hard:30,stop:'失败保留；人工停点等待本轮决定；每主题最多4轮'},
 {id:'R2',target:'剧本7-11：跨载体、三审换profile、L2、换Driver、选档/精确值',pool:'review',expected:24,hard:30,stop:'失败保留、不自动重试；总review增量60即停'},
 {id:'Z1',target:'启用台账断言、串行两次check、安装副本14步自检、交付',pool:null,expected:0,hard:0,stop:'检查失败先定位；不得虚改达成状态'}];
save('budget-plan.json',{at:new Date().toISOString(),authorization:'Bob 2026-10-12 M11第12步新增CLI启动总上限80；允许按现有机制事前发布必要扩容',baseline:budgets,budgetRoot,step_limits:{admission:20,review:60,total:80},absolute_step_caps:{admission:budgets.admission.used+20,review:budgets.review.used+60},extension:'仅必要时追加review最多35；不覆盖旧额度、不跨池；所有边界/version/help/失败/超时/重试计数',batches});
const cases=fs.readFileSync(path.join(repo,'doc/05_testing/CASE_manual_acceptance.md'),'utf8');
const rows=[...cases.matchAll(/^\| (\d{1,2}\.\d+) \| (.+?) \| (.+?) \|$/gm)].map(m=>{
 const n=Number(m[1].split('.')[0]), optional=['9.6','11.7'].includes(m[1]);
 const carrier=n===9?'Codex真实会话/用户终端（L2）':n===7?'ZCode与Codex真实客户端':n===10?'Claude Code + ZCode真实客户端':n===5||n===6?'真实归档上的Hook直调 + 真实客户端Hook事件':'Claude Code真实客户端 + 编排器';
 const routes=[8,11].includes(n)?'审核者含Codex；按已探测profile/effort选值；不能由Codex自审':n===7||n===9?'Codex主攻用claude,gemini,glm；ZCode主攻排除glm':'gemini,glm；需要三审时显式选集合';
 return {scenario:n,criterion:m[1],requirement:m[2],expected:m[3],carrier,routes,kind:optional?'可选，本轮不默认执行':m[1]==='11.1'?'本轮CLI负对照':n===5||n===6?'本轮真实归档/客户端实测；离线仅辅助':'本轮必须重跑，历史/桩不替代',batch:optional?'optional':n<7?'R1':m[1]==='11.1'?'Z0':'R2',estimated_starts:'同批共享运行，不按行重复计数',human:n===3||n===7||n===8||n===9||n===10||n===11?'客户端操作；新运行审批由Bob逐次决定':'客户端操作；破坏性归档负对照由用户在隔离验收副本执行',evidence:[],status:optional?'未执行（可选）':'未测'};
});
save('matrix.json',{at:new Date().toISOString(),source:'doc/05_testing/CASE_manual_acceptance.md',source_sha256:hash(path.join(repo,'doc/05_testing/CASE_manual_acceptance.md')),rows});
fs.writeFileSync(path.join(here,'matrix.md'),'# M11 第12步逐判据验收矩阵\n\n每条必需判据本轮重跑；历史报告只作辅助。预计启动按批共享，见 budget-plan.json。结果更新于 matrix.json 与本轮报告。\n\n| 剧本 | 判据 | 要求 | 执行载体 | 所需路线 | 批次/预计启动 | 人工参与 | 证据/状态 |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n'+rows.map(r=>`| ${r.scenario} | ${r.criterion} | ${r.requirement} | ${r.carrier} | ${r.routes} | ${r.batch} / 批内共享 | ${r.human} | ${r.status} |`).join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({criteria:rows.length,budgets,frozen:frozen.map(f=>({count:f.count,mismatches:f.checks.filter(c=>!c.match)})),entries:entries.length,entries_match:entries.every(e=>e.expected===e.actual),stamp}));
