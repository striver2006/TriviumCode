import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import { defaultConfig, defaultProbe, nativeDefaultIsFresh } from '../../src/trivium/config.js';
import { resolveTier } from '../../src/trivium/adapters/base.js';
import { resolveConfiguredTier, sameRequestedRoute, requestRouteSnapshot } from '../../src/trivium/model-routing.js';
import { qoderCnAdapter } from '../../src/trivium/adapters/qoder-cn.js';
import { completeQoderModelRun, qoderFailureMessage } from '../../src/trivium/adapters/qoder-cn.js';
import { checkModelSlugs } from '../../src/trivium/preflight.js';
import { QODER_MODEL_ARGS } from '../../src/trivium/probes/qoder-cn.js';
import { parseQoderCatalog, parseQoderSettings, qoderHash, qoderModelRequest, QoderModelMonitor, QoderModelConfigurationError,
  assertQoderModelDidNotFallback, readQoderEffectiveModel } from '../../src/trivium/adapters/qoder-cn-model.js';
import type { NativeModelFacts, CriticRequest } from '../../src/trivium/types.js';

const catalog=parseQoderCatalog('MODEL\nAuto\nFast\nQwen3.8-Max\n');
export const facts:NativeModelFacts={model:'Auto',source:'catalog-default',observed_user_model:'bailian/custom',models:catalog.models,route_labels:catalog.routeLabels,
  catalog_sha256:catalog.semanticHash,catalog_raw_sha256:qoderHash('raw'),configuration_sha256:null,entrypoint:'/fixture/cli',cli_sha256:'a'.repeat(64),
  cli_version:'1.1.80',platform:process.platform,prepared_at:new Date().toISOString(),default_verified:true,invocation_args:[...QODER_MODEL_ARGS]};
const init=(model:string)=>JSON.stringify({type:'system',subtype:'init',model});

