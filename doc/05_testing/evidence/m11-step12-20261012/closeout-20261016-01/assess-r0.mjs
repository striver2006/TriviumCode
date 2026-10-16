/** R0 agy 定向刷新的只读回读：调用回执、台账增量、agy 探针段。零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {parse} from 'yaml';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'..');
const F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const calls=path.join(os.homedir(),'.'+'trivium','evidence','m11-step12-20261012','calls');
const prefix=process.argv[2]??'r0';
const consumed=JSON.parse(fs.readFileSync(here+'/'+prefix+'-agy-refresh-approval-consumed.json','utf8'));
const done=fs.readdirSync(calls).filter(n=>n.endsWith('-completed.json')).map(n=>({n,d:JSON.parse(fs.readFileSync(path.join(calls,n),'utf8'))}))
 .filter(x=>x.d.label==='m11-s12-doctor'&&x.d.at>=consumed.at.slice(0,16)&&x.d.refresh_authorization?.source?.endsWith('/'+prefix+'-agy-refresh-approval.json'));
if(done.length!==1)throw Error('R0 回执数不是 1：'+done.length);
const c=done[0].d,out=JSON.parse(c.stdout);
const plan=JSON.parse(fs.readFileSync(base+'/budget-plan.json','utf8'));
const count=p=>fs.readdirSync(path.join(plan.budgetRoot,'ledger',p)).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
const agy=parse(fs.readFileSync(path.join(F,'.'+'trivium','config.local.yaml'),'utf8')).probe.cli.agy;
const keep=['version','probed_at','headless_read_ok','json_schema_ok','scratch_paths','path_deny'];
const result={at:new Date().toISOString(),call:done[0].n,code:c.code,signal:c.signal,primary_loaded:Boolean(c.primary_loaded),
 ledger_before:c.before,ledger_after:c.after,admission_increment:c.after-c.before,ledger_now:{admission:count('admission'),review:count('review')},
 blockers:out.blockers??null,agy:Object.fromEntries(keep.filter(k=>k in agy).map(k=>[k,agy[k]])),
 models_include_batch_route:Array.isArray(agy.models)&&agy.models.includes('gemini-3.8-flash-high'),models_count:agy.models?.length??null};
saveEvidence(here+'/'+prefix+'-assessment.json',result);
console.log(JSON.stringify(result,null,1));
