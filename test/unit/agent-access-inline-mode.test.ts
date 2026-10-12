/** 实际mode3输入helper的消费与拒绝边界；不启动CLI，不证明真实模式生效。 */
import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const moduleUrl=pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r21/controlled-inline-mode.mjs')).href;
type Options={model:string;effort:null;readonlyArgs:string[];schemaJson:string;settingsJson:string;maxBudgetUsd:null};
const original=JSON.stringify({permissions:{deny:['Read(./.env)','Grep(./.env)','Glob(./.env)']}}),live={permissionMode:'default'};
const baseline=():Options=>({model:'declared-model',effort:null,readonlyArgs:['--restricted','--strict-mcp-config','--tools','Read,Grep,Glob'],schemaJson:'{}',settingsJson:original,maxBudgetUsd:null});
test('inline only新增defaultMode，原deny和其余实际buildClaudeArgs逐项不变',async()=>{
 const m=await import(moduleUrl),b=baseline(),binding=m.buildInlineModeSettings(original,live),c={...b,settingsJson:binding.proposed_json},result=m.verifyInlineModeSettings(binding,b,c,live);
 assert.equal(result.verified,true);assert.equal(result.deny_exactly_unchanged,true);assert.equal(result.changed_argument_indices.length,1);
 assert.notEqual(binding.original_sha256,binding.proposed_sha256);assert.deepEqual(JSON.parse(binding.proposed_json).permissions.deny,JSON.parse(original).permissions.deny);assert.equal(JSON.parse(binding.proposed_json).permissions.defaultMode,'default');
});
for(const[label,json]of [
 ['损坏JSON','{'],['缺deny','{}'],['空deny',JSON.stringify({permissions:{deny:[]}})],['重复deny',JSON.stringify({permissions:{deny:['Read(./.env)','Read(./.env)']}})],
 ['原settings已有mode',JSON.stringify({permissions:{deny:['Read(./.env)'],defaultMode:'auto'}})],['原settings已有allow',JSON.stringify({permissions:{deny:['Read(./.env)'],allow:[]}})],['未知根键',JSON.stringify({permissions:{deny:['Read(./.env)']},unknown:true})],
 ['非字符串规则',JSON.stringify({permissions:{deny:[null]}})],
] as const)test(label+'在构造时拒绝',async()=>{const m=await import(moduleUrl);assert.throws(()=>m.buildInlineModeSettings(json,live));});
for(const mode of ['auto','bypassPermissions',null,undefined])test('非live default '+String(mode)+'拒绝',async()=>{const m=await import(moduleUrl);assert.throws(()=>m.buildInlineModeSettings(original,{permissionMode:mode}));});
const mutations:Record<string,(binding:Record<string,any>,base:Options,current:Options)=>void>={
 '丢deny规则':(_,__,c)=>{const j=JSON.parse(c.settingsJson);j.permissions.deny.pop();c.settingsJson=JSON.stringify(j);},
 '规则相邻目标':(_,__,c)=>{const j=JSON.parse(c.settingsJson);j.permissions.deny[0]='Read(./.env-neighbour)';c.settingsJson=JSON.stringify(j);},
 'deny顺序变化':(_,__,c)=>{const j=JSON.parse(c.settingsJson);j.permissions.deny.reverse();c.settingsJson=JSON.stringify(j);},
 '新allow':(_,__,c)=>{const j=JSON.parse(c.settingsJson);j.permissions.allow=['Read(*)'];c.settingsJson=JSON.stringify(j);},
 '新auto':(_,__,c)=>{const j=JSON.parse(c.settingsJson);j.permissions.defaultMode='auto';c.settingsJson=JSON.stringify(j);},
 '伪造denyhash':b=>{b.deny_sha256='a'.repeat(64);},'伪造jsonhash':b=>{b.proposed_sha256='a'.repeat(64);},'多余binding字段':b=>{b.allow=true;},
 '改模型':(_,__,c)=>{c.model='other';},'工具面变化':(_,__,c)=>{c.readonlyArgs=[...c.readonlyArgs,'--tools','Write'];},
 '移除restricted':(_,__,c)=>{c.readonlyArgs=c.readonlyArgs.filter(v=>v!=='--restricted');},'Schema变化':(_,__,c)=>{c.schemaJson='{"type":"string"}';},
 '重复settings':(_,__,c)=>{c.readonlyArgs=[...c.readonlyArgs,'--settings','{}'];},
};
for(const[label,mutate]of Object.entries(mutations))test(label+'由实际argv/输入重算拒绝',async()=>{const m=await import(moduleUrl),b=baseline(),binding=m.buildInlineModeSettings(original,live),c={...b,readonlyArgs:[...b.readonlyArgs],settingsJson:binding.proposed_json};mutate(binding,b,c);assert.equal(m.verifyInlineModeSettings(binding,b,c,live).verified,false);});
