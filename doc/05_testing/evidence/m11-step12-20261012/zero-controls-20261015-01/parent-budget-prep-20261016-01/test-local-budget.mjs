/** 真起多个Node进程；所有子程序限于本包替身，台账限于local-lab。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {hash,read,budget,saveEvidence} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname,root=here+'/local-lab';
fs.mkdirSync(root,{mode:0o700}); // 非recursive，重复执行拒绝，不覆盖实验。
const before=budget(),results=[];
const hashNode=hash(process.execPath);
function make(name,{admission=1,review=0,total=admission+review,pool='admission',badHash=false}={}){
 const dir=root+'/'+name;fs.mkdirSync(dir,{mode:0o700});
 for(const d of ['ledger/admission','ledger/review','events','markers'])fs.mkdirSync(dir+'/'+d,{recursive:true,mode:0o700});
 fs.writeFileSync(dir+'/LAB_ONLY','NO_VENDOR_EXECUTION\n',{flag:'wx',mode:0o600});
 saveEvidence(dir+'/approval.json',{lab_only:true,initial_limits:{admission,review},note:'仅替身实验；不是真实厂商授权'});
 const routes=[['native','mock-native.cjs','ok'],['failure-output','mock-native.cjs','exit7'],['signal','mock-native.cjs','signal'],['wrapper','mock-wrapper.cjs']].map(([name,script,arg])=>({name,command:process.execPath,args:[here+'/'+script,...arg?[arg]:[]],script_sha256:hash(here+'/'+script)}));
 routes.push({name:'missing-local-executable',command:dir+'/missing-local-executable',args:[],missing:true});
 saveEvidence(dir+'/spec.json',{kind:'local-mock-only',root:dir,pool,total_cap:total,node_sha256:badHash?'0'.repeat(64):hashNode,routes});return dir;
}
async function run(dir,action){
 const argv=['--require',here+'/lab-parent-preload.cjs',here+'/mock-parent.mjs',action];
 const p=spawn(process.execPath,argv,{cwd:dir,env:{M11_LOCAL_SPEC:dir+'/spec.json',PATH:'/usr/bin:/bin',TZ:'Asia/Singapore'},stdio:['ignore','pipe','pipe'],signal:AbortSignal.timeout(15000)});
 let stdout='',stderr='',error=null;p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',e=>{error=e.code??e.message;});
 const [code,signal]=await new Promise(r=>p.once('close',(...v)=>r(v)));
 assert.equal(code,0,stderr);const parsed=JSON.parse(stdout);assert.equal(parsed.cli_version,'m11-local-parent/0.0.0');
 return {command:[process.execPath,...argv],cwd:dir,pid:p.pid,exit_code:code,signal,error,stdout,stderr,result:parsed.result};
}
function inspect(dir){
 const files=d=>fs.readdirSync(dir+'/'+d).sort().map(n=>({file:dir+'/'+d+'/'+n,sha256:hash(dir+'/'+d+'/'+n),record:read(dir+'/'+d+'/'+n)}));
 const ledger=[...files('ledger/admission'),...files('ledger/review')],markers=files('markers'),events=files('events');
 for(const m of markers)assert.equal(m.record.cli_version,'m11-local-only/0.0.0');
 return {ledger,markers,events,reserved:ledger.filter(x=>path.basename(x.file).startsWith('reserved-')).length};
}
async function scenario(name,options,action,check){const dir=make(name,options);const runs=await Promise.all(Array.from({length:action==='concurrent'?8:1},()=>run(dir,action==='concurrent'?'once':action)));const evidence=inspect(dir);check(runs,evidence);results.push({name,runs,...evidence,passed:true});}
await scenario('zero', {admission:0},'once',(r,e)=>{assert(r[0].result.denied);assert.equal(e.reserved,0);assert.equal(e.markers.length,0);});
await scenario('one-then-deny',{},'twice',(r,e)=>{assert.equal(r[0].result[0].code,0);assert(r[0].result[1].denied);assert.equal(e.reserved,1);assert.equal(e.markers.length,1);});
await scenario('concurrent-eight',{admission:3},'concurrent',(r,e)=>{assert.equal(r.filter(x=>x.result.code===0).length,3);assert.equal(r.filter(x=>x.result.denied).length,5);assert.equal(e.reserved,3);assert.equal(e.markers.length,3);});
await scenario('enoent-not-refunded',{},'missing',(r,e)=>{assert.equal(r[0].result[0].error,'ENOENT');assert(r[0].result[1].denied);assert.equal(e.reserved,1);assert.equal(e.markers.length,0);assert(e.ledger.some(x=>x.record.spawned===false));});
await scenario('no-pool-borrow',{admission:2,review:0,total:2,pool:'review'},'once',(r,e)=>{assert.equal(r[0].result.reason,'LOCAL_GATE:pool-cap');assert.equal(e.reserved,0);});
await scenario('total-cap',{admission:2,total:1},'twice',(r,e)=>{assert(r[0].result[1].denied);assert.equal(e.reserved,1);});
await scenario('unknown-route',{},'unknown',(r,e)=>{assert.equal(r[0].result.reason,'LOCAL_GATE:unknown-route');assert.equal(e.reserved,0);});
await scenario('wrong-cwd',{},'cwd',(r,e)=>{assert.equal(r[0].result.reason,'LOCAL_GATE:wrong-cwd');assert.equal(e.reserved,0);});
await scenario('other-apis',{},'api',(r,e)=>{assert.equal(r[0].result.length,6);assert(r[0].result.every(x=>x.denied));assert.equal(e.reserved,0);});
await scenario('two-boundaries',{admission:2},'wrapper',(r,e)=>{assert.equal(r[0].result.code,0);assert.equal(e.reserved,2);assert.equal(e.markers.length,1);assert(e.ledger.some(x=>x.record.parent_ticket==='admission:1'));});
await scenario('native-denied-at-second-boundary',{},'wrapper',(r,e)=>{assert.equal(r[0].result.code,75);assert.equal(e.reserved,1);assert.equal(e.markers.length,0);});
await scenario('esm-and-child-env-scrub',{},'esm',(r,e)=>{assert.equal(r[0].result.code,0);assert.equal(e.reserved,1);assert.equal(e.markers.length,1);});
await scenario('fingerprint-refusal',{badHash:true},'once',(r,e)=>{assert.equal(r[0].result.reason,'LOCAL_GATE:node-fingerprint');assert.equal(e.reserved,0);});
await scenario('exit-stderr-preserved',{},'exit7',(r,e)=>{assert.equal(r[0].result.code,7);assert.equal(r[0].result.stderr,'LOCAL_EXPECTED_ERROR\n');assert(e.ledger.some(x=>x.record.code===7));});
await scenario('signal-preserved',{},'signal',(r,e)=>{assert.equal(r[0].result.code,null);assert.equal(r[0].result.signal,'SIGTERM');assert(e.ledger.some(x=>x.record.signal==='SIGTERM'));});
assert.deepEqual(budget(),before);
saveEvidence(here+'/local-budget-results.json',{at:new Date().toISOString(),command:[process.execPath,import.meta.filename],results,total:results.length,passed:results.length,
 budget_before:before,budget_after:budget(),real_vendor_launches:0,actual_extension_host_tested:false,actual_extension_host_preload_verified:null,verified_real_start_upper_bound:null,
 scope:'真正多进程的本地替身实验；不是VS Code/Electron或真实厂商父级覆盖验收'});
console.log(JSON.stringify({tests:results.length,passed:results.length,budget:budget(),extension_host_tested:false}));
