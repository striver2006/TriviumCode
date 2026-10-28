#!/usr/bin/env node
/** 只读非敏感认证核验；私有原生请求不登录、不刷新全局文件。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {helper,repo,sha} from './driver-identity.mjs';
import {absent} from './driver-cli.mjs';
import {collectCredentialValues,secretGuard} from './qoder-secrets.mjs';

const home=path.resolve(process.env.KIMI_CODE_HOME??path.join(os.homedir(),'.kimi-code'));
const output=path.join(repo,'doc/05_testing/evidence/driver-identity-20261028');
async function snapshot(){const result={};for(const name of ['config.toml','credentials/kimi-code.json','region','device_id']){result[name]=await fs.readFile(path.join(home,name)).then(sha,e=>{if(e.code==='ENOENT')return null;throw e;});}return result;}
export async function authFacts(){
  const config=await fs.readFile(path.join(home,'config.toml'),'utf8');
  const token=JSON.parse(await fs.readFile(path.join(home,'credentials/kimi-code.json'),'utf8'));
  const facts={source_root:home,managed_provider:/\[providers\."managed:kimi-code"\]/.test(config),oauth_file:/storage\s*=\s*"file"/.test(config),oauth_key:/key\s*=\s*"oauth\/kimi-code"/.test(config),access_token_present:!!token.access_token,refresh_token_present:!!token.refresh_token,expires_at:token.expires_at,inline_key_present:[...config.matchAll(/^\s*api_key\s*=\s*"([^"]*)"/gm)].some(m=>!!m[1]),api_key_env_declared:/^\s*api_key_env\s*=/m.test(config),auth_env_present:Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(KIMI|MOONSHOT)_/.test(k)).map(([k,v])=>[k,!!v]))};
  return {facts,config,token};
}
async function main(){
  const e={schema:'trivium.kimi-native-auth.v1',at:new Date().toISOString(),script_sha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),admission:false,login_executed:false,real_model_success:false,commands:[],source_kind:'official-native-real-endpoint-request'};
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-kimi-auth-')));await fs.chmod(temp,0o700);
  const values=[],guard=secretGuard(values);let runtime;
  try{
    e.global_before=await snapshot();const auth=await authFacts();e.facts=auth.facts;
    collectCredentialValues(JSON.stringify(auth.token),values);
    // 只支持当前已核清的官方file OAuth配置；不自动转成静态key，不读取Keychain或其它产品认证。
    if(!auth.facts.managed_provider||!auth.facts.oauth_file||!auth.facts.oauth_key||auth.facts.inline_key_present||auth.facts.api_key_env_declared)throw Error('认证形状与当前已核验原生file OAuth不符，停止复制');
    ({runtime}=await helper(temp));
    const privateHome=path.join(temp,'home'),configRoot=path.join(privateHome,'.kimi-code');await fs.mkdir(path.join(configRoot,'credentials'),{recursive:true,mode:0o700});
    for(const name of ['config.toml','credentials/kimi-code.json','region','device_id']){
      const b=await fs.readFile(path.join(home,name)).catch(err=>{if(err.code==='ENOENT')return null;throw err;});
      if(b)await fs.writeFile(path.join(configRoot,name),b,{mode:0o600,flag:'wx'});
    }
    const bin=path.join(temp,'kimi'),source=await fs.realpath(path.join(os.homedir(),'.kimi-code/bin/kimi'));await fs.copyFile(source,bin);await fs.chmod(bin,0o700);
    e.cli={source,sha256:sha(await fs.readFile(bin))};
    const env={PATH:process.env.PATH,LANG:'en_US.UTF-8',HOME:privateHome,USERPROFILE:privateHome,KIMI_CODE_HOME:configRoot,TMPDIR:temp};
    for(const args of [['--version'],['--output-format','stream-json','-p','只回复 AUTH_CHECK_OK，不调用工具，不修改任何文件。']]){
      const r=await runtime.run(bin,args,{cwd:temp,env,envMode:'replace',timeoutMs:30000,killTree:true,killGraceMs:2000,maxBufferBytes:1024*1024});e.commands.push({bin,args,cwd:temp,...r});
    }
    e.cli.source_unchanged=sha(await fs.readFile(source))===e.cli.sha256;
    e.private_auth_permissions=(await fs.stat(path.join(configRoot,'credentials/kimi-code.json'))).mode&0o777;
    e.result='按真实原生错误判读，不凭空token推断其它认证方式不可用';
    // 新的无凭据目录仅供Bob自行登录，绝不复制原token或主动运行login。
    const loginRoot=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-kimi-driver-login-')));await fs.chmod(loginRoot,0o700);
    const loginHome=path.join(loginRoot,'home'),loginConfig=path.join(loginHome,'.kimi-code');await fs.mkdir(loginConfig,{recursive:true,mode:0o700});
    await fs.writeFile(path.join(loginConfig,'config.toml'),auth.config,{mode:0o600,flag:'wx'});
    await fs.writeFile(path.join(loginRoot,'README.txt'),'仅供Bob操作官方私有登录。无凭据副本；完成后告知Codex此根路径，继续真实模型验收。使用结束后由Codex核对进程并删除本根。不代表正式审查就绪。\n',{mode:0o600});
    const prefix=`env -i PATH='/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin' LANG=en_US.UTF-8 HOME='${loginHome}' USERPROFILE='${loginHome}' KIMI_CODE_HOME='${loginConfig}' TMPDIR='${loginRoot}' '${source}'`;
    e.login_environment={root:loginRoot,home:loginHome,kimi_code_home:loginConfig,credential_copies:0,cleanup_owner:'Codex在Bob完成后续验收后清理；等待登录期间有意保留',login_command:prefix+' login --region mainland-cn',verify_command:prefix+" --output-format stream-json -p '只回复 AUTH_CHECK_OK，不调用工具，不修改文件。'"};
    for(const [name,command]of [['login.sh',e.login_environment.login_command],['verify.sh',e.login_environment.verify_command]])await fs.writeFile(path.join(loginRoot,name),'#!/bin/sh\n'+command+'\n',{flag:'wx',mode:0o700});
  }catch(err){e.error=err.message;process.exitCode=1;}
  finally{
    await fs.rm(temp,{recursive:true,force:true});e.private_request_root={path:temp,absent:await absent(temp)};e.global_after=await snapshot();e.global_unchanged=JSON.stringify(e.global_before)===JSON.stringify(e.global_after);
    await fs.mkdir(output,{recursive:true});const file=path.join(output,`kimi-auth-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);const content=guard.scrub(JSON.stringify(e,null,2));await fs.writeFile(file,runtime?.redactSecrets(content).content??content,{flag:'wx',mode:0o600});
    console.log(JSON.stringify({file,facts:e.facts,login_environment:e.login_environment,error:e.error??null,global_unchanged:e.global_unchanged,private_request_root:e.private_request_root}));
    if(!e.global_unchanged||guard.leaked||!e.private_request_root.absent)process.exitCode=1;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
