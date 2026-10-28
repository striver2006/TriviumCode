/** 私有凭据根的独占租约；信号/强杀不依赖被杀进程finally回收。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { promises as fs, writeFileSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { isAgentId, type AgentId } from '../agents/registry.js';
import { processStartTime, processMatchesRecord, processGroupMemberCount, trackedTrees } from './exec.js';

interface Lease {
  schema:'trivium.credential-lease.v1';id:string;agent:AgentId;directory:string;parent:string;
  owner_pid:number;owner_start:string;side_dir:string|null;groups:{pgid:number;started_at:string|null}[];
}
interface ActiveLease {file:string;record:Lease;}
const scope=new AsyncLocalStorage<{sideDir:string|null;root?:string}>();
const active=new Map<string,ActiveLease>();
const leaseRoot=()=>scope.getStore()?.root??path.join(os.homedir(),'.trivium/credential-leases');
const marker='.trivium-credential-lease';
function persist(lease:ActiveLease):void {
  const tmp=lease.file+'.tmp-'+randomBytes(6).toString('hex');
  writeFileSync(tmp,JSON.stringify(lease.record),{mode:0o600,flag:'wx'});renameSync(tmp,lease.file);
}

export function withCredentialLeaseScope<T>(sideDir:string|null,fn:()=>Promise<T>,root?:string):Promise<T>{return scope.run({sideDir,root},fn);}

export async function registerCredentialLease(home:string,agent:AgentId):Promise<ActiveLease>{
  const directory=await fs.realpath(home),parent=await fs.realpath(os.tmpdir()),owner=await processStartTime(process.pid,{canonical:true});
  if(path.dirname(directory)!==parent||!owner)throw new Error('私有凭据根/进程身份不可核实，拒绝复制');
  const root=leaseRoot();await fs.mkdir(root,{recursive:true,mode:0o700});
  const id=randomBytes(16).toString('hex'),file=path.join(root,id+'.json');
  const record:Lease={schema:'trivium.credential-lease.v1',id,agent,directory,parent,owner_pid:process.pid,owner_start:owner,side_dir:scope.getStore()?.sideDir??null,groups:[]};
  await fs.writeFile(path.join(directory,marker),JSON.stringify({id,owner_pid:record.owner_pid,owner_start:owner}),{flag:'wx',mode:0o600});
  await fs.writeFile(file,JSON.stringify(record),{flag:'wx',mode:0o600});
  const lease={file,record};active.set(directory,lease);return lease;
}

/** 新组PID在同一JS轮次同步记入已有租约；lstart取到后原子替换。秘密永不进入台账。 */
export async function trackCredentialRun<T>(home:string,run:()=>Promise<T>):Promise<T>{
  let canonical:string;try{canonical=await fs.realpath(home);}catch{return run();}
  const lease=active.get(canonical);if(!lease)return run();
  const before=new Set(trackedTrees().map(t=>t.pgid)),pending=run();
  const groups=trackedTrees().filter(t=>!before.has(t.pgid));
  try {
    for(const g of groups)lease.record.groups.push({pgid:g.pgid,started_at:g.startedAt});
    persist(lease);
    for(const g of lease.record.groups)if(g.started_at===null)g.started_at=await processStartTime(g.pgid,{canonical:true});
    persist(lease);
  }catch{
    // 派生已发生，必须等待原有超时/终止链，不制造无人监督的Promise。
    await pending;throw new Error('凭据派生租约记录失败，不能确认安全回收');
  }
  return pending;
}

export async function releaseCredentialLease(lease:ActiveLease):Promise<void>{
  try {await fs.lstat(lease.record.directory);throw new Error('私有凭据目录仍存在');}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await fs.rm(lease.file,{force:true});active.delete(lease.record.directory);
}

/** 复用现有scrub四处挂载。此函数不杀进程，未核实全部退出就保留租约并报错。 */
export async function reapCredentialLeases(agent:AgentId,sideDir:string|null,cleanup:(home:string)=>Promise<void>,root=leaseRoot(),ownerDeadOnly=false):Promise<{deleted:string[];errors:string[]}> {
  const result:{deleted:string[];errors:string[]}={deleted:[],errors:[]};
  let names:string[];try{names=await fs.readdir(root);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return result;throw e;}
  for(const name of names.filter(n=>/^[a-f0-9]{32}\.json$/.test(n))){
    const file=path.join(root,name);let l:Lease;
    try {
      const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink())throw new Error();l=JSON.parse(await fs.readFile(file,'utf8')) as Lease;
      if(l.schema!=='trivium.credential-lease.v1'||!isAgentId(l.agent)||l.id+'.json'!==name||!Number.isInteger(l.owner_pid)||typeof l.owner_start!=='string'||!Array.isArray(l.groups))throw new Error();
    }catch{result.errors.push('凭据租约损坏或身份不可核实');continue;}
    if(l.agent!==agent||l.side_dir!==sideDir)continue;
    try {
      const owner=await processMatchesRecord(l.owner_pid,{canonical:l.owner_start,legacy:null});
      if(ownerDeadOnly&&owner.sameProcess)continue;
      if(owner.identity==='unverifiable'||(owner.sameProcess&&l.owner_pid!==process.pid))throw new Error('凭据所有者仍在或身份无法核实');
      for(const group of l.groups){
        if(!Number.isInteger(group.pgid)||group.pgid<=0)throw new Error('凭据进程组记录无效');
        const count=await processGroupMemberCount(group.pgid);if(count===null||count>0)throw new Error('凭据进程组尚未确认全部退出');
      }
      const parent=await fs.realpath(os.tmpdir());if(l.parent!==parent||path.dirname(l.directory)!==parent)throw new Error('凭据目录边界不符');
      try{
        const st=await fs.lstat(l.directory);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(l.directory)!==l.directory)throw new Error('凭据根不是原私有目录');
        const m=JSON.parse(await fs.readFile(path.join(l.directory,marker),'utf8')) as {id?:unknown;owner_pid?:unknown;owner_start?:unknown};
        if(m.id!==l.id||m.owner_pid!==l.owner_pid||m.owner_start!==l.owner_start)throw new Error('凭据目录私有标记不符');
        await cleanup(l.directory);
      }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      try{await fs.lstat(l.directory);throw new Error('凭据根清理未完成');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      await fs.rm(file);result.deleted.push(l.id);active.delete(l.directory);
    }catch(e){result.errors.push((e as Error).message);}
  }
  return result;
}
