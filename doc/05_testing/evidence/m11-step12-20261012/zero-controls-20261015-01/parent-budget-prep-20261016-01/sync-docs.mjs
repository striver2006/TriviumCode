/** 本轮仅在5.2～5.5追加证据与观察，不改判据或状态。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {read,hash,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname,base=path.resolve(here,'../..'),matrix=read(base+'/matrix.json');
assert.deepEqual(matrix,read(here+'/matrix-before.json'));
const ids=['5.2','5.3','5.4','5.5'],prefix='zero-controls-20261015-01/parent-budget-prep-20261016-01/';
for(const r of matrix.rows)if(ids.includes(r.criterion)){
 r.evidence.push(...['README.md','local-budget-results.json','budget-binding-results.json','candidate-diffs-final.json'].map(n=>prefix+n));
 r.observation=(r.observation??'')+'；2026-10-16父级零厂商准备：15项多进程本地替身与10项预算绑定检查通过，v2采集候选及完整差异未激活；真实扩展宿主加载/覆盖及首事件session绑定未验证，安全启动上限null，客户端状态不变。';
}
matrix.at=new Date().toISOString();
const esc=x=>String(x??'').replaceAll('|','\\|').replaceAll('\n',' ');
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').map(line=>{const m=/^\| \d+ \| (\d+\.\d+) \|/.exec(line);if(!m||!ids.includes(m[1]))return line;const r=matrix.rows.find(x=>x.criterion===m[1]);return '| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.join(', '),r.status].map(esc).join(' | ')+' |';}).join('\n');
fs.writeFileSync(base+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(base+'/matrix.md',md);
saveEvidence(here+'/matrix-sync.json',{at:new Date().toISOString(),changed_evidence_observation:ids,status_changes:[],matrix_sha256:hash(base+'/matrix.json'),markdown_sha256:hash(base+'/matrix.md')});
console.log(JSON.stringify({rows:matrix.rows.length,status_changes:[]}));
