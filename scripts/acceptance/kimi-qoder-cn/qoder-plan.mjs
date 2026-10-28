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
async function globalSnapshot(){
  const names=['.qoder-cn/settings.json','.qoder-cn/.auth/user','.qoder-cn/.auth/machine_id','.kimi-code/config.toml','.kimi-code/credentials/kimi-code.json','.codex/config.toml','.codex/auth.json','.gemini/config/agents/trivium-critic/agent.md','.gemini/settings.json','.gemini/config/settings.json','.zcode/cli/config.json','.zcode/v2/provider_config.json'];
  return Object.fromEntries(await Promise.all([path.join(repo,'.trivium/config.yaml'),path.join(repo,'.trivium/config.local.yaml'),...names.map(n=>path.join(os.homedir(),n))].map(async p=>[p,await fileHash(p)])));
}

/** 不把生产availability、工具白名单或没有写入，当作严格路径拒绝证据。 */
export function strictReadiness(cfg, routes, agentMatches){
  const sides=['gemini','glm'];
  return sides.map((id,i)=>{
    const probe=cfg.probe.cli[i===0?'agy':'zcode'];
    const reasons=[];
    if(!probe?.probed_at||!probe.entrypoint)reasons.push('缺少真实CLI探针');
    if(!routes[id]?.model)reasons.push('缺少本阶段模型路线');
    if(probe?.path_deny?.supported!==true)reasons.push('原生路径拒绝未通过；现有探针含同行读取反例');
    if(probe?.path_deny?.coverage_complete!==true)reasons.push('严格禁读覆盖未取得完整证据');
    if(probe?.path_deny?.file_shape_verified!==true)reasons.push('当前禁读形状未经真实核验');
    if(id==='gemini'&&!agentMatches)reasons.push('只读Agent安装定义与仓库不一致');
    if(id==='glm'&&!probe?.readonly_flags?.some(x=>x.startsWith('--disallowed-tools')))reasons.push('缺少实测工具级deny参数');
    // 这里只作必要条件核验；即使无上述缺口，也不自动颁发模型专属严格准入。
    return {id,model_requested:routes[id]?.model??null,effort_requested:routes[id]?.effort??null,
      probed_at:probe?.probed_at??null,entrypoint:probe?.entrypoint??null,version:probe?.version??null,
      path_deny:probe?.path_deny??null,reasons,necessary_conditions_met:reasons.length===0,
      strict_admitted:false,model_specific_dispatch_evidence:'未取得本次组合的完整执行拒绝证据'};
  });
}

