/** 21C静态审计：调用前完成；only read，输出经脱敏防覆盖。 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
import {readTask} from '../../../../dist/test/src/trivium/meta.js';
import {listRecordedRuns} from '../../../../dist/test/src/trivium/archive.js';
import {scanSecrets} from '../../../../dist/test/src/trivium/secrets.js';
import {readCurrentAuthorization,assertFormalRound} from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import {measureCodeStart,assertCodeStartMeasurement} from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),prior=path.join(root,'../agent-access-20261011-closeout-r3'),topic='Agent双模式接入真实准入收口';
const digest=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p)),demand=(ok,msg)=>{if(!ok)throw Error(msg)};
const scope=read(root+'/check-pair-r23-final-scope.json'),fingerprint=read(root+'/final-build-fingerprint-before21.json'),install=read(root+'/install-before21.json'),build=await computeBuildStamp(repo);
demand(scope.inputs.inputs_sha256===build.inputs_sha256&&fingerprint.embedded_inputs===build.inputs_sha256,'双check/最终build输入漂移');
for(const[f,h]of Object.entries(scope.hashes))demand(hash(f)===h,'已检查作用面变化');
demand(hash('skills/dual-critic/scripts/trivium.cjs')===fingerprint.bundle_sha256&&hash(install.runtime_root+'/scripts/trivium.cjs')===fingerprint.bundle_sha256,'源/安装包不同');
function inventory(base,exclude=[]){const a=[];function walk(dir,rel=''){for(const name of fs.readdirSync(dir).sort()){if(!rel&&exclude.includes(name))continue;const p=path.join(dir,name),r=path.join(rel,name),s=fs.lstatSync(p);a.push({path:r,mode:s.mode&0o7777,type:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':'file',sha256:s.isFile()?hash(p):null,link:s.isSymbolicLink()?fs.readlinkSync(p):null});if(s.isDirectory())walk(p,r)}}walk(base);return a;}
demand(JSON.stringify(inventory('skills/dual-critic',['entry']))===JSON.stringify(inventory(install.runtime_root)),'安装运行时全部资产变化');
for(const entry of install.entries)demand(JSON.stringify(inventory(entry.target))===JSON.stringify(entry.inventory),'28入口变化');
for(const name of install.backup_names_verified){let stat;try{stat=fs.lstatSync(path.join(os.homedir(),'.agents/skills',name))}catch(e){if(e.code!=='ENOENT')throw e}demand(!stat,'共享入口复现');demand(JSON.stringify(inventory(path.join(install.backup,'copied',name)))===JSON.stringify(inventory(path.join(install.backup,'moved',name))),'七备份不同')}
const old=read(root+'/../agent-access-20261011-closeout-r10/mature-refresh-batch.json');
for(const[f,h]of Object.entries(old.configs.globals))demand(hash(path.join(os.homedir(),f))===h,'全局配置改变');
demand(hash('.trivium/config.yaml')===old.configs.shared,'共享配置改变');
const observation=read(root+'/config-local-observation-before21.json');demand(hash('.trivium/config.local.yaml')===observation.current_sha256,'local采样变化');
const continuity=read(prior+'/budget-continuity-r12.json');for(const file of continuity.files)for(const base of[continuity.source,continuity.destination])demand(hash(path.join(base,file.path))===file.sha256,'旧台账改变');
for(const[dir,file]of[['agent-access-20261011-closeout-r7','frozen-before-round15.json'],['agent-access-20261011-closeout-r10','frozen-before-round19.json'],['agent-access-20261011-closeout-r11','frozen-before-round20.json']]){
 const frozen=read(root+'/../'+dir+'/'+file);for(const[f,h]of Object.entries(frozen.hashes))demand(hash(root+'/../'+dir+'/'+f)===h,'旧静态冻结改变');
}
const layout={archiveRoot:repo+'/.reviews',topic},task=await readTask(layout),runs=await listRecordedRuns(layout),auth=readCurrentAuthorization();
demand(task.runs.length===20&&runs.length===20&&runs.every(r=>!r.unreadable),'历史20运行不齐');
demand(auth.new_limit===21&&auth.delegated_round_extensions===true&&auth.delegation_exact_reply==='授权轮次可以按需增加，不必询问授权'&&auth.criteria_change_authorized===false,'独立轮次委托不符');
demand(hash(auth.supersedes_file)===auth.supersedes_sha256,'授权谱系漂移');
demand(task.approvals.some(a=>a.run_id==='20261011T113848Z'&&a.stage==='plan'&&a.decision==='approved'),'缺19B当前plan批准');
demand(assertFormalRound(auth,task,runs,['review','--start','--entry','C','--stage','code','--topic',topic,'--driver','codex','--critics','claude,gemini,glm'])===21,'21C资格拒绝');
const before=fs.readFileSync(prior+'/launch-v14.mjs','utf8'),after=fs.readFileSync(prior+'/launch-v15.mjs','utf8');demand(before.split('\n').slice(1).join('\n').replace('formal-round-authorization-v10.json','formal-round-authorization-v11.json')===after.split('\n').slice(1).join('\n'),'载体额外语义变化');
const guardBaseline=read(root+'/../agent-access-20261011-closeout-r8/static-audit-before16.json');
for(const name of['round-guard-v2.mjs','formal-start-precheck-v2.mjs']){const file=path.resolve(prior,name);demand(typeof guardBaseline.scripts[file]==='string'&&hash(file)===guardBaseline.scripts[file],'正式守卫hash变化')}
const freeze20=read(root+'/../agent-access-20261011-closeout-r11/frozen-before-round20.json');for(const[f,h]of Object.entries(freeze20.business_hashes).filter(([f])=>f.startsWith('src/')||['test/unit/agent-access-recovery.test.ts','test/unit/agent-access-task-launch.test.ts'].includes(f)))demand(hash(f)===h,'原生产guard/适配器/授权测试变动');
const evidenceText=fs.readFileSync('scripts/agent-access-evidence.mjs','utf8');demand(digest(Buffer.from(evidenceText.slice(evidenceText.indexOf('export function codexCommandEvidence('),evidenceText.indexOf('export function primaryLoaded('))))==='8662c80393311859b01731f780641647a1be7e89ee3ec186d767355f574b1479','原配对判据字节改变');
for(const run of['20261011T105033Z','20261011T113848Z','20261011T122355Z']){
 const stage=run==='20261011T113848Z'?'plan':'code',meta=read(repo+'/.reviews/'+topic+'/'+stage+'/_meta/run-'+run+'.json');
 for(const a of meta.artifacts)demand(hash(repo+'/.reviews/'+a.path)===a.sha256,'审查原件改变');
}
demand(hash(repo+'/.reviews/'+topic+'/plan/2026-10-11-'+topic+'-r22-codex.md')==='d3ffd5ede1f9037ded3c9b0c50fbfdc1b0728e10ae53caed291d77279fa9e8ac','获批完整r22改变');
const{openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs');
const budget=Object.fromEntries(['admission','review'].map(pool=>{const b=openBudget(old.budget_root,pool),names=fs.readdirSync(b.dir),res=names.filter(n=>/^reserved-\d+\.json$/.test(n)),done=names.filter(n=>/^launch-\d+\.json$/.test(n));demand(res.length===done.length&&res.every(n=>names.includes(n.replace('reserved-','launch-'))),'未完成CLI');return[pool,{used:res.length,completed:done.length,limit:b.limit()}]}));
demand(budget.admission.used===633&&budget.review.used>=253&&budget.review.used<=268&&budget.review.limit===273,'批预算不同');
for(const n of['check1-r23-final.json','check2-r23-final.json','selftest-r23-before21.json','installed-selftest-before21.json'])demand(read(root+'/'+n).code===0,'前置检查失败');
const measurement=await measureCodeStart(repo,topic,['--stage','code']);assertCodeStartMeasurement(measurement);
const findings=fs.readdirSync(root).filter(n=>fs.statSync(root+'/'+n).isFile()).flatMap(n=>scanSecrets(fs.readFileSync(root+'/'+n,'utf8')).map(f=>({file:n,kind:f.kind??null})));demand(findings.length===0,'静态凭据扫描非零');
saveEvidence(root+'/static-audit-before21.json',{at:new Date().toISOString(),new_vendor_cli_starts:0,formal:{used:20,limit:21,next:21,entry:'C',driver:'codex',critics:['claude','gemini','glm'],history_ids:runs.map(r=>r.run_id),plan_approval:'20261011T113848Z',delegation_exact_reply:auth.delegation_exact_reply},budget,source_stamp:build,bundle:fingerprint.bundle_sha256,inputs:build.inputs_sha256,scope_hashes:scope.hashes,measurement,installation:{status:install.status,entries:28,backup:install.backup,shared_absent:true,global_config_unchanged:true,client_resolution:null},local_config_observation:observation,checks:scope.checks,current_original_matrix:{passed:0,failed:0,untested:12},historical_05:{passed:5,failed:1,untested:6},old_static_files_unchanged:92,historical_budget_files_unchanged:continuity.files.length,original_criteria_unchanged:true,guard_precheck_semantics_unchanged:true,secret_findings:findings,criteria_changed:false,goal_complete:false});
console.log(JSON.stringify({formal:'20/21',budget,inputs:build.inputs_sha256,settings_bytes:measurement.settings_bytes,source_paths:measurement.source_paths_count,secret_findings:0}));
