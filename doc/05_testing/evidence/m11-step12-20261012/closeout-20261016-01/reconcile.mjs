/** 按 user-decision.json 改判 1.4、5.2～5.5、8.1 六格的状态与观察；其余 62 行、判据、顺序不变。零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'..');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const matrix=JSON.parse(fs.readFileSync(base+'/matrix.json','utf8'));
assert.equal(matrix.rows.length,68);
const order=matrix.rows.map(r=>r.criterion),req=matrix.rows.map(r=>r.requirement);
saveEvidence(here+'/matrix-before.json',matrix);
const decision='closeout-20261016-01/user-decision.json';
const D='（用户2026-10-16定）';
const change={
 '1.4':['达成（边界）'+D+'：正式failed分支未触发；预检69失败如实停止且原稿保留已验证，不专门制造正式失败','正式review/verify失败分支本轮未触发，按D1同批计划派生项记边界达成。'],
 '5.2':['组合证据达成'+D+'：副本CLI缺件退出2并点名路径与run；同一hook-pre-commit通道的客户端放行(5.1)与退出2(6.7)已实证；真实会话内缺件负对照未触发','真实会话内缺件负对照未触发，判据靠CLI格与同通道客户端事件合证；父级启动计数控制转BACKLOG EV-235。'],
 '5.3':['组合证据达成'+D+'：副本CLI改件退出2且前后hash匹配；客户端通道同5.2；真实会话内改件负对照未触发','同5.2边界。'],
 '5.4':['组合证据达成'+D+'：缺件/改件恢复后CLI均退出0；客户端放行通道由5.1实证；真实会话内恢复后放行未单独触发','同5.2边界。'],
 '5.5':['组合证据达成'+D+'：无审查记录仓库CLI直调退出0；客户端放行通道由5.1实证；真实会话内未单独触发','同5.2边界。'],
 '8.1':['通过（边界）'+D+'：两轮critics_selected均三家、三份审查件齐备；B2三侧证据阈值通过为合格三审，B1 Codex证据不足如实保留、不重跑','判据本身（两轮三家、三份齐备）成立；「合格三审」只认B2。'],
};
const ids=Object.keys(change),before={};
for(const r of matrix.rows)if(ids.includes(r.criterion)){
 before[r.criterion]=r.status;
 r.status=change[r.criterion][0];
 r.evidence.push(decision);
 r.observation=(r.observation?r.observation+'；':'')+'2026-10-16收口改判：'+change[r.criterion][1];
}
assert.deepEqual(matrix.rows.map(r=>r.criterion),order);assert.deepEqual(matrix.rows.map(r=>r.requirement),req);
matrix.at=new Date().toISOString();
const escape=x=>String(x??'').replaceAll('|','\\|').replaceAll('\n',' ');
let touched=0;
const md=fs.readFileSync(base+'/matrix.md','utf8').split('\n').map(line=>{
 const m=/^\| \d+ \| (\d+\.\d+) \|/.exec(line);if(!m||!ids.includes(m[1]))return line;
 touched++;const r=matrix.rows.find(x=>x.criterion===m[1]);
 return '| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.join(', '),r.status].map(escape).join(' | ')+' |';
}).join('\n');
assert.equal(touched,ids.length);
fs.writeFileSync(base+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(base+'/matrix.md',md);
saveEvidence(here+'/matrix-sync.json',{at:matrix.at,decision,status_changes:ids.map(id=>({criterion:id,before:before[id],after:change[id][0]})),rows:68,matrix_sha256:hash(base+'/matrix.json'),markdown_sha256:hash(base+'/matrix.md')});
console.log(JSON.stringify({rows:matrix.rows.length,changed:ids}));
