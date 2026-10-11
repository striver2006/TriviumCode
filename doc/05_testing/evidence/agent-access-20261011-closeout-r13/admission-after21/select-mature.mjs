/** 当前已公布精确版本，缺失/变化拒绝；不寻找旧成功。 */
import fs from'node:fs';import path from'node:path';
import{hash}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import{saveEvidence}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),b=JSON.parse(fs.readFileSync(root+'/mature-batch.json'));
const ref=(key,variant)=>{const dir=b.evidence_root+'/routes/'+key+'-'+variant,r=JSON.parse(fs.readFileSync(dir+'/result.json')),a=JSON.parse(fs.readFileSync(dir+'/fingerprints-after.json'));if(!r.completed||!a.unchanged)throw Error('当前版本未完成/变化');return{variant,...Object.fromEntries(['requested.json','result.json','fingerprints-after.json'].map(n=>[n,hash(dir+'/'+n)]))};};
for(const[name,versions]of [['native',{'static-codex-version':ref('static-codex-version',22)}],['kimi',{'static-codex-version':ref('static-codex-version',23)}],['deepseek',{'static-codex-version':ref('static-codex-version',24)}],['claude-qwen',{'static-qwen-version':ref('static-qwen-version',6)}]])saveEvidence(root+'/selection-mature-'+name+'.json',{schema:'trivium.access.selection.v1',created_at:new Date().toISOString(),versions,routes:{},batch_sha256:hash(root+'/mature-batch.json'),implicit_fallback:false});
console.log(JSON.stringify({selected_versions:[22,23,24,6],new_vendor_starts:0}));
