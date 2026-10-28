#!/usr/bin/env node
/** 独立身份验收。候选只在临时bundle启用；禁止正式审查、安装及审批。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {candidateRegistry,absent} from './driver-cli.mjs';
import {collectCredentialValues,secretGuard} from './qoder-secrets.mjs';

export const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export const stages=['plan','code','bug'];
const put=async(p,s,mode=0o600)=>{await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});await fs.writeFile(p,s,{mode,flag:'wx'});};
export async function helper(temp){
  const target=path.join(temp,'helper.cjs');
  await build({stdin:{contents:`export {run} from './src/trivium/util/exec.ts';export {writeArtifact,listStageArtifacts} from './src/trivium/archive.ts';export {AGENTS} from './src/trivium/agents/registry.ts';export {install} from './src/install.ts';export {withQoderHome,qoderRun} from './src/trivium/adapters/qoder-cn-native.ts';export {redactSecrets} from './src/trivium/secrets.ts';`,resolveDir:repo},outfile:target,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  return {runtime:createRequire(import.meta.url)(target),target};
}
export async function createFixture(temp,agent){
  const {runtime,target}=await helper(temp);
  if(!['kimi','qoder-cn'].includes(agent))throw Error('仅接受本轮两家候选');
  const root=path.join(temp,'中文 空格项目'),home=path.join(temp,'home'),candidate=path.join(temp,'candidate.cjs');
  const registry=path.join(repo,'src/trivium/agents/registry.ts'),source=await fs.readFile(registry,'utf8'),transformed=candidateRegistry(source,[agent]);
  await build({entryPoints:[path.join(repo,'src/trivium/cli.ts')],outfile:candidate,bundle:true,platform:'node',format:'cjs',charset:'utf8',define:{__TRIVIUM_BUILD__:'null'},plugins:[{name:'identity-candidate-only',setup(b){b.onLoad({filter:/\/agents\/registry\.ts$/},()=>({contents:transformed,loader:'ts'}));}}],logLevel:'silent'});
  const env={PATH:process.env.PATH,LANG:'en_US.UTF-8',HOME:home,USERPROFILE:home,TMPDIR:path.join(home,'tmp'),KIMI_CODE_HOME:path.join(home,'.kimi-code'),TRIVIUM_ENTRY_SCAN_HOME:home,TRIVIUM_ASSET_ROOT:path.join(repo,'skills/dual-critic')};
  await fs.mkdir(env.TMPDIR,{recursive:true,mode:0o700});
  await put(path.join(root,'.trivium/config.yaml'),`runtime:\n  run_root: ${path.join(temp,'runs')}\nreview:\n  default_critics: [gemini, glm]\n`);
  await put(path.join(root,'sum.cjs'),'exports.sum = (a,b) => a-b;\n');
  await put(path.join(root,'材料.md'),'# 隔离验收材料\n\n计划：修正sum加法并测试。\n根因：sum误用减法，sum(2,1)实际为1，期望3。\n本批不启动审查。\n');
  const run=(bin,args,childEnv=env)=>runtime.run(bin,args,{cwd:root,env:childEnv,envMode:'replace',timeoutMs:20000,killTree:true,maxBufferBytes:1024*1024});
  for(const args of [['init'],['add','sum.cjs','材料.md'],['-c','user.name=Driver Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture: isolated acceptance HEAD']]){
    const r=await run('git',['-c','core.quotePath=false',...args]);if(r.code!==0)throw Error('真实Git夹具建立失败：'+r.stderr);
  }
  const head=(await run('git',['-c','core.quotePath=false','rev-parse','HEAD'])).stdout.trim();
  // code有真实HEAD与dirty diff；它的归属标记不冒充命令C必需原稿。
  await fs.writeFile(path.join(root,'sum.cjs'),'exports.sum = (a,b) => a+b;\n');
  const topic='DriverIdentity-'+agent,ledger=path.join(root,'argv.jsonl');
  const spec={root,home,candidate,topic,agent,head,run_root:path.join(temp,'runs'),review_allowed:false,credential_copies:0,cleanup_owner:'采集器默认清理；显式keep时由Bob确认使用完毕后删除fixture.json所在独立根',candidate_sha256:sha(await fs.readFile(candidate)),registry_source_sha256:sha(source),registry_transformed_sha256:sha(transformed)};
  const guard=`const fs=require('fs'),cp=require('child_process');const spec=${JSON.stringify(spec)};const args=process.argv.slice(2);const local=args[0]==='status'||(args[0]==='topic'&&['claim','resolve'].includes(args[1]));const draft=args[0]==='fixture-draft'&&args.length===2&&['plan','code','bug'].includes(args[1]);const started=new Date().toISOString();let result={status:64,stdout:'',stderr:'Only independent local commands allowed'};async function main(){if(draft){const stage=args[1],task=JSON.parse(fs.readFileSync(spec.root+'/.reviews/'+spec.topic+'/task.json','utf8'));if(task.drivers?.[stage]?.driver!==spec.agent)throw Error('Must claim before draft');const p=await require(${JSON.stringify(target)}).writeArtifact({layout:{archiveRoot:spec.root+'/.reviews',topic:spec.topic},stage,role:spec.agent,writer:'driver',driver:spec.agent,rerunIndex:1,content:'# '+stage+' 独立归属材料\\n\\nDriver: '+spec.agent+'\\n仅用于身份验收；code标记不是正式C原稿。\\n'});result={status:0,stdout:JSON.stringify({draft:p,driver:spec.agent,stage}),stderr:''};}else if(local){result=cp.spawnSync(${JSON.stringify(process.execPath)},[spec.candidate,...args],{encoding:'utf8',env:process.env,maxBuffer:1048576});}fs.appendFileSync(${JSON.stringify(ledger)},JSON.stringify({at:started,pid:process.pid,ppid:process.ppid,argv:args,cwd:process.cwd(),allowed:local||draft,exit_code:result.status,signal:result.signal??null,stdout:result.stdout,stderr:result.stderr})+'\\n');process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??70;}main().catch(e=>{console.error(e.message);process.exitCode=70;});`;
  await put(path.join(root,'.trivium/bin/guard.cjs'),guard);
  await put(path.join(root,'.trivium/bin/trivium'),`#!/bin/sh\nexec '${process.execPath.replaceAll("'","'\\''")}' '${path.join(root,'.trivium/bin/guard.cjs').replaceAll("'","'\\''")}' "$@"\n`,0o700);
  await put(path.join(temp,'fixture.json'),JSON.stringify(spec,null,2));
  return {runtime,root,home,env,candidate,topic,ledger,spec,run,wrapper:path.join(root,'.trivium/bin/trivium')};
}

export async function inspectFixture(f){
  const rows=await fs.readFile(f.ledger,'utf8').then(s=>s.trim().split('\n').map(JSON.parse),e=>{if(e.code==='ENOENT')return [];throw e;});
  const task=await fs.readFile(path.join(f.root,'.reviews',f.topic,'task.json'),'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return null;throw e;});
  const per_stage={};
  for(const stage of stages){
    const entries=rows.filter(r=>r.argv.includes('--stage')&&r.argv[r.argv.indexOf('--stage')+1]===stage);
    const claims=entries.filter(r=>r.argv[0]==='topic'&&r.argv[1]==='claim');
    const resolve=entries.find(r=>r.argv[1]==='resolve'&&!r.argv.includes('--driver')&&r.exit_code===0);
    const draft=rows.find(r=>r.argv[0]==='fixture-draft'&&r.argv[1]===stage&&r.exit_code===0);
    const original=claims.find(r=>r.exit_code===0&&JSON.parse(r.stdout).outcome==='claimed');
    const noop=claims.find(r=>r.exit_code===0&&JSON.parse(r.stdout).outcome==='noop');
    const rejected=claims.find(r=>r.exit_code===64&&r.argv[r.argv.indexOf('--driver')+1]!==f.spec.agent);
    const files=await fs.readdir(path.join(f.root,'.reviews',f.topic,stage)).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
    const draftInfo=draft?JSON.parse(draft.stdout).draft:null;
    const bytes=draftInfo?await fs.readFile(draftInfo.absPath):null;
    per_stage[stage]={claimed:!!original&&task?.drivers?.[stage]?.driver===f.spec.agent,draft_owned:!!draft&&files.some(p=>p.endsWith('-'+f.spec.agent+'.md')),draft_readback:!!bytes&&sha(bytes)===draftInfo.sha256,inherits:!!resolve&&JSON.parse(resolve.stdout).driver===f.spec.agent,idempotent:!!original&&!!noop&&JSON.parse(original.stdout).claimed_at===JSON.parse(noop.stdout).claimed_at&&JSON.parse(original.stdout).claimed_by===JSON.parse(noop.stdout).claimed_by,wrong_identity_rejected:!!rejected,separate_cli_process:!!original&&!!resolve&&original.pid!==resolve.pid};
  }
  const blocked_help=rows.filter(r=>!r.allowed&&r.argv.length===1&&r.argv[0]==='--help'&&r.exit_code===64);
  return {rows,task,per_stage,blocked_help_count:blocked_help.length,passed:stages.every(s=>Object.values(per_stage[s]).every(Boolean))&&rows.every(r=>r.allowed||blocked_help.includes(r))};
}

/** 仅备料，不解锁wrapper，也不执行正式入口。B/D先认领再经archive写原稿。 */
export async function prepareFormal(f,temp){
  const prefix=f.spec.agent==='kimi'?'/skill:':'/',pending=[];
  for(const [entry,stage,skill,focus] of [['A','plan','dual-run','为夹具增加sum测试并修正加法'],['B','plan','dual-review-plan','检查sum修复计划及测试边界'],['C','code','dual-review-code','检查sum加法实现及测试缺口'],['D','bug','dual-review-bug','检查sum减法错误的根因']]){
    const topic=`DriverCLI-${f.spec.agent}-${entry}`;let draft=null;
    if(entry==='B'||entry==='D'){
      const claimed=await f.run(f.wrapper,['topic','claim','--topic',topic,'--stage',stage,'--driver',f.spec.agent,'--session-id','apparatus-preparation','--json']);
      if(claimed.code!==0)throw Error('待验材料认领失败');
      draft=await f.runtime.writeArtifact({layout:{archiveRoot:path.join(f.root,'.reviews'),topic},stage,role:f.spec.agent,writer:'driver',driver:f.spec.agent,rerunIndex:1,content:entry==='B'?'# sum修复计划\n\n将sum的减法改为加法；新增正数、负数及零的测试，用Node内置assert验证。验收sum(2,1)=3，sum(-2,1)=-1。\n':'# sum根因\n\nHEAD中sum(a,b)返回a-b；sum(2,1)得到1而非3，根因为运算符错误。工作树加法为候选修复，需新增回归。\n'});
    }
    pending.push({entry,stage,topic,root:f.root,run_root:f.spec.run_root,draft,explicit_text:`${prefix}${skill} ${focus} --topic ${topic}${entry==='C'?' --base HEAD':''} --critics gemini,glm`,status:'未测；wrapper仍锁定正式命令',prerequisites:['Bob另行显式调用对应入口','届时按现行准入确认gemini,glm真实路线、探针、模型/账号与冻结证据；不能缩减集合','另行准备只允许该次正式流程的可审查wrapper与私有会话；当前wrapper不可直接用于真实审查','生产Driver关闭仍是产品验收阻塞，候选实验不能写成生产通过'],acceptance:['原生入口、认领、原稿后缀、run.driver、交接options.driver与worker恢复值一致','requested_routes冻结且worker逐项核对，真实审核者指纹及模型路线齐全','审查意见逐条裁决；B/C/D在人工审批停点停止，Bob显式approve后才恢复','恢复与专用主题abandon另行显式发起，必须核实际状态和工件，不能由local结果代替']});
  }
  await put(path.join(temp,'formal-pending.json'),JSON.stringify({review_allowed:false,cleanup_owner:f.spec.cleanup_owner,pending},null,2));return pending;
}

