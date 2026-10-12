/** 按package.json的完整测试glob执行；独立资产检查不重建生产bundle。 */
import path from 'node:path';
import {run} from '../../../../dist/test/src/trivium/util/exec.js';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),before=hash('skills/dual-critic/scripts/trivium.cjs');
const r=await run(process.execPath,['--test','dist/test/**/*.test.js'],{timeoutMs:600000,killTree:true});
const record={at:new Date().toISOString(),script_sha256:hash(new URL(import.meta.url)),argv:[process.execPath,'--test','dist/test/**/*.test.js'],code:r.code,timed_out:r.timedOut,duration_ms:r.durationMs,truncated:r.truncated,stdout:r.stdout,stderr:r.stderr,bundle_before:before,bundle_after:hash('skills/dual-critic/scripts/trivium.cjs'),new_vendor_starts:0,full_npm_check:false,prior_command_error_and_timeout_preserved:true};
saveEvidence(root+'/full-compiled-tests-before27-v4.json',record);
console.log(JSON.stringify({code:r.code,timed_out:r.timedOut,summary:r.stdout.split('\n').filter(l=>/^ℹ (tests|pass|fail|skipped|duration_ms)/.test(l)),stderr:r.stderr.slice(-1000),bundle_unchanged:record.bundle_before===record.bundle_after}));
process.exitCode=r.code===0&&!r.timedOut&&record.bundle_before===record.bundle_after?0:1;
