/** 用户授权总10轮的完整C入口；补充范围参数，不改写用户焦点。 */
import {spawn} from 'node:child_process';
const context=['src/trivium/adapters/claude.ts','src/trivium/probes/claude-directory.ts','src/trivium/probes/claude.ts',
 'src/trivium/readonly.ts','src/trivium/freeze.ts','src/trivium/types.ts','src/trivium/doctor.ts',
 'src/trivium/adapters/codex.ts','scripts/agent-access-closeout.mjs','scripts/agent-access-evidence.mjs',
 'scripts/agent-access-selection.mjs','test/unit/agent-access-recovery.test.ts','test/unit/agent-access-applicability.test.ts',
 'doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r4/round10-scope-and-minimum-admission.md',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r4/agent-access-applicability.mjs',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r4/current-full-fingerprint-diagnostic.json',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r4/shared-entry-reappearance-audit.json',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r4/migrate-install-round9.mjs',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r4/migration-install-round9.json',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v6.mjs',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v5.mjs',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs',
 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v4.json'];
const child=spawn(process.execPath,['doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v6.mjs',
 'review','r14-code-resolve','tv','topic','resolve','--stage','code','--json','--',
 '授权总10轮，先正式计划审查再代码重审','--topic','Agent双模式接入真实准入收口','--driver','codex',
 '--critics','claude,gemini,glm','--base','39ed20530d64a72f81f183095c6d9516632d0228','--context',context.join(',')],{stdio:'inherit'});
process.exitCode=await new Promise(resolve=>child.once('close',c=>resolve(c??1)));