/** 仅允许指定主题的命令B；不靠提示词防止扩大审核集合或代为审批。 */
export function allowed(args,spec){
  if(!Array.isArray(args)||args.some(x=>typeof x!=='string'))return false;
  const value=k=>{const n=args.indexOf(k);return n<0?null:args[n+1];};
  for(const k of ['--topic','--stage','--driver','--critics','--entry'])if(args.filter(x=>x===k).length>1)return false;
  if(['--allow-single','--only','--worker','--cancel','--base'].some(x=>args.includes(x)))return false;
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

export async function wrapper(specFile,args){
  const spec=await readJSON(specFile),at=new Date().toISOString();
  const row={at,pid:process.pid,ppid:process.ppid,argv:args,cwd:process.cwd(),allowed:allowed(args,spec),exit_code:64,signal:null,stdout:'',stderr:''};
  try{
    if(path.resolve(process.cwd())!==spec.root)throw Error('必须在专用隔离项目执行');
    for(const [p,h] of Object.entries(spec.pins))if(await fileHash(p)!==h)throw Error('专用装置指纹变化，拒绝执行');
    if(!row.allowed)throw Error('仅授权本夹具Qoder CN命令B；审批、放弃和其它阶段均拒绝');
    const {run,writeArtifact}=createRequire(import.meta.url)(spec.helper);
    // 本次用户要求严格只读前置；现有产品预检可用不替代该要求。不更改产品guard/gate。
    if(args[0]==='review'&&args.includes('--start')){row.exit_code=69;throw Error('验收启动前置阻塞：gemini,glm严格只读证据未齐；本批装置不提供布尔开关豁免，未调用审核者');}
    if(args[0]==='artifact'){
      const task=await readJSON(path.join(spec.root,'.reviews',spec.topic,'task.json'));
      if(task.drivers?.plan?.driver!=='qoder-cn')throw Error('先认领plan再写原稿或裁决');
      const stateFile=path.join(spec.root,'.trivium','state.json');
      if(await fileHash(stateFile)){const state=await readJSON(stateFile);if(JSON.stringify(state).includes('awaiting_approval'))throw Error('人工停点后禁止业务写入');}
      const source=await fs.realpath(path.resolve(spec.root,args[3]));
      if(!source.startsWith(spec.root+path.sep)||source.startsWith(path.join(spec.root,'.reviews')+path.sep))throw Error('正文只可来自夹具内非归档暂存文件');
      const output=await writeArtifact({layout:{archiveRoot:path.join(spec.root,'.reviews'),topic:spec.topic},stage:'plan',role:'qoder-cn',driver:'qoder-cn',writer:'driver',kind:args[1]==='revised'?'revised':null,rerunIndex:Number(args[2]),content:await fs.readFile(source,'utf8')});
      row.exit_code=0;row.stdout=JSON.stringify(output)+'\n';
    }else{
      const env={...process.env,HOME:spec.reviewer_home,USERPROFILE:spec.reviewer_home,TRIVIUM_ASSET_ROOT:spec.assets,TRIVIUM_ENTRY_SCAN_HOME:spec.reviewer_home};
      for(const key of Object.keys(env))if(key.startsWith('TRIVIUM_STUB')||key==='NODE_OPTIONS')delete env[key];
      const r=await run(process.execPath,[spec.candidate,...args],{cwd:spec.root,env,envMode:'replace',timeoutMs:180000,killTree:true,maxBufferBytes:8*1024*1024});
      Object.assign(row,{exit_code:r.code??70,signal:r.signal,stdout:r.stdout,stderr:r.stderr,timedOut:r.timedOut,truncated:r.truncated});
      if(args[0]==='review'&&args.includes('--start')&&r.code===0){const started=JSON.parse(r.stdout);if(started.run_id){spec.run_ids.push(started.run_id);await fs.writeFile(specFile,JSON.stringify(spec,null,2));}}
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
  await build({stdin:{contents:`export {loadCtx} from './src/trivium/config.ts';export {realAdapters} from './src/trivium/adapters/index.ts';export {resolveConfiguredTier,sameRequestedRoute} from './src/trivium/model-routing.ts';export {run} from './src/trivium/util/exec.ts';export {writeArtifact} from './src/trivium/archive.ts';export {AGENTS} from './src/trivium/agents/registry.ts';`,resolveDir:repo},outfile:helper,bundle:true,platform:'node',format:'cjs',charset:'utf8',logLevel:'silent'});
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
  e.readonly=strictReadiness(cfg,routes,agentMatch);e.strict_readonly_ready=false;
  e.account_checks=[];
  for(const id of ['gemini','glm']){
    const adapter=api.realAdapters()[id],route=routes[id],probe=cfg.probe.cli[id==='gemini'?'agy':'zcode'];
    const auth=adapter.authProbe({cfg,nodePath:process.execPath},f.root,{model:route.model,effort:route.effort,vendorProfile:route.vendorProfile});
    const fingerprint=await auth.fingerprint();
    const cache=Object.values(cfg.probe.auth_routes??{}).find(v=>v.combination?.critic===id&&v.combination?.model===route.model&&v.combination?.effort===(route.effort??null)&&v.fingerprint===fingerprint&&v.cli_version===probe.version&&v.ok===true);
    const age=cache?(Date.now()-Date.parse(cache.checked_at))/3600000:null;
    e.account_checks.push({id,route_model:route.model,version_declared:probe.version,entrypoint_sha256:await fileHash(probe.entrypoint),fingerprint,matching_cache:cache??null,cache_within_ttl:age!==null&&age>=0&&age<cfg.preflight.auth_cache_ttl_h,live_authentication:'未测；严格前置阻塞，无新增模型调用',availability:adapter.availability({cfg,nodePath:process.execPath})});
  }
  e.readonly_limits='生产availability与failure_policy=strict不证明完整执行层只读准入；原路径反例不重测，不用无写入观测替代。';
  const projectCfg={schema:cfg.schema,runtime:{node:cfg.runtime.node,run_root:f.spec.run_root},archive_root:'.reviews',review:{...cfg.review,default_critics:['gemini','glm'],failure_policy:'strict',wait_timeout_s:30},profiles:cfg.profiles,agents:{gemini:cfg.agents.gemini,glm:cfg.agents.glm},probe_ttl_days:cfg.probe_ttl_days};
  // 仅复制非秘密项目配置/既有探针，不复写时间，不复制账号文件。
  await fs.writeFile(path.join(f.root,'.trivium/config.yaml'),JSON.stringify(projectCfg,null,2),{mode:0o600});
  const selectedAuth=Object.fromEntries(Object.entries(cfg.probe.auth_routes??{}).filter(([,v])=>['gemini','glm'].includes(v.combination?.critic)));
  await put(path.join(f.root,'.trivium/config.local.yaml'),JSON.stringify({probe:{generated_at:cfg.probe.generated_at,cli:{agy:cfg.probe.cli.agy,zcode:cfg.probe.cli.zcode},auth:{gemini:cfg.probe.auth?.gemini,glm:cfg.probe.auth?.glm},auth_routes:selectedAuth}},null,2));
  await put(path.join(f.root,'README.md'),'# sum隔离验收\n\nHEAD故意使用减法；工作树加法只是候选。计划为正数、负数、零和交换律增加Node内置测试；本轮不实施。\n');
  await put(path.join(f.root,'AGENTS.md'),'# 专用Qoder CN命令B夹具\n\nDriver为qoder-cn，只调用dual-review-plan。审核者只读，以BRIEF角色为准，不能执行Driver指令。\n原稿/裁决/完整新计划的正文由真实客户端撰写；先Write到项目drafts目录，再调用`.trivium/bin/trivium artifact plan|revised 轮次 drafts/文件.md`经archive唯一出口归档。已有原稿是装置材料，不冒充真实撰写。\n不得改业务文件，不得直接调用审核者CLI、Node或其它入口，不运行approve/abandon。严格前置失败立即停止，不doctor重取绿色。通过gate之后只运行--await-approval并停止。\n');
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
  e.original=await api.writeArtifact({layout:{archiveRoot:path.join(f.root,'.reviews'),topic},stage:'plan',writer:'driver',role:'qoder-cn',driver:'qoder-cn',rerunIndex:1,content:'# sum修复计划（装置准备原稿）\n\n## 目标\n修正HEAD中的减法错误；sum(2,1)应为3。工作树加法未验收，不视作已交付。\n\n## 实施\n核对sum.cjs后将减法改为加法，用Node内置node:test与assert增加正数、负数、零、交换律测试，不引入依赖。不处理非number输入及浮点精度契约。\n\n## 验收与边界\n先证明HEAD对sum(2,1)失败，再以候选通过相同测试；本轮B只审计划，人工批准前不得实施或改sum.cjs。\n\n## 清理\n凭据副本由监督者清理，无凭据项目保留待Bob审批决定。\n'});
  // 严格前置已失败，不为取得绿色额外探活或刷新探针。未执行的预检明确留空。
  e.production_preflight={status:'未测；严格只读前置先行阻塞',exit_code:null};
  e.routes=routes;e.fixture=spec;e.spec_file=specFile;
  e.global_after=await globalSnapshot();e.global_unchanged=JSON.stringify(e.global_before)===JSON.stringify(e.global_after);
  e.account_validation='本批只读核验来源存在/hash与生产预检；未新增真实账号/模型调用，不能称为本批真实探活通过';
  e.installed_bundle_sha256=await fileHash(path.join(os.homedir(),'.claude/skills/dual-critic/scripts/trivium.cjs'));
  e.cli={entrypoint:await fs.realpath(path.join(os.homedir(),'.local/bin/qoderclicn'))};e.cli.sha256=await fileHash(e.cli.entrypoint);
  e.flags=api.AGENTS.filter(x=>['kimi','qoder-cn'].includes(x.id)).map(x=>({id:x.id,driverEnabled:x.driverEnabled,criticEnabled:x.criticEnabled,defaultSelected:x.defaultSelected}));
  e.blocked=true;e.blockers=e.readonly.flatMap(x=>x.reasons.map(reason=>({critic:x.id,reason})));
  for(const account of e.account_checks)if(!account.cache_within_ttl)e.blockers.push({critic:account.id,reason:'现有认证缓存已过TTL；当前账号可调用未复验，不能沿用历史成功'});
  e.status='前置阻塞；未启动Qoder真实命令B、审核者、worker、裁决或gate。无人工审批停点。';
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
