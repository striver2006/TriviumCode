/** 补修后零CLI交接：不切授权、不启动15，分列当前准入与历史模型回读。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { resolveClaudeRoute } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { codexAdapter } from '../../../../dist/test/src/trivium/adapters/codex.js';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { assertFormalRound } from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import { measureCodeStart, assertCodeStartMeasurement } from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口';
const read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=read('pre-round14-state.json'),scope=read('check-pair-post14-scope.json');
for(const [file,hash] of Object.entries(scope.hashes))if(sha(file)!==hash)throw Error('最终检查作用面变化');
const stamp=await computeBuildStamp(repo);
if(stamp.inputs_sha256!==scope.inputs.inputs_sha256)throw Error('最终检查输入变化');
const checks=['check1-r18-post14.json','check2-r18-post14.json'].map(n=>({file:n,...read(n)}));
for(const c of checks)if(c.code!==0||!c.stdout.includes('ℹ pass 3152')||!c.stdout.includes('ℹ skipped 3')||!c.stdout.includes('ℹ fail 0'))throw Error('最终双遍结果不符');
if(Date.parse(checks[0].finished_at)>Date.parse(checks[1].started_at))throw Error('两遍不是串行');
for(const n of ['selftest-r18-post14.json','installed-selftest-post14.json'])if(read(n).code!==0||!read(n).stdout.includes('14/14'))throw Error('桩结果不符');
const installed=read('install-post14.json'),build=read('final-build-fingerprint-post14.json');
if(installed.status!=='four-target-install-verified'||installed.entries.length!==28||installed.source_sha256!==installed.runtime_sha256||installed.source_sha256!==build.bundle_sha256)throw Error('安装不符');
if(JSON.stringify(installed.globalsBefore)!==JSON.stringify(installed.globalsAfter)||JSON.stringify(installed.globalsAfter)!==JSON.stringify(before.global_config_before_after))throw Error('全局配置变化');
const prior=path.join(repo,'doc/05_testing/evidence/agent-access-20261011-closeout-r3');
for(const [n,h] of Object.entries(before.scripts))if(sha(path.join(prior,n))!==h)throw Error('历史脚本/授权字节变化');
const layout={archiveRoot:path.join(repo,'.reviews'),topic},task=await readTask(layout),runs=await listRecordedRuns(layout);
if(task.runs.length!==14||runs.length!==14||!task.approvals.some(a=>a.run_id==='20261011T070836Z'&&a.stage==='code'&&a.decision==='rejected'))throw Error('14C资格/拒绝原件不符');
const authorization=JSON.parse(fs.readFileSync(path.join(prior,'formal-round-authorization-v6.json')));
let fifteenthDenied=false;try{assertFormalRound(authorization,task,runs,['review','--start','--entry','C','--stage','code','--topic',topic,'--driver','codex','--critics','claude,gemini,glm','--base','39ed20530d64a72f81f183095c6d9516632d0228']);}catch{fifteenthDenied=true;}
if(!fifteenthDenied)throw Error('未授权15未被拒绝');
const budgetRoot=path.join(os.homedir(),'.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const budget=Object.fromEntries(['review','admission'].map(pool=>{const b=openBudget(budgetRoot,pool),names=fs.readdirSync(b.dir);const reserved=names.filter(n=>/^reserved-\d+\.json$/.test(n));const completed=names.filter(n=>/^launch-\d+\.json$/.test(n));
  if(reserved.length!==completed.length||reserved.some(n=>!names.includes(n.replace('reserved-','launch-'))))throw Error('预算未收尾');return[pool,{used:reserved.length,completed:completed.length,limit:b.limit()}];}));
if(budget.review.used!==178||budget.admission.used!==547)throw Error('非预期CLI启动');
const measurement=await measureCodeStart(repo,topic,['--stage','code']);assertCodeStartMeasurement(measurement);
const {config}=await loadCtx({cwd:repo});
function topDeclarations(file){if(!fs.existsSync(file))return null;const values={model:null,model_provider:null,model_reasoning_effort:null};for(const line of fs.readFileSync(file,'utf8').split('\n')){if(/^\s*\[/.test(line))break;const m=/^\s*(model|model_provider|model_reasoning_effort)\s*=\s*['"]([\w./:+-]+)['"]\s*(?:#.*)?$/.exec(line);if(m)values[m[1]]=m[2];}return values;}
const definitions=[
  ['claude','qwen','qwen','qwen3.8-flash','新完整指纹下读取/Schema/实际写/禁读配对'],
  ['claude','qwen-pro','qwen','qwen3.8-max','生产写实际尝试未取得'],
  ['claude','kimi','kimi','kimi-for-coding','.env Read实际尝试及生产写未测'],
  ['claude','kimi-pro','kimi','k3','生产写实际尝试未取得'],
  ['claude','deepseek','deepseek','deepseek-flash','生产写实际尝试未取得'],
  ['claude','deepseek-pro','deepseek','deepseek-v4-pro','旧写样本不能补当前完整指纹'],
  ['codex','native-sol',null,'gpt-6.1-sol','新指纹下标准三臂待刷新'],
  ['codex','native-luna',null,'gpt-6-luna','生产写无command_execution'],
  ['codex','native-astra',null,'gpt-6-astra','新指纹下标准三臂待刷新'],
  ['codex','qwen','qwen','qwen3.8-flash','单cat精确读取配方有效，仅旧采样'],
  ['codex','kimi','kimi','kimi-for-coding','新指纹下标准三臂待刷新'],
  ['codex','deepseek','deepseek','deepseek-flash','单cat精确读取配方有效，仅旧采样']];
const historicalPass=new Set(['claude-qwen','codex-native-sol','codex-native-astra','codex-qwen','codex-kimi','codex-deepseek']);
const rows=definitions.map(([agent,combination,profile,model,gap])=>{
  const route=agent==='claude'?resolveClaudeRoute(config,profile):null;
  const access=agent==='codex'?codexAdapter.accessFor(config,profile):null;
  const declarations=agent==='claude'?{models:route.modelsDeclared,provider:route.providerDeclared,configuration_sha256:route.configurationSha256}:
    {provider:access.provider_declared,configuration_sha256:access.configuration_sha256,files:['config.toml',...(profile?[`${profile}.config.toml`]:[])].map(n=>({file:n,sha256:fs.existsSync(path.join(os.homedir(),'.codex',n))?sha(path.join(os.homedir(),'.codex',n)):null,top_level:topDeclarations(path.join(os.homedir(),'.codex',n))}))};
  return {agent,combination,request:{profile,model,effort:null},configuration_declaration:declarations,current_cli_readback:{model:null,provider:null,effort:null},server_identity:null,current_complete_status:'未测',historical_cli_model:model,historical_model_source:'848历史envelope/trace/session，不是本版本准入',historical_complete_status:historicalPass.has(`${agent}-${combination}`)?'通过':'未测',gap,reusable_evidence:'历史原始轨迹、枚举与单cat/目录事实机制；完整模型准入不追认',necessary_new_starts_now:0};
});
const matrix={at:new Date().toISOString(),bundle:build.bundle_sha256,inputs:stamp.inputs_sha256,head:stamp.git_head,dirty:stamp.dirty,rows,official_claude:{requested_model:null,configuration_declaration:null,cli_readback:null,server_identity:null,status:'未测：订阅未恢复'},current_complete:{passed:0,untested:12,failed:0},budget,criteria_change_authorized:false,goal_complete:false};
saveEvidence(path.join(root,'post14-current-admission-matrix.json'),matrix);
const table=['# 补修后当前完整准入矩阵（正式15待独立授权）','',`bundle ${build.bundle_sha256}；inputs ${stamp.inputs_sha256}；HEAD ${stamp.git_head}，dirty=${stamp.dirty}。当前真实准入新增0，全部12组合未测；服务端身份全null。配置声明详情与hash在同名JSON，只摘非敏感model/provider/effort键。`,'','| 路线 | 请求模型/effort | 配置声明 | 当前CLI回读 | 服务端身份 | 历史CLI模型/848完整结果 | 当前完整结果/缺口 | 当前必要新增 |','| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',...rows.map(r=>`| ${r.agent}/${r.combination} | ${r.request.model}/null | 见JSON逐文件声明 | null | null | ${r.historical_cli_model}/${r.historical_complete_status} | 未测；${r.gap} | 0；有效code批准后按影响编批 |`),'','官方Claude：订阅未恢复，所有身份字段null，未测。旧H5/5/2及848的6/6结果按历史采样保留，不填当前列。原生产写须实际模型调用、唯一ID配对拦截、实际cwd精确目标和前后状态；五Claude非flash写无新机制不重复提示，Luna写及Kimi.env Read缺口独立保留。两项判据候选未采用。Codex禁读为事后检测；客户端实际入口重名解析未测。',`预算：review ${budget.review.used}/${budget.review.limit}，admission ${budget.admission.used}/${budget.admission.limit}；两池完成件分别${budget.review.completed}/${budget.admission.completed}，没有未收尾启动。正式14/14用满，仅请求追加单次15C，未授权/未启动，目标未完成。`].join('\n')+'\n';
if(scanSecrets(table).length)throw Error('matrix secret');fs.writeFileSync(path.join(root,'post14-current-admission-matrix.md'),table,{flag:'wx',mode:0o600});
const secretFindings=fs.readdirSync(root).filter(n=>fs.statSync(path.join(root,n)).isFile()).flatMap(n=>scanSecrets(fs.readFileSync(path.join(root,n),'utf8')).map(f=>({file:n,...f})));
if(secretFindings.length)throw Error('新证据扫描非零');
saveEvidence(path.join(root,'post14-checkpoint.json'),{at:new Date().toISOString(),formal:{used:14,limit:14,fifteenth_denied:true,new_round_authorized:false,ids:runs.map(r=>r.run_id)},approvals:task.approvals.filter(a=>['20261011T061256Z','20261011T070836Z'].includes(a.run_id)),budget,bundle:build.bundle_sha256,inputs:stamp.inputs_sha256,measurement,checks:checks.map(c=>({file:c.file,code:c.code,pass:3152,skipped:3,failed:0,sha256:sha(path.join(root,c.file))})),source_stub:'14/14',installed_stub:'14/14',installation:{status:installed.status,entries:28,shared_absent:true,backup:installed.backup,global_config_unchanged:true,client_name_resolution:null},scripts:Object.fromEntries(['quiet-launch-v8.mjs',...Object.keys(before.scripts)].map(n=>[n,sha(path.join(prior,n))])),old_scripts_authority_unchanged:true,secret_findings:secretFindings,admission_new_starts:0,criteria_change_authorized:false,matrix:'post14-current-admission-matrix.json',goal_complete:false});
console.log(JSON.stringify({checks:'3152/3/0 x2',source_stub:'14/14',installed_stub:'14/14',entries:28,bundle:build.bundle_sha256,measurement_paths:measurement.source_paths_count,settings_bytes:measurement.settings_bytes,secret_findings:0,formal:'14/14',next:'15C待独立授权',budget}));
