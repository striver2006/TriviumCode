/** 两轮实证对账；只读CLI不启动厂商，旧件不改写。 */
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import YAML from 'yaml';
import {spawnSync} from 'node:child_process';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname;
const d=JSON.parse(fs.readFileSync(here+'/client-b2-runs.json')),m=d.record;
const first=JSON.parse(fs.readFileSync(here+'/client-b1-runs.json')).record;
const prep=JSON.parse(fs.readFileSync(here+'/b2-preparation.json'));
const cfg=JSON.parse(fs.readFileSync(here+'/client-batch-b2.json'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before=prep.archive_before.map(f=>({...f,current:hash(f.file)}));
const changed=before.filter(f=>f.current!==f.sha256);
if(changed.some(f=>!f.file.endsWith('/task.json')))throw Error('旧工件改变');
const calls=[];
for(const args of [['gate','--stage','plan','--topic',m.topic,'--check','--json'],['report','--topic',m.topic],['report','--topic',m.topic,'--json']]){
 const command=[cfg.fixture+'/.trivium/bin/trivium',...args],r=spawnSync(command[0],args,{cwd:cfg.fixture,encoding:'utf8'});
 calls.push({command,cwd:cfg.fixture,code:r.status,stdout:r.stdout,stderr:r.stderr});
 if(r.status!==0)throw Error('本地复核命令失败：'+r.stderr);
}
const gate=JSON.parse(calls[0].stdout);
if(!gate.ok||gate.run_id!==m.run_id||gate.structured_ids.length!==5)throw Error('裁决核对失败');
const finalPlan=cfg.fixture+'/.reviews/'+m.topic+'/plan/2026-10-12-m11-s12-capacity-r3-claude.md';
for(const id of gate.structured_ids)if(!fs.readFileSync(finalPlan,'utf8').includes(id))throw Error('定稿缺意见落点:'+id);
const fields=['tier','tier_source','effort_requested','effort_effective','effort_effective_source'];
const front_matter=Object.entries(m.critics).map(([side,c])=>{
 const file=cfg.fixture+'/.reviews/'+m.topic+'/plan/2026-10-12-m11-s12-capacity-r2-'+side+'.md';
 const content=fs.readFileSync(file,'utf8'),fm=YAML.parse(content.split('---')[1]);
 return {side,file,sha256:hash(file),checks:fields.map(field=>({field,meta:c[field],front_matter:fm[field],equal:JSON.stringify(c[field])===JSON.stringify(fm[field])}))};
});
if(front_matter.some(s=>s.checks.some(c=>!c.equal)))throw Error('front-matter不一致');
const zfile=os.homedir()+'/.zcode/cli/config.json';
if(hash(zfile)!==prep.zcode_config.sha256)throw Error('ZCode全局配置改变');
const families=[first,m].map(run=>({run_id:run.run_id,pairs:Object.entries(run.critics).map(([side,c])=>{const pair=run.family_comparisons.find(p=>p.left===run.driver&&p.right===side);const ok=c.heterogeneous==='different-family'&&pair?.status===c.heterogeneous&&['left_model','right_model','left_source','right_source','reason'].every(k=>!!pair[k]);if(!ok)throw Error('异族回读不符');return {side,...pair};})}));
const models=Object.keys(m.critics).map(side=>{const a=first.critics[side],b=m.critics[side];const normalize=x=>x.split('/').at(-1);const passed=a.model_effective!==b.model_effective&&normalize(a.model_effective)===a.model_requested&&normalize(b.model_effective)===b.model_requested&&['trace','envelope'].includes(a.model_effective_source)&&['trace','envelope'].includes(b.model_effective_source);if(!passed)throw Error('模型对照失败:'+side);return {side,first:{requested:a.model_requested,effective:a.model_effective,source:a.model_effective_source},second:{requested:b.model_requested,effective:b.model_effective,source:b.model_effective_source},passed};});
const budgetPlan=JSON.parse(fs.readFileSync(here+'/budget-plan.json'));
const counts=Object.fromEntries(['admission','review'].map(p=>[p,fs.readdirSync(budgetPlan.budgetRoot+'/ledger/'+p).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
if(counts.admission!==817||counts.review!==393)throw Error('本地复核出现额外启动');
const observations=JSON.parse(fs.readFileSync(here+'/client-b2-processes.json')).observations;
const observedRun=observations.filter(o=>o.at>=m.started_at&&o.at<=m.finished_at);
const preflight=d.calls.find(c=>c.command[2]==='preflight');
saveEvidence(here+'/b2-assessment.json',{at:new Date().toISOString(),run_id:m.run_id,status:m.status,review_mode:m.review_mode,gate,final_plan:{file:finalPlan,sha256:hash(finalPlan)},models,families,archive_before:before,mutable_files_changed:changed.map(f=>f.file),front_matter,all_fields_equal:true,zcode_config_unchanged:true,profile:m.profile,calls,preflight,critics_evidence:Object.fromEntries(Object.entries(m.critics).map(([s,c])=>[s,{evidence_ok:c.evidence_ok,tool_calls:c.tool_calls}])),guard:m.guard,snapshot_drift:m.snapshot.drift,process_sampling:{first:observations[0]?.at,last:observations.at(-1)?.at,run_started_at:m.started_at,run_observations:observedRun.length,actual_ps_observed:observedRun.length>0,limitation:'采样器在15:34结束，本轮15:40才启动；B2实时ps未采到。B1的8.3/11.3实证保留，不补写B2进程。'},budget:{batch_delta:{admission:8,review:6},step_delta:{admission:22,review:20},step_total:42,current:counts,limits:{admission:835,review:413},client_misstatement:'客户端将三侧探活与三侧审查合为review6，且把start计入admission1；实际admission4版本+4探活边界，review6审查边界，含包装器/native与ZCode内部边界。'},limitations:['B1 Codex evidence_ok=false不回写','B2 Codex命令字面命中orchestrator-state，原命令中该路径位于find的-not -path排除式；保留命中，不将其静默清除或声称读取了审查意见','r3 npm回退只能作为辅助诊断；正式配置命令若失败必须如实保留，未经另行明确决定不得替换验收配置或判通过']});
console.log(JSON.stringify({gate:gate.ok,ids:gate.structured_ids,models,fields:15,old_artifacts_unchanged:true,budget:counts,ps_observed:observedRun.length}));
