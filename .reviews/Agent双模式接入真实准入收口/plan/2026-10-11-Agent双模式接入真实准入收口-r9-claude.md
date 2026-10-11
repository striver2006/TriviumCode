---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: claude
vendor: anthropic
agent_cli: claude/2.1.296
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: envelope
effort_requested: null
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: legacy
run_id: 20261011T093157Z
rerun_index: 9
snapshot_hash: sha256:f70191cd91b3e3b4b55b8c90ff85fea59cfb5729ef551d37bf55421ceaeefeaa
blind: true
started_at: 2026-10-11T09:32:02.295Z
finished_at: 2026-10-11T09:43:21.800Z
duration_s: 679
tool_calls:
  read: 23
  grep: 14
  glob: 0
  run_command: 0
  project_reads: 28
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
heterogeneous: unknown
access:
  requested_mode: profile
  profile: qwen
  launcher_requested: /Users/chenzhenbo/.local/bin/cld
  launcher_effective: /Users/chenzhenbo/.local/bin/cld
  wrapper_sha256: e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5
  configuration_sha256: 9a3bfaa3acc006b11a8c5c6422da69841ccc121de244ee7eff9574e4146cb8e5
  provider_declared: qwen
  provider_declared_source: profile
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: claude
    status: unknown
    left_model: null
    right_model: qwen3.8-flash
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: claude
    right: gemini
    status: different-family
    left_model: qwen3.8-flash
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：qwen / gemini
  - left: claude
    right: glm
    status: different-family
    left_model: qwen3.8-flash
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：qwen / glm
override_reason: 左侧模型信息缺失
session_id: 8eb866d7-ab42-4504-b96c-58c8dfe7332c
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T093157Z` ｜ 第 9 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

聚焦『授权轮次可以按需增加，不必询问授权』逐面核对：v8 权威本体是良性的——有界批、18 仍机械拒绝、criteria_change_authorized=false、count_reset=false、allow-single 仍拒，launch-v12/round-guard-v2/precheck-v2 的『仅换文件、语义不变』经逐行对读成立；取证失败事实（104字节README、unknown复合命令、任务书内嵌真实首词与approve示例）在源码与 r7 诊断中逐一属实。最需修正的两处均为副本面/断言面：(1) 指针已切实指向 v8、16B 正在运行，但设计正文、ADR、PROTOCOL、GUIDE、CASE、RUNBOOK、QUICKSTART 七份规范件与 05_testing 索引的最后一条『当前权威』表述仍是『v7、拒绝16次』，计划把补记推迟到『实施后』同步，若本批在实施前被拒（14C 先例）该失实窗口无人触发放行；(2) §1『不能直接无限放行或清零』中『清零』有机械守卫、『无限放行』没有——守卫不核批大小。不阻断，建议随 r20 合入前修订。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 2）

### CLAUDE-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1 与 §5『实施后同步』清单；doc/07_manuals/QUICKSTART.md:497 等七份规范件副本` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：按需追加轮数的委托一旦生效，权威事实同时存在于三类面：数据文件（v8+指针）、取证台账（r8 verification/static-audit）与规范文档。前两类已由 prepare-round16 落盘，但仓库内至少七份文档（设计 4276、ADR_003:40、PROTOCOL:473、GUIDE:107、CASE:566、RUNBOOK:471、QUICKSTART:497）以及索引 doc/05_testing/README.md:139 的『第15次补记』仍写着『当前权威 v7……拒绝16次与新增计划审查』『审查193/198』——这正是当前被授权并已在进行的 16B。计划 §5 把八份同步全部推迟到『实施后』，意味着 16B、17C 整个审查窗口内后续读者按这些规范件字面核对会得出与生产守卫相反的结论；而 14C『普通 code 拒绝』先例说明本批未必推进到实施后同步——若中途停批，七份副本将无限期保持『拒绝16』而 v8 证据文件同树存在。ADR:33 与 PROTOCOL:462 自带『以恢复报告为准』的时点标记，QUICKSTART/GUIDE/CASE/RUNBOOK 的同文补记没有该标记，按 doc/README.md §二.5 的『指向现在 vs 记当时』规范属未收口。

