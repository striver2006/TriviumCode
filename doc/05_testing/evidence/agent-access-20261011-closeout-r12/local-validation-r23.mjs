/** 获批r23本地检查，0厂商CLI，完整输出脱敏防覆盖；两遍check必须串行。 */
import fs from 'node:fs';import path from 'node:path';import{spawn}from'node:child_process';
import{saveEvidence}from '../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),name=process.argv[2],variant=process.argv[3]??'1';
const commands={type:['npm',['run','typecheck']],build:['node',['scripts/build.mjs','--with-tests']],
unit:['node',['--test','dist/test/test/unit/agent-access-write-contract.test.js','dist/test/test/unit/agent-access-read-evidence.test.js','dist/test/test/unit/agent-access-recovery.test.js','dist/test/test/unit/agent-access-closeout.test.js','dist/test/test/unit/agent-access-budget.test.js','dist/test/test/unit/agent-access-task-launch.test.js','dist/test/test/unit/agent-access-applicability.test.js']],
check1:['npm',['run','check']],check2:['npm',['run','check']],selftest:['node',['skills/dual-critic/scripts/trivium.cjs','doctor','--selftest']],finalbuild:['npm',['run','build']]};
if(!/^[\w-]+$/.test(variant)||!commands[name])throw Error('未知检查');const file=path.join(root,`${name}-r23-${variant}.json`);if(fs.existsSync(file))throw Error('检查原件已存在，禁止覆盖');
const[bin,args]=commands[name],started_at=new Date().toISOString(),child=spawn(bin,args,{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',e=>stderr+=`local-validation:${e.code??'unknown'}\n`);const[code,signal]=await new Promise(r=>child.once('close',(...v)=>r(v)));
saveEvidence(file,{started_at,finished_at:new Date().toISOString(),bin,args,code,signal,stdout,stderr,vendor_cli_starts:0});console.log(JSON.stringify({file,code,signal,stdout_tail:stdout.split('\n').slice(-13).join('\n'),stderr_tail:stderr.split('\n').slice(-5).join('\n')}));process.exitCode=code??1;
