/** 本批16B正式参数，全部经v12编排器；静态证据冻结后start。 */
import path from 'node:path';
import { spawn } from 'node:child_process';
const repo=process.cwd(),topic='Agent双模式接入真实准入收口',prior='doc/05_testing/evidence/agent-access-20261011-closeout-r3/',root='doc/05_testing/evidence/agent-access-20261011-closeout-r8/';
const subject=path.join(repo,'.reviews',topic,'plan',`2026-10-11-${topic}-r19-codex.md`),focus='授权轮次可以按需增加，不必询问授权';
const context=['scripts/agent-access-recipes.mjs','scripts/agent-access-evidence.mjs','scripts/agent-access-closeout.mjs','src/trivium/adapters/codex.ts','src/trivium/probes/fixture.ts','test/unit/agent-access-recovery.test.ts','test/unit/agent-access-applicability.test.ts',
...['launch-v12.mjs','round-guard-v2.mjs','formal-start-precheck-v2.mjs','formal-round-authorization-v8.json','formal-round-authority.json'].map(f=>prior+f),
root+'static-audit-before16.json',root+'plan-r19-body.md',root+'formal-round16-authorization-verification.json',
'doc/05_testing/evidence/agent-access-20261011-closeout-r7/matrix-admission15.md','doc/05_testing/evidence/agent-access-20261011-closeout-r7/codex-qwen-read3-diagnostic.json',
'doc/05_testing/evidence/agent-access-20261011-closeout-r7/final-admission15-audit.json','doc/05_testing/evidence/agent-access-20261011-closeout-r7/post-round15-read-evidence-plan-proposal.md',
'doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md','doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md','doc/02_design/ADR_003_agent_access.md','doc/03_api/PROTOCOL_dual_critic_relay.md'].join(',');
const shared=['--stage','plan','--driver','codex','--critics','claude,gemini,glm'],mode=process.argv[2];
const args=mode==='resolve'?['topic','resolve','--stage','plan','--json','--',focus,'--topic',topic,'--driver','codex','--plan-file',subject,'--critics','claude,gemini,glm','--context',context]:mode==='preflight'?['preflight',...shared,'--json']:mode==='start'?['review','--start','--entry','B',...shared,'--topic',topic,'--focus',focus,'--plan-file',subject,'--context',context,'--json']:mode==='wait'?['review','--wait',process.argv[3],'--timeout',process.argv[4],'--json']:null;
if(!args)throw Error('未知正式操作');
const child=spawn(process.execPath,[path.join(repo,prior,'launch-v12.mjs'),'review','r20-plan-'+mode,'tv',...args],{cwd:repo,stdio:'inherit'});
const[code]=await new Promise(resolve=>child.once('close',(...v)=>resolve(v)));process.exitCode=code??1;
