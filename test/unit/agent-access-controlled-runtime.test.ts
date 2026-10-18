/** 真实本地HTTP和临时文件验证获批取证helper；不启动供应商，不证明模型能力。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {scratchDir} from '../helpers/scratch.js';

// WIN_FILE_SKIP（Windows 移植）：断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物');
} else {

async function helpers(){return import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r19/controlled-runtime.mjs')).href);}
const limits={requests:4,per_request_bytes:128,total_body_bytes:512,runtime_ms:2000};
async function request(port:number,body='{}',endpoint='/v1/messages'){
 return fetch('http://127.0.0.1:'+port+endpoint,{method:'POST',body,signal:AbortSignal.timeout(1000)});
}
test('真实HTTP成功：同helper精确计请求/字节，关闭后无在途handler',async()=>{
 const {createControlledTransport}=await helpers();const seen:string[]=[];
 const server=createControlledTransport(({endpoint,res}:any)=>{seen.push(endpoint);res.end('{}');},{limits});
 const address=await server.start();try{const response=await request(address.port,'{"a":1}');assert.equal(response.status,200);await response.text();}finally{await server.close();}
 assert.deepEqual(seen,['/v1/messages']);assert.equal(server.facts.requests,1);assert.equal(server.facts.bodyBytes,7);assert.equal(server.facts.max_request_bytes,7);assert.equal(server.facts.host,'127.0.0.1');assert.equal(server.facts.handlers_finished,true);assert.equal(server.facts.within_limits,true);assert.deepEqual(server.errors,[]);
});
for(const [name,override,bodies]of [
 ['请求数',{requests:1},['{}','{}']],
 ['逐请求字节',{per_request_bytes:4},['{"x":1}']],
 ['累计字节',{total_body_bytes:3},['{}','{}']],
] as const)test('真实HTTP'+name+'超限记录失败',async()=>{
 const {createControlledTransport}=await helpers();const server=createControlledTransport(({res}:any)=>res.end('{}'),{limits:{...limits,...override}}),address=await server.start();
 try{for(const body of bodies){const response=await request(address.port,body);await response.text();}}finally{await server.close();}
 assert.equal(server.facts.within_limits,false);assert.ok(server.errors.some((e:Error)=>/limit/.test(e.message)));assert.equal(server.facts.handlers_finished,true);
 if(name==='逐请求字节')assert.ok(server.facts.max_request_bytes>override.per_request_bytes);
});
for(const [name,body,endpoint]of [
 ['坏JSON','{','/v1/messages'],['非法协议根','[]','/v1/messages'],['非法端点','{}','/outside'],
] as const)test('真实HTTP'+name+'保留异常而非成功',async()=>{
 const {createControlledTransport}=await helpers();let handled=false;const server=createControlledTransport(({res}:any)=>{handled=true;res.end('{}');},{limits}),address=await server.start();
 try{const response=await request(address.port,body,endpoint);assert.equal(response.status,500);await response.text();}finally{await server.close();}
 assert.equal(handled,false);assert.equal(server.facts.within_limits,false);assert.equal(server.errors.length,1);
});
test('关闭中等待实际handler：迟到内部错误进入最终失败事实',async()=>{
 const {createControlledTransport}=await helpers();let entered!:()=>void;const ready=new Promise<void>(r=>entered=r);
 const server=createControlledTransport(async()=>{entered();await new Promise(r=>setTimeout(r,25));throw Error('late-internal-error');},{limits}),address=await server.start();
 const client=request(address.port).then(r=>r.text()).catch(()=>undefined);await ready;await server.close();await client;
 assert.equal(server.facts.handlers_finished,true);assert.equal(server.facts.within_limits,false);assert.ok(server.errors.some((e:Error)=>e.message==='late-internal-error'));
});
test('运行时上限真实计时触发；无请求也不得伪装通过',async()=>{
 const {createControlledTransport}=await helpers();const server=createControlledTransport(()=>{}, {limits:{...limits,runtime_ms:15}});await server.start();await new Promise(r=>setTimeout(r,30));await server.close();
 assert.equal(server.facts.within_limits,false);assert.ok(server.errors.some((e:Error)=>e.message==='runtime-limit'));
});
test('未启动资源是null；重复关闭拒绝而不是幂等伪装成功',async()=>{
 const {createControlledTransport}=await helpers();const server=createControlledTransport(()=>{}, {limits});assert.equal(await server.close(),null);assert.equal(server.facts.within_limits,null);await assert.rejects(server.close(),/repeated/);
});
test('清理全部尝试，主成果保留，主失败和两个清理失败均可审计',async()=>{
 const {cleanupAll,failureRecord}=await helpers();const calls:string[]=[],main=Error('main-internal-error');
 const result=await cleanupAll({server:async()=>{calls.push('server');throw Error('server-close-error');},home:async()=>{calls.push('home');return false;},fixture:async()=>{calls.push('fixture');return true;},uncreated:async()=>null},main);
 assert.deepEqual(calls,['server','home','fixture']);assert.deepEqual(result.cleanup,{server:false,home:false,fixture:true,uncreated:null});assert.equal(result.failure.errors.length,3);assert.equal(result.failure.errors[0],main);assert.equal(failureRecord(result.failure).errors[0].message,'main-internal-error');
});
test('临时模式settings仅单键/0600/固定hash，变异权限、键、类型均拒绝，删除有证据',async t=>{
 const {createModeSettings,inspectModeSettings,pathAbsent}=await helpers();const home=await scratchDir('trivium-mode25-test-');t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const reference=createModeSettings(home,{permissionMode:'default'});assert.equal(inspectModeSettings(reference).valid,true);assert.equal((await fs.stat(reference.path)).mode&0o777,0o600);
 await fs.chmod(reference.path,0o640);assert.equal(inspectModeSettings(reference).valid,false);await fs.chmod(reference.path,0o600);
 await fs.writeFile(reference.path,JSON.stringify({permissions:{defaultMode:'default',allow:['Write']}}));assert.equal(inspectModeSettings(reference).valid,false);
 await fs.rm(reference.path);await fs.writeFile(home+'/other','{}');await fs.symlink(home+'/other',reference.path);assert.equal(inspectModeSettings(reference).valid,false);
 await fs.rm(reference.path);assert.equal(pathAbsent(reference.path),true);assert.equal(inspectModeSettings(reference).valid,false);assert.throws(()=>createModeSettings(home,{permissionMode:'auto'}),/source-not-default/);
});

}
