import fs from 'node:fs';
import path from 'node:path';
import { hash } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import { saveEvidence } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),read=p=>JSON.parse(fs.readFileSync(p));
const batch=read(root+'/codex-refresh-batch.json'),old=read(root+'/selection-after23-qwen-complete.json');
const terminal=read(root+'/remaining-controller-terminal.json');
if(terminal.failure||terminal.completed.length!==15)throw Error('已公布剩余臂未全部完成');
const routes={...old.routes},version_contexts={};
for(const j of batch.jobs){const dir=batch.evidence_root+'/routes/'+j.route_directory,d=read(root+'/'+j.name+'-dispatch.json');if(d.code!==0)throw Error('请求未成功');const ref={variant:Number(j.args[j.args[0]==='static'?3:3]),...Object.fromEntries(['requested.json','result.json','fingerprints-after.json'].map(n=>[n,hash(dir+'/'+n)]))};
if(j.args[0]==='static'){version_contexts[j.name]={directory:j.route_directory,...ref};continue;}
const proof=read(root+'/'+j.name+'-proof.json');if(!proof.pass||proof.criteria_changed!==false)throw Error('原始判据未通过');const key=j.route_directory.replace(/-\d+$/,'');routes[key]=ref;}
const out={schema:'trivium.access.selection.v1',at:new Date().toISOString(),routes,versions:{...old.versions},version_contexts,batch_sha256:hash(root+'/codex-refresh-batch.json'),prior_selection_sha256:hash(root+'/selection-after23-qwen-complete.json'),implicit_fallback:false,criteria_changed:false,prerequisite_complete:false};
saveEvidence(root+'/selection-after23-seven-complete.json',out);
saveEvidence(root+'/codex-refresh-complete.json',{at:new Date().toISOString(),jobs:batch.jobs.map(j=>j.name),expected_starts:44,hard_max_starts:50,actual_starts:fs.readdirSync(batch.budget_root+'/ledger/admission').filter(n=>/^reserved-\d+\.json$/.test(n)).length-batch.before,batch_stop:batch.batch_stop,selection_sha256:hash(root+'/selection-after23-seven-complete.json'),all_original_arm_proofs_pass:true,automatic_retry:false,new_vendor_starts_for_observation:0,criteria_changed:false});
console.log(JSON.stringify({selection:'selection-after23-seven-complete.json',arms:18,implicit_fallback:false}));
