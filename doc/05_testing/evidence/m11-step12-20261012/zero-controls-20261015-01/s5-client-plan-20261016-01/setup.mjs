/** 仅供Bob在取得s5-setup明确授权后于系统终端运行。当前不执行。每个夹具一次。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {here,read,hash,inventory,verifyAnchors,authorization,fixture,assertSameExcept,saveEvidence} from './common.mjs';
const name=process.argv[2];assert.equal(process.argv.length,3);
authorization(here+'/setup-authorization.json','s5-setup');
const p=read(here+'/preparation.json');verifyAnchors(p);const cwd=fixture(p,name);
const before=inventory(cwd);assert.deepEqual(before,name==='archive'?p.original_files:p.empty_files);
saveEvidence(here+'/setup-'+name+'-before.json',{at:new Date().toISOString(),cwd,files:before});
const args=[here+'/runtime.mjs','init','--json'];
const r=spawnSync(p.node,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
const files=inventory(cwd);
saveEvidence(here+'/setup-'+name+'-init-result.json',{at:new Date().toISOString(),command:[p.node,...args],cwd,exit_code:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr,files});
assert.equal(r.status,0,'init失败：保留现场，不自动重试或恢复');assert(!r.error);
for(const d of read(here+'/configuration-preview.json').diffs.filter(d=>d.fixture===name))assert.equal(hash(cwd+'/'+d.file),d.after_sha256,'init实际输出与逐文件配置预览不同：'+d.file);
// 所有归档、state、业务文件、索引/objects不得因初始化改变。
const allowed=['.trivium/bin/trivium','.claude/settings.json','.zcode/config.json','.gitignore','CLAUDE.md','AGENTS.md','GEMINI.md'];
if(name==='empty')allowed.push('.trivium/config.yaml','.reviews/README.md');
assertSameExcept(before,files,allowed);
assert.deepEqual(read(cwd+'/.claude/settings.json').hooks,p.hooks,'不得移除/改序/更换现有Hook');
assert.equal(fs.readFileSync(cwd+'/.trivium/bin/trivium','utf8'),fs.readFileSync(here+'/expected-init-wrapper.sh','utf8'),'正式init输出超出预览，停止');
saveEvidence(here+'/setup-'+name+'-standard-wrapper.json',{file:cwd+'/.trivium/bin/trivium',sha256:hash(cwd+'/.trivium/bin/trivium'),content:fs.readFileSync(cwd+'/.trivium/bin/trivium','utf8'),mode:fs.statSync(cwd+'/.trivium/bin/trivium').mode&0o777});
// 只有在上面全部校验成功后安装已经单独获批的采集wrapper；不改原工程wrapper。
fs.copyFileSync(here+'/proposed-wrapper.sh',cwd+'/.trivium/bin/trivium');fs.chmodSync(cwd+'/.trivium/bin/trivium',0o755);
assert.equal(hash(cwd+'/.trivium/bin/trivium'),hash(here+'/proposed-wrapper.sh'));
verifyAnchors(p);
saveEvidence(here+'/setup-'+name+'-after.json',{at:new Date().toISOString(),cwd,files:inventory(cwd),init_exit:r.status,
 changed_paths:[...new Set([...before,...files].map(x=>x.path))].filter(f=>JSON.stringify(before.find(x=>x.path===f))!==JSON.stringify(files.find(x=>x.path===f))),
 hooks_equal:true,client_started:false,stop:'本地setup结束；不得据此启动客户端，启动预算另批。Hook采集入口在client授权前拒绝运行'});
console.log(JSON.stringify({setup:name,ready_for_client:false,stop:'等待独立客户端启动范围与预算核定'}));
