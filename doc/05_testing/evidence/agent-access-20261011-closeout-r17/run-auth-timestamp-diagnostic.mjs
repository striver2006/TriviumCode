/** 24B只读诊断：临时重建字节必须命中旧完整hash，不恢复生产配置。 */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {Ajv2020} from 'ajv/dist/2020.js';
import {loadCtx} from '../../../../dist/test/src/trivium/config.js';
import {resolveClaudeRoute} from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import {codexAdapter} from '../../../../dist/test/src/trivium/adapters/codex.js';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {evaluateAuthTimestamp} from './auth-timestamp-applicability.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),historical=repo+'/doc/05_testing/evidence/agent-access-20261011-closeout-r15';
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const ref=p=>({path:p,sha256:digest(p)});
const observationPath=repo+'/doc/05_testing/evidence/agent-access-20261011-closeout-r16/config-after24-preflight-observation.json';
const observation=JSON.parse(fs.readFileSync(observationPath));
const summaryPath=historical+'/claude-final-positive-after23/summary-7dc362f6-d8ab-47d6-8fee-396a5e64e2a1.json',summary=JSON.parse(fs.readFileSync(summaryPath));
const selectionPath=historical+'/claude-final-positive-after23/selection-after23-all-positive.json',selection=JSON.parse(fs.readFileSync(selectionPath));
const ctx=await loadCtx(),stamp=await computeBuildStamp(repo),local=repo+'/.trivium/config.local.yaml',currentBytes=fs.readFileSync(local);
let oldBytes=Buffer.from(currentBytes);for(const ch of observation.changes){const s=oldBytes.toString('utf8');if(s.split(ch.new_value).length!==2)throw Error('已记录当前时间值必须唯一出现');oldBytes=Buffer.from(s.replace(ch.new_value,ch.old_value));}
const oldHash=crypto.createHash('sha256').update(oldBytes).digest('hex');if(oldHash!==observation.before_sha256||digest(local)!==observation.current_sha256)throw Error('重建旧字节或当前原件hash不符，诊断停止');
const roots=['admission-after23','codex-refresh-after23','claude-partial-after23','claude-final-positive-after23'].map(x=>historical+'/'+x);
const findDir=key=>{const wanted=selection.routes[key];if(!wanted)throw Error('指定原件缺选择');const choices=roots.map(p=>p+'/routes/'+key+'-'+wanted.variant).filter(p=>fs.existsSync(p+'/result.json')&&digest(p+'/result.json')===wanted['result.json']);if(!choices.length)throw Error('选择hash原件缺失：'+key);return choices.at(-1);};
const selectedKeys=Object.keys(selection.routes).filter(k=>selection.routes[k]&&(k.startsWith('codex-')||(k.startsWith('claude-qwen-')&&!k.startsWith('claude-qwen-pro-'))||(k.endsWith('-read')&&!k.endsWith('-deny-read'))));
if(selectedKeys.length!==27||summary.rows.filter(r=>r.status==='通过').length!==7)throw Error('本次显式7组合及5正向原件作用面不符');
const components=[],sourceRefs=[ref(observationPath),ref(summaryPath),ref(selectionPath)],scope=[],sources=[];
const check=(kind,name,expected,observed)=>components.push({kind,name,expected,observed});
function moduleHashes(dir){const out={};for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())Object.assign(out,moduleHashes(p));else if(e.name.endsWith('.js'))out[path.relative(repo,p)]=digest(p);}return out;}
const modules=moduleHashes(repo+'/dist/test/src/trivium');
const globalNames=['.codex/config.toml','.codex/auth.json','.codex/hooks.json','.claude/settings.json'];
const globals=Object.fromEntries(globalNames.map(n=>[n,digest(path.join(os.homedir(),n))]));
for(const key of selectedKeys){
 const dir=findDir(key),sel=selection.routes[key];for(const name of ['requested.json','result.json','fingerprints-after.json']){if(digest(dir+'/'+name)!==sel[name])throw Error('选择原件hash不符');sourceRefs.push(ref(dir+'/'+name));}
 const result=JSON.parse(fs.readFileSync(dir+'/result.json')),request=result.request,fp=request.fingerprints,after=JSON.parse(fs.readFileSync(dir+'/fingerprints-after.json'));
 if(fp.local_config!==observation.before_sha256||after.unchanged!==true||JSON.stringify(fp)!==JSON.stringify(after.fingerprints))throw Error('本次来源原始完整配置或运行漂移不符');
 if(!result.completed||request.effort!==null)throw Error('来源终态或effort不符');
 const currentProfile=request.agent==='claude'?resolveClaudeRoute(ctx.config,request.profile,request.cli_version_observed).configurationSha256:codexAdapter.accessFor(ctx.config,request.profile).configuration_sha256;
 const currentConfiguration=request.agent==='claude'?(()=>{const r=resolveClaudeRoute(ctx.config,request.profile,request.cli_version_observed);return{mode:r.mode,fingerprint:r.fingerprint,provider_declared:r.providerDeclared,models_declared:r.modelsDeclared,configuration_sha256:r.configurationSha256,wrapper_sha256:r.wrapperSha256};})():codexAdapter.accessFor(ctx.config,request.profile);
 check('build-inputs',key,{git_head:request.build_inputs.git_head,dirty:request.build_inputs.dirty,inputs_sha256:request.build_inputs.inputs_sha256},{git_head:stamp.git_head,dirty:stamp.dirty,inputs_sha256:stamp.inputs_sha256});
 check('source-bundle',key,fp.assets['skills/dual-critic/scripts/trivium.cjs'],digest(repo+'/skills/dual-critic/scripts/trivium.cjs'));
 check('installed-bundle',key,fp.assets['skills/dual-critic/scripts/trivium.cjs'],digest(path.join(os.homedir(),'.claude/skills/dual-critic/scripts/trivium.cjs')));
 check('shared-config',key,fp.shared_config,digest(repo+'/.trivium/config.yaml'));check('globals',key,fp.globals,globals);check('modules',key,fp.modules,modules);
 check('assets',key,fp.assets,Object.fromEntries(Object.keys(fp.assets).map(p=>[p,digest(repo+'/'+p)])));
 check('entry',key,fp.entry,digest(request.entry));check('native-entry',key,fp.native_entry,digest(request.native_entry));check('profile-config',key,fp.profile_config,currentProfile);
 check('route-configuration',key,request.configuration,currentConfiguration);check('canonical-source',key,request.canonical_sha256,digest(repo+'/scripts/agent-access-closeout.mjs'));
 // 版本仍为历史实际观测；同native hash只支持适用性，不称新--version实测。
 check('cli-version-fact',key,{version_observed:request.cli_version_observed,native_sha256:fp.native_entry},{version_observed:request.cli_version_observed,native_sha256:digest(request.native_entry)});
 // 请求模型/effort来自原件；生产配方和完整原值配置相同构成消费链，不伪造新回读。
 check('model-effort',key,{model_requested:request.model,effort_requested:request.effort,recipe_sha256:fp.assets['scripts/agent-access-recipes.mjs']},{model_requested:request.model,effort_requested:request.effort,recipe_sha256:digest(repo+'/scripts/agent-access-recipes.mjs')});
 scope.push({route:request.agent,combination:request.combination,model_requested:request.model,model_effective:result.readback?.model??result.trace?.init?.model??null,arm:request.arm,source_ref:ref(dir+'/result.json'),original_full_status:summary.rows.find(r=>r.agent===request.agent&&r.combination===request.combination)?.status??null});sources.push(result);
}
const consumptionRefs=['src/trivium/preflight.ts','src/trivium/config.ts','src/trivium/adapters/claude-route.ts','src/trivium/adapters/codex.ts','scripts/agent-access-closeout.mjs','scripts/agent-access-recipes.mjs'].map(p=>ref(repo+'/'+p));
let scratch,cleanup=false,diagnostic;
try{
 scratch=fs.mkdtempSync(path.join(os.tmpdir(),'trivium-auth24-'));fs.chmodSync(scratch,0o700);
 fs.writeFileSync(scratch+'/reconstructed-old.yaml',oldBytes,{flag:'wx',mode:0o600});fs.writeFileSync(scratch+'/sampled-current.yaml',currentBytes,{flag:'wx',mode:0o600});
 diagnostic=evaluateAuthTimestamp({oldBytes:fs.readFileSync(scratch+'/reconstructed-old.yaml'),currentBytes:fs.readFileSync(scratch+'/sampled-current.yaml'),expectedOldHash:observation.before_sha256,expectedCurrentHash:observation.current_sha256,components,sourceRefs,consumptionRefs,latestLeak:sources.every(r=>typeof r.forbidden_read_detection?.leaked==='boolean')?sources.some(r=>r.forbidden_read_detection.leaked===true):null,latestActualInterceptionFailure:sources.every(r=>typeof r.breach_exists==='boolean')?sources.some(r=>r.breach_exists===true):null});
}finally{if(scratch){fs.rmSync(scratch,{recursive:true,force:true});cleanup=!fs.existsSync(scratch);}oldBytes.fill(0);}
const result={...diagnostic,observed_at:new Date().toISOString(),script_sha256:digest(new URL(import.meta.url)),guard_sha256:digest(root+'/auth-timestamp-applicability.mjs'),scope,reconstructed_old_is_original_sample:false,reconstruction_byte_hash_exact:true,private_snapshot_cleanup:cleanup,new_vendor_starts:0,mode_pilot_ref:ref(root+'/controlled-pilot-stop.json'),notes:['仅比较本批已列配置与二进制/配方事实；CLI版本和模型回读仍是历史实测','受控HOME权限差异另列未通过，不将机制B纳入本诊断来源','原负对照false与未测保留，当前canonical 0/12不改']};
if(!cleanup)throw Error('临时私有副本清理不完整');if(digest(local)!==observation.current_sha256)throw Error('生产配置在诊断期间变化');
const validate=new Ajv2020({strict:true,allErrors:true}).compile(JSON.parse(fs.readFileSync(root+'/auth-timestamp-applicability.v1.schema.json')));if(!validate(result))throw Error('局部诊断Schema不符：'+JSON.stringify(validate.errors));
saveEvidence(root+'/auth-timestamp-diagnostic.json',result);console.log(JSON.stringify({applicable_diagnostic:result.applicable_diagnostic,reasons:result.reasons,scope_items:scope.length,component_checks:components.length,source_refs:sourceRefs.length,private_snapshot_cleanup:cleanup,raw_value_comparison:result.raw_value_comparison,new_vendor_starts:0,criterion_adopted:false}));
