/** 厂商原生Custom缓存桥接。提取代码只在短命隔离子进程运行，协议只在内存中传递。 */
import { promises as fs, readFileSync } from 'node:fs';
import { createDecipheriv, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import type { NativeRouteDescriptor } from '../types.js';
import { redactSecrets } from '../secrets.js';
import { qoderConfigRoot, qoderRun, withQoderHome, qoderPolicyTemplate } from './qoder-cn-native.js';
import { customSelector, qoderHash } from './qoder-cn-model.js';
import { QODER_READING_TOOLS, QODER_EXECUTION_TOOLS } from './qoder-cn-trace.js';

export const QODER_CUSTOM_RECIPE='cn-custom-single-record-codec-child-v1';
export const qoderIsolationHash=()=>qoderHash(JSON.stringify({recipe:QODER_CUSTOM_RECIPE,env:'replace-with-delete-fallback',lease:'durable-before-auth-v1',executable:'private-hash-pinned-v1',home:0o700,files:0o600,tmp:'private',sources:['user'],tools:[],readonly:{template:qoderPolicyTemplate(),allowed:QODER_READING_TOOLS,denied:QODER_EXECUTION_TOOLS},mcp:'strict-empty',persistence:false,codec:'node-child-sealed-protocol',node:process.execPath,node_version:process.version,node_sha256:qoderHash(readFileSync(process.execPath)),bridge_sha256:qoderHash(CODEC_CHILD)}));

/** 只保存在当前调用内存；返回给上层和所有落盘内容必须先scrub。 */
export class QoderSecretGuard {
  private readonly values=new Set<string>();
  leaked=false;
  add(value:string):void {if(value)this.values.add(value);}
  merge(other:QoderSecretGuard):void {for(const value of other.values)this.add(value);this.leaked||=other.leaked;}
  addCredential(text:string):void {
    if(text.trim().length>=16)this.add(text.trim());
    try {
      const walk=(x:unknown,key=''):void=>{
        if(typeof x==='string'){if(/token|secret|password|api[_-]?key|credential|authorization|machine_id$/i.test(key)||x.length>=16)this.add(x);}
        else if(x&&typeof x==='object')for(const [k,v] of Object.entries(x))walk(v,k);
      };walk(JSON.parse(text));
    }catch{/* 不伪称取得原生内部解密字段。 */}
  }
  scrub(text:string):string {
    let safe=text;
    for(const value of [...this.values].sort((a,b)=>b.length-a.length)){
      for(const form of new Set([value,JSON.stringify(value).slice(1,-1)]))if(form&&safe.includes(form)){safe=safe.split(form).join('[REDACTED]');this.leaked=true;}
    }
    return redactSecrets(safe).content;
  }
}

interface NativeCustomMetadata {
  key:string;provider:string;model:string;display_name:string;
  [key:string]:unknown;
}
export interface QoderCustomSelection {
  declaration:NativeCustomMetadata;
  descriptor:NativeRouteDescriptor;
  encrypted:string;
  account:Record<string,unknown>;
  secrets:QoderSecretGuard;
}

/** 源文件只接受普通文件，不沿链接读取凭据。 */
async function ordinary(file:string):Promise<Buffer>{
  const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink())throw new Error('Qoder CN Custom来源必须是普通文件');
  return fs.readFile(file);
}

export async function qoderCustomSource():Promise<{root:string;account:Record<string,unknown>;uid:string;file:string;bytes:Buffer;fingerprint:string;authentication:string;guard:QoderSecretGuard}> {
  try {
    const root=qoderConfigRoot(),accountBytes=await ordinary(path.join(root,'.models/default')),account=JSON.parse(accountBytes.toString()) as Record<string,unknown>;
    const uid=account['uid'];if(typeof uid!=='string'||!/^[-A-Za-z0-9_:]+$/.test(uid))throw new Error();
    // 目录本身也必须在来源真实根内，拒绝中间层符号链接逃逸。
    const file=path.join(root,'.models',uid,'customs'),realRoot=await fs.realpath(root),realFile=await fs.realpath(file);
    if(!realFile.startsWith(realRoot+path.sep)||realFile!==path.join(realRoot,'.models',uid,'customs'))throw new Error();
    const user=await ordinary(path.join(root,'.auth/user')),machine=await ordinary(path.join(root,'.auth/machine_id'));
    const guard=new QoderSecretGuard();guard.addCredential(user.toString());guard.addCredential(machine.toString());
    const clean=Object.fromEntries(['key','uid','scene','updatedAt'].filter(k=>account[k]!==undefined).map(k=>[k,account[k]]));
    const bytes=await ordinary(file);
    return {root,account:clean,uid,file,bytes,fingerprint:qoderHash(Buffer.concat([bytes,Buffer.from([0]),accountBytes])),authentication:qoderHash(Buffer.concat([user,Buffer.from([0]),machine])),guard};
  }catch{throw new Error('Qoder CN Custom来源不可读取或格式/路径未核实');}
}

