import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { inspectTrace, classifyDenial, managedExpected } from './kimi-evidence.mjs';

const root=new URL('../../../doc/05_testing/evidence/kimi-macos-20261028/',import.meta.url);
const bytes=await fs.readFile(new URL('kimi-extra-1793123673700-a7f1fc.json',root));
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'231ce44d575d0c4d1a0f94ac463b66965e36d179e5ad7e65bbaa3f29902b2c2a');
const raw=JSON.parse(bytes.toString());
const sample=raw.arms.find(x=>x.name==='trimmed-Write');
const expected=[{id:'write-one',name:'Write',args:sample.trace.observations[0].args}];
const parse=stdout=>inspectTrace(stdout,{expected,code:0});
const lines=sample.stdout.trim().split('\n');
const events=lines.map(JSON.parse);
const asText=e=>e.map(x=>JSON.stringify(x)).join('\n')+'\n';

test('真实原件的裁剪工具同 ID 结果可识别，始终不登记准入',()=>{
  const t=parse(sample.stdout);assert.equal(t.complete,true);assert.equal(t.admission,false);
  assert.equal(classifyDenial(t),'机制拒绝待对照');
});
test('口头拒绝、文件未变、退出 0 与未调用不成立',()=>{
  const t=parse(asText(events.filter(x=>x.role!=='tool'&&!x.tool_calls)));
  assert.equal(t.complete,false);assert.notEqual(classifyDenial(t),'机制拒绝待对照');
});
for(const [name,mutate] of [
  ['结果错 ID',e=>{e.find(x=>x.role==='tool').tool_call_id='other';}],
  ['工具名错位',e=>{e.find(x=>x.tool_calls).tool_calls[0].function.name='Read';}],
  ['目标错位',e=>{e.find(x=>x.tool_calls).tool_calls[0].function.arguments='{"path":"/wrong"}';}],
  ['重复结果',e=>{e.splice(3,0,structuredClone(e.find(x=>x.role==='tool')));}],
  ['重复调用',e=>{e.splice(2,0,structuredClone(e.find(x=>x.tool_calls)));}],
  ['结果晚于终态',e=>{const i=e.findIndex(x=>x.role==='tool');const [x]=e.splice(i,1);e.push(x);}],
  ['缺少终态',e=>{const i=e.findIndex(x=>x.role==='assistant'&&!x.tool_calls);e.splice(i,1);}],
  ['缺少 resume 元事件',e=>{e.splice(e.findIndex(x=>x.type==='session.resume_hint'),1);}],
])test(name+'拒绝合格判定',()=>{
  const e=structuredClone(events);mutate(e);const t=parse(asText(e));assert.equal(t.complete,false);
  assert.notEqual(classifyDenial(t),'机制拒绝待对照');
});
test('含糊 denied/not available 不是已录制执行层拒绝',()=>{
  const e=structuredClone(events);e.find(x=>x.role==='tool').content='The model said denied; file does not exist';
  assert.equal(classifyDenial(parse(asText(e))),'未证实拒绝');
});
test('非零、超时、截断、强杀不能伪称完整拒绝',()=>{
  for(const x of [{code:1},{timedOut:true},{truncated:true},{signal:'SIGKILL'}]){
    const t=inspectTrace(sample.stdout,{expected,code:0,...x});assert.equal(t.complete,false);assert.notEqual(classifyDenial(t),'机制拒绝待对照');
  }
});
test('坏 JSON 与额外调用被发现',()=>{
  assert.equal(parse(sample.stdout+'broken\n').complete,false);
  const e=structuredClone(events);const x=structuredClone(e.find(x=>x.tool_calls));x.tool_calls[0].id='extra';e.splice(2,0,x);
  assert.equal(parse(asText(e)).complete,false);
});
test('Glob 名字与 Grep 路径泄漏只从工具结果判定',()=>{
  const args={pattern:'peer/*.md',path:'/fixture'};
  for(const [name,content] of [['Glob','peer/history.md'],['Grep','peer/history.md:1:CANARY']]){
    const e=[{role:'assistant',content:'peer/history.md',tool_calls:[{id:'g',function:{name,arguments:JSON.stringify(args)}}]},
      {role:'tool',tool_call_id:'g',content},{role:'assistant',content:'PROBE_DONE'},{role:'meta',type:'session.resume_hint'}];
    const spec={id:'g',name,args,paths:['peer/history.md']};
    assert.equal(classifyDenial(inspectTrace(asText(e),{expected:[spec],code:0})),'失败');
    e[1].content='No matches found';assert.equal(inspectTrace(asText(e),{expected:[spec],code:0}).observations[0].path_listed,false);
  }
});

