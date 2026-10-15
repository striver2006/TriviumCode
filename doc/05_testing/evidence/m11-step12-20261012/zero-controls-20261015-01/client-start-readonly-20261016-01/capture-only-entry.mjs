#!/opt/homebrew/opt/node/bin/node
/** 未配置的动态诊断候选：任何情况下都不 spawn/exec native，不是预算护栏。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const expected='/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-plan-20261016-01/archive';
// 明确缺授权即拒绝；本轮不生成此授权。即使获批，仍绝不向下启动。
const receipt=here+'/capture-only-authorization.json';
if(!fs.existsSync(receipt)){process.stderr.write('M11 capture-only: 未获动态取证授权；native 未启动。\n');process.exitCode=2;}
else {
 const auth=JSON.parse(fs.readFileSync(receipt,'utf8'));
 if(auth.decision!=='approved'||auth.scope!=='s5-launch-capture-only'||auth.entry_sha256!==hash(fs.readFileSync(import.meta.filename))||auth.parent_pre_spawn_gate_verified!==true||!auth.user_instruction){
  process.stderr.write('M11 capture-only: 授权或父级计数证据不足；native 未启动。\n');process.exitCode=2;
 }else{
  const args=process.argv.slice(2),cwd=fs.realpathSync(process.cwd());
  const allowedNative='/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/client-start-readonly-20261016-01/diagnostic-isolation/extensions/anthropic.claude-code-2.1.296-darwin-arm64/resources/native-binary/claude';
  const native=args.find(a=>a===allowedNative)??null;
  const out={at:new Date().toISOString(),pid:process.pid,ppid:process.ppid,cwd:cwd===expected?cwd:null,cwd_matches:cwd===expected,
   argv_count:args.length,argv_sha256:hash(JSON.stringify(args)),native_path:native,
   native_sha256:native&&fs.existsSync(native)?hash(fs.readFileSync(native)):null,
   node_options_present:Object.hasOwn(process.env,'NODE_OPTIONS'),
   claude_project_dir_matches:process.env.CLAUDE_PROJECT_DIR===expected,
   native_spawned:false,actual_native_exit:null,entry_exit:2,
   scope:'辅助入口观测。父级已经启动本进程，不能由此证明预算事前拦截；不打印argv或环境内容。'};
  // 一个成功样本后重复调用只能失败；无法据此限制重复入口进程的数量。
  saveEvidence(here+'/capture-only-observation.json',out);
  process.stderr.write('M11 capture-only: 采样结束，按设计拒绝；native 未启动。\n');process.exitCode=2;
 }
}
