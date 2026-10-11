/** 正式入口参数固定，所有执行经现有launcher与编排器；不手调审查员CLI。 */
import path from 'node:path';
import { spawn } from 'node:child_process';
const repo=process.cwd(),topic='Agent双模式接入真实准入收口';
const root='doc/05_testing/evidence/agent-access-20261011-closeout-r3/';
const context=['scripts/agent-access-recipes.mjs','test/unit/agent-access-recovery.test.ts',
  ...['round-guard-v2.mjs','launch-v9.mjs','quiet-launch-v6.mjs','formal-start-precheck-v2.mjs','formal-round-authorization-v6.json','formal-round-authority.json'].map(n=>root+n),
  'doc/05_testing/evidence/agent-access-20261011-closeout-r6/static-audit-round13.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r5/post-round12-quiet-static-audit.md',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r5/post-round12-admission-matrix.md',
  'doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md',
  'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md'].join(',');
const subject=path.join(repo,'.reviews',topic,'plan',`2026-10-11-${topic}-r17-codex.md`);
const focus='授权总14轮，先计划审查再代码重审（建议）';
const shared=['--stage','plan','--driver','codex','--critics','claude,gemini,glm'];
const mode=process.argv[2];
const args=mode==='resolve'?['topic','resolve','--stage','plan','--json','--',focus,'--topic',topic,'--driver','codex','--plan-file',subject,'--critics','claude,gemini,glm','--context',context]:
  mode==='preflight'?['preflight',...shared,'--json']:
  mode==='start'?['review','--start','--entry','B',...shared,'--topic',topic,'--focus',focus,'--plan-file',subject,'--context',context,'--json']:
  mode==='wait'?['review','--wait',process.argv[3],'--timeout',process.argv[4],'--json']:null;
if(!args)throw Error('未知正式操作');
const child=spawn(process.execPath,[path.join(repo,root,'launch-v9.mjs'),'review','r17-plan-'+mode,'tv',...args],{cwd:repo,stdio:'inherit'});
const [code]=await new Promise(resolve=>child.once('close',(...v)=>resolve(v)));process.exitCode=code??1;
