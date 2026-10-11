/** 批后零厂商CLI审计；只读原件，输出新脱敏证据，不改准入判据。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { loadSelection, selectedEvidence, nativeVersionFromLedger } from '../../../../scripts/agent-access-selection.mjs';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { assertFormalRound, readCurrentAuthorization } from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const demand=(ok,msg)=>{if(!ok)throw Error(msg);};
const batch=read(path.join(root,'admission15-minimal-first-batch.json')),matrix=read(path.join(root,'matrix-admission15.json'));
const external=batch.evidence_root,prior=path.join(root,'../agent-access-20261011-closeout-r3');
const build=read(path.join(root,'final-build-fingerprint-before15.json')),stamp=await computeBuildStamp(repo);
demand(sha('skills/dual-critic/scripts/trivium.cjs')===build.bundle_sha256&&stamp.inputs_sha256===build.source_stamp.inputs_sha256,'当前源码/包变化');
for(const [f,h]of Object.entries(batch.scripts))demand(sha(f)===h,'批脚本变化');
demand(sha('.trivium/config.yaml')===batch.configs.shared&&sha('.trivium/config.local.yaml')===batch.configs.local,'项目配置变化');
for(const [f,h]of Object.entries(batch.configs.globals))demand(sha(path.join(os.homedir(),f))===h,'全局配置变化');
const frozen=read(path.join(root,'frozen-before-round15.json'));
for(const [f,h]of Object.entries(frozen.hashes))demand(sha(path.join(root,f))===h,'审前静态原件被改');
const checkpoint=read(path.join(root,'../agent-access-20261011-closeout-r6/post14-checkpoint.json'));
for(const [f,h]of Object.entries(checkpoint.scripts).filter(([f])=>f!=='formal-round-authority.json'))demand(sha(path.join(prior,f))===h,'历史脚本/授权被改');
const continuity=read(path.join(prior,'budget-continuity-r12.json'));
for(const f of continuity.files){demand(sha(path.join(continuity.source,f.path))===f.sha256,'旧台账源变化');demand(sha(path.join(continuity.destination,f.path))===f.sha256,'延续台账旧字节变化');}
const layout={archiveRoot:path.join(repo,'.reviews'),topic},task=await readTask(layout),runs=await listRecordedRuns(layout);
demand(task.runs.length===15&&runs.length===15,'正式计数异常');
const approval=task.approvals.find(a=>a.run_id==='20261011T083951Z'&&a.stage==='code'&&a.decision==='approved');
demand(approval&&task.approvals.some(a=>a.run_id==='20261011T070836Z'&&a.stage==='code'&&a.decision==='rejected'),'本轮批准/旧拒绝缺失');
let sixteenthDenied=false;try{assertFormalRound(readCurrentAuthorization(),task,runs,['review','--start','--entry','C','--stage','code','--topic',topic,'--driver','codex','--critics','claude,gemini,glm']);}catch{sixteenthDenied=true;}
demand(sixteenthDenied,'当前权威未拒16');
const {openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs');
const budget=Object.fromEntries(['admission','review'].map(pool=>{const b=openBudget(batch.budget_root,pool),names=fs.readdirSync(b.dir),reserved=names.filter(n=>/^reserved-\d+\.json$/.test(n)),completed=names.filter(n=>/^launch-\d+\.json$/.test(n));demand(reserved.length===completed.length&&reserved.every(n=>names.includes(n.replace('reserved-','launch-'))),'有未收尾启动');return[pool,{used:reserved.length,completed:completed.length,limit:b.limit()}];}));
demand(budget.admission.used===590&&budget.review.used===193,'非预期新CLI启动');
const dispatch=['versions','capabilities'].flatMap(mode=>{const d=read(path.join(root,`admission15-${mode}-dispatch.json`));demand(d.queue_complete&&d.errors.length===0&&d.automatic_retry===false,'批队列不完整');return d.results;});
demand(dispatch.length===24,'批逻辑调用计数');
const ledgerDir=path.join(batch.budget_root,'ledger/admission'),records=fs.readdirSync(ledgerDir).filter(n=>/^launch-\d+\.json$/.test(n)).map(n=>({file:path.join(ledgerDir,n),value:read(path.join(ledgerDir,n))}));
const calls=[];
for(const d of dispatch){demand(d.code===0&&d.signal===null,'逻辑调用未正常完成');
  const matches=fs.readdirSync(path.join(external,'calls')).filter(n=>n.startsWith(d.label+'-')&&n.endsWith('-completed.json'));demand(matches.length===1,'本批completed非唯一');
  const file=path.join(external,'calls',matches[0]),c=read(file),requestFile=file.replace(/-completed\.json$/,'-requested.json'),request=read(requestFile);
  demand(c.primary_loaded===true&&c.code===0&&c.signal===null&&c.load_id===request.load_id&&c.label===request.label,'侧车装载或请求配对异常');
  demand(c.installed_bundle_sha256===build.bundle_sha256&&c.build_inputs_observed.inputs_sha256===stamp.inputs_sha256,'调用包/输入不符');
  for(const [k,v]of Object.entries(request))demand(JSON.stringify(c[k])===JSON.stringify(v),'调用完成件改变请求字段');
  const launches=records.filter(r=>r.value.label===d.label&&r.value.load_id===c.load_id);demand(launches.length===d.starts,'实际启动边界计数不符');
  demand(launches.every(r=>r.value.spawned===true&&r.value.code===0&&r.value.signal===null&&r.value.error_code===null),'厂商启动失败');
  calls.push({label:d.label,load_id:c.load_id,requested:{file:requestFile,sha256:sha(requestFile)},completed:{file,sha256:sha(file)},starts:launches.length,ledger:launches.map(r=>({file:r.file,sha256:sha(r.file),index:r.value.index,cli:r.value.cli,boundary_parent:r.value.boundary_parent}))});
}
demand(new Set(calls.map(c=>c.load_id)).size===24&&calls.reduce((n,c)=>n+c.starts,0)===43,'批token或启动总数不符');
const selection=loadSelection(path.join(root,'selection-admission15-all.json')),routeRecords=[],scannedFiles=new Set();
for(const [kind,refs]of [['routes',selection.manifest.routes],['versions',selection.manifest.versions]])for(const [key,ref]of Object.entries(refs)){
  const e=selectedEvidence(external,selection,key,kind);demand(e?.complete&&e.after.unchanged===true,'所选臂未完成/漂移');
  demand(e.request.build_inputs.inputs_sha256===stamp.inputs_sha256&&e.request.fingerprints.assets['skills/dual-critic/scripts/trivium.cjs']===build.bundle_sha256,'所选臂包/输入不符');
  for(const [f,h]of Object.entries(e.request.fingerprints.modules))demand(sha(f)===h,'取证执行模块变化');
  for(const [f,h]of Object.entries(e.request.fingerprints.assets))demand(sha(f)===h,'取证资产变化');
  for(const f of fs.readdirSync(e.dir))if(fs.statSync(path.join(e.dir,f)).isFile())scannedFiles.add(path.join(e.dir,f));
  if(kind==='routes'){
    const cleanup=read(path.join(e.dir,'cleanup.json')),before=read(path.join(e.dir,'fixture-before.json'));
    demand(cleanup.fixture_residue===null&&cleanup.scratch_removed===true&&!fs.existsSync(before.root),'夹具/临时目录残留');
    if(e.request.agent==='codex'){const credentials=read(path.join(e.dir,'credential-cleanup.json'));demand(credentials.errors.length===0&&credentials.skipped===0&&credentials.deleted.includes('codexhome/auth.json'),'凭据清理缺失/失败');}
    routeRecords.push({key,variant:ref.variant,reference:ref,completed:true,cleanup:true,fixture_removed:true});
  }
}
demand(routeRecords.length===19,'当前能力臂计数');
for(const profile of ['native','qwen','kimi','deepseek']){const p=loadSelection(path.join(root,`selection-admission15-${profile}.json`)),v=selectedEvidence(external,p,'static-codex-version','versions');demand(v.complete&&v.after.unchanged===true,'分profile版本异常');nativeVersionFromLedger(batch.budget_root,path.join(v.dir,'requested.json'),v.result.native_version_reference);for(const f of fs.readdirSync(v.dir))if(fs.statSync(path.join(v.dir,f)).isFile())scannedFiles.add(path.join(v.dir,f));}
const installed=read(path.join(root,'install-before15.json'));
function inventory(base,exclude=[]){const values=[];function walk(current,rel=''){for(const name of fs.readdirSync(current).sort()){if(!rel&&exclude.includes(name))continue;const file=path.join(current,name),relative=path.join(rel,name),s=fs.lstatSync(file);values.push({path:relative,mode:s.mode&0o7777,type:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':'file',sha256:s.isFile()?sha(file):null,link:s.isSymbolicLink()?fs.readlinkSync(file):null});if(s.isDirectory())walk(file,relative);}}walk(base);return values;}
demand(sha(path.join(installed.runtime_root,'scripts/trivium.cjs'))===build.bundle_sha256,'安装包变化');
demand(JSON.stringify(inventory('skills/dual-critic',['entry']))===JSON.stringify(inventory(installed.runtime_root)),'运行时资产变化');
for(const e of installed.entries)demand(JSON.stringify(inventory(e.target))===JSON.stringify(e.inventory),'专用入口变化');
for(const name of installed.backup_names_verified){demand(!fs.existsSync(path.join(os.homedir(),'.agents/skills',name)),'共享重名复现');demand(JSON.stringify(inventory(path.join(installed.backup,'copied',name)))===JSON.stringify(inventory(path.join(installed.backup,'moved',name))),'备份不一致');}
for(const c of calls){scannedFiles.add(c.requested.file);scannedFiles.add(c.completed.file);for(const l of c.ledger)scannedFiles.add(l.file);}
for(const f of fs.readdirSync(root))if(fs.statSync(path.join(root,f)).isFile())scannedFiles.add(path.join(root,f));
const secrets=[];for(const f of scannedFiles)for(const finding of scanSecrets(fs.readFileSync(f,'utf8')))secrets.push({file:f,kind:finding.kind??null});demand(secrets.length===0,'证据secret扫描非零');
const counts=Object.fromEntries(['通过','未通过','未测'].map(s=>[s,matrix.rows.filter(r=>r.status===s).length]));demand(counts['通过']===5&&counts['未通过']===1&&counts['未测']===6,'矩阵计数不符');
const audit={at:new Date().toISOString(),script_sha256:sha(new URL(import.meta.url)),vendor_cli_starts:0,bundle:build.bundle_sha256,inputs:stamp.inputs_sha256,head:stamp.git_head,dirty:stamp.dirty,budget,new_admission_starts:43,logical_calls:24,calls,routes:routeRecords,formal:{used:15,limit:15,sixteenth_denied:true,run_id:'20261011T083951Z',approval,historical_ids:runs.map(r=>r.run_id)},checks:'3153/3/0 x2串行',source_stub:'14/14',installed_stub:'14/14',installation:{status:installed.status,entries:28,backup:installed.backup,seven_shared_absent:true,runtime_assets_current:true,global_configs_unchanged:true,client_resolution:null},historical_budget_files_unchanged:continuity.files.length,frozen_static_files_unchanged:Object.keys(frozen.hashes).length,old_scripts_unchanged:true,old_failed_review_preserved:true,selection:{file:selection.file,sha256:selection.sha256,no_old_success_fallback:true},matrix:{file:'matrix-admission15.json',sha256:sha(path.join(root,'matrix-admission15.json')),counts},secret_scan:{files:scannedFiles.size,findings:secrets},criteria_changed:false,goal_complete:false,m11_step12_started:false,remaining:batch.held,official_claude:'未测：订阅未恢复',server_identity:null};
saveEvidence(path.join(root,'final-admission15-audit.json'),audit);
const gaps={'claude-qwen-pro':'生产写实际调用未取得','claude-kimi':'.env Read及生产写实际调用未取得','claude-kimi-pro':'生产写实际调用未取得','claude-deepseek':'生产写实际调用未取得','claude-deepseek-pro':'当前指纹生产写未测；旧样本不追认','codex-native-luna':'生产写未有真实command_execution','codex-qwen':'精确读取、Schema及首词失败；写和事后禁读检测通过'};
const planned=read(path.join(root,'pre-round15-admission-matrix.json')).rows;
const table=['# 当前真实准入矩阵：第15C批准后的874e4160完整指纹','',`采样${audit.at}；HEAD ${stamp.git_head}，dirty=${stamp.dirty}；bundle ${build.bundle_sha256}；inputs ${stamp.inputs_sha256}。原12组合按实际19臂重算：5通过/1未通过/6未测，旧H和848结果保留原件，未填入当前列。`,'','| 路线/组合 | 计划目标模型 | 本批请求model/effort | CLI实际model/effort | 配置声明 | 当前结果/缺口 | 服务端身份 |','| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',...matrix.rows.map(r=>`| ${r.agent}/${r.combination} | ${planned.find(p=>p.agent===r.agent&&p.combination===r.combination)?.request.model??'null'} | ${r.model_requested??'null'}/${r.effort_requested??'null'} | ${r.model_effective??'null'}/${r.effort_effective??'null'} | 见matrix-admission15.json及审前逐文件声明/hash | ${r.status}；${gaps[`${r.agent}-${r.combination}`]??'受测读取/Schema/实际写拒绝/禁读与MCP/指纹通过'} | null |`),'',`正式15/15，第15C有效、逐条裁决、普通code批准；预算admission ${budget.admission.used}/${budget.admission.limit}、review ${budget.review.used}/${budget.review.limit}，完成件齐备，本批新增43/0。CLI Claude2.1.296、Codex0.162.1；请求effort无声明，回读值只来自实际trace。配置provider和model声明、CLI provider及来源详见JSON，服务端身份无证据null。`,`最终串行双遍3153通过/3跳过/0失败，源/安装桩各14/14；正常四目标安装28入口及备份/全局配置hash复核，客户端技能名解析仍未测。审前29静态文件及${continuity.files.length}旧台账字节未变；本批24逻辑调用/43实际启动、19夹具清理和Codex凭据清理已核，扫描${scannedFiles.size}文件0发现。`,'','Codex禁读为实际命令事后检测，不宣称CLI阻止读取；Claude通过只覆盖已测精确路径实际Read/Grep配对拒绝。当前全部未测组合身份回读null，计划目标不冒充实际请求。官方Claude订阅未恢复，未测。component/restricted判据候选未采用；原生产写须真实模型尝试、唯一ID精确配对拒绝及文件前后状态。未新增effort/版本或修改全局配置。','', '七条整改及逐项验证见REPORT_2026-10-11_agent_access_recovery.md原逐项表；15C原件和r7-response-codex不改写。仍需新取证机制正式计划及完整代码审查的独立轮数授权；详见post-round15-read-evidence-plan-proposal.md，未获独立判据授权不能采用替代标准。七路线/Qwen pro/官方档位边界及实际调用缺口未全满足，目标未完成，不进入M11第12步。'].join('\n')+'\n';
demand(scanSecrets(table).length===0,'表格secret');fs.writeFileSync(path.join(root,'matrix-admission15.md'),table,{flag:'wx',mode:0o600});
console.log(JSON.stringify({counts,budget,new_admission_starts:43,logical_calls:24,cleanup:19,old_budget_files:continuity.files.length,secret_files:scannedFiles.size,secret_findings:0,goal_complete:false}));