/** 只支持已经取证的Bun嵌入布局；未知边界/codec不唯一立即拒绝。 */
export function extractQoderCodec(bytes:Buffer):{source:string;wasm:Buffer;source_sha256:string;wasm_sha256:string} {
  const api=(globalThis as unknown as {WebAssembly:{Module:{new(bytes:Uint8Array):object;exports(module:object):{name:string}[]}}}).WebAssembly;
  const marker=bytes.indexOf('n.model_cache_decrypt(',110000000);
  const start=bytes.lastIndexOf('\0// @bun @bytecode\n',marker),end=bytes.indexOf(0,marker);
  if(marker<0||start<0||end<0)throw new Error('Qoder CN 原生codec布局未核实');
  const source=bytes.subarray(start+1,end).toString();let wasm:Buffer|null=null;
  for(const match of bytes.subarray(110000000).toString().matchAll(/AGFzbQ[A-Za-z0-9+/=]+/g)){
    let candidate:Buffer;
    try {candidate=Buffer.from(match[0],'base64');if(!api.Module.exports(new api.Module(candidate)).some(x=>x.name==='model_cache_decrypt'))continue;}catch{continue;}
    if(wasm)throw new Error('Qoder CN 原生codec不唯一');wasm=candidate;
  }
  if(!wasm)throw new Error('Qoder CN 原生codec缺失');
  return {source,wasm,source_sha256:qoderHash(source),wasm_sha256:qoderHash(wasm)};
}

/** 程序是固定桥接协议；厂商模块只收到密文、machine_id和显式选择，不收到父环境。 */
const CODEC_CHILD=String.raw`
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createCipheriv,randomBytes} from 'node:crypto';
let input='';for await(const chunk of process.stdin)input+=chunk;
try{
 const x=JSON.parse(input),native=await import(pathToFileURL(x.module).href);
 await native.default({module_or_path:await fs.readFile(x.wasm)});
 const records=JSON.parse(native.model_cache_decrypt(x.encrypted,x.machine));
 if(!Array.isArray(records))throw Error();
 const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
 const secret_values=records.flatMap(r=>strings(r.parameters??{})).filter(Boolean);
 const matches=records.filter(r=>r.key===x.key);if(matches.length!==1)throw Error();
 const picked=matches[0];if(!picked.parameters||Object.keys(picked.parameters).some(k=>k!=='api_key')||typeof picked.parameters.api_key!=='string'||!picked.parameters.api_key)throw Error();
 const fields=['key','display_name','provider','model','type','url','format','is_vl','is_reasoning','max_input_tokens','available_context_windows','default_context_window','efforts','supports_disabled','default_effort'];
 if(Object.keys(picked).some(k=>k!=='parameters'&&!fields.includes(k)))throw Error();
 const declaration=Object.fromEntries(fields.filter(k=>picked[k]!==undefined).map(k=>[k,picked[k]]));
 const encrypted=native.model_cache_encrypt(JSON.stringify([{...declaration,parameters:{api_key:picked.parameters.api_key}}]),x.machine);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(x.transport,'hex'),iv);
 const bytes=Buffer.concat([cipher.update(JSON.stringify({declaration,encrypted,secret_values,total:records.length})),cipher.final()]);
 process.stdout.write(JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),sealed:bytes.toString('base64')}));
}catch{process.stderr.write('Qoder CN codec子进程失败');process.exitCode=1;}
`;

