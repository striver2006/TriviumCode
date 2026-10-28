import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultConfig} from '../../src/trivium/config.js';
import {QoderModelMonitor,qoderHash,qoderModelRequest,normalizeQoderSelection,validateQoderFacts} from '../../src/trivium/adapters/qoder-cn-model.js';
import {QoderSecretGuard,extractQoderCodec} from '../../src/trivium/adapters/qoder-cn-custom.js';
import {qoderCnAdapter} from '../../src/trivium/adapters/qoder-cn.js';
import {qoderIsolationHash} from '../../src/trivium/adapters/qoder-cn-custom.js';
import {QODER_ENV_KEYS,qoderPolicyTemplate} from '../../src/trivium/adapters/qoder-cn-native.js';
import {resolveConfiguredTier} from '../../src/trivium/model-routing.js';
import {checkModelSlugs} from '../../src/trivium/preflight.js';
import type {NativeModelFacts,NativeRouteDescriptor} from '../../src/trivium/types.js';

const hash='a'.repeat(64);
const descriptor:NativeRouteDescriptor={selector:'custom:provider/Exact',native_key:'provider/Exact',display_name:'Custom display',provider_id:'provider',model_id:'Exact',source_ref:'/fixture/.models/id/customs',declaration_sha256:hash,credential_source_sha256:hash,authentication_sha256:hash,recipe_sha256:hash,codec:{source_sha256:hash,wasm_sha256:hash,recipe:'fixture'}};
const custom:NativeModelFacts={binding_version:2,route_kind:'custom',route_descriptor:descriptor,model:descriptor.selector,source:'native-config',observed_user_model:null,models:[descriptor.selector],route_labels:['Auto','Fast'],catalog_sha256:qoderHash(JSON.stringify({models:[descriptor.selector],routeLabels:['Auto','Fast']})),catalog_raw_sha256:hash,configuration_sha256:hash,entrypoint:'/fixture/bin',cli_sha256:hash,cli_version:'fixture/0.0.0',platform:process.platform,prepared_at:new Date().toISOString(),default_verified:true,invocation_args:['--tools','']};
const official:NativeModelFacts={...custom,binding_version:undefined,route_kind:undefined,route_descriptor:undefined,model:'Exact',source:'catalog-default',models:['Exact'],catalog_sha256:qoderHash(JSON.stringify({models:['Exact'],routeLabels:['Auto','Fast']}))};

test('官方/Custom同名通过完整选择消歧，未知Custom不能借通用短名目录放行',()=>{
  const cfg=defaultConfig();cfg.probe.cli['qoderclicn']={...cfg.probe.cli['qoderclicn']!,native_default:official,native_routes:[custom]};
  assert.equal(normalizeQoderSelection('official:exact',[official,custom]),'Exact');
  assert.equal(normalizeQoderSelection('provider/Exact',[official,custom]),descriptor.selector);
  assert.equal(qoderCnAdapter.nativeModelFor!(cfg,'custom:provider/Exact','cli').requested,descriptor.selector);
  assert.equal(checkModelSlugs(cfg,'plan',{'qoder-cn':'custom:unknown/Exact'},['qoder-cn']).ok,false);
  assert.equal(checkModelSlugs(cfg,'plan',{'qoder-cn':'custom:provider/Exact'},['qoder-cn']).ok,true);
  assert.equal(checkModelSlugs(cfg,'plan',{'qoder-cn':'official:Exact'},['qoder-cn']).ok,true);
  assert.throws(()=>normalizeQoderSelection('custom:../Exact',[custom]));
  assert.throws(()=>normalizeQoderSelection('custom:PROVIDER/exact',[custom]),/缺失/);
  assert.throws(()=>normalizeQoderSelection(descriptor.selector,[custom,structuredClone(custom)]));
  const request=qoderModelRequest(custom,'provider/Exact','cli');assert.equal(request.override,'provider/Exact');assert.equal(request.facts.route_descriptor!.provider_id,'provider');
  assert.throws(()=>validateQoderFacts({...custom,route_descriptor:{...descriptor,provider_id:'other'}}));
});

