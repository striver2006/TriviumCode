/** 在真实仓库/归档上直调生产Hook；只传待判定字符串，不执行其中的写命令。 */
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const bundle=path.join(os.homedir(),'.claude/skills/dual-critic/scripts/trivium.cjs');
const topic='M11-档位全链路与文档收口';
const jobs=[
 ['5.1','hook-pre-commit','git commit -m x',0],
 ['6.1-delete','hook-pre-bash',`rm .reviews/${topic}/plan/2026-10-07-${topic}-gemini.md`,2],
 ['6.1-edit','hook-pre-bash',`sed -i '' 's/blocker/minor/' .reviews/${topic}/plan/2026-10-07-${topic}-glm.md`,2],
 ['6.2','hook-pre-bash',`echo x > .reviews/${topic}/plan/_meta/task.json`,2],
 ['6.3','hook-pre-bash','rm -rf .trivium/bin',2],
 ['6.4','hook-pre-bash',`cat <<'EOF' > .reviews/${topic}/plan/_meta/run-x.json\n{}\nEOF`,2],
 ['6.5-cat-idle','hook-pre-bash','cat > src/foo.ts',0],
 ['6.5-checkout-idle','hook-pre-bash','git checkout -- src/',0],
 ['6.6-log','hook-pre-bash','git log --oneline -5',0],
 ['6.6-grep','hook-pre-bash','grep -rn foo src/',0],
];
const results=[];
for(const [id,hook,command,expected] of jobs){
 const input={session_id:'m11-step12-cli-only',tool_name:'Bash',tool_input:{command}};
 const argv=[bundle,'gate',hook,'--agent','claude'];const p=spawn(process.execPath,argv,{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.stdin.end(JSON.stringify(input));
 const [code,signal]=await new Promise(r=>p.once('close',(...v)=>r(v)));
 results.push({id,command:[process.execPath,...argv],input,expected,code,signal,stdout,stderr,pass:code===expected});
}
saveEvidence(import.meta.dirname+'/hook-cli.json',{at:new Date().toISOString(),cwd:process.cwd(),real_archive:true,client_hook_event:false,embedded_write_commands_executed:false,new_vendor_starts:0,results});
console.log(JSON.stringify(results.map(({id,code,expected,pass})=>({id,code,expected,pass}))));
