/** Qoder 1.1.80 stream-json实测事件；调用、结果和权限决策分别配对。 */
import path from 'node:path';

type ObjectValue=Record<string,unknown>;
const object=(v:unknown):ObjectValue|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:null;
const text=(v:unknown):string|null=>typeof v==='string'&&v.length?v:null;
export const QODER_READING_TOOLS=['Read','Grep','Glob'] as const;
export const QODER_EXECUTION_TOOLS=['Write','Edit','Bash','Agent','Task','WebFetch','WebSearch','mcp__*'] as const;
export interface QoderToolCall {id:string;name:string;input:ObjectValue;result:{is_error:boolean;content:unknown}|null;channel:string|null;}
export interface QoderTrace {
  init:{cwd:string|null;tools:string[];model:string|null;permission_mode:string|null}|null;
  calls:QoderToolCall[];
  decisions:{id:string;reason:string|null;kind:string|null}[];
  errors:string[];
  completed:boolean;
  terminal_count:number;
  raw_result:unknown;
  session_id:string|null;
}

export function parseQoderTrace(stdout:string):QoderTrace {
  const trace:QoderTrace={init:null,calls:[],decisions:[],errors:[],completed:false,terminal_count:0,raw_result:null,session_id:null};
  const ids=new Map<string,QoderToolCall>();
  for(const line of stdout.split(/\r?\n/).filter(x=>x.trim())){
    let e:ObjectValue|null;try{e=object(JSON.parse(line));}catch{trace.errors.push('原生事件不是完整JSON');continue;}
    if(!e){trace.errors.push('原生事件形状未知');continue;}
    trace.session_id=text(e['session_id'])??trace.session_id;
    if(e['type']==='system'){
      if(e['subtype']==='init'){
        if(trace.init)trace.errors.push('重复init');
        trace.init={cwd:text(e['cwd']),tools:Array.isArray(e['tools'])?e['tools'].filter((x):x is string=>typeof x==='string'):[],model:text(e['model']),permission_mode:text(e['permissionMode'])};
      }
      if(e['subtype']==='permission_denied'){
        const id=text(e['tool_use_id']);if(!id)trace.errors.push('权限事件缺调用ID');else trace.decisions.push({id,reason:text(e['decision_reason_type']),kind:text(e['tool_denial_kind'])});
      }
    }else if(e['type']==='assistant'||e['type']==='user'){
      const blocks=object(e['message'])?.['content'];if(!Array.isArray(blocks))continue;
      for(const block of blocks){
        const b=object(block);if(!b)continue;
        if(b['type']==='tool_use'){
          if(e['type']!=='assistant'||!trace.init)trace.errors.push('工具调用来源或init顺序无效');
          const id=text(b['id']),name=text(b['name']),input=object(b['input']);
          if(!id||!name||!input){trace.errors.push('工具调用缺ID/名称/参数');continue;}
          if(ids.has(id)){trace.errors.push('重复工具调用ID');continue;}
          if(trace.terminal_count)trace.errors.push('终态之后仍有工具调用');
          const call:QoderToolCall={id,name,input,result:null,channel:null};ids.set(id,call);trace.calls.push(call);
        }
        if(b['type']==='tool_result'){
          if(e['type']!=='user'||!trace.init)trace.errors.push('工具结果来源或init顺序无效');
          if(trace.terminal_count)trace.errors.push('终态之后仍有工具结果');
          const id=text(b['tool_use_id']),call=id?ids.get(id):null;
          if(!call||call.result){trace.errors.push('工具结果悬空、先于调用或重复');continue;}
          if(b['is_error']!==undefined&&typeof b['is_error']!=='boolean')trace.errors.push('工具错误状态无效');
          call.result={is_error:b['is_error']===true,content:b['content']};
        }
      }
    }else if(e['type']==='result'){
      trace.terminal_count++;trace.raw_result=e;trace.completed=e['subtype']==='success'&&e['is_error']!==true;
    }else if(e['type']!=='stream_event')trace.errors.push('未知事件类型');
  }
  if(!trace.init)trace.errors.push('缺init');
  if(trace.terminal_count!==1)trace.errors.push('缺少唯一终态');
  for(const call of trace.calls){
    if(!call.result){trace.errors.push(`工具调用缺结果：${call.id}`);continue;}
    if(!call.result.is_error)continue;
    const decisions=trace.decisions.filter(d=>d.id===call.id),reasons=new Set(decisions.map(d=>d.reason));
    if(decisions.length===1&&reasons.has('rule'))call.channel='permission-rule';
    else if(decisions.length===1&&reasons.has('mode'))call.channel='permission-mode';
    else if(decisions.length)call.channel='unknown';
    else if(typeof call.result.content==='string'&&/^Error: Tool "([^"]+)" (?:not found|is not available)\.?$/.exec(call.result.content)?.[1]===call.name)call.channel='tool-unavailable';
    else call.channel='unknown';
  }
  for(const d of trace.decisions)if(!ids.get(d.id)?.result?.is_error)trace.errors.push('权限事件没有对应失败结果');
  return trace;
}

const target=(input:ObjectValue):string|null=>text(input['file_path'])??text(input['path']);
export function qoderTraceEvidence(trace:QoderTrace,fallbackRoot:string){
  const root=trace.init?.cwd??fallbackRoot;
  const absolute=(p:string)=>path.isAbsolute(p)?path.normalize(p):path.resolve(root,p);
  const reads=trace.calls.filter(c=>c.name==='Read'&&c.result&&!c.result.is_error).flatMap(c=>{const p=target(c.input);return p?[absolute(p)]:[];});
  const searchHits:string[]=[];
  for(const c of trace.calls.filter(c=>c.name==='Grep'&&c.result&&!c.result.is_error&&c.input['output_mode']==='content')){
    if(typeof c.result!.content!=='string')continue;
    for(const line of c.result!.content.split(/\r?\n/)){
      const hit=/^([^:\n]+\.[A-Za-z0-9_-]+):\d+:/.exec(line);if(hit?.[1])searchHits.push(absolute(hit[1]));
    }
  }
  const pathCalls=trace.calls.filter(c=>['Read','Grep','Glob'].includes(c.name));
  return {tool_calls:{read:trace.calls.filter(c=>c.name==='Read').length,grep:trace.calls.filter(c=>c.name==='Grep').length,glob:trace.calls.filter(c=>c.name==='Glob').length,
    run_command:trace.calls.filter(c=>c.name==='Bash').length},read_paths:[...new Set(reads)],search_hit_paths:[...new Set(searchHits)],
    path_bearing_reads:pathCalls.length,path_bearing_reads_with_path:pathCalls.filter(c=>target(c.input)!==null).length,
    // 与既有适配器同口径：白名单外尝试无论成功或拒绝均是生产只读失守信号。
    write_events:trace.calls.filter(c=>!['Read','Grep','Glob'].includes(c.name)).map(c=>`${c.name}(${target(c.input)??c.id})`),
    command_texts:trace.calls.filter(c=>c.name==='Bash').flatMap(c=>typeof c.input['command']==='string'?[c.input['command']]:[])};
}
