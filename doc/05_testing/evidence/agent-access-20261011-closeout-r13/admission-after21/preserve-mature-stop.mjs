/** 新失败后停止未启动队列，保全本批终态和精确缺臂；不调整判据。 */
import fs from'node:fs';import path from'node:path';
import{hash}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import{saveEvidence}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),b=JSON.parse(fs.readFileSync(root+'/mature-batch.json')),jobs=b.jobs.map(j=>{const p=root+'/'+j.name+'-dispatch.json';return{...j,started:fs.existsSync(p),dispatch:fs.existsSync(p)?{file:p,sha256:hash(p),...JSON.parse(fs.readFileSync(p))}:null};});
const budget=b.budget_root+'/ledger/admission',names=fs.readdirSync(budget),used=names.filter(n=>/^reserved-\d+\.json$/.test(n)).length,complete=names.filter(n=>/^launch-\d+\.json$/.test(n)).length;
if(used!==673||used!==complete)throw Error('本批终态计数不符或有未完成启动');
saveEvidence(root+'/mature-stop.json',{at:new Date().toISOString(),reason:'ClaudeQwenRead六目标均有实际同IDis_error拒绝与精确permission_denials，但返回通用目录错误，canonical仅匹配携带路径旧文本，deny_pass=false；按获批r22新失败先停分析，不提示重试',batch_sha256:hash(root+'/mature-batch.json'),before:b.before,expected:b.expected_starts,hard:b.hard_max_starts,batch_stop:b.batch_stop,used,completed:complete,new_starts:used-b.before,unstarted_starts:jobs.filter(j=>!j.started).reduce((n,j)=>n+j.starts,0),jobs,all_observed_handles_terminal:true,criteria_changed:false,original_failure_preserved:true,goal_complete:false});
const source=root+'/finalize-mature.mjs',target=root+'/finalize-mature-partial.mjs';let text=fs.readFileSync(source,'utf8');
text=text.replace("const dir=b.evidence_root+'/routes/'+key+'-'+variant,r=", "const dir=b.evidence_root+'/routes/'+key+'-'+variant;if(!fs.existsSync(dir+'/result.json')){details.push({key,variant,completed:false,missing:'unstarted-after-new-failure'});return{variant};}const r=");
const exact="if(!fs.existsSync(file))throw Error('已公布请求未终结');";
if(text.split(exact).length!==2)throw Error('dispatch派生锚不是唯一');
text=text.replace(exact,"if(!fs.existsSync(file)){dispatches.push({file,started:false,reason:'unstarted-after-new-failure'});continue;}");
text=text.replaceAll('after21-mature','after21-mature-partial');
fs.writeFileSync(target,text,{flag:'wx',mode:0o600});
saveEvidence(root+'/mature-partial-derivation.json',{source,source_sha256:hash(source),target,target_sha256:hash(target),changes:['显式未启动臂variant不回退','未启动dispatch明确缺席','独立partial文件名'],acceptance_algorithm_unchanged:true,new_vendor_starts:0});
console.log(JSON.stringify({used,complete,new_starts:used-b.before,unstarted_starts:9,finalizer:target}));
