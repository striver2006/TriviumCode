/** 21C已批准成熟条件满足后：只发布Qwen/Luna读与禁读，不改生产脚本或判据。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { saveEvidence } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import { hash } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),first=JSON.parse(fs.readFileSync(root+'/first-write-batch.json'));
const require=createRequire(import.meta.url),{openBudget}=require(first.repo+'/scripts/agent-access-budget.cjs');
const count=()=>fs.readdirSync(first.budget_root+'/ledger/admission').filter(n=>/^reserved-\d+\.json$/.test(n)).length;
const writes=[];
for(const combination of ['qwen','native-luna']){
 const dir=first.evidence_root+'/routes/codex-'+combination+'-write-5',r=JSON.parse(fs.readFileSync(dir+'/result.json')),a=JSON.parse(fs.readFileSync(dir+'/fingerprints-after.json')),c=JSON.parse(fs.readFileSync(dir+'/cleanup.json'));
 const p=r.command_evidence.pairs.filter(p=>p.write_pass===true);
 if(r.completed!==true||r.structured.ok!==true||r.write_pass!==true||p.length!==1||p[0].unique_pair!==true||a.unchanged!==true||c.scratch_removed!==true||c.fixture_residue!==null||r.write_contract_diagnostic.source_consumed_before_write!==true||fs.existsSync(r.write_contract_diagnostic.before.declaration.cwd))throw Error('首批真实写/配对/指纹/诊断/清理未齐');
 writes.push({route:'codex/'+combination,readback:r.readback,original_write_pass:true,contract_diagnostic_only:r.write_contract_diagnostic,write_pair:p[0],structured_ok:r.structured.ok,structured_degraded:r.structured.degraded,fixture_root_absent_now:true,references:Object.fromEntries(['requested.json','result.json','fingerprints-after.json','fixture-before.json','fixture-after.json','cleanup.json'].map(n=>[dir+'/'+n,hash(dir+'/'+n)])),combination_pass:false,remaining:['read','deny']});
}
if(count()!==641)throw Error('首批完成计数非641');
saveEvidence(root+'/first-write-summary.json',{at:new Date().toISOString(),before:633,after:641,new_starts:8,hard_stop:645,criteria_changed:false,goal_complete:false,writes});
const before=count(),hard=12,stop=before+hard,budget=openBudget(first.budget_root,'admission'),additional=stop-budget.limit();
if(additional<=0)throw Error('本发布应需扩容');
const extension=budget.extend('after21-qwen-luna-read-deny-20261011',additional,'Bob已明确自动增加CLI额度；21C获批后Qwen/Luna原标准真实写通过，补同一最终指纹各read/deny一次；预计8，硬12，641→653，无重试，不增加正式轮数或改变判据');
saveEvidence(root+'/read-deny-budget-extension.json',extension);
const source=root+'/first-write.mjs',next=root+'/read-deny.mjs',original=fs.readFileSync(source,'utf8');
let text=original.replace('首批：每个已公布臂只一次','读取/禁读补批：每个已公布臂只一次').replace("root+'/first-write-batch.json'","root+'/read-deny-batch.json'").replaceAll("root+'/first-write-batch.json'","root+'/read-deny-batch.json'").replace("'r23-first-'+mode","'r24-read-deny-'+mode");
if(text===original)throw Error('派生壳未变化');
fs.writeFileSync(next,text,{flag:'wx',mode:0o600});
const jobs=[];
for(const [combination,selection]of [['qwen','selection-first-qwen.json'],['native-luna','selection-first-native.json']])for(const arm of ['read','deny']){
 const variant=combination==='qwen'?5:4,name=combination+'-'+arm,route_directory='codex-'+combination+'-'+arm+'-'+variant;
 if(fs.existsSync(first.evidence_root+'/routes/'+route_directory))throw Error('补批编号已存在');
 jobs.push({name,args:['codex',combination,arm,String(variant)],route_directory,starts:2,selection});
}
saveEvidence(root+'/read-deny-batch.json',{...first,at:new Date().toISOString(),before,expected_starts:8,hard_max_starts:hard,batch_stop:stop,pool_limit:budget.limit(),jobs,dispatcher_sha256:hash(next),dispatcher_derivation:{source,source_sha256:hash(source),changes:['批manifest名称','标签','说明注释'],same_production_scripts:true},rows:jobs.map(j=>({route:'codex/'+j.args[1],actual_model:null,expected_model:j.args[1]==='qwen'?'qwen3.8-flash':'gpt-6-luna',server_identity:null,gap:j.args[2]+'缺本最终指纹',reusable:'本批版本21/22及写5精确完整指纹；不消费旧包组合通过',necessary_starts:j.starts})),extension_sha256:hash(root+'/read-deny-budget-extension.json'),condition_write_summary_sha256:hash(root+'/first-write-summary.json'),counting:'预计8硬12，累计653即停；版本帮助失败超时wrapper/native重试实际启动计入；本批禁止自动重试，正式轮数0，原判据不变。'});
console.log(JSON.stringify({published:true,before,expected:8,hard,stop,pool_limit:budget.limit(),new_vendor_starts:0,batch_sha256:hash(root+'/read-deny-batch.json')}));