/** 原生工具call/result同ID配对，入口内容不能用模型结论或目录名代替。 */
export function nativeChecks(result,entries,f,pass,rows=[]){
  const events=result.stdout.trim().split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean);
  const calls=[],results=new Map();
  for(const event of events){
    for(const block of event.message?.content??[]){
      if(block.type==='tool_use')calls.push(block);
      if(block.type==='tool_result')results.set(block.tool_use_id,block);
    }
    for(const c of event.tool_calls??[])if(c.type==='function'){
      let input;try{input=JSON.parse(c.function.arguments);}catch{continue;}
      calls.push({id:c.id,name:c.function.name,input});
    }
    if(event.role==='tool')results.set(event.tool_call_id,{content:event.content,is_error:typeof event.content==='string'&&/^Error:/.test(event.content)});
  }
  const loaded=entries.map(entry=>{
    const call=calls.find(c=>c.name==='Read'&&(c.input?.file_path??c.input?.path)===entry.installed&&!results.get(c.id)?.is_error&&typeof results.get(c.id)?.content==='string'&&results.get(c.id).content.includes('--driver '+f.spec.agent));
    return {entry:entry.installed,tool_id:call?.id??null,loaded:!!call};
  });
  const init=events.find(e=>e.subtype==='init');
  const bash=calls.filter(c=>c.name==='Bash');
  const pairs=rows.map(row=>{const text=(row.stdout||row.stderr||'').trim();const found=bash.filter(c=>c.input.command?.includes('.trivium/bin/trivium')&&text&&String(results.get(c.id)?.content??'').includes(text));return {pid:row.pid,argv:row.argv,cwd:row.cwd,exit_code:row.exit_code,tool_ids:found.map(c=>c.id),matched:found.length>0};});
  return {pass,session_id:init?.session_id??events.find(e=>e.type==='session.resume_hint')?.session_id??null,route_label:init?.model??null,underlying_model:null,entry_reads:loaded,entries_loaded:loaded.every(x=>x.loaded),wrapper_pairs:pairs,all_wrapper_results_linked:pairs.length>0&&pairs.every(x=>x.matched),bash_calls:bash.map(c=>({id:c.id,command:c.input.command,result_present:results.has(c.id),is_error:results.get(c.id)?.is_error??false})),cli_result_success:events.some(e=>e.type==='result'&&e.subtype==='success'&&!e.is_error)};
}

