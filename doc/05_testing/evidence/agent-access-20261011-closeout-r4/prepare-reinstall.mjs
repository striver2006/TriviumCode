/** 本轮检查收据与同内容共享入口复现核验；不改原记录、不调用厂商CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.join(repo,'doc/05_testing/evidence/agent-access-20261011-closeout-r4');
const delivery=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/delivery');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const label of ['check1','check2']){
 const p=path.join(delivery,`${label}-round9.log`),log=fs.readFileSync(p,'utf8');
 const extract=k=>Number(new RegExp('ℹ '+k+' (\\d+)').exec(log)?.[1]);
 const stats={tests:extract('tests'),pass:extract('pass'),fail:extract('fail'),skipped:extract('skipped')};
 if(stats.tests!==3142||stats.pass!==3139||stats.fail!==0||stats.skipped!==3)throw Error('检查输出不满足前置');
 saveEvidence(path.join(root,`${label}-round9.json`),{code:0,stats,log:p,log_sha256:sha(p),exit_observed_from_tool:true,real_cli_starts:0});
}
const bundle=path.join(repo,'skills/dual-critic/scripts/trivium.cjs');
saveEvidence(path.join(root,'final-build-round9.json'),{code:0,bundle_sha256:sha(bundle),source_stamp:await computeBuildStamp(repo),log:path.join(delivery,'build-final-round9.log'),real_cli_starts:0});
const self=path.join(delivery,'selftest-final-source-round9.log');if(!fs.readFileSync(self,'utf8').includes('通过（14/14 步）'))throw Error('桩未14/14');
saveEvidence(path.join(root,'selftest-round9-final.json'),{code:0,passed:14,total:14,log:self,log_sha256:sha(self),bundle_sha256:sha(bundle),actual_vendor_capability:false,real_cli_starts:0});
const previous=path.join(process.env.HOME,'.trivium/backups/trivium-shared-r12-1791676816591-fdbe9965-5d20-48fd-a2e2-77540316da15');
const names=fs.readdirSync(path.join(previous,'moved')).sort(),shared=path.join(process.env.HOME,'.agents/skills');
function inventory(base){const entries=[];function walk(p,rel=''){for(const name of fs.readdirSync(p).sort()){
 const f=path.join(p,name),r=path.join(rel,name),s=fs.lstatSync(f);entries.push({path:r,mode:s.mode&0o7777,type:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':'file',sha256:s.isFile()?sha(f):null,link:s.isSymbolicLink()?fs.readlinkSync(f):null});if(s.isDirectory())walk(f,r);}}walk(base);return entries;}
const results=names.map(name=>{const source=path.join(shared,name),old=path.join(previous,'moved',name),s=fs.lstatSync(source);
 const same=JSON.stringify(inventory(source))===JSON.stringify(inventory(old))&&(s.mode&0o7777)===(fs.lstatSync(old).mode&0o7777);
 if(!same)throw Error('共享入口出现新内容或权限，停止重新迁移');return {name,identical_to_previous_moved:true,birthtime:s.birthtime.toISOString(),inventory:inventory(source)};});
if(results.length!==7)throw Error('非原七入口');
saveEvidence(path.join(root,'shared-entry-reappearance-audit.json'),{at:new Date().toISOString(),previous_backup:previous,results,source_actor:null,
 before_round9:true,client_resolution:null,other_repository_dependency_coverage:'未测',
 correction:'本轮初始r13/r14/static报告沿用历史四目标成功，未采当前共享入口；1:38重现早于9B，现追加纠正，不改旧审查原件。',
 approved_operation_basis:'用户本轮自动审批授权；本轮9B有效及委托批准r14普通安装收口；原已审r12连续备份/可恢复移出/正常四目标安装方法，复用方法而非旧审批。',
 impact:'所有发现~/.agents/skills原七入口的仓库；只移动七个已核原内容，专用28入口保留；不改用户全局配置或删除目录',
 restore:'新备份copied/moved永久保留；失败/中断先逐个moved移回原精确位置，拒覆盖，逐文件hash/权限/软链核验。',
 failed_installer_log:path.join(delivery,'install-final-round9.log'),failed_installer_wrote_files:0,real_cli_starts:0});
// 复制获审方法为新任务版本；旧脚本、旧收据和旧备份不改。
let text=fs.readFileSync('doc/05_testing/evidence/agent-access-20261011-closeout-r3/migrate-install.mjs','utf8');
text=text.replace('r12获批迁移','r14获批普通安装收口：原七入口逐项同内容复现，复用已审迁移方法');
for(const [a,b]of [['check1-r12','check1-round9'],['check2-r12','check2-round9'],['final-build-r12','final-build-round9'],['selftest-r12-final','selftest-round9-final'],['20261010T232715Z','20261011T020308Z'],['migration-install-r12.json','migration-install-round9.json']])text=text.replaceAll(a,b);
text=text.replace("n.startsWith('trivium-shared-r12-')","(n.startsWith('trivium-shared-r12-') || n.startsWith('trivium-shared-r14-'))");
text=text.replace('`trivium-shared-r12-${Date.now()}','`trivium-shared-r14-${Date.now()}');
text=text.replace('未找到当前r12委托审批依据','未找到当前r14委托审批依据');
text=text.replace('有效r12审批；r12§四及继承GLM-02连续备份迁移方案','有效9B/r14普通审批；当前七入口逐项同内容，继承已审r12§四及GLM-02连续备份迁移方法');
text=text.replace('const original = Object.fromEntries','const reappearance = JSON.parse(fs.readFileSync(path.join(root, "shared-entry-reappearance-audit.json")));\nif (reappearance.results.length !== 7 || reappearance.results.some(r => JSON.stringify(inventory(path.join(shared, r.name))) !== JSON.stringify(r.inventory))) throw Error("共享入口自审计后改变，停止");\nconst original = Object.fromEntries');
fs.writeFileSync(path.join(root,'migrate-install-round9.mjs'),text,{flag:'wx',mode:0o600});
console.log(JSON.stringify({checks:'3139/3/0 twice',selftest:'14/14',shared_entries_identical:7,source_bundle:sha(bundle),vendor_starts:0}));
