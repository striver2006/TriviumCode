/** 原值、具名时间戳及全指纹诊断守卫；模拟件不证明CLI能力。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {Ajv2020} from 'ajv/dist/2020.js';
const root=path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r17');
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function module(){return import(pathToFileURL(root+'/auth-timestamp-applicability.mjs').href);}
async function sample(){
 const {AUTH_ROUTE_KEYS,COMPONENT_KINDS}=await module();
 const old:Record<string,any>={preflight:{auth_cache_ttl_h:1},credential_value:'original-private-value',probe:{auth_routes:Object.fromEntries(AUTH_ROUTE_KEYS.map((k:string)=>[k,{checked_at:'2026-10-11T15:25:00.000Z',ok:true,cli_version:'recorded/1',fingerprint:'original-config',combination:{model:'recorded-model',effort:null,vendorProfile:'original'}}]))}};
 const current=structuredClone(old);for(const key of AUTH_ROUTE_KEYS)current.probe.auth_routes[key].checked_at='2026-10-11T17:03:00.000Z';
 const sourceRefs=[{path:'historical-source.json',sha256:'a'.repeat(64)}],consumptionRefs=[{path:'production-consumer.ts',sha256:'b'.repeat(64)}];
 const context={oldBytes:Buffer.from(JSON.stringify(old)),currentBytes:Buffer.from(JSON.stringify(current)),expectedOldHash:'',expectedCurrentHash:'',components:COMPONENT_KINDS.map((kind:string)=>({kind,name:kind,expected:'same',observed:'same'})),sourceRefs,consumptionRefs,latestLeak:false,latestActualInterceptionFailure:false};
 context.expectedOldHash=hash(context.oldBytes);context.expectedCurrentHash=hash(context.currentBytes);
 return{old,current,context,key:AUTH_ROUTE_KEYS[0]};
}
function encode(s:Awaited<ReturnType<typeof sample>>){s.context.oldBytes=Buffer.from(JSON.stringify(s.old));s.context.currentBytes=Buffer.from(JSON.stringify(s.current));s.context.expectedOldHash=hash(s.context.oldBytes);s.context.expectedCurrentHash=hash(s.context.currentBytes);}
test('三具名时间戳纯诊断通过，原值参与比较但不改变canonical或产生批准',async()=>{
 const s=await sample(),{evaluateAuthTimestamp}=await module(),r=evaluateAuthTimestamp(s.context);
 assert.equal(r.applicable_diagnostic,true,JSON.stringify(r.reasons));assert.equal(r.raw_value_comparison,true);assert.equal(r.changes.length,3);assert.equal(r.criteria_approval_ref,null);assert.equal(r.changes_canonical_original_status,false);
 assert.equal(JSON.stringify(r).includes('original-private-value'),false);
});
const mutations:Record<string,(s:Awaited<ReturnType<typeof sample>>)=>void>={
 'ok为false':s=>{s.current.probe.auth_routes[s.key].ok=false;},
 '缺旧ok':s=>{delete s.old.probe.auth_routes[s.key].ok;},
 '指纹变化':s=>{s.current.probe.auth_routes[s.key].fingerprint='changed';},
 '版本变化':s=>{s.current.probe.auth_routes[s.key].cli_version='changed';},
 '模型变化':s=>{s.current.probe.auth_routes[s.key].combination.model='changed';},
 'effort变化':s=>{s.current.probe.auth_routes[s.key].combination.effort='new';},
 'TTL变化':s=>{s.current.preflight.auth_cache_ttl_h=2;},
 '凭据原值变化':s=>{s.current.credential_value='another-private-value';},
 '非具名route追加':s=>{s.current.probe.auth_routes['unapproved']={checked_at:'2026-10-11T17:00:00.000Z'};},
 '旧probe.auth追加':s=>{s.current.probe.auth={side:{checked_at:'2026-10-11T17:00:00.000Z'}};},
 '无关配置节点追加':s=>{s.current.new_value=true;},
 '时间倒退':s=>{s.current.probe.auth_routes[s.key].checked_at='2026-10-11T14:00:00.000Z';},
 '时间相等':s=>{s.current.probe.auth_routes[s.key].checked_at=s.old.probe.auth_routes[s.key].checked_at;},
 '时间损坏':s=>{s.current.probe.auth_routes[s.key].checked_at='invalid';},
 '目录事实变化':s=>{s.current.probe.directory_fact={hash:'changed'};},
 'CLI组件漂移':s=>{s.context.components.find((x:any)=>x.kind==='native-entry').observed='changed';},
 '缺工具事实消费链':s=>{s.context.consumptionRefs=[];},
 '缺原件':s=>{s.context.sourceRefs=[];},
 '缺组件种类':s=>{s.context.components=s.context.components.filter((x:any)=>x.kind!=='modules');},
 '泄漏事实':s=>{s.context.latestLeak=true;},
 '实际拦截失败':s=>{s.context.latestActualInterceptionFailure=true;},
};
for(const[name,mutate]of Object.entries(mutations))test('适用性独立变异拒绝：'+name,async()=>{
 const s=await sample(),{evaluateAuthTimestamp}=await module();mutate(s);encode(s);const r=evaluateAuthTimestamp(s.context);
 assert.equal(r.applicable_diagnostic,false,name);assert.ok(r.reasons.length);assert.equal(JSON.stringify(r).includes('another-private-value'),false);
});
test('缺旧原hash、字节hash错及损坏/重复YAML均拒绝',async()=>{
 const {evaluateAuthTimestamp}=await module();for(const type of ['missing-origin','old-hash','current-hash','damaged','duplicate']){
  const s=await sample();if(type==='missing-origin')s.context.expectedOldHash='';if(type==='old-hash')s.context.expectedOldHash='c'.repeat(64);if(type==='current-hash')s.context.expectedCurrentHash='c'.repeat(64);
  if(type==='damaged'||type==='duplicate'){s.context.currentBytes=Buffer.from(type==='damaged'?'probe: [':'probe: {}\nprobe: {}\n');s.context.expectedCurrentHash=hash(s.context.currentBytes);}
  assert.equal(evaluateAuthTimestamp(s.context).applicable_diagnostic,false,type);
 }
});
test('认证局部Schema只允许诊断且不能携带采用批准',async()=>{
 const {evaluateAuthTimestamp}=await module(),s=await sample(),r=evaluateAuthTimestamp(s.context),validate=new Ajv2020({strict:true}).compile(JSON.parse(await readFile(root+'/auth-timestamp-applicability.v1.schema.json','utf8')));
 assert.equal(validate(r),true,JSON.stringify(validate.errors));assert.equal(validate({...r,changes_canonical_original_status:true}),false);assert.equal(validate({...r,criteria_approval_ref:{approved:true}}),false);
});

async function chainModule(){return import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r19/auth-timestamp-chain.mjs')).href);}
async function chainSample(){
 const s=await sample(),{AUTH_ROUTE_KEYS}=await module(),old=structuredClone(s.old),middle=structuredClone(s.old),current=structuredClone(s.old);
 for(const[key,i]of AUTH_ROUTE_KEYS.map((k:string,i:number)=>[k,i] as const)){
  old.probe.auth_routes[key].checked_at=`2026-10-11T15:25:0${i}.000Z`;middle.probe.auth_routes[key].checked_at=`2026-10-11T17:03:0${i}.000Z`;current.probe.auth_routes[key].checked_at=`2026-10-11T18:40:0${i}.000Z`;
 }
 const bytes=(o:any)=>Buffer.from(JSON.stringify(o)),observation=(a:any,b:any)=>({before_sha256:hash(bytes(a)),current_sha256:hash(bytes(b)),changes:AUTH_ROUTE_KEYS.map((k:string)=>({path:['probe','auth_routes',k,'checked_at'],permitted:true,old_value:a.probe.auth_routes[k].checked_at,new_value:b.probe.auth_routes[k].checked_at}))});
 const context:Record<string,any>={...s.context,currentBytes:bytes(current),expectedOldHash:hash(bytes(old)),expectedCurrentHash:hash(bytes(current)),hops:[{ref:{path:'hop24.json',sha256:'a'.repeat(64)},observation:observation(old,middle)},{ref:{path:'hop25.json',sha256:'b'.repeat(64)},observation:observation(middle,current)}]};
 return {context,old,middle,current};
}
test('双跳逐字节反向重建与端到端原值比较，清空私有Buffer不影响原current',async()=>{
 const {evaluateAuthTimestampChain,reconstructAuthTimestampChain}=await chainModule(),s=await chainSample(),before=hash(s.context.currentBytes),rebuilt=reconstructAuthTimestampChain(s.context);
 assert.equal(hash(rebuilt.oldBytes),s.context.expectedOldHash);assert.equal(rebuilt.hops.length,2);rebuilt.oldBytes.fill(0);assert.equal(hash(s.context.currentBytes),before);
 const result=evaluateAuthTimestampChain(s.context);assert.equal(result.applicable_diagnostic,true,JSON.stringify(result.reasons));assert.equal(result.hops.length,2);assert.equal(result.raw_value_comparison,true);assert.equal(result.chain_reconstruction_verified,true);assert.equal(result.criteria_approval_ref,null);assert.equal(result.changes_canonical_original_status,false);assert.equal(JSON.stringify(result).includes('original-private-value'),false);
});
const chainMutations:Record<string,(c:Record<string,any>)=>void>={
 '缺hop':c=>c.hops.pop(),
 '多hop':c=>c.hops.push(structuredClone(c.hops[1])),
 '错链顺序':c=>c.hops.reverse(),
 '缺hop原件':c=>delete c.hops[0].ref,
 '错原件hash形状':c=>c.hops[0].ref.sha256='bad',
 '错中间hash':c=>c.hops[0].observation.current_sha256='c'.repeat(64),
 '错最终原hash':c=>c.expectedOldHash='c'.repeat(64),
 '错当前原hash':c=>c.expectedCurrentHash='c'.repeat(64),
 '缺变化记录':c=>c.hops[1].observation.changes.pop(),
 '重复变化路径':c=>c.hops[1].observation.changes[1]=structuredClone(c.hops[1].observation.changes[0]),
 '未知route键':c=>c.hops[1].observation.changes[0].path[2]='unknown',
 '非时间节点':c=>c.hops[1].observation.changes[0].path[3]='fingerprint',
 '未允许变化':c=>c.hops[1].observation.changes[0].permitted=false,
 '时间倒退':c=>c.hops[1].observation.changes[0].old_value='2026-10-11T20:00:00.000Z',
 '时间损坏':c=>c.hops[1].observation.changes[0].new_value='invalid',
 '唯一替换值缺失':c=>c.hops[1].observation.changes[0].new_value='2026-10-11T18:41:00.000Z',
 '声明与重建字节错位':c=>c.hops[1].observation.changes[0].old_value='2026-10-11T17:02:00.000Z',
 '组件原值错':c=>c.components[0].observed='changed',
 '最新安全未知':c=>c.latestLeak=null,
};
for(const[name,mutate]of Object.entries(chainMutations))test('双跳独立拒绝：'+name,async()=>{
 const {evaluateAuthTimestampChain}=await chainModule(),s=await chainSample();mutate(s.context);const result=evaluateAuthTimestampChain(s.context);assert.equal(result.applicable_diagnostic,false,name);assert.equal(result.chain_reconstruction_verified,false);assert.equal(result.criteria_approval_ref,null);
});
test('同hash链可重建仍核原值：非时间戳变动不能经回填记录掩盖',async()=>{
 const {evaluateAuthTimestampChain}=await chainModule();for(const[field,value]of [['credential_value','changed-private-value'],['auth_cache_ttl_h',2]] as const){
  const s=await chainSample();if(field==='credential_value')s.current.credential_value=value;else s.current.preflight[field]=value;
  s.context.currentBytes=Buffer.from(JSON.stringify(s.current));s.context.expectedCurrentHash=hash(s.context.currentBytes);s.context.hops[1].observation.current_sha256=s.context.expectedCurrentHash;
  // 宣称一个匹配重建字节的中间hash也不能绕过逐跳原值审计。
  const forged=structuredClone(s.middle);if(field==='credential_value')forged.credential_value=value;else forged.preflight[field]=value;
  s.context.hops[1].observation.before_sha256=hash(Buffer.from(JSON.stringify(forged)));s.context.hops[0].observation.current_sha256=s.context.hops[1].observation.before_sha256;
  assert.equal(evaluateAuthTimestampChain(s.context).applicable_diagnostic,false,field);
 }
});
test('双跳专门Schema核完整两跳；缺/错中间形状不接受为成功诊断',async()=>{
 const {evaluateAuthTimestampChain}=await chainModule(),s=await chainSample(),result=evaluateAuthTimestampChain(s.context),schema=JSON.parse(await readFile(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r19/auth-timestamp-chain.v1.schema.json'),'utf8')),validate=new Ajv2020({strict:true}).compile(schema);
 assert.equal(validate(result),true,JSON.stringify(validate.errors));
 const incomplete=structuredClone(result);incomplete.hops.pop();assert.equal(validate(incomplete),false);
 const damaged=structuredClone(result);damaged.hops[0].old_complete_config_sha256='bad';assert.equal(validate(damaged),false);
 assert.equal(validate({...result,chain_reconstruction_verified:false}),false);assert.equal(validate({...result,reconstructed_old_is_original_sample:true}),false);
});