/** 内存返回包含秘密集合，禁止直接JSON序列化本对象。 */
export async function loadQoderCustom(entry:string,key:string,expected?:NativeRouteDescriptor):Promise<QoderCustomSelection> {
  customSelector(key);
  const source=await qoderCustomSource(),codec=extractQoderCodec(await fs.readFile(entry));
  if(expected&&(expected.codec?.source_sha256!==codec.source_sha256||expected.codec.wasm_sha256!==codec.wasm_sha256))throw new Error('Qoder CN codec绑定变化，请重探');
  return withQoderHome(async(home,_config,env)=>{
    const module=path.join(home,'codec.mjs'),wasm=path.join(home,'codec.wasm'),runner=path.join(home,'codec-child.mjs');
    await fs.writeFile(module,codec.source,{mode:0o600,flag:'wx'});await fs.writeFile(wasm,codec.wasm,{mode:0o600,flag:'wx'});await fs.writeFile(runner,CODEC_CHILD,{mode:0o600,flag:'wx'});
    const machine=(await ordinary(path.join(source.root,'.auth/machine_id'))).toString().trim();
    const transport=randomBytes(32);
    const out=await qoderRun(process.execPath,[runner],{cwd:home,env,stdin:JSON.stringify({module,wasm,encrypted:source.bytes.toString(),machine,key,transport:transport.toString('hex')}),timeoutMs:15000,killTree:true,maxBufferBytes:16*1024*1024});
    if(out.code!==0||out.timedOut||out.truncated)throw new Error('Qoder CN 原生Custom准备失败');
    let parsed:{declaration:NativeCustomMetadata;encrypted:string;secret_values:string[]};
    try {const reply=JSON.parse(out.stdout) as {iv:string;tag:string;sealed:string};const decipher=createDecipheriv('aes-256-gcm',transport,Buffer.from(reply.iv,'hex'));decipher.setAuthTag(Buffer.from(reply.tag,'hex'));parsed=JSON.parse(Buffer.concat([decipher.update(Buffer.from(reply.sealed,'base64')),decipher.final()]).toString()) as typeof parsed;}catch{throw new Error('Qoder CN codec协议无效');}finally{transport.fill(0);}
    if(!Array.isArray(parsed.secret_values)||typeof parsed.encrypted!=='string')throw new Error('Qoder CN codec协议形状无效');
    for(const value of parsed.secret_values)if(typeof value==='string')source.guard.add(value);
    const d=parsed.declaration;
    if(!d||d.key!==key||typeof d.display_name!=='string'||!d.display_name||d.provider!==key.split('/')[0]||d.model!==key.split('/')[1]||source.guard.scrub(JSON.stringify(d))!==JSON.stringify(d))throw new Error('Qoder CN Custom声明无效或含凭据');
    const descriptor:NativeRouteDescriptor={selector:customSelector(key),native_key:key,display_name:d.display_name,provider_id:d.provider,model_id:d.model,
      source_ref:path.join(source.root,'.models/{active-account}/customs'),declaration_sha256:qoderHash(JSON.stringify(d)),credential_source_sha256:source.fingerprint,authentication_sha256:source.authentication,
      recipe_sha256:qoderIsolationHash(),codec:{source_sha256:codec.source_sha256,wasm_sha256:codec.wasm_sha256,recipe:QODER_CUSTOM_RECIPE}};
    if(expected&&!isDeepStrictEqual(expected,descriptor))throw new Error('Qoder CN Custom来源/声明/凭据/配方绑定变化，请重探');
    return {declaration:d,descriptor,encrypted:parsed.encrypted,account:source.account,secrets:source.guard};
  },{copyAuthentication:false});
}

export async function installQoderCustom(selection:QoderCustomSelection,config:string):Promise<void> {
  const uid=selection.account['uid'];if(typeof uid!=='string'||!/^[-A-Za-z0-9_:]+$/.test(uid))throw new Error('Qoder CN Custom账号形状无效');
  await fs.mkdir(path.join(config,'.models',uid),{recursive:true,mode:0o700});
  await fs.writeFile(path.join(config,'.models',uid,'customs'),selection.encrypted,{mode:0o600,flag:'wx'});
  await fs.writeFile(path.join(config,'.models/default'),JSON.stringify(selection.account),{mode:0o600,flag:'wx'});
}
