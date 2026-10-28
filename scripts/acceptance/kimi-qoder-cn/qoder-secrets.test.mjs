import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectCredentialValues,secretGuard} from './qoder-secrets.mjs';
import {compareSnapshots,rejectionChannel,checkAbsence} from './qoder-evidence.mjs';

test('未知格式凭据与JSON字符串逐值抹除，命中后退出失败且首因粘滞',()=>{
  const values=[];collectCredentialValues('{"access_token":"test_key_unknown_fixture"}',values);
  const guard=secretGuard(values);
  assert.equal(guard.scrub('output test_key_unknown_fixture'),'output [REDACTED]');
  assert.equal(guard.exitCode(),1);assert.equal(guard.scrub('clean'),'clean');assert.equal(guard.leaked,true);
  assert.ok(guard.matchIndices.length>0);assert.equal(JSON.stringify(guard.matchIndices).includes('test_key'),false);
});
test('后追加秘密及JSON转义同样受保护，无命中不改变原始退出状态',()=>{
  const values=[],guard=secretGuard(values);assert.equal(guard.exitCode(75),75);
  values.push('test_key_"line\nfixture');
  assert.equal(guard.scrub(JSON.stringify({value:values[0]})).includes('test_key_'),false);
  assert.equal(guard.exitCode(),1);
});
test('短元数据不做秘密替换，嵌套敏感键仍保护，非字符串跳过并记录边界',()=>{
  const values=[],boundary=collectCredentialValues('{"type":"cn","region":"sg","auth":{"refresh_token":"test_key_nested_fixture"},"count":1,"enabled":true}',values);
  const guard=secretGuard(values);assert.equal(guard.scrub('cn sg type'),'cn sg type');assert.equal(guard.leaked,false);
  assert.equal(boundary.skipped_metadata,2);assert.equal(guard.scrub('test_key_nested_fixture'),'[REDACTED]');assert.equal(guard.leaked,true);
});
test('单个源文件失联不打断其它不变量留痕，空基线保持unknown',async()=>{
  const r=await compareSnapshots(new Map([['missing','old'],['ok','same']]),async p=>{if(p==='missing')throw Object.assign(new Error('hidden'),{code:'ENOENT'});return 'same';},x=>x);
  assert.equal(r.unchanged,null);assert.equal(r.files[0].error_code,'ENOENT');assert.equal(r.files[1].unchanged,true);
  assert.equal((await compareSnapshots(new Map(),async()=>'',x=>x)).unchanged,null);
});
test('分开权限/工具不可用/执行错误/未知错误通道，不按任意失败文本判权限拒绝',()=>{
  assert.equal(rejectionChannel({tool_use_id:'id',is_error:true,content:'Error: Tool "Write" not found.'}),'tool-unavailable');
  const result={tool_use_id:'id',is_error:true,content:'rule'},meta=[{id:'id',non_execution_kind:'permission-rule'}];
  assert.equal(rejectionChannel(result,meta,[{tool_use_id:'id',decision_reason_type:'rule'}]),'permission-rule');
  assert.equal(rejectionChannel(result,meta,[{tool_use_id:'id',decision_reason_type:'mode'}]),'permission-mode');
  assert.equal(rejectionChannel(result,meta),'unknown');
  assert.equal(rejectionChannel(result,meta,[{tool_use_id:'other',decision_reason_type:'rule'}]),'unknown');
  assert.equal(rejectionChannel(result,meta,[{tool_use_id:'id',decision_reason_type:'mode'},{tool_use_id:'id',decision_reason_type:'rule'}]),'unknown');
  assert.equal(rejectionChannel({is_error:true,content:'Error: File not found'}),'execution-error');
  assert.equal(rejectionChannel({is_error:true,content:'arbitrary denied prose'}),'unknown');
  assert.equal(rejectionChannel({is_error:false,content:'Error: Tool "Write" not found.'}),null);
});
test('清理回读只有ENOENT记删除，权限错误和空采样保持unknown',async()=>{
  const r=await checkAbsence(['removed','denied'],async p=>{throw Object.assign(new Error('hidden'),{code:p==='removed'?'ENOENT':'EACCES'});});
  assert.equal(r.absent,null);assert.equal(r.files[0].absent,true);assert.equal(r.files[1].absent,null);
  assert.equal((await checkAbsence([],async()=>{})).absent,null);
});
