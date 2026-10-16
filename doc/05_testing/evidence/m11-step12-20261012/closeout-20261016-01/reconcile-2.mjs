/** 收口第二次改判：按 z-verdicts / x-verdicts / x2-verdict / x3（9.4 第二句）/ s117-verdict 改剧本 7、9、10 与 11.7 的状态与证据。68 行判据、要求、顺序断言不变。零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'..'),P='closeout-20261016-01/';
const read=f=>JSON.parse(fs.readFileSync(path.join(here,f),'utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const matrix=JSON.parse(fs.readFileSync(base+'/matrix.json','utf8'));
assert.equal(matrix.rows.length,68);
const order=matrix.rows.map(r=>r.criterion),req=matrix.rows.map(r=>r.requirement);
saveEvidence(here+'/matrix-before-2.json',matrix);
const z=read('z-verdicts.json').verdicts,x=read('x-verdicts.json').verdicts,x2=read('x2-verdict.json').verdicts;
const s117=fs.existsSync(path.join(here,'s117-verdict.json'))?read('s117-verdict.json'):null;
const ev=list=>list.filter(e=>!e.includes('…')&&!e.includes(' ')).map(e=>P+e);
const change={};
for(const id of ['7.1','7.2','7.3','7.4','7.5','7.7']){
 assert.equal(z[id].pass,true);assert.equal(x[id].pass,true);
 change[id]={status:'本轮真实实跑通过：ZCode 主攻（Z2）与 Codex 主攻（X1）两家各一轮',evidence:[...ev(z[id].evidence),...ev(x[id].evidence)],observation:'ZCode：'+z[id].note+'；Codex：'+x[id].note};
}
for(const id of ['7.6','7.8']){assert.equal(z[id].pass,true);change[id]={status:'本轮真实实跑通过：ZCode 主攻（Z2）',evidence:ev(z[id].evidence),observation:z[id].note};}
for(const id of ['9.1','9.2','9.3','9.5']){assert.equal(x[id].pass,true);change[id]={status:'本轮真实实跑通过：Codex 主攻（X1）',evidence:ev(x[id].evidence),observation:x[id].note};}
const x3=read('x3-after-approval.json');assert.equal(x3.gate.state,'approved');
change['9.4']={status:'本轮真实实跑通过：X1 闸门期改动未提交即审批、X3 先提交再审批，摘要均列出 src/stack.js',evidence:[P+'x-verdicts.json',P+'user-x2-gate-result.json',P+'x3-assessment.json',P+'x3-after-approval.json'],observation:x['9.4'].note.replace('；第二子句（先提交再审批）留 X2','')+'；X3（20261016T080724Z）闸门期改动先提交 bae94328，approve 退 0 且摘要仍列「M  src/stack.js」（闸门期提交过的改动同样列出）'};
assert.equal(x2['9.6'].pass,true);
change['9.6']={status:'本轮真实实跑通过（可选格）：X2 审查进行中改 src/stack.js，drift.changed=true、policy=fail（该文件在 --context 内，按默认 on_drift_related=fail）',evidence:ev(x2['9.6'].evidence),observation:x2['9.6'].note+'；本轮另因 GLM Gateway Timeout 判 failed/partial，与判据无关'};
for(const id of ['10.1','10.2','10.3','10.4','10.5','10.6','10.7']){assert.equal(z[id].pass,true);change[id]={status:'本轮真实实跑通过：Claude 主攻 plan（Z1）→ ZCode 主攻 code（Z2）',evidence:ev(z[id].evidence),observation:z[id].note};}
if(s117){change['11.7']={status:s117.pass?'本轮真实实跑通过（可选格）：档位表格子 {tier: high}、无档位旗标':'本轮实跑判据不成立（可选格），见观察',evidence:[P+'s117-verdict.json',P+'s117-assessment.json'],observation:s117.note};}
const ids=Object.keys(change),before={};
for(const r of matrix.rows)if(ids.includes(r.criterion)){
 before[r.criterion]=r.status;const c=change[r.criterion];
 r.status=c.status;r.evidence=[...new Set([...(r.evidence??[]),...c.evidence])];
 r.observation=(r.observation?r.observation+'；':'')+'2026-10-16收口实跑：'+c.observation;
}
assert.deepEqual(matrix.rows.map(r=>r.criterion),order);assert.deepEqual(matrix.rows.map(r=>r.requirement),req);
matrix.at=new Date().toISOString();
const escape=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
let touched=0;
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').map(line=>{
 const m=/^\| \d+ \| (\d+\.\d+) \|/.exec(line);if(!m||!ids.includes(m[1]))return line;
 touched++;const r=matrix.rows.find(q=>q.criterion===m[1]);
 return '| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.join(', '),r.status].map(escape).join(' | ')+' |';
}).join('\n');
assert.equal(touched,ids.length);
fs.writeFileSync(base+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(base+'/matrix.md',md);
saveEvidence(here+'/matrix-sync-2.json',{at:matrix.at,status_changes:ids.map(id=>({criterion:id,before:before[id],after:change[id].status})),rows:68,matrix_sha256:hash(base+'/matrix.json'),markdown_sha256:hash(base+'/matrix.md')});
console.log(JSON.stringify({rows:68,changed:ids}));
