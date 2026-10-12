/** 按用户独立按需委托，仅24B/25C；保持旧失败、旧权威与计数，26拒绝。 */
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{createRequire}from'node:module';
import{readTask}from'../../../../dist/test/src/trivium/meta.js';import{listRecordedRuns}from'../../../../dist/test/src/trivium/archive.js';
import{assertFormalRoundCore}from'../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import{saveEvidence}from'../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),prior=path.resolve(root,'../agent-access-20261011-closeout-r3'),topic='Agent双模式接入真实准入收口',hash=b=>crypto.createHash('sha256').update(b).digest('hex'),save=(p,v)=>fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const layout={archiveRoot:repo+'/.reviews',topic},task=await readTask(layout),runs=await listRecordedRuns(layout);
if(task.runs.length!==23||runs.length!==23||runs.some(r=>r.unreadable)||JSON.stringify(task.runs.map(r=>r.run_id).sort())!==JSON.stringify(runs.map(r=>r.run_id).sort()))throw Error('23实际run集合不符');
if(!task.approvals.some(a=>a.run_id==='20261011T152631Z'&&a.stage==='code'&&a.decision==='approved'))throw Error('缺23C本轮批准');
const pointer=fs.readFileSync(prior+'/formal-round-authority.json'),old=fs.readFileSync(prior+'/formal-round-authorization-v12.json'),p=JSON.parse(pointer),a=JSON.parse(old);
if(p.authorization!=='formal-round-authorization-v12.json'||p.sha256!==hash(old)||a.delegated_round_extensions!==true||a.delegation_exact_reply!=='授权轮次可以按需增加，不必询问授权'||a.criteria_change_authorized!==false||hash(fs.readFileSync(a.supersedes_file))!==a.supersedes_sha256)throw Error('独立按需委托或谱系不符');
const auth={...a,previous_limit:23,new_limit:25,historical_run_ids:task.runs.map(r=>r.run_id),new_rounds:[{ordinal:24,entry:'B',stage:'plan'},{ordinal:25,entry:'C',stage:'code'}],authorized_scope:'仅24B审集中受控工具/路径机制取证及认证checked_at具名适用性候选与任务测试；普通plan批准只授权夹具与诊断，判据采用仍需Bob独立明确批准；25C完整代码重审，历史23及全部失败保留，26拒绝。',supersedes_file:'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v12.json',supersedes_sha256:hash(old),criteria_change_authorized:false,count_reset:false,old_failed_status_unchanged:true,recorded_at:new Date().toISOString()};
const argv=['review','--start','--entry','B','--stage','plan','--topic',topic,'--driver','codex','--critics','claude,gemini,glm'],cases=[];
if(assertFormalRoundCore(auth,task,runs,argv,auth)!==24)throw Error('24B未允许');cases.push('真实23集合允许24B');
const deny=(name,authorization,t,r,args,current=auth)=>{let rejected=false;try{assertFormalRoundCore(authorization,t,r,args,current)}catch{rejected=true}if(!rejected)throw Error(name);cases.push(name);};
deny('旧v12拒绝',a,task,runs,argv);for(const[n,current]of[['缺权威',undefined],['null权威',null],['坏权威',{}]]){let bad=false;try{assertFormalRoundCore(auth,task,runs,argv,current)}catch{bad=true}if(!bad)throw Error(n);cases.push(n);}
for(const r of[runs.slice(1),[...runs,{run_id:'orphan'}],[...runs,runs[0]],runs.map((r,i)=>i?r:{...r,unreadable:true})])deny('缺/孤儿/重复/不可读拒绝',auth,task,r,argv);
for(const flag of['--topic','--driver','--critics','--entry','--stage']){const wrong=[...argv];wrong[wrong.indexOf(flag)+1]='wrong';deny('错'+flag,auth,task,runs,wrong);deny('重复'+flag,auth,task,runs,[...argv,flag,argv[argv.indexOf(flag)+1]]);}
deny('allow-single拒绝',auth,task,runs,[...argv,'--allow-single']);
const after24={...task,runs:[...task.runs,{run_id:'future24-fixture'}]},runs24=[...runs,{run_id:'future24-fixture'}],code=argv.map(v=>v==='B'?'C':v==='plan'?'code':v);
if(assertFormalRoundCore(auth,after24,runs24,code,auth)!==25)throw Error('25C不放行');cases.push('25C允许');deny('25B拒绝',auth,after24,runs24,argv);
deny('26拒绝',auth,{...after24,runs:[...after24.runs,{run_id:'future25-fixture'}]},[...runs24,{run_id:'future25-fixture'}],code);
const{openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs'),budgetRoot=process.env.HOME+'/.trivium/evidence/agent-access-20261011-closeout-r3/budget',review=openBudget(budgetRoot,'review'),admission=openBudget(budgetRoot,'admission'),count=b=>fs.readdirSync(b.dir).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
if(count(review)!==298||review.limit()!==303||count(admission)!==731||admission.limit()!==742)throw Error('预算实际基线不符');
const launcher=fs.readFileSync(prior+'/launch-v16.mjs','utf8');if(launcher.split('formal-round-authorization-v12.json').length!==2)throw Error('授权引用不唯一');
const next=launcher.replace(launcher.split('\n')[0],'/** 独立按需委托仅24B/25C；v17仅切v13权威，guard和判据不变。 */').replace('formal-round-authorization-v12.json','formal-round-authorization-v13.json'),bytes=JSON.stringify(auth,null,2)+'\n';
save(prior+'/formal-round-authority-v12-preserved.json',pointer.toString());save(prior+'/formal-round-authorization-v13.json',bytes);save(prior+'/launch-v17.mjs',next);
const temp=prior+'/authority-'+crypto.randomUUID()+'.tmp';save(temp,{topic,authorization:'formal-round-authorization-v13.json',sha256:hash(bytes),basis:'Bob独立按需正式轮次委托；仅24B计划与25C完整代码，26拒绝；不包含判据采用。',recorded_at:new Date().toISOString()});fs.renameSync(temp,prior+'/formal-round-authority.json');
const extension=review.extend('formal-round24-plan-controlled-and-cache',15,'Bob独立按需正式轮数及CLI自动扩容委托；24B baseline298预计15硬20止318，原303扩15；准入0，判据采用仍未授权');
saveEvidence(root+'/review-round24-budget-extension.json',extension);saveEvidence(root+'/review-round24-plan-batch.json',{at:new Date().toISOString(),pool:'review',before:298,expected:15,hard_limit:20,batch_stop:318,pool_limit:review.limit(),formal:{used:23,limit:25,this_round:24,entry:'B',stage:'plan'},admission:{used:731,limit:742,new_starts:0},counting:'版本帮助认证失败超时包装native重试均计启动；达到318先停再扩；25C后续单独发布批清单。',criteria_change:false});
saveEvidence(root+'/formal-round24-25-authorization-verification.json',{at:new Date().toISOString(),authorization_sha256:hash(bytes),preserved_pointer_sha256:hash(pointer),launcher_sha256:hash(next),old_launcher_sha256:hash(launcher),historical_ids:auth.historical_run_ids,old_runs:task.runs,old_approvals:task.approvals,cases,delegation_exact_reply:auth.delegation_exact_reply,criteria_change_authorized:false,supersedes_file:auth.supersedes_file,supersedes_sha256:auth.supersedes_sha256,vendor_cli_starts:0});
console.log(JSON.stringify({formal:'23/25',review:'298/318',admission:'731/742',cases:cases.length,new_vendor_starts:0}));
