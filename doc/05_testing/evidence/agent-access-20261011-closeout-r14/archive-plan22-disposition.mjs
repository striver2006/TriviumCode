/** 审查已终态；只归档Driver裁决/定稿，保留原件与全部冻结事实。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeArtifact } from '../../../../dist/test/src/trivium/archive.js';
import { checkReviewIntegrity } from '../../../../dist/test/src/trivium/parse.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const repo = process.cwd(), root = path.dirname(new URL(import.meta.url).pathname);
const topic = 'Agent双模式接入真实准入收口', runId = '20261011T142848Z';
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const meta = JSON.parse(fs.readFileSync(path.join(repo, '.reviews', topic, 'plan/_meta', `run-${runId}.json`)));
const frozenRoot = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r13');
const frozen = JSON.parse(fs.readFileSync(path.join(frozenRoot, 'frozen-before-round22.json')));
for (const [p, h] of Object.entries(frozen.hashes)) if (hash(path.join(frozenRoot, p)) !== h) throw Error('静态冻结变化：' + p);
for (const [p, h] of Object.entries(frozen.business_hashes)) if (hash(path.join(repo, p)) !== h) throw Error('业务冻结变化：' + p);
if (meta.status !== 'success' || meta.snapshot.drift.changed || meta.snapshot.subject_sha256 !== frozen.plan.sha256 ||
    meta.guard.readonly_breach || meta.guard.peer_artifact_read) throw Error('运行资格核对不通过');
for (const a of meta.artifacts) if (hash(path.join(repo, '.reviews', a.path)) !== a.sha256) throw Error('审查工件变化：' + a.path);
const integrity = Object.fromEntries(['claude', 'gemini', 'glm'].map(id => {
  const r = JSON.parse(fs.readFileSync(path.join(repo, '.reviews', topic, 'plan/_meta', `review-${id}-${runId}.json`)));
  return [id, checkReviewIntegrity(r, id, [])];
}));
const final = await writeArtifact({ layout: { archiveRoot: path.join(repo, '.reviews'), topic }, stage: 'plan', role: 'codex', writer: 'driver', driver: 'codex',
  rerunIndex: 24, date: '2026-10-11', content: '---\nrole: codex\n---\n\n' + fs.readFileSync(path.join(root, 'plan22-final-body.md'), 'utf8') });
const rows = [
  ['CLAUDE-01','Claude','major','保留deny_pass/per_file_deny原名原形，新事实伴随；旧结果不回算，核summary消费者。','定稿§3/§4'],
  ['CLAUDE-02','Claude','major','采用6cc3最新完整指纹12未测；4c87四通过只历史，49预估刷新不追认。','定稿§1/§5'],
  ['CLAUDE-03','Claude','minor','明确生产normalizeAbs宽初筛与脚本normalizedPath最终严复核，逐腿不新增tmp别名。','定稿§3/§4'],
  ['CLAUDE-04','Claude','minor','明确调用judgeDirectoryArm kind=files、verdict真必要非充分、null/false拒绝，probe面不改。','定稿§3'],
  ['AGY-01','Gemini','nit','采用精确已录制旧携路径/新目录错误白名单；任意异常不能冒充拒绝，Grep仍须独立实测。','定稿§3/§4'],
  ['AGY-02','Gemini','nit','新函数放冻结切片外，独立锚定Codex原hash和write谓词。','定稿§3/§4'],
  ['AGY-03','Gemini','nit','结果保持path/attempts/id/paired_error/error及布尔deny_pass，增加伴随deny_evidence。','定稿§3/§4'],
  ['GLM-01','GLM','major','采建议第二分支：本轮plan审批reason明确绑定定稿hash和敏感范围；轮次criteria字段仍false，不授权判据替代。','定稿§2'],
  ['GLM-02','GLM','minor','禁读目标成功腿才拒绝；允许文件成功读取正例不误杀，哨兵仍全raw扫描。','定稿§3/§4'],
  ['GLM-03','GLM','minor','追加canonical实际deny分支及返回字段的源契约接线守卫，不只测试纯函数。','定稿§4'],
  ['GLM-04','GLM','minor','normalizedPath是最终路径权威；helper宽初筛不放宽最终域，特殊/private/tmp边界单测。','定稿§3/§4'],
];
const body = `---\nschema: trivium.disposition.v1\ntopic: ${topic}\nstage: plan\nrole: codex\nkind: revised\nrun_id: ${runId}\naddresses:\n  - 2026-10-11-${topic}-r11-claude.md\n  - 2026-10-11-${topic}-r11-gemini.md\n  - 2026-10-11-${topic}-r11-glm.md\n---\n\n# 第22B逐条裁决\n\n三侧原件全文已读，11条均接受并落到计划定稿；业务尚未实施。302静态、551业务、10原审查工件hash一致，subject/tree无漂移，readonly_breach=false、peer_artifact_read=false。新定稿${final.relPath}，SHA ${final.sha256}。原稿r23仍保留，r24仅文件序号，正式22/23不变。\n\nGemini evidence引用audit-read-denial-variant5.mjs但未列consulted，GLM evidence引用agent-access-recipes.mjs但未列consulted：原告警保留，不补写原件或宣称该侧实际查阅。guard.ts既有逻辑把这两类转为告警，不修改guard/gate来通过本轮；是否放行以本轮裁决后gate实返为准。Driver模型/会话未声明null，Gemini/GLM路径级deny未生效保留，服务端身份null。原失败run20261010T170416Z不恢复。\n\n|意见编号|来源|严重度|裁决|理由|落点|\n|---|---|---|---|---|---|\n${rows.map(([id,side,sev,reason,at])=>`|${id}|${side}|${sev}|接受|${reason}|${at}|`).join('\n')}\n\n待gate和await-approval成功，建议依Bob本轮明确普通审批委托批准定稿§2至§4敏感取证守卫范围，审批reason绑定run及定稿SHA。轮次委托不改变判据、正式审查资格不以approve类意见替代；旧结果/证据不改，生产写替代仍未授权。\n`;
const disposition = await writeArtifact({ layout: { archiveRoot: path.join(repo, '.reviews'), topic }, stage: 'plan', role: 'codex', writer: 'driver', driver: 'codex',
  kind: 'revised', rerunIndex: 11, date: '2026-10-11', content: body });
saveEvidence(path.join(root, 'plan22-disposition-origin.json'), { at: new Date().toISOString(), script_sha256: hash(new URL(import.meta.url)),
  run_id: runId, static_frozen: 302, business_frozen: 551, review_artifacts: 10, integrity, final, disposition,
  ordinary_delegation_exact: '中途遇到需要审批的，根据你的建议自动审批', criteria_change_authorized: false,
  business_implemented: false, vendor_cli_starts: 0, zero_cli_observation_failure: { kind: 'budget-path-guess-ENOENT', corrected: 'openBudget.dir' } });
console.log(JSON.stringify({ final, disposition, integrity, vendor_cli_starts: 0 }, null, 2));