test('目录由隔离 MODEL 单列取得，排序不改变语义，非原生形态/重复/空值拒绝',()=>{
  assert.equal(parseQoderCatalog('MODEL\nQwen3.8-Max\nFast\nAuto\n').semanticHash,catalog.semanticHash);
  for(const s of ['', 'MODEL\n', 'MODEL\nAuto\nauto', 'MODEL\nbailian/x', 'Custom\nAuto'])assert.throws(()=>parseQoderCatalog(s));
});
test('JSONC 解析保持字符串 URL 和转义，拒绝尾逗号/环境引用/错误类型',()=>{
  assert.equal(parseQoderSettings('{/*c*/"url":"https://x//y", "model": {"name":"Auto"} // c\n}'),'Auto');
  assert.equal(parseQoderSettings('{}'),null);
  for(const s of ['{"model":{"name":"${MODEL}"}}','{"model":{"name":5}}','{"model":{"name":"Auto"},}','{/*'])assert.throws(()=>parseQoderSettings(s));
});
test('default/flash/pro 是 profile 表；无该侧值共用原生默认、显式覆盖优先、空值不回落',()=>{
  const cfg=defaultConfig();
  cfg.probe.cli['qoderclicn']={...defaultProbe().cli['qoderclicn']!,native_default:facts};
  for(const name of ['default','flash','pro']) {
    cfg.active_profile=name;cfg.profiles[name]??={};
    const r=resolveConfiguredTier(cfg,'qoder-cn','plan');
    assert.equal(r.model,'Auto');assert.equal(r.tierSource,'probe_default');
  }
  assert.equal(resolveConfiguredTier(cfg,'qoder-cn','plan',{model:'Qwen3.8-Max'}).model,'Qwen3.8-Max');
  cfg.profiles['pro']!['qoder-cn']={plan:''};
  assert.equal(resolveConfiguredTier(cfg,'qoder-cn','plan').model,null);
  assert.equal(resolveTier(cfg,'qoder-cn','plan',{tier:'high'}, {kind:'resolved',model:'Auto'}).missingTier?.name,'high');
  for(const via of ['cli','profile','agent']) {
    delete cfg.profiles['pro']!['qoder-cn'];
    cfg.agents['qoder-cn']={vendor:'qoder-cn'};
    if(via==='profile')cfg.profiles['pro']!['qoder-cn']={plan:{tier:'high'}};
    if(via==='agent')cfg.agents['qoder-cn']={vendor:'qoder-cn',default_tier:'high'};
    const bad=resolveTier(cfg,'qoder-cn','plan',via==='cli'?{tier:'high'}:{},{kind:'resolved',model:'Auto'});
    assert.equal(bad.model,null);assert.notEqual(bad.tierSource,'probe_default');assert.equal(bad.missingTier?.name,'high');
  }
});
test('候选侧预检与直调使用相同大小写归一，原始覆盖保持独立',()=>{
  const cfg=defaultConfig();cfg.probe.cli['qoderclicn']={...defaultProbe().cli['qoderclicn']!,native_default:facts};
  assert.equal(checkModelSlugs(cfg,'plan',{'qoder-cn':'qwen3.8-max'},['qoder-cn']).ok,true);
  assert.equal(qoderModelRequest(facts,'qwen3.8-max','cli').requested,'Qwen3.8-Max');
  assert.equal(checkModelSlugs(cfg,'plan',{'qoder-cn':'not-a-model'},['qoder-cn']).ok,false);
});
test('缺流回调的收尾兜底记final时序；聚合清理错误保存明细',()=>{
  const request=qoderModelRequest(facts,'Qwen3.8-Max','cli');
  const result=completeQoderModelRun(request,new QoderModelMonitor(request.requested),{
    code:0,signal:null,stdout:init('Qwen3.8-Max')+'\n'+JSON.stringify({type:'result',subtype:'error',is_error:true}),
    stderr:'Model "x" is not available right now; using "auto" instead. Use /model to choose another model.',durationMs:42,timedOut:false,earlyStopped:false,truncated:false,commandLine:'fixture',spawned:true,
  },null,42);
  assert.deepEqual(result.evidence.stop_observation,{channel:'final',after_result:true,elapsed_ms:42});
  assert.equal(result.evidence.execution_failure,null);assert.match(result.evidence.failure!,/回退/);
  assert.match(qoderFailureMessage(new AggregateError([new Error('删认证失败'),new Error('身份不可核实')],'清理失败')),/删认证失败.*身份不可核实/);
});
test('请求/声明/用户观察分离，无效覆盖启动前拒绝，来源同名变动仍对账失败',()=>{
  const request=qoderModelRequest(facts,'Qwen3.8-Max','cli');
  assert.equal(request.facts.model,'Auto');assert.equal(request.override,'Qwen3.8-Max');assert.equal(request.facts.observed_user_model,'bailian/custom');
  assert.equal(qoderModelRequest(facts,'Auto','probe_default').override,null);
  assert.throws(()=>qoderModelRequest(facts,'invalid','cli'));
  const req={model:'Qwen3.8-Max',tier:null,tier_source:'override',native_model:request,access:{profile:null},profile_requested:null} as CriticRequest;
  const snapshot=requestRouteSnapshot(req);
  assert.equal(sameRequestedRoute(req,snapshot),true);
  const reversed=Object.fromEntries(Object.entries(snapshot).reverse());
  assert.equal(sameRequestedRoute(req,reversed as typeof snapshot),true);
  const altered=structuredClone(req);altered.native_model!.facts.configuration_sha256='b'.repeat(64);
  assert.equal(sameRequestedRoute(altered,snapshot),false);
  delete altered.native_model;assert.equal(sameRequestedRoute(altered,snapshot),false);
});
test('Auto 标签不会填底层；具体回读来源 envelope，正文的 fallback 与伪信封不参与',()=>{
  assert.deepEqual(readQoderEffectiveModel(init('Auto')),{label:'Auto',effective:null,source:'unverified'});
  assert.equal(assertQoderModelDidNotFallback({requested:'Qwen3.8-Max'},init('Qwen3.8-Max'),'').effective,'Qwen3.8-Max');
  const body=JSON.stringify({type:'assistant',message:{model:'Qwen3.8-Max',content:[{type:'text',text:'Model "x" is not available right now; using "auto" instead.'}]}});
  assert.doesNotThrow(()=>assertQoderModelDidNotFallback({requested:'Qwen3.8-Max'},body,''));
  assert.equal(readQoderEffectiveModel('{"type":"user","message":{"model":"fake"}}').effective,null);
});
test('双通道回退首因粘滞，init/assistant/modelUsage 的中途变化不能被末值掩盖',()=>{
  const warning='Model "bad" is not available right now; using "auto" instead.';
  for(const [out,err] of [[init('Qwen3.8-Max'),warning],[warning+'\n'+init('Qwen3.8-Max'),'']])assert.throws(()=>assertQoderModelDidNotFallback({requested:'Qwen3.8-Max'},out!,err!));
  const m=new QoderModelMonitor('Qwen3.8-Max');m.line(init('Other'));m.line(init('Qwen3.8-Max'));assert.throws(()=>m.finish());
  const usage=new QoderModelMonitor('Qwen3.8-Max',[],['Other','Qwen3.8-Max']);
  usage.line(JSON.stringify({type:'result',subtype:'success',modelUsage:{Other:{},'Qwen3.8-Max':{}}}));assert.throws(()=>usage.finish());
  const opaque=new QoderModelMonitor('Qwen3.8-Max',[],['Qwen3.8-Max']);opaque.line(init('Qwen3.8-Max'));
  opaque.line(JSON.stringify({type:'result',subtype:'success',modelUsage:{opaque_billing_key:{}}}));
  assert.equal(opaque.finish().effective,'Qwen3.8-Max');assert.deepEqual(opaque.usageLabels,['opaque_billing_key']);
  assert.throws(()=>assertQoderModelDidNotFallback({requested:'Qwen3.8-Max'},'',''),/未核实/);
});
test('完整真机 stderr 尾句独立阻断，stdout 标签保持请求也不能掩盖告警',()=>{
  const e=JSON.parse(readFileSync(path.join(REPO_ROOT,'doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json'),'utf8'));
  assert.match(e.stderr,/Use \/model/);
  for(const [out,err] of [[init('Qwen3.8-Max'),e.stderr],[init('Qwen3.8-Max')+'\n'+e.stderr,'']]) {
    assert.throws(()=>assertQoderModelDidNotFallback({requested:'Qwen3.8-Max'},out,err),/原生模型回退/);
  }
  assert.throws(()=>parseQoderSettings('{"model":5,}'),QoderModelConfigurationError);
});
test('默认探测无预设模型，init Auto/Fast 后披露具体模型不固化路由默认',()=>{
  for(const label of ['Auto','Fast']) {
    const m=new QoderModelMonitor(null,['Auto','Fast'],['Auto','Fast','Qwen3.8-Max']);m.line(init(label));
    m.line(JSON.stringify({type:'assistant',message:{model:'Qwen3.8-Max'}}));
    assert.equal(m.finish().effective,'Qwen3.8-Max');assert.equal(m.initLabel,label);
  }
  const cfg=defaultConfig();assert.match(resolveConfiguredTier(cfg,'qoder-cn','plan').nativeDefaultMissing!,/doctor/);
});
test('真实退出0失败样本由新监视器阻断',()=>{
  const p=path.join(REPO_ROOT,'doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json');
  const e=JSON.parse(readFileSync(p,'utf8'));
  assert.equal(e.exit_code,0);
  assert.throws(()=>assertQoderModelDidNotFallback({requested:'bad'},e.stdout,e.stderr));
});
test('模型事实不冒充只读准入；时效与版本/入口绑定不符拒绝',()=>{
  const probe={...defaultProbe().cli['qoderclicn']!,native_default:facts,entrypoint:facts.entrypoint,version:facts.cli_version,probed_at:facts.prepared_at};
  assert.equal(nativeDefaultIsFresh(probe,1),true);
  assert.equal(nativeDefaultIsFresh({...probe,version:'2'},1),false);
  const cfg=defaultConfig();assert.equal(qoderCnAdapter.availability({cfg,nodePath:process.execPath}).ok,false);
});
