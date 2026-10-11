/** 获批r4诊断的危险边界：构建字节与有限历史引用不能变成当前准入。零CLI。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleUrl=pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r4/agent-access-applicability.mjs')).href;
const declaration=(dirty: boolean)=>`define_TRIVIUM_BUILD_default = { repo_root_commit: "${'1'.repeat(40)}", git_head: "${'2'.repeat(40)}", dirty: ${dirty}, inputs_sha256: "${'3'.repeat(64)}", built_at: "2026-10-11T00:00:00.000Z" };`;
test('只允许唯一精确构建戳；业务注释/空白变化仍拒绝等价',async()=>{
  const {compareCompiledBytes}=await import(moduleUrl);
  const original=Buffer.from(declaration(true)+'\nconst business=1;\n');
  const next=Buffer.from(declaration(false)+'\nconst business=1;\n');
  assert.equal(compareCompiledBytes(original,next).compiled_bytes_equal,true);
  assert.equal(compareCompiledBytes(original,Buffer.from(next.toString()+'// extra\n')).compiled_bytes_equal,false);
  assert.equal(compareCompiledBytes(original,Buffer.from(next.toString().replace('business=1','business =1'))).compiled_bytes_equal,false);
  assert.throws(()=>compareCompiledBytes(original,Buffer.from(next.toString()+declaration(true))),/唯一/);
  assert.throws(()=>compareCompiledBytes(original,Buffer.from(next.toString().replace('dirty: false','dirty: unknown'))),/唯一/);
});
test('具名旧机制引用不改变新未测；缺来源/配对/模型/配置均不可用',async()=>{
  const {diagnoseHistoricalPair}=await import(moduleUrl);
  const pair={key:'fixture',old_variant:1,current_variant:2,invariantDifferences:[],
    fingerprintDifferences:[{field:'assets.skills/dual-critic/scripts/trivium.cjs',old:'old',current:'new'}],
    old_completed:true,current_completed:true,old_readback:{model:'m'},current_readback:{model:'m'}};
  const checks={source_files_verified:true,compiled_bytes_equal:true,old_actual_mechanism_proven:true};
  const result=diagnoseHistoricalPair(pair,checks);
  assert.equal(result.diagnostic_status,'historical-mechanism-only');
  assert.equal(result.current_admission_accepted,false);assert.equal(result.approval_record,null);
  for(const patch of [{source_files_verified:false},{compiled_bytes_equal:false},{old_actual_mechanism_proven:false}]){
    const r=diagnoseHistoricalPair(pair,{...checks,...patch});assert.equal(r.diagnostic_status,'not-applicable');assert.equal(r.current_admission_accepted,false);
  }
  for(const patch of [{current_readback:{model:null}},{invariantDifferences:['config']},{current_completed:false},{fingerprintDifferences:[]}]){
    assert.equal(diagnoseHistoricalPair({...pair,...patch},checks).diagnostic_status,'not-applicable');
  }
  // 普通审批或调用者自称批准不能偷偷打开此纯诊断的采用层。
  assert.equal(diagnoseHistoricalPair({...pair,approval_record:{approved:true}},checks).current_admission_accepted,false);
});
