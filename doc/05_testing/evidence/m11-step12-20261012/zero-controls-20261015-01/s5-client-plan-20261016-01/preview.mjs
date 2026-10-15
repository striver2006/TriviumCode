/** 纯渲染/只读推导配置差异，不调用runInit、mergeAgentHooks或任何CLI。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {protocolPlan,composeProtocol,isKnownProtocolBody} from '../../../../../../dist/test/src/trivium/init.js';
import {renderHookEvents} from '../../../../../../dist/test/src/trivium/hook-config.js';
import {AGENTS} from '../../../../../../dist/test/src/trivium/agents/registry.js';
import {defaultConfig,CONFIG_SCHEMA_ID} from '../../../../../../dist/test/src/trivium/config.js';
import {here,repo,read,hash,digest,verifyAnchors,saveEvidence} from './common.mjs';
const p=read(here+'/preparation.json');verifyAnchors(p);
const archive={'.trivium/bin/trivium':fs.readFileSync(here+'/expected-init-wrapper.sh','utf8')};
const empty={...archive};
const hookSource=read(p.assets+'/hooks/hooks.json');
const hooks=[];
for(const a of AGENTS.filter(a=>a.hookConfigTarget)){
 const s=a.hookConfigTarget,events=renderHookEvents(s.format,hookSource,s.path);
 const c=read(p.source+'/'+s.path);
 assert.deepEqual(s.format==='claude-settings'?c.hooks:c.hooks.events,events,'现有Hook不是当前安装资产；停止静态预览');
 if(s.format!=='claude-settings')assert.equal(c.hooks.enabled,true);
 archive[s.path]=fs.readFileSync(p.source+'/'+s.path,'utf8');
 empty[s.path]=JSON.stringify(s.format==='claude-settings'?{hooks:events}:{hooks:{events,enabled:true}},null,2)+'\n';
 hooks.push({file:s.path,semantic_diff:[],all_events_retained:true});
}
const begin='<!-- BEGIN TriviumCode -->',end='<!-- END TriviumCode -->';
for(const item of protocolPlan()) {
 const body=await composeProtocol(p.assets,item.sections);assert(body);
 const old=fs.readFileSync(p.source+'/'+item.file,'utf8');
 const b=old.indexOf(begin),e=old.indexOf(end,b);assert(b>=0&&e>b);
 const interior=old.slice(b+begin.length,e).trim();
 archive[item.file]=interior===body.trim()||!isKnownProtocolBody(item.file,interior)?old:old.slice(0,b)+begin+'\n'+body.trim()+'\n'+old.slice(e);
 empty[item.file]='\n'+begin+'\n'+body.trim()+'\n'+end+'\n';
}
const ignore=fs.readFileSync(p.source+'/.gitignore','utf8');
assert(ignore.includes('# TriviumCode 编排器运行时目录 (.trivium/)'));assert(!ignore.split('\n').some(l=>['.claude/','/.claude/'].includes(l.trim())));
archive['.gitignore']=ignore;empty['.gitignore']='\n'+fs.readFileSync(p.assets+'/protocol/gitignore.snippet','utf8');
const config=fs.readFileSync(p.source+'/.trivium/config.yaml','utf8');assert.equal(YAML.parse(config).schema,CONFIG_SCHEMA_ID);
archive['.trivium/config.yaml']=config;
const {probe,...defaults}=defaultConfig();
empty['.trivium/config.yaml']='# TriviumCode 项目配置（进 Git，团队共享）\n# 本机绝对路径与探针结论在 config.local.yaml（不进 Git）\n# verify.build / verify.test 只执行此处显式声明的命令——编排器不猜测执行（§14.1）\n\n'+YAML.stringify({...defaults,verify:{build:[],test:[]}},{lineWidth:0});
archive['.reviews/README.md']=fs.readFileSync(p.source+'/.reviews/README.md','utf8');
empty['.reviews/README.md']='# 多智能体协同审计与留痕目录 (.reviews)\n\n本目录由 TriviumCode 编排器写入，是双审流水线对外的事实来源。\n命名规范见 `<日期>-<主题>[-r<N>][-revised|-response]-<角色>.md`。\n';
const diffs=Object.entries({archive,empty}).flatMap(([name,contents])=>Object.entries(contents).map(([file,after])=>{
 const f=p.fixtures[name]+'/'+file,before=fs.existsSync(f)?fs.readFileSync(f,'utf8'):null;
 return {fixture:name,file,before,after,before_sha256:before===null?null:digest(before),after_sha256:digest(after),changed:before!==after};
}));
const sources=['init.js','hook-config.js','config.js','agents/registry.js'].map(f=>repo+'/dist/test/src/trivium/'+f).map(file=>({file,sha256:hash(file)}));
saveEvidence(here+'/configuration-preview.json',{at:new Date().toISOString(),method:'纯函数与已读源代码推导，未执行init；实际输出必须逐字节核对，不符即停',sources,hooks,diffs});
console.log(JSON.stringify({changed:diffs.filter(d=>d.changed).map(d=>d.fixture+':'+d.file),hooks_semantic_changes:0,init_executed:false}));
