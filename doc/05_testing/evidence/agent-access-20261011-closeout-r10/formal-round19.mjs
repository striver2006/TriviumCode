/** 19B完整计划正式参数：v14载体、固定原用户任务焦点，冻结后start；原标准不变。 */
import path from 'node:path';
import { spawn } from 'node:child_process';
const repo=process.cwd(),topic='Agent双模式接入真实准入收口',prior='doc/05_testing/evidence/agent-access-20261011-closeout-r3/',root='doc/05_testing/evidence/agent-access-20261011-closeout-r10/';
const subject=path.join(repo,'.reviews',topic,'plan',`2026-10-11-${topic}-r21-codex.md`),focus='继续推进 /Users/chenzhenbo/Work/TriviumCode 的“Agent双模式接入真实准入收口”，完成遗留整改、有效复审与真实准入取证，作为 M11 第12步全量验收的前置任务。';
const context=['scripts/agent-access-recipes.mjs','scripts/agent-access-evidence.mjs','scripts/agent-access-closeout.mjs','src/trivium/adapters/codex.ts','src/trivium/probes/fixture.ts','test/unit/agent-access-recovery.test.ts','test/unit/agent-access-applicability.test.ts',
...['launch-v14.mjs','round-guard-v2.mjs','formal-start-precheck-v2.mjs','formal-round-authorization-v10.json','formal-round-authority.json'].map(f=>prior+f),
root+'static-audit-before19.json',root+'static-audit-after19-preflight.json',root+'config-after19-preflight-observation.json',root+'authority19-unit-result.json',root+'plan-r21-body.md',root+'formal-round19-authorization-verification-v2.json',root+'review-round19-plan-batch-v2.json',root+'matrix-after18.md',root+'matrix-after18.json',root+'codex-qwen-write4-diagnostic.json',root+'final-after18-audit.json','src/trivium/probes/codex.ts',
'doc/05_testing/evidence/agent-access-20261011-closeout-r7/matrix-admission15.md','doc/05_testing/evidence/agent-access-20261011-closeout-r7/codex-qwen-read3-diagnostic.json',
'doc/05_testing/evidence/agent-access-20261011-closeout-r7/final-admission15-audit.json','doc/05_testing/evidence/agent-access-20261011-closeout-r7/post-round15-read-evidence-plan-proposal.md',
'doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md','doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md','doc/02_design/ADR_003_agent_access.md','doc/03_api/PROTOCOL_dual_critic_relay.md'].join(',');
const shared=['--stage','plan','--driver','codex','--critics','claude,gemini,glm'],mode=process.argv[2];
const args=mode==='resolve'?['topic','resolve','--stage','plan','--json','--',focus,'--topic',topic,'--driver','codex','--plan-file',subject,'--critics','claude,gemini,glm','--context',context]:mode==='preflight'?['preflight',...shared,'--json']:mode==='start'?['review','--start','--entry','B',...shared,'--topic',topic,'--focus',focus,'--plan-file',subject,'--context',context,'--json']:mode==='wait'?['review','--wait',process.argv[3],'--timeout',process.argv[4],'--json']:null;
if(!args)throw Error('未知正式操作');
const child=spawn(process.execPath,[path.join(repo,prior,'launch-v14.mjs'),'review','r23-plan-'+mode,'tv',...args],{cwd:repo,stdio:'inherit'});
const[code]=await new Promise(resolve=>child.once('close',(...v)=>resolve(v)));process.exitCode=code??1;