**依据**：逐读被审计划 §1/§5；round-guard-v2.mjs:6-14,43-47（读取壳实时解析指针，守卫按 new_rounds 枚举放行 16B/17C）；formal-round-authorization-v8.json:10-11,29-52（previous_limit 15、new_limit 17、仅追加 16/17、delegation_exact_reply）；formal-round-authority.json 现指向 v8；static-audit-before16.json:4-8（used 15、limit 17、next 16B，at 2026-10-11T09:31）；对 doc/ 全树 grep 到同一份『第15次补记：当前权威 v7……拒绝16次』文本位于 QUICKSTART.md:497、GUIDE_local_pitfalls.md:107、CASE_manual_acceptance.md:566、RUNBOOK_pipeline_ops.md:471、ADR_003_agent_access.md:40、PROTOCOL_dual_critic_relay.md:473、2026-09-10 设计.md:4276、doc/05_testing/README.md:139（含 193/198 旧池值）；REPORT_2026-10-11:380 已记录 v8/22项零CLI/18拒绝，即『报告面』是最新的，落后的是上述规范面。未运行任何命令，结论来自静态逐读与检索。

**建议**：方向即可，不代写补丁：把『追加第16次授权补记（v8、有界 16B/17C、指针与文件 hash）』从 §5 的『实施后』段提前列为 16B 审前冻结产物之一，或在 §1 增写一句『自指针切换到实施后同步期间，轮数上限的唯一现行陈述为 REPORT §380 与 r8 verification/audit 文件；七份 v15 补记均为时点记录』，并在 QUICKSTART/GUIDE/CASE/RUNBOOK 的补记处补『以恢复报告为准』指针，与 ADR/PROTOCOL 对齐。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1『以后确需新正式轮时可依这项独立委托追加有界权威，不能直接无限放行或清零』` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：该句把『不能无限放行』与『不能清零』并列为同等保障，但两者的机械强度不同：『清零』确由守卫强制——task.runs 与 archive 实际运行集合必须逐条相等、historical_run_ids 必须全部保留为子集，删改历史即拒启；『无限放行』则不是守卫性质——assertFormalRoundCore 不消费 previous_limit，也不校验批大小或 new_limit 与历史数、new_rounds 列表的一致性，一个未来 v9 文件把 new_rounds 枚举到几百轮、new_limit 写几百，在现行守卫下会机械放行。而本委托恰恰移除了『询问用户』这一人工闸，剩余唯一屏障是发布时的零CLI核验与本批自身的正式审查——属审计约定而非不变式。§3.4 列出的负例（16B/17C 正例、18 拒绝、错参数/集合/重复/缺历史/缺权威/缺原件）未含任何『超限批次』断言，按现计划落地后，规范文本与守卫能力之间存在一处被措辞掩盖的缝隙。

**依据**：逐读 plan §1 该句与 §3.4 测试清单；round-guard-v2.mjs:22-51 全文（wellFormed 只查形状；31-36 行强制运行集合一致=清零不可能；43-47 行仅按 task.runs.length+1 查 new_rounds 枚举与 new_limit 上限，无任何批大小/previous_limit 一致性检查）；v8 文件本批数据自洽（15+2=17）系人工约定而非守卫断言；formal-round16-authorization-verification.json 的 22 项清单以『18次拒绝』为最大轮序负例，无超限批形态负例；prepare-round16.mjs:34-37 显示发布与扩容均由 Driver 侧脚本完成。未运行任何命令，结论来自静态逐读。

**建议**：不必改 guard 语义（§3.4 已声明不改 round-guard-v2，予以尊重）：二选一——(a) 把 §1 措辞收窄为『每一轮必须逐条列于 hash 冻结的授权文件内，有界性由发布批次核验与本批审查保证，不由守卫强制』；(b) 在 §3.4 的零CLI核验脚本补一条发布面断言（如 new_limit−historical数==new_rounds.length 且本批增量≤2），写进 verification JSON，使『有界』成为每次发布可复核的事实而非纯叙述。

## 认为正确的部分

- 委托的边界收得干净：v8 明确 criteria_change_authorized=false、count_reset=false、old_failed_status_unchanged=true，守卫继续拒绝第18次与 --allow-single；『准入判据变化仍必须另行明确批准』在 plan §1、v8 authorized_scope、REPORT §380 三处口径一致，未见把轮数委托越读为判据授权或无限授权。
- launch-v12/guard/precheck『仅换文件、语义不变』属实：launch-v12.mjs 仅换 v8 路径与首行说明（prepare-round16 以 replace 生成），round-guard-v2 的读取壳+纯Core 未动，formal-start-precheck-v2 与轮数授权完全解耦。
- §2 失败取证逐条对得上源：fixture.ts:123 的 README 确为 104 字节（模型叙述 35 字节不采信是对的）；codex-qwen-read3-diagnostic.json 记录 unknown 复合命令、唯一 session/stdout 配对、before/after 全文 hash 未采集、findings 为字符串导致 finding_unaddressable、strict_first_word=false。
- §3.3 要移除的泄露属实且改法正确：closeout.mjs:133-135 当前确把真实首词（即 SENTINEL_OPEN 本体）与预设 verdict=approve 一起嵌进输出示例；改为只给结构/类型指引、判据函数（evidence.mjs:100-104 actual_read 链）逐字保留，符合『诊断不晋升准入』。
- 新增 read_content_diagnostic 放层正确：留在 closeout/取证层并消费生产 codexCommandEvidence，不进生产 adapter；与 applicability 测试既有的『纯诊断不得被普通审批打开采用层』（agent-access-applicability.test.ts:26-34）同一纪律；不接 output-schema 旗标有 codex.ts:65-71 EV-124 实测背书。

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：未运行 npm run check/node --test，『v7 动态用例随指针切 v8 当前判红』系静态推读（测试 143-155 行以实时权威断 new_limit=15/runs=14，现指针返回 v8/17/15），依赖 §3.4 落地修红；未实际复算 v8、指针、supersedes 的 sha256，hash 一致性以 static-audit-before16.json 的记录为据。
- 未逐字通读 agent-access-closeout.mjs 与 agent-access-evidence.mjs 全文（仅按 §3.1/§3.2/§3.3 相关段 grep+抽读），前后状态新字段与 finally 清理顺序的落地风险留待 code 审。
- 预算账本（~/.trivium 与 evidence 台账 json）及禁读清单内文件一律未读；admission 池 590/602 余量仅核对了文档声明，未逐启动项对账。
- CLI 额度自动扩容沿用的『既有委托』出自 2026-10-10 admission README（『明确授权按需增加额度』），本轮未重新评估该旧措辞是否应随批次重确权——沿用先例（15C 批同此引用），未单列意见。
- 未覆盖另一位审查员角度；未审 r20 合入流程本身。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r19-codex.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r8-claude.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v8.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v12.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/static-audit-before16.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/formal-round16-authorization-verification.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/plan-r19-body.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/prepare-round16.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/review-round16-plan-batch.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/README.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/matrix-admission15.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/codex-qwen-read3-diagnostic.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/post-round15-read-evidence-plan-proposal.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/final-admission15-audit.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/prepare-round15.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/review-round15-code-batch.json`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/05_testing/README.md`
- `doc/05_testing/CASE_manual_acceptance.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/README.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/04_development/GUIDE_local_pitfalls.md`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/05_testing/evidence/agent-access-20261010-admission/README.md`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-evidence.mjs`
- `src/trivium/adapters/codex.ts`
- `src/trivium/probes/fixture.ts`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/agent-access-applicability.test.ts`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":23,"grep":14,"glob":0,"run_command":0,"project_reads":28}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
