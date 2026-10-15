// 独立Node父进程。通过--require加载门禁，实际启动仅允许具名本地替身。
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {spawn as esmSpawn} from 'node:child_process';
const s=JSON.parse(fs.readFileSync(process.env.M11_LOCAL_SPEC,'utf8'));
const action=process.argv[2],root=s.root;
async function launch(bin,args,options={}){
 try{
  const fn=action==='esm'?esmSpawn:cp.spawn;
  const child=fn(bin,args,{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:['pipe','pipe','pipe'],...options});
  let stdout='',stderr='',error=null;child.stdout?.on('data',b=>stdout+=b);child.stderr?.on('data',b=>stderr+=b);child.on('error',e=>{error=e.code;});child.stdin?.on('error',()=>{});child.stdin?.end('local-input');
  const [code,signal]=await new Promise(r=>child.once('close',(...v)=>r(v)));return {code,signal,error,stdout,stderr};
 }catch(e){return {denied:true,reason:e.message,code:null};}
}
const native=[path.join(import.meta.dirname,'mock-native.cjs'),'ok'];let result;
if(action==='twice')result=[await launch(process.execPath,native),await launch(process.execPath,native)];
else if(action==='missing')result=[await launch(root+'/missing-local-executable',[]),await launch(process.execPath,native)];
else if(action==='wrapper')result=await launch(process.execPath,[path.join(import.meta.dirname,'mock-wrapper.cjs')]);
else if(action==='unknown')result=await launch(process.execPath,['-e','process.exit(99)']);
else if(action==='cwd')result=await launch(process.execPath,native,{cwd:import.meta.dirname});
else if(action==='api'){result=[];for(const api of ['exec','execSync','execFile','execFileSync','spawnSync','fork'])try{cp[api](process.execPath,[]);result.push({api,denied:false});}catch(e){result.push({api,denied:true,reason:e.message});}}
else if(action==='exit7')result=await launch(process.execPath,[path.join(import.meta.dirname,'mock-native.cjs'),'exit7']);
else if(action==='signal')result=await launch(process.execPath,[path.join(import.meta.dirname,'mock-native.cjs'),'signal']);
else result=await launch(process.execPath,native);
console.log(JSON.stringify({cli_version:'m11-local-parent/0.0.0',action,result}));
