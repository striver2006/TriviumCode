/**
 * 共享读取面 ~/.agents/skills 里的外来同名入口隔离（用户 2026-10-16 授权「按最优方案处理」）。
 * 只挪不删：七个入口 + 过时的 dual-critic 原样 rename 到 ~/.trivium/evidence/shared-entry-quarantine-20261016/，
 * 前后各跑一次安装器只读检查（planInstall + checkInstall），并核对四家已装入口与仓库渲染产物逐字节一致。零厂商调用。
 *   node doc/05_testing/evidence/shared-entry-quarantine-20261016/quarantine.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {planInstall,checkInstall,defaultInstallEnv} from '../../../../dist/test/src/install.js';
const here=import.meta.dirname,repo=path.resolve(here,'../../../..');
const shared=path.join(os.homedir(),'.agents','skills');
const dest=path.join(os.homedir(),'.'+'trivium','evidence','shared-entry-quarantine-20261016');
const NAMES=['dual-run','dual-review-plan','dual-review-code','dual-review-bug','dual-approve','dual-abandon','dual-status','dual-critic'];
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const inventory=(dir,rel='')=>fs.readdirSync(path.join(dir,rel)).sort().flatMap(n=>{const p=rel?rel+'/'+n:n,f=path.join(dir,p),s=fs.lstatSync(f);
 if(s.isSymbolicLink())throw Error('拒绝软链接：'+f);if(s.isDirectory())return inventory(dir,p);return [{path:p,sha256:sha(f),bytes:s.size,mode:s.mode&0o777}];});
const ie=defaultInstallEnv();
const check=async()=>{const plan=await planInstall(repo,ie);return (await checkInstall(plan.targets)).map(p=>({...p,path:p.path.replace(os.homedir(),'~')}));};
const installed=async()=>{const plan=await planInstall(repo,ie);const rows=[];
 for(const t of plan.targets)for(const {name,src} of t.sources){const dst=path.join(t.skillsRoot,name);
  if(!fs.existsSync(dst)){rows.push({agent:t.agent,name,state:'missing'});continue;}
  const a=inventory(src),b=inventory(dst);rows.push({agent:t.agent,name,same:JSON.stringify(a.map(x=>[x.path,x.sha256]))===JSON.stringify(b.map(x=>[x.path,x.sha256]))});}
 return rows;};
// 1. 前置
if(fs.existsSync(dest))throw Error('隔离目录已存在，不覆盖：'+dest);
const present=NAMES.filter(n=>fs.existsSync(path.join(shared,n)));
const before={problems:await check(),installed:await installed(),moved:present.map(n=>({name:n,files:inventory(path.join(shared,n))}))};
// 2. 隔离（同一文件系统内 rename，原子；目标不存在才挪）
fs.mkdirSync(dest,{recursive:false});
for(const n of present)fs.renameSync(path.join(shared,n),path.join(dest,n));
for(const m of before.moved)if(JSON.stringify(inventory(path.join(dest,m.name)))!==JSON.stringify(m.files))throw Error('隔离后内容不一致：'+m.name);
// 3. 后置
const after={problems:await check(),installed:await installed(),shared_remaining:fs.readdirSync(shared).sort()};
const out={at:new Date().toISOString(),shared_root:'~/.agents/skills',quarantine:dest.replace(os.homedir(),'~'),moved:present,
 source_finding:'Codex 的 Claude 导入：~/.codex/external_agent_session_imports.json 有一批 imported_at 落在 2026-10-12T21:13Z（七入口 birthtime 21:13:53Z），claude-cowork-import-history.json 的 CONFIG/PLUGINS 导入在 2026-10-09T05:48Z（第一波）；时间吻合，日志里没有逐文件记录',
 before,after,restore:'把 '+dest.replace(os.homedir(),'~')+'/<名> 挪回 ~/.agents/skills/<名>（目标不存在时）'};
saveEvidence(path.join(here,'result.json'),out);
console.log(JSON.stringify({moved:present,problems_before:before.problems.length,problems_after:after.problems.length,installed_not_same:after.installed.filter(r=>r.same!==true),problems_after_list:after.problems},null,1));
