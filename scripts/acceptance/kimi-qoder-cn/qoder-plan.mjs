#!/usr/bin/env node
/** Qoder CN 命令B专用装置；候选永不安装，严格前置失败时不消耗客户端配额。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {createFixture, repo, sha} from './driver-identity.mjs';

export const topic='DriverCLI-qoder-cn-B';
export const request='/dual-review-plan 检查sum修复计划及测试边界 --topic DriverCLI-qoder-cn-B --critics gemini,glm';
const self=fileURLToPath(import.meta.url);
const readJSON=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const put=async(p,s,mode=0o600)=>{await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});await fs.writeFile(p,s,{flag:'wx',mode});};
export async function fileHash(p){try{return sha(await fs.readFile(p));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function globalSnapshot(){
  const names=['.qoder-cn/settings.json','.qoder-cn/.auth/user','.qoder-cn/.auth/machine_id','.kimi-code/config.toml','.kimi-code/credentials/kimi-code.json','.codex/config.toml','.codex/auth.json','.gemini/config/agents/trivium-critic/agent.md','.gemini/settings.json','.gemini/config/settings.json','.zcode/cli/config.json','.zcode/v2/provider_config.json'];
  return Object.fromEntries(await Promise.all([path.join(repo,'.trivium/config.yaml'),path.join(repo,'.trivium/config.local.yaml'),...names.map(n=>path.join(os.homedir(),n))].map(async p=>[p,await fileHash(p)])));
}

/** 私有user settings：绝对路径用//；Write的路径检查由Edit规则覆盖。 */
export function writeSettings(root,writes,commands,reads=[]){
  const rule=(tool,p)=>`${tool}(/${p})`;
  const paths=p=>[...new Set([p,p.startsWith('/private/var/')?p.slice(8):p.startsWith('/var/')?'/private'+p:p])];
  return {general:{enableAutoUpdate:false},permissions:{
    allow:[...writes.flatMap(p=>paths(p).map(x=>rule('Edit',x))),...reads.flatMap(p=>paths(p).map(x=>rule('Read',x))),...commands.map(c=>`Bash(${c})`)],
    deny:paths(path.join(root,'.reviews','**')).map(p=>rule('Edit',p)),
  }};
}

/** 按既有两家机制核前置；路径拒绝与Qoder专属组合准入不得移作这两家的硬门。 */
export function strictReadiness(cfg, routes, agentMatches){
  const sides=['gemini','glm'];
  return sides.map((id,i)=>{
    const probe=cfg.probe.cli[i===0?'agy':'zcode'];
    const reasons=[];
    if(!probe?.probed_at||!probe.entrypoint)reasons.push('缺少真实CLI探针');
    if(!routes[id]?.model)reasons.push('缺少本阶段模型路线');
    if(id==='gemini'&&probe?.headless_read_ok!==true)reasons.push('缺少已实测headless读取');
    if(id==='gemini'&&!agentMatches)reasons.push('只读Agent安装定义与仓库不一致');
    if(id==='glm'&&!probe?.readonly_flags?.some(x=>x.startsWith('--disallowed-tools')))reasons.push('缺少实测工具级deny参数');
    // 完整生产预检还须验证TTL、模型目录、认证和共享入口，不能由此函数代替。
    return {id,model_requested:routes[id]?.model??null,effort_requested:routes[id]?.effort??null,
      probed_at:probe?.probed_at??null,entrypoint:probe?.entrypoint??null,version:probe?.version??null,
      path_deny:probe?.path_deny??null,reasons,necessary_conditions_met:reasons.length===0,
      strict_admitted:null,production_mechanism_ready:reasons.length===0,
      native_path_denial_verified:probe?.path_deny?.file_shape_verified===true,
      model_specific_admission_required:false,
      basis:'设计10.1/10.3及ADR-002：路径deny按能力叠加；延迟归档、工具限制与事后核验承担现行职责。preflight仍为启动必要条件。'};
  });
}

