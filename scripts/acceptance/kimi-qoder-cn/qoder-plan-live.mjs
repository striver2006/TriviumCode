#!/usr/bin/env node
/** 显式两步调用：production-preflight或native-B。采集器永不直接启动review。 */
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {fileHash,globalSnapshot,request,topic,writeSettings} from './qoder-plan.mjs';
import {repo} from './driver-identity.mjs';
import {collectCredentialValues,secretGuard} from './qoder-secrets.mjs';
import {sha} from './driver-identity.mjs';
import {nativeTools} from './qoder-plan-audit.mjs';

/** 清理前仅取权限决策及含已知调用ID的行，不保存整个私有日志。 */
export async function permissionLogs(config,home,ids){
  const found=[];
  async function walk(dir){for(const f of await fs.readdir(dir,{withFileTypes:true})){
    const p=path.join(dir,f.name);
    if(f.isDirectory()&&f.name!=='.auth')await walk(p);
    else if(f.isFile()&&/\.(log|txt)$/.test(f.name)&&(await fs.stat(p)).size<=16*1024*1024){
      const lines=(await fs.readFile(p,'utf8')).split('\n').filter(x=>x.includes('[permission-check]')||ids.some(id=>x.includes(id)));
      if(lines.length)found.push({file:path.relative(home,p),lines});
    }
  }}await walk(config);return found;
}

/** 逐行监督，同ID成功Write才生成供wrapper消费的凭据；拒绝立即终止。 */
export function nativeObserver(receipts,stop){
  const lines=[],observed=[];let stopped=null;
  return {lines,observed,get stopped(){return stopped;},line(line){
    lines.push(line);let event;try{event=JSON.parse(line);}catch{return;}
    observed.push({at:new Date().toISOString(),event});
    const n=nativeTools(lines.join('\n'));
    for(const c of n.calls.filter(c=>c.name==='Write')){
      const result=n.results.get(c.id);if(!result||receipts.has(c.id))continue;
      receipts.set(c.id,{id:c.id,name:c.name,path:c.input?.file_path??c.input?.path,sha256:sha(c.input?.content??''),result});
      if(result.error)stopped??={reason:'原生Write失败',id:c.id};
    }
    if(event.subtype==='permission_denied')stopped??={reason:'原生权限拒绝',id:event.tool_use_id??null};
    for(const c of n.calls.filter(c=>c.name==='Bash'&&c.input?.command?.includes('.trivium/bin/trivium'))){
      const r=n.results.get(c.id),waiting=c.input.command.includes('--wait')&&/^Exit code 73\n/.test(r?.text??'')&&r.text.includes('"still_running": true');
      if(r?.error&&!waiting)stopped??={reason:'wrapper工具失败',id:c.id};
      let gateResult;try{gateResult=JSON.parse(r?.text??'');}catch{/* 不凭非JSON自述推断gate状态 */}
      const checkedStop=c.input.command.includes('--check')&&gateResult?.ok===true&&['proceed','human_review'].includes(gateResult.next_action);
      if(r&&!r.error&&c.input.command.includes('gate ')&&(c.input.command.includes('--await-approval')||checkedStop))stopped??={reason:'awaiting_approval停点',id:c.id,expected:true};
    }
    for(const c of n.calls.filter(c=>['Read','Skill'].includes(c.name)))if(n.results.get(c.id)?.error)stopped??={reason:'关键读取或技能失败',id:c.id};
    if(stopped)stop(stopped);
  }};
}

