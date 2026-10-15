/** 本批只读采集；唯一写入为本目录的 wx 脱敏证据。不得用于启动客户端。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {saveEvidence, inventory, hash, read, budget} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname, old=path.resolve(here,'../s5-client-plan-20261016-01');
const repo=path.resolve(here,'../../../../../..'), base=path.resolve(here,'../..');
const label=process.argv[2]; assert(['before','after'].includes(label));
assert.equal(process.argv.length,3);
const sources=new Map();
function source(file) { const b=fs.readFileSync(file);sources.set(file,{file,sha256:hash(file),bytes:b.length,mode:fs.statSync(file).mode&0o777});return b.toString('utf8'); }
function json(file){return JSON.parse(source(file));}
const p=json(old+'/preparation.json'), before=budget();
const frozen=json(old+'/proposal-manifest.json').files.map(x=>({...x,current_sha256:hash(old+'/'+x.file)}));
assert(frozen.every(x=>x.sha256===x.current_sha256));
const trees=[['source',p.source,p.original_files],['backup',p.root+'/backup',p.original_files],['empty-backup',p.root+'/empty-backup',p.empty_files],
 ...Object.entries(p.fixtures).map(([name,cwd])=>[name,cwd,json(old+'/setup-'+name+'-after.json').files])].map(([name,cwd,expected])=>{
 const actual=inventory(cwd); assert.deepEqual(actual,expected,name+'发生漂移'); return {name,cwd,files:actual,equals_recorded:true};
});
const anchors=p.anchors.map(x=>({...x,current_sha256:hash(x.file)}));assert(anchors.every(x=>x.sha256===x.current_sha256));
const indexes=[p.archive_index,p.empty_index].map(x=>({...x,current_exists:fs.existsSync(x.path),current_sha256:fs.existsSync(x.path)?hash(x.path):null}));
assert.equal(indexes[0].current_sha256,p.archive_index.sha256);assert.equal(indexes[1].current_exists,false);
const lifecycle=json(old+'/lifecycle-readback.json');
const buckets=lifecycle.buckets.map(x=>({...x,current_exists:fs.existsSync(x.path)}));assert(buckets.every(x=>!x.current_exists));
const calls=fs.readdirSync(p.root+'/calls').sort().map(n=>({file:p.root+'/calls/'+n,sha256:hash(p.root+'/calls/'+n),command:read(p.root+'/calls/'+n).command}));
assert.equal(calls.length,4);assert(calls.every(x=>x.command.at(-2)==='init'));
const clientAuthorization=fs.existsSync(old+'/client-authorization.json');assert(!clientAuthorization);
const configs=Object.entries(p.fixtures).map(([name,cwd])=>{const settings=json(cwd+'/.claude/settings.json');assert.deepEqual(settings.hooks,p.hooks);return {name,settings_path:cwd+'/.claude/settings.json',hooks:settings.hooks,vscode_settings_exists:fs.existsSync(cwd+'/.vscode/settings.json'),claude_local_settings_exists:fs.existsSync(cwd+'/.claude/settings.local.json'),wrapper:{sha256:hash(cwd+'/.trivium/bin/trivium'),mode:fs.statSync(cwd+'/.trivium/bin/trivium').mode&0o777}};});
const extensions=[];
for(const version of ['2.1.296','2.1.300']) {
 const root=process.env.HOME+'/.vscode/extensions/anthropic.claude-code-'+version+'-darwin-arm64';
 const pkg=json(root+'/package.json'), js=source(root+'/extension.js');
 const needles=['spawnLocalProcess(', 'delete V.NODE_OPTIONS','viaProcessWrapper:!0','Spawning Claude with SDK query function','pythonBesideStart=!0','getChromeMcpServerConfig(){'];
 const excerpts=needles.map(needle=>{const offset=js.indexOf(needle);return {needle,offset,excerpt:offset<0?null:js.slice(Math.max(0,offset-180),offset+1050)};});
 const props=pkg.contributes.configuration.properties;
 const config=Object.fromEntries(['claudeCode.claudeProcessWrapper','claudeCode.environmentVariables','claudeCode.continueAfterReload','claudeCode.usePythonEnvironment'].map(k=>[k,props[k]]));
 const native=root+'/resources/native-binary/claude';sources.set(native,{file:native,sha256:hash(native),bytes:fs.statSync(native).size,mode:fs.statSync(native).mode&0o777});
 extensions.push({root,version:pkg.version,main:pkg.main,activation_events:pkg.activationEvents,config,excerpts,native:{file:native,sha256:hash(native),mode:fs.statSync(native).mode&0o777},executed:false});
}
// JSONC仅解析所需键；不落盘或输出环境变量值/认证字段。
const require=createRequire(repo+'/package.json'),ts=require('typescript');
const settingsPath=process.env.HOME+'/Library/Application Support/Code/User/settings.json';
const globalText=source(settingsPath), parsed=ts.parseConfigFileTextToJson(settingsPath,globalText);assert(!parsed.error);
const keys=['claudeCode.claudeProcessWrapper','claude-code.claudeProcessWrapper','claudeCode.useTerminal','claudeCode.continueAfterReload','claudeCode.usePythonEnvironment'];
const settings={path:settingsPath,selected:Object.fromEntries(keys.map(k=>[k,parsed.config[k]??null])),environment_variables_present:Object.hasOwn(parsed.config,'claudeCode.environmentVariables'),scope:'磁盘默认用户设置；不声称已解析所有profile或运行中窗口effective值'};
const psArgs=['-axo','pid=,ppid=,lstart=,comm='];
const ps=execFileSync('/bin/ps',psArgs,{encoding:'utf8',env:{...process.env,TZ:'Asia/Singapore'}});
const processes=ps.split('\n').filter(l=>l.includes('/.vscode/extensions/anthropic.claude-code-')&&l.endsWith('/resources/native-binary/claude')).map(line=>{
 const match=/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/.exec(line);assert(match);
 const pid=Number(match[1]),args=['-a','-p',String(pid),'-d','cwd','-Fn'];
 let cwd=null,code=null;try{const out=execFileSync('/usr/sbin/lsof',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});code=0;cwd=out.split('\n').find(x=>x.startsWith('n'))?.slice(1)??null;}catch(e){code=Number.isInteger(e.status)?e.status:null;}
 const relevant=[p.source,...Object.values(p.fixtures)].includes(cwd);
 return {pid,ppid:Number(match[2]),lstart:match[3],timezone:'Asia/Singapore',comm:match[4],cwd:relevant?cwd:null,other_project:cwd!==null&&!relevant,cwd_read_exit:code,command_line_collected:false};
});
const binding=json(path.resolve(old,'../hook-readback-01/channel-binding.json'));
const logs=Object.entries(binding.sources).map(([name,x])=>{
 const text=source(x.file);return {name,file:x.file,sha256:hash(x.file),events:text.split('\n').flatMap((line,i)=>{
  if(/(?:Launching|Closing) Claude on channel:|Spawning Claude with SDK query function/.test(line))return [{line:i+1,text:line}];
  if(line.includes('toolu_3fb0ff3d5be3421980559972')&&line.includes('[Stall]'))return [{line:i+1,text:line}];
  if(/2026-10-15 23:17:39.*Hooks: PreToolUse:Bash.*finished with status/.test(line))return [{line:i+1,text:line}];return [];
 })};
});
const plan=json(base+'/budget-plan.json'), ledger=[];
for(const pool of ['admission','review']){
 const dir=plan.budgetRoot+'/ledger/'+pool;
 for(const n of fs.readdirSync(dir).filter(n=>/^reserved-\d+\.json$/.test(n)).sort()){
  const f=dir+'/'+n,r=read(f);ledger.push({file:f,sha256:hash(f),pool,index:r.index,cli:r.cli,entry:r.entry,kind:r.kind,label:r.label,parent_pid:r.parent_pid,reserved_at:r.reserved_at,boundary_parent:r.boundary_parent??null});
 }
}
for(const rel of ['NEXT_TASK_PROMPT.md','SETUP_COMPLETED.md','setup-assessment.json','setup-authorization.json','configuration-preview.json','setup-delivery-check.json','common.mjs','runtime.mjs','checkpoint.mjs','fixture-step.mjs','client-requests.json'])source(old+'/'+rel);
for(const rel of ['scripts/agent-access-budget.cjs','scripts/agent-access-budget-preload.cjs','scripts/agent-access-evidence.mjs','AGENTS.md','doc/05_testing/CASE_manual_acceptance.md','doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md'])source(repo+'/'+rel);
source(base+'/cap-preload.cjs');source(base+'/matrix.json');source(base+'/matrix.md');
const after=budget();assert.deepEqual(after,before);
saveEvidence(here+'/'+label+'-state.json',{at:new Date().toISOString(),date_context:'2026-10-16 Asia/Singapore',command:[process.execPath,import.meta.filename,label],trees,frozen,anchors,indexes,buckets,calls,client_authorization_present:clientAuthorization,configs,extensions,settings,processes,process_capture:{command:['/bin/ps',...psArgs],exit_code:0,cwd_command_template:['/usr/sbin/lsof','-a','-p','<pid>','-d','cwd','-Fn']},logs,ledger,budget_before:before,budget_after:after,step_used:before.admission-plan.baseline.admission.used+before.review-plan.baseline.review.used,remaining:{admission:plan.absolute_step_caps.admission-before.admission,review:plan.absolute_step_caps.review-before.review},authorized_increment:{admission:0,review:0},new_client_launch_count:null,client_launch_note:'没有启动客户端；台账不覆盖VS Code，缺记录不能证明全机零启动。',restoration_executed:false,sources:[...sources.values()]});
console.log(JSON.stringify({evidence:here+'/'+label+'-state.json',budget:after,trees:trees.map(x=>({name:x.name,files:x.files.length,unchanged:x.equals_recorded})),frozen:frozen.length,client_authorization_present:clientAuthorization,processes}));
