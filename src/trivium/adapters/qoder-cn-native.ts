/** 最小私有配置根：认证与显式选中Custom按需加载，不整份复制用户配置。 */
import { promises as fs } from 'node:fs';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, processStartTime, processAlive } from '../util/exec.js';
import type { RunOptions, RunResult } from '../util/exec.js';
import { parseQoderSettings, qoderHash } from './qoder-cn-model.js';
import { IS_WIN } from '../util/platform.js';
import { makeTempDir, tryRemoveTempDir } from '../util/fsx.js';
import { QODER_READING_TOOLS, QODER_EXECUTION_TOOLS } from './qoder-cn-trace.js';
import { qoderIsolationHash } from './qoder-cn-custom.js';
import { registerCredentialLease, releaseCredentialLease, trackCredentialRun, reapCredentialLeases } from '../util/credential-lease.js';

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
    let exited=false;
    for(let n=0;n<10;n++){
      const state=await ops.alive(pid,started);
      if(!state.sameProcess&&(!state.alive||state.startedAt!==null)){exited=true;break;}
      await ops.wait();
    }
    if(!exited)throw new Error('Qoder CN 临时辅助进程尚未确认退出');
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

export function qoderAuthenticationHash(config=qoderConfigRoot()):string {
  const values=['user','machine_id'].map(name=>{const file=path.join(config,'.auth',name);if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw new Error('Qoder CN 认证必须为普通文件');return readFileSync(file);});
  return qoderHash(Buffer.concat([values[0]!,Buffer.from([0]),values[1]!]));
}

