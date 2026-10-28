/** 不调用任何厂商；验证B装置的拒绝边界，不能当作真实命令B通过。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {helper} from './driver-identity.mjs';
import {allowed,strictReadiness,topic,artifactInput,writeSettings,prepare} from './qoder-plan.mjs';
import {nativeTools,linkRows,permissionPairs} from './qoder-plan-audit.mjs';
import {prepareWrite} from './qoder-write.mjs';
import {nativeObserver,permissionLogs} from './qoder-plan-live.mjs';

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
  assert.equal(linkRows([{...rows[0],argv:['artifact','plan']}],make('a','a'))[0].matched,false);
  assert.equal(linkRows(rows,nativeTools(JSON.stringify({type:'assistant',text:'{"ok":true}'})))[0].matched,false);
});
test('B传输策略保持指定主题、阶段、身份、审核集合与入口',()=>{
  assert.equal(allowed(start,spec),true);
  for(const [from,to] of [['plan','code'],[topic,'other'],['qoder-cn','codex'],['gemini,glm','gemini'],['B','A']])assert.equal(allowed(start.map(x=>x===from?to:x),spec),false);
  for(const tail of [['--allow-single'],['--only','glm'],['--driver','codex'],['--critics','glm'],['--worker','run'],['--cancel','run'],['--skip-auth-check'],['--refresh-auth']])assert.equal(allowed([...start,...tail],spec),false);
  for(const tail of [['--unknown'],['--model-glm','other'],['--max-rounds','4'],['--run-id','foreign']])assert.equal(allowed([...start,...tail],spec),false);
  assert.equal(allowed([...start,'--max-rounds','3'],spec),true);
  assert.equal(allowed(['topic','resolve','--stage','plan','--json','--','检查sum修复计划及测试边界','--topic',topic,'--critics','gemini,glm','--driver','qoder-cn'],spec),true);
  assert.equal(allowed(['preflight','--stage','plan','--driver','qoder-cn','--critics','gemini,glm','--context','sum.cjs','--json'],spec),true);
});

test('流式监督只认同ID成功Write；权限拒绝或传输失败立停，正常wait73继续',()=>{
  const receipts=new Map(),stops=[],o=nativeObserver(receipts,r=>stops.push(r));
  const send=e=>o.line(JSON.stringify(e));
  send({message:{content:[{type:'tool_use',id:'w',name:'Write',input:{file_path:'/draft',content:'native'}}]}});
  send({message:{content:[{type:'tool_result',tool_use_id:'other',content:'ok'}]}});assert.equal(receipts.size,0);
  send({message:{content:[{type:'tool_result',tool_use_id:'w',content:'ok'}]}});assert.equal(receipts.get('w').result.error,false);
  send({message:{content:[{type:'tool_use',id:'wait',name:'Bash',input:{command:'.trivium/bin/trivium review --wait known'}}]}});
  send({message:{content:[{type:'tool_result',tool_use_id:'wait',content:'Exit code 73\n{"still_running": true}',is_error:true}]}});assert.equal(stops.length,0);
  send({subtype:'permission_denied',tool_use_id:'denied'});assert.equal(stops.at(-1).id,'denied');
  const failure=nativeObserver(new Map(),r=>stops.push(r));
  failure.line(JSON.stringify({message:{content:[{type:'tool_use',id:'a',name:'Bash',input:{command:'.trivium/bin/trivium artifact plan 1 drafts/original.md'}},{type:'tool_result',tool_use_id:'a',content:'Exit code 64',is_error:true}]}}));
  assert.equal(stops.at(-1).id,'a');
  const approved=nativeObserver(new Map(),r=>stops.push(r));
  approved.line(JSON.stringify({message:{content:[{type:'tool_use',id:'g',name:'Bash',input:{command:'.trivium/bin/trivium gate --stage plan --topic test --await-approval'}},{type:'tool_result',tool_use_id:'g',content:'等待人工审批'}]}}));
  assert.equal(stops.at(-1).expected,true);assert.equal(stops.at(-1).id,'g');
  for(const action of ['proceed','human_review','rerun']){
    const ended=[],o=nativeObserver(new Map(),r=>ended.push(r));
    o.line(JSON.stringify({message:{content:[{type:'tool_use',id:'check',name:'Bash',input:{command:'.trivium/bin/trivium gate --check --json'}},{type:'tool_result',tool_use_id:'check',content:JSON.stringify({ok:true,next_action:action})}]}}));
    assert.equal(ended.length,action==='rerun'?0:1);
  }
});

test('私有日志清理前提取权限决策和调用ID，认证目录不入证据',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'qoder-permission-log-test-')),config=path.join(home,'.qoder-cn');
  try{
    await fs.mkdir(path.join(config,'.auth'),{recursive:true});
    await fs.writeFile(path.join(config,'.auth','secret.log'),'[permission-check] synthetic-secret');
    await fs.writeFile(path.join(config,'native.log'),'unrelated\n[permission-check] options tool=Write callId=test-call\n[permission-check] main Write → allow point=fs_write.rule.allow\n');
    const logs=await permissionLogs(config,home,['test-call']);assert.equal(logs.length,1);assert.equal(logs[0].lines.length,2);assert.equal(JSON.stringify(logs).includes('synthetic-secret'),false);
    const pairs=permissionPairs([{file:'synthetic.log',lines:['[permission-check] options tool=Write callId=test-call','[permission-check] main Write mode=dontAsk → allow point=fs_write.rule.allow']}]);
    assert.equal(pairs[0].tool_id,'test-call');assert.equal(pairs[0].point,'fs_write.rule.allow');
  }finally{await fs.rm(home,{recursive:true,force:true});}
});

test('新B不代领或预置原稿，drafts预建、七个具名写路径及独立run_root',{timeout:30000},async()=>{
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'qoder-B-preparation-test-'));let p;
  try{
    p=await prepare(output);const s=JSON.parse(await fs.readFile(p.spec_file));
    assert.deepEqual(await fs.readdir(path.join(s.root,'drafts')),[]);assert.equal(s.draft_names.length,7);assert.equal(s.fail_stop,true);
    assert.equal(await fs.stat(path.join(s.root,'.reviews')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),false);
    assert.equal(await fs.readFile(s.ledger,'utf8'),'');assert.equal(await fs.readFile(s.native_receipts,'utf8'),'');assert.equal(s.run_root.startsWith(path.dirname(p.spec_file)),true);
    const settings=writeSettings(s.root,s.draft_names.map(n=>path.join(s.root,'drafts',n)),['.trivium/bin/trivium:*']);
    assert.equal(settings.permissions.allow.filter(x=>x.startsWith('Edit(')).some(x=>x.includes('*')),false);
  }finally{await fs.rm(output,{recursive:true,force:true});if(p)await fs.rm(path.dirname(p.spec_file),{recursive:true,force:true});}
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
  assert.equal(allowed(['artifact','--help'],spec),true);
  assert.equal(allowed(['artifact','plan','2','drafts/p.md'],spec),true);
  assert.equal(allowed(['artifact','revised','1','drafts/r.md'],spec),true);
  for(const args of [['artifact','gemini','1','x'],['artifact','plan','0','x'],['artifact','plan','1'],['artifact','response','1','x']])assert.equal(allowed(args,spec),false);
});

test('私有写入规则只授权指定正文与两条命令，使用Edit和绝对路径语法',()=>{
  const root='/private/var/test/中文 空格项目',draft=root+'/drafts/original.md';
  const settings=writeSettings(root,[draft],['.trivium/bin/trivium artifact plan 1 drafts/original.md']);
  assert.deepEqual(settings.permissions.allow,[`Edit(/${draft})`,`Edit(//var/test/中文 空格项目/drafts/original.md)`,'Bash(.trivium/bin/trivium artifact plan 1 drafts/original.md)']);
  assert.equal(settings.permissions.allow.some(x=>['Write','Bash','*'].includes(x)),false);
  const control={...spec,write_control:true,control_commands:[['artifact','plan','1','drafts/original.md']]};
  assert.equal(allowed(control.control_commands[0],control),true);
  for(const args of [start,['preflight'],['gate'],['artifact','--help'],['artifact','plan','2','drafts/original.md']])assert.equal(allowed(args,control),false);
});

test('正控制备料不写正文、不启动审核；新根和候选pins全部可回读',{timeout:30000},async()=>{
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'trivium-write-preparation-test-'));let prepared;
  try{
    prepared=await prepareWrite(output);const s=JSON.parse(await fs.readFile(prepared.spec_file));
    assert.equal(s.attempted,false);assert.equal(s.write_control,true);assert.deepEqual(s.run_ids,[]);
    for(const p of [s.draft,s.run_root,path.join(s.root,'.reviews')])assert.equal(await fs.stat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}),false);
    for(const [p,h] of Object.entries(s.pins)){const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(await fs.readFile(p)).digest('hex'),h);}
    assert.equal(s.control_commands.length,2);assert.equal(allowed(start,s),false);
  }finally{await fs.rm(output,{recursive:true,force:true});if(prepared)await fs.rm(path.dirname(prepared.spec_file),{recursive:true,force:true});}
});

test('archive真实落盘守正文hash、防覆盖、暂存边界、运行/停点和两种轮次',{timeout:30000},async()=>{
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-qoder-artifact-test-')));
  try{
    const {runtime:api,target}=await helper(temp),root=path.join(temp,'project'),archive=path.join(root,'.reviews',topic);
    await fs.mkdir(path.join(archive,'plan/_meta'),{recursive:true});await fs.mkdir(path.join(root,'drafts'));await fs.mkdir(path.join(root,'.trivium'));
    await fs.writeFile(path.join(archive,'task.json'),JSON.stringify({drivers:{plan:{driver:'qoder-cn'}}}));
    await fs.writeFile(path.join(root,'drafts/original.md'),'# 离线合成正文\n');
    const local={...spec,root,helper:target,run_ids:[],pins:{},ledger:path.join(temp,'ledger.jsonl')};
    const file=path.join(temp,'spec.json');await fs.writeFile(file,JSON.stringify(local));
    const call=args=>api.run(process.execPath,['-e',`import(${JSON.stringify(new URL('./qoder-plan.mjs',import.meta.url).href)}).then(m=>m.wrapper(${JSON.stringify(file)},${JSON.stringify(args)}));`],{cwd:root,timeoutMs:10000});
    const args=['artifact','plan','1','drafts/original.md'];const result=await call(args);assert.equal(result.code,0);
    const output=JSON.parse(result.stdout);assert.equal(await fs.readFile(output.absPath,'utf8'),'# 离线合成正文\n');
    assert.equal((await call(args)).code,64);assert.equal((await fs.readdir(path.join(archive,'plan'))).filter(x=>x.endsWith('.md')).length,1);
    await fs.symlink(path.join(root,'drafts/original.md'),path.join(root,'drafts/link.md'));
    await assert.rejects(artifactInput(local,['artifact','plan','1','drafts/link.md'],api),/普通暂存文件/);
    await fs.writeFile(path.join(root,'outside.md'),'outside');
    await assert.rejects(artifactInput(local,['artifact','plan','1','outside.md'],api),/drafts普通文件/);
    await assert.rejects(artifactInput(local,['artifact','plan','1','drafts/missing.md'],api),/ENOENT/);
    await assert.rejects(artifactInput(local,['artifact','revised','1','drafts/original.md'],api),/已有审查run/);
    local.run_ids=['synthetic'];await fs.writeFile(path.join(archive,'plan/_meta/run-synthetic.json'),JSON.stringify({rerun_index:1,plan_final_check:{subject_rerun_index:2}}));
    local.native_receipts=path.join(temp,'native-writes.jsonl');await fs.writeFile(local.native_receipts,'');
    await assert.rejects(artifactInput(local,['artifact','revised','1','drafts/original.md'],api),/同ID/);
    const {createHash}=await import('node:crypto');const hash=createHash('sha256').update('# 离线合成正文\n').digest('hex');
    await fs.writeFile(local.native_receipts,JSON.stringify({id:'synthetic-write',name:'Write',path:path.join(root,'drafts/original.md'),sha256:hash,result:{error:false}})+'\n');
    assert.equal((await artifactInput(local,['artifact','revised','1','drafts/original.md'],api)).rerunIndex,1);
    assert.equal((await artifactInput(local,['artifact','plan','3','drafts/original.md'],api)).rerunIndex,3);
    await assert.rejects(artifactInput(local,['artifact','revised','2','drafts/original.md'],api),/轮次不符/);
    await assert.rejects(artifactInput(local,['artifact','plan','2','drafts/original.md'],api),/轮次不符/);
    for(const state of ['running','awaiting_approval']){
      await fs.writeFile(path.join(root,'.trivium/state.json'),JSON.stringify({gates:{test:{state}}}));
      await assert.rejects(artifactInput(local,['artifact','revised','1','drafts/original.md'],api),/禁止归档/);
    }
  }finally{await fs.rm(temp,{recursive:true,force:true});}
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
