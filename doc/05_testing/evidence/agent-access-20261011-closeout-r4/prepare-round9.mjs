/** 本次用户独立轮数授权：保留原件，沿用既有任务级约束壳。零厂商CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { assertFormalRoundCore } from '../agent-access-20261011-closeout-r3/round-guard.mjs';
const repo = process.cwd(), prior = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r3');
const current = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r4');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const save = (p, v) => fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v,null,2)+'\n', {flag:'wx',mode:0o600});
const layout = {archiveRoot:path.join(repo,'.reviews'),topic:'Agent双模式接入真实准入收口'};
const task = await readTask(layout), runs = await listRecordedRuns(layout);
if (task.runs.length !== 8 || runs.length !== 8) throw Error('历史启动数不为8，停止');
const old = fs.readFileSync(path.join(prior,'formal-round-authorization-v3.json'));
const pointer = fs.readFileSync(path.join(prior,'formal-round-authority.json'));
save(path.join(prior,'formal-round-authority-v3-preserved.json'),pointer.toString());
const auth = {...JSON.parse(old),previous_limit:8,new_limit:10,historical_run_ids:task.runs.map(r=>r.run_id),
 new_rounds:[{ordinal:9,entry:'B',stage:'plan'},{ordinal:10,entry:'C',stage:'code'}],
 authorization:'2026-10-11用户对独立轮数问题明确回复：授权总10轮，先正式计划审查再代码重审',
 supersedes_file:'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v3.json',supersedes_sha256:hash(old),
 authorized_scope:'第9次B/plan审补测机制、受限工具面候选和有限证据复用边界；实施完成后第10次C/code相对39ed2053完整重审。轮数授权及一般委托审批不授权准入判据变化。',recorded_at:new Date().toISOString()};
const bytes=JSON.stringify(auth,null,2)+'\n';
save(path.join(prior,'formal-round-authorization-v4.json'),bytes);
const newPointer={topic:layout.topic,authorization:'formal-round-authorization-v4.json',sha256:hash(bytes),
 basis:'用户独立授权总10轮；当前权威读取壳不变，旧v3权威原样另存，历史8次全部计数且失败不改。无原生例外接口。',recorded_at:new Date().toISOString()};
const tmp=path.join(prior,`authority-${crypto.randomUUID()}.tmp`);
save(tmp,newPointer); fs.renameSync(tmp,path.join(prior,'formal-round-authority.json'));
const launcher=fs.readFileSync(path.join(prior,'launch-v4.mjs'),'utf8');
if(launcher.split('formal-round-authorization-v3.json').length!==2) throw Error('launcher替换点不唯一');
save(path.join(prior,'launch-v5.mjs'),launcher.replace('formal-round-authorization-v3.json','formal-round-authorization-v4.json'));
save(path.join(prior,'quiet-launch-v5.mjs'),fs.readFileSync(path.join(prior,'quiet-launch.mjs'),'utf8').replace("['v3', 'v4']","['v5']"));
const args=['review','--start','--topic',layout.topic,'--driver','codex','--critics','claude,gemini,glm','--entry','B','--stage','plan'];
const cases=[];
const ok=assertFormalRoundCore(auth,task,runs,args); if(ok!==9) throw Error('第9轮不允许'); cases.push('当前8记录允许9B');
const tenth={...task,runs:[...task.runs,{run_id:'future9'}]}, future=[...runs,{run_id:'future9'}];
if(assertFormalRoundCore(auth,tenth,future,args.map(v=>v==='B'?'C':v==='plan'?'code':v))!==10)throw Error('第10轮不允许');cases.push('9记录仅允许10C');
const reject=(name,a,t,r,c=auth)=>{let caught=false;try{assertFormalRoundCore(a,t,r,c===auth?args:c,auth);}catch{caught=true;}if(!caught)throw Error(name);cases.push(name);};
reject('旧v3不能启动',JSON.parse(old),task,runs);
reject('缺历史原件拒绝',auth,task,runs.slice(1));
reject('归档孤儿拒绝',auth,task,[...runs,{run_id:'orphan'}]);
reject('重复记录拒绝',auth,{...task,runs:[...task.runs,task.runs[0]]},[...runs,runs[0]]);
reject('不可读原件拒绝',auth,task,runs.map((r,i)=>i? r:{...r,unreadable:true}));
for(const [name,key,value] of [['错阶段','plan','code'],['错Driver','codex','claude'],['错集合','claude,gemini,glm','claude,gemini'],['错主题',layout.topic,'other']])reject(name,auth,task,runs,args.map(x=>x===key?value:x));
reject('重复旗标拒绝',auth,task,runs,[...args,'--entry','B']);
reject('第11轮拒绝',auth,{...tenth,runs:[...tenth.runs,{run_id:'future10'}]},[...future,{run_id:'future10'}]);
save(path.join(current,'formal-round9-authorization-verification.json'),{authorization_sha256:hash(bytes),preserved_pointer_sha256:hash(pointer),historical_ids:auth.historical_run_ids,formal_count:8,max:10,cases,criteria_change_authorized:false,vendor_cli_starts:0});
for(const name of ['build-stamp-only-comparison.json','component-evidence-scope-comparison.json','remaining-gap-feasibility-zero-cli.json','remaining-gap-review-readiness.md','remaining-gap-static-audit.json','post-commit-verification.json']){
 const original=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/delivery',name); const b=fs.readFileSync(original);save(path.join(current,name),b.toString());
}
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const budgetRoot=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/budget'),budget=openBudget(budgetRoot,'review');
const before=fs.readdirSync(budget.dir).filter(x=>x.startsWith('reserved-')).length;
const extension=budget.extend('formal-round9-plan-total10',15,'用户授权自动CLI扩容；第9次有效计划复审批预计10至15启动、硬上限20，review池108到123，独立于正式轮数10');
save(path.join(current,'review-round9-plan-batch.json'),{pool:'review',before,expected:15,hard_limit:20,pool_limit:budget.limit(),extension,admission:{used:547,limit:563,new_starts:0},formal:{used:8,limit:10,this_round:9,entry:'B',stage:'plan'},routes:['Claude现配置Qwen flash','Gemini现配置flash','GLM现配置coding'],counting:'版本/包装器/native/失败/超时/重试全部计数；达到本批123即停，不换提示。',created_at:new Date().toISOString()});
console.log(JSON.stringify({historical:auth.historical_run_ids,formal_limit:10,guard_cases:cases.length,review_before:before,review_limit:budget.limit(),vendor_starts:0}));
