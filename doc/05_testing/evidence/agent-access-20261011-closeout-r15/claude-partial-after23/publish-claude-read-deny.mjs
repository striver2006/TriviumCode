import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { hash } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import { saveEvidence } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import { computeBuildStamp } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/build-stamp.js';
const root=path.dirname(new URL(import.meta.url).pathname),read=p=>JSON.parse(fs.readFileSync(p)),prior=read(root+'/codex-refresh-batch.json');
const { openBudget }=createRequire(import.meta.url)(prior.repo+'/scripts/agent-access-budget.cjs'),b=openBudget(prior.budget_root,'admission');
const used=fs.readdirSync(b.dir).filter(n=>/^reserved-\d+\.json$/.test(n)).length,completed=fs.readdirSync(b.dir).filter(n=>/^launch-\d+\.json$/.test(n)).length;
if(used!==722||completed!==used||b.limit()!==728)throw Error('前批计数或上限变化');
if(read(root+'/remaining-controller-terminal.json').failure)throw Error('前批未通过');
const summary=read(root+'/summary-958d830c-93da-4620-b06e-3a34ca12aecf.json');if(summary.rows.filter(r=>r.status==='通过').length!==7)throw Error('七组合未齐');
const stamp=await computeBuildStamp(prior.repo);if(stamp.dirty||stamp.git_head!==prior.source_stamp.git_head||stamp.inputs_sha256!==prior.source_stamp.inputs_sha256)throw Error('稳定输入漂移');
for(const[p,h]of Object.entries(prior.scripts))if(hash(path.join(prior.repo,p))!==h)throw Error('既有输入漂移');
const routeRoot=prior.evidence_root+'/routes',names=fs.readdirSync(routeRoot);
function fresh(key){const variants=names.filter(n=>n.startsWith(key+'-')).map(n=>Number(n.slice(key.length+1))).filter(Number.isSafeInteger);return Math.max(0,...variants)+1;}
const jobs=[];for(const profile of ['kimi','deepseek']){const v=fresh('static-'+profile+'-version');jobs.push({name:'version-'+profile,args:['static',profile,'version',String(v)],route_directory:'static-'+profile+'-version-'+v,starts:1,selection:null});}
const models={'qwen-pro':'qwen3.8-max','kimi':'kimi-for-coding','kimi-pro':'k3','deepseek':'deepseek-flash','deepseek-pro':'deepseek-v4-pro'};
for(const combination of ['kimi-pro','qwen-pro','kimi','deepseek','deepseek-pro'])for(const arm of ['read','deny-read','deny-grep']){const key='claude-'+combination+'-'+arm,v=fresh(key),profile=combination.startsWith('qwen')?'qwen':combination.startsWith('kimi')?'kimi':'deepseek';jobs.push({name:combination+'-'+arm,args:['claude',combination,arm,String(v)],route_directory:key+'-'+v,starts:1,selection:profile==='qwen'?'selection-pilot-claude-qwen.json':'selection-claude-'+profile+'.json'});}
const reason='Bob已明确自动扩容CLI额度；获批r24§5非写必要边界，稳定aa6db337及1737bundle下五Claude仅read/deny-read/deny-grep各一次，Kimi/DeepSeek版本各一次，Qwen当前版本7精确复用；预计17硬20，722起累计742即停，任一新失败即停无重试。五生产write无新机制0启动，正式审查0，不变原准入判据。';
const batch={...prior,at:new Date().toISOString(),source_stamp:stamp,before:722,expected_starts:17,hard_max_starts:20,batch_stop:742,pool_limit:742,dispatcher_sha256:hash(root+'/claude-read-deny.mjs'),audit_sha256:hash(root+'/audit-claude-read-deny.mjs'),jobs,rows:jobs.map(j=>({route:j.args[0]==='static'?'Claude/版本/'+j.args[1]:'Claude/'+j.args[1],actual_model:null,configured_model:models[j.args[1]]??null,gap:j.args[2]==='version'?'同完整指纹CLI版本上下文':j.args[2]==='read'?'真实读取/首词/结构化交付':j.args[2]==='deny-read'?'完整六目标实际Read、精确ID与权限配对；Kimi k3含.env':'完整六目标实际Grep、精确ID与权限配对',reusable:'七通过组合原始证据保留；Qwen版本7同完整指纹，仅作版本；五组合旧能力为历史事实',necessary_starts:j.starts,production_write:'未测；本批0启动',server_identity:null})),counting:reason,criteria_change_authorized:false,prerequisite_complete:false,dispatcher_derivation:{source:root+'/codex-refresh.mjs',source_sha256:hash(root+'/codex-refresh.mjs'),changes:['批清单名称和请求标签'],guard_checks_changed:false},prior_complete_summary:{file:'summary-958d830c-93da-4620-b06e-3a34ca12aecf.json',sha256:hash(root+'/summary-958d830c-93da-4620-b06e-3a34ca12aecf.json')},automatic_retry:false,review_new_starts:0};
saveEvidence(root+'/claude-read-deny-batch.json',batch);
const extension=b.extend('r31-after23-five-claude-nonwrite-742',14,reason);saveEvidence(root+'/claude-read-deny-budget-extension.json',{at:new Date().toISOString(),extension,limit_after:b.limit(),new_vendor_starts:0});
console.log(JSON.stringify({published:true,before:722,expected:17,hard:20,limit:b.limit(),five_write_starts:0,jobs:jobs.map(j=>j.name)}));
