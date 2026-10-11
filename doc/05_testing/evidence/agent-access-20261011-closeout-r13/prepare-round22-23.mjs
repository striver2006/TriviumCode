/** 按用户独立按需委托，仅22B/23C；保持旧失败、旧权威与计数，24拒绝。 */
import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{createRequire}from'node:module';
import{readTask}from'../../../../dist/test/src/trivium/meta.js';import{listRecordedRuns}from'../../../../dist/test/src/trivium/archive.js';
import{assertFormalRoundCore}from'../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import{saveEvidence}from'../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),prior=path.resolve(root,'../agent-access-20261011-closeout-r3'),topic='Agent双模式接入真实准入收口',hash=b=>crypto.createHash('sha256').update(b).digest('hex'),save=(p,v)=>fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const layout={archiveRoot:repo+'/.reviews',topic},task=await readTask(layout),runs=await listRecordedRuns(layout);
if(task.runs.length!==21||runs.length!==21||runs.some(r=>r.unreadable)||JSON.stringify(task.runs.map(r=>r.run_id).sort())!==JSON.stringify(runs.map(r=>r.run_id).sort()))throw Error('21实际run集合不符');
if(!task.approvals.some(a=>a.run_id==='20261011T131721Z'&&a.stage==='code'&&a.decision==='approved'))throw Error('缺21C本轮批准');
const pointer=fs.readFileSync(prior+'/formal-round-authority.json'),old=fs.readFileSync(prior+'/formal-round-authorization-v11.json'),p=JSON.parse(pointer),a=JSON.parse(old);
if(p.authorization!=='formal-round-authorization-v11.json'||p.sha256!==hash(old)||a.delegated_round_extensions!==true||a.delegation_exact_reply!=='授权轮次可以按需增加，不必询问授权'||a.criteria_change_authorized!==false||hash(fs.readFileSync(a.supersedes_file))!==a.supersedes_sha256)throw Error('独立按需委托或谱系不符');
const auth={...a,previous_limit:21,new_limit:23,historical_run_ids:task.runs.map(r=>r.run_id),new_rounds:[{ordinal:22,entry:'B',stage:'plan'},{ordinal:23,entry:'C',stage:'code'}],authorized_scope:'仅22B审Claude实际Read/Grep精确权限配对取证守卫，获普通plan批准后才实施，23C完整代码重审；不采用准入替代，历史21及全部失败保留、24拒绝。',supersedes_file:'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v11.json',supersedes_sha256:hash(old),criteria_change_authorized:false,count_reset:false,old_failed_status_unchanged:true,recorded_at:new Date().toISOString()};
const argv=['review','--start','--entry','B','--stage','plan','--topic',topic,'--driver','codex','--critics','claude,gemini,glm'],cases=[];
if(assertFormalRoundCore(auth,task,runs,argv,auth)!==22)throw Error('22B未允许');cases.push('真实21集合允许22B');
const deny=(name,authorization,t,r,args,current=auth)=>{let rejected=false;try{assertFormalRoundCore(authorization,t,r,args,current)}catch{rejected=true}if(!rejected)throw Error(name);cases.push(name);};
deny('旧v11拒绝',a,task,runs,argv);for(const[n,current]of[['缺权威',undefined],['null权威',null],['坏权威',{}]]){let bad=false;try{assertFormalRoundCore(auth,task,runs,argv,current)}catch{bad=true}if(!bad)throw Error(n);cases.push(n);}
for(const r of[runs.slice(1),[...runs,{run_id:'orphan'}],[...runs,runs[0]],runs.map((r,i)=>i?r:{...r,unreadable:true})])deny('缺/孤儿/重复/不可读拒绝',auth,task,r,argv);
for(const flag of['--topic','--driver','--critics','--entry','--stage']){const wrong=[...argv];wrong[wrong.indexOf(flag)+1]='wrong';deny('错'+flag,auth,task,runs,wrong);deny('重复'+flag,auth,task,runs,[...argv,flag,argv[argv.indexOf(flag)+1]]);}
deny('allow-single拒绝',auth,task,runs,[...argv,'--allow-single']);
const after22={...task,runs:[...task.runs,{run_id:'future22-fixture'}]},runs22=[...runs,{run_id:'future22-fixture'}],code=argv.map(v=>v==='B'?'C':v==='plan'?'code':v);
if(assertFormalRoundCore(auth,after22,runs22,code,auth)!==23)throw Error('23C不放行');cases.push('23C允许');deny('23B拒绝',auth,after22,runs22,argv);
deny('24拒绝',auth,{...after22,runs:[...after22.runs,{run_id:'future23-fixture'}]},[...runs22,{run_id:'future23-fixture'}],code);
const{openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs'),budgetRoot=process.env.HOME+'/.trivium/evidence/agent-access-20261011-closeout-r3/budget',review=openBudget(budgetRoot,'review'),admission=openBudget(budgetRoot,'admission'),count=b=>fs.readdirSync(b.dir).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
if(count(review)!==268||review.limit()!==273||count(admission)!==673||admission.limit()!==689)throw Error('预算实际基线不符');
const launcher=fs.readFileSync(prior+'/launch-v15.mjs','utf8');if(launcher.split('formal-round-authorization-v11.json').length!==2)throw Error('授权引用不唯一');
const next=launcher.replace(launcher.split('\n')[0],'/** 独立按需委托仅22B/23C；v16仅切v12权威，guard和判据不变。 */').replace('formal-round-authorization-v11.json','formal-round-authorization-v12.json'),bytes=JSON.stringify(auth,null,2)+'\n';
save(prior+'/formal-round-authority-v11-preserved.json',pointer.toString());save(prior+'/formal-round-authorization-v12.json',bytes);save(prior+'/launch-v16.mjs',next);
const temp=prior+'/authority-'+crypto.randomUUID()+'.tmp';save(temp,{topic,authorization:'formal-round-authorization-v12.json',sha256:hash(bytes),basis:'Bob独立按需正式轮次委托；仅22B计划与23C完整代码，24拒绝；不包含判据替代。',recorded_at:new Date().toISOString()});fs.renameSync(temp,prior+'/formal-round-authority.json');
const extension=review.extend('formal-round22-plan-denial-evidence',15,'用户独立按需轮次与CLI自动扩容委托；22B baseline268预计15硬20止288，原273扩15；准入0，不采用替代判据');
saveEvidence(root+'/review-round22-budget-extension.json',extension);saveEvidence(root+'/review-round22-plan-batch.json',{at:new Date().toISOString(),pool:'review',before:268,expected:15,hard_limit:20,batch_stop:288,pool_limit:review.limit(),formal:{used:21,limit:23,this_round:22,entry:'B',stage:'plan'},admission:{used:673,limit:689,new_starts:0},counting:'版本帮助认证失败超时包装native重试均计启动；达到288先停再扩；23C后续单独发布批清单。',criteria_change:false});
saveEvidence(root+'/formal-round22-23-authorization-verification.json',{at:new Date().toISOString(),authorization_sha256:hash(bytes),preserved_pointer_sha256:hash(pointer),launcher_sha256:hash(next),old_launcher_sha256:hash(launcher),historical_ids:auth.historical_run_ids,old_runs:task.runs,old_approvals:task.approvals,cases,delegation_exact_reply:auth.delegation_exact_reply,criteria_change_authorized:false,supersedes_file:auth.supersedes_file,supersedes_sha256:auth.supersedes_sha256,vendor_cli_starts:0});
console.log(JSON.stringify({formal:'21/23',review:'268/288',admission:'673/689',cases:cases.length,new_vendor_starts:0}));
