/** 只汇总原始观测与hash，不把退出0/未调用换成准入。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {rejectionChannel} from './qoder-evidence.mjs';
const root=path.resolve(import.meta.dirname,'../../../doc/05_testing/evidence/qoder-cn-admission-20261028');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const index={at:new Date().toISOString(),admission:false,windows:'未测',script_sha256:hash(await fs.readFile(import.meta.filename)),files:[]};
index.environment_correction='04:12及以前本主题批次不能证明环境白名单隔离；run会叠加父环境。04:30修复后证据另列，旧原件不改，完整说明见本轮报告。';
index.rejection_correction='04:33及以前索引仅按non_execution_kind计permission-rule，误含dont_ask模式拒绝；本索引按system决策ID关联，mode独立分类、缺失保持unknown，旧索引不改。';
for(const name of (await fs.readdir(root)).filter(n=>/^(custom|readonly)-.*\.json$/.test(n)).sort()){
  let bytes,e;
  try{bytes=await fs.readFile(path.join(root,name));e=JSON.parse(bytes);if(!Array.isArray(e?.cases))throw Object.assign(new Error('invalid cases'),{code:'INVALID_SHAPE'});}catch(error){index.files.push({file:name,sha256:bytes?hash(bytes):null,error_code:error.code??'JSON_INVALID'});process.exitCode=1;continue;}
  const cases=e.cases.map(c=>{
    const stdout=c.out?.stdout??c.stdout??'',calls=[],results=[],usage=[],decisions=[];let malformed=0,init=null,terminal=null;
    for(const line of stdout.split(/\r?\n/).filter(Boolean)){
      let v;try{v=JSON.parse(line);}catch{malformed++;continue;}
      if(v.type==='system'&&v.subtype==='init')init={model:v.model,tools:v.tools,mcp_servers:v.mcp_servers,plugins:v.plugins,skills:v.skills};
      if(v.type==='system'&&v.subtype==='permission_denied')decisions.push({tool_use_id:v.tool_use_id,decision_reason_type:v.decision_reason_type??null,tool_denial_kind:v.tool_denial_kind??null});
      if(v.type==='assistant')for(const b of v.message?.content??[])if(b.type==='tool_use')calls.push({id:b.id,name:b.name,input:b.input});
      if(v.type==='user')for(const b of v.message?.content??[])if(b.type==='tool_result')results.push({id:b.tool_use_id,is_error:b.is_error===true,error_text:b.is_error===true?b.content:null,metadata:v.tool_result_meta??[]});
      if(v.type==='result'){terminal={subtype:v.subtype,is_error:v.is_error,permission_denials:v.permission_denials??[]};usage.push(...Object.keys(v.modelUsage??{}));}
    }
    for(const r of results){r.channel=rejectionChannel({tool_use_id:r.id,is_error:r.is_error,content:r.error_text},r.metadata,decisions);r.permission_rule=r.channel==='permission-rule';delete r.metadata;}
    return {arm:c.arm,raw_exit_code:c.out?.code??c.raw_exit_code,init,calls,results,decisions,terminal,usage_labels:usage,malformed_lines:malformed,observed:c.observed,
      paired_permission_rules:results.filter(r=>r.is_error&&r.permission_rule&&calls.some(x=>x.id===r.id)).map(r=>r.id),
      paired_errors:results.filter(r=>r.is_error&&calls.some(x=>x.id===r.id)).map(r=>r.id),
      missing_results:calls.filter(x=>!results.some(r=>r.id===x.id)).map(x=>x.id)};
  });
  index.files.push({file:name,sha256:hash(bytes),cli_version:e.cli_version,cli_sha256:e.cli_sha256,script_sha256:e.script_sha256??null,
    environment_policy:e.environment_policy??null,environment_sources:e.environment_sources??null,
    secret_guard_sha256:e.secret_guard_sha256??null,known_secret_found:e.known_secret_found??null,credentials_unchanged:e.credentials_unchanged??null,evidence_helper_sha256:e.evidence_helper_sha256??null,
    sources_unchanged:e.sources_unchanged,temporary_roots_removed:e.temporary_roots_removed,cases});
}
index.auxiliary=[];
for(const name of (await fs.readdir(root)).filter(n=>/^(lifecycle|admission-evaluation|manifest)-.*\.json$/.test(n)).sort()){
  const bytes=await fs.readFile(path.join(root,name));let data;
  try{data=JSON.parse(bytes);}catch{index.auxiliary.push({file:name,sha256:hash(bytes),error_code:'JSON_INVALID'});process.exitCode=1;continue;}
  index.auxiliary.push({file:name,sha256:hash(bytes),scope:data.scope??null,admitted:data.admitted??false,known_secret_found:data.known_secret_found??null,temporary_roots_removed:data.temporary_roots_removed??null});
}
index.guard_binding_warnings=index.files.filter(x=>!x.error_code&&!x.secret_guard_sha256).map(x=>x.file);
index.guard_binding_missing_count=index.guard_binding_warnings.length;
const file=path.join(root,`index-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}.json`);
await fs.writeFile(file,JSON.stringify(index,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({file,files:index.files.length,admission:false}));
