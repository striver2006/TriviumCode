/** 从冻结首次源码派生新一次性mode2，原件不改；25B/r28具名批准之后才生成。 */
import fs from 'node:fs';import path from 'node:path';
import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),old=root+'/../agent-access-20261011-closeout-r17/controlled-fixture.mjs';
if(hash(old)!=='c57b4229e092a37946e4e9450e49b91a2545ffb15e2c22a50c2dd30cceb0e0a1')throw Error('首次源码已变');
const checkpoint=JSON.parse(fs.readFileSync(root+'/plan25-approved-checkpoint.json'));if(checkpoint.approval.decision!=='approved'||!checkpoint.approval.reason.includes(checkpoint.final.sha256)||hash(checkpoint.final.path)!==checkpoint.final.sha256)throw Error('缺本轮普通批准/hash');
let source=fs.readFileSync(old,'utf8');function replace(a,b){if(source.split(a).length!==2)throw Error('派生锚点不唯一');source=source.replace(a,b);}
replace('/** 24B批准的固定loopback夹具；唯一厂商启动经production invokeClaude。 */','/** 25B/r28批准的mode2；本敏感取证谓词遵循设计#agent-access-evidence-guard-contract，CLI仅production invokeClaude。 */');
replace("import http from 'node:http';",'');
replace("import {evaluateControlled} from './controlled-mechanism.mjs';","import {evaluateControlledWithLifecycle} from './controlled-mechanism.mjs';\nimport {createControlledTransport,cleanupAll,createModeSettings,inspectModeSettings,pathAbsent,failureRecord} from './controlled-runtime.mjs';");
replace("variant!=='1'","variant!=='2'");replace('首次variant1','固定mode2');replace("+'/controlled-after24'","+'/controlled-after25-mode2'");replace("'trivium-controlled24-'","'trivium-controlled25-' ");
replace('let fx,scratch,server,raw,diagnostic,before,after,deny,targets,opts,shape;', 'let fx,scratch,transportService,raw,diagnostic,before,after,deny,targets,opts,shape,modeReference,modeBefore,modeAfter,productionDenyAfter,productionTargetsAfter;');
replace('const transport=[],images=[],cleanup={server_closed:null,home_removed:null,fixture_removed:null};','const transport=[],images=[];let cleanup={server_closed:null,home_removed:null,fixture_removed:null,mode_settings_removed:null};');
replace('fs.statSync(path.resolve(fx.root,p)).isFile()','fs.lstatSync(path.resolve(fx.root,p)).isFile()');
const start=source.indexOf(' server=http.createServer(async(req,res)=>{'),coreStart=source.indexOf('   const turns=transport.length;'),coreEnd=source.indexOf('\n  }catch(e){transportFailure??=e;res.writeHead(500);'),finish=source.indexOf(" await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});");
const finishText=" await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});";
if([start,coreStart,coreEnd,finish].some(i=>i<0)||!(start<coreStart&&coreStart<coreEnd&&coreEnd<finish))throw Error('HTTP源码锚点不符');
const core=source.slice(coreStart,coreEnd);
source=source.slice(0,start)+" transportService=createControlledTransport(async({endpoint,data,res})=>{\n if(endpoint.endsWith('count_tokens')){res.writeHead(200);res.end('{\"input_tokens\":1}');return;}\n"+core+"\n });\n const listenAddress=await transportService.start();"+source.slice(finish+finishText.length);
replace('server.address().port','listenAddress.port');
replace(' const controlledRoute={...route,env:'," modeReference=createModeSettings(scratch,live.trace.init);modeBefore=inspectModeSettings(modeReference);\n const controlledRoute={...route,env:");
replace("['independent temporary HOME/config','fake credential','loopback controlled provider; no real inference']","['independent temporary HOME/config','new single-key permissions.defaultMode setting mapped from live init; not production copy','fake credential','loopback controlled provider; no real inference']");
replace("guard_sha256:hash(root+'/controlled-mechanism.mjs'),","guard_sha256:hash(root+'/controlled-mechanism.mjs'),runtime_helper_sha256:hash(root+'/controlled-runtime.mjs'),mode_settings_reference:modeReference,mode_settings_before:modeBefore,");
replace(" diagnostic=evaluateControlled(raw,{fixtureRoot:fx.root,targets,sentinels:[SENTINEL_PEER,SENTINEL_SECRET],model:spec.model,liveInit:live.trace.init,before,after});if(transportFailure)throw transportFailure;", " modeAfter=inspectModeSettings(modeReference);productionDenyAfter=await enumerateDenyPaths(ctx.config,fx.root,fx.root+'/.reviews','claude','codex','probe-topic');productionTargetsAfter=productionDenyAfter.filter(p=>fs.existsSync(path.resolve(fx.root,p))&&fs.lstatSync(path.resolve(fx.root,p)).isFile());if(transportFailure)throw transportFailure;");
const cleanStart=source.indexOf('finally{\n if(interval)clearInterval(interval);'),cleanEnd=source.indexOf('\nfailure??=transportFailure;');if(cleanStart<0||cleanEnd<=cleanStart)throw Error('清理锚点不符');
source=source.slice(0,cleanStart)+`finally{
 if(interval)clearInterval(interval);await observationPending;
 const cleaned=await cleanupAll({
  server_closed:async()=>transportService?await transportService.close():null,
  home_removed:async()=>{if(!scratch)return null;fs.rmSync(scratch,{recursive:true,force:true});return !fs.existsSync(scratch);},
  mode_settings_removed:async()=>modeReference?pathAbsent(modeReference.path):null,
  fixture_removed:async()=>{if(!fx)return null;const residue=await fx.cleanup();if(residue)throw Error('夹具清理残留');return !fs.existsSync(fx.root);},
 },failure??transportFailure);
 cleanup=cleaned.cleanup;const errors=[...(cleaned.failure?[cleaned.failure]:[]),...(transportService?.errors??[])];failure=errors.length>1?new AggregateError(errors,'主错误与HTTP/清理错误'):errors[0]??null;
}
diagnostic=evaluateControlledWithLifecycle(raw??null,{fixtureRoot:fx?.root,targets:targets??null,sentinels:[SENTINEL_PEER,SENTINEL_SECRET],model:spec.model,liveInit:live.trace.init,before,after,production_deny_before:deny??null,production_deny_after:productionDenyAfter??null,production_targets_before:targets??null,production_targets_after:productionTargetsAfter??null,manifest_targets:targets??null,cleanup,transport:transportService?.snapshot()??null,lifecycle:{before:modeBefore??null,after:modeAfter??null,removed:cleanup.mode_settings_removed},failure});
`+source.slice(cleanEnd);
replace("{requests,bodyBytes,limit:{requests:12,total_body_bytes:8388608,per_request_bytes:1048576,runtime_ms:120000},observations:transport}","{...transportService?.snapshot(),observations:transport}");
replace("failure:failure?{name:failure.name,message:failure.message}:null","failure:failureRecord(failure)");
const target=root+'/controlled-fixture.mjs';fs.writeFileSync(target,source,{flag:'wx',mode:0o600});
saveEvidence(root+'/mode2-fixture-origin.json',{at:new Date().toISOString(),source_ref:{path:old,sha256:hash(old)},generated_ref:{path:target,sha256:hash(target)},generator_sha256:hash(new URL(import.meta.url)),plan:checkpoint.final,approved_run:checkpoint.run_id,guard_sha256:hash(root+'/controlled-mechanism.mjs'),helper_sha256:hash(root+'/controlled-runtime.mjs'),new_vendor_starts:0,old_variant1_changed:false});
console.log(JSON.stringify({fixture_sha256:hash(target),old_unchanged:true,new_vendor_starts:0}));
