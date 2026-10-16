/** Z2：拷走 ZCode 主攻会话 rollout（脱敏后落证据目录），核 7.7 提示语保真与 7.8 入口出自本会话、无子代理会话。只读源文件，零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
import {redactSecrets,scanSecrets} from '../../../../../dist/test/src/trivium/secrets.js';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const SESS=process.argv[2],RUN='20261016T050612Z';
const rolloutDir=path.join(os.homedir(),'.zcode','cli','rollout'),src=path.join(rolloutDir,'model-io-sess_'+SESS+'.jsonl');
const raw=fs.readFileSync(src,'utf8'),srcSha=crypto.createHash('sha256').update(raw).digest('hex');
const red=redactSecrets(raw);
if(scanSecrets(red.content).length)throw Error('脱敏后仍有命中，拒绝落盘');
const copy=path.join(here,'z2-zcode-rollout.redacted.jsonl');
fs.writeFileSync(copy,red.content,{flag:'wx',mode:0o600});
const meta=JSON.parse(fs.readFileSync(path.join(F,'.reviews/m11-s12-cross/code','_'+'meta','run-'+RUN+'.json'),'utf8'));
const request=fs.readFileSync(path.join(os.homedir(),'.'+'trivium','runs','trivium-m11-step12-20261012-cfe48502',RUN,'request.json'),'utf8');
const focus='审查 clear() 实现与测试：返回值、capacity 不变、原地清空、清空后栈操作';
const entry='/dual-review-code '+focus+' --topic m11-s12-cross';
// rollout 里 JSON 字符串会转义，按 JSON 编码后的形态再搜一次
const enc=s=>JSON.stringify(s).slice(1,-1);
const has=(hay,s)=>hay.includes(s)||hay.includes(enc(s));
const lines=raw.split('\n').filter(Boolean);
const startLines=lines.filter(l=>/review\s+--start/.test(l)&&l.includes('--entry')&&/C/.test(l));
const window={from:Date.parse('2026-10-16T04:55:00Z'),to:Date.parse('2026-10-16T05:15:00Z')};
const subagents=fs.readdirSync(rolloutDir).filter(n=>n.startsWith('model-io-sess_subagent_')).map(n=>({n,m:fs.statSync(path.join(rolloutDir,n)).mtimeMs})).filter(x=>x.m>=window.from&&x.m<=window.to).map(x=>x.n);
const out={at:new Date().toISOString(),session:SESS,source:src,source_sha256:srcSha,source_bytes:Buffer.byteLength(raw),redaction_hits:red.count,copy:path.basename(copy),
 c7_7:{entry_text_in_rollout:has(raw,entry),focus_in_rollout:has(raw,focus),meta_prompt_hint:meta.prompt_hint??null,meta_topic:meta.topic,focus_equals_prompt_hint:meta.prompt_hint===focus,focus_in_request_json:has(request,focus)},
 c7_8:{review_start_lines_in_rollout:startLines.length,run_id_in_rollout:has(raw,RUN),subagent_rollouts_in_window:subagents}};
saveEvidence(here+'/z2-rollout-assessment.json',out);
console.log(JSON.stringify(out,null,1));
