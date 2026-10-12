/** 状态及等待只经既有编排器，保持同一run，不写送审静态作用面。 */
import path from 'node:path';import {spawn} from 'node:child_process';
const repo=process.cwd(),[mode,runId]=process.argv.slice(2);if(!['status','wait'].includes(mode)||!/^\d{8}T\d{6}Z$/.test(runId??''))throw Error('用法 status|wait 真实run-id');
const child=spawn(process.execPath,[path.join(repo,'doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v18.mjs'),'review','r36-plan25-'+mode,'tv','review','--'+mode,runId,'--json'],{cwd:repo,env:process.env,stdio:'inherit'});
const[code]=await new Promise(r=>child.once('close',(...v)=>r(v)));process.exitCode=code??1;
