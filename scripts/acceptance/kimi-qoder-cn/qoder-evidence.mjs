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
