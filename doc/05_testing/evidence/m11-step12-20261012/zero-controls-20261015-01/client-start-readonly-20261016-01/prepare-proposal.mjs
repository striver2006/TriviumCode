/** 仅在新证据目录准备未生效的差异/独立备份/待执行步骤；无子进程。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {saveEvidence,read,hash,digest} from '../s5-client-plan-20261016-01/common.mjs';
const here=import.meta.dirname,old=path.resolve(here,'../s5-client-plan-20261016-01'),base=path.resolve(here,'../..');
const p=read(old+'/preparation.json'),s=read(here+'/before-state.json');
const isolation='/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/client-start-readonly-20261016-01/diagnostic-isolation';
assert(!fs.existsSync(isolation),'隔离目标已存在，禁止沿用此提案');
const settings={
 'claudeCode.claudeProcessWrapper':here+'/capture-only-entry.sh',
 'claudeCode.useTerminal':false,
 'claudeCode.continueAfterReload':false,
 'claudeCode.usePythonEnvironment':false,
 'extensions.autoUpdate':false,
 'extensions.autoCheckUpdates':false,
 'update.mode':'none',
 'window.restoreWindows':'none',
};
const settingsText=JSON.stringify(settings,null,2)+'\n';
const independentBackups=Object.entries(p.fixtures).flatMap(([name,cwd])=>['.claude/settings.json','.trivium/bin/trivium'].map(rel=>{
 const file=cwd+'/'+rel;return {name,file,sha256:hash(file),mode:fs.statSync(file).mode&0o777,content:fs.readFileSync(file,'utf8')};
}));
const targets=Object.entries(p.targets).map(([kind,rel])=>{
 const target=p.fixtures.archive+'/'+rel,backup=p.root+'/backup/'+rel;
 assert.equal(hash(target),hash(backup));
 const content=fs.readFileSync(backup,'utf8');
 return {kind,relative:rel,target,backup,current_sha256:hash(target),backup_sha256:hash(backup),mode:fs.statSync(target).mode&0o777,independent_backup_content:content,
  proposed_changed_sha256:kind==='changed'?digest(Buffer.from(content+'\n<!-- M11 S5 isolated content-change control 20261016-01 -->\n')):null};
});
const code='/Applications/Visual Studio Code.app/Contents/Resources/app';
const cli=fs.readFileSync(code+'/out/cli.js','utf8');
const cliSource={file:code+'/out/cli.js',sha256:hash(code+'/out/cli.js'),excerpts:['"user-data-dir"','"extensions-dir"','"new-window"'].map(needle=>{const offset=cli.indexOf(needle);assert(offset>=0);return {needle,offset,text:cli.slice(offset,offset+200)};})};
const ext=s.extensions.find(x=>x.version==='2.1.296');
saveEvidence(here+'/configuration-proposal.json',{
 at:new Date().toISOString(),activation_authorized:false,activated:false,isolation_root:isolation,
 backup_of_target:{exists:false,restoration:'关闭新隔离实例并保留现场改名；不覆盖任何已有配置'},
 diffs:[{file:isolation+'/user-data/User/settings.json',before:null,after:settingsText,after_sha256:digest(Buffer.from(settingsText)),mode_after:0o600},
 {file:here+'/capture-only-entry.sh',current_mode:fs.statSync(here+'/capture-only-entry.sh').mode&0o777,proposed_mode:0o755,sha256:hash(here+'/capture-only-entry.sh'),applied:false},
 {file:isolation+'/extensions/anthropic.claude-code-2.1.296-darwin-arm64',before:null,copy_from:ext.root,pinned_sources:s.sources.filter(x=>x.file.startsWith(ext.root+'/')),copy_executed:false}],
 independent_backups:independentBackups,protected_targets:targets,
 capture_entry:{file:here+'/capture-only-entry.mjs',sha256:hash(here+'/capture-only-entry.mjs'),native_spawn_code_present:false,executed:false},
 cli_source:cliSource,
 launch_argv:[code+'/bin/code','--new-window','--user-data-dir',isolation+'/user-data','--extensions-dir',isolation+'/extensions',p.fixtures.archive],
 launch_argv_is_executable_plan:false,missing_parent_pre_spawn_gate:true,
 effects:['使用隔离VS Code用户数据，不能冒充原窗口effective配置','固定旧扩展版本，仅用于可比诊断；不修改原安装','禁自动恢复/更新/Python环境激活改变启动行为，只作辅助证据','不修改Claude用户/项目Hook及顺序，不设置伪造CLAUDE_PROJECT_DIR','捕获入口恒拒绝native，因此不能证明客户端健康或场景5完整性'],
 dynamic:{pool_proposed:'admission',pool_authorized:null,desired_wrapper_attempts:1,native_allowed:0,verified_total_start_upper_bound:null,verified_pre_spawn_cap:null,actual_exit:null,execution_authorized:false},
 followup_runtime_v2:{implemented:false,reason:'父级计数路线及新预算绑定尚未核定；不可修订冻结包来绕过838/401等值检查'},
 restoration_executed:false,
});
saveEvidence(here+'/matrix-before.json',read(base+'/matrix.json'));
console.log(JSON.stringify({prepared:true,activation:false,launch:false,files:['configuration-proposal.json','matrix-before.json']}));
