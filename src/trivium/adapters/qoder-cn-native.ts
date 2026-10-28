/** 官方认证的最小隔离副本；不加载用户模型、插件、Hook 和项目配置。 */
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, processStartTime, processAlive } from '../util/exec.js';
import { parseQoderSettings, qoderHash } from './qoder-cn-model.js';
import { IS_WIN } from '../util/platform.js';
import { makeTempDir, tryRemoveTempDir } from '../util/fsx.js';

interface HelperOps {
  list():Promise<string>;
  start(pid:number):Promise<string|null>;
  exists(pid:number):Promise<boolean>;
  alive:typeof processAlive;
  kill(pid:number,signal:NodeJS.Signals):void;
  wait():Promise<void>;
}
const helperOps:HelperOps={
  async list(){const r=await run('ps',['-axo','pid=,command='],{timeoutMs:15000});if(r.code!==0)throw new Error('无法枚举临时辅助进程');return r.stdout;},
  start:processStartTime,
  async exists(pid){const r=await run('ps',['-p',String(pid),'-o','pid='],{timeoutMs:15000});if(r.code===1)return false;if(r.code!==0)throw new Error('无法核对临时辅助进程在位');return r.stdout.trim()===String(pid);},
  alive:processAlive,kill:(pid,signal)=>{try{process.kill(pid,signal);}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}},
  wait:()=>new Promise<void>(resolve=>setTimeout(resolve,100)),
};

/** 只作用于本次一次性 HOME 的辅助可执行文件；注入接缝用于短命进程/PID复用回归。 */
export async function stopQoderHomeHelpers(home:string,ops:HelperOps=helperOps):Promise<void> {
  const normalized=home.replace(/^\/private\//,'/');
  for(const line of (await ops.list()).split('\n')) {
    const m=/^\s*(\d+)\s+(\S+)/.exec(line);
    if(!m||!m[2]!.replace(/^\/private\//,'/').startsWith(normalized+'/'))continue;
    const pid=Number(m[1]),started=await ops.start(pid);
    if(!started){if(!await ops.exists(pid))continue;throw new Error('Qoder CN 临时辅助进程身份不可核实');}
    if((await ops.alive(pid,started)).sameProcess)ops.kill(pid,'SIGTERM');
    await ops.wait();
    if((await ops.alive(pid,started)).sameProcess)ops.kill(pid,'SIGKILL');
  }
}

export function qoderConfigRoot(): string {
  return path.resolve(process.env['QODERCN_CONFIG_DIR'] ?? path.join(os.homedir(), '.qoder-cn'));
}

export async function qoderConfiguration(): Promise<{model:string|null; hash:string|null}> {
  const p=path.join(qoderConfigRoot(),'settings.json');
  let bytes:Buffer;
  try {bytes=await fs.readFile(p);} catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT')return {model:null,hash:null}; throw e;}
  return {model:parseQoderSettings(bytes.toString('utf8')),hash:qoderHash(bytes)};
}

export async function withQoderHome<T>(fn:(home:string,config:string,env:Record<string,string|undefined>)=>Promise<T>):Promise<T> {
  const home=await makeTempDir('trivium-cn-route');
  let primary:unknown;
  try {
    await fs.chmod(home,0o700);
    // 未建立 Windows 私有 ACL 的路线不得复制凭据，保持未测而非降级。
    if(IS_WIN)throw new Error('Qoder CN 临时认证 Windows ACL 尚未实测，拒绝复制');
    const config=path.join(home,'.qoder-cn');
    await fs.mkdir(path.join(config,'.auth'),{recursive:true,mode:0o700});
    for(const name of ['user','machine_id']) {
      const source=path.join(qoderConfigRoot(),'.auth',name);
      const stat=await fs.lstat(source);
      if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Qoder CN 认证源必须为普通文件');
      await fs.writeFile(path.join(config,'.auth',name),await fs.readFile(source),{mode:0o600,flag:'wx'});
    }
    await fs.writeFile(path.join(config,'settings.json'),JSON.stringify({general:{enableAutoUpdate:false}}),{mode:0o600});
    const env:Record<string,string|undefined>={...process.env,HOME:home,USERPROFILE:home};
    for(const key of Object.keys(env))if(/^(QODER|QODERCN|ANTHROPIC|OPENAI|CODEX|TRIVIUM)_/.test(key)||key==='NODE_OPTIONS')env[key]=undefined;
    env['QODERCN_CONFIG_DIR']=config;
    return await fn(home,config,env);
  } catch(e){primary=e;throw e;} finally {
    // 原生安全初始化进程会在 CLI 退出后短暂写日志；先删认证，再等待其收尾并复删。
    const errors:unknown[]=[];
    const authLeftover=await tryRemoveTempDir(path.join(home,'.qoder-cn','.auth'),[]);
    if(authLeftover)errors.push(new Error('Qoder CN 临时认证文件清理失败'));
    try {if(!IS_WIN)await stopQoderHomeHelpers(home);}catch(e){errors.push(e);}
    const leftover=await tryRemoveTempDir(home,[]);
    if(leftover)errors.push(new Error('Qoder CN 临时认证目录清理失败'));
    if(errors.length)throw new AggregateError([...(primary?[primary]:[]),...errors],'Qoder CN 临时环境清理失败');
  }
}

export async function verifyQoderBinding(facts:import('../types.js').NativeModelFacts,configuredBin?:string|null):Promise<void> {
  checkQoderBinding(facts,configuredBin);
  const v=await withQoderHome((home,_config,env)=>run(facts.entrypoint,['--version'],{cwd:home,env,timeoutMs:15000,killTree:true}));
  if(v.code!==0||v.stdout.trim()!==facts.cli_version)throw new Error('Qoder CN 版本变化或不可读取，请重探');
}

/** 同步预检只校本地指纹；实际版本仍由预检与执行前的异步版本调用核对。 */
export function checkQoderBinding(facts:import('../types.js').NativeModelFacts,configuredBin?:string|null):void {
  if(configuredBin && path.resolve(configuredBin)!==facts.entrypoint)throw new Error('Qoder CN 入口配置已变化，请重探');
  if(facts.platform!==process.platform || qoderHash(readFileSync(facts.entrypoint))!==facts.cli_sha256)throw new Error('Qoder CN 平台/入口指纹变化，请重探');
  let hash:string|null;
  try{hash=qoderHash(readFileSync(path.join(qoderConfigRoot(),'settings.json')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;hash=null;}
  if(hash!==facts.configuration_sha256)throw new Error('Qoder CN 原生配置来源指纹变化，请重探');
}