/** 仅允许指定主题的命令B；不靠提示词防止扩大审核集合或代为审批。 */
export function allowed(args,spec){
  if(!Array.isArray(args)||args.some(x=>typeof x!=='string'))return false;
  if(spec.write_control)return spec.control_commands.some(command=>JSON.stringify(command)===JSON.stringify(args));
  if(args.length===2&&args[0]==='artifact'&&args[1]==='--help')return true;
  const value=k=>{const n=args.indexOf(k);return n<0?null:args[n+1];};
  for(const k of ['--topic','--stage','--driver','--critics','--entry'])if(args.filter(x=>x===k).length>1)return false;
  if(['--allow-single','--only','--worker','--cancel','--base','--skip-auth-check','--refresh-auth'].some(x=>args.includes(x)))return false;
  if(value('--topic')!==null&&value('--topic')!==spec.topic)return false;
  if(value('--stage')!==null&&value('--stage')!=='plan')return false;
  if(value('--driver')!==null&&value('--driver')!=='qoder-cn')return false;
  if(value('--critics')!==null&&value('--critics')!=='gemini,glm')return false;
  if(value('--entry')!==null&&value('--entry')!=='B')return false;
  if(args[0]==='topic')return ['claim','resolve'].includes(args[1])&&value('--stage')==='plan'&&value('--topic')===spec.topic&&value('--driver')==='qoder-cn';
  if(args[0]==='preflight')return value('--stage')==='plan'&&value('--driver')==='qoder-cn'&&value('--critics')==='gemini,glm';
  if(args[0]==='review'){
    if(args.includes('--start'))return value('--stage')==='plan'&&value('--topic')===spec.topic&&value('--driver')==='qoder-cn'&&value('--critics')==='gemini,glm'&&value('--entry')==='B';
    const op=['--wait','--status'].find(x=>args.includes(x));return !!op&&spec.run_ids?.includes(value(op));
  }
  if(args[0]==='gate')return value('--stage')==='plan'&&value('--topic')===spec.topic&&args.some(x=>['--check','--check-artifacts','--await-approval'].includes(x));
  if(args[0]==='artifact')return args.length===4&&['plan','revised'].includes(args[1])&&/^\d+$/.test(args[2])&&Number(args[2])>0;
  return false;
}

