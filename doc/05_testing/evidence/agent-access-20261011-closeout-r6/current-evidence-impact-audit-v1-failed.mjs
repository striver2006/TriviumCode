/** 未授权15期间的零CLI适用性审计；只保存差异，不采用复用判据。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { resolveClaudeRoute } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { codexAdapter } from '../../../../dist/test/src/trivium/adapters/codex.js';
import { loadSelection, selectedEvidence } from '../../../../scripts/agent-access-selection.mjs';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { compareCompiledBytes } from '../agent-access-20261011-closeout-r4/agent-access-applicability.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const prior=path.join(repo,'doc/05_testing/evidence/agent-access-20261011-closeout-r3');
const matrixFile=path.join(prior,'matrix-r12-code-nits.json'),matrix=JSON.parse(fs.readFileSync(matrixFile));
const selection=loadSelection(path.join(prior,'selection-r12-post-code-all-current.json'));
if(selection.sha256!==matrix.selection.sha256)throw Error('显式历史selection改变');
const checkpoint=JSON.parse(fs.readFileSync(path.join(root,'post14-checkpoint.json')));
const {config}=await loadCtx({cwd:repo});
function currentFingerprints(request){
  const route=request.agent==='claude'?resolveClaudeRoute(config,request.profile,request.cli_version_observed):null;
  const access=request.agent==='codex'?codexAdapter.accessFor(config,request.profile):null;
  const modules={};
  function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js'))modules[p]=hash(p);}}
  walk('dist/test/src/trivium');
  return{entry:hash(route?.bin??access.launcher_requested),native_entry:request.native_entry?hash(request.native_entry):null,
    shared_config:hash('.trivium/config.yaml'),local_config:hash('.trivium/config.local.yaml'),
    globals:Object.fromEntries(['.codex/config.toml','.codex/auth.json','.codex/hooks.json','.claude/settings.json'].map(n=>[n,hash(path.join(os.homedir(),n))])),
    profile_config:route?.configurationSha256??access.configuration_sha256,modules,
    assets:Object.fromEntries(Object.keys(request.fingerprints.assets).map(p=>[p,hash(p)]))};
}
function flattened(value,prefix='',out={}){for(const [key,item]of Object.entries(value)){const name=prefix?prefix+'.'+key:key;if(item&&typeof item==='object'&&!Array.isArray(item))flattened(item,name,out);else out[name]=item;}return out;}
function differences(a,b){const left=flattened(a),right=flattened(b);return [...new Set([...Object.keys(left),...Object.keys(right)])].sort().filter(p=>left[p]!==right[p]).map(field=>({field,old:left[field]??null,current:right[field]??null}));}
const ledger=path.join(matrix.budget_root,'ledger/admission');
const launches=fs.readdirSync(ledger).filter(n=>/^launch-\d+\.json$/.test(n)).map(n=>({file:n,record:JSON.parse(fs.readFileSync(path.join(ledger,n)))}));
const oldFilesBefore={matrix:hash(matrixFile),selection:hash(selection.file)};
const rows=[];
for(const key of Object.keys(selection.manifest.routes)){
  const e=selectedEvidence(matrix.dynamic_root,selection,key);
  if(!e?.complete)throw Error('显式旧臂未完成，不回退');
  if(e.after.unchanged!==true||JSON.stringify(e.after.fingerprints)!==JSON.stringify(e.request.fingerprints))throw Error('历史臂自身漂移');
  const current=currentFingerprints(e.request),diff=differences(e.request.fingerprints,current);
  const records=launches.filter(l=>l.record.fingerprint_manifest===path.join(e.dir,'requested.json'));
  if(!records.length)throw Error('历史启动边界无原件');
  rows.push({key,source:{...e.ref,dir:e.dir},profile:e.request.profile,requested_model:e.request.model,
    historical_actual_model:e.result.readback?.model??null,current_cli_readback:null,server_identity:null,
    request_cli_version:e.request.cli_version_observed,entry_and_native_hash_equal:diff.every(d=>!['entry','native_entry'].includes(d.field)),
    differences:diff,full_fingerprint_equal:diff.length===0,current_admission_accepted:false,
    old_launches:records.map(l=>({file:l.file,sha256:hash(path.join(ledger,l.file)),cli:l.record.cli,kind:l.record.kind,code:l.record.code,spawned:l.record.spawned,boundary_parent:l.record.boundary_parent??null})),
    old_start_count:records.length});
}
const beforeBuild=JSON.parse(fs.readFileSync(path.join(repo,'doc/05_testing/evidence/agent-access-20261011-closeout-r4/build-stamp-only-comparison.json')));
if(hash(beforeBuild.old_file)!==beforeBuild.old_sha256)throw Error('FBB保留bundle改变');
const bundleFile=path.join(repo,'skills/dual-critic/scripts/trivium.cjs');
if(hash(bundleFile)!==checkpoint.bundle)throw Error('当前bundle改变');
const compiled=compareCompiledBytes(fs.readFileSync(beforeBuild.old_file),fs.readFileSync(bundleFile));
const selectedCombinations=['claude-qwen','codex-native-sol','codex-native-astra','codex-qwen','codex-kimi','codex-deepseek'];
const firstRows=rows.filter(r=>selectedCombinations.some(k=>r.key.startsWith(k+'-')));
if(firstRows.length!==19||firstRows.reduce((n,r)=>n+r.old_start_count,0)!==34)throw Error('第一组历史边界计数不符');
const versionJobs=[{key:'static-qwen-version',profile:'qwen',historical_start_count:1},
  ...[null,'qwen','kimi','deepseek'].map(profile=>({key:'static-codex-version',profile,historical_start_count:2}))];
const proposal={executed:false,prerequisites:['独立新增正式资格','完整C/code及逐条裁决、本轮普通code批准','最终安装及全指纹冻结','启动前发布精确variant/hash manifest与CLI扩容'],
  first_group:{combinations:selectedCombinations,capability_keys:firstRows.map(r=>r.key),logical_arms:19,expected_capability_starts:34,version_jobs:versionJobs,expected_version_starts:9,expected_total_starts:43,proposed_hard_max:55,
    optional_help:{starts:2,condition:'实际CLI能力/入口/TTL失效或缺新的必要证据时才追加；当前不自动复制旧全批help'}} ,
  held_groups:[{keys:['claude-qwen-pro-write','claude-kimi-write','claude-kimi-pro-write','claude-deepseek-write','claude-deepseek-pro-write'],reason:'生产guard无新机制时预启动拒绝，当前0新写启动'},
    {keys:['codex-native-luna-write','claude-kimi-deny-read'],reason:'缺实际写命令/缺.env Read尝试；没有新取证机制，不机械重试旧未测/失败臂'},
    {keys:['其余非flash Claude读取/禁读、Luna读取/事后检测'],reason:'第二组仅在能解决当前准入阻塞或经独立采用标准后细化，不用无意义全量刷新代替机制分析'}],
  criteria_changed:false,partial_results_do_not_complete_goal:true};
if(hash(matrixFile)!==oldFilesBefore.matrix||hash(selection.file)!==oldFilesBefore.selection)throw Error('历史原件变化');
const report={at:new Date().toISOString(),real_cli_starts:0,source_matrix_sha256:oldFilesBefore.matrix,source_selection_sha256:oldFilesBefore.selection,
  current_bundle_sha256:checkpoint.bundle,current_inputs:checkpoint.inputs,compiled,rows,unique_changed_fields:[...new Set(rows.flatMap(r=>r.differences.map(d=>d.field)))].sort(),
  old_files_unchanged:true,current_admission_accepted:false,component_context_inventory_complete:false,
  directory_fact_scope:'仅现有CLI/入口/native/路线配置/项目globs/形态/TTL绑定及当前生产消费；不升级成新bundle模型准入',
  formal:{used:14,limit:14,new_qualification_authorized:false},proposal,goal_complete:false};
saveEvidence(path.join(root,'current-evidence-impact-audit.json'),report);
console.log(JSON.stringify({old_arms_verified:rows.length,changed_fields:report.unique_changed_fields,compiled_bytes_equal:compiled.compiled_bytes_equal,planned_first_group:proposal.first_group,real_cli_starts:0,current_admission_accepted:false}));
