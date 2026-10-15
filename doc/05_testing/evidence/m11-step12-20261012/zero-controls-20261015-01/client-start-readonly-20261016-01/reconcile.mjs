/** 只追加本批证据与观察；保留68行判据和全部状态。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {saveEvidence,read,hash} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname,base=path.resolve(here,'../..');
const prior=read(here+'/matrix-before.json'),matrix=read(base+'/matrix.json');assert.deepEqual(matrix,prior);
const prefix='zero-controls-20261015-01/client-start-readonly-20261016-01/';
const evidence=['README.md','START_PROPOSAL.md','before-state.json','configuration-proposal.json'];
const ids=['5.2','5.3','5.4','5.5'];
for(const r of matrix.rows)if(ids.includes(r.criterion)){
 r.evidence.push(...evidence.map(x=>prefix+x));
 r.observation=(r.observation??'')+'；2026-10-16只读核定启动链：现有侧车不覆盖VS Code Driver，machine级包装器/SDK清除NODE_OPTIONS/冻结预算等值校验均限制新启动；安全启动上限null。独立差异与分段提案已准备，未生效、未启动，客户端状态不变。';
}
matrix.at=new Date().toISOString();
const escape=x=>String(x??'').replaceAll('|','\\|').replaceAll('\n',' ');
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').map(line=>{
 const m=/^\| \d+ \| (\d+\.\d+) \|/.exec(line);if(!m||!ids.includes(m[1]))return line;
 const r=matrix.rows.find(x=>x.criterion===m[1]);
 return '| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.join(', '),r.status].map(escape).join(' | ')+' |';
}).join('\n');
fs.writeFileSync(base+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(base+'/matrix.md',md);
saveEvidence(here+'/matrix-sync.json',{at:new Date().toISOString(),changed_evidence_and_observation:ids,status_changes:[],matrix_sha256:hash(base+'/matrix.json'),markdown_sha256:hash(base+'/matrix.md')});
console.log(JSON.stringify({rows:matrix.rows.length,status_changes:[]}));
