/** 精确选择已公布版本；未完成/失配不回退旧版本。零厂商CLI。 */
import fs from'node:fs';import path from'node:path';
import{hash}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import{saveEvidence}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),b=JSON.parse(fs.readFileSync(root+'/first-write-batch.json'));
for(const[name,variant]of[['qwen',21],['native',22]]){
 const dir=path.join(b.evidence_root,'routes','static-codex-version-'+variant),files=['requested.json','result.json','fingerprints-after.json'];
 const r=JSON.parse(fs.readFileSync(dir+'/result.json')),a=JSON.parse(fs.readFileSync(dir+'/fingerprints-after.json'));
 if(r.completed!==true||a.unchanged!==true)throw Error('公布版本未完成/漂移');
 const ref={variant,...Object.fromEntries(files.map(n=>[n,hash(dir+'/'+n)]))};
 saveEvidence(root+'/selection-first-'+name+'.json',{schema:'trivium.access.selection.v1',created_at:new Date().toISOString(),versions:{'static-codex-version':ref},routes:{},batch_sha256:hash(root+'/first-write-batch.json')});
}
console.log(JSON.stringify({versions_selected:[21,22],historical_fallback:false,new_vendor_cli_starts:0}));