test('Grep basename 与多层目录匹配，不把相邻文件算目标',()=>{
  const args={pattern:'.',path:'/fixture'};
  const render=content=>asText([{role:'assistant',tool_calls:[{id:'g',function:{name:'Grep',arguments:JSON.stringify(args)}}]},
    {role:'tool',tool_call_id:'g',content},{role:'assistant',content:'PROBE_DONE'},{role:'meta',type:'session.resume_hint'}]);
  for(const content of ['peer/history.md:1:text','a/b/中文 空格.md:12:text']){
    const p=content.includes('history')?'history.md':'中文 空格.md';
    assert.equal(inspectTrace(render(content),{expected:[{id:'g',name:'Grep',args,paths:[p]}],code:0}).observations[0].path_listed,true);
  }
  assert.equal(inspectTrace(render('peer/history.md.bak:1:text'),{expected:[{id:'g',name:'Grep',args,paths:['history.md']}],code:0}).observations[0].path_listed,false);
});

test('规则拒绝文案仅为源码候选测试，不能冒充 native 生效正例',()=>{
  // 官方 2.3.3 user-configured-rule.ts 的 defaultPermissionRuleDenyMessage；本批 native 无此正例。
  const e=structuredClone(events);e.find(x=>x.role==='tool').content='Tool "Write" was denied by permission rule.';
  assert.equal(parse(asText(e)).observations[0].rule_denied,true);
  e.find(x=>x.role==='tool').content='Tool "Read" was denied by permission rule.';
  assert.equal(parse(asText(e)).observations[0].rule_denied,false);
});

test('真实敏感错误正例与错误目标边界',()=>{
  const arm=raw.arms.find(x=>x.name==='none');
  const obs=arm.trace.observations.find(x=>x.id==='read-secret');
  const calls=arm.stdout.trim().split('\n').map(JSON.parse).flatMap(x=>x.tool_calls??[]);
  const spec={id:obs.id,name:obs.name,args:obs.args};
  const call=calls.find(x=>x.id===obs.id);
  const ev=[{role:'assistant',tool_calls:[call]},{role:'tool',tool_call_id:obs.id,content:obs.result},{role:'assistant',content:'PROBE_DONE'},{role:'meta',type:'session.resume_hint'}];
  assert.equal(inspectTrace(asText(ev),{expected:[spec],code:0}).observations[0].sensitive_blocked,true);
  spec.args={path:obs.args.path+'.bak'};
  assert.equal(inspectTrace(asText(ev),{expected:[spec],code:0}).complete,false);
});

test('别名路径不冒充 realpath 精确目标证据',()=>{
  const e=structuredClone(events);const call=e.find(x=>x.tool_calls).tool_calls[0];call.function.name='Read';call.function.arguments='{"path":"/fixture/link/file"}';
  const t=inspectTrace(asText(e),{expected:[{id:call.id,name:'Read',args:{path:'/outside/file'}}],code:0});
  assert.equal(t.complete,false);assert.equal(t.observations[0].exact,false);
});

test('真实模型坏 JSON 不抛异常；后续轨迹判 bad-arguments',()=>{
  const actual=[{id:'bad',function:{name:'Write',arguments:'{"broken'}}];
  assert.deepEqual(managedExpected(expected,actual),expected);
  const e=structuredClone(events);e.find(x=>x.tool_calls).tool_calls=actual;
  assert.ok(parse(asText(e)).errors.includes('bad-arguments'));
});
