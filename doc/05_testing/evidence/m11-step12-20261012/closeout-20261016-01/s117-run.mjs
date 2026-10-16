/** 11.7：经夹具验收外壳发起一次 plan 审查（不带 --entry、不带档位旗标）并等到结束。review --start 只调一次；--wait 可多次（只读）。 */
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const tv=path.join(F,'.'+'trivium','bin','trivium');
const planFile=path.join(F,'.reviews','m11-s12-tier','plan','2026-10-16-m11-s12-tier-'+'claude.md');
const call=args=>{const r=spawnSync(tv,args,{cwd:F,encoding:'utf8'});return {code:r.status,out:r.stdout,err:r.stderr};};
const start=call(['review','--start','--stage','plan','--topic','m11-s12-tier','--driver','claude',
 '--focus','档位表格子 {tier} 验证：审查 BoundedStack 的 isEmpty() 计划',
 '--goal','为BoundedStack新增isEmpty()只读判空方法并补充测试',
 '--plan-file',planFile,'--critics','codex,gemini','--context','src/stack.js,test/stack.test.js',
 '--driver-model','claude-opus-5-5','--driver-provider','anthropic','--json']);
console.log('start code=',start.code);console.log(start.out.slice(0,1500));console.error(start.err.slice(0,1500));
if(start.code!==0)process.exit(1);
const runId=JSON.parse(start.out).run_id;
for(let i=0;i<20;i++){
 const w=call(['review','--wait',runId,'--timeout','180','--json']);
 console.log('wait#'+i,'code=',w.code);
 if(w.code!==73){console.log(w.out.slice(0,3000));console.error(w.err.slice(0,1000));break;}
}
