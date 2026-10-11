/** 14C正式参数固定；经v10现有编排器，显式39ed基线；审查中不写静态证据。 */
import path from 'node:path';
import { spawn } from 'node:child_process';
const repo=process.cwd(),topic='Agent双模式接入真实准入收口';
const prior='doc/05_testing/evidence/agent-access-20261011-closeout-r3/';
const context=['src/trivium/adapters/claude.ts','src/trivium/adapters/claude-route.ts','src/trivium/probes/claude.ts',
  'src/trivium/probes/claude-directory.ts','src/trivium/freeze.ts','scripts/agent-access-recipes.mjs','scripts/agent-access-evidence.mjs',
  'scripts/agent-access-budget-preload.cjs','test/unit/agent-access-recovery.test.ts','test/unit/agent-access-task-launch.test.ts',
  'test/unit/claude-directory.test.ts','test/integration/claude-directory-adapter.test.ts',
  ...['launch-v10.mjs','quiet-launch-v7.mjs','round-guard-v2.mjs','formal-start-precheck-v2.mjs','formal-round-authorization-v6.json','formal-round-authority.json'].map(n=>prior+n),
  `.reviews/${topic}/plan/2026-10-11-${topic}-r18-codex.md`,
  'doc/05_testing/evidence/agent-access-20261011-closeout-r6/pre-round14-state.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r6/pre-round14-admission-matrix.md',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r5/post-round12-admission-matrix.md',
  'doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md',
  'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md','doc/02_design/ADR_003_agent_access.md',
  'doc/03_api/PROTOCOL_dual_critic_relay.md'].join(',');
const focus='授权总14轮，先计划审查再代码重审（建议）';
const base='39ed20530d64a72f81f183095c6d9516632d0228';
const shared=['--stage','code','--driver','codex','--critics','claude,gemini,glm'];
const mode=process.argv[2];
const args=mode==='resolve'?['topic','resolve','--stage','code','--json','--',focus,'--topic',topic,'--driver','codex','--critics','claude,gemini,glm','--base',base,'--context',context]:
  mode==='preflight'?['preflight',...shared,'--json']:
  mode==='start'?['review','--start','--entry','C',...shared,'--topic',topic,'--focus',focus,'--base',base,'--context',context,'--json']:
  mode==='wait'?['review','--wait',process.argv[3],'--timeout',process.argv[4],'--json']:null;
if(!args)throw Error('未知正式操作');
const child=spawn(process.execPath,[path.join(repo,prior,'launch-v10.mjs'),'review','r18-code-'+mode,'tv',...args],{cwd:repo,stdio:'inherit'});
const [code]=await new Promise(resolve=>child.once('close',(...v)=>resolve(v)));process.exitCode=code??1;
