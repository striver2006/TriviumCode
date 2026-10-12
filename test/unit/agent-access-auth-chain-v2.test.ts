/** 有界链实际读取独立来源并核完整hash；不代表CLI能力或判据采用。 */
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {scratchDir} from '../helpers/scratch.js';
import {Ajv2020} from 'ajv/dist/2020.js';
const url=pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r21/auth-timestamp-chain-v2.mjs')).href;
const originalUrl=pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r17/auth-timestamp-applicability.mjs')).href,hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function sample(n:number){
 const m=await import(originalUrl),dir=await scratchDir('trivium-auth-chain-v2-'),states:Record<string,any>[]=[];
 for(let i=0;i<=n;i++)states.push({preflight:{auth_cache_ttl_h:1},credential_value:'private-original-test-only',probe:{auth_routes:Object.fromEntries(m.AUTH_ROUTE_KEYS.map((k:string,j:number)=>[k,{checked_at:new Date(Date.UTC(2026,9,11,0,i,j)).toISOString(),ok:true,cli_version:'recorded/1',fingerprint:'unchanged',combination:{model:'recorded-model',effort:null}}]))}});
 const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)),hops=[];
 for(let i=0;i<n;i++){const a=states[i]!,b=states[i+1]!,observation={before_sha256:hash(encode(a)),current_sha256:hash(encode(b)),changes:m.AUTH_ROUTE_KEYS.map((k:string)=>({path:['probe','auth_routes',k,'checked_at'],permitted:true,old_value:a.probe.auth_routes[k].checked_at,new_value:b.probe.auth_routes[k].checked_at}))},file=path.join(dir,'hop-'+i+'.json');await fs.writeFile(file,JSON.stringify(observation),{flag:'wx',mode:0o600});hops.push({ref:{path:file,sha256:hash(await fs.readFile(file))},observation});}
 const c:Record<string,any>={currentBytes:encode(states.at(-1)),expectedOldHash:hash(encode(states[0])),expectedCurrentHash:hash(encode(states.at(-1))),hops,components:m.COMPONENT_KINDS.map((kind:string)=>({kind,name:kind,expected:'same',observed:'same'})),sourceRefs:[hops[0]?.ref??{path:'empty',sha256:'a'.repeat(64)}],consumptionRefs:[{path:'test-consumer',sha256:'b'.repeat(64)}],latestLeak:false,latestActualInterceptionFailure:false};return {c,dir,states,encode};
}
for(const n of [1,3,32])test(n+'hop实读/逐字节反向重建及端到端原值比较',async()=>{const m=await import(url),s=await sample(n);try{const before=hash(s.c.currentBytes),r=m.reconstructAuthTimestampChain(s.c);assert.equal(hash(r.oldBytes),s.c.expectedOldHash);assert.equal(r.hops.length,n);r.oldBytes.fill(0);assert.equal(hash(s.c.currentBytes),before);const d=m.evaluateAuthTimestampChain(s.c);assert.equal(d.applicable_diagnostic,true,JSON.stringify(d.reasons));assert.equal(d.schema,'auth-timestamp-chain.v2');assert.equal(d.criteria_approval_ref,null);assert.equal(d.changes_canonical_original_status,false);assert.equal(JSON.stringify(d).includes('private-original-test-only'),false);}finally{await fs.rm(s.dir,{recursive:true,force:true});}});
type Sample=Awaited<ReturnType<typeof sample>>;
const mutations:Record<string,(s:Sample)=>void>={
 '0hop':s=>{s.c.hops=[];},'33hop':s=>{s.c.hops=Array.from({length:33},()=>s.c.hops[0]);},'错顺序':s=>{s.c.hops.reverse();},'重复来源':s=>{s.c.hops[1]=s.c.hops[0];},'错来源hash':s=>{s.c.hops[0].ref.sha256='a'.repeat(64);},'错caller观察':s=>{s.c.hops[0].observation.before_sha256='b'.repeat(64);},'错原点hash':s=>{s.c.expectedOldHash='c'.repeat(64);},'错当前hash':s=>{s.c.expectedCurrentHash='c'.repeat(64);},'缺消费引用':s=>{s.c.consumptionRefs=[];},'未知最新安全':s=>{s.c.latestLeak=null;},'组件变化':s=>{s.c.components[0].observed='changed';},
};
for(const[label,mutate]of Object.entries(mutations))test(label+'拒绝而不输出私有原值',async()=>{const m=await import(url),s=await sample(3);try{mutate(s);const r=m.evaluateAuthTimestampChain(s.c);assert.equal(r.applicable_diagnostic,false,label);assert.equal(r.criteria_approval_ref,null);assert.equal(JSON.stringify(r).includes('private-original-test-only'),false);}finally{await fs.rm(s.dir,{recursive:true,force:true});}});
for(const kind of ['missing','damaged','symlink','conflicting-permission','rollback','unknown-key','missing-change','cycle'] as const)test('实际来源'+kind+'拒绝',async()=>{const m=await import(url),s=await sample(3);try{const hop=s.c.hops[1],file=hop.ref.path;if(kind==='missing')await fs.unlink(file);else if(kind==='symlink'){await fs.rename(file,file+'.original');await fs.symlink(file+'.original',file);}else if(kind==='damaged'){await fs.writeFile(file,'{');hop.ref.sha256=hash(await fs.readFile(file));}else{if(kind==='conflicting-permission')hop.observation.changes[0].auth_checked_at_only=false;if(kind==='rollback')hop.observation.changes[0].new_value=hop.observation.changes[0].old_value;if(kind==='unknown-key')hop.observation.changes[0].path[2]='unapproved';if(kind==='missing-change')hop.observation.changes.pop();if(kind==='cycle')hop.observation.current_sha256=s.c.expectedOldHash;await fs.writeFile(file,JSON.stringify(hop.observation));hop.ref.sha256=hash(await fs.readFile(file));}assert.equal(m.evaluateAuthTimestampChain(s.c).applicable_diagnostic,false,kind);}finally{await fs.rm(s.dir,{recursive:true,force:true});}});
test('旧auth_checked_at_only字段只能无冲突映射，原件不回写',async()=>{const m=await import(url),s=await sample(1);try{const hop=s.c.hops[0];for(const change of hop.observation.changes){change.auth_checked_at_only=true;delete change.permitted;}await fs.writeFile(hop.ref.path,JSON.stringify(hop.observation));hop.ref.sha256=hash(await fs.readFile(hop.ref.path));const before=hop.ref.sha256;hop.observation=m.loadAuthObservation(hop.ref);assert.equal(m.evaluateAuthTimestampChain(s.c).applicable_diagnostic,true);assert.equal(hash(await fs.readFile(hop.ref.path)),before);}finally{await fs.rm(s.dir,{recursive:true,force:true});}});
test('未知caller内部错误抛出，不能当普通not-applicable吞掉',async()=>{const m=await import(url),s=await sample(1);try{Object.defineProperty(s.c.hops[0],'observation',{get(){throw Error('unexpected-test-error');}});assert.throws(()=>m.evaluateAuthTimestampChain(s.c),/unexpected-test-error/);}finally{await fs.rm(s.dir,{recursive:true,force:true});}});