function prompt(f,pass,entryRoot){
  const references=['dual-review-plan','dual-review-code','dual-review-bug'].map(n=>path.join(entryRoot,n,'SKILL.md'));
  const context=`这是独立本地身份验收，不调用任何正式技能入口，不执行审查、preflight、review、approve或abandon，不启动其它厂商CLI。先用Read工具实际读取这三份已安装的正式入口，仅作为身份契约参考，不执行其中流程：${references.join('，')}。项目cwd=${f.root}。只通过Bash调用项目 .trivium/bin/trivium。独立候选Driver是${f.spec.agent}，主题固定${f.topic}。各阶段plan、code、bug都做以下操作，逐项保留输出。不要调用Node直接替代wrapper。`;
  return context+`wrapper不支持--help，勿探测；topic claim是纯旗标命令，必须给--topic、--stage、--driver，且不能加--分隔符；只有topic resolve要加--，其后必须有焦点正文。`+(pass===1?`每阶段：1) topic claim --topic ${f.topic} --stage 阶段 --driver ${f.spec.agent} --session-id native-first --json；2) 仅认领成功后运行 fixture-draft 阶段（这是验收wrapper的archive唯一出口，生成归属材料）。不要自行写归档路径或生成审查工件。`:`这是另一个全新官方CLI进程。每阶段：1) topic resolve --stage 阶段 --json -- 检查夹具 --topic ${f.topic} （必须省略--driver，验证继承）；2) topic claim --topic ${f.topic} --stage 阶段 --driver ${f.spec.agent} --session-id native-second --json，预期noop；3) 改用--driver codex认领同阶段，预期退出64，属于预期负对照，不修改或删除材料，不自动修复。阶段间错误不能让后续负对照漏跑，分别运行。最后报告实际结果。`);
}