export async function live(mode,specFile,output){
  if(!['production-preflight','native-B'].includes(mode))throw Error('仅production-preflight或native-B；均显式消耗真实配额');
  const spec=JSON.parse(await fs.readFile(specFile,'utf8'));
  if(spec.topic!==topic)throw Error('主题不符');
  for(const [p,h] of Object.entries(spec.pins))if(await fileHash(p)!==h)throw Error('pin失配，必须重建并保留原件');
  const api=createRequire(import.meta.url)(spec.helper),values=[];
  const e={schema:'trivium.qoder-plan-live.v1',at:new Date().toISOString(),mode,development_driver:'codex',client_driver:'qoder-cn',spec_file:specFile,fixture:spec.root,run_root:spec.run_root,request,candidate_only:true,candidate_installed:false,underlying_model:null};
  const guard=secretGuard(values,s=>api.redactSecrets(s).content);
  e.global_before=await globalSnapshot();e.wrapper_sha256=await fileHash(path.join(spec.root,'.trivium/bin/trivium'));
  e.baseline=(await api.run('git',['-c','core.quotePath=false','rev-parse','HEAD'],{cwd:repo})).stdout.trim();
  let error;
  try{
    if(mode==='production-preflight'){
      // 真实预检由编排器调两家；不直接调用审核者CLI。只写夹具local缓存。
      const args=['preflight','--stage','plan','--driver','qoder-cn','--critics','gemini,glm','--json'];
      e.command={bin:path.join(spec.root,'.trivium/bin/trivium'),args,cwd:spec.root};
      e.result=await api.run(e.command.bin,args,{cwd:spec.root,timeoutMs:240000,killTree:true,maxBufferBytes:8*1024*1024});
      e.passed=e.result.code===0&&JSON.parse(e.result.stdout).ok===true;
    }else{
      if(!spec.preflight_receipt?.ok||Date.now()-Date.parse(spec.preflight_receipt.at)>3600000)throw Error('先完成本夹具生产预检');
      if(spec.native_attempted)throw Error('本夹具已尝试过原生B，不重复调用凑绿');
      for(const name of spec.draft_names)if(await fileHash(path.join(spec.root,'drafts',name))!==null)throw Error('正文已存在，拒绝调用');
      await fs.writeFile(path.join(output,'native-attempt.json'),JSON.stringify({at:e.at,spec_file:specFile,sessions:1,max_rounds:3,timeout_ms:1500000,max_model_request_retries:0}),{flag:'wx',mode:0o600});
      spec.native_attempted=true;await fs.writeFile(specFile,JSON.stringify(spec,null,2));
      const source=await fs.realpath(path.join(os.homedir(),'.local/bin/qoderclicn')),bin=path.join(path.dirname(specFile),'qoderclicn');
      await fs.copyFile(source,bin,fs.constants.COPYFILE_EXCL);await fs.chmod(bin,0o700);
      e.cli={source,sha256:await fileHash(bin)};
      for(const name of ['user','machine_id'])collectCredentialValues(await fs.readFile(path.join(api.qoderConfigRoot(),'.auth',name),'utf8'),values);
      await api.withQoderHome(async(home,config,env)=>{
        e.private_home=home;e.credentials_copied=2;
        const entries=path.join(config,'skills');e.entries=[];
        // 仅复制正式入口字节；不安装candidate，也不换入口身份或参数占位符。
        for(const name of ['dual-review-plan']){
          const src=path.join(repo,'skills/dual-critic/entry/qoder-cn',name,'SKILL.md'),dst=path.join(entries,name,'SKILL.md');
          await fs.mkdir(path.dirname(dst),{recursive:true});await fs.copyFile(src,dst);
          e.entries.push({name,source:src,installed:dst,source_sha256:await fileHash(src),sha256:await fileHash(dst)});
        }
        env.TRIVIUM_ASSET_ROOT=spec.assets;env.TRIVIUM_ENTRY_SCAN_HOME=home;
        e.permission_settings=writeSettings(spec.root,spec.draft_names.map(n=>path.join(spec.root,'drafts',n)),['.trivium/bin/trivium:*'],[path.join(spec.root,'**'),path.join(entries,'**')]);
        await fs.writeFile(path.join(config,'settings.json'),JSON.stringify(e.permission_settings),{mode:0o600});
        e.settings_source={sources:['user'],file:path.join(config,'settings.json'),sha256:await fileHash(path.join(config,'settings.json')),global_settings_copied:false};
        e.cli.version=await api.qoderRun(bin,['--version'],{cwd:spec.root,env,timeoutMs:15000,killTree:true});
        e.model_request={route:'official-default',argv_model:null,private_settings_model:null,effective_underlying_model:null};
        const args=['--cwd',spec.root,'--add-dir',entries,'--setting-sources','user','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','Bash,Read,Write,Skill','--permission-mode','dont_ask','--no-session-persistence','--max-turns','120','--max-model-request-retries','0','--output-format','stream-json','-p',request];
        e.command={bin,args,cwd:spec.root};
        let stop=()=>{};const receipts=new Map(),saved=new Set(),observer=nativeObserver(receipts,reason=>{e.stop_reason??=reason;stop();});
        try{
          e.result=await api.qoderRun(bin,args,{cwd:spec.root,env,timeoutMs:1500000,killGraceMs:5000,killTree:true,maxBufferBytes:24*1024*1024,stopEarly:fn=>{stop=fn;},onStdoutLine:line=>{
            observer.line(line);
            for(const [id,r] of receipts)if(!saved.has(id)){appendFileSync(spec.native_receipts,JSON.stringify(r)+'\n',{mode:0o600});saved.add(id);}
          }});
          e.passed=(e.result.code===0&&!e.stop_reason||e.stop_reason?.expected===true)&&!e.result.timedOut&&!e.result.truncated;
        }finally{
          e.observed_events=observer.observed;
          e.permission_logs=await permissionLogs(config,home,nativeTools(observer.lines.join('\n')).calls.map(c=>c.id));
          e.write_receipts=[...receipts.values()];
        }
      });
      e.cli.source_unchanged=e.cli.sha256===await fileHash(source);
      e.private_home_absent=await fs.lstat(e.private_home).then(()=>false,x=>{if(x.code==='ENOENT')return true;throw x;});
    }
  }catch(err){error=err;e.error=err.message;e.passed=false;}
  finally{
    e.global_after=await globalSnapshot();e.global_unchanged=JSON.stringify(e.global_before)===JSON.stringify(e.global_after);
    e.wrapper_ledger=await fs.readFile(spec.ledger,'utf8');
    e.fixture_spec=JSON.parse(await fs.readFile(specFile,'utf8'));
    await fs.mkdir(output,{recursive:true});
    const file=path.join(output,`${mode}-${Date.now()}.json`);
    await fs.writeFile(file,guard.scrub(JSON.stringify(e,null,2)),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({file,passed:e.passed,global_unchanged:e.global_unchanged,error:e.error??null,secret_matches:guard.matchIndices}));
    if(error||!e.passed||!e.global_unchanged||guard.leaked)process.exitCode=1;
    return {file,passed:e.passed};
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==5)throw Error('用法：qoder-plan-live.mjs production-preflight|native-B <fixture-B.json> <新证据目录>');
  await live(process.argv[2],path.resolve(process.argv[3]),path.resolve(process.argv[4]));
}
