/** 一次性同步本轮文档；不执行用户终端步骤，不回写历史证据。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
import {scanSecrets} from '../../../../../dist/test/src/trivium/secrets.js';
const here=import.meta.dirname,parent=path.dirname(here),repo=path.resolve(here,'../../../../..');
const read=f=>JSON.parse(fs.readFileSync(f)),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if(fs.existsSync(here+'/reconciliation.json'))throw Error('已经同步，不重跑');
const p=read(here+'/preparation.json'),matrix=read(parent+'/matrix.json'),plan=read(parent+'/budget-plan.json');
const oldMd=fs.readFileSync(parent+'/matrix.md','utf8');
saveEvidence(here+'/matrix-before.json',matrix);
const evidenceNames=['copy-baseline','no-reviews','wrapper-missing'];
const evidence=evidenceNames.map(n=>read(here+'/'+n+'.json'));
if(evidence.some(e=>!e.pass||!e.original_files_unchanged))throw Error('本地结果未通过');
const budget=Object.fromEntries(['admission','review'].map(k=>[k,fs.readdirSync(plan.budgetRoot+'/ledger/'+k).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
if(JSON.stringify(budget)!==JSON.stringify(p.budget_before))throw Error('预算变化');
const originals=p.files.filter(f=>!f.path.startsWith('.git/')).map(f=>({...f,current_sha256:hash(p.source+'/'+f.path),current_mode:fs.statSync(p.source+'/'+f.path).mode&0o777}));
if(originals.some(f=>f.sha256!==f.current_sha256||f.mode!==f.current_mode))throw Error('原工程变化');
const d=read(parent+'/approval-d.json'),task=read(p.source+'/.reviews/m11-s12-capacity/task.json'),state=read(p.source+'/.trivium/state.json');
const approvals=task.approvals.filter(a=>a.run_id===d.run_id);
if(approvals.length!==1||approvals[0].decision!=='approved'||approvals[0].reason!==d.command_args[d.command_args.indexOf('--reason')+1]||hash(d.response_file)!==d.response_sha256)throw Error('D闭环偏离');
const commands=[];
for(const args of [['-c','core.quotePath=false','rev-parse','HEAD'],['-c','core.quotePath=false','ls-remote','origin','refs/heads/main']]){
 const r=spawnSync('git',args,{cwd:repo,encoding:'utf8',timeout:20000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
 commands.push({command:['git',...args],exit_code:r.status,stdout:r.stdout,stderr:r.stderr});
 if(r.status!==0||!r.stdout.includes('3c70d9b4da98025587d71f559ac94cbb634ebc2a'))throw Error('交付基线变化');
}
const base='zero-controls-20261015-01/';
for(const row of matrix.rows){
 if(row.scenario===5||['6.7','8.2'].includes(row.criterion)){
  row.estimated_starts='Z01厂商边界0；累计838/401，本步71/80，余1/8；当前批次不得新增厂商调用';
  row.evidence=[...new Set([...row.evidence,base+'preparation.json',base+'README.md'])];
  row.observation='2026-10-15 Z01：独立副本/备份已准备；CLI直接调用与真实客户端事件分列，受保护副本修改及gate --check仅待用户终端执行。';
 }
 if(row.criterion==='5.1'){row.evidence.push(base+'copy-baseline.json');row.status='真实归档及完整副本CLI直调通过；客户端集成未测';}
 if(['5.2','5.3','5.4'].includes(row.criterion))row.status='未测；隔离副本、备份和一次性用户终端操作已准备';
 if(row.criterion==='5.5'){row.evidence.push(base+'no-reviews.json');row.status='无审查记录仓库CLI直调退出0；客户端集成未测';}
 if(row.criterion==='6.7'){row.evidence.push(base+'wrapper-missing.json');row.status='部分：历史真实Edit、pre-commit与Stop拦截；本轮pre-bash shell独立直调退出2，真实客户端独立事件仍未测；原wrapper保持恢复态';}
 if(row.criterion==='8.2')row.status='两轮裁决与gate均通过；缺CODEX-04一行负对照未测，副本及恢复步骤已准备';
 if([7,9,10].includes(row.scenario))row.estimated_starts='仅规划：当前余admission1/review8；历史C-ZCode/B-Codex估算非授权，待具名冷缓存预算';
}
const at=new Date().toISOString();matrix.at=at;
const ids=matrix.rows.map(r=>r.criterion);
const caseText=fs.readFileSync(repo+'/doc/05_testing/CASE_manual_acceptance.md','utf8');
const caseIds=[...caseText.matchAll(/^\| (\d{1,2}\.\d+) \|/gm)].map(m=>m[1]);
if(ids.length!==68||new Set(ids).size!==68||JSON.stringify(ids)!==JSON.stringify(caseIds))throw Error('68行与CASE对账失败');
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n','<br>');
const header=oldMd.split(/\n(?=\| \d+ \|)/)[0];
const md=header+'\n'+matrix.rows.map(r=>'| '+[r.scenario,r.criterion,r.requirement,r.carrier,r.routes,r.estimated_starts,r.human,r.evidence.length?r.evidence.join(', '):'尚无本轮满足判据的证据',r.status].map(esc).join(' | ')+' |').join('\n')+'\n';
fs.writeFileSync(parent+'/matrix.json',JSON.stringify(matrix,null,2)+'\n');fs.writeFileSync(parent+'/matrix.md',md);
const report=repo+'/doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md';
fs.appendFileSync(report,`\n## 2026-10-15 Z01：零厂商负对照准备与直接调用结果\n\n只读核对确认主仓HEAD与origin/main均为3c70d9b4da98025587d71f559ac94cbb634ebc2a；历史完整check仍为3624项、3622通过、0失败、2跳过，本轮未重跑完整check。D run 20261015T123051Z唯一批准、边界附言与裁决hash一致，原工程全部非.git文件字节/权限与准备前相同，四个阶段均无开放闸门。容量修复未实施，树外证据访问原因未证实的边界不变。\n\n[Z01步骤与停点](./evidence/m11-step12-20261012/${base}README.md)已准备完整独立副本和备份，141个文件逐字节及权限校验相同。原验收wrapper绑定原cwd，不能在新副本直接调用；本批固定参数取证脚本调用相同安装bundle，加载既有预算侧车与401绝对上限。原wrapper、全局配置与运行时均未修改。\n\n[副本完整基线](./evidence/m11-step12-20261012/${base}copy-baseline.json)的hook-pre-commit退出0；[从无审查记录仓库](./evidence/m11-step12-20261012/${base}no-reviews.json)同样退出0；[原hook-pre-bash shell守卫的独立调用](./evidence/m11-step12-20261012/${base}wrapper-missing.json)在新建缺wrapper夹具退出2，明确报护栏失效。三项均无受保护文件变化、厂商增量0；git commit只在JSON输入中，不执行提交。这些是直接调用结果，不能替代真实客户端Hook集成。5.5仅CLI格取得证据；6.7真实pre-bash独立事件仍未测，旧H2未重跑。\n\n5.2/5.3/5.4与8.2缺行负对照均未执行，已准备仅由Bob系统终端运行的一次性脚本，固定目标、备份hash、失败停点、恢复与预算核对齐备。gate --check会更新副本task的joint_checks，故也留在用户终端步骤，结束后恢复副本原task；主会话不代做受保护工件修改。6.7另备原会话具名Bash事件的只读采集器；若仍无独立事件或退出码，保留未测/null。\n\n预算实读仍admission838/review401，本步43/28=71/80，余1/8，当前批次新增厂商边界授权为0。剧本7、9、10、1.4正式失败分支、8.1的B1 Codex证据不足及可选9.6/11.7均未补绿。历史C-ZCode 6/3与B-Codex 4/4合计10/7，相对余量admission差9仅是旧假设算术；缓存、最终选侧与真实边界需重新只读规划及具名授权，不能据review余量启动。\n\n本轮核对与检查见[同步记录](./evidence/m11-step12-20261012/${base}reconciliation.json)。两份矩阵保持68个唯一判据、顺序/要求/状态一致；未改CASE、未修改业务代码、未重装、未审批、未提交推送。M11 Step 12仍未完成，当前停在用户终端操作之前。\n`);
const checks=[];
for(const name of ['prepare.mjs','capture.mjs','user-terminal.mjs','collect-client.mjs','reconcile.mjs']){
 const r=spawnSync(process.execPath,['--check',here+'/'+name],{encoding:'utf8'});
 checks.push({command:[process.execPath,'--check',here+'/'+name],exit_code:r.status,stdout:r.stdout,stderr:r.stderr});
 if(r.status!==0)throw Error('语法错误');
}
const parsedMd=md.split('\n').filter(l=>/^\| \d+ \|/.test(l));
if(parsedMd.length!==68||parsedMd.some((l,i)=>!l.endsWith('| '+esc(matrix.rows[i].status)+' |')))throw Error('Markdown状态不同步');
const scanned=fs.readdirSync(here).filter(n=>fs.statSync(here+'/'+n).isFile());
if(scanned.some(n=>scanSecrets(fs.readFileSync(here+'/'+n,'utf8')).length))throw Error('脱敏扫描失败');
saveEvidence(here+'/reconciliation.json',{at,commands,checks,originals_unchanged:true,source_files_verified:originals.length,
 d:{run_id:d.run_id,approvals:approvals.length,reason_matches:true,disposition_sha256:hash(d.response_file)},
 open_gates:Object.values(state.gates).filter(g=>!['idle','approved','rejected','abandoned'].includes(g.state)),
 baseline_check:read(parent+'/delivery-check-20261015.json').summary,
 results:evidence.map(e=>({criterion:e.criterion,mode:e.mode,exit_code:e.exit_code,pass:e.pass,client_hook_event:e.client_hook_event})),
 matrix:{rows:68,unique:68,markdown_rows:parsedMd.length,case_ids_match:true,status_matches:true},
 budget_before:p.budget_before,budget_after:budget,delta:{admission:0,review:0},secret_scan_files:scanned,
 pending:['5.2','5.3','5.4','8.2负对照','场景5客户端集成','6.7真实pre-bash独立事件'],
 scope:'用户终端脚本仅语法检查，未执行；既有真实审查工件及CASE未改；本轮无完整check、无审批提交推送'});
console.log(JSON.stringify({matrix_rows:68,syntax_checks:checks.length,budget,originals_unchanged:true}));
