/**
 * X2 / 剧本 9.4 第二子句（Bob 在系统终端，X2 停在 awaiting_approval 之后、审批之前执行一次）：
 * 闸门期在 src/stack.js 再加一行并**先提交**，之后审批时看摘要是否照样列出。只提交 src/stack.js，零厂商调用。
 *   node /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/closeout-20261016-01/user-x2-gate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const git=(...a)=>execFileSync('git',['-C',F,...a],{encoding:'utf8'});
const gate=JSON.parse(fs.readFileSync(path.join(F,'.'+'trivium','state'+'.json'),'utf8')).gates['m11-s12-codex/plan'];
// X2（第 2 轮）因 GLM 网关超时失败，无停点；Bob 定 X3 补测，故认第 3 轮（2026-10-16 改）
if(gate?.state!=='awaiting_approval'||gate.rerun_index!==3){console.error('✗ 闸门不是 m11-s12-codex plan 第 3 轮 awaiting_approval：'+JSON.stringify(gate));process.exit(1);}
const head0=git('rev-parse','HEAD').trim();
fs.appendFileSync(path.join(F,'src','stack.js'),'// M11 剧本9.4 闸门期改动（先提交再审批）\n');
git('add','--','src/stack.js');
git('commit','-q','-m','test(fixture): 剧本9.4 闸门期改动先提交再审批');
const out={at:new Date().toISOString(),executor:'Bob 系统终端',gate,head_before:head0,head_after:git('rev-parse','HEAD').trim(),commit_files:git('show','--name-only','--format=','HEAD').split('\n').filter(Boolean),status_after:git('status','--porcelain=v1').split('\n').filter(Boolean)};
saveEvidence(path.join(here,'user-x2-gate-result.json'),out);
console.log('✓ 已提交闸门期改动 '+out.head_after+'，现在可以在终端跑 approve。');
