/** 剧本 10.3～10.7：经夹具验收外壳跑 report 人读与 --json，原样落证据并做机判。零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const tv=path.join(F,'.'+'trivium','bin','trivium');
const run=args=>{const r=spawnSync(tv,args,{cwd:F,encoding:'utf8'});return {args,exit:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr};};
const human=run(['report','--topic','m11-s12-cross']);
const js=run(['report','--topic','m11-s12-cross','--json']);
let parsed=null;try{parsed=JSON.parse(js.stdout);}catch{}
const agg=parsed?.aggregates??null;
// 裁决件行数（10.4 对照用）：数裁决表里以意见编号开头的行
const countRows=f=>fs.readFileSync(f,'utf8').split('\n').filter(l=>/^\|\s*(?:AGY|GLM|CODEX|GEMINI|CLAUDE)-[A-Z0-9-]*\d+\s*\|/.test(l)).length;
const planRev=path.join(F,'.reviews/m11-s12-cross/plan','2026-10-16-m11-s12-cross-revised-'+'claude.md');
const codeResp=path.join(F,'.reviews/m11-s12-cross/code','2026-10-16-m11-s12-cross-response-'+'glm.md');
const out={at:new Date().toISOString(),human,json:{...js,stdout:undefined},json_stdout:parsed??js.stdout,
 machine:{byDriver_keys:agg?.byDriver?Object.keys(agg.byDriver):null,unknownDriver:agg?.unknownDriver??null,
  disposition_rows:{plan_revised_claude:countRows(planRev),code_response_glm:countRows(codeResp)}}};
saveEvidence(path.join(here,'s10-report.json'),out);
console.log(human.stdout);console.error(human.stderr);
console.log('== exit human/json:',human.exit,js.exit);
console.log(JSON.stringify(out.machine,null,1));
console.log(JSON.stringify(agg,null,1).slice(0,4000));
