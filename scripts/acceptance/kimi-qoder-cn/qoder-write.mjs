#!/usr/bin/env node
/** 一次原生Write正控制；无技能入口、无审核者、无生产安装。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createFixture,repo,sha} from './driver-identity.mjs';
import {fileHash,globalSnapshot,writeSettings} from './qoder-plan.mjs';
import {nativeTools,linkRows} from './qoder-plan-audit.mjs';
import {collectCredentialValues,secretGuard} from './qoder-secrets.mjs';

const self=fileURLToPath(import.meta.url),topic='DriverWrite-qoder-cn';
const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const put=async(p,s)=>{await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});await fs.writeFile(p,s,{flag:'wx',mode:0o600});};
export async function prepareWrite(output){
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-qoder-write-')));await fs.chmod(temp,0o700);
  const f=await createFixture(temp,'qoder-cn');
  await fs.mkdir(path.join(f.root,'drafts'),{mode:0o700});
  const commands=[['topic','claim','--topic',topic,'--stage','plan','--driver','qoder-cn','--json'],['artifact','plan','1','drafts/original.md']];
  const shell=commands.map(args=>'.trivium/bin/trivium '+args.join(' '));
  const draft=path.join(f.root,'drafts/original.md');
  const settings=writeSettings(f.root,[draft],shell,[path.join(f.root,'材料.md'),path.join(f.root,'sum.cjs'),path.join(f.root,'AGENTS.md')]);
  await put(path.join(f.root,'AGENTS.md'),'# 独立写入正控制\n\n客户端Driver=qoder-cn。只读取材料并撰写自己的计划原稿；先claim，再Write到drafts/original.md，成功后才调用artifact plan 1 drafts/original.md。artifact是验收专用传输，使用生产archive实现命名、防覆盖和扫描，不是正式入口必经子命令。任何拒绝或非零即停止，不换写法、不重试；不直接写.reviews。不启动任何技能、审核者、preflight、review、gate、approve、abandon或其它CLI。不修改sum.cjs。\n');
  const specFile=path.join(temp,'write-spec.json'),guard=path.join(f.root,'.trivium/bin/write-guard.cjs');
  await put(guard,`import(${JSON.stringify(pathToFileURL(path.join(repo,'scripts/acceptance/kimi-qoder-cn/qoder-plan.mjs')).href)}).then(m=>m.wrapper(${JSON.stringify(specFile)},process.argv.slice(2))).catch(e=>{console.error(e.message);process.exitCode=70});\n`);
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  await fs.writeFile(f.wrapper,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(guard)} "$@"\n`,{mode:0o700});
  const spec={...f.spec,topic,helper:path.join(temp,'helper.cjs'),assets:path.join(repo,'skills/dual-critic'),reviewer_home:f.home,ledger:path.join(temp,'write-argv.jsonl'),run_ids:[],write_control:true,control_commands:commands,settings,draft,output:path.resolve(output),pins:{},attempted:false};
  for(const p of [self,path.join(repo,'scripts/acceptance/kimi-qoder-cn/qoder-plan.mjs'),spec.helper,f.candidate,f.wrapper,guard,path.join(f.root,'AGENTS.md'),path.join(f.root,'sum.cjs'),path.join(f.root,'材料.md'),path.join(f.root,'.trivium/config.yaml')])spec.pins[p]=await fileHash(p);
  await put(specFile,JSON.stringify(spec,null,2));
  await put(path.join(output,'preparation.json'),JSON.stringify({spec_file:specFile,root:f.root,run_root:spec.run_root,settings,commands:shell,candidate_installed:false,real_sessions:0},null,2));
  return {spec_file:specFile,root:f.root};
}

export async function realWrite(specFile){
  const spec=await json(specFile);
  if(!spec.write_control||spec.attempted)throw Error('仅全新专用写入控制；同一夹具不重试');
  for(const [p,h] of Object.entries(spec.pins))if(await fileHash(p)!==h)throw Error('指纹变化，拒绝调用');
  if(await fileHash(spec.draft)!==null)throw Error('正文已存在，拒绝调用');
  // 原件以wx预占：即使更换spec，输出目录也不能静默发起第二次会话。
  await put(path.join(spec.output,'attempt.json'),JSON.stringify({at:new Date().toISOString(),spec_file:specFile,max_sessions:1,max_turns:8,timeout_ms:180000,reviewers:0}));
  spec.attempted=true;await fs.writeFile(specFile,JSON.stringify(spec,null,2));
  const api=createRequire(import.meta.url)(spec.helper),values=[],secret=secretGuard(values,s=>api.redactSecrets(s).content);
  const e={schema:'trivium.qoder-write-control.v1',at:new Date().toISOString(),development_driver:'codex',client_driver:'qoder-cn',spec_file:specFile,root:spec.root,run_root:spec.run_root,settings:spec.settings,global_before:await globalSnapshot(),candidate_installed:false,underlying_model:null,reviewers_started:0,formal_B_started:false};
  try{
    const source=await fs.realpath(path.join(os.homedir(),'.local/bin/qoderclicn')),bin=path.join(path.dirname(specFile),'qoderclicn');
    await fs.copyFile(source,bin,fs.constants.COPYFILE_EXCL);await fs.chmod(bin,0o700);e.cli={source,sha256:await fileHash(bin)};
    for(const name of ['user','machine_id'])collectCredentialValues(await fs.readFile(path.join(process.env.QODERCN_CONFIG_DIR??path.join(os.homedir(),'.qoder-cn'),'.auth',name),'utf8'),values);
    await api.withQoderHome(async(home,config,env)=>{
      e.private_home=home;e.credentials_copied=2;
      await fs.writeFile(path.join(config,'settings.json'),JSON.stringify(spec.settings),{mode:0o600});
      e.settings_sha256=await fileHash(path.join(config,'settings.json'));
      const prompt=`这是一次独立写入正控制，不能调用任何技能或审查入口。cwd=${spec.root}。先Read项目AGENTS.md、材料.md、sum.cjs，自行写一份简短中文sum修复计划，包含你观察到的工作树行为、目标、测试和不修改业务代码的边界；正文不得复制材料作为整份原稿。只允许以下顺序：Bash执行“${spec.control_commands[0].join(' ')}”时前面加.trivium/bin/trivium；然后Write到绝对路径${spec.draft}；仅同ID Write成功后Bash执行.trivium/bin/trivium artifact plan 1 drafts/original.md。两个Bash命令按给定文字直接调用，不加cd、重定向、管道或其它命令。任何拒绝、错误、非零都立即停止，不换写法，不重试，不创建其它文件。成功后报告实际工具输出并停止。`;
      const args=['--cwd',spec.root,'--setting-sources','user','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','Read,Write,Bash','--permission-mode','dont_ask','--no-session-persistence','--max-turns','8','--max-model-request-retries','0','--output-format','stream-json','-p',prompt];
      e.command={bin,args,cwd:spec.root,env_keys:Object.keys(env).filter(k=>env[k]!==undefined)};
      e.result=await api.qoderRun(bin,args,{cwd:spec.root,env,timeoutMs:180000,killGraceMs:5000,killTree:true,maxBufferBytes:8*1024*1024});
      // 私有根删除前只提取权限决策行；不保存含认证的整个日志。
      e.permission_logs=[];
      async function logs(dir){for(const f of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory()&&f.name!=='.auth')await logs(p);else if(f.isFile()&&/\.(log|txt)$/.test(f.name)){const st=await fs.stat(p);if(st.size>8*1024*1024)continue;const lines=(await fs.readFile(p,'utf8')).split('\n').filter(x=>x.includes('[permission-check]'));if(lines.length)e.permission_logs.push({file:path.relative(home,p),lines});}}}
      await logs(config);
    });
    e.cli.source_unchanged=e.cli.sha256===await fileHash(source);
  }catch(err){e.error=err.message;}
  finally{
    e.private_home_absent=e.private_home?await fs.lstat(e.private_home).then(()=>false,x=>{if(x.code==='ENOENT')return true;throw x;}):null;
    e.global_after=await globalSnapshot();e.global_unchanged=JSON.stringify(e.global_before)===JSON.stringify(e.global_after);
    e.ledger=await fs.readFile(spec.ledger,'utf8').catch(x=>{if(x.code==='ENOENT')return '';throw x;});
    const n=nativeTools(e.result?.stdout??''),rows=e.ledger.trim()?e.ledger.trim().split('\n').map(JSON.parse):[];
    e.wrapper_pairs=linkRows(rows,n);
    const writes=n.calls.filter(c=>c.name==='Write');
    e.writes=await Promise.all(writes.map(async c=>({id:c.id,path:c.input?.file_path,content_sha256:sha(c.input?.content??''),file_sha256:await fileHash(spec.draft),result:n.results.get(c.id)??null})));
    const init=n.events.find(x=>x.subtype==='init'),result=n.events.findLast(x=>x.type==='result');
    e.native={version:init?.qodercli_version??null,cwd:init?.cwd??null,mode:init?.permissionMode??null,route:init?.model??null,billing_keys:Object.keys(result?.modelUsage??{}),credits:result?.total_credits??null,underlying_model:null,permission_denials:result?.permission_denials??[]};
    e.artifacts=[];
    for(const row of rows.filter(r=>r.artifact)){
      const bytes=await fs.readFile(row.artifact.absPath);e.artifacts.push({...row.artifact,actual_sha256:sha(bytes),source:row.source});
      await put(path.join(spec.output,'artifacts',row.artifact.fileName),secret.scrub(bytes.toString()));
    }
    e.checks={native_success:e.result?.code===0&&!e.result?.timedOut&&!e.result?.truncated&&result?.subtype==='success'&&!result?.is_error,
      exact_cwd:init?.cwd===spec.root,scoped_write:writes.length===1&&e.writes.every(w=>w.path===spec.draft&&w.result&&!w.result.error&&w.content_sha256===w.file_sha256),
      claim_and_archive:rows.length===2&&rows.every((r,i)=>r.exit_code===0&&r.cwd===spec.root&&JSON.stringify(r.argv)===JSON.stringify(spec.control_commands[i]))&&e.wrapper_pairs.every(p=>p.matched),
      content_chain:e.artifacts.length===1&&e.artifacts.every(a=>a.sha256===a.actual_sha256&&a.sha256===a.source.sha256&&a.sha256===e.writes[0]?.content_sha256),
      no_denial:e.native.permission_denials.length===0,no_review:!(await fs.readdir(spec.run_root).catch(x=>{if(x.code==='ENOENT')return [];throw x;})).length,
      credentials_cleaned:e.private_home_absent===true,global_unchanged:e.global_unchanged};
    e.passed=!e.error&&Object.values(e.checks).every(Boolean);
    const raw=secret.scrub(JSON.stringify(e,null,2));e.secret_matches=secret.matchIndices;
    await put(path.join(spec.output,'native-write.json'),raw);
    await put(path.join(spec.output,'verdict.json'),JSON.stringify({passed:e.passed,checks:e.checks,secret_matches:secret.matchIndices,formal_B_retested:false,underlying_model:null},null,2));
    if(!e.passed||secret.leaked)process.exitCode=1;
    return {passed:e.passed,checks:e.checks,error:e.error??null,output:spec.output};
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===self){
  if(process.argv.length!==4||!['prepare','real'].includes(process.argv[2]))throw Error('qoder-write.mjs prepare <新证据目录> | real <新write-spec.json>；real显式消耗一次Qoder会话');
  console.log(JSON.stringify(process.argv[2]==='prepare'?await prepareWrite(path.resolve(process.argv[3])):await realWrite(path.resolve(process.argv[3])),null,2));
}
