/** r19本地校验，完整输出脱敏留痕；不启动厂商CLI。每个variant防覆盖。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(fileURLToPath(import.meta.url));
const name=process.argv[2];
const commands={type:['npm',['run','typecheck']],build:['node',['scripts/build.mjs','--with-tests']],
  unit:['node',['--test','dist/test/test/unit/agent-access-recovery.test.js','dist/test/test/unit/agent-access-task-launch.test.js']],
  check1:['npm',['run','check']],check2:['npm',['run','check']],selftest:['node',['skills/dual-critic/scripts/trivium.cjs','doctor','--selftest']],
  finalbuild:['npm',['run','build']]};
const variant=process.argv[3]??'1';if(!/^[\w-]+$/.test(variant)||!commands[name])throw Error('未知本地校验');
const file=path.join(root,`${name}-r19-${variant}.json`);if(fs.existsSync(file))throw Error('保留旧原件，不覆盖');
const [bin,args]=commands[name],started_at=new Date().toISOString();
const child=spawn(bin,args,{cwd:repo,env:process.env,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
child.on('error',e=>stderr+=`local-validation:${e.code??'unknown'}\n`);
const [code,signal]=await new Promise(resolve=>child.once('close',(...v)=>resolve(v)));
saveEvidence(file,{started_at,finished_at:new Date().toISOString(),bin,args,code,signal,stdout,stderr,vendor_cli_starts:0});
console.log(JSON.stringify({file,code,signal,stdout_tail:stdout.split('\n').slice(-13).join('\n'),stderr_tail:stderr.split('\n').slice(-5).join('\n')}));process.exitCode=code??1;
