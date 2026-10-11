/** 16B前静态核验；不运行厂商CLI、不改历史原件或判据。 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import{createRequire}from'node:module';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { readCurrentAuthorization, assertFormalRound } from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import { measureCodeStart, assertCodeStartMeasurement } from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),r7=path.join(root,'../agent-access-20261011-closeout-r7'),prior=path.join(root,'../agent-access-20261011-closeout-r3'),topic='Agent双模式接入真实准入收口';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),demand=(v,m)=>{if(!v)throw Error(m);};
const audit=read(path.join(r7,'final-admission15-audit.json')),build=await computeBuildStamp(repo),batch=read(path.join(r7,'admission15-minimal-first-batch.json'));
demand(build.inputs_sha256===audit.inputs&&sha('skills/dual-critic/scripts/trivium.cjs')===audit.bundle,'源码包变动');
for(const [f,h]of Object.entries(batch.scripts))demand(sha(f)===h,'原取证配方变化');
for(const [f,h]of Object.entries(batch.configs.globals))demand(sha(path.join(os.homedir(),f))===h,'全局配置变化');
demand(sha('.trivium/config.yaml')===batch.configs.shared&&sha('.trivium/config.local.yaml')===batch.configs.local,'项目配置变化');
const frozen=read(path.join(r7,'frozen-before-round15.json'));for(const [f,h]of Object.entries(frozen.hashes))demand(sha(path.join(r7,f))===h,'旧被审静态变化');
const continuity=read(path.join(prior,'budget-continuity-r12.json'));for(const f of continuity.files)for(const base of [continuity.source,continuity.destination])demand(sha(path.join(base,f.path))===f.sha256,'旧台账变动');
const installed=read(path.join(r7,'install-before15.json'));
function inventory(base,exclude=[]){const a=[];function walk(p,rel=''){for(const n of fs.readdirSync(p).sort()){if(!rel&&exclude.includes(n))continue;const f=path.join(p,n),r=path.join(rel,n),s=fs.lstatSync(f);a.push({path:r,mode:s.mode&0o7777,type:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':'file',sha256:s.isFile()?sha(f):null,link:s.isSymbolicLink()?fs.readlinkSync(f):null});if(s.isDirectory())walk(f,r);}}walk(base);return a;}
demand(sha(path.join(installed.runtime_root,'scripts/trivium.cjs'))===audit.bundle,'安装bundle变化');demand(JSON.stringify(inventory('skills/dual-critic',['entry']))===JSON.stringify(inventory(installed.runtime_root)),'运行时资产变化');
for(const e of installed.entries)demand(JSON.stringify(inventory(e.target))===JSON.stringify(e.inventory),'专用入口变化');
for(const n of installed.backup_names_verified){demand(!fs.existsSync(path.join(os.homedir(),'.agents/skills',n)),'共享入口复现');demand(JSON.stringify(inventory(path.join(installed.backup,'copied',n)))===JSON.stringify(inventory(path.join(installed.backup,'moved',n))),'备份变化');}
const layout={archiveRoot:path.join(repo,'.reviews'),topic},task=await readTask(layout),runs=await listRecordedRuns(layout),auth=readCurrentAuthorization();
demand(task.runs.length===15&&runs.length===15&&auth.new_limit===17&&auth.delegated_round_extensions===true,'正式权威不符');
const args=['review','--start','--entry','B','--stage','plan','--topic',topic,'--driver','codex','--critics','claude,gemini,glm'];demand(assertFormalRound(auth,task,runs,args)===16,'16B拒绝');
demand(sha(path.resolve(auth.supersedes_file))===auth.supersedes_sha256,'v8谱系失效');
const {openBudget}=createRequire(import.meta.url)('../../../../scripts/agent-access-budget.cjs'),budget=Object.fromEntries(['admission','review'].map(pool=>{const b=openBudget(batch.budget_root,pool),names=fs.readdirSync(b.dir),res=names.filter(n=>/^reserved-\d+\.json$/.test(n)),com=names.filter(n=>/^launch-\d+\.json$/.test(n));demand(res.length===com.length&&res.every(n=>names.includes(n.replace('reserved-','launch-'))),'未收尾启动');return[pool,{used:res.length,completed:com.length,limit:b.limit()}];}));
demand(budget.admission.used===590&&budget.review.used===193,'静态期新增CLI');
const measurement=await measureCodeStart(repo,topic,['--stage','code']);assertCodeStartMeasurement(measurement);
const scripts=Object.fromEntries(['scripts/agent-access-closeout.mjs','scripts/agent-access-evidence.mjs','scripts/agent-access-recipes.mjs','test/unit/agent-access-recovery.test.ts',...['launch-v11.mjs','launch-v12.mjs','round-guard-v2.mjs','formal-start-precheck-v2.mjs','formal-round-authorization-v7.json','formal-round-authorization-v8.json','formal-round-authority.json'].map(n=>path.join(prior,n))].map(f=>[f,sha(f)]));
const findings=fs.readdirSync(root).filter(n=>fs.statSync(path.join(root,n)).isFile()).flatMap(n=>scanSecrets(fs.readFileSync(path.join(root,n),'utf8')).map(f=>({file:n,kind:f.kind??null})));demand(findings.length===0,'静态凭据扫描非零');
saveEvidence(path.join(root,'static-audit-before16.json'),{at:new Date().toISOString(),vendor_cli_starts:0,formal:{used:15,limit:17,next:16,entry:'B',stage:'plan',delegation_exact_reply:auth.delegation_exact_reply,history_ids:runs.map(r=>r.run_id)},budget,bundle:audit.bundle,inputs:build.inputs_sha256,head:build.git_head,dirty:build.dirty,old_scripts_unchanged:true,scripts,old_frozen_unchanged:29,historical_budget_files_unchanged:976,measurement,installation:{status:installed.status,entries:28,backup:installed.backup,shared_absent:true,global_config_unchanged:true,client_resolution:null},matrix:{file:path.join(r7,'matrix-admission15.json'),sha256:sha(path.join(r7,'matrix-admission15.json')),passed:5,failed:1,untested:6,source:'原v11和完整874指纹采样；新任务书未实施/未测'},checks:'原3153/3/0 x2串行，v8新测试尚待计划批准后更新',stub:'原源/安装14/14',secret_findings:findings,criteria_changed:false,goal_complete:false});
console.log(JSON.stringify({formal:'15/17',budget,bundle:audit.bundle,settings_bytes:measurement.settings_bytes,source_paths:measurement.source_paths_count,secret_findings:0,old_budget_files:976,new_vendor_starts:0}));
