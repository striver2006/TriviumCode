/**
 * X2 / 剧本 9.6（Bob 在系统终端，发 Codex 入口**之前**启动）：等 m11-s12-codex plan 第 2 轮审查开跑，
 * 运行状态为 running 时在 src/stack.js 末尾追加一行，模拟「审查进行中改业务文件」。只改这一个文件一次，零厂商调用。
 *   node /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/closeout-20261016-01/user-x2-watch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012',X1='20261016T053906Z';
const target=path.join(F,'src','stack.js'),taskFile=path.join(F,'.reviews','m11-s12-codex','task'+'.json');
const runsRoot=path.join(os.homedir(),'.'+'trivium','runs');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before=sha(target),started=Date.now(),deadline=started+40*60*1000;
console.log('等待 m11-s12-codex plan 第 2 轮开跑（最长 40 分钟）……现在可以去 Codex 发入口了。');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let run=null,status=null;
while(Date.now()<deadline){
 try{
  const task=JSON.parse(fs.readFileSync(taskFile,'utf8'));
  const r=task.runs.filter(x=>x.stage==='plan'&&x.run_id!==X1).at(-1);
  if(r){
   const dir=fs.readdirSync(runsRoot).map(p=>path.join(runsRoot,p,r.run_id)).find(d=>fs.existsSync(d));
   if(dir){status=JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8'));
    // status.json 的阶段字段是 phase：starting → running → success / failed / cancelled
    if(status.phase==='running'){run=r;break;}
    if(status.phase!=='starting'){console.error('✗ 第 2 轮已结束才看到，错过窗口：phase='+status.phase);process.exit(1);}}
  }
 }catch(e){if(e.code!=='ENOENT')throw e;}
 await sleep(1000);
}
if(!run){console.error('✗ 40 分钟内没等到第 2 轮开跑');process.exit(1);}
await sleep(5000); // 让 worker 先写下送审快照
fs.appendFileSync(target,'// M11 剧本9.6 审查进行中改动\n');
const out={at:new Date().toISOString(),executor:'Bob 系统终端（watcher）',run_id:run.run_id,rerun_index:run.rerun_index,status_at_change:status,target:'src/stack.js',sha256_before:before,sha256_after:sha(target),line:'// M11 剧本9.6 审查进行中改动'};
saveEvidence(path.join(here,'user-x2-watch-result.json'),out);
console.log('✓ 已在审查进行中改 src/stack.js（run '+run.run_id+'）。结果：'+path.join(here,'user-x2-watch-result.json'));
