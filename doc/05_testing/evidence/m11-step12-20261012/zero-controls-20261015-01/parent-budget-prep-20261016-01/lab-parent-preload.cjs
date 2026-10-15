// 仅用于本目录local-lab：绝不允许厂商程序或真实预算根。不是可部署的扩展护栏。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {syncBuiltinESMExports}=require('node:module');
const assert=require('node:assert/strict');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const specPath=process.env.M11_LOCAL_SPEC;
assert(specPath&&path.isAbsolute(specPath),'只接受显式本地替身spec');
const lab=path.join(__dirname,'local-lab');
assert(fs.realpathSync(specPath).startsWith(lab+'/'));
const spec=JSON.parse(fs.readFileSync(specPath,'utf8')),root=fs.realpathSync(spec.root);
assert(root.startsWith(lab+'/')&&spec.kind==='local-mock-only');
assert.equal(fs.readFileSync(root+'/LAB_ONLY','utf8'),'NO_VENDOR_EXECUTION\n');
assert(['admission','review'].includes(spec.pool));
assert(Number.isSafeInteger(spec.total_cap)&&spec.total_cap>=0);
const {openBudget}=require('../../../../../../scripts/agent-access-budget.cjs');
const budget=openBudget(root,spec.pool);
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const event=(kind,fields={})=>write(root+'/events/'+crypto.randomUUID()+'.json',{kind,pid:process.pid,ppid:process.ppid,at:new Date().toISOString(),...fields});
event('loaded',{spec_sha256:hash(specPath),preload_sha256:hash(__filename)});
const rawSpawn=cp.spawn;
function deny(reason){event('denied',{reason});throw Error('LOCAL_GATE:'+reason);}
function reserve(route){
 const lock=root+'/.reserve-lock';let held=false;
 for(let n=0;n<200;n++){try{fs.mkdirSync(lock);held=true;break;}catch(e){if(e.code!=='EEXIST')throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}}
 if(!held)return deny('lock-busy');
 try{
  const count=pool=>fs.readdirSync(root+'/ledger/'+pool).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
  if(count('admission')+count('review')>=spec.total_cap)return deny('total-cap');
  let record;try{record=budget.reserve({lab_only:true,route:route.name,parent_pid:process.pid,parent_ticket:process.env.M11_LOCAL_PARENT_TICKET??null});}catch{return deny('pool-cap');}
  event('reserved',{index:record.index,pool:record.pool,route:route.name});return record;
 }finally{fs.rmdirSync(lock);}
}
cp.spawn=function(bin,args=[],options={}){
 if(!Array.isArray(args)||options.shell)return deny('shape-or-shell');
 const route=spec.routes.find(r=>r.command===bin&&JSON.stringify(r.args)===JSON.stringify(args));
 if(!route)return deny('unknown-route');
 if(options.cwd!==root)return deny('wrong-cwd');
 if(route.missing){if(bin!==root+'/missing-local-executable'||fs.existsSync(bin))return deny('invalid-missing-stub');}
 else {
  if(bin!==process.execPath||hash(bin)!==spec.node_sha256)return deny('node-fingerprint');
  const allowed=['mock-native.cjs','mock-wrapper.cjs'].map(n=>path.join(__dirname,n));
  if(!allowed.includes(args[0])||hash(args[0])!==route.script_sha256)return deny('script-fingerprint');
 }
 const record=reserve(route),env={...(options.env??process.env),M11_LOCAL_PARENT_TICKET:spec.pool+':'+record.index};
 event('before-original-spawn',{index:record.index,pool:spec.pool,route:route.name});
 let child;
 try{child=rawSpawn.call(this,bin,args,{...options,env});}
 catch(e){budget.complete(record,{spawned:false,error_code:e.code??null});throw e;}
 let spawned=false,error=null;
 child.once('spawn',()=>{spawned=true;event('spawned',{index:record.index,pool:spec.pool,child_pid:child.pid});});
 child.once('error',e=>{error=e.code??null;});
 child.once('close',(code,signal)=>{budget.complete(record,{spawned,pid:child.pid??null,code,signal,error_code:error});event('completed',{index:record.index,pool:spec.pool,code,signal,error});});
 return child;
};
for(const api of ['exec','execSync','execFile','execFileSync','spawnSync','fork'])cp[api]=()=>deny('api-'+api);
syncBuiltinESMExports();