export function qoderOfficialBinding(model:string,models:readonly string[]):string {
  let observed:string|null=null;
  try{observed=parseQoderSettings(readFileSync(path.join(qoderConfigRoot(),'settings.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const configured=models.find(x=>x.toLowerCase()===observed?.toLowerCase())??null;
  return qoderHash(JSON.stringify({model,configured,authentication:qoderAuthenticationHash()}));
}

/** Qoder派生统一强制完整替换；env缺席拒绝，不能退回继承父进程。 */
export function qoderRun(bin:string,args:readonly string[],opts:RunOptions):Promise<RunResult> {
  if(!opts.env||typeof opts.env['HOME']!=='string'||typeof opts.env['QODERCN_CONFIG_DIR']!=='string')throw new Error('Qoder CN 缺少隔离环境，拒绝派生');
  return trackCredentialRun(opts.env['HOME'],()=>run(bin,args,{...opts,envMode:'replace'}));
}

export async function pinQoderExecutable(entry:string,home:string,expectedHash?:string){
  const bytes=await fs.readFile(entry),sha256=qoderHash(bytes);
  if(expectedHash&&sha256!==expectedHash)throw new Error('Qoder CN 派生前CLI字节变化，请重探');
  const executable=path.join(home,'qoder-native');await fs.writeFile(executable,bytes,{mode:0o700,flag:'wx'});
  return {executable,sha256};
}

/** 保留构造时父键undefined作为误用merge时的兜底；qoderRun的replace同时阻止后新增父键。 */
export function qoderChildEnv(home:string,config:string,parent:NodeJS.ProcessEnv=process.env):Record<string,string|undefined> {
  const env:Record<string,string|undefined>=Object.fromEntries(Object.keys(parent).map(key=>[key,undefined]));
  for(const key of QODER_ENV_KEYS) {
    if(parent[key]!==undefined)env[key]=parent[key];
  }
  for(const key of QODER_PROXY_KEYS) {
    const value=parent[key];if(!value)continue;
    let url:URL;try{url=new URL(value);}catch{throw new Error('Qoder CN 代理配置无法安全继承');}
    if(!QODER_PROXY_PROTOCOLS.includes(url.protocol)||url.username||url.password||url.search||url.hash||(url.pathname&&url.pathname!=='/'))throw new Error('Qoder CN 代理含认证或非标准路径，拒绝继承');
    env[key]=value;
  }
  for(const key of QODER_NO_PROXY_KEYS)if(parent[key]!==undefined)env[key]=parent[key];
  env['HOME']=home;env['USERPROFILE']=home;
  env['TMPDIR']=path.join(home,'tmp');env['TMP']=env['TMPDIR'];env['TEMP']=env['TMPDIR'];
  env['QODERCN_CONFIG_DIR']=config;
  return env;
}

export const QODER_ENV_KEYS=['PATH','LANG','LC_ALL','LC_CTYPE','TZ','SystemRoot','WINDIR','COMSPEC','PATHEXT','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS'];
const QODER_PROXY_KEYS=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'];
const QODER_NO_PROXY_KEYS=['NO_PROXY','no_proxy'];
const QODER_PROXY_PROTOCOLS=['http:','https:','socks5:','socks5h:'];
const QODER_RULE_UNSAFE=/[\0\r\n()*?\[\]{}!\\]/;
export const qoderPathForms=(p:string)=>[...new Set([p,...(p.startsWith('/private/var/')?[p.slice(8)]:p.startsWith('/var/')?['/private'+p]:[])])];
export function qoderReadonlySettings(targets:readonly string[],root:string){
  const deny:string[]=[...QODER_EXECUTION_TOOLS];
  for(const tool of QODER_READING_TOOLS)for(const p of [...targets].sort())deny.push(`${tool}(/${p})`,`${tool}(/${p}/**)`);
  return {general:{enableAutoUpdate:false},permissions:{allow:QODER_READING_TOOLS.map(t=>`${t}(/${root}/**)`),deny}};
}
/** 实际规则模板和允许键入指纹；路径别名样本覆盖两个方向，禁止仅靠手工标签。 */
export function qoderPolicyTemplate(){return {env_keys:QODER_ENV_KEYS,proxy_keys:QODER_PROXY_KEYS,no_proxy:QODER_NO_PROXY_KEYS,protocols:QODER_PROXY_PROTOCOLS,unsafe_path:QODER_RULE_UNSAFE.source,
  private_environment:qoderChildEnv('/TRIVIUM_HOME','/TRIVIUM_CONFIG',{}),proxy_controls:['https://127.0.0.1:1234','https://fixture:fixture@127.0.0.1','https://127.0.0.1/path','https://127.0.0.1?query=fixture','https://127.0.0.1/#fixture','ftp://127.0.0.1'].map(value=>{try{return qoderChildEnv('/TRIVIUM_HOME','/TRIVIUM_CONFIG',{HTTPS_PROXY:value})['HTTPS_PROXY']===value;}catch{return false;}}),
  settings:qoderReadonlySettings(['/TRIVIUM_HOME','/TRIVIUM_CONFIG','/TRIVIUM_PEER','/TRIVIUM_SECRET'],'/TRIVIUM_PROJECT'),aliases:['/var/fixture','/private/var/fixture'].map(qoderPathForms)};}

/** 运行期临时根须在创建后加入deny；规则语义及别名仍须逐组合真机准入。 */
export async function prepareQoderReadonly(home:string,config:string,denyPaths:readonly string[],projectRoot:string):Promise<void>{
  const targets=new Set<string>();
  for(const entry of [...denyPaths,home,qoderConfigRoot()]){
    // 编排器禁读域以项目相对路径为主；原生规则必须展开为受测的绝对路径。
    const raw=path.resolve(projectRoot,entry);
    if(QODER_RULE_UNSAFE.test(raw))throw new Error('Qoder CN 禁读路径无法按受测规则可靠表示，拒绝');
    const canonical=await fs.realpath(raw).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return path.normalize(raw);throw e;});
    for(const p of [raw,canonical])for(const form of qoderPathForms(p))targets.add(form);
  }
  const root=await fs.realpath(projectRoot);
  if(QODER_RULE_UNSAFE.test(root))throw new Error('Qoder CN 项目路径无法按受测规则可靠表示');
  await fs.writeFile(path.join(config,'settings.json'),JSON.stringify(qoderReadonlySettings([...targets],root)),{mode:0o600});
}

export async function reapQoderUnscopedCredentials(root?:string){return reapCredentialLeases('qoder-cn',null,async home=>{await stopQoderHomeHelpers(home);if(await tryRemoveTempDir(home,[]))throw new Error('Qoder CN 无运行侧私有根回收失败');},root,true);}

export async function withQoderHome<T>(fn:(home:string,config:string,env:Record<string,string|undefined>)=>Promise<T>,options:{copyAuthentication?:boolean}={}):Promise<T> {
  if(!IS_WIN){const reaped=await reapQoderUnscopedCredentials();if(reaped.errors.length)throw new Error('Qoder CN 遗留探针凭据未安全回收，拒绝新复制');}
  const home=await makeTempDir('trivium-cn-route');
  let primary:unknown;
  let lease:Awaited<ReturnType<typeof registerCredentialLease>>|undefined;
  try {
    await fs.chmod(home,0o700);
    // 未建立 Windows 私有 ACL 的路线不得复制凭据，保持未测而非降级。
    if(IS_WIN)throw new Error('Qoder CN 临时认证 Windows ACL 尚未实测，拒绝复制');
    if(options.copyAuthentication!==false)lease=await registerCredentialLease(home,'qoder-cn');
    const config=path.join(home,'.qoder-cn');
    await fs.mkdir(path.join(config,'.auth'),{recursive:true,mode:0o700});
    for(const name of options.copyAuthentication===false?[]:['user','machine_id']) {
      const source=path.join(qoderConfigRoot(),'.auth',name);
      const stat=await fs.lstat(source);
      if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Qoder CN 认证源必须为普通文件');
      await fs.writeFile(path.join(config,'.auth',name),await fs.readFile(source),{mode:0o600,flag:'wx'});
    }
    await fs.writeFile(path.join(config,'settings.json'),JSON.stringify({general:{enableAutoUpdate:false}}),{mode:0o600});
    await fs.mkdir(path.join(home,'tmp'),{mode:0o700});
    const env=qoderChildEnv(home,config);
    return await fn(home,config,env);
  } catch(e){primary=e;throw e;} finally {
    // 原生安全初始化进程会在 CLI 退出后短暂写日志；先删认证，再等待其收尾并复删。
    const errors:unknown[]=[];
    const authLeftover=await tryRemoveTempDir(path.join(home,'.qoder-cn','.auth'),[]);
    if(authLeftover)errors.push(new Error('Qoder CN 临时认证文件清理失败'));
    let helperFailed=false;
    try {if(!IS_WIN)await stopQoderHomeHelpers(home);}catch(e){helperFailed=true;errors.push(e);}
    // 留下独占标记/可执行路径供监督方重试，认证已先删除；不把未知活进程当清理完成。
    const leftover=helperFailed?home:await tryRemoveTempDir(home,[]);
    if(leftover)errors.push(new Error('Qoder CN 临时认证目录清理失败'));
    if(lease&&!leftover&&!errors.length)try{await releaseCredentialLease(lease);}catch(e){errors.push(e);}
    if(errors.length)throw new AggregateError([...(primary?[primary]:[]),...errors],'Qoder CN 临时环境清理失败');
  }
}

export async function verifyQoderBinding(facts:import('../types.js').NativeModelFacts,configuredBin?:string|null):Promise<void> {
  checkQoderBinding(facts,configuredBin);
  const v=await withQoderHome((home,_config,env)=>qoderRun(facts.entrypoint,['--version'],{cwd:home,env,timeoutMs:15000,killTree:true}));
  if(v.code!==0||v.stdout.trim()!==facts.cli_version)throw new Error('Qoder CN 版本变化或不可读取，请重探');
}

/** 同步预检只校本地指纹；实际版本仍由预检与执行前的异步版本调用核对。 */
export function checkQoderBinding(facts:import('../types.js').NativeModelFacts,configuredBin?:string|null):void {
  if(configuredBin && path.resolve(configuredBin)!==facts.entrypoint)throw new Error('Qoder CN 入口配置已变化，请重探');
  if(facts.platform!==process.platform || qoderHash(readFileSync(facts.entrypoint))!==facts.cli_sha256)throw new Error('Qoder CN 平台/入口指纹变化，请重探');
  if(facts.binding_version===2&&facts.route_descriptor?.recipe_sha256!==qoderIsolationHash())throw new Error('Qoder CN 隔离配方或codec运行器变化，请重探');
  if(facts.route_kind==='custom'){
    try {
      const d=facts.route_descriptor!,root=qoderConfigRoot();
      const account=JSON.parse(readFileSync(path.join(root,'.models/default'),'utf8')) as {uid?:unknown};
      if(typeof account.uid!=='string'||!/^[-A-Za-z0-9_:]+$/.test(account.uid))throw new Error();
      const file=path.join(root,'.models',account.uid,'customs');
      if(d.source_ref!==path.join(root,'.models/{active-account}/customs')||realpathSync(file)!==path.join(realpathSync(root),'.models',account.uid,'customs')||lstatSync(file).isSymbolicLink())throw new Error();
      const auth=['user','machine_id'].map(name=>{const p=path.join(root,'.auth',name);if(!lstatSync(p).isFile()||lstatSync(p).isSymbolicLink())throw new Error();return readFileSync(p);});
      if(qoderHash(Buffer.concat([readFileSync(file),Buffer.from([0]),readFileSync(path.join(root,'.models/default'))]))!==d.credential_source_sha256||qoderHash(Buffer.concat([auth[0]!,Buffer.from([0]),auth[1]!]))!==d.authentication_sha256)throw new Error();
    }catch{throw new Error('Qoder CN Custom来源/凭据绑定变化，请重探');}
    return; // 解密声明/codec由异步verifyQoderBinding继续复核。
  }
  if(facts.binding_version===2){
    if(facts.configuration_sha256!==qoderOfficialBinding(facts.model,facts.models))throw new Error('Qoder CN 官方默认/认证语义变化，请重探');
    return;
  }
  let hash:string|null;
  try{hash=qoderHash(readFileSync(path.join(qoderConfigRoot(),'settings.json')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;hash=null;}
  if(hash!==facts.configuration_sha256)throw new Error('Qoder CN 原生配置来源指纹变化，请重探');
}
