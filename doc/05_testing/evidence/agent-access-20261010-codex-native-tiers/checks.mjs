import {spawn} from 'node:child_process';
import path from 'node:path';
import {saveEvidence} from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
const repo='/Users/chenzhenbo/Work/TriviumCode';const root=path.join(repo,'doc/05_testing/evidence/agent-access-20261010-codex-native-tiers');
for(const n of [1,2]){
 const start=new Date().toISOString();console.log(`check-${n} 开始 ${start}`);
 const p=spawn('npm',['run','check'],{cwd:repo,env:process.env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
 const [code,signal]=await new Promise(resolve=>p.once('close',(...x)=>resolve(x)));
 const stats=Object.fromEntries([...stdout.matchAll(/^ℹ (tests|pass|fail|skipped) (\d+)/gm)].map(m=>[m[1],Number(m[2])]));
 saveEvidence(path.join(root,`check-${n}.json`),{name:`check-${n}`,args:['run','check'],start,end:new Date().toISOString(),code,signal,stats,stdout,stderr});
 console.log(JSON.stringify({name:`check-${n}`,code,stats}));if(code!==0){process.exitCode=code??1;break;}
}
