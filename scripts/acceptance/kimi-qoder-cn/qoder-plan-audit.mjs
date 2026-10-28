#!/usr/bin/env node
/** 离线关联原生工具ID、wrapper、归档和worker；不调用客户端，不迁移闸门。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {sha} from './driver-identity.mjs';
import {fileHash,globalSnapshot,topic} from './qoder-plan.mjs';

const json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
export function nativeTools(stdout){
  const events=stdout.split('\n').filter(Boolean).map(s=>{try{return JSON.parse(s);}catch{return null;}}).filter(Boolean),calls=[],results=new Map();
  const text=v=>typeof v==='string'?v:Array.isArray(v)?v.map(text).join('\n'):v?.text??JSON.stringify(v);
  for(const e of events){
    for(const c of e.message?.content??[]){if(c.type==='tool_use')calls.push(c);if(c.type==='tool_result')results.set(c.tool_use_id,{text:text(c.content),error:c.is_error===true});}
    for(const c of e.tool_calls??[])if(c.type==='function'){try{calls.push({id:c.id,name:c.function.name,input:JSON.parse(c.function.arguments)});}catch{/* 坏调用不能算证据 */}}
    if(e.role==='tool')results.set(e.tool_call_id,{text:text(e.content),error:/^Error:/.test(text(e.content))});
  }
  return {events,calls,results};
}
export function linkRows(rows,native){
  return rows.map(row=>{
    const output=(row.stdout||row.stderr||'').trim();
    const ids=native.calls.filter(c=>c.name==='Bash'&&c.input?.command?.includes('.trivium/bin/trivium')&&output&&native.results.get(c.id)?.text?.includes(output)).map(c=>c.id);
    return {at:row.at,argv:row.argv,cwd:row.cwd,exit_code:row.exit_code,signal:row.signal,tool_ids:ids,matched:ids.length>0};
  });
}
export async function audit(nativeFile,output){
  const e=await json(nativeFile),spec=await json(e.spec_file),api=createRequire(import.meta.url)(spec.helper),n=nativeTools(e.result?.stdout??'');
  const rows=e.wrapper_ledger.trim().split('\n').map(JSON.parse).filter(r=>Date.parse(r.at)>=Date.parse(e.at));
  const out={schema:'trivium.qoder-plan-audit.v1',at:new Date().toISOString(),source:nativeFile,source_sha256:await fileHash(nativeFile),fixture:spec.root,run_root:spec.run_root,cli:e.cli,model_request:e.model_request,native_exit:{code:e.result?.code,signal:e.result?.signal,timedOut:e.result?.timedOut,truncated:e.result?.truncated},global_unchanged:e.global_unchanged,private_home_absent:e.private_home_absent,wrapper_pairs:linkRows(rows,n),runs:[],artifacts:[],writes:[]};
  const init=n.events.find(x=>x.subtype==='init');out.native={session_id:init?.session_id??null,cwd:init?.cwd??null,route_label:init?.model??null,underlying_model:null,skills:init?.skills??null,skill_calls:n.calls.filter(c=>c.name==='Skill').map(c=>({...c,result:n.results.get(c.id)??null}))};
  const put=async(rel,bytes)=>{const target=path.join(output,'artifacts',rel);await fs.mkdir(path.dirname(target),{recursive:true});const clean=api.redactSecrets(bytes.toString()).content;await fs.writeFile(target,clean,{flag:'wx',mode:0o600});out.artifacts.push({source:rel,file:path.relative(output,target),source_sha256:sha(bytes),sha256:sha(clean)});};
  const archive=path.join(spec.root,'.reviews',topic),walk=async(dir,rel='archive')=>{for(const f of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,f.name),r=rel+'/'+f.name;if(f.isDirectory())await walk(p,r);else if(f.isFile())await put(r,await fs.readFile(p));}};
  await walk(archive);
  const roots=await fs.readdir(spec.run_root).catch(x=>{if(x.code==='ENOENT')return [];throw x;});
  for(const id of spec.run_ids){
    const base=roots.map(r=>path.join(spec.run_root,r,id));let run;
    for(const dir of base){try{await fs.access(path.join(dir,'request.json'));run=dir;break;}catch{/* 仅查存在性 */}}
    if(!run){out.runs.push({id,error:'没有执行交接原件'});continue;}
    const handoff=await json(path.join(run,'request.json')),meta=await json(path.join(archive,'plan/_meta',`run-${id}.json`));
    const routes=Object.fromEntries(handoff.sides.map(c=>[c,api.sameRequestedRoute(handoff.requests[c],meta.requested_routes?.[c])]));
    out.runs.push({id,driver:meta.driver,handoff_driver:handoff.options.driver,critics:handoff.sides,allow_single:handoff.options.allowSingle,requested_routes:meta.requested_routes,worker_route_comparison:routes,worker_resume_evidence:'真实worker产出及逐项比对分支后的运行状态；无独立模型身份回读则仍null',status:meta.status,guard:meta.guard,critics_results:meta.critics,gate:meta.gate??null,round_verdict:meta.round_verdict??null});
    for(const rel of ['request.json','status.json','worker.log','worker.pid','gemini/stdout.jsonl','gemini/trace.json','glm/stdout.json','glm/trace.json']){
      try{await put('runs/'+id+'/'+rel,await fs.readFile(path.join(run,rel)));}catch(x){if(x.code!=='ENOENT')throw x;}
    }
  }
  for(const c of n.calls.filter(c=>c.name==='Write')){
    const p=c.input?.file_path??c.input?.path,content=c.input?.content;if(!p||typeof content!=='string')continue;
    out.writes.push({tool_id:c.id,path:p,content_sha256:sha(content),same_id_result:n.results.get(c.id)??null,file_sha256:await fileHash(path.resolve(spec.root,p)),native_content_matches:sha(content)===await fileHash(path.resolve(spec.root,p))});
  }
  out.task=await json(path.join(archive,'task.json'));out.state=await json(path.join(spec.root,'.trivium/state.json')).catch(x=>{if(x.code==='ENOENT')return null;throw x;});
  out.fixture_head=(await api.run('git',['-c','core.quotePath=false','rev-parse','HEAD'],{cwd:spec.root})).stdout.trim();
  out.fixture_head_matches=out.fixture_head===spec.head;out.pins=await Promise.all(Object.entries(spec.pins).map(async([p,h])=>({path:p,expected:h,actual:await fileHash(p),matches:h===await fileHash(p)})));
  out.global_final=await globalSnapshot();out.global_still_unchanged=JSON.stringify(e.global_before)===JSON.stringify(out.global_final);
  out.production_flags=api.AGENTS.filter(a=>['kimi','qoder-cn'].includes(a.id)).map(a=>({id:a.id,driverEnabled:a.driverEnabled,criticEnabled:a.criticEnabled,defaultSelected:a.defaultSelected}));
  out.installed_bundle_sha256=await fileHash(path.join(process.env.HOME,'.claude/skills/dual-critic/scripts/trivium.cjs'));
  out.root_cleanup_owner=spec.cleanup_owner;out.approval_executed=false;out.restore_or_abandon_executed=false;
  const target=path.join(output,`audit-${Date.now()}.json`);await fs.writeFile(target,api.redactSecrets(JSON.stringify(out,null,2)).content,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({file:target,runs:out.runs.map(r=>({id:r.id,driver:r.driver,status:r.status})),state:out.state,matched:out.wrapper_pairs.filter(r=>r.matched).length,total:out.wrapper_pairs.length}));
  return out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw Error('用法：qoder-plan-audit.mjs <native-B原件> <全新输出目录>');
  await audit(path.resolve(process.argv[2]),path.resolve(process.argv[3]));
}
