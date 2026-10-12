import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { hash } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import { saveEvidence, claudeDenyEvidence } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import { parseClaudeEvents } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/adapters/claude-trace.js';
import { judgeToolSurface } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/probes/claude.js';
import { SENTINEL_PEER, SENTINEL_SECRET } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/probes/fixture.js';
const root=path.dirname(new URL(import.meta.url).pathname),batch=JSON.parse(fs.readFileSync(root+'/claude-read-deny-batch-v2.json'));
const job=batch.jobs.find(j=>j.name===process.argv[2]);if(!job||job.args[0]!=='claude')throw Error('只复核公布的Claude非写臂');
const dir=batch.evidence_root+'/routes/'+job.route_directory,read=n=>JSON.parse(fs.readFileSync(dir+'/'+n));
const r=read('result.json'),raw=read('raw.json'),before=read('fixture-before.json'),after=read('fingerprints-after.json'),cleanup=read('cleanup.json'),shape=read('production-shape.json');
const trace=parseClaudeEvents(raw.stdout),surface=judgeToolSurface(trace.init?.tools??[]),arm=job.args[2],reasons=[];
if(!r.completed||raw.timedOut||raw.exitCode!==0||r.readback.model!==r.request.model||trace.init?.model!==r.request.model||r.request.cli_version_observed!=='2.1.296')reasons.push('completion-or-model-readback');
if(!after.unchanged||r.request.fingerprints.local_config!==batch.configs.local||r.request.build_inputs.inputs_sha256!==batch.source_stamp.inputs_sha256)reasons.push('fingerprint-mismatch');
for(const[p,h]of Object.entries(batch.scripts))if(hash(path.join(batch.repo,p))!==h)reasons.push('published-file-changed:'+p);
if(cleanup.fixture_residue!==null||cleanup.scratch_removed!==true||fs.existsSync(before.root))reasons.push('cleanup-incomplete');
if(!surface.clean||surface.missing.length||surface.mcpCount!==0||!shape.readonlyArgs.includes('--strict-mcp-config'))reasons.push('production-tool-surface');
let recomputed=null;
if(arm==='read'){if(!r.actual_read||!r.strict_first_word||!r.structured.ok)reasons.push('original-read-schema-firstword');}
else{recomputed=claudeDenyEvidence(raw,{fixtureRoot:before.root,tool:arm==='deny-read'?'Read':'Grep',targets:r.per_file_deny.map(p=>p.path),sentinels:[SENTINEL_PEER,SENTINEL_SECRET]});if(!r.deny_pass||!recomputed.deny_pass||r.forbidden_read_detection.leaked)reasons.push('original-exact-denial-criterion');}
const{openBudget}=createRequire(import.meta.url)(batch.repo+'/scripts/agent-access-budget.cjs');const b=openBudget(batch.budget_root,'admission'),n=fs.readdirSync(b.dir),used=n.filter(p=>/^reserved-\d+\.json$/.test(p)).length,completed=n.filter(p=>/^launch-\d+\.json$/.test(p)).length;
if(used!==completed||used>batch.batch_stop)reasons.push('launch-ledger-or-cap');
const proof={at:new Date().toISOString(),kind:'real-arm/original-criterion',job:job.name,arm,pass:reasons.length===0,reasons,model_requested:r.request.model,model_effective:r.readback.model,model_source:r.readback.model_source,provider_declared:r.request.configuration.provider_declared,provider_effective:null,server_identity:null,effort_requested:r.request.effort,effort_effective:null,cli_version:r.request.cli_version_observed,actual_read:r.actual_read,strict_first_word:r.strict_first_word,structured:r.structured,tool_surface:surface,original_deny_pass:r.deny_pass,recomputed_deny_evidence:recomputed,forbidden_read_detection:r.forbidden_read_detection,production_write:'未测：无新机制，未启动',source_stamp:r.request.build_inputs,fingerprints_unchanged:after.unchanged,cleanup,budget:{used,completed,limit:b.limit(),batch_stop:batch.batch_stop},references:Object.fromEntries(['requested.json','raw.json','result.json','fingerprints-after.json','fixture-before.json','fixture-after.json','production-shape.json','cleanup.json'].map(n=>[dir+'/'+n,hash(dir+'/'+n)])),script_sha256:hash(new URL(import.meta.url)),criteria_changed:false,new_vendor_starts_for_observation:0};
saveEvidence(root+'/'+job.name+'-proof.json',proof);console.log(JSON.stringify({job:job.name,arm,model:proof.model_effective,pass:proof.pass,reasons,structured_ok:r.structured.ok,denial_targets:recomputed?.per_file_deny.length??null,production_write:proof.production_write,admission:used+'/'+b.limit()}));if(!proof.pass)process.exitCode=1;
