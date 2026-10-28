import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {REPO_ROOT} from '../helpers/fixture.js';
import {parseQoderTrace,qoderTraceEvidence} from '../../src/trivium/adapters/qoder-cn-trace.js';
const init={type:'system',subtype:'init',cwd:'/fixture',model:'Exact',tools:['Read','Grep','Glob']};
const call=(id:string,name:string,input:object)=>({type:'assistant',message:{content:[{type:'tool_use',id,name,input}]}});
const result=(id:string,is_error:boolean,content:string)=>({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,is_error,content}]}});
const terminal={type:'result',subtype:'success',is_error:false,result:'OK'};
const json=(items:unknown[])=>items.map(x=>JSON.stringify(x)).join('\n');
test('实际调用结果按ID配对，成功读路径与搜索命中分开，拒绝操作不记成功读取',()=>{
  const trace=parseQoderTrace(json([init,call('read','Read',{file_path:'a.ts'}),result('read',false,'content'),call('grep','Grep',{path:'.',output_mode:'content'}),result('grep',false,'b.ts:3:text'),call('deny','Read',{file_path:'secret'}),{type:'system',subtype:'permission_denied',tool_use_id:'deny',decision_reason_type:'rule'},result('deny',true,'denied'),terminal]));
  assert.deepEqual(trace.errors,[]);assert.equal(trace.completed,true);assert.equal(trace.calls[2]!.channel,'permission-rule');
  const evidence=qoderTraceEvidence(trace,'/unused');assert.deepEqual(evidence.read_paths,['/fixture/a.ts']);assert.deepEqual(evidence.search_hit_paths,['/fixture/b.ts']);assert.equal(evidence.tool_calls.read,2);
});
test('规则/mode/工具分发拒绝独立，生产对白名单外尝试仍报告写事件',()=>{
  const trace=parseQoderTrace(json([init,call('mode','Write',{file_path:'/fixture/a'}),{type:'system',subtype:'permission_denied',tool_use_id:'mode',decision_reason_type:'mode'},result('mode',true,'needs approval'),call('missing','Bash',{command:'echo test'}),result('missing',true,'Error: Tool "Bash" not found.'),terminal]));
  assert.equal(trace.calls[0]!.channel,'permission-mode');assert.equal(trace.calls[1]!.channel,'tool-unavailable');
  const evidence=qoderTraceEvidence(trace,'/fixture');assert.equal(evidence.write_events.length,2);assert.deepEqual(evidence.command_texts,['echo test']);
});
test('重复/悬空/缺结果/终态后调用或结果/坏JSON均不能构成完整轨迹',()=>{
  for(const items of [[init,call('a','Read',{}),terminal],[init,result('a',false,'x'),terminal],[init,call('a','Read',{}),call('a','Read',{}),result('a',false,'x'),terminal],[init,terminal,call('a','Read',{}),result('a',false,'x')],[init,call('a','Read',{}),terminal,result('a',false,'x')],[init,terminal,terminal]])assert.ok(parseQoderTrace(json(items)).errors.length);
  assert.ok(parseQoderTrace('{bad').errors.length);
});
test('原生1.1.80原件回放：最小工具三种真实成功调用与独立诊断rule拒绝可解析',async()=>{
  const dir=path.join(REPO_ROOT,'doc/05_testing/evidence/qoder-cn-admission-20261028');
  const minimal=JSON.parse(await fs.readFile(path.join(dir,'readonly-2026-10-28T06-20-59-945Z-c0545e.json'),'utf8')).cases.find((c:{arm:string})=>c.arm==='matrix-readonly');
  const trace=parseQoderTrace(minimal.stdout);assert.deepEqual(trace.errors,[]);assert.equal(trace.completed,true);assert.deepEqual([...trace.init!.tools].sort(),['Glob','Grep','Read']);
  for(const name of ['Read','Grep','Glob'])assert.ok(trace.calls.some(c=>c.name===name&&c.result&&!c.result.is_error));
  const scoped=JSON.parse(await fs.readFile(path.join(dir,'readonly-2026-10-28T05-55-07-328Z-55c44a.json'),'utf8')).cases.find((c:{arm:string})=>c.arm==='deny-visible');
  const denied=parseQoderTrace(scoped.stdout);assert.deepEqual(denied.errors,[]);for(const name of ['Write','Bash'])assert.ok(denied.calls.some(c=>c.name===name&&c.channel==='permission-rule'));
  // 不把不同配方的历史拒绝推成当前最小面准入。
  assert.equal(trace.calls.some(c=>c.channel==='permission-rule'),false);
});

test('09:24双路线原件：Write真实分发拒绝，Edit/Bash无调用不能转换为拒绝',async()=>{
  const file=path.join(REPO_ROOT,'doc/05_testing/evidence/qoder-cn-admission-20261028/execution-2026-10-28T09-24-01-724Z-562d47.json');
  const doc=JSON.parse(await fs.readFile(file,'utf8')) as {routes:{route:string;cases:{tool:string;positive:{stdout:string};candidate:{stdout:string}}[]}[]};
  assert.equal(doc.routes.length,2);
  for(const route of doc.routes){
    const write=route.cases.find(c=>c.tool==='Write')!;
    const positive=parseQoderTrace(write.positive.stdout),candidate=parseQoderTrace(write.candidate.stdout);
    assert.deepEqual(positive.errors,[]);assert.deepEqual(candidate.errors,[]);
    assert.ok(positive.calls.some(c=>c.name==='Write'&&c.result&&!c.result.is_error));
    assert.deepEqual([...candidate.init!.tools].sort(),['Glob','Grep','Read']);
    const denied=candidate.calls.filter(c=>c.name==='Write');assert.equal(denied.length,1);assert.equal(denied[0]!.channel,'tool-unavailable');
    assert.equal(candidate.decisions.length,0); // 分发错误不能伪装成权限规则拒绝。
    for(const tool of ['Edit','Bash']){
      const arm=route.cases.find(c=>c.tool===tool)!;
      const trace=parseQoderTrace(arm.candidate.stdout);assert.deepEqual(trace.errors,[]);
      assert.equal(trace.calls.some(c=>c.name===tool),false);assert.equal(trace.calls.some(c=>c.channel!==null),false);
    }
  }
});
