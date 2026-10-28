/** 不调用任何厂商；验证B装置的拒绝边界，不能当作真实命令B通过。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {helper} from './driver-identity.mjs';
import {allowed,strictReadiness,topic} from './qoder-plan.mjs';
import {nativeTools,linkRows} from './qoder-plan-audit.mjs';

const spec={topic,run_ids:['known-run']};
const start=['review','--start','--stage','plan','--topic',topic,'--driver','qoder-cn','--critics','gemini,glm','--entry','B'];
test('离线工具关联必须使用同ID结果，模型口头总结和其它ID不能代替',()=>{
  const make=(id,resultId)=>nativeTools([
    {message:{content:[{type:'tool_use',id,name:'Bash',input:{command:'.trivium/bin/trivium topic claim'}}]}},
    {message:{content:[{type:'tool_result',tool_use_id:resultId,content:'{"ok":true}'}]}},
  ].map(JSON.stringify).join('\n'));
  const rows=[{argv:['topic','claim'],stdout:'{"ok":true}',exit_code:0}];
  assert.equal(linkRows(rows,make('a','a'))[0].matched,true);
  assert.equal(linkRows(rows,make('a','b'))[0].matched,false);
  assert.equal(linkRows(rows,nativeTools(JSON.stringify({type:'assistant',text:'{"ok":true}'})))[0].matched,false);
});
test('B传输策略保持指定主题、阶段、身份、审核集合与入口',()=>{
  assert.equal(allowed(start,spec),true);
  for(const [from,to] of [['plan','code'],[topic,'other'],['qoder-cn','codex'],['gemini,glm','gemini'],['B','A']])assert.equal(allowed(start.map(x=>x===from?to:x),spec),false);
  for(const tail of [['--allow-single'],['--only','glm'],['--driver','codex'],['--critics','glm'],['--worker','run'],['--cancel','run'],['--skip-auth-check'],['--refresh-auth']])assert.equal(allowed([...start,...tail],spec),false);
});

test('完整预检成功记录才允许真实子进程启动；失败或过期继续拒绝',{timeout:30000},async()=>{
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-qoder-B-receipt-test-')));
  try{
    const {runtime,target}=await helper(temp),root=path.join(temp,'project');await fs.mkdir(path.join(root,'.trivium'),{recursive:true});
    const local=path.join(root,'.trivium/config.local.yaml');await fs.writeFile(local,'{}');
    const candidate=path.join(temp,'synthetic-candidate.cjs');
    await fs.writeFile(candidate,`const fs=require('fs');if(process.argv[2]==='preflight'){fs.writeFileSync(${JSON.stringify(local)},'{"probe":{"auth_routes":{}}}');console.log(JSON.stringify({ok:true,checks:[{name:'synthetic',ok:true}]}));}else console.log(JSON.stringify({run_id:'synthetic-run'}));`);
    const file=path.join(temp,'spec.json');
    const base={...spec,run_ids:[],root,candidate,helper:target,ledger:path.join(temp,'argv.jsonl'),pins:{},reviewer_home:temp,assets:temp};
    await fs.writeFile(file,JSON.stringify(base));
    const call=args=>runtime.run(process.execPath,['-e',`import(${JSON.stringify(new URL('./qoder-plan.mjs',import.meta.url).href)}).then(m=>m.wrapper(${JSON.stringify(file)},${JSON.stringify(args)}));`],{cwd:root,timeoutMs:10000});
    assert.equal((await call(['preflight','--stage','plan','--driver','qoder-cn','--critics','gemini,glm','--json'])).code,0);
    const ready=JSON.parse(await fs.readFile(file));assert.equal(ready.preflight_receipt.ok,true);assert.match(ready.pins[local],/^[a-f0-9]{64}$/);
    assert.equal((await call(start)).code,0);assert.deepEqual(JSON.parse(await fs.readFile(file)).run_ids,['synthetic-run']);
    ready.preflight_receipt.at='2000-01-01T00:00:00Z';await fs.writeFile(file,JSON.stringify(ready));assert.equal((await call(start)).code,69);
    ready.preflight_receipt={ok:false,exit_code:69,at:new Date().toISOString()};await fs.writeFile(file,JSON.stringify(ready));assert.equal((await call(start)).code,69);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
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
test('按既有机制核两家前置，不把路径deny和Qoder专属台账移作硬门',()=>{
  const probe={probed_at:'2026-10-28',entrypoint:'/cli',headless_read_ok:true,path_deny:{supported:false,coverage_complete:null,file_shape_verified:null},readonly_flags:['--disallowed-tools Write,Bash']};
  const result=strictReadiness({probe:{cli:{agy:probe,zcode:probe}}},{gemini:{model:'m'},glm:{model:'n'}},true);
  assert.equal(result.every(x=>x.strict_admitted===null&&x.production_mechanism_ready),true);
  assert.equal(result.every(x=>!x.native_path_denial_verified&&!x.model_specific_admission_required),true);
  assert.equal(strictReadiness({probe:{cli:{agy:probe,zcode:{...probe,readonly_flags:[]}}}},{gemini:{model:'m'},glm:{model:'n'}},true)[1].production_mechanism_ready,false);
  assert.equal(strictReadiness({probe:{cli:{agy:probe,zcode:probe}}},{gemini:{model:'m'},glm:{model:'n'}},false)[0].production_mechanism_ready,false);
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
