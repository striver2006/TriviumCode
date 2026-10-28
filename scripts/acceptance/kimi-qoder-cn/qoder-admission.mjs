/** 从项目相对证据清单生成候选结论；缺项不写生产台账，不刷新原件日期。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const repo=await fs.realpath(path.resolve(import.meta.dirname,'../../..'));
if(!process.argv[2]||process.argv.slice(3).some(x=>x!=='--write'))throw Error('用法：node qoder-admission.mjs <项目相对manifest.json> [--write]');
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'trivium-cn-admission-'));await fs.chmod(tmp,0o700);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function relativeFile(rel){if(typeof rel!=='string'||path.isAbsolute(rel)||rel.split(/[\\/]/).some(p=>p==='..'||!p))throw Error('证据必须是安全项目相对路径');const file=path.resolve(repo,rel);if(await fs.realpath(file)!==file||!(await fs.lstat(file)).isFile())throw Error('证据路径不是项目内普通文件');return file;}
try{
  await build({stdin:{contents:"export {AGENTS} from './src/trivium/agents/registry.ts';export {admissionRouteBinding,verifyAdmissionRecord,storeAdmission} from './src/trivium/admission.ts';export {qoderAdmissionVerifier} from './src/trivium/adapters/qoder-cn-admission.ts';export {validateQoderFacts,qoderModelRequest} from './src/trivium/adapters/qoder-cn-model.ts';export {checkQoderBinding} from './src/trivium/adapters/qoder-cn-native.ts';",resolveDir:repo},bundle:true,platform:'node',format:'cjs',outfile:path.join(tmp,'runtime.cjs'),logLevel:'silent'});
  const r=(await import(pathToFileURL(path.join(tmp,'runtime.cjs')).href)).default;
  const manifest=JSON.parse(await fs.readFile(await relativeFile(process.argv[2]),'utf8'));
  if(!Array.isArray(manifest.deny_paths)||manifest.deny_paths.some(x=>typeof x!=='string'))throw Error('清单缺已验禁读覆盖集');
  if(!Number.isFinite(manifest.ttl_days)||manifest.ttl_days<=0||!Array.isArray(manifest.evidence))throw Error('清单缺TTL或证据引用');
  const source=JSON.parse(await fs.readFile(await relativeFile(manifest.facts_file),'utf8'));
  const facts=source.facts;if(facts?.entrypoint?.startsWith('~/'))facts.entrypoint=path.join(os.homedir(),facts.entrypoint.slice(2));
  if(facts?.route_descriptor?.source_ref?.startsWith('~/'))facts.route_descriptor.source_ref=path.join(os.homedir(),facts.route_descriptor.source_ref.slice(2));
  r.validateQoderFacts(facts);if(!facts.review_invocation_args?.length)throw Error('无工具可调用事实不能用作审核准入');r.checkQoderBinding(facts,null);
  const agent=r.AGENTS.find(a=>a.id==='qoder-cn'),req={critic:agent.id,project_root:repo,model:facts.model,native_model:r.qoderModelRequest(facts,facts.model,'diagnostic')};
  const loaded=[];
  for(const ref of manifest.evidence){if(!agent.admissionChecks.includes(ref.check)||typeof ref.case_id!=='string')throw Error('未知检查项或实验臂');const bytes=await fs.readFile(await relativeFile(ref.path));loaded.push({check:ref.check,ref:{path:ref.path,sha256:hash(bytes),case_id:ref.case_id},data:JSON.parse(bytes.toString())});}
  const dates=loaded.map(e=>Date.parse(e.data.at));if(!dates.length||dates.some(x=>!Number.isFinite(x)))throw Error('证据缺原始时间');
  const scope=[];for(const p of manifest.deny_paths){const absolute=path.resolve(repo,p);scope.push(absolute);try{scope.push(await fs.realpath(absolute));}catch(e){if(e.code!=='ENOENT')throw e;}}
  const tested=Math.min(...dates),record={record_id:crypto.randomUUID(),agent:agent.id,project_root:repo,binding_sha256:r.admissionRouteBinding(req),tested_at:new Date(tested).toISOString(),expires_at:new Date(tested+manifest.ttl_days*86400000).toISOString(),deny_paths:[...new Set(scope)].sort(),checks:{}};
  const verify=r.qoderAdmissionVerifier(req),reasons={};
  for(const check of agent.admissionChecks){const items=loaded.filter(e=>e.check===check);const failures=items.length?verify(check,items,record):['未测：无对应真实证据'];record.checks[check]={state:items.length?failures.length?'fail':'pass':'untested',evidence:items.map(e=>e.ref)};if(failures.length)reasons[check]=failures;}
  let admitted=false;
  if(Object.keys(reasons).length===0){r.verifyAdmissionRecord(req,record,manifest.ttl_days,verify);if(process.argv.includes('--write')){await r.storeAdmission(repo,record);admitted=true;}}
  const output={schema:'trivium.admission-evaluation.v1',at:new Date().toISOString(),admitted,production_switch_enabled:agent.criticEnabled,record,reasons,windows:process.platform==='win32'?'仅本机结论':'未测'};
  const out=path.join(repo,'doc/05_testing/evidence/qoder-cn-admission-20261028','admission-evaluation-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex')+'.json');
  await fs.writeFile(out,JSON.stringify(output,null,2).split(os.homedir()).join('~')+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({file:out,admitted,passed:Object.values(record.checks).filter(c=>c.state==='pass').length,total:agent.admissionChecks.length,blocked:Object.keys(reasons)}));
}finally{await fs.rm(tmp,{recursive:true,force:true});}
