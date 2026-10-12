/** 仅在24B本轮plan批准后同步规范；不改任何安装输入或历史证据。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname);
const {saveEvidence}=await import(pathToFileURL(repo+'/scripts/agent-access-evidence.mjs'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const topic='Agent双模式接入真实准入收口',run='20261011T171203Z';
const final='.reviews/'+topic+'/plan/2026-10-12-'+topic+'-r26-codex.md';
const task=JSON.parse(fs.readFileSync(repo+'/.reviews/'+topic+'/task.json'));
const approval=task.approvals.findLast(a=>a.stage==='plan'&&a.run_id===run);
if(approval?.decision!=='approved'||hash(final)!=='af93c0bb996da1b2125e70f66784b1151dc6d09c87853d2c8a77c718672ea2f9')throw Error('本轮批准或定稿hash不符');
const design='doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md';
const anchor='agent-access-controlled-contract';
const plan=fs.readFileSync(final,'utf8');
const contract=plan.slice(plan.indexOf('## 2. 方案A'),plan.indexOf('## 附录：r24'));
if(!contract.includes('criteria-approval.v1')||!contract.includes('controlled-mechanism.v1'))throw Error('规范抽取不完整');
const changed=[];
function edit(file,fn){const old=fs.readFileSync(file,'utf8'),next=fn(old);if(old===next)throw Error('同步未产生预期变更：'+file);fs.writeFileSync(file,next);changed.push({file,before_sha256:crypto.createHash('sha256').update(old).digest('hex'),after_sha256:hash(file)});}
edit(design,old=>{
 if(old.includes('id="'+anchor+'"'))throw Error('不得重复追加规范');
 const row='| **v1.3.156** | 2026-10-12 | 第24B获批集中取证合同：受控包装器/native实证、default及工具面、混合工具唯一配对、局部证据Schema、三具名认证时间戳诊断与独立判据批准/撤销；原标准及旧列保留，两个候选尚未采用。新增v13及v9至v12具名测试，不改安装输入。 |\n';
 if(old.split('| **v1.3.155** |').length!==2)throw Error('设计台账锚不唯一');
 return old.replace('**当前版本**：v1.3.155','**当前版本**：v1.3.156').replace('| **v1.3.155** |',row+'| **v1.3.155** |')+'\n\n<a id="'+anchor+'"></a>\n\n## 集中取证与独立判据采用合同（v1.3.156）\n\n第24B run '+run+'三审有效、13意见逐条12接受/1驳回，完整r26经gate/await-approval，于'+approval.at+'依Bob普通审批委托批准。以下为正式审查修订后的实现依据，当前只授权夹具/诊断/测试，尚未证明受控可行或采用两项独立判据。旧生产真实模型调用标准、历史Schema、失败记录及配置不改；包版本不变。\n\n'+contract;
});
const suffix='\n\n## 第24B获批集中取证边界（2026-10-12）\n\n';
const reference=(from)=>path.relative(path.dirname(from),design).replaceAll('\\','/')+'#'+anchor;
const texts={
 'doc/02_design/ADR_003_agent_access.md':'旧restricted-tool-surface-v1及component-scoped-evidence-v1仍未采用。24B/r26获普通plan批准，新增候选restricted-tool-surface-and-path-v2纠正包装桥、权限模式及live绑定缺口；auth-cache-timestamp-applicability-v1只限本次三具名checked_at。先实现受控夹具和诊断，再取得Bob独立明确判据决定；普通审批与轮数授权不能替代，原标准列/单臂false保留。',
 'doc/03_api/PROTOCOL_dual_critic_relay.md':'局部controlled-mechanism.v1、auth-timestamp-applicability.v1、criteria-approval.v1及criteria-revocation.v1属于独立任务证据契约，不改产品run/review/verify Schema。身份形状使用字符串、语义由注册表核验；mixed原件全局2N权限配对不可裁切伪装单臂。批准/撤销来源、范围、版本及全部hash不齐则不消费。',
 'doc/04_development/GUIDE_local_pitfalls.md':'旧受控Kimi以auto权限模式绕过原profile包装器，不能证明default生产模式。新夹具须同原cld/同hash native、实际PID/lstart及映像、生产工具面/参数/Schema/settings，未知即停。认证缓存三时间戳改变会使全配置hash失配；先原值完整语义比较后脱敏，不扩大probe.auth白名单或恢复旧生产配置。',
 'doc/07_manuals/QUICKSTART.md':'本主题24B已有效且普通plan按Bob委托批准，25C尚未启动。两个独立判据仍未批准；CLI扩容、普通plan/code及正式轮数委托均不能启用替代准入。旧指纹7通过/5未测保留历史，当前fb64全指纹0通过/12未测，官方Claude待订阅；M11第12步不可开始。',
 'doc/06_deployment/RUNBOOK_pipeline_ops.md':'B层全部启动计admission池并按controlled-mechanism类别分列，review独立计正式审查。当前731/742、313/318、正式24/25；pilot逻辑2预计4硬6，后续三组合预计6硬8。事前发布具体脚本/hash、目标/实际模型、预计/硬/累计池；不足先扩容留痕。桥接/模式/工具面/配对/泄漏/清理任一未知失败停止，不循环调参。',
 'doc/05_testing/CASE_manual_acceptance.md':'24B新增待执行剧本：Qwen max与k3两模型独立pilot，验证原包装器到native实际消费、default/工具面一致，Write/Bash各一唯一注册禁用配对、六目标Read/Grep合计12唯一权限拒绝、合法README成功、完整Schema/无泄漏/状态及清理。独立变异少/多/错位记录、非时间戳节点/凭据变化、批准缺失/撤销/错scope均拒绝；受控B不是原模型C，未批不出restricted通过。',
};
for(const[file,text]of Object.entries(texts))edit(file,old=>old+suffix+text+' 完整规范见[设计v1.3.156]('+reference(file)+')；执行结果以恢复报告和r17证据为准，不能由剧本或计划宣称已测。\n');
const report='doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md';
edit(report,old=>old.replace('\n\n','\n\n> 第24B完成并获本轮普通plan委托批准：run '+run+'，三侧首轮完成，13意见12接受/1驳回，1357冻结与10原工件hash一致、无subject/tree漂移或readonly违规；gate/await-approval及'+approval.at+'审批记录齐备，停点业务改动0。完整r26 SHA af93c0bb996da1b2125e70f66784b1151dc6d09c87853d2c8a77c718672ea2f9。两个独立判据仍未批准，25C未启动；当前fb64严格完整0通过/12未测，旧496下7通过/5未测及两禁读Read false保留。准入731/742、review313/318、正式24/25；开始按获批合同实施局部夹具/诊断和v13/v9至v12测试，未宣称检查或pilot已过。新增证据见[r17](./evidence/agent-access-20261011-closeout-r17/README.md)，目标仍未完成。\n\n'));
edit('doc/05_testing/README.md',old=>old.split('\n').map(l=>l.startsWith('- [`REPORT_2026-10-11_agent_access_recovery.md`]')?'- [`REPORT_2026-10-11_agent_access_recovery.md`](./REPORT_2026-10-11_agent_access_recovery.md)：真实准入恢复与独立授权。24B三审有效，13意见12接受/1驳回、gate及本轮普通plan委托批准齐备；正式24/25，25C未启动。当前fb64严格完整0通过/12未测，旧496矩阵7通过/5未测及两Read false保留；两独立判据未采用。准入731/742、review313/318；[r17](./evidence/agent-access-20261011-closeout-r17/README.md)实施集中受控/诊断与具名授权测试，M11前置未完成。':l).join('\n'));
const core='skills/dual-critic/SKILL.md';
saveEvidence(root+'/plan24-approved-contract-sync.json',{at:new Date().toISOString(),run_id:run,approval,final:{path:final,sha256:hash(final)},changed,install_input_changes:[],core_skill:{path:core,sha256:hash(core),action:'reviewed-no-change',reason:'原标准、产品Schema/入口/只读参数及正式流程保持；现行SKILL明确较晚采样以恢复报告和主设计为准，本次局部证据Schema/夹具不属于其安装入口合同。修改重复历史采样会改变安装输入而使当前能力证据失配，故规范变更集中主设计，保留既有动态引用。'},entry_wording_changed:false,criteria_change_authorized:false,new_vendor_starts:0});
console.log(JSON.stringify({changed:changed.map(x=>x.file),core_skill:'reviewed-no-change',new_vendor_starts:0}));
