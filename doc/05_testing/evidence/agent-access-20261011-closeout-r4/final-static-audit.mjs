/** 第10次完整重审前零CLI审计；仅输出诊断，旧矩阵与原准入判据不变。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { resolveClaudeRoute } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { codexAdapter } from '../../../../dist/test/src/trivium/adapters/codex.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { compareCompiledBytes } from './agent-access-applicability.mjs';
import { measureCodeStart, assertCodeStartMeasurement } from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs';
const repo=process.cwd(), here=path.join(repo,'doc/05_testing/evidence/agent-access-20261011-closeout-r4');
const prior=path.join(repo,'doc/05_testing/evidence/agent-access-20261011-closeout-r3');
const dynamic=path.join(os.homedir(),'.trivium/evidence/agent-access-20261011-closeout-r3');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const hash=p=>{try{return sha(fs.readFileSync(p));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const ctx=await loadCtx({cwd:repo});
const manifestFile=path.join(prior,'selection-r12-post-code-all-current.json');
if(hash(manifestFile)!=='311ea8e37119023616a9544ec39acdccb1392f9342a453c4a3763eb489e113ab')throw Error('显式选择原件不符');
const manifest=JSON.parse(fs.readFileSync(manifestFile));
function fingerprints(request){
  const modules={};
  function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js'))modules[p]=hash(p);}}
  walk('dist/test/src/trivium');
  return {entry:hash(request.entry),native_entry:request.native_entry?hash(request.native_entry):null,
    shared_config:hash('.trivium/config.yaml'),local_config:hash('.trivium/config.local.yaml'),
    globals:Object.fromEntries(['.codex/config.toml','.codex/auth.json','.codex/hooks.json','.claude/settings.json'].map(n=>[n,hash(path.join(os.homedir(),n))])),
    profile_config:request.agent==='claude'?resolveClaudeRoute(ctx.config,request.profile,request.cli_version_observed).configurationSha256:
      codexAdapter.accessFor(ctx.config,request.profile).configuration_sha256,
    modules,assets:Object.fromEntries(['skills/dual-critic/schema/review.v1.json','scripts/agent-access-evidence.mjs',
      'scripts/agent-access-budget.cjs','scripts/agent-access-budget-preload.cjs','scripts/agent-access-closeout.mjs',
      'scripts/agent-access-selection.mjs','scripts/agent-access-recipes.mjs','.trivium/bin/trivium','skills/dual-critic/scripts/trivium.cjs'].map(p=>[p,hash(p)]))};
}
function diff(a,b,p=''){
  if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],p?`${p}.${k}`:k));
  return a===b?[]:[{field:p,historical:a??null,current:b??null}];
}
const rows=[];
for(const [key,ref]of Object.entries(manifest.routes)){
  const dir=path.join(dynamic,'routes',`${key}-${ref.variant}`);
  for(const n of ['requested.json','result.json','fingerprints-after.json'])if(hash(path.join(dir,n))!==ref[n])throw Error('原件hash不符：'+key);
  const request=JSON.parse(fs.readFileSync(path.join(dir,'requested.json')));
  const after=JSON.parse(fs.readFileSync(path.join(dir,'fingerprints-after.json')));
  if(!after.unchanged||JSON.stringify(request.fingerprints)!==JSON.stringify(after.fingerprints))throw Error('历史采样内漂移');
  const differences=diff(request.fingerprints,fingerprints(request));
  rows.push({key,variant:ref.variant,references:ref,agent:request.agent,combination:request.combination,
    requested_model:request.model,full_fingerprint_compatible:differences.length===0,differences,
    current_admission_accepted:false,current_actual_cli_readback:null,server_identity:null,
    reusable:'仅历史实际机制；目录事实另由生产消费者核验，不能追认完整模型准入',
    necessary_new_start:'若按原完整指纹重新取得本臂准入，需当前版本上下文及本臂实际启动；无调用机制写臂先解决取证机制，暂不启动'});
}
if(rows.length!==38)throw Error('38臂未齐');
const oldBundle=fs.readFileSync(path.join(dynamic,'delivery/848-runtime-before-round9-tests.cjs'));
if(sha(oldBundle)!=='848445c9609aa6758b9580e95b6aa5d614090d18487ec534d6e57bb80520474e')throw Error('旧bundle原件不符');
const newBundle=fs.readFileSync('skills/dual-critic/scripts/trivium.cjs');
const bundleComparison=compareCompiledBytes(oldBundle,newBundle);
saveEvidence(path.join(here,'current-full-fingerprint-diagnostic.json'),{observed_at:new Date().toISOString(),real_cli_starts:0,
  selection_sha256:hash(manifestFile),rows,bundleComparison,criterion_adopted:false,current_admission_accepted:false,
  config_delta_semantics:null,config_delta_boundary:'已核hash变化；无完整旧配置快照，不将探活缓存解释外推为配置语义等价',
  official_claude:'未测，订阅恢复前0启动',m11_prerequisite_complete:false});
for(const stage of ['plan','code']){
 const m=await measureCodeStart(repo,'Agent双模式接入真实准入收口',['--stage',stage]);
 assertCodeStartMeasurement(m);saveEvidence(path.join(here,`stage-precheck-${stage}-final-installed.json`),{...m,passed:true});
}
const calls=fs.readdirSync(path.join(dynamic,'calls')).filter(n=>n.startsWith('r14-selftest-installed-')&&n.endsWith('-completed.json'));
if(calls.length!==1)throw Error('安装桩自检原件不唯一');
const call=JSON.parse(fs.readFileSync(path.join(dynamic,'calls',calls[0])));
if(call.code!==0||!call.stderr.includes('14/14')||!call.stderr.includes('夹具已清理'))throw Error('安装桩自检未完成');
saveEvidence(path.join(here,'selftest-final-installed.json'),{code:call.code,passed:14,total:14,fixture_cleaned:true,
  source_sha256:hash(path.join(dynamic,'calls',calls[0])),source:path.join(dynamic,'calls',calls[0]),real_vendor_starts:0});
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const budgetRoot=path.join(dynamic,'budget');
const budgets=Object.fromEntries(['admission','review'].map(pool=>{const b=openBudget(budgetRoot,pool);return[pool,{reserved:fs.readdirSync(b.dir).filter(n=>n.startsWith('reserved-')).length,completed:fs.readdirSync(b.dir).filter(n=>n.startsWith('launch-')).length,limit:b.limit()}];}));
console.log(JSON.stringify({rows:rows.length,difference_fields:[...new Set(rows.flatMap(r=>r.differences.map(d=>d.field)))],bundleComparison,budgets,real_cli_starts:0}));
