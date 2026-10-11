/** 23C终态后仅通过archive.ts归档Driver裁决；不修改已审业务或静态材料。 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const repo = process.cwd();
const { writeArtifact } = await import(pathToFileURL(repo + '/dist/test/src/trivium/archive.js'));
const { checkReviewIntegrity } = await import(pathToFileURL(repo + '/dist/test/src/trivium/parse.js'));
const { saveEvidence } = await import(pathToFileURL(repo + '/scripts/agent-access-evidence.mjs'));
const topic = 'Agent双模式接入真实准入收口', runId = '20261011T152631Z';
const root = repo + '/doc/05_testing/evidence/agent-access-20261011-closeout-r14';
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const frozen = JSON.parse(fs.readFileSync(root + '/frozen-before-round23.json'));
for (const [p, h] of Object.entries(frozen.hashes)) if (hash(root + '/' + p) !== h) throw Error('静态冻结变化');
for (const [p, h] of Object.entries(frozen.business_hashes)) if (hash(repo + '/' + p) !== h) throw Error('业务冻结变化');
const run = JSON.parse(fs.readFileSync(repo + '/.reviews/' + topic + '/code/_meta/run-' + runId + '.json'));
if (run.status !== 'success' || run.snapshot.drift.changed || run.snapshot.tree_hash !== run.snapshot.after_tree_hash || run.guard.readonly_breach || run.guard.peer_artifact_read) throw Error('运行资格不成立');
for (const a of run.artifacts) if (hash(repo + '/.reviews/' + a.path) !== a.sha256) throw Error('原审查工件变化');
const integrity = {};
for (const role of ['claude', 'gemini', 'glm']) {
  const review = JSON.parse(fs.readFileSync(repo + '/.reviews/' + topic + '/code/_meta/review-' + role + '-' + runId + '.json'));
  integrity[role] = checkReviewIntegrity(review, role, []);
  if (!integrity[role].prefixOk || integrity[role].duplicateIds.length || integrity[role].emptyWithoutExplanation || integrity[role].evidenceNotInConsulted.length) throw Error('引用或编号完整性异常');
}
const originals = JSON.parse(fs.readFileSync(root + '/denial-fixtures/sources.json')).manifest.map(item => {
  const resultPath = path.join(path.dirname(item.source), 'result.json');
  const original = JSON.parse(fs.readFileSync(resultPath));
  if (hash(item.source) !== item.sha256 || hash(resultPath) !== item.original_result_sha256 || original.deny_pass !== item.original_deny_pass) throw Error('历史原件核验不符');
  return { label: item.label, raw_source: item.source, raw_sha256: hash(item.source), result_source: resultPath, result_sha256: hash(resultPath), original_deny_pass: original.deny_pass,
    repo_result_anchor: item.label === 'read-directory', portable_variant4_result_proof: false };
});
const body = `---
schema: trivium.disposition.v1
topic: ${topic}
stage: code
role: codex
kind: response
run_id: ${runId}
addresses:
  - 2026-10-11-${topic}-r12-claude.md
  - 2026-10-11-${topic}-r12-gemini.md
  - 2026-10-11-${topic}-r12-glm.md
---

# 第23C逐条裁决与批准建议

三侧原件全文已读：Claude approve-with-nits（minor一条、nit一条），Gemini/GLM approve且零意见；无blocker/major。31静态、552业务及10原审查工件hash不变，subject SHA ${run.snapshot.subject_sha256}，tree前后${run.snapshot.tree_hash}相等，readonly_breach=false、peer_artifact_read=false。既有guard/gate规则未修改，最后是否有资格由本轮gate实返决定；各侧approve不是资格替代。原failed run20261010T170416Z不恢复。

|意见编号|来源|严重度|裁决|理由|落点|
|---|---|---|---|---|---|
|CLAUDE-01|Claude|minor|暂缓|认可仓库内缺少变体4旧result副本，测试中original_deny_pass字段本身不是独立原值证明。Driver直接读取外部原件并核对raw/result SHA与原值，三者true/true/false相符；这些是历史来源事实，不用于当前准入或改变历史false。此缺口影响仓库单独转移后的可复核性，未影响已hash锁定真实raw回放和当前判定逻辑，故不阻断本轮代码批准。|本裁决“历史原件边界”；下次发布可移植证据包时逐字附两份旧result并增加独立锚点。在此之前仓库单独无法证明变体4原true，不能据manifest自述引用为独立实测。|
|CLAUDE-02|Claude|nit|暂缓|认可失败诊断error数组可含null；局部零CLI变异非text结果得到deny_pass=false、error=[null]、精确拒绝失败原因。当前summary不消费attempts.error，成功精确配对分支只能是可识别字符串错误；未知内容保留null不伪造文本。暂无运行时影响或原标准误通过，不为诊断可读性扩大本轮守卫范围。|本裁决“失败诊断字段边界”；引入新的attempts.error消费者前，须声明(string\|null)[]\|null并直测空值，或另审兼容归一策略。|

## 历史原件边界

原件仅存本机独立运行时证据根，审查员禁读该根。仓库raw副本hash可验证原字节，但变体4旧result没有仓库内副本，manifest旧布尔不是独立证明；以下为Driver本轮直接核验，不能转述为审核者复测：

${originals.map(o => '- ' + o.label + '：' + o.result_source + '；SHA ' + o.result_sha256 + '；原deny_pass=' + o.original_deny_pass + '，raw SHA ' + o.raw_sha256 + '。').join('\n')}

变体5原false及原字节保留；新函数回放true仅证明本轮实现，绝不回算旧结果、追认当前版本模型能力。未来外部原件缺失或hash不符时，上述原值应视为不可复核，停止引用而非依赖manifest继续认可。

## 失败诊断字段边界

attempts.error可为null或包含null的数组；null表示不能从该内容提取可信错误字符串，不能当作配对拒绝。所测非text块变异为false；paired_error严格依赖is_error、完整错误白名单与同ID/工具/目标权限三腿，字段形态不参与summary。此处记录现行为及非阻断风险，未修改业务、文档、fixture、生产judgeDirectoryArm、冻结Codex函数或Schema。

## 审查证据与后续停点

三侧编号及evidence-consulted静态完整性检查均通过。GLM consulted_unverified=true原样保留，不能宣称工具轨迹已确认其查阅列表；Gemini parse_repairs剥离toolAction/toolSummary附加字段，原记录保留，不宣称三侧完全无修复。Gemini/GLM路径级deny未生效及事后轨迹边界保留，Driver模型/会话未声明null，厂商服务端身份null。准入673/689、review298/303，正式23/23，无在途CLI。本轮两项暂缓不要求待实施修复，业务冻结相等；建议gate及await-approval通过后，依据Bob本轮明确普通审批委托批准此run的code。此批准不授权component/restricted准入判据替代、不追认旧证据，当前完整指纹12组合仍未测，目标未完成，M11第12步不可开始。
`;
const disposition = await writeArtifact({ layout: { archiveRoot: repo + '/.reviews', topic }, stage: 'code', role: 'codex', writer: 'driver', driver: 'codex', kind: 'response', rerunIndex: 12, date: '2026-10-11', content: body });
saveEvidence(path.dirname(fileURLToPath(import.meta.url)) + '/code23-disposition-origin.json', { at: new Date().toISOString(), run_id: runId, helper_sha256: hash(fileURLToPath(import.meta.url)), originals, integrity, frozen_static: 31, frozen_business: 552, unchanged_review_artifacts: 10, disposition, ordinary_delegation_exact: '中途遇到需要审批的，根据你的建议自动审批', accepted: 0, rejected: 0, deferred: 2, criteria_changed: false, new_vendor_starts: 0 });
console.log(JSON.stringify({ disposition, integrity, accepted: 0, deferred: 2, new_vendor_starts: 0 }));
