/** 本主题25B送审前静态核验；只消费现有生产枚举与守卫，不启动供应商。 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {loadCtx} from '../../../../dist/test/src/trivium/config.js';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {enumerateDenyPaths} from '../../../../dist/test/src/trivium/freeze.js';
import {findDenyConflicts,denyContextFor} from '../../../../dist/test/src/trivium/brief.js';
import {readTask} from '../../../../dist/test/src/trivium/meta.js';
import {listRecordedRuns} from '../../../../dist/test/src/trivium/archive.js';
import {scanSecrets} from '../../../../dist/test/src/trivium/secrets.js';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {readCurrentAuthorization,assertFormalRound} from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import {measureCodeStart,assertCodeStartMeasurement} from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口',read=p=>JSON.parse(fs.readFileSync(p,'utf8')),demand=(v,m)=>{if(!v)throw Error(m);};
const external=os.homedir()+'/.trivium/evidence/agent-access-20261011-closeout-r3';
const args=['review','--start','--entry','B','--stage','plan','--topic',topic,'--driver','codex','--critics','claude,gemini,glm'];
const ctx=await loadCtx(),resolved=read(root+'/plan25-resolved.json'),task=await readTask({archiveRoot:repo+'/.reviews',topic}),runs=await listRecordedRuns({archiveRoot:repo+'/.reviews',topic}),auth=readCurrentAuthorization();
demand(task.runs.length===24&&auth.new_limit===26&&assertFormalRound(auth,task,runs,args)===25&&!auth.criteria_change_authorized,'25B正式资格不符');
demand(hash(auth.supersedes_file)===auth.supersedes_sha256,'旧授权谱系变化');
const observation=read(root+'/config-after25-preflight-observation.json');
demand(observation.only_approved_auth_cache_checked_at_changed&&observation.changes.length===3&&observation.private_snapshot_removed&&observation.current_sha256===hash('.trivium/config.local.yaml'),'认证缓存差异或清理不符');
const stamp=await computeBuildStamp(repo),baseline=read('doc/05_testing/evidence/agent-access-20261011-closeout-r15/status-after-all-positive.json');
demand(!stamp.dirty&&stamp.git_head===baseline.source_head&&stamp.inputs_sha256===baseline.source_inputs&&hash('skills/dual-critic/scripts/trivium.cjs')===baseline.bundle_sha256,'生产安装输入变化');
function inventory(base,exclude=[]){const out=[];function walk(d,rel=''){for(const n of fs.readdirSync(d).sort()){if(!rel&&exclude.includes(n))continue;const full=path.join(d,n),rp=path.join(rel,n),s=fs.lstatSync(full);out.push({path:rp,mode:s.mode&0o7777,type:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':'file',sha256:s.isFile()?hash(full):null,link:s.isSymbolicLink()?fs.readlinkSync(full):null});if(s.isDirectory())walk(full,rp);}}walk(base);return out;}
const install=read(external+'/admission-after23-aa6db337/install-after23.json');demand(install.entries.length===28&&install.targets.length===4,'四目标入口数量不符');
demand(JSON.stringify(inventory(repo+'/skills/dual-critic',['entry']))===JSON.stringify(inventory(install.runtime_root)),'运行时资产变化');
for(const entry of install.entries)demand(JSON.stringify(inventory(entry.target))===JSON.stringify(entry.inventory),'入口内容变化');
for(const name of install.backup_names_verified){demand(!fs.existsSync(os.homedir()+'/.agents/skills/'+name),'共享入口复现');demand(JSON.stringify(inventory(install.backup+'/copied/'+name))===JSON.stringify(inventory(install.backup+'/moved/'+name)),'迁移备份变化');}
const batch=read(external+'/admission-after23-aa6db337/codex-refresh-batch.json');for(const[p,h]of Object.entries(batch.scripts))demand(hash(path.resolve(repo,p))===h,'生产脚本/全局配置变化');
const preflight=read(root+'/plan25-preflight-output.json');demand(preflight.ok&&preflight.exit_code===0,'预检未通过');
const conflicts={},deny_sources={};for(const critic of resolved.critics){const deny=await enumerateDenyPaths(ctx.config,repo,ctx.archiveRoot,critic,'codex',topic);deny_sources[critic]={count:deny.length};conflicts[critic]=resolved.context_paths.flatMap(p=>findDenyConflicts(p,deny,denyContextFor(ctx.config,repo,critic)));demand(conflicts[critic].length===0,'自动context撞禁读范围');}
const measurement=await measureCodeStart(repo,topic,args);assertCodeStartMeasurement(measurement);
const preserved=read(root+'/r17-preserved-snapshot.json');for(const[p,h]of Object.entries(preserved.hashes))demand(hash(path.join(preserved.root,p))===h,'r17原证据被修改');
const oldFreeze=read('doc/05_testing/evidence/agent-access-20261011-closeout-r14/frozen-before-round23.json');for(const[p,h]of Object.entries(oldFreeze.hashes))demand(hash('doc/05_testing/evidence/agent-access-20261011-closeout-r14/'+p)===h,'r14冻结原件变化');
const run24=read('.reviews/'+topic+'/plan/_meta/run-20261011T171203Z.json');for(const a of run24.artifacts)demand(hash('.reviews/'+a.path)===a.sha256,'24B审查原件变化');
demand(run24.status==='success'&&!run24.guard.readonly_breach&&!run24.guard.peer_read_detected&&!run24.snapshot.drift.changed&&run24.snapshot.tree_hash===run24.snapshot.after_tree_hash,'24B运行资格不符');
demand(task.gate.state==='approved'&&task.gate.run_id===run24.run_id,'24B未获批准');
demand(read('.reviews/'+topic+'/code/_meta/run-20261010T170416Z.json').status==='failed','原失效运行被修改');
const continuity=read('doc/05_testing/evidence/agent-access-20261011-closeout-r3/budget-continuity-r12.json');for(const e of continuity.files)for(const base of [continuity.source,continuity.destination])demand(hash(base+'/'+e.path)===e.sha256,'历史台账被修改');
const {openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs'),budgets={};for(const pool of ['admission','review']){const b=openBudget(external+'/budget',pool),names=fs.readdirSync(b.dir),used=names.filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed=names.filter(n=>/^launch-\d+\.json$/.test(n)).length;demand(used===completed,'CLI仍在途');budgets[pool]={used,completed,limit:b.limit()};}
demand(budgets.admission.used===732&&budgets.review.used===323&&budgets.review.limit===333,'本批累计基线变化');
let files=0,bytes=0;function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else if(e.isFile()){const b=fs.readFileSync(p);demand(scanSecrets(b.toString('utf8')).length===0,'证据脱敏扫描非零:'+p);files++;bytes+=b.length;}}}
for(const n of [15,16,17,18])scan(repo+'/doc/05_testing/evidence/agent-access-20261011-closeout-r'+n);
const original=read(root+'/plan25-original-archive.json').artifact;demand(original.absPath===resolved.subject_path&&hash(original.absPath)===original.sha256,'送审原稿变化');
const checks=read(root+'/static-checks.json');demand(checks.runs.every(r=>r.code===0&&!r.timed_out),'零CLI静态检查不符');
saveEvidence(root+'/static-audit-before25.json',{at:new Date().toISOString(),source_stamp:stamp,bundle_sha256:baseline.bundle_sha256,configs:{shared:hash('.trivium/config.yaml'),local:observation.current_sha256,globals:batch.configs.globals},measurement,context_conflicts:conflicts,deny_sources,install:{normal_four_targets:true,entries:28,sevenshared_backups_equal:true,client_name_resolution:null},formal:{used:24,limit:26,next:25,entry:'B',stage:'plan'},budgets,subject:original,preserved_r17_files:Object.keys(preserved.hashes).length,previous_run24_artifacts_unchanged:run24.artifacts.length,historical_budget_files_unchanged:continuity.files.length,old_failed_retained:true,scan:{files,bytes,secret_candidates:0},current_full_matrix:{passed:0,untested:12},historical_full_matrix:{passed:7,untested:5},new_mode_setting_implemented:false,criterion_adopted:false,new_vendor_starts:0});
console.log(JSON.stringify({settings_bytes:measurement.settings_bytes,compressed_tools:measurement.compressed_tools,context_conflicts:0,budgets,r17_preserved:Object.keys(preserved.hashes).length,scan:{files,bytes,secret_candidates:0},new_vendor_starts:0}));
