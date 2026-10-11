/** 最后静态扫描与冻结；只在review --start之前运行一次。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),repo=process.cwd();
const files=fs.readdirSync(root).filter(n=>fs.statSync(path.join(root,n)).isFile());
const hashes=Object.fromEntries(files.map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex')]));
const findings=files.flatMap(n=>scanSecrets(fs.readFileSync(path.join(root,n),'utf8')).map(f=>({file:n,...f})));
if(findings.length)throw Error('静态证据有凭据');
let businessDiffCheck=true;try{execFileSync('git',['-c','core.quotePath=false','diff','--check','--','src','scripts','test','skills','skills-src','doc'],{encoding:'utf8'});}catch{businessDiffCheck=false;}
if(!businessDiffCheck)throw Error('业务差异空白检查失败');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const budgetRoot=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const b=openBudget(budgetRoot,'review'),used=fs.readdirSync(b.dir).filter(n=>n.startsWith('reserved-')).length;
if(used>=183)throw Error('本批硬上限到达，停止');
const callDir=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/calls');
const preflights=fs.readdirSync(callDir).filter(n=>n.startsWith('r18-code-preflight-')&&n.endsWith('-completed.json'));
if(preflights.length!==1)throw Error('本次preflight证据不唯一');
const preflight=JSON.parse(fs.readFileSync(path.join(callDir,preflights[0])));
if(preflight.code!==0||preflight.primary_loaded!==true)throw Error('preflight失败');
saveEvidence(path.join(root,'frozen-before-round14.json'),{at:new Date().toISOString(),hashes,secret_findings:findings,business_diff_check:businessDiffCheck,raw_archive_diff_whitespace:'历史编排器changes.diff有patch上下文空白，原件保留、不改写',freeze_scope:'从正式start到三侧结束及普通审批完成，不修改业务/静态证据；编排器运行元数据仅按既有规则',current_config_local_sha256:hash(path.join(repo,'.trivium/config.local.yaml')),preflight_original:path.join(callDir,preflights[0]),preflight_sha256:hash(path.join(callDir,preflights[0])),preflight_result:JSON.parse(preflight.stdout),review_budget:{used,limit:b.limit(),batch_stop:183},new_vendor_cli_starts:used-168});
console.log(JSON.stringify({files:files.length,secret_findings:0,business_diff_check:true}));