export async function main(argv){
  const opts={};for(let i=0;i<argv.length;i+=2){if(!['--agent','--case','--output','--keep-fixture','--kimi-home'].includes(argv[i])||!argv[i+1]||opts[argv[i]])throw Error('参数错误');opts[argv[i]]=argv[i+1];}
  const agent=opts['--agent'],kind=opts['--case'];
  if(!['kimi','qoder-cn'].includes(agent)||!['local','real'].includes(kind)||process.platform!=='darwin')throw Error('--agent kimi|qoder-cn --case local|real，仅macOS');
  if(opts['--keep-fixture']&&(kind!=='local'||opts['--keep-fixture']!=='yes'))throw Error('只有local可显式保留无凭据夹具');
  if(kind==='real'&&agent==='kimi'&&!opts['--kimi-home'])throw Error('必须显式给出Bob已登录的私有--kimi-home；不自动读取全局认证');
  if(opts['--kimi-home']&&(agent!=='kimi'||kind!=='real'))throw Error('--kimi-home只用于Kimi真实验收');
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-driver-identity-')));await fs.chmod(temp,0o700);
  const e={schema:'trivium.driver-identity.v1',at:new Date().toISOString(),baseline:null,agent,case:kind,source_kind:kind==='real'?'real-official-model':'isolated-build-local-processes',admission:false,formal_review:'未测；未启动',windows:'未测',commands:[],script_sha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),roots:[temp]};
  let f,error;const values=[],guard=secretGuard(values);
  const globals=agent==='kimi'?['config.toml','credentials/kimi-code.json','region'].map(p=>path.join(opts['--kimi-home']??path.join(os.homedir(),'.kimi-code'),p)):['settings.json','.auth/user','.auth/machine_id'].map(p=>path.join(process.env.QODERCN_CONFIG_DIR??path.join(os.homedir(),'.qoder-cn'),p));
  const snapshot=async()=>Object.fromEntries(await Promise.all(globals.map(async p=>[p.replace(os.homedir(),'~'),await fs.readFile(p).then(sha,e=>{if(e.code==='ENOENT')return null;throw e;})])));
  try{
    e.global_before=await snapshot();f=await createFixture(temp,agent);e.fixture=f.spec;
    const baseline=await f.runtime.run('git',['-c','core.quotePath=false','rev-parse','HEAD'],{cwd:repo,timeoutMs:10000});
    if(baseline.code!==0)throw Error('无法读取开发仓库基线');e.baseline=baseline.stdout.trim();
    if(kind==='local'){
      for(const stage of stages){
        const args=['topic','claim','--topic',f.topic,'--stage',stage,'--driver',agent,'--session-id','local-first','--json'];
        const disabled=await f.run(process.execPath,[path.join(repo,'skills/dual-critic/scripts/trivium.cjs'),...args]);
        if(disabled.code!==64)throw Error('生产未拒绝关闭Driver');
        for(const a of [args,['fixture-draft',stage],['topic','resolve','--stage',stage,'--json','--','检查夹具','--topic',f.topic],args,args.map(x=>x===agent?'codex':x)]){
          const r=await f.run(f.wrapper,a);e.commands.push({args:a,...r});
        }
      }
    }else if(agent==='kimi'){
      const sourceRoot=await fs.realpath(opts['--kimi-home']);
      if(sourceRoot===await fs.realpath(path.join(os.homedir(),'.kimi-code')))throw Error('拒绝把全局Kimi根当作Bob私有登录根');
      const credential=JSON.parse(await fs.readFile(globals[1],'utf8'));if(!credential.access_token&&!credential.refresh_token)throw Error('私有OAuth仍无凭据');
      for(const p of globals.slice(0,2))collectCredentialValues((await fs.readFile(p)).toString(),values);
      const configRoot=f.env.KIMI_CODE_HOME;
      await fs.mkdir(path.join(configRoot,'credentials'),{recursive:true,mode:0o700});
      for(const name of ['config.toml','credentials/kimi-code.json','region','device_id']){const b=await fs.readFile(path.join(sourceRoot,name)).catch(err=>{if(err.code==='ENOENT')return null;throw err;});if(b)await fs.writeFile(path.join(configRoot,name),b,{mode:0o600,flag:'wx'});}
      e.authentication_permissions={mode:(await fs.stat(path.join(configRoot,'credentials/kimi-code.json'))).mode&0o777,source_root:sourceRoot,source_kind:'Bob-explicit-private-native-login',access_token_present:!!credential.access_token,refresh_token_present:!!credential.refresh_token};
      await f.runtime.install(repo,{home:f.home,env:{...f.env,TRIVIUM_ASSET_ROOT:path.join(f.home,'runtime')}},{only:[agent]});
      const entryRoot=path.join(configRoot,'skills');e.entries=[];
      for(const name of ['dual-review-plan','dual-review-code','dual-review-bug','dual-status']){const installed=path.join(entryRoot,name,'SKILL.md');e.entries.push({name,installed,sha256:sha(await fs.readFile(installed)),source_sha256:sha(await fs.readFile(path.join(repo,'skills/dual-critic/entry',agent,name,'SKILL.md')))});}
      const source=await fs.realpath(path.join(os.homedir(),'.kimi-code/bin/kimi')),bin=path.join(temp,'kimi');await fs.copyFile(source,bin);await fs.chmod(bin,0o700);e.cli={source,sha256:sha(await fs.readFile(bin))};
      const v=await f.run(bin,['--version']);e.cli.version=v.stdout.trim();
      const statusArgs=['--output-format','stream-json','-p',`/skill:dual-status --topic ${f.topic} --json`];
      const status=await f.runtime.run(bin,statusArgs,{cwd:f.root,env:f.env,envMode:'replace',timeoutMs:120000,killGraceMs:2000,killTree:true,maxBufferBytes:4*1024*1024});
      e.commands.push({pass:'status',bin,args:statusArgs,cwd:f.root,model_request:'私有官方managed默认，原生OAuth引用；不转静态key',effective_underlying_model:null,...status});
      if(status.code!==0||status.timedOut||status.truncated)throw Error('Kimi真实status未完整退出');
      for(const pass of [1,2]){
        const p=prompt(f,pass,entryRoot),args=['--output-format','stream-json','-p',p];
        const r=await f.runtime.run(bin,args,{cwd:f.root,env:f.env,envMode:'replace',timeoutMs:180000,killGraceMs:2000,killTree:true,maxBufferBytes:4*1024*1024});e.commands.push({pass,bin,args,cwd:f.root,model_request:'私有官方managed默认，原生OAuth引用',effective_underlying_model:null,...r});
        if(r.code!==0||r.timedOut||r.truncated)throw Error('Kimi真实身份进程未完整退出');
        const observation=await inspectFixture(f);
        e.native_checks??=[];e.native_checks.push(nativeChecks(r,e.entries.filter(x=>x.name!=='dual-status'),f,pass,pass===1?observation.rows.filter(x=>x.argv[0]!=='status'):observation.rows.slice(e.first_pass.rows.length)));
        if(!e.native_checks.at(-1).entries_loaded)throw Error('Kimi入口读取未形成同ID成功结果');
        if(pass===1){e.first_pass=observation;if(!stages.every(s=>observation.per_stage[s].claimed&&observation.per_stage[s].draft_owned))throw Error('Kimi首进程认领/归属材料不齐');}
      }
      e.cli.source_unchanged=sha(await fs.readFile(source))===e.cli.sha256;
    }else{
      for(const p of globals.slice(1))collectCredentialValues((await fs.readFile(p)).toString(),values);
      const source=await fs.realpath(path.join(os.homedir(),'.local/bin/qoderclicn')),bin=path.join(temp,'qoderclicn');await fs.copyFile(source,bin);await fs.chmod(bin,0o700);
      e.cli={source,sha256:sha(await fs.readFile(bin))};
      await f.runtime.withQoderHome(async(home,config,env)=>{
        e.roots.push(home);env.TRIVIUM_ASSET_ROOT=f.env.TRIVIUM_ASSET_ROOT;env.TRIVIUM_ENTRY_SCAN_HOME=home;
        await f.runtime.install(repo,{home,env:{...env,TRIVIUM_ASSET_ROOT:path.join(home,'runtime')}},{only:[agent]});
        const entryRoot=path.join(config,'skills');e.entries=[];
        for(const name of ['dual-review-plan','dual-review-code','dual-review-bug']){const installed=path.join(entryRoot,name,'SKILL.md');e.entries.push({name,installed,sha256:sha(await fs.readFile(installed)),source_sha256:sha(await fs.readFile(path.join(repo,'skills/dual-critic/entry',agent,name,'SKILL.md')))});}
        e.authentication_permissions=await Promise.all(globals.slice(1).map(async p=>{const file=path.join(config,'.auth',path.basename(p));return {file,mode:(await fs.stat(file)).mode&0o777};}));
        const version=await f.runtime.qoderRun(bin,['--version'],{cwd:f.root,env,timeoutMs:15000,killTree:true});e.cli.version=version.stdout.trim();
        for(const pass of [1,2]){
          const p=prompt(f,pass,entryRoot),args=['--cwd',f.root,'--add-dir',entryRoot,'--setting-sources','user','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','Bash,Read','--allowed-tools','Bash,Read','--permission-mode','dont_ask','--no-session-persistence','--output-format','stream-json','-p',p];
          const result=await f.runtime.qoderRun(bin,args,{cwd:f.root,env,timeoutMs:180000,killGraceMs:2000,killTree:true,maxBufferBytes:4*1024*1024});
          e.commands.push({pass,bin,args,cwd:f.root,model_request:'官方默认；未传--model；私有settings未声明model',effective_underlying_model:null,...result});
          if(result.code!==0||result.timedOut||result.truncated)throw Error('真实CLI未完整退出，不启动后续进程');
          const observation=await inspectFixture(f);
          e.native_checks??=[];e.native_checks.push(nativeChecks(result,e.entries,f,pass,pass===1?observation.rows:observation.rows.slice(e.first_pass.rows.length)));
          if(!e.native_checks.at(-1).entries_loaded)throw Error('入口读取没有成功的同ID工具结果，停止后续调用');
          if(pass===1){e.first_pass=observation;if(!stages.every(s=>e.first_pass.per_stage[s].claimed&&e.first_pass.per_stage[s].draft_owned))throw Error('首进程认领/材料不齐，不重复提示');}
        }
      });
      e.cli.source_unchanged=sha(await fs.readFile(source))===e.cli.sha256;
    }
    e.observation=await inspectFixture(f);e.passed=e.observation.passed;
    if(opts['--keep-fixture']==='yes')e.formal_pending=await prepareFormal(f,temp);
    e.registry_unchanged=sha(await fs.readFile(path.join(repo,'src/trivium/agents/registry.ts')))===f.spec.registry_source_sha256;
    if(opts['--keep-fixture']==='yes')e.retained_fixture=f.spec;
  }catch(err){error=err;e.error=err.message;}
  finally{
    e.global_after=await snapshot();e.global_unchanged=JSON.stringify(e.global_before)===JSON.stringify(e.global_after);
    if(!e.retained_fixture)await fs.rm(temp,{recursive:true,force:true});
    e.cleanup=await Promise.all(e.roots.map(async p=>({path:p,absent:await absent(p),intentionally_retained:!!e.retained_fixture&&p===temp})));
    const output=path.resolve(opts['--output']??path.join(repo,'doc/05_testing/evidence/driver-identity-20261028'));await fs.mkdir(output,{recursive:true});
    const file=path.join(output,`${agent}-${kind}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);
    const content=f?.runtime.redactSecrets(guard.scrub(JSON.stringify(e,null,2))).content??guard.scrub(JSON.stringify(e,null,2));
    await fs.writeFile(file,content,{flag:'wx',mode:0o600});
    console.log(JSON.stringify({file,passed:e.passed??false,error:e.error??null,global_unchanged:e.global_unchanged,cleanup:e.cleanup,secret_matches:guard.matchIndices}));
    if(error||!e.passed||!e.global_unchanged||guard.leaked||!e.cleanup.every(x=>x.absent||x.intentionally_retained))process.exitCode=1;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