for(const key of ['credential','model','TTL','ok','CLI','profile','invalid-time','extra-change','duplicate-change','missing-source'])test('完整原值链拒绝'+key+'变化',async()=>{
 const m=await import(url),s=await sample(1);try{
  const current=s.states[1]!,hop=s.c.hops[0],route=Object.keys(current.probe.auth_routes)[0]!;
  if(key==='credential')current.credential_value='private-changed-test-only';
  if(key==='model')current.probe.auth_routes[route].combination.model='other';
  if(key==='TTL')current.preflight.auth_cache_ttl_h=2;
  if(key==='ok')current.probe.auth_routes[route].ok=false;
  if(key==='CLI')current.probe.auth_routes[route].cli_version='other';
  if(key==='profile')current.extra_profile='other';
  if(key==='invalid-time')hop.observation.changes[0].new_value='invalid';
  if(key==='extra-change'||key==='duplicate-change')hop.observation.changes.push(structuredClone(hop.observation.changes[0]));
  if(key==='missing-source')s.c.sourceRefs=[];
  s.c.currentBytes=s.encode(current);s.c.expectedCurrentHash=hash(s.c.currentBytes);hop.observation.current_sha256=s.c.expectedCurrentHash;
  await fs.writeFile(hop.ref.path,JSON.stringify(hop.observation));hop.ref.sha256=hash(await fs.readFile(hop.ref.path));
  const r=m.evaluateAuthTimestampChain(s.c);assert.equal(r.applicable_diagnostic,false,key);assert.equal(JSON.stringify(r).includes('private-changed-test-only'),false);
 }finally{await fs.rm(s.dir,{recursive:true,force:true});}
});
test('新chain Schema只接受1..32完整链，空拒绝记录不能充当有效链',async()=>{
 const m=await import(url),schema=JSON.parse(await fs.readFile(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r21/auth-timestamp-chain.v2.schema.json'),'utf8')),validate=new Ajv2020({strict:true}).compile(schema);
 for(const n of [1,3,32]){const s=await sample(n);try{const d=m.evaluateAuthTimestampChain(s.c);assert.equal(validate(d),true,JSON.stringify(validate.errors));const invalid=structuredClone(d);invalid.hops=[];assert.equal(validate(invalid),false);invalid.hops=Array.from({length:33},()=>d.hops[0]);assert.equal(validate(invalid),false);assert.equal(validate({...d,schema:'auth-timestamp-applicability.v1'}),false);}finally{await fs.rm(s.dir,{recursive:true,force:true});}}
});
