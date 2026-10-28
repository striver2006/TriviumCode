/** 零厂商调用；真实bundle、Git HEAD与多个独立Node CLI进程。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createFixture,inspectFixture,stages,sha,repo,nativeChecks} from './driver-identity.mjs';
import {assess} from './driver-identity-index.mjs';

test('入口证据必须配同ID成功结果；目录发现或被拒Read不能升格为加载',()=>{
  const entries=[{installed:'/private/skill/SKILL.md'}],f={spec:{agent:'candidate'}};
  const call={type:'assistant',message:{content:[{type:'tool_use',id:'c1',name:'Read',input:{file_path:entries[0].installed}}]}};
  const result={type:'user',message:{content:[{type:'tool_result',tool_use_id:'c1',content:'--driver candidate'}]}};
  const run=events=>nativeChecks({stdout:events.map(JSON.stringify).join('\n')},entries,f,1);
  assert.equal(run([call]).entries_loaded,false);
  assert.equal(run([call,result]).entries_loaded,true);
  assert.equal(run([call,{...result,message:{content:[{...result.message.content[0],is_error:true}]}}]).entries_loaded,false);
  assert.equal(run([call,{...result,message:{content:[{...result.message.content[0],tool_use_id:'other'}]}}]).entries_loaded,false);
  const kimi=[{role:'assistant',tool_calls:[{id:'k1',type:'function',function:{name:'Read',arguments:JSON.stringify({path:entries[0].installed})}}]},{role:'tool',tool_call_id:'k1',content:'--driver candidate'}];
  assert.equal(run(kimi).entries_loaded,true);
});

test('离线重判保留首批失败与最终成功：不以collector布尔代替单项或抹除错误',async()=>{
  const dir=path.join(repo,'doc/05_testing/evidence/driver-identity-20261028');
  const first=JSON.parse(await fs.readFile(path.join(dir,'qoder-cn-real-1793195599403-3d29d8.json'),'utf8'));
  assert.equal(assess(first).identity_items_passed,false,'入口实际被拒，不能靠身份通过升级');
  const final=JSON.parse(await fs.readFile(path.join(dir,'qoder-cn-real-1793195912680-2d1e36.json'),'utf8'));
  const checked=assess(final);assert.equal(checked.identity_items_passed,true);
  assert.equal(checked.collector_passed,false,'保留原件总标志');assert.equal(checked.clean_first_attempts,false);
  assert.equal(checked.blocked_wrapper_attempts.length,1);
  assert.equal(checked.native.every(x=>x.all_wrapper_results_linked),true,'原生同ID结果必须关联到底层账本');
  const kimi=assess(JSON.parse(await fs.readFile(path.join(dir,'kimi-real-1793196160184-33e015.json'),'utf8')));
  assert.equal(kimi.identity_items_passed,true);assert.equal(kimi.native.every(x=>x.all_wrapper_results_linked),true);
});

for(const agent of ['kimi','qoder-cn'])test(`${agent}：三阶段跨进程序列化、继承、幂等及异身份拒绝`,{timeout:60000},async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'trivium-driver-identity-test-'));
  try{
    const f=await createFixture(temp,agent);
    assert.match(f.spec.head,/^[0-9a-f]{40}$/);
    assert.equal((await f.run('git',['-c','core.quotePath=false','cat-file','-t',f.spec.head])).stdout.trim(),'commit');
    const taskFile=path.join(f.root,'.reviews',f.topic,'task.json');
    const claim=stage=>['topic','claim','--topic',f.topic,'--stage',stage,'--driver',agent,'--session-id','first','--json'];
    for(const stage of stages){
      const prod=await f.run(process.execPath,[path.join(repo,'skills/dual-critic/scripts/trivium.cjs'),...claim(stage)]);
      assert.equal(prod.code,64,'生产候选必须关闭');
      assert.equal((await f.run(f.wrapper,claim(stage))).code,0);
      assert.equal((await f.run(f.wrapper,['fixture-draft',stage])).code,0);
    }
    const before=sha(await fs.readFile(taskFile));
    for(const stage of stages){
      const r=await f.run(f.wrapper,['topic','resolve','--stage',stage,'--json','--','检查夹具','--topic',f.topic]);
      assert.equal(r.code,0,r.stderr);const j=JSON.parse(r.stdout);assert.equal(j.driver,agent);
      if(stage==='code')assert.equal(j.diff_available,true,'真实HEAD上的代码差异可用');
      else assert.match(j.subject_path,new RegExp(`-${agent}\\.md$`));
      // 两个并发独立进程争同阶段认领，只能各自noop，不能刷新声明或丢其它阶段。
      const noops=await Promise.all(['second','third'].map(id=>f.run(f.wrapper,claim(stage).map(x=>x==='first'?id:x))));
      for(const n of noops){assert.equal(n.code,0,n.stderr);assert.equal(JSON.parse(n.stdout).outcome,'noop');}
      assert.equal(sha(await fs.readFile(taskFile)),before,'幂等不得写盘');
      const wrong=await f.run(f.wrapper,claim(stage).map(x=>x===agent?'codex':x));
      assert.equal(wrong.code,64);assert.match(wrong.stderr,/已被使用/);
      const wrongResolve=await f.run(f.wrapper,['topic','resolve','--stage',stage,'--json','--','检查夹具','--topic',f.topic,'--driver','codex']);
      assert.equal(wrongResolve.code,64);assert.equal(sha(await fs.readFile(taskFile)),before,'拒绝不得翻转声明');
    }
    const result=await inspectFixture(f);assert.equal(result.passed,true,JSON.stringify(result.per_stage));
    assert.equal(result.task.drivers.plan.claimed_by,'first');
    assert.equal(f.spec.review_allowed,false);
    assert.equal(sha(await fs.readFile(path.join(repo,'src/trivium/agents/registry.ts'))),f.spec.registry_source_sha256);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
