/** 改本取证谓词须正式敏感计划与明确批准；设计#agent-access-evidence-guard-contract，25B/r28。 */
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';
export const TRANSPORT_LIMITS=Object.freeze({requests:12,per_request_bytes:1048576,total_body_bytes:8388608,runtime_ms:120000});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
export function failureRecord(error){return error?{name:error.name??'UnknownError',message:String(error.message??error),code:error.code??null,...(error instanceof AggregateError?{errors:error.errors.map(failureRecord)}:{})}:null;}

/** 全部任务都尝试；未知内部错误与主成果不被最后一个清理失败覆盖。 */
export async function cleanupAll(tasks,mainFailure=null){
 const cleanup={},errors=mainFailure?[mainFailure]:[];
 for(const[name,task]of Object.entries(tasks)){try{const value=await task();if(value!==null&&value!==true&&value!==false)throw Error('unknown-cleanup-state:'+name);cleanup[name]=value;if(value===false)throw Error('cleanup-incomplete:'+name);}catch(error){cleanup[name]=false;errors.push(error);}}
 return {cleanup,failure:errors.length>1?new AggregateError(errors,'主失败与全部清理错误'):errors[0]??null};
}

/** 普通文件、单一模式键与精确字节；不读取或修改真实用户配置。 */
export function createModeSettings(home,liveInit){
 if(!path.isAbsolute(home)||liveInit?.permissionMode!=='default')throw Error('mode-source-not-default');
 const stat=fs.lstatSync(home);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('mode-home-not-directory');
 const dir=path.join(home,'.claude');fs.mkdirSync(dir,{recursive:true});const ds=fs.lstatSync(dir);if(!ds.isDirectory()||ds.isSymbolicLink())throw Error('mode-config-directory-invalid');
 const file=path.join(dir,'settings.json'),bytes=Buffer.from(JSON.stringify({permissions:{defaultMode:'default'}})+'\n');
 fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});const reference={path:file,sha256:digest(bytes),bytes:bytes.length,mode:0o600};
 const checked=inspectModeSettings(reference);if(!checked.valid)throw Error('created-mode-settings-invalid');return reference;
}
export function inspectModeSettings(reference){
 if(!object(reference)||!path.isAbsolute(reference.path??'')||typeof reference.sha256!=='string')return {valid:false,reason:'invalid-mode-reference'};
 let stat;try{stat=fs.lstatSync(reference.path);}catch(error){if(error.code==='ENOENT')return {valid:false,reason:'missing-mode-settings'};throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600)return {valid:false,reason:'mode-settings-type-or-permission'};
 const fd=fs.openSync(reference.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let bytes;
 try{const opened=fs.fstatSync(fd);bytes=fs.readFileSync(fd);const after=fs.fstatSync(fd),named=fs.lstatSync(reference.path);
  if(!opened.isFile()||named.isSymbolicLink()||opened.dev!==stat.dev||opened.ino!==stat.ino||named.ino!==opened.ino||named.dev!==opened.dev||opened.size!==after.size||opened.mtimeMs!==after.mtimeMs||opened.ctimeMs!==after.ctimeMs||named.size!==after.size||named.mtimeMs!==after.mtimeMs||named.ctimeMs!==after.ctimeMs)throw Error('mode-settings-changed-during-read');
 }finally{fs.closeSync(fd);}
 let parsed;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{return {valid:false,reason:'damaged-mode-settings'};}
 const single=object(parsed)&&Object.keys(parsed).length===1&&object(parsed.permissions)&&Object.keys(parsed.permissions).length===1&&parsed.permissions.defaultMode==='default';
 return {valid:single&&digest(bytes)===reference.sha256&&bytes.length===reference.bytes,sha256:digest(bytes),bytes:bytes.length,mode:stat.mode&0o777,single_key:single,reason:single?null:'mode-settings-extra-or-wrong-key'};
}
export function pathAbsent(file){try{fs.lstatSync(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}

/** 夹具与真实本地HTTP测试共用此实现；不记录请求头或原始凭据。 */
export function createControlledTransport(handle,{limits=TRANSPORT_LIMITS,close_timeout_ms=5000}={}){
 if(typeof handle!=='function'||Object.keys(TRANSPORT_LIMITS).some(k=>!Number.isSafeInteger(limits[k])||limits[k]<=0)||!Number.isSafeInteger(close_timeout_ms)||close_timeout_ms<=0)throw Error('invalid-transport-limits');
 const errors=[],pending=new Set(),facts={requests:0,bodyBytes:0,max_request_bytes:0,started_at:null,finished_at:null,host:'127.0.0.1',limits:{...limits},handlers_finished:false,server_closed:null,within_limits:null};let timer=null,started=false,closed=false;
 const remember=error=>{errors.push(error);};
 async function serve(req,res){
  try{
   if(++facts.requests>limits.requests)throw Error('request-limit');
   const endpoint=req.url?.split('?')[0];if(req.method!=='POST'||!['/v1/messages','/v1/messages/count_tokens'].includes(endpoint))throw Error('invalid-endpoint-or-method');
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;facts.bodyBytes+=chunk.length;facts.max_request_bytes=Math.max(facts.max_request_bytes,size);if(size>limits.per_request_bytes)throw Error('per-request-body-limit');if(facts.bodyBytes>limits.total_body_bytes)throw Error('total-body-limit');chunks.push(chunk);}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!object(data))throw Error('invalid-protocol-body');
   await handle({endpoint,data,res});
  }catch(error){remember(error);if(!res.destroyed&&!res.writableEnded){try{if(!res.headersSent){res.writeHead(500);res.end('controlled fixture failure');}else res.destroy();}catch(closeError){remember(closeError);}}}
 }
 const server=http.createServer((req,res)=>{let tracked;tracked=serve(req,res).catch(remember).finally(()=>pending.delete(tracked));pending.add(tracked);});server.on('error',remember);
 async function start(){
  if(started||closed)throw Error('transport-already-used');
  await new Promise((resolve,reject)=>{const fail=error=>{server.off('listening',ready);reject(error);};const ready=()=>{server.off('error',fail);resolve();};server.once('error',fail);server.once('listening',ready);server.listen(0,'127.0.0.1');});
  started=true;facts.started_at=Date.now();timer=setTimeout(()=>{remember(Error('runtime-limit'));server.closeAllConnections();},limits.runtime_ms);return server.address();
 }
 async function close(){
  if(closed)throw Error('transport-close-repeated');closed=true;if(timer)clearTimeout(timer);
  if(!started){facts.server_closed=null;facts.handlers_finished=pending.size===0;return null;}
  server.closeAllConnections();let timeout;
  const finish=Promise.all([new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),Promise.allSettled([...pending])]);
  try{await Promise.race([finish,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('transport-close-timeout')),close_timeout_ms);})]);facts.handlers_finished=pending.size===0;facts.server_closed=true;}
  catch(error){remember(error);facts.handlers_finished=pending.size===0;facts.server_closed=false;}
  finally{clearTimeout(timeout);facts.finished_at=Date.now();}
  facts.within_limits=errors.length===0&&facts.requests<=limits.requests&&facts.bodyBytes<=limits.total_body_bytes&&facts.finished_at-facts.started_at<=limits.runtime_ms&&facts.handlers_finished===true&&facts.server_closed===true;
  return facts.server_closed;
 }
 return {start,close,facts,errors,snapshot:()=>({...facts,errors:errors.map(failureRecord)})};
}
