/** 台账引擎契约使用合成证据验证器；这些测试不构成任何native准入。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AGENTS} from '../../src/trivium/agents/registry.js';
import {admissionHash,admissionRouteBinding,requireAdmission,storeAdmission,type AdmissionRequest} from '../../src/trivium/admission.js';
import {validateAdmission} from '../../src/trivium/schemas.js';
import {scratchDir} from '../helpers/scratch.js';
import type {AdmissionRecord} from '../../src/trivium/types.js';
const agent=AGENTS.find(a=>a.admissionChecks?.length)!;

test('准入台账纯形状+身份追加校验，拒绝未知身份',()=>{
  assert.ok(validateAdmission({schema:'wrong',records:[{agent:'unregistered-fixture'}]}).length>=2);
});
test('项目级台账冻结/hash/TTL/必需项/证据边界均拒绝失配，完整契约可读回',async()=>{
  const root=await fs.realpath(await scratchDir('trivium-admission-'));
  try{
    await fs.mkdir(path.join(root,'.trivium'));
    const raw=JSON.stringify({synthetic_engine_fixture:true}),file=path.join(root,'proof.json');await fs.writeFile(file,raw);
    const sha256=createHash('sha256').update(raw).digest('hex');
    const req:AdmissionRequest={critic:agent.id,project_root:root,model:'fixture-model'};
    const record:AdmissionRecord={record_id:'fixture-first',deny_paths:['proof.json'],agent:agent.id,project_root:root,binding_sha256:admissionRouteBinding(req),tested_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),
      checks:Object.fromEntries(agent.admissionChecks!.map(check=>[check,{state:'pass' as const,evidence:[{path:'proof.json',sha256,case_id:check}]}]))};
    const verify=(_check:string,items:readonly {data:unknown}[])=>items.every(x=>(x.data as {synthetic_engine_fixture?:unknown}).synthetic_engine_fixture===true)?[]:['synthetic fixture mismatch'];
    assert.throws(()=>requireAdmission(req,1,verify),/缺失/);
    await storeAdmission(root,record);const frozen=requireAdmission(req,1,verify).reference;
    assert.equal(frozen.record_sha256,admissionHash(record));
    requireAdmission({...req,deny_paths:['proof.json']},1,verify);assert.throws(()=>requireAdmission({...req,deny_paths:['proof.json','new-secret']},1,verify),/超出准入已验覆盖/);
    assert.equal(admissionHash({'中文':1,z:2,a:3}),admissionHash({a:3,'中文':1,z:2}));
    if(process.platform!=='win32'){
      const link=path.join(root,'moving'),target1=path.join(root,'one'),target2=path.join(root,'two');await fs.writeFile(target1,'one');await fs.writeFile(target2,'two');await fs.symlink(target1,link);
      await storeAdmission(root,{...record,deny_paths:['moving',target1]});requireAdmission({...req,deny_paths:['moving']},1,verify);
      await fs.rm(link);await fs.symlink(target2,link);assert.throws(()=>requireAdmission({...req,deny_paths:['moving']},1,verify),/超出准入已验覆盖/);await fs.rm(link);await storeAdmission(root,record);
    }
    assert.throws(()=>requireAdmission({...req,model:'other'},1,verify),/无唯一/);
    await storeAdmission(root,{...record,record_id:'fixture-replaced'});
    assert.throws(()=>requireAdmission(req,1,verify,frozen),/变化/);
    await storeAdmission(root,{...record,expires_at:new Date(Date.now()-1).toISOString()});assert.throws(()=>requireAdmission(req,1,verify),/过期/);
    const missing=structuredClone(record);delete missing.checks[agent.admissionChecks![0]!];await storeAdmission(root,missing);assert.throws(()=>requireAdmission(req,1,verify),/必需项/);
    await storeAdmission(root,record);await fs.writeFile(file,'changed');assert.throws(()=>requireAdmission(req,1,verify),/hash变化/);
    await fs.writeFile(file,raw);
    const escape=structuredClone(record);escape.checks[agent.admissionChecks![0]!]!.evidence[0]!.path='../proof.json';await storeAdmission(root,escape);assert.throws(()=>requireAdmission(req,1,verify),/路径不安全/);
    await storeAdmission(root,record);await fs.rm(file);await fs.symlink(path.join(root,'.trivium/admission.local.json'),file);assert.throws(()=>requireAdmission(req,1,verify),/路径不安全/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
