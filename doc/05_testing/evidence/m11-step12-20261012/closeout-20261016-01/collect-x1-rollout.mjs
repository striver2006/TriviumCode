/** X1：拷走 Codex 主攻会话 rollout（脱敏后落证据目录），核 7.7 提示语保真、入口出自本会话；读裁决件 front-matter（7.1）。只读源文件，零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
import {redactSecrets,scanSecrets} from '../../../../../dist/test/src/trivium/secrets.js';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012',RUN='20261016T053906Z';
const root=path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'sessions');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.startsWith('rollout-')&&e.name.endsWith('.jsonl')?[path.join(d,e.name)]:[]);
const from=Date.parse('2026-10-16T05:30:00Z');
const focus='审查 size 访问器的只读语义、与 items.length 的一致性及测试覆盖';
const enc=s=>JSON.stringify(s).slice(1,-1),has=(h,s)=>h.includes(s)||h.includes(enc(s));
const cands=walk(root).filter(f=>fs.statSync(f).mtimeMs>=from).filter(f=>{const t=fs.readFileSync(f,'utf8');return has(t,focus)&&t.includes(RUN);});
if(cands.length!==1)throw Error('候选 rollout 数不是 1：'+JSON.stringify(cands));
const src=cands[0],raw=fs.readFileSync(src,'utf8');
const red=redactSecrets(raw);
if(scanSecrets(red.content).length)throw Error('脱敏后仍有命中，拒绝落盘');
fs.writeFileSync(path.join(here,'x1-codex-rollout.redacted.jsonl'),red.content,{flag:'wx',mode:0o600});
const meta=JSON.parse(fs.readFileSync(path.join(F,'.reviews/m11-s12-codex/plan','_'+'meta','run-'+RUN+'.json'),'utf8'));
const runsRoot=path.join(os.homedir(),'.'+'trivium','runs');
const runDir=fs.readdirSync(runsRoot).map(p=>path.join(runsRoot,p,RUN)).find(d=>fs.existsSync(d));
const request=fs.readFileSync(path.join(runDir,'request.json'),'utf8');
const entry='$dual-review-plan '+focus+' --topic m11-s12-codex';
const fm=f=>{const t=fs.readFileSync(f,'utf8').split('\n');const end=t.indexOf('---',1);return t.slice(1,end).filter(l=>/^(role|kind|stage|run_id):/.test(l));};
const planDir=path.join(F,'.reviews/m11-s12-codex/plan');
const out={at:new Date().toISOString(),source:src,source_sha256:crypto.createHash('sha256').update(raw).digest('hex'),source_bytes:Buffer.byteLength(raw),redaction_hits:red.count,copy:'x1-codex-rollout.redacted.jsonl',
 c7_1:{draft:fm(path.join(planDir,'2026-10-16-m11-s12-codex-'+'codex.md')),revised:fm(path.join(planDir,'2026-10-16-m11-s12-codex-revised-'+'codex.md'))},
 c7_7:{entry_text_in_rollout:has(raw,entry),focus_in_rollout:has(raw,focus),meta_prompt_hint:meta.prompt_hint,meta_topic:meta.topic,focus_equals_prompt_hint:meta.prompt_hint===focus,focus_in_request_json:has(request,focus)},
 start_from_session:{run_id_in_rollout:raw.includes(RUN),review_start_mentions:(raw.match(/review --start/g)??[]).length}};
saveEvidence(path.join(here,'x1-rollout-assessment.json'),out);
console.log(JSON.stringify(out,null,1));
