/** 不调用任何厂商；验证B装置的拒绝边界，不能当作真实命令B通过。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {helper} from './driver-identity.mjs';
import {allowed,strictReadiness,topic} from './qoder-plan.mjs';

const spec={topic,run_ids:['known-run']};
const start=['review','--start','--stage','plan','--topic',topic,'--driver','qoder-cn','--critics','gemini,glm','--entry','B'];
test('B传输策略保持指定主题、阶段、身份、审核集合与入口',()=>{
  assert.equal(allowed(start,spec),true);
  for(const [from,to] of [['plan','code'],[topic,'other'],['qoder-cn','codex'],['gemini,glm','gemini'],['B','A']])assert.equal(allowed(start.map(x=>x===from?to:x),spec),false);
  for(const tail of [['--allow-single'],['--only','glm'],['--driver','codex'],['--critics','glm'],['--worker','run'],['--cancel','run']])assert.equal(allowed([...start,...tail],spec),false);
});
test('审批、放弃、任意worker恢复及不明run拒绝',()=>{
  for(const args of [['approve','--topic',topic],['abandon','--topic',topic],['review','--worker','known-run'],['review','--wait','foreign-run'],['doctor','--only','agy'],['status']])assert.equal(allowed(args,spec),false);
  assert.equal(allowed(['review','--wait','known-run','--json'],spec),true);
  assert.equal(allowed(['gate','--topic',topic,'--stage','plan','--await-approval'],spec),true);
});
test('真实撰写的归档通道只允许本Driver的计划与裁决',()=>{
  assert.equal(allowed(['artifact','plan','2','drafts/p.md'],spec),true);
  assert.equal(allowed(['artifact','revised','1','drafts/r.md'],spec),true);
  for(const args of [['artifact','gemini','1','x'],['artifact','plan','0','x'],['artifact','plan','1'],['artifact','response','1','x']])assert.equal(allowed(args,spec),false);
});
test('只读availability、工具deny和无泄漏观测不覆盖路径负对照',()=>{
  const probe={probed_at:'2026-10-28',entrypoint:'/cli',path_deny:{supported:false,coverage_complete:null,file_shape_verified:null},readonly_flags:['--disallowed-tools Write,Bash']};
  const result=strictReadiness({probe:{cli:{agy:probe,zcode:probe}}},{gemini:{model:'m'},glm:{model:'n'}},true);
  assert.equal(result.every(x=>!x.strict_admitted),true);
  assert.equal(result.every(x=>x.reasons.length===3),true);
  // 即使修改探针的三个布尔字段，仍没有本模型组合的执行拒绝证据，不能自动授予准入。
  const promoted={...probe,path_deny:{supported:true,coverage_complete:true,file_shape_verified:true}};
  assert.equal(strictReadiness({probe:{cli:{agy:promoted,zcode:promoted}}},{gemini:{model:'m'},glm:{model:'n'}},true).some(x=>x.strict_admitted),false);
});

test('真实wrapper进程拒绝审批/启动；修改布尔值不能使候选执行',{timeout:30000},async()=>{
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-qoder-B-guard-test-')));
  try{
    const {runtime,target}=await helper(temp),root=path.join(temp,'project');await fs.mkdir(root);
    const marker=path.join(temp,'unexpected-launch');
    const candidate=path.join(temp,'candidate.cjs');await fs.writeFile(candidate,`require('fs').writeFileSync(${JSON.stringify(marker)},'unexpected');`);
    const file=path.join(temp,'spec.json'),ledger=path.join(temp,'argv.jsonl');
    await fs.writeFile(file,JSON.stringify({...spec,root,candidate,helper:target,ledger,pins:{},strict_readonly_ready:true}));
    for(const args of [start,['approve','--topic',topic],['abandon','--topic',topic]]){
      const code=`import(${JSON.stringify(new URL('./qoder-plan.mjs',import.meta.url).href)}).then(m=>m.wrapper(${JSON.stringify(file)},${JSON.stringify(args)}));`;
      const r=await runtime.run(process.execPath,['-e',code],{cwd:root,timeoutMs:10000});
      assert.equal(r.code,args[0]==='review'?69:64);assert.equal(r.timedOut,false);
    }
    assert.equal(await fs.stat(marker).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),false);
    const rows=(await fs.readFile(ledger,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.exit_code),[69,64,64]);assert.equal(rows.every(r=>r.cwd===root),true);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