/** 专用传输规约，不是生产CLI子命令；裁决轮次取run，下一版计划取subject+1。 */
export async function artifactInput(spec,args,api){
  const task=await readJSON(path.join(spec.root,'.reviews',spec.topic,'task.json'));
  if(task.drivers?.plan?.driver!=='qoder-cn')throw Error('先认领plan再写原稿或裁决');
  const state=await readJSON(path.join(spec.root,'.trivium/state.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(state&&Object.values(state.gates??{}).some(g=>['running','awaiting_approval'].includes(g.state)))throw Error('审查进行中或人工停点后禁止归档');
  const supplied=path.resolve(spec.root,args[3]),drafts=await fs.realpath(path.join(spec.root,'drafts'));
  if(drafts!==path.join(spec.root,'drafts'))throw Error('drafts不得为符号链接');
  if(!(await fs.lstat(supplied)).isFile())throw Error('正文必须为普通暂存文件，不得为符号链接');
  const source=await fs.realpath(supplied);
  if(!source.startsWith(drafts+path.sep))throw Error('正文只可来自本夹具drafts普通文件');
  let meta=null;
  if(spec.run_ids?.length)meta=await readJSON(path.join(spec.root,'.reviews',spec.topic,'plan/_meta',`run-${spec.run_ids.at(-1)}.json`));
  const expected=args[1]==='revised'?meta?.rerun_index:meta?(meta.plan_final_check?.subject_rerun_index??meta.rerun_index)+1:1;
  if(Number(args[2])!==expected)throw Error(`轮次不符：${args[1]}应为${expected??'已有审查run的轮次'}；裁决用审查轮次，完整计划用被审对象轮次+1`);
  const kind=args[1]==='revised'?'revised':null;
  const artifacts=await api.listStageArtifacts({archiveRoot:path.join(spec.root,'.reviews'),topic:spec.topic},'plan');
  if(artifacts.some(a=>a.parsed.role==='qoder-cn'&&a.parsed.kind===kind&&a.parsed.rerunIndex===expected))throw Error('本轮工件已存在；不覆盖或自动生成额外轮次');
  const content=await fs.readFile(source,'utf8');
  return {source,content,sha256:sha(content),kind,rerunIndex:expected};
}

export async function wrapper(specFile,args){
  const spec=await readJSON(specFile),at=new Date().toISOString();
  const row={at,pid:process.pid,ppid:process.ppid,argv:args,cwd:process.cwd(),allowed:allowed(args,spec),exit_code:64,signal:null,stdout:'',stderr:''};
  try{
    if(path.resolve(process.cwd())!==spec.root)throw Error('必须在专用隔离项目执行');
    for(const [p,h] of Object.entries(spec.pins))if(await fileHash(p)!==h)throw Error('专用装置指纹变化，拒绝执行');
    if(!row.allowed)throw Error('仅授权本夹具Qoder CN命令B；审批、放弃和其它阶段均拒绝');
    const api=createRequire(import.meta.url)(spec.helper),{run,writeArtifact}=api;
    if(args[0]==='review'&&args.includes('--start')){
      const receipt=spec.preflight_receipt;
      if(!receipt||receipt.exit_code!==0||!receipt.ok||Date.now()-Date.parse(receipt.at)>3600000){row.exit_code=69;throw Error('缺少本夹具一小时内完整生产预检成功原件；未调用审核者');}
      if(spec.run_ids.length>=3){row.exit_code=69;throw Error('本批三轮预算已用尽');}
    }
    if(args[0]==='artifact'&&args[1]==='--help'){
      row.exit_code=0;row.stdout='验收专用传输（非生产CLI）：artifact plan|revised <轮次> drafts/<客户端正文.md>\n原稿plan 1；裁决revised=run.rerun_index；完整新计划plan=subject_rerun_index+1。先认领；正文必须已成功Write，失败即停止，不换写法。\n';
    }else if(args[0]==='artifact'){
      const input=await artifactInput(spec,args,api);
      row.source={path:input.source,sha256:input.sha256};
      const output=await writeArtifact({layout:{archiveRoot:path.join(spec.root,'.reviews'),topic:spec.topic},stage:'plan',role:'qoder-cn',driver:'qoder-cn',writer:'driver',kind:input.kind,rerunIndex:input.rerunIndex,content:input.content});
      row.artifact=output;
      row.exit_code=0;row.stdout=JSON.stringify(output)+'\n';
    }else{
      const env={...process.env,HOME:spec.reviewer_home,USERPROFILE:spec.reviewer_home,TRIVIUM_ASSET_ROOT:spec.assets,TRIVIUM_ENTRY_SCAN_HOME:spec.reviewer_home};
      for(const key of Object.keys(env))if(key.startsWith('TRIVIUM_STUB')||key==='NODE_OPTIONS')delete env[key];
      const r=await run(process.execPath,[spec.candidate,...args],{cwd:spec.root,env,envMode:'replace',timeoutMs:240000,killTree:true,maxBufferBytes:8*1024*1024});
      Object.assign(row,{exit_code:r.code??70,signal:r.signal,stdout:r.stdout,stderr:r.stderr,timedOut:r.timedOut,truncated:r.truncated});
      if(args[0]==='review'&&args.includes('--start')&&r.code===0){const started=JSON.parse(r.stdout);if(started.run_id){spec.run_ids.push(started.run_id);await fs.writeFile(specFile,JSON.stringify(spec,null,2));}}
      if(args[0]==='preflight'){
        const result=r.code===0?JSON.parse(r.stdout):null;
        spec.preflight_receipt={at,exit_code:r.code,ok:result?.ok===true,checks:result?.checks??null};
        // 只有生产preflight成功才能接受其写回的本地认证缓存；不改用户全局配置。
        if(result?.ok===true){const local=path.join(spec.root,'.trivium/config.local.yaml');spec.pins[local]=await fileHash(local);}
        await fs.writeFile(specFile,JSON.stringify(spec,null,2));
      }
    }
  }catch(e){row.stderr=e.message+'\n';}
  await fs.appendFile(spec.ledger,JSON.stringify(row)+'\n',{mode:0o600});
  process.stdout.write(row.stdout);process.stderr.write(row.stderr);process.exitCode=row.exit_code;
  return row;
}

export async function prepare(output){
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-qoder-plan-B-')));await fs.chmod(temp,0o700);
  const e={schema:'trivium.qoder-plan-preparation.v1',at:new Date().toISOString(),development_driver:'codex',client_driver:'qoder-cn',topic,request,candidate_only:true,candidate_installed:false,credentials_copied:0,real_client_started:false,run_id:null,gate:null};
  e.global_before=await globalSnapshot();
  try{
  const f=await createFixture(temp,'qoder-cn');
  const helper=path.join(temp,'plan-helper.cjs');
  await build({stdin:{contents:`export {loadCtx} from './src/trivium/config.ts';export {realAdapters} from './src/trivium/adapters/index.ts';export {resolveConfiguredTier,sameRequestedRoute} from './src/trivium/model-routing.ts';export {run} from './src/trivium/util/exec.ts';export {writeArtifact,listStageArtifacts} from './src/trivium/archive.ts';export {AGENTS} from './src/trivium/agents/registry.ts';export {withQoderHome,qoderRun,qoderConfigRoot} from './src/trivium/adapters/qoder-cn-native.ts';export {redactSecrets} from './src/trivium/secrets.ts';`,resolveDir:repo},outfile:helper,bundle:true,platform:'node',format:'cjs',charset:'utf8',logLevel:'silent'});
  const api=createRequire(import.meta.url)(helper),ctx=await api.loadCtx({cwd:repo}),cfg=ctx.config;
  e.baseline=(await api.run('git',['-c','core.quotePath=false','rev-parse','HEAD'],{cwd:repo})).stdout.trim();
  e.retained_predecessor=[];
  const previous=await readJSON(path.join(repo,'doc/05_testing/evidence/driver-identity-20261028/validation.json'));
  for(const prev of previous.fixtures.filter(x=>x.agent==='qoder-cn')){
    const r=await api.run('git',['-c','core.quotePath=false','rev-parse','--verify','HEAD'],{cwd:prev.root,timeoutMs:10000});
    const plan=prev.formal_pending.pending.find(x=>x.entry==='B').draft.absPath;
    e.retained_predecessor.push({root:prev.root,head:r.stdout.trim(),head_matches:r.code===0&&r.stdout.trim()===prev.head,plan_sha256:await fileHash(plan),candidate_matches:await fileHash(prev.candidate)===prev.candidate_sha256,unchanged:true});
  }
  const routes=Object.fromEntries(['gemini','glm'].map(id=>[id,api.resolveConfiguredTier(cfg,id,'plan')]));
  const installedAgent=path.join(os.homedir(),'.gemini/config/agents/trivium-critic/agent.md');
  const agentMatch=await fileHash(installedAgent)===await fileHash(path.join(repo,'skills/dual-critic/agents/trivium-critic.md'));
  e.readonly=strictReadiness(cfg,routes,agentMatch);e.strict_readonly_ready=null;
  e.account_checks=[];
  for(const id of ['gemini','glm']){
    const adapter=api.realAdapters()[id],route=routes[id],probe=cfg.probe.cli[id==='gemini'?'agy':'zcode'];
    const auth=adapter.authProbe({cfg,nodePath:process.execPath},f.root,{model:route.model,effort:route.effort,vendorProfile:route.vendorProfile});
    const fingerprint=await auth.fingerprint();
    const cache=Object.values(cfg.probe.auth_routes??{}).find(v=>v.combination?.critic===id&&v.combination?.model===route.model&&v.combination?.effort===(route.effort??null)&&v.fingerprint===fingerprint&&v.cli_version===probe.version&&v.ok===true);
    const age=cache?(Date.now()-Date.parse(cache.checked_at))/3600000:null;
    e.account_checks.push({id,route_model:route.model,version_declared:probe.version,entrypoint_sha256:await fileHash(probe.entrypoint),fingerprint,matching_cache:cache??null,cache_within_ttl:age!==null&&age>=0&&age<cfg.preflight.auth_cache_ttl_h,live_authentication:'未测；严格前置阻塞，无新增模型调用',availability:adapter.availability({cfg,nodePath:process.execPath})});
  }
  e.readonly_limits='按gemini/glm既有获准机制验B；路径deny仍false/null，不宣称硬隔离或Qoder审核者组合准入。';
  const projectCfg={schema:cfg.schema,runtime:{node:cfg.runtime.node,run_root:f.spec.run_root},archive_root:'.reviews',review:{...cfg.review,default_critics:['gemini','glm'],failure_policy:'strict',wait_timeout_s:30},profiles:cfg.profiles,agents:{gemini:cfg.agents.gemini,glm:cfg.agents.glm},probe_ttl_days:cfg.probe_ttl_days};
  // 仅复制非秘密项目配置/既有探针，不复写时间，不复制账号文件。
  await fs.writeFile(path.join(f.root,'.trivium/config.yaml'),JSON.stringify(projectCfg,null,2),{mode:0o600});
  const selectedAuth=Object.fromEntries(Object.entries(cfg.probe.auth_routes??{}).filter(([,v])=>['gemini','glm'].includes(v.combination?.critic)));
  await put(path.join(f.root,'.trivium/config.local.yaml'),JSON.stringify({probe:{generated_at:cfg.probe.generated_at,cli:{agy:cfg.probe.cli.agy,zcode:cfg.probe.cli.zcode},auth:{gemini:cfg.probe.auth?.gemini,glm:cfg.probe.auth?.glm},auth_routes:selectedAuth}},null,2));
  await put(path.join(f.root,'README.md'),'# sum隔离验收\n\nHEAD故意使用减法；工作树加法只是候选。计划为正数、负数、零和交换律增加Node内置测试；本轮不实施。\n');
  await fs.mkdir(path.join(f.root,'drafts'),{mode:0o700});
  await put(path.join(f.root,'AGENTS.md'),'# 专用Qoder CN命令B夹具\n\nDriver为qoder-cn；审核者只读，以BRIEF角色为准。正式B定义工件命名、内容与gate校验；以下artifact是验收专用传输，不是生产CLI或正式入口的必经要求。\n先认领，再阅读sum.cjs和材料，由客户端自行撰写原稿：Write到drafts/original.md，成功后运行`.trivium/bin/trivium artifact plan 1 drafts/original.md`；不预置固定正文。裁决用artifact revised加run.rerun_index（首轮1）；完整新计划用artifact plan加被审对象轮次+1（原稿1则2），两个轮次不可混同。正文只能来自drafts普通文件。artifact --help可读。\n本装置选择archive实现防覆盖与扫描，直接写归档不满足本批传输控制，但不得把该附加条件冒称产品契约。原生Write或传输失败即停止并保留，不得换Bash/tee等写法。不得改sum.cjs，不直接调审核者、Node或其它入口，不approve/abandon。预检失败停止；gate之后只await-approval并停止。\n');
  const pins=Object.fromEntries(await Promise.all([self,helper,f.candidate,path.join(f.root,'.trivium/config.yaml'),path.join(f.root,'.trivium/config.local.yaml')].map(async p=>[p,await fileHash(p)])));
  const spec={...f.spec,topic,helper,assets:path.join(repo,'skills/dual-critic'),reviewer_home:os.homedir(),ledger:path.join(temp,'formal-argv.jsonl'),run_ids:[],strict_readonly_ready:false,review_allowed:'仅本主题命令B，启动仍受严格只读前置阻塞',pins,cleanup_owner:'Codex负责凭据即时清理；无凭据候选/夹具由Bob确认使用完毕后删除独立根；未代为approve/abandon'};
  const specFile=path.join(temp,'fixture-B.json');await put(specFile,JSON.stringify(spec,null,2));
  const guard=path.join(f.root,'.trivium/bin/B-guard.cjs');
  await put(guard,`import(${JSON.stringify(pathToFileURL(self).href)}).then(m=>m.wrapper(${JSON.stringify(specFile)},process.argv.slice(2))).catch(e=>{console.error(e.message);process.exitCode=70});\n`);
  // 替换的只是本次新建夹具wrapper；历史保留夹具不修改。
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  await fs.writeFile(f.wrapper,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(guard)} "$@"\n`,{mode:0o700});
  const call=args=>api.run(f.wrapper,args,{cwd:f.root,timeoutMs:180000,killTree:true,maxBufferBytes:8*1024*1024});
  const claim=await call(['topic','claim','--topic',topic,'--stage','plan','--driver','qoder-cn','--json']);
  e.preparation_claim=claim;
  if(claim.code!==0)throw Error('B备料认领失败');
  e.original=null; // 等待真实客户端正文，备料不冒充原稿。
  // 严格前置已失败，不为取得绿色额外探活或刷新探针。未执行的预检明确留空。
  e.production_preflight={status:'未测；严格只读前置先行阻塞',exit_code:null};
  e.routes=routes;e.fixture=spec;e.spec_file=specFile;
  e.global_after=await globalSnapshot();e.global_unchanged=JSON.stringify(e.global_before)===JSON.stringify(e.global_after);
  e.account_validation='本批只读核验来源存在/hash与生产预检；未新增真实账号/模型调用，不能称为本批真实探活通过';
  e.installed_bundle_sha256=await fileHash(path.join(os.homedir(),'.claude/skills/dual-critic/scripts/trivium.cjs'));
  e.cli={entrypoint:await fs.realpath(path.join(os.homedir(),'.local/bin/qoderclicn'))};e.cli.sha256=await fileHash(e.cli.entrypoint);
  e.flags=api.AGENTS.filter(x=>['kimi','qoder-cn'].includes(x.id)).map(x=>({id:x.id,driverEnabled:x.driverEnabled,criticEnabled:x.criticEnabled,defaultSelected:x.defaultSelected}));
  e.blockers=e.readonly.flatMap(x=>x.reasons.map(reason=>({critic:x.id,reason})));
  e.blocked=e.blockers.length>0;
  e.status='备料完成；尚须本夹具生产预检。缓存过期须刷新，不判账号失效；真实B未启动。';
  e.approval_entry=null;e.pending_entry={cwd:f.root,text:request,status:'严格前置齐备之后才可执行；当前不要审批或恢复'};
  await fs.mkdir(output,{recursive:true});
  const file=path.join(output,`preparation-${Date.now()}.json`);await put(file,JSON.stringify(e,null,2));
  return {file,spec_file:specFile,fixture:f.root,blocked:e.blocked,blockers:e.blockers};
  }catch(err){
    // 无凭据装置失败也保留原件和根；不把异常目录说成已清理。
    await fs.mkdir(output,{recursive:true});
    await put(path.join(output,`apparatus-failure-${Date.now()}.json`),JSON.stringify({...e,error:err.message,retained_root:temp,cleanup_owner:'Codex负责本次无凭据装置根；失败原件保留'},null,2));
    throw err;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===self){
  if(process.argv.length>3)throw Error('只接受可选的新证据输出目录；本工具没有隐式模型启动/安装/审批选项');
  console.log(JSON.stringify(await prepare(path.resolve(process.argv[2]??path.join(repo,'doc/05_testing/evidence/qoder-plan-B-20261028'))),null,2));
}
