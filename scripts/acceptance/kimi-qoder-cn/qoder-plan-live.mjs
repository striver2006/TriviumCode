#!/usr/bin/env node
/** 显式两步调用：production-preflight或native-B。采集器永不直接启动review。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {fileHash,globalSnapshot,request,topic} from './qoder-plan.mjs';
import {repo} from './driver-identity.mjs';
import {collectCredentialValues,secretGuard} from './qoder-secrets.mjs';

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
        e.cli.version=await api.qoderRun(bin,['--version'],{cwd:spec.root,env,timeoutMs:15000,killTree:true});
        e.model_request={route:'official-default',argv_model:null,private_settings_model:null,effective_underlying_model:null};
        const args=['--cwd',spec.root,'--add-dir',entries,'--setting-sources','user','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','Bash,Read,Write,Skill','--allowed-tools','Bash,Read,Write,Skill','--permission-mode','dont_ask','--no-session-persistence','--output-format','stream-json','-p',request];
        e.command={bin,args,cwd:spec.root};
        e.result=await api.qoderRun(bin,args,{cwd:spec.root,env,timeoutMs:1500000,killGraceMs:5000,killTree:true,maxBufferBytes:24*1024*1024});
        e.passed=e.result.code===0&&!e.result.timedOut&&!e.result.truncated;
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
