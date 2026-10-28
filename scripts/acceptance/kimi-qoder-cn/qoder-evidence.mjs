/** 只记录不变量/错误形状；不将任一错误通道自动升级为准入通过。 */
export async function compareSnapshots(snapshots,read,hash){
  const files=[];
  for(const [file,before] of snapshots){
    try{files.push({file,unchanged:before===hash(await read(file)),error_code:null});}
    catch(e){files.push({file,unchanged:null,error_code:typeof e.code==='string'?e.code:'unknown'});}
  }
  const unchanged=files.length===0||files.some(x=>x.unchanged===null)?null:files.every(x=>x.unchanged);
  return {unchanged,files};
}

export function rejectionChannel(result,metadata=[],decisions=[]){
  if(result.is_error!==true)return null;
  const reasons=new Set(decisions.filter(x=>x.tool_use_id===result.tool_use_id).map(x=>x.decision_reason_type));
  if(reasons.size===1&&reasons.has('mode'))return 'permission-mode';
  if(reasons.size===1&&reasons.has('rule'))return 'permission-rule';
  if(reasons.size>0||metadata.some(x=>x.id===result.tool_use_id&&x.non_execution_kind==='permission-rule'))return 'unknown';
  const text=typeof result.content==='string'?result.content:'';
  if(/^Error: Tool "[^"]+" (?:not found|is not available)\.?$/.test(text))return 'tool-unavailable';
  if(/^Error: (?:File not found|ENOENT|EACCES)/.test(text))return 'execution-error';
  return 'unknown';
}

export async function checkAbsence(paths,stat){
  const files=[];
  for(const file of paths){
    try{await stat(file);files.push({file,absent:false,error_code:null});}
    catch(e){files.push({file,absent:e.code==='ENOENT'?true:null,error_code:e.code==='ENOENT'?null:e.code??'unknown'});}
  }
  return {absent:files.length===0||files.some(x=>x.absent===null)?null:files.every(x=>x.absent),files};
}

/** 先保留监督结果再拒绝下一派生；失败调用方仍须完成原件落盘。 */
export async function settleExecutionArm(record,terminate){
  const result=await terminate();record.group_cleanup=result;
  if(result.remaining.length||result.reused.length)throw Error('派生组未确认退出或身份变化，停止后续派生');
}

/** 索引按原始stdout重放；坏形状交给逐文件调用方隔离。 */
export function executionIndexEntry(doc,parseTrace){
  const invalid=()=>{throw Object.assign(Error('执行原件形状无效'),{code:'INVALID_SHAPE'});};
  if(!doc||!Array.isArray(doc.routes))invalid();
  return {project_root:doc.project_root,scope:doc.scope,deny_paths:doc.deny_paths,coverage_status:doc.coverage_status,
    script_sha256:doc.script_sha256??null,secret_guard_sha256:doc.secret_guard_sha256??null,evidence_helper_sha256:doc.evidence_helper_sha256??null,
    sources_unchanged:doc.sources_unchanged,credentials_unchanged:doc.credentials_unchanged,temporary_roots_removed:doc.temporary_roots_removed,
    known_secret_found:doc.known_secret_found,launch_budget:doc.launch_budget,routes:doc.routes.map(route=>{
      if(!route||!Array.isArray(route.cases))invalid();
      return {route:route.route,model:route.requested_model,cli_version:route.facts?.cli_version,cli_sha256:route.facts?.cli_sha256,binding_sha256:route.binding_sha256,stop_reason:route.stop_reason,
        cases:route.cases.map(c=>{
          if(!c||typeof c!=='object')invalid();
          return {id:c.id,tool:c.tool,reported_state:c.state,blocker:c.blocker,
            arms:Object.fromEntries(['positive','candidate'].map(arm=>{
              const o=c[arm];if(o!==null&&o!==undefined&&(typeof o!=='object'||typeof o.stdout!=='string'))invalid();
              const trace=parseTrace(o?.stdout??'');return [arm,{raw_exit_code:o?.raw_exit_code??null,tools:trace.init?.tools??null,trace_errors:trace.errors,
                calls:trace.calls.map(call=>({id:call.id,name:call.name,channel:call.channel,is_error:call.result?.is_error??null})),completed:trace.completed,fixture_after:o?.fixture_after??null,
                monitor_failure:o?.monitor_failure??null,verification_failure:o?.verification_failure??null,saw_result:o?.saw_result??null,result_error:o?.result_error??null}];
            }))};
        })};
    })};
}
