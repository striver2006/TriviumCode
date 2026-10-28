/** 合成反例验证准入判据，不调用厂商、不写生产台账，不计真实模型准入。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {AGENTS} from '../../src/trivium/agents/registry.js';
import {admissionHash,admissionRouteBinding,type AdmissionRequest} from '../../src/trivium/admission.js';
import {qoderAdmissionVerifier} from '../../src/trivium/adapters/qoder-cn-admission.js';
import {executionPairOutcome,qoderExecutionControl,qoderExecutionControlArgs,QODER_CONTROL_TOOLS,type QoderControlTool} from '../../src/trivium/adapters/qoder-cn-execution.js';
import {parseQoderTrace,QODER_READING_TOOLS} from '../../src/trivium/adapters/qoder-cn-trace.js';
import {QODER_REVIEW_ARGS} from '../../src/trivium/probes/qoder-cn.js';
import type {AdmissionRecord,NativeModelFacts} from '../../src/trivium/types.js';

const root=path.resolve('/synthetic-native-project'),hash='a'.repeat(64);
const facts:NativeModelFacts={model:'Exact',source:'catalog-default',observed_user_model:null,models:['Exact'],route_labels:[],
  catalog_sha256:hash,catalog_raw_sha256:hash,configuration_sha256:null,entrypoint:'/fixture/native',cli_sha256:hash,
  cli_version:'synthetic-not-invoked',platform:process.platform,prepared_at:new Date().toISOString(),default_verified:true,
  invocation_args:['--tools',''],review_invocation_args:[...QODER_REVIEW_ARGS]};
const req:AdmissionRequest={critic:AGENTS.find(a=>a.admissionChecks?.length)!.id,project_root:root,model:'Exact',
  native_model:{facts,requested:'Exact',override:null,origin:'diagnostic'}};
const record:AdmissionRecord={record_id:'synthetic',agent:req.critic,project_root:root,binding_sha256:admissionRouteBinding(req),
  tested_at:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),deny_paths:[],checks:{}};
const checkFor=(tool:QoderControlTool)=>({Write:'write-denied',Edit:'edit-denied',Bash:'shell-denied'})[tool];

function fixture(tool:QoderControlTool) {
  const target=path.join(root,tool.toLowerCase()+'-control.txt'),control=qoderExecutionControl(tool,target);
  const events=(candidate:boolean):Record<string,unknown>[]=>[
    {type:'system',subtype:'init',cwd:root,model:'Exact',tools:candidate?[...QODER_READING_TOOLS]:[...QODER_READING_TOOLS,tool]},
    {type:'assistant',message:{model:'Exact',content:[{type:'tool_use',id:candidate?'deny':'allow',name:tool,input:control.input}]}},
    {type:'user',message:{content:[{type:'tool_result',tool_use_id:candidate?'deny':'allow',is_error:candidate,content:candidate?'Error: Tool "'+tool+'" not found.':'CONTROL_OK'}]}},
    {type:'result',subtype:'success',is_error:false,result:'OK'},
  ];
  const arm=(candidate:boolean)=>{
    const argv=[...QODER_REVIEW_ARGS];if(!candidate)argv[argv.indexOf('--tools')+1]=[...QODER_READING_TOOLS,tool].join(',');
    return {stdout:events(candidate).map(e=>JSON.stringify(e)).join('\n'),stderr:'',raw_exit_code:0,raw_signal:null,
      spawned:true,timed_out:false,truncated:false,early_stopped:false,argv,fixture_before:control.before,fixture_after:candidate?control.before:control.after};
  };
  const pair={id:'control',check:checkFor(tool),positive:arm(false),candidate:arm(true),proof:{tool,target,positive_id:'allow',candidate_id:'deny'}};
  const doc={schema:'trivium.native-acceptance.v1',source_kind:'real-model',at:new Date().toISOString(),project_root:root,
    binding_sha256:admissionRouteBinding(req),deny_paths_sha256:admissionHash([]),cli_sha256:hash,cli_version:facts.cli_version,
    platform:process.platform,known_secret_found:false,sources_unchanged:true,credentials_unchanged:true,temporary_roots_removed:true,cases:[pair]};
  const verify=()=>qoderAdmissionVerifier(req)(checkFor(tool),[{ref:{path:'synthetic.json',sha256:hash,case_id:'control'},data:doc}],record);
  const alter=(candidate:boolean,edit:(events:Record<string,any>[])=>void)=>{
    const a=candidate?pair.candidate:pair.positive;
    const es=a.stdout.split('\n').map(line=>JSON.parse(line));edit(es);a.stdout=es.map(e=>JSON.stringify(e)).join('\n');
  };
  return {doc,pair,verify,alter,target};
}

for(const tool of QODER_CONTROL_TOOLS){
  test(tool+'生产判据重算唯一调用、精确参数和文件前后状态',()=>{
    assert.deepEqual(fixture(tool).verify(),[]);
    const mutations:((f:ReturnType<typeof fixture>)=>void)[]=[
      f=>{f.pair.proof.target=path.join(root,'other');},
      f=>f.alter(true,es=>{es[1]!.message.content[0].input={...es[1]!.message.content[0].input,extra:'different'};}),
      f=>f.alter(false,es=>{es[1]!.message.content[0].input={};}),
      f=>{f.pair.positive.fixture_after='incorrect';},
      f=>{f.pair.candidate.fixture_before='incorrect';f.pair.candidate.fixture_after='incorrect';},
      f=>{f.pair.candidate.fixture_after='changed';},
      f=>{delete (f.pair.candidate as {fixture_before?:unknown}).fixture_before;},
      f=>{delete (f.pair.positive as {fixture_before?:unknown}).fixture_before;},
      f=>{f.pair.candidate.argv.push('--permission-mode','bypassPermissions');},
      f=>{f.pair.positive.argv.push('--tools','');},
      f=>f.alter(true,es=>{es[0]!.cwd=path.dirname(root);}),
      f=>f.alter(true,es=>{es[2]!.message.content[0].content='Error: Tool "Other" not found.';}),
      f=>f.alter(true,es=>{es.splice(1,1);es.splice(1,1);}),
      f=>f.alter(true,es=>{es.splice(3,0,{type:'assistant',message:{model:'Exact',content:[{type:'tool_use',id:'extra',name:'Agent',input:{}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'extra',is_error:false,content:'SUCCESS'}]}});}),
      f=>f.alter(true,es=>{es[0]!.tools=['Read','Read','Grep'];}),
      f=>{f.doc.source_kind='controlled-loopback-native-cli';},
      f=>f.alter(false,es=>{es.splice(3,0,{type:'assistant',message:{model:'Exact',content:[{type:'tool_use',id:'extra',name:'Agent',input:{}}]}},{type:'user',message:{content:[{type:'tool_result',tool_use_id:'extra',is_error:false,content:'SUCCESS'}]}});}),
      f=>{delete (f.doc as {source_kind?:string}).source_kind;},
    ];
    for(const [i,mutate] of mutations.entries()){
      const f=fixture(tool);mutate(f);assert.ok(f.verify().length,tool+' mutation '+i+' 必须拒绝');
    }
    for(const candidate of [true,false])for(const field of ['timed_out','truncated','early_stopped','spawned'] as const){
      const f=fixture(tool),a=candidate?f.pair.candidate:f.pair.positive;
      a[field]=field!=='spawned';assert.ok(f.verify().length,tool+' '+field+' 必须拒绝');
      const missing=fixture(tool),ma=candidate?missing.pair.candidate:missing.pair.positive;
      delete (ma as Partial<typeof ma>)[field];assert.ok(missing.verify().length,'缺 '+field+' 必须拒绝');
    }
    const signal=fixture(tool);(signal.pair.candidate as {raw_signal:string|null}).raw_signal='SIGTERM';assert.ok(signal.verify().length);
  });
}

test('共用判据区分未调用、mode拒绝、真实成功越权和文件变化',()=>{
  const f=fixture('Write'),convert=(a:typeof f.pair.candidate)=>{
    const t=parseQoderTrace(a.stdout);return {route_valid:true,trace_errors:t.errors,tools:t.init?.tools,calls:t.calls,fixture_before:a.fixture_before,fixture_after:a.fixture_after};
  };
  const positive=convert(f.pair.positive),candidate=convert(f.pair.candidate);
  const outcome=(a:Omit<typeof candidate,'fixture_before'>&{fixture_before?:unknown})=>executionPairOutcome({positive,candidate:a,tool:'Write',target:f.target,readingTools:QODER_READING_TOOLS});
  assert.equal(outcome(candidate).state,'pass');
  assert.equal(outcome({...candidate,calls:[]}).state,'untested');
  assert.equal(outcome({...candidate,calls:[{...candidate.calls[0]!,channel:'permission-mode'}]}).state,'fail');
  assert.equal(outcome({...candidate,calls:[{...candidate.calls[0]!,result:{is_error:false,content:'OK'}}]}).unsafe,true);
  assert.equal(outcome({...candidate,fixture_after:'changed'}).unsafe,true);
  assert.equal(outcome({...candidate,fixture_before:undefined}).unsafe,false);
  assert.equal(outcome({...candidate,fixture_before:undefined}).state,'fail');
});

test('错误方向/顺序或不匹配工具名的结果不能冒充原生分发拒绝',()=>{
  for(const edit of [
    (es:Record<string,any>[])=>{es[1]!.type='user';},
    (es:Record<string,any>[])=>{es[2]!.type='assistant';},
    (es:Record<string,any>[])=>{[es[0],es[1]]=[es[1]!,es[0]!];},
  ]){
    const f=fixture('Write');f.alter(true,edit);assert.ok(parseQoderTrace(f.pair.candidate.stdout).errors.length);assert.ok(f.verify().length);
  }
});

test('正控制原样消费冻结参数，仅替换唯一工具列表，缺失/重复拒绝',()=>{
  const args=[...QODER_REVIEW_ARGS],before=[...args],positive=qoderExecutionControlArgs(args,'Edit',QODER_READING_TOOLS);
  assert.deepEqual(args,before);
  const changed=positive.flatMap((value,index)=>value!==args[index]?[value]:[]);
  assert.deepEqual(changed,[[...QODER_READING_TOOLS,'Edit'].join(',')]);
  for(const invalid of [[],['fixture'],[QODER_READING_TOOLS.join(',')],[...args,QODER_READING_TOOLS.join(',')]])assert.throws(()=>qoderExecutionControlArgs(invalid,'Edit',QODER_READING_TOOLS),/唯一/);
});
