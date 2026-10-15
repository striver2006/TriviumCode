/** 仅同步报告和矩阵；旧证据不回写，不触发任何验收。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {saveEvidence} from '../../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,base=path.resolve(here,'../..'),repo=path.resolve(here,'../../../../../..');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const evidence=read(here+'/readback.json'),prep=read(here+'/next-preparation.json');
assert.deepEqual(Object.values(evidence.result.four_hooks_actual_exit_codes),[2,2,2,2]);
assert(evidence.restoration.all_non_git_files_equal);assert(prep.git_dry_run.all_files_including_git_unchanged);
const old=read(here+'/matrix-before.json'),matrix=read(base+'/matrix.json');assert.deepEqual(matrix,old);
assert(!fs.existsSync(here+'/publication.json'));
const prefix='zero-controls-20261015-01/hook-readback-01/';
for(const row of matrix.rows){
 if(row.criterion==='6.7'){
  row.evidence.push(prefix+'readback.json');
  row.status='本轮真实客户端四个拦截Hook均退出2，护栏失效及恢复通过（原始扩展日志补证）';
  row.observation='H2四Hook完成记录均为status 2；Z01同一具名Bash的pre-bash/pre-commit亦分别为2，tool_result只呈现后者。按会话/项目/唯一工具时间窗关联，日志PID和直接tool_use_id为null。原配置未改，原件/副本/备份83个非.git文件一致，wrapper原hash/755，预算838/401；旧null证据保留。';
 }
 if(row.scenario===5){
  row.evidence=[...new Set([...row.evidence,prefix+'next-preparation.json'])];
  row.observation=(row.observation??'')+' 新增仅安全触发准备：独立临时索引下git commit --dry-run未创建提交、141文件含.git未变；不是客户端Hook结果。健康基线客户端提案待执行，复制wrapper的cwd限制不绕过。';
 }
 if([7,10].includes(row.scenario)){
  row.estimated_starts='重新规划且未授权：ZCode Driver/跨Driver共用一批，冷缓存admission7/review3；另拟Driver启动预留3（边界未验证）';
  row.observation=(row.observation??'')+' 本轮只读预算重估见'+prefix+'README.md，不构成执行证据或授权。';
 }
 if(row.scenario===9){
  row.estimated_starts='重新规划且未授权：Codex L2冷缓存admission6/review4；另拟Driver启动预留2（边界未验证）；可选9.6另计';
  row.observation=(row.observation??'')+' 本轮只读预算重估见'+prefix+'README.md，不构成执行证据或授权。';
 }
}
matrix.at=new Date().toISOString();
assert.equal(matrix.rows.length,68);assert.equal(new Set(matrix.rows.map(x=>x.criterion)).size,68);
for(let i=0;i<68;i++){
 for(const key of ['criterion','requirement','expected','carrier','kind','routes','human'])assert.deepEqual(matrix.rows[i][key],old.rows[i][key]);
 if(matrix.rows[i].criterion!=='6.7')assert.equal(matrix.rows[i].status,old.rows[i].status);
}
const report=repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md';
const reportOld=fs.readFileSync(report,'utf8');
const title='## Z01续验：既有扩展日志补齐6.7，场景5仅完成安全准备';assert(!reportOld.includes(title));
const addition=`\n${title}\n\n[新增只读回收](./evidence/m11-step12-20261012/${prefix}readback.json)在VS Code既有Claude扩展日志中找到逐Hook真实完成记录：H2的hook-pre-write/pre-bash/pre-commit/stop均为实际status 2；Z01 22:28:06.723与.724分别记录pre-bash、pre-commit退出2，夹在唯一Bash toolu_7ea1cacd34e54a649b00cd9e的request/result之间。其后Stop也退出2。每条均有护栏失效stderr；退出码取客户端完成记录，不取shell正文exit 2。由此确认pre-bash执行过，只是该tool_result单独呈现pre-commit错误；先前检索缺少扩展输出日志，旧证据中的null不回写。\n\n关联依据是扩展启动/恢复会话、原项目cwd、精确命令及唯一工具时间窗；日志未带Hook PID和直接tool_use_id，两者仍null，不宣称直接进程ID关联。四个Hook的真实事件与恢复证据现已齐备，矩阵6.7据实改为通过；没有新故障注入或诊断配置变化。原工程、Z01副本和备份的83个非.git文件集合/hash/权限/大小一致，wrapper原hash/755，预算仍838/401、本步71/80、余1/8，当前批次厂商增量0。\n\n[场景5准备与完整副本](./evidence/m11-step12-20261012/${prefix}next-preparation.json)只验证安全触发形式。第一次新副本git commit --dry-run虽不创建提交，仍刷新.git/index，脚本断言失败；失败副本保留、原件未变。第二次使用独立GIT_INDEX_FILE，Git退出1（无暂存变更），仅外部临时索引变化，副本141文件含.git及原工程/备份均未变，详见[dry-run原始结果](./evidence/m11-step12-20261012/${prefix}dry-run-v2.json)。没有执行Trivium Hook或重跑已完成s5，不能标客户端通过。\n\n[可审阅步骤、采集脚本及恢复边界](./evidence/m11-step12-20261012/${prefix}README.md)已准备：下一最小提案是原客户端/原cwd的一次健康归档dry-run，当前停在客户端操作之前。复制wrapper绑定原cwd，不能在副本直接做缺/改件客户端对照；不改绑定、不伪造cwd、不删除真实工件，5.2～5.5客户端格仍待合法独立夹具方案。无需为6.7开启新诊断、启动新客户端或改项目Hook配置。\n\n后续ZCode Driver并取跨Driver、Codex L2两批按冷缓存重估核心为7/3与6/4（admission/review），合计13/7；若新启Driver再暂留3与2次未验证启动边界，则拟议包络18/7。核心已超admission余量12，不能跨池或按旧6/3、4/4启动。Driver启动计数链、能力探针刷新和版本漂移另行核对批准，未发布可执行批次、未改预算台账。正式失败分支1.4、B1 Codex证据不足、剧本7/9/10及可选9.6/11.7状态保持。\n\n本次未提交推送，未改业务/生产Hook或实施容量修复；树外证据访问原因未证实的边界保留。旧Z01 delivery-check.json仍是上一轮完整检查，本轮新增脚本及文档定向验证另存本目录，不替代客户端验收，M11尚未完成。\n`;
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>');
const header=fs.readFileSync(base+'/matrix.md','utf8').split(/\n(?=\| \d+ \|)/)[0];
const rows=matrix.rows.map(r=>'| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.length?r.evidence.join(', '):'尚无本轮满足判据的证据',r.status].map(esc).join(' | ')+' |');
fs.writeFileSync(base+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');
fs.writeFileSync(base+'/matrix.md',header+'\n'+rows.join('\n')+'\n');
fs.writeFileSync(report,reportOld+addition);
saveEvidence(here+'/publication.json',{at:new Date().toISOString(),rows:68,unique:68,criteria_order_unchanged:true,requirements_unchanged:true,status_changed_only:['6.7'],scope:'只同步报告/矩阵，未回写历史证据',budget:evidence.budget_after});
console.log(JSON.stringify({rows:68,status_changed_only:['6.7']}));
