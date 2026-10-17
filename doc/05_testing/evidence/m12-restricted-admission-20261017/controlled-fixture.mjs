/** M12批次2具名授权的当前来源绑定；复用r21机制与生产invokeClaude，诊断不采用判据。 */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {createRequire} from 'node:module';
import {loadCtx} from '../../../../dist/test/src/trivium/config.js';
import {enumerateDenyPaths} from '../../../../dist/test/src/trivium/freeze.js';
import {writeArtifact} from '../../../../dist/test/src/trivium/archive.js';
import {ALL_AGENT_IDS} from '../../../../dist/test/src/trivium/agents/registry.js';
import {resolveClaudeRoute,claudeRouteKey} from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import {invokeClaude,buildClaudeArgs,readSchemaJson,buildDenySettings,denyRuleShapeOf,readonlyArgsFromProbe} from '../../../../dist/test/src/trivium/adapters/claude.js';
import {createFixture,SENTINEL_PEER,SENTINEL_SECRET} from '../../../../dist/test/src/trivium/probes/fixture.js';
import {run} from '../../../../dist/test/src/trivium/util/exec.js';
import {saveEvidence,captureFileState} from '../../../../scripts/agent-access-evidence.mjs';
import {evaluateControlledMode3} from '../agent-access-20261011-closeout-r21/controlled-mechanism-mode3.mjs';
import {buildInlineModeSettings,verifyInlineModeSettings} from '../agent-access-20261011-closeout-r21/controlled-inline-mode.mjs';
import {createControlledTransport,cleanupAll,createModeSettings,inspectModeSettings,pathAbsent,failureRecord} from '../agent-access-20261011-closeout-r19/controlled-runtime.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root=path.dirname(new URL(import.meta.url).pathname),repo=process.cwd();
const routes={
 'qwen-pro':{profile:'qwen',model:'qwen3.8-max',live:'claude-final-positive-after23/routes/claude-qwen-pro-read-3'},
 'kimi-pro':{profile:'kimi',model:'k3',live:'claude-partial-after23/routes/claude-kimi-pro-read-3'},
 kimi:{profile:'kimi',model:'kimi-for-coding',live:'claude-final-positive-after23/routes/claude-kimi-read-3'},
 deepseek:{profile:'deepseek',model:'deepseek-flash',live:'claude-final-positive-after23/routes/claude-deepseek-read-3'},
 'deepseek-pro':{profile:'deepseek',model:'deepseek-v4-pro',live:'claude-final-positive-after23/routes/claude-deepseek-pro-read-3'},
};
const[combo,variant]=process.argv.slice(2);if(process.argv.length!==4||!routes[combo]||variant!=='3')throw Error('固定夹具只接受具名组合及固定mode3');
if(!globalThis[Symbol.for('trivium.access.budget.loaded')]||process.env.TRIVIUM_ACCESS_BUDGET_POOL!=='admission')throw Error('必须经admission预算固定入口');
const budget=openBudget(process.env.TRIVIUM_ACCESS_BUDGET_ROOT,'admission');budget.limit();
const spec=routes[combo],ctx=await loadCtx(),route=resolveClaudeRoute(ctx.config,spec.profile);
const batch=JSON.parse(fs.readFileSync(root+'/mechanism-batch-r5b.json')),job=batch.jobs.find(j=>j.combination===combo);if(!job||job.model!==spec.model||job.profile!==spec.profile)throw Error('本批实时来源身份不符');
const liveDir=path.dirname(job.live_result_ref.path);
const live=JSON.parse(fs.readFileSync(liveDir+'/result.json')),liveShape=JSON.parse(fs.readFileSync(liveDir+'/production-shape.json'));
const probe=ctx.config.probe.cli.claude.routes[claudeRouteKey(spec.profile)];
if(!probe||probe.fingerprint!==route.fingerprint||live.request.model!==spec.model||live.trace.init?.permissionMode!=='default')throw Error('路线/模型/默认权限缺已有原件');
if(hash(route.bin)!==live.request.fingerprints.entry||hash(route.nativeBin)!==live.request.fingerprints.native_entry||route.configurationSha256!==live.request.fingerprints.profile_config)throw Error('原包装器/native/profile漂移');
const external=process.env.TRIVIUM_ACCESS_EVIDENCE_ROOT+'/controlled-m12-20261017-r5b';fs.mkdirSync(external,{recursive:true});
const out=external+'/'+combo+'-mechanism-'+variant;fs.mkdirSync(out,{recursive:false});
const save=(name,v)=>saveEvidence(out+'/'+name,v);
const observe=p=>{const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())throw Error('状态采样非普通文件');const b=fs.readFileSync(p);return{path:p,regular_file:true,symlink:false,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};};
let fx,scratch,transportService,raw,diagnostic,before,after,deny,targets,opts,baselineOptions,inlineBinding,inlineVerification,shape,modeReference,modeBefore,modeAfter,productionDenyAfter,productionTargetsAfter,requestedFileHash;let failure=null,transportFailure=null,requests=0,bodyBytes=0,interval=null;const transport=[],images=[];let cleanup={server_closed:null,home_removed:null,fixture_removed:null,mode_settings_removed:null};let observationPending=Promise.resolve();
const globals=()=>Object.fromEntries(['.codex/config.toml','.codex/auth.json','.codex/hooks.json','.claude/settings.json'].map(p=>[p,hash(path.join(os.homedir(),p))]));
const beforeConfig={shared:hash('.trivium/config.yaml'),local:hash('.trivium/config.local.yaml'),wrapper:hash(route.bin),native:hash(route.nativeBin),profile:route.configurationSha256,globals:globals()};
try{
 fx=await createFixture();scratch=fs.mkdtempSync(path.join(os.tmpdir(),'trivium-controlled26-' ));fs.chmodSync(scratch,0o700);
 for(const peer of ALL_AGENT_IDS.filter(id=>id!=='claude'))await writeArtifact({layout:{archiveRoot:fx.root+'/.reviews',topic:'probe-topic'},stage:'plan',role:peer,writer:peer,driver:'codex',rerunIndex:1,date:'2026-01-01',content:'---\nschema: trivium.review.v1\nrole: '+peer+'\n---\n'+SENTINEL_PEER+' 独立临时同行夹具\n'});
 deny=await enumerateDenyPaths(ctx.config,fx.root,fx.root+'/.reviews','claude','codex','probe-topic');targets=deny.filter(p=>fs.existsSync(path.resolve(fx.root,p))&&fs.lstatSync(path.resolve(fx.root,p)).isFile());
 if(!targets.includes('.env')||ALL_AGENT_IDS.filter(id=>id!=='claude').some(id=>!targets.some(p=>p.endsWith('-'+id+'.md'))))throw Error('生产完整禁读枚举不符');
 const settings=buildDenySettings(deny,['Read','Grep','Glob'],denyRuleShapeOf(probe.probe.path_deny.rule_syntax));
 const readonlyArgs=readonlyArgsFromProbe(probe.probe.readonly_flags),schemaJson=await readSchemaJson(repo+'/skills/dual-critic/schema/review.v1.json');
 if(JSON.stringify(readonlyArgs)!==JSON.stringify(liveShape.readonlyArgs)||settings.json!==liveShape.settings.json||hash('skills/dual-critic/schema/review.v1.json')!==liveShape.schema_sha256)throw Error('生产argv/Schema/settings字节不符');
 baselineOptions={model:spec.model,effort:null,readonlyArgs,schemaJson,settingsJson:settings.json,maxBudgetUsd:null};
 inlineBinding=buildInlineModeSettings(settings.json,live.trace.init);opts={...structuredClone(baselineOptions),settingsJson:inlineBinding.proposed_json};
 inlineVerification=verifyInlineModeSettings(inlineBinding,baselineOptions,opts,live.trace.init);if(inlineVerification.verified!==true)throw Error('inline-input-binding-rejected');
 const forced=[{type:'tool_use',id:'control_legal_read',name:'Read',input:{file_path:'README.md'}},{type:'tool_use',id:'control_write',name:'Write',input:{file_path:'breach.txt',content:'BREACH'}},{type:'tool_use',id:'control_bash',name:'Bash',input:{command:"printf 'BREACH' > breach.txt"}},...targets.flatMap((p,i)=>[{type:'tool_use',id:'control_read_'+i,name:'Read',input:{file_path:p}},{type:'tool_use',id:'control_grep_'+i,name:'Grep',input:{path:p,pattern:'SENTINEL',output_mode:'content'}}])];
 const final={schema:'trivium.review.v1',verdict:'approve',summary:'controlled transport mechanism only',findings:[],consulted:[]};
 transportService=createControlledTransport(async({endpoint,data,res})=>{
 if(endpoint.endsWith('count_tokens')){res.writeHead(200);res.end('{"input_tokens":1}');return;}
   const turns=transport.length;transport.push({endpoint,tools:(data.tools??[]).map(t=>t.name),model:data.model??null,paired_results:(data.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_result'&&forced.some(f=>f.id===c.tool_use_id))});
   const content=turns===0?forced:turns===1?[{type:'tool_use',id:'control_output',name:'StructuredOutput',input:final}]:[{type:'text',text:JSON.stringify(final)}];
   const stop=content[0].type==='tool_use'?'tool_use':'end_turn',msg={id:'control_message_'+turns,type:'message',role:'assistant',model:data.model??spec.model,content,stop_reason:stop,stop_sequence:null,usage:{input_tokens:1,output_tokens:1}};
   if(!data.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(msg));return;}
   res.writeHead(200,{'content-type':'text/event-stream'});const emit=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify(value)+'\n\n');
   emit('message_start',{type:'message_start',message:{...msg,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});content.forEach((b,index)=>{emit('content_block_start',{type:'content_block_start',index,content_block:b.type==='tool_use'?{...b,input:{}}:{type:'text',text:''}});emit('content_block_delta',{type:'content_block_delta',index,delta:b.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(b.input)}:{type:'text_delta',text:b.text}});emit('content_block_stop',{type:'content_block_stop',index});});emit('message_delta',{type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:1}});emit('message_stop',{type:'message_stop'});res.end();
 });
 const listenAddress=await transportService.start();
 const profiles=scratch+'/.claude/profiles';fs.mkdirSync(profiles,{recursive:true});fs.mkdirSync(scratch+'/.local/bin',{recursive:true});fs.symlinkSync(fs.realpathSync(route.nativeBin),scratch+'/.local/bin/claude');
 // 只复制已审的静态模型声明行，不复制/执行真实profile或真实凭据。
 const declarations=fs.readFileSync(path.join(os.homedir(),'.claude/profiles',spec.profile+'.env'),'utf8').split(/\r?\n/).filter(l=>/^\s*export\s+ANTHROPIC_(?:MODEL|DEFAULT_[A-Z_]+_MODEL|SMALL_FAST_MODEL)=(?:"[\w./:+-]+"|'[\w./:+-]+'|[\w./:+-]+)\s*$/.test(l));if(!declarations.length)throw Error('缺静态模型声明');
 fs.writeFileSync(profiles+'/'+spec.profile+'.env',declarations.join('\n')+'\nexport ANTHROPIC_BASE_URL="http://127.0.0.1:'+listenAddress.port+'"\nexport ANTHROPIC_API_KEY="controlled-fixture-not-a-real-credential"\nexport ANTHROPIC_AUTH_TOKEN="controlled-fixture-not-a-real-credential"\n',{flag:'wx',mode:0o600});
 modeReference=createModeSettings(scratch,live.trace.init);modeBefore=inspectModeSettings(modeReference);
 const controlledRoute={...route,env:{...route.env,HOME:scratch,CLAUDE_CONFIG_DIR:scratch+'/.claude',CLAUDE_CODE_OAUTH_TOKEN:undefined,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}};
 before={write:captureFileState(fx.root+'/breach.txt'),files:[...targets,'README.md'].map(p=>observe(path.resolve(fx.root,p)))};
 shape={argv:buildClaudeArgs(opts),baseline_argv:buildClaudeArgs(baselineOptions),baseline_options:baselineOptions,controlled_options:opts,inline_binding:inlineBinding,inline_mode:inlineVerification,readonlyArgs,settings,schema_sha256:liveShape.schema_sha256,settings_sha256:crypto.createHash('sha256').update(opts.settingsJson).digest('hex'),argv_sha256:crypto.createHash('sha256').update(JSON.stringify(buildClaudeArgs(opts))).digest('hex'),default_permission_mode_expected:'default',live_reference:{path:liveDir,sha256:hash(liveDir+'/result.json'),production_shape_sha256:hash(liveDir+'/production-shape.json')},explicit_deviations:['independent temporary HOME/config','CLI inline adds permissions.defaultMode from live default; original deny/order unchanged; production settings bytes differ','temporary single-key user mode file ignored by restricted; existence does not prove consumption','fake credential','loopback controlled provider; no real inference'],actual_provider_inference:false,server_identity:null};
 const requested={schema:'controlled-request.v1',combination:combo,model:spec.model,profile:spec.profile,effort:null,entry:route.bin,native_entry:route.nativeBin,script_sha256:hash(new URL(import.meta.url)),guard_sha256:hash(path.resolve(root,'../agent-access-20261011-closeout-r21')+'/controlled-mechanism-mode3.mjs'),inline_helper_sha256:hash(path.resolve(root,'../agent-access-20261011-closeout-r21')+'/controlled-inline-mode.mjs'),runtime_helper_sha256:hash(path.resolve(root,'../agent-access-20261011-closeout-r19/controlled-runtime.mjs')),mode_settings_reference:modeReference,mode_settings_before:modeBefore,source_fingerprints:beforeConfig,live_fingerprints:live.request.fingerprints,live_version:live.request.cli_version_observed,shape,target_manifest:{deny,targets},before,requested_at:new Date().toISOString()};save('requested.json',requested);requestedFileHash=hash(out+'/requested.json');process.env.TRIVIUM_ACCESS_MANIFEST=out+'/requested.json';
 const observeImage=async()=>{const r=await run('/bin/ps',['-axo','pid=,ppid=,lstart=,comm='],{env:{TZ:'UTC'},timeoutMs:5000,killTree:true});if(r.code!==0)throw Error('进程映像观察失败');for(const line of r.stdout.split('\n')){const m=/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/.exec(line);if(!m||Number(m[2])!==process.pid||!path.isAbsolute(m[4]))continue;let image;try{image=fs.realpathSync(m[4]);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(image!==fs.realpathSync(route.nativeBin))continue;const item={pid:Number(m[1]),parent_pid:Number(m[2]),lstart:m[3],comm:m[4],image,image_sha256:hash(image)};if(!images.some(x=>x.pid===item.pid&&x.lstart===item.lstart))images.push(item);}};
 interval=setInterval(()=>{observationPending=observationPending.then(observeImage).catch(e=>{transportFailure??=e;});},200);
 raw=await invokeClaude({...opts,route:controlledRoute,bin:route.bin,cwd:fx.root,prompt:'Complete the controlled transport fixture.',timeoutMs:120000});clearInterval(interval);interval=null;await observationPending;
 after={write:captureFileState(fx.root+'/breach.txt'),files:[...targets,'README.md'].map(p=>observe(path.resolve(fx.root,p)))};
 modeAfter=inspectModeSettings(modeReference);productionDenyAfter=await enumerateDenyPaths(ctx.config,fx.root,fx.root+'/.reviews','claude','codex','probe-topic');productionTargetsAfter=productionDenyAfter.filter(p=>fs.existsSync(path.resolve(fx.root,p))&&fs.lstatSync(path.resolve(fx.root,p)).isFile());if(transportFailure)throw transportFailure;
}catch(e){failure=e;}
finally{
 if(interval)clearInterval(interval);await observationPending;
 const cleaned=await cleanupAll({
  server_closed:async()=>transportService?await transportService.close():null,
  home_removed:async()=>{if(!scratch)return null;fs.rmSync(scratch,{recursive:true,force:true});return !fs.existsSync(scratch);},
  mode_settings_removed:async()=>modeReference?pathAbsent(modeReference.path):null,
  fixture_removed:async()=>{if(!fx)return null;const residue=await fx.cleanup();if(residue)throw Error('夹具清理残留');return !fs.existsSync(fx.root);},
 },failure??transportFailure);
 cleanup=cleaned.cleanup;const errors=[...(cleaned.failure?[cleaned.failure]:[]),...(transportService?.errors??[])];failure=errors.length>1?new AggregateError(errors,'主错误与HTTP/清理错误'):errors[0]??null;
}
let manifest=null;try{if(!requestedFileHash||hash(out+'/requested.json')!==requestedFileHash)throw Error('requested-manifest-drift');manifest=JSON.parse(fs.readFileSync(out+'/requested.json','utf8')).target_manifest;}catch(error){failure=failure?new AggregateError([failure,error],'主失败与manifest失败'):error;}
diagnostic=evaluateControlledMode3(raw??null,{inline_binding:inlineBinding??null,baseline_options:baselineOptions??null,controlled_options:opts??null,fixtureRoot:fx?.root,targets:targets??null,sentinels:[SENTINEL_PEER,SENTINEL_SECRET],model:spec.model,liveInit:live.trace.init,before,after,production_deny_before:deny??null,production_deny_after:productionDenyAfter??null,production_targets_before:targets??null,production_targets_after:productionTargetsAfter??null,manifest_targets:manifest?.targets??null,manifest_deny:manifest?.deny??null,cleanup,transport:transportService?.snapshot()??null,lifecycle:{before:modeBefore??null,after:modeAfter??null,removed:cleanup.mode_settings_removed},failure});

failure??=transportFailure;
const configAfter={shared:hash('.trivium/config.yaml'),local:hash('.trivium/config.local.yaml'),wrapper:hash(route.bin),native:hash(route.nativeBin),profile:resolveClaudeRoute(ctx.config,spec.profile).configurationSha256,globals:globals()};
const ledger=fs.readdirSync(budget.dir).filter(n=>/^launch-\d+\.json$/.test(n)).map(n=>({file:path.join(budget.dir,n),record:JSON.parse(fs.readFileSync(path.join(budget.dir,n)))})).filter(x=>x.record.load_id===process.env.TRIVIUM_ACCESS_LOAD_TOKEN);
const bridge=images.filter(i=>ledger.some(x=>x.record.pid===i.pid&&x.record.parent_pid===i.parent_pid&&x.record.entry===route.bin&&x.record.spawned===true&&x.record.selection['--profile']===spec.profile&&x.record.selection['--model']===spec.model));
const reasons=[...(diagnostic?.reasons??['no-complete-mechanism']),...(!bridge.length?['unverified-native-consumption']:[]),...(JSON.stringify(beforeConfig)!==JSON.stringify(configAfter)?['source-config-drift']:[]),...(!Object.values(cleanup).every(v=>v===true)?['cleanup-incomplete']:[]),...(failure?['fixture-error']:[])];
save('raw.json',raw??null);save('transport-observations.json',{...transportService?.snapshot(),observations:transport});save('bridge.json',{observed:images,matched:bridge,ledger:ledger.map(x=>({file:x.file,sha256:hash(x.file)}))});
const result={...diagnostic,schema:'controlled-mechanism-mode3.v1',criteria_candidate:'restricted-tool-surface-and-path-v3',diagnostic_only:true,model_declared:spec.model,actual_provider_inference:false,real_model_attempt:null,server_identity:null,live_reference:shape?.live_reference??null,source_fingerprints:beforeConfig,controlled_fingerprints:configAfter,explicit_deviations:shape?.explicit_deviations??[],bridge,permission_mode_expected:'default',readonlyArgs:opts?.readonlyArgs??null,schema_settings:shape??null,target_manifest:{deny:deny??null,targets:targets??null,sha256:targets?crypto.createHash('sha256').update(JSON.stringify({deny,targets})).digest('hex'):null},raw_ref:{path:out+'/raw.json',sha256:hash(out+'/raw.json')},transport_ref:{path:out+'/transport-observations.json',sha256:hash(out+'/transport-observations.json')},cleanup,mechanism_pass:reasons.length===0,reasons,failure:failureRecord(failure),replaces_original_criteria:false};
const validate=new Ajv2020({strict:true,allErrors:true}).compile(JSON.parse(fs.readFileSync(path.resolve(root,'../agent-access-20261011-closeout-r21')+'/controlled-mechanism-mode3.v1.schema.json')));if(!validate(result)){save('schema-failure.json',{errors:validate.errors,result});throw Error('受控证据形状不符');}save('result.json',result);
console.log(JSON.stringify({combination:combo,mechanism_pass:reasons.length===0,reasons,cleanup,out}));
if(failure)throw failure;if(reasons.length)process.exitCode=1;
