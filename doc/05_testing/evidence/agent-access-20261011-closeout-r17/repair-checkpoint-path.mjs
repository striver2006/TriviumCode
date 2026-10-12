/** 保存零CLI预算根误用诊断；新v2不覆盖首次脚本或已复制原件。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname);
const original=root+'/record-plan24-checkpoint.mjs';
let code=fs.readFileSync(original,'utf8');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const replacements=[
 ['openBudget(external,pool)',"openBudget(external+'/budget',pool)"],
 ["fs.writeFileSync(target,text,{flag:'wx',mode:0o600});", "if(fs.existsSync(target)){if(hash(source)!==hash(target))throw Error('既有副本不符');}else fs.writeFileSync(target,text,{flag:'wx',mode:0o600});"],
];
for(const[old,next]of replacements){if(code.split(old).length!==2)throw Error('修正锚不唯一');code=code.replace(old,next);}
saveEvidence(root+'/zero-cli-checkpoint-path-failure.json',{at:new Date().toISOString(),original_script_sha256:hash(original),failure:{code:'ENOENT',expected:externalPath(),cause:'openBudget调用误传外部证据根而非budget根，读取approval.json失败；未reserve或启动任何CLI',partial_copies:13},correction:'新v2只修正预算根，并对首次已落盘副本核相等后复用，不覆盖原件',new_vendor_starts:0});
function externalPath(){return '/Users/chenzhenbo/.trivium/evidence/agent-access-20261011-closeout-r3/budget/approval.json';}
const target=root+'/record-plan24-checkpoint-v2.mjs';
fs.writeFileSync(target,code,{flag:'wx',mode:0o600});
await import(pathToFileURL(target));