test('Custom必要回读只作路线一致性，不把显示名/计费key提升为底层身份',()=>{
  const monitor=new QoderModelMonitor(descriptor.selector,['Auto','Fast'],[],descriptor);
  monitor.line(JSON.stringify({type:'system',subtype:'init',model:descriptor.display_name}));
  monitor.line(JSON.stringify({type:'assistant',message:{model:descriptor.display_name,content:[{text:'I am another model'}]}}));
  monitor.line(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'OK',modelUsage:{[descriptor.native_key]:{}}}));
  assert.deepEqual(monitor.finish(),{label:descriptor.display_name,effective:null,source:'unverified'});
  for(const missing of ['init','usage']){
    const m=new QoderModelMonitor(descriptor.selector,['Auto','Fast'],[],descriptor);
    m.line(JSON.stringify({type:missing==='init'?'assistant':'system',subtype:'init',model:descriptor.display_name,message:{model:descriptor.display_name}}));
    m.line(JSON.stringify({type:'result',subtype:'success',is_error:false,modelUsage:missing==='usage'?{}:{[descriptor.native_key]:{}}}));
    assert.throws(()=>m.finish(),/必要/);
  }
  monitor.line(JSON.stringify({type:'system',subtype:'init',model:'Auto'}));assert.throws(()=>monitor.finish(),/变化|回退/);
});

test('codec未知布局拒绝；生产秘密护栏覆盖JSON转义和非正文落盘出口',()=>{
  assert.throws(()=>extractQoderCodec(Buffer.from('unknown')),/布局/);
  const guard=new QoderSecretGuard();guard.addCredential('{"region":"cn","access_token":"test_key_fixture_token"}');
  guard.add('test_key_"escaped\nvalue');
  const safe=guard.scrub(JSON.stringify({labels:['test_key_fixture_token'],fail_reason:'test_key_"escaped\nvalue',raw_response_text:'cn'}));
  assert.equal(safe.includes('test_key_'),false);assert.equal(guard.leaked,true);assert.equal(JSON.parse(safe).raw_response_text,'cn');
});
test('实际环境键/权限模板与别名样本进入配方指纹，键变更自动失效',()=>{
  const template=qoderPolicyTemplate();assert.deepEqual(template.proxy_controls,[true,false,false,false,false,false]);
  assert.ok(template.settings.permissions.deny.some(rule=>rule.includes('/TRIVIUM_PEER')));assert.deepEqual(template.aliases[0]!.sort(),template.aliases[1]!.sort());
  const before=qoderIsolationHash();QODER_ENV_KEYS.push('TRIVIUM_SYNTHETIC_POLICY_KEY');try{assert.notEqual(qoderIsolationHash(),before);}finally{QODER_ENV_KEYS.pop();}assert.equal(qoderIsolationHash(),before);
});


test('三档显式Custom配置与单次官方覆盖独立，未配置不继承全局Custom默认',()=>{
  const cfg=defaultConfig();cfg.probe.cli['qoderclicn']={...cfg.probe.cli['qoderclicn']!,native_default:official,native_routes:[custom]};
  for(const name of ['default','flash','pro']){cfg.active_profile=name;cfg.profiles[name]??={};cfg.profiles[name]!['qoder-cn']={code:descriptor.selector};const routed=resolveConfiguredTier(cfg,'qoder-cn','code');assert.equal(routed.model,descriptor.selector);assert.equal(qoderCnAdapter.nativeModelFor!(cfg,routed.model!,'cell').requested,descriptor.selector);assert.equal(resolveConfiguredTier(cfg,'qoder-cn','code',{model:'official:Exact'}).model,'official:Exact');delete cfg.profiles[name]!['qoder-cn'];assert.equal(resolveConfiguredTier(cfg,'qoder-cn','code').model,'Exact');}
});
