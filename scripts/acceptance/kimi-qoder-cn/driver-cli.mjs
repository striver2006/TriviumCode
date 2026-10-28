#!/usr/bin/env node
/** macOS Driver 独立验收。不得运行审查、审批或安装候选开关产物。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {collectCredentialValues,secretGuard} from './qoder-secrets.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const names=['dual-run','dual-review-plan','dual-review-code','dual-review-bug','dual-approve','dual-status','dual-abandon'];
export const shellQuote=s=>`'${s.replaceAll("'","'\\''")}'`;
/** 两种原生发现目录格式；不以 includes(name) 代替数量及来源核验。 */
export function discoveryRows(text){
  const rows=[];
  const re=/(?:^- ([\w-]+):[^\n]*\n\s+Path:\s+([^\n]+)|^([\w-]+) \[Enabled\]\n\s+Description:[^\n]*\n\s+Location:\s+([^\n]+))/gm;
  for(const m of text.matchAll(re))rows.push({name:m[1]??m[3],source:(m[2]??m[4]).trim()});
  return rows;
}
export function catalogMatches(rows,entries){
  const canonical=p=>p.replace(/^\/private\/var\//,'/var/');
  return entries.length===7&&entries.every(e=>{const found=rows.filter(r=>r.name===e.name);return found.length===1&&canonical(found[0].source)===canonical(e.installed);});
}
export function candidateRegistry(source,ids){
  let count=0;
  const result=source.replace(/(\n  \{\n    id: '([^']+)',)([\s\S]*?)(\n  \},)/g,(all,prefix,id,body,end)=>{
    if(!ids.includes(id))return all;
    if((body.match(/\bdriverEnabled: false/g)??[]).length!==1)throw Error('候选开关形状不符');
    count++;return prefix+body.replace('driverEnabled: false','driverEnabled: true')+end;
  });
  if(count!==ids.length||!count)throw Error('候选变换数量不符，拒绝构建');
  return result;
}
export async function absent(p){try{await fs.lstat(p);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
async function put(p,s,mode=0o600){await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});await fs.writeFile(p,s,{mode});}

