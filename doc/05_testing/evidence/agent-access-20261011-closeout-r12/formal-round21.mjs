/** 21C相对39ed完整重审，沿原任务焦点与v14；先静态落盘冻结后启动。 */
import path from 'node:path';
import { spawn } from 'node:child_process';
const repo=process.cwd(),topic='Agent双模式接入真实准入收口',prior='doc/05_testing/evidence/agent-access-20261011-closeout-r3/',root='doc/05_testing/evidence/agent-access-20261011-closeout-r12/';
const focus='继续推进 /Users/chenzhenbo/Work/TriviumCode 的“Agent双模式接入真实准入收口”，完成遗留整改、有效复审与真实准入取证，作为 M11 第12步全量验收的前置任务。',base='39ed20530d64a72f81f183095c6d9516632d0228';
const context=['src/trivium/adapters/claude.ts','src/trivium/adapters/codex.ts','src/trivium/adapters/claude-route.ts','src/trivium/probes/claude.ts','src/trivium/probes/claude-directory.ts','src/trivium/probes/codex.ts','src/trivium/freeze.ts',
'scripts/agent-access-closeout.mjs','scripts/agent-access-recipes.mjs','scripts/agent-access-evidence.mjs','scripts/agent-access-write-contract.mjs','scripts/agent-access-budget-preload.cjs',
'test/unit/agent-access-write-contract.test.ts','test/unit/agent-access-read-evidence.test.ts','test/unit/agent-access-recovery.test.ts','test/unit/agent-access-task-launch.test.ts','test/unit/claude-directory.test.ts','test/integration/claude-directory-adapter.test.ts','test/fixtures/agent-access-prompt-replay.json',
...['launch-v15.mjs','quiet-launch-v8.mjs','round-guard-v2.mjs','formal-start-precheck-v2.mjs','formal-round-authorization-v11.json','formal-round-authority.json'].map(n=>prior+n),
`.reviews/${topic}/plan/2026-10-11-${topic}-r22-codex.md`,
...['static-audit-before21.json','static-audit-after21-preflight.json','config-after21-preflight-observation.json','pre-round21-admission-matrix.md','review-round21-code-batch.json','check-pair-r23-final-scope.json','post-round20-code-status.json','post-round20-failure-followup-proposal.md','formal-round21-authorization-verification.json'].map(n=>root+n),
'doc/05_testing/evidence/agent-access-20261011-closeout-r10/codex-qwen-write4-diagnostic.json','doc/05_testing/evidence/agent-access-20261011-closeout-r10/config-after19-preflight-observation.json',
'doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md','doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md','doc/02_design/ADR_003_agent_access.md','doc/03_api/PROTOCOL_dual_critic_relay.md','skills/dual-critic/SKILL.md'].join(',');
const shared=['--stage','code','--driver','codex','--critics','claude,gemini,glm'],mode=process.argv[2];
const args=mode==='resolve'?['topic','resolve','--stage','code','--json','--',focus,'--topic',topic,'--driver','codex','--critics','claude,gemini,glm','--base',base,'--context',context]:mode==='preflight'?['preflight',...shared,'--json']:mode==='start'?['review','--start','--entry','C',...shared,'--topic',topic,'--focus',focus,'--base',base,'--context',context,'--json']:mode==='wait'?['review','--wait',process.argv[3],'--timeout',process.argv[4],'--json']:null;
if(!args)throw Error('未知正式操作');
const child=spawn(process.execPath,[path.join(repo,prior,'launch-v15.mjs'),'review','r23-code-'+mode,'tv',...args],{cwd:repo,stdio:'inherit'});
const[code]=await new Promise(resolve=>child.once('close',(...v)=>resolve(v)));process.exitCode=code??1;
