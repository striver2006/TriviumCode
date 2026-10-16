/** 只读：对运行根下超过阈值的 request.json 跑生产 scanSecrets，只记规则命中数，不输出匹配内容。不删、不改、零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
import {scanSecrets} from '../../../../../dist/test/src/trivium/secrets.js';
const root=path.join(process.env.HOME,'.'+'trivium','runs'),minBytes=8e6,rows=[];
for(const proj of fs.readdirSync(root).sort()){
 const pd=path.join(root,proj);if(!fs.statSync(pd).isDirectory())continue;
 for(const run of fs.readdirSync(pd).sort()){
  const f=path.join(pd,run,'request.json');let st;try{st=fs.statSync(f);}catch{continue;}
  if(st.size<minBytes)continue;
  const byRule={};for(const h of scanSecrets(fs.readFileSync(f,'utf8')))byRule[h.rule]=(byRule[h.rule]??0)+1;
  rows.push({run:proj+'/'+run,bytes:st.size,hits:Object.values(byRule).reduce((a,b)=>a+b,0),byRule});
 }
}
saveEvidence(import.meta.dirname+'/oversized-requests-scan.json',{at:new Date().toISOString(),scanner:'dist/test/src/trivium/secrets.js scanSecrets',min_bytes:minBytes,count:rows.length,total_hits:rows.reduce((a,r)=>a+r.hits,0),rows});
console.log(JSON.stringify({count:rows.length,total_hits:rows.reduce((a,r)=>a+r.hits,0)}));