export async function main(argv){
  const opts={};
  for(let i=0;i<argv.length;i+=2){if(!['--agent','--case','--output','--bin','--keep-fixture'].includes(argv[i])||!argv[i+1]||opts[argv[i]])throw Error('参数：--agent kimi|qoder-cn --case discover|status|local|collision [--output 目录] [--bin 官方CLI] [--keep-fixture yes]');opts[argv[i]]=argv[i+1];}
  const agent=opts['--agent'],kind=opts['--case'];
  if(!['kimi','qoder-cn'].includes(agent)||!['discover','status','local','collision'].includes(kind)||process.platform!=='darwin')throw Error('仅 macOS 两家 CLI 独立验收；未知参数拒绝');
  if(opts['--keep-fixture']!==undefined&&(opts['--keep-fixture']!=='yes'||kind!=='local'))throw Error('仅local无凭据夹具允许--keep-fixture yes');
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-driver-cli-')));await fs.chmod(temp,0o700);
  const values=[],guard=secretGuard(values);
  const evidence={schema:'trivium.driver-cli-experiment.v1',at:new Date().toISOString(),agent,case:kind,platform:process.platform,arch:process.arch,admission:false,production_driver_enabled:false,review_started:false,approval_started:false,windows:'未测',commands:[],requests:[],global_before:{},global_after:{},roots:[temp],checks:{},script_sha256:hash(await fs.readFile(fileURLToPath(import.meta.url)))};
  const globals=agent==='kimi'?[path.join(os.homedir(),'.kimi-code/config.toml'),path.join(os.homedir(),'.kimi-code/credentials/kimi-code.json')]:['settings.json','.auth/user','.auth/machine_id'].map(p=>path.join(process.env.QODERCN_CONFIG_DIR??path.join(os.homedir(),'.qoder-cn'),p));
  async function snapshot(){return Object.fromEntries(await Promise.all(globals.map(async p=>[p.replace(os.homedir(),'~'),await fs.readFile(p).then(hash,e=>{if(e.code==='ENOENT')return null;throw e;})])));}
  let runtime,server,failure;
  try{
    evidence.global_before=await snapshot();
    await build({stdin:{contents:`export {run} from './src/trivium/util/exec.ts';export {writeArtifact} from './src/trivium/archive.ts';export {AGENTS,entrySkillRootOf} from './src/trivium/agents/registry.ts';export {install,checkInstall,planInstall} from './src/install.ts';export {withQoderHome,qoderRun} from './src/trivium/adapters/qoder-cn-native.ts';export {redactSecrets} from './src/trivium/secrets.ts';`,resolveDir:repo},bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'helper.cjs'),logLevel:'silent'});
    runtime=createRequire(import.meta.url)(path.join(temp,'helper.cjs'));
    const descriptor=runtime.AGENTS.find(a=>a.id===agent);
    const root=path.join(temp,'中文 空格项目'),home=path.join(temp,'home');
    await put(path.join(root,'.trivium/config.yaml'),`runtime:\n  run_root: ${path.join(temp,'runs')}\nreview:\n  default_critics: [gemini, glm]\n`);
    await fs.mkdir(path.join(root,'.git'));
    const env={PATH:process.env.PATH,LANG:'en_US.UTF-8',HOME:home,USERPROFILE:home,TMPDIR:path.join(home,'tmp'),KIMI_CODE_HOME:path.join(home,'.kimi-code'),TRIVIUM_ENTRY_SCAN_HOME:home,TRIVIUM_ASSET_ROOT:path.join(repo,'skills/dual-critic')};
    await fs.mkdir(env.TMPDIR,{recursive:true,mode:0o700});
    async function execute(bin,args,childEnv=env,cwd=root){
      if(evidence.commands.length>=16)throw Error('启动预算16已达');
      const r=await runtime.run(bin,args,{cwd,env:childEnv,envMode:'replace',timeoutMs:90000,killGraceMs:2000,killTree:true,maxBufferBytes:2*1024*1024});
      evidence.commands.push({bin,args,cwd,...r});return r;
    }
    const gitInit=await execute('git',['-c','core.quotePath=false','init']);
    if(gitInit.code!==0)throw Error('私有git夹具初始化失败');
    const bundle=path.join(repo,'skills/dual-critic/scripts/trivium.cjs');
    evidence.production_bundle_sha256=hash(await fs.readFile(bundle));
    // wrapper 是项目夹具的限制，不宣称厂商沙箱；不允许触发任何审核者。
    const ledger=path.join(root,'argv.jsonl');
    await put(path.join(root,'.trivium/bin/guard.cjs'),`const fs=require('fs'),cp=require('child_process');const a=process.argv.slice(2);const ok=a[0]==='status'||(a[0]==='topic'&&['claim','resolve'].includes(a[1]));const r=ok?cp.spawnSync(${JSON.stringify(process.execPath)},[process.env.TRIVIUM_DRIVER_TEST_BUNDLE||${JSON.stringify(bundle)},...a],{stdio:'inherit',env:process.env}):{status:64};fs.appendFileSync(${JSON.stringify(ledger)},JSON.stringify({argv:a,cwd:process.cwd(),allowed:ok,exit_code:r.status??70})+'\\n');process.exit(r.status??70);`);
    await put(path.join(root,'.trivium/bin/trivium'),`#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(root,'.trivium/bin/guard.cjs'))} "$@"\n`,0o700);
    const topic="中文 空格 O'Bob $HOME `literal` --尾";
    evidence.expected={topic,cwd:root,status_argv:['status','--topic',topic,'--json']};
    async function installEntries(targetHome,targetEnv){
      const family=runtime.entrySkillRootOf(descriptor,targetHome,targetEnv);
      await fs.mkdir(family.familyRoot,{recursive:true});
      // 使用生产安装器；运行时与入口只落私有home，不安装临时启用产物。
      await runtime.install(repo,{home:targetHome,env:{...targetEnv,TRIVIUM_ASSET_ROOT:path.join(targetHome,'runtime')}},{only:[agent]});
      const entries=[];
      for(const name of names){const installed=path.join(family.skillsRoot,name,'SKILL.md'),source=path.join(repo,'skills/dual-critic/entry',agent,name,'SKILL.md');entries.push({name,installed,sha256:hash(await fs.readFile(installed)),source,source_sha256:hash(await fs.readFile(source))});}
      evidence.entries=entries;return family;
    }
    async function collisionFixtures(targetHome){
      await put(path.join(targetHome,'.agents/skills/dual-status/SKILL.md'),'---\nname: dual-status\ndescription: SYNTHETIC_SHARED_COLLISION\n---\nSYNTHETIC_SHARED_COLLISION\n');
      await put(path.join(targetHome,'.agents/skills/driver-shared-sentinel/SKILL.md'),'---\nname: driver-shared-sentinel\ndescription: SYNTHETIC_SHARED_DISCOVERY\n---\nOnly a discovery marker.\n');
      await put(path.join(root,'.agents/skills/dual-status/SKILL.md'),'---\nname: dual-status\ndescription: SYNTHETIC_PROJECT_COLLISION\n---\nOnly a discovery marker.\n');
      const plan=await runtime.planInstall(repo,{home:targetHome,env:{HOME:targetHome,KIMI_CODE_HOME:path.join(targetHome,'.kimi-code'),TRIVIUM_ASSET_ROOT:path.join(targetHome,'runtime')}});
      evidence.collision_problems=(await runtime.checkInstall(plan.targets.filter(t=>t.agent===agent),plan.runtimeRoot)).filter(p=>p.agent===agent);
      evidence.checks.collision_rejected=evidence.collision_problems.length>0;
    }
    if(kind==='local'){
      evidence.source_kind='isolated-build-local-processes';evidence.real_model=false;
      const registry=path.join(repo,'src/trivium/agents/registry.ts'),source=await fs.readFile(registry,'utf8');
      const ids=runtime.AGENTS.filter(a=>!a.driverEnabled).map(a=>a.id);
      const candidate=path.join(temp,'candidate.cjs');
      await build({entryPoints:[path.join(repo,'src/trivium/cli.ts')],outfile:candidate,bundle:true,platform:'node',format:'cjs',charset:'utf8',define:{__TRIVIUM_BUILD__:'null'},plugins:[{name:'private-driver-candidates',setup(b){b.onLoad({filter:/\/agents\/registry\.ts$/},()=>({contents:candidateRegistry(source,ids),loader:'ts'}));}}],logLevel:'silent'});
      evidence.registry={source_sha256:hash(source),transformed_sha256:hash(candidateRegistry(source,ids)),only_driver_enabled_ids:ids,source_unchanged:hash(await fs.readFile(registry))===hash(source)};
      evidence.candidate_bundle_sha256=hash(await fs.readFile(candidate));
      const base=['topic','claim','--topic',topic,'--stage','plan','--driver',agent,'--session-id','driver-local-test','--json'];
      const production=await execute(process.execPath,[bundle,...base]);
      env.TRIVIUM_DRIVER_TEST_BUNDLE=candidate;
      const claimed=await execute(path.join(root,'.trivium/bin/trivium'),base);
      const claimedJson=JSON.parse(claimed.stdout);
      // 已认领才写原稿，只经archive出口；仅属于随后销毁的本地夹具。
      evidence.draft=await runtime.writeArtifact({layout:{archiveRoot:path.join(root,'.reviews'),topic:claimedJson.topic},stage:'plan',role:agent,writer:'driver',driver:agent,rerunIndex:1,content:'# 独立Driver夹具\n\n仅验证认领继承，不发起审查。\n'});
      const resolved=await execute(path.join(root,'.trivium/bin/trivium'),['topic','resolve','--entry','B','--stage','plan','--json','--','焦点 $原样 --中文','--topic',topic]);
      const noop=await execute(path.join(root,'.trivium/bin/trivium'),base);
      const task=JSON.parse(await fs.readFile(path.join(root,'.reviews',claimedJson.topic,'task.json'),'utf8'));
      evidence.task=task;
      evidence.checks={production_rejects_disabled:production.code===64,claim:claimed.code===0&&task.drivers?.plan?.driver===agent,second_process_inherits:resolved.code===0&&JSON.parse(resolved.stdout).driver===agent,claim_idempotent:noop.code===0&&JSON.parse(noop.stdout).outcome==='noop',registry_unchanged:evidence.registry.source_unchanged};
      evidence.review_worker_handoff='未测；本批只验CLI进程间认领继承';
      if(opts['--keep-fixture']==='yes'){
        evidence.retained_fixture={root,candidate,production_bundle:bundle,credential_copies:0,review_allowed:false};
        await put(path.join(temp,'fixture.json'),JSON.stringify({agent,root,candidate,topic:claimedJson.topic,checks:evidence.checks,review_allowed:false,commands:{status:['.trivium/bin/trivium','status','--json'],resolve:['.trivium/bin/trivium','topic','resolve','--stage','plan','--json','--','焦点 $原样 --中文','--topic',claimedJson.topic]},pending:['正式入口授权后再准备可审查wrapper、私有客户端认证及真实预检；不要自行更改当前只允许本地命令的wrapper。','A/B/C/D、worker handoff、裁决、人工停点、恢复及放弃未测。']},null,2));
      }
    }else{
      const sourceBin=await fs.realpath(opts['--bin']??path.join(os.homedir(),agent==='kimi'?'.kimi-code/bin/kimi':'.local/bin/qoderclicn'));
      const bin=path.join(temp,'native');await fs.copyFile(sourceBin,bin);await fs.chmod(bin,0o700);
      evidence.cli={source:sourceBin,sha256:hash(await fs.readFile(bin))};
      const version=await execute(bin,['--version']);evidence.cli.version=version.stdout.trim();
      if(agent==='qoder-cn'){
        evidence.source_kind=kind==='status'?'real-official-model':'native-cli-no-model';evidence.real_model=kind==='status';
        if(kind==='status')for(const p of globals.slice(1))collectCredentialValues((await fs.readFile(p)).toString(),values);
        await runtime.withQoderHome(async(qhome,config,qenv)=>{
          evidence.roots.push(qhome);await installEntries(qhome,qenv);
          const family=path.join(config,'skills');
          if(kind==='collision')await collisionFixtures(qhome);
          const list=await execute(bin,['skills','list'],qenv);
          evidence.discovery=list.stdout;
          evidence.checks.seven_discovered=names.every(n=>list.stdout.includes(n));
          evidence.checks.installed_bytes_match=evidence.entries.every(e=>e.sha256===e.source_sha256);
          evidence.catalog=discoveryRows(list.stdout);
          if(kind!=='collision')evidence.checks.unique_sources=catalogMatches(evidence.catalog,evidence.entries);
          if(kind==='status'){
            // 单次官方路线调用；仅状态技能，不调用四条任务入口。
            const prompt='/dual-status --topic '+shellQuote(topic)+' --json';
            const r=await execute(bin,['--cwd',root,'--setting-sources','user','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','Bash,Read,Skill','--allowed-tools','Bash','--permission-mode','dont_ask','--no-session-persistence','--output-format','stream-json','-p',prompt],qenv);
            evidence.native_result=r;
          }
          evidence.skill_root=family;
        },{copyAuthentication:kind==='status'});
      }else{
        evidence.source_kind='controlled-loopback-native-cli';evidence.real_model=false;evidence.real_credentials=false;
        await installEntries(home,env);
        if(kind==='collision')await collisionFixtures(home);
        let round=0;
        server=http.createServer(async(req,res)=>{
          try{
            let raw='';for await(const c of req){raw+=c;if(raw.length>2*1024*1024)throw Error('request-too-large');}
            const body=JSON.parse(raw);evidence.requests.push({url:req.url,body});round++;
            if(round>4)throw Error('model-round-budget');
            const call=kind==='status'&&round<=2;
            const tool=round===1?{name:'Skill',arguments:JSON.stringify({skill:'dual-status',args:'--topic '+shellQuote(topic)+' --json'})}:{name:'Bash',arguments:JSON.stringify({command:'.trivium/bin/trivium status --topic '+shellQuote(topic)+' --json'})};
            const message=call?{role:'assistant',content:null,tool_calls:[{id:'driver-status-'+round,type:'function',function:tool}]}:{role:'assistant',content:'DRIVER_DISCOVERY_DONE'};
            if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});const delta=call?{...message,tool_calls:message.tool_calls.map((c,i)=>({...c,index:i}))}:message;for(const choice of [{delta,finish_reason:null},{delta:{},finish_reason:call?'tool_calls':'stop'}])res.write('data: '+JSON.stringify({id:'driver-probe',object:'chat.completion.chunk',created:1,model:'probe',choices:[{index:0,...choice}]})+'\n\n');res.end('data: [DONE]\n\n');}
            else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'driver-probe',object:'chat.completion',created:1,model:'probe',choices:[{index:0,message,finish_reason:call?'tool_calls':'stop'}]}));}
          }catch(e){res.writeHead(500);res.end('controlled protocol error');}
        });
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        await put(path.join(env.KIMI_CODE_HOME,'config.toml'),`default_model = "probe"\n[providers.probe]\ntype = "openai"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\napi_key = "synthetic-not-real"\n[models.probe]\nprovider = "probe"\nmodel = "probe"\nmax_context_size = 131072\ncapabilities = ["tool_use"]\n`);
        const prompt='/skill:dual-status --topic '+shellQuote(topic)+' --json';
        const r=await execute(bin,['--output-format','stream-json','-p',prompt]);evidence.native_result=r;
        const request=JSON.stringify(evidence.requests[0]?.body??{});
        evidence.catalog=discoveryRows((evidence.requests[0]?.body.messages??[]).find(m=>m.role==='system')?.content??'');
        if(kind!=='collision')evidence.checks.unique_sources=catalogMatches(evidence.catalog,evidence.entries);
        evidence.checks.seven_discovered=names.every(n=>request.includes(n));
        evidence.headless_slash_expanded=request.includes('.trivium/bin/trivium status')&&request.includes('闸门概览');
        evidence.checks.raw_arguments_reached_model=(evidence.requests[0]?.body.messages??[]).some(m=>m.content===prompt);
        if(kind==='status'){
          evidence.checks.skill_tool_loaded=JSON.stringify(evidence.requests.slice(1)).includes('闸门概览');
          evidence.checks.native_arguments_tail=JSON.stringify(evidence.requests.slice(1)).includes('ARGUMENTS: --topic');
        }
        evidence.checks.installed_bytes_match=evidence.entries.every(e=>e.sha256===e.source_sha256);
      }
      if(kind==='status'){
        evidence.ledger=await fs.readFile(ledger,'utf8').then(t=>t.trim().split('\n').map(JSON.parse),e=>{if(e.code==='ENOENT')return [];throw e;});
        evidence.checks.status_argv_cwd=evidence.ledger.some(e=>e.cwd===root&&JSON.stringify(e.argv)===JSON.stringify(evidence.expected.status_argv));
        evidence.checks.only_status_executed=evidence.ledger.length>0&&evidence.ledger.every(e=>e.allowed&&e.argv[0]==='status');
        evidence.checks.status_succeeded=evidence.ledger.length>0&&evidence.ledger.every(e=>e.exit_code===0);
        evidence.checks.native_exit=evidence.native_result.code===0&&!evidence.native_result.timedOut&&!evidence.native_result.truncated;
      }
      evidence.cli.source_unchanged=hash(await fs.readFile(sourceBin))===evidence.cli.sha256;
      if(kind==='collision'){
        evidence.shared_sentinel_discovered=evidence.catalog.some(r=>r.name==='driver-shared-sentinel');
        evidence.selected_status=evidence.catalog.filter(r=>r.name==='dual-status');
        evidence.checks.single_effective_status=evidence.selected_status.length===1;
      }
    }
  }catch(e){failure=e;evidence.error=String(e.message);}
  finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    evidence.global_after=await snapshot();evidence.global_unchanged=JSON.stringify(evidence.global_before)===JSON.stringify(evidence.global_after);
    if(!evidence.retained_fixture)await fs.rm(temp,{recursive:true,force:true});
    evidence.cleanup=await Promise.all(evidence.roots.map(async p=>({path:p,absent:await absent(p),intentionally_retained:!!evidence.retained_fixture&&p===temp})));
    evidence.checks.global_unchanged=evidence.global_unchanged;
    evidence.checks.cleanup=evidence.cleanup.every(x=>x.absent===true||x.intentionally_retained);
    const output=path.resolve(opts['--output']??path.join(repo,'doc/05_testing/evidence/driver-cli-20261028'));
    await fs.mkdir(output,{recursive:true});
    const file=path.join(output,`${agent}-${kind}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);
    const scrubbed=guard.scrub(JSON.stringify(evidence,null,2));
    const content=runtime?.redactSecrets(scrubbed).content??scrubbed;
    await fs.writeFile(file,content,{flag:'wx',mode:0o600});
    console.log(JSON.stringify({file,checks:evidence.checks,error:evidence.error??null,secret_matches:guard.matchIndices}));
    if(failure||guard.leaked||Object.values(evidence.checks).some(x=>x!==true))process.exitCode=1;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
