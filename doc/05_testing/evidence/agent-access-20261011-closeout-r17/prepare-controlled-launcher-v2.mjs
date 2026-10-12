/** 首次派生锚误写from而实际为动态import；新版本保留失败原脚本。 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{pathToFileURL}from'node:url';import{saveEvidence}from'../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),original=root+'/prepare-controlled-launcher.mjs';let code=fs.readFileSync(original,'utf8');
for(const[old,next]of [["from './formal-start-precheck-v2.mjs'","import('./formal-start-precheck-v2.mjs')"],["from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs'","import('../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs')"]]){if(code.split(old).length!==2)throw Error('修正锚不唯一');code=code.replace(old,next);}
saveEvidence(root+'/controlled-launcher-initial-failure.json',{at:new Date().toISOString(),source_sha256:crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex'),failure:'首次派生仅在内存处理，动态import匹配锚写为from；校验拒绝，未产出launcher、无CLI启动',new_vendor_starts:0});
const target=root+'/prepare-controlled-launcher-corrected.mjs';fs.writeFileSync(target,code,{flag:'wx',mode:0o600});await import(pathToFileURL(target));
