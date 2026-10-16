/**
 * 剧本 7.6（Bob 在系统终端执行一次）：m11-s12-cross / code 闸门期，造缺件、造改件各一次，approve 均应退 2，逐次恢复并核 hash。
 * approve 直接调安装 bundle（不经验收外壳：外壳的 approve 需要具名批准回执，而这里要测的正是产品自身的拒绝）。approve 不拉起厂商 CLI。
 * 任何一步与预期不符立即停，**不自动恢复**，打印现场，交主会话核对。
 *   node /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/closeout-20261016-01/user-s76.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012',RUN='20261016T050612Z';
const dir=path.join(F,'.reviews','m11-s12-cross','code');
const role=r=>'2026-10-16-m11-s12-cross-'+r+'.md';
const missingFile=path.join(dir,role('gemini')),changedFile=path.join(dir,role('codex'));
const bundle=path.join(os.homedir(),'.claude','skills','dual-critic','scripts','trivium.cjs');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const state=()=>JSON.parse(fs.readFileSync(path.join(F,'.'+'trivium','state'+'.json'),'utf8')).gates['m11-s12-cross/code'];
const approvals=()=>JSON.parse(fs.readFileSync(path.join(F,'.reviews','m11-s12-cross','task'+'.json'),'utf8')).approvals.filter(a=>a.run_id===RUN).length;
const backupDir=path.join(here,'z2-s76-backup');
const log={at:new Date().toISOString(),executor:'Bob 系统终端',run_id:RUN,bundle_sha256:sha(bundle),steps:[]};
const stop=msg=>{log.stopped=msg;log.finished_at=new Date().toISOString();saveEvidence(path.join(here,'user-s76-result.json'),log);console.error('✗ 停止：'+msg+'\n现场未恢复，请把这段输出贴给主会话。');process.exit(1);};
const approve=label=>{const r=spawnSync(process.execPath,[bundle,'approve','--topic','m11-s12-cross','--stage','code'],{cwd:F,encoding:'utf8'});
 const step={label,exit:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,gate_after:state()?.state,approvals_after:approvals()};log.steps.push(step);
 console.log(`[${label}] approve exit=${r.status}\n${(r.stdout+r.stderr).trim()}\n`);return step;};
// 前置
const g=state();
if(g?.state!=='awaiting_approval'||g.run_id!==RUN)stop('闸门不是本轮 awaiting_approval：'+JSON.stringify(g));
if(approvals()!==0)stop('本轮已有审批记录');
const orig={missing:sha(missingFile),changed:sha(changedFile)};log.original=orig;
fs.mkdirSync(backupDir,{recursive:false});
fs.copyFileSync(missingFile,path.join(backupDir,'missing.bak'),fs.constants.COPYFILE_EXCL);
fs.copyFileSync(changedFile,path.join(backupDir,'changed.bak'),fs.constants.COPYFILE_EXCL);
if(sha(path.join(backupDir,'missing.bak'))!==orig.missing||sha(path.join(backupDir,'changed.bak'))!==orig.changed)stop('备份 hash 不符');
// ① 缺件
fs.renameSync(missingFile,path.join(backupDir,'missing.moved'));
let s=approve('缺件');
if(s.exit!==2||s.gate_after!=='awaiting_approval'||s.approvals_after!==0)stop('缺件时 approve 未按预期退 2 或闸门已变');
fs.renameSync(path.join(backupDir,'missing.moved'),missingFile);
if(sha(missingFile)!==orig.missing)stop('缺件恢复后 hash 不符');
log.steps.push({label:'缺件恢复',sha256_ok:true});
// ② 改件（末尾追加一个换行）
fs.appendFileSync(changedFile,'\n');
log.changed_sha256=sha(changedFile);
s=approve('改件');
if(s.exit!==2||s.gate_after!=='awaiting_approval'||s.approvals_after!==0)stop('改件时 approve 未按预期退 2 或闸门已变');
fs.copyFileSync(path.join(backupDir,'changed.bak'),changedFile);
if(sha(changedFile)!==orig.changed)stop('改件恢复后 hash 不符');
log.steps.push({label:'改件恢复',sha256_ok:true});
// 收尾
log.final={missing:sha(missingFile)===orig.missing,changed:sha(changedFile)===orig.changed,gate:state()?.state,approvals:approvals()};
log.finished_at=new Date().toISOString();
saveEvidence(path.join(here,'user-s76-result.json'),log);
console.log('✓ 7.6 两次 approve 均退 2，两份审查件已恢复原字节，闸门仍 awaiting_approval、本轮无审批。结果：'+path.join(here,'user-s76-result.json'));
