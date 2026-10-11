/** 14C前静态事实收口：全量检查/安装/旧脚本/预算/目录消费，零厂商CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { readTask } from '../../../../dist/test/src/trivium/meta.js';
import { listRecordedRuns } from '../../../../dist/test/src/trivium/archive.js';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { assertFormalRound } from '../agent-access-20261011-closeout-r3/round-guard-v2.mjs';
import { measureCodeStart, assertCodeStartMeasurement } from '../agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const checks=['check1-r18-2','check2-r18-1','selftest-r18-1','finalbuild-r18-1','installed-selftest-r18'];
const records=Object.fromEntries(checks.map(n=>[n,JSON.parse(fs.readFileSync(path.join(root,n+'.json')))]));
if(Object.values(records).some(r=>r.code!==0))throw Error('必要检查未全部通过');
for(const n of ['check1-r18-2','check2-r18-1'])if(!records[n].stdout.includes('pass 3150')||!records[n].stdout.includes('fail 0')||!records[n].stdout.includes('skipped 3'))throw Error('check计数不符');
for(const n of ['selftest-r18-1','installed-selftest-r18'])if(!records[n].stdout.includes('14/14'))throw Error('桩非14/14');
const before=JSON.parse(fs.readFileSync(path.join(root,'checks-scope-before-second.json'))),build=await computeBuildStamp(repo);
if(build.inputs_sha256!==before.build.inputs_sha256||Object.entries(before.hashes).some(([f,h])=>hash(path.join(repo,f))!==h))throw Error('两遍间源码/脚本/输入失配');
const install=JSON.parse(fs.readFileSync(path.join(root,'install-r18.json')));
if(install.runtime_sha256!==hash(path.join(repo,'skills/dual-critic/scripts/trivium.cjs'))||install.entries.length!==28)throw Error('安装不符');
const old=JSON.parse(fs.readFileSync(path.join(root,'static-audit-round13.json')));
const immutable=Object.entries(old.scriptHashes).filter(([n])=>n!=='formal-round-authority.json');
for(const[n,h]of immutable)if(hash(path.join(root,'../agent-access-20261011-closeout-r3',n))!==h)throw Error('旧脚本/授权变化');
const layout={archiveRoot:path.join(repo,'.reviews'),topic},task=await readTask(layout),runs=await listRecordedRuns(layout);
const auth=JSON.parse(fs.readFileSync(path.join(root,'../agent-access-20261011-closeout-r3/formal-round-authorization-v6.json')));
if(assertFormalRound(auth,task,runs,['review','--start','--entry','C','--stage','code','--topic',topic,'--driver','codex','--critics','claude,gemini,glm'])!==14)throw Error('14C授权不符');
const measurement=await measureCodeStart(repo,topic,['--stage','code']);assertCodeStartMeasurement(measurement);
const require=createRequire(import.meta.url),{openBudget}=require('../../../../scripts/agent-access-budget.cjs');
const budgetRoot=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const budget=Object.fromEntries(['review','admission'].map(pool=>{const b=openBudget(budgetRoot,pool);const names=fs.readdirSync(b.dir);return[pool,{used:names.filter(n=>n.startsWith('reserved-')).length,completed:names.filter(n=>n.startsWith('completed-')).length,limit:b.limit()}];}));
const ctx=await loadCtx({cwd:repo});
const newScripts=['launch-v10.mjs','quiet-launch-v7.mjs','round-guard-v2.mjs','formal-start-precheck-v2.mjs','formal-round-authority.json','formal-round-authorization-v6.json'];
saveEvidence(path.join(root,'pre-round14-state.json'),{at:new Date().toISOString(),formal:{used:13,limit:14,ids:task.runs.map(r=>r.run_id),approvals:task.approvals.filter(a=>a.run_id==='20261011T061256Z')},budget,build,measurement,
  installed_bundle_sha256:install.runtime_sha256,install_status:install.status,entries:28,shared_absent:true,backup:install.backup,client_name_resolution:null,
  global_config_before_after:install.globalsAfter,checks:checks.map(n=>({name:n,code:records[n].code,sha256:hash(path.join(root,n+'.json'))})),
  scripts:Object.fromEntries(newScripts.map(n=>[n,hash(path.join(root,'../agent-access-20261011-closeout-r3',n))])),immutable_verified:immutable.map(([n])=>n),
  cli_versions:{source:'当前已保存probe（14C preflight将再取真实版本）',claude:ctx.config.probe.cli.claude?.version,codex:ctx.config.probe.cli.codex?.version,gemini:ctx.config.probe.cli.gemini?.version,glm:ctx.config.probe.cli.glm?.version},
  configuration_shared_sha256:hash(path.join(repo,'.trivium/config.yaml')),configuration_local_sha256:hash(path.join(repo,'.trivium/config.local.yaml')),
  wrapper_sha256:hash(path.join(repo,'.trivium/bin/trivium')),admission_new_starts:0,current_complete_combinations:{passed:0,untested:12,failed:0},official_claude:'订阅未恢复，未测',service_identity:null,criteria_change_authorized:false,goal_complete:false});
console.log(JSON.stringify({formal:'13/14',budget,check:'3150/3/0两次',stub:'源/安装14/14',measurement:{bytes:measurement.settings_bytes,paths:measurement.source_paths_count,skip:measurement.skipped_count},bundle:install.runtime_sha256}));
