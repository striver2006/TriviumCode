/** 本轮敏感plan已批准；仅追加当前契约，历史采样段落不改写。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const files = [
  'doc/02_design/ADR_003_agent_access.md',
  'doc/03_api/PROTOCOL_dual_critic_relay.md',
  'doc/04_development/GUIDE_local_pitfalls.md',
  'doc/07_manuals/MANUAL_user.md',
  'doc/07_manuals/QUICKSTART.md',
  'doc/06_deployment/RUNBOOK_pipeline_ops.md',
  'doc/05_testing/CASE_manual_acceptance.md',
  'skills/dual-critic/SKILL.md',
];
const head = '第22B获批Claude精确拒绝取证（设计v1.3.155）';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const records = [];
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  if (before.includes(head)) throw Error('同步段已存在，拒绝重复：' + file);
  const design = file.startsWith('skills/') ? '../../doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md' :
    file.startsWith('doc/02_design/') ? './2026-09-10-Driver-DualCritic主攻双审流水线设计.md' : '../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md';
  const paragraph = `\n\n> ${head}：22B run20261011T142848Z的11意见已裁决，gate通过并按Bob本轮明确委托审批r24定稿敏感范围；23C完整代码和新指纹准入尚待验证。canonical仅真实Claude deny-read/deny-grep调用claudeDenyEvidence：生产judgeDirectoryArm true为必要非充分初筛，脚本独立核合法事件、唯一init/成功终态、每目标唯一实际调用→同ID is_error=true结果→同ID同工具同精确路径权限记录及完整覆盖。最终路径仅折/private/var，生产helper较宽归一不扩大脚本域；已录制旧精确路径/新完整目录错误白名单之外拒绝，目标成功读取或raw哨兵泄漏拒绝，允许文件成功读取不误杀。\n>\n> result保持deny_pass/per_file_deny原字段，新增deny_evidence伴随事实；历史原false和原件不回算，summary判据不改。新目录文本Read回放及Grep模拟不是新模型能力，Grep仍须实际调用与完整配对。Codex冻结函数/原写标准、生产probe/adapter、Schema、版本/effort和全局配置保持。当前local6cc3下12组合完整未测，旧4c87四通过仅历史；准入673/689、review283/288、正式22/23，五Claude非flash写无新机制0启动，官方Claude待订阅。component/restricted判据替代未采用，仍须Bob独立明确批准；详见[设计契约](${design}#agent-access-directory-contract)，M11前置仍未完成。\n`;
  fs.writeFileSync(file, before + paragraph);
  records.push({ file, before_sha256: digest(before), after_sha256: digest(before + paragraph) });
}
saveEvidence('doc/05_testing/evidence/agent-access-20261011-closeout-r14/document-sync-origin.json', {
  at: new Date().toISOString(), records, approved_plan_sha256: '1c7c4ffff68bff0644f2f156e4afcce064e0cfb40e4afcfe532790934130cee7',
  render_needed: false, package_version_changed: false, criteria_replacement_adopted: false, vendor_cli_starts: 0,
});
console.log(JSON.stringify({ synchronized: records.length, vendor_cli_starts: 0 }));
