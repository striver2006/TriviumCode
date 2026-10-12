---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: code
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
run_id: 20261011T212239Z
rerun_index: 13
snapshot_hash: sha256:efd815930a9dca77c52b9cde76b97d4a668898bf20cf3829cc20509a5a9fbc2d
blind: true
started_at: 2026-10-11T21:22:56.932Z
finished_at: 2026-10-11T21:36:47.800Z
duration_s: 831
tool_calls:
  read: 11
  grep: 18
  glob: 0
  run_command: 0
  project_reads: 12
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 1
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
session_id: 9dc07b9d-cd01-408c-9bdb-e8fb02746982
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T212239Z` ｜ 第 13 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最需留意的是文档面：本轮把自述过期的轮次状态段落逐字复制进了至少 8 个手册入口，"当前数字"无法就地判新。核心代码（claudeDenyEvidence 双射配对、目录消费形态绑定、读写诊断、失败留痕）经对照设计与 SKILL 承诺逐条核实为兑现且 fail-closed，接线均有真实 hash 锚定回放与变异反例测试，编译全量测试留痕（v4）显示全绿。未发现会致线上出错的 blocker/major；两条意见均为方向性。r21 证据目录内的 mode3/criteria/auth 链 helper 体量过大，只抽查未全量背书。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 1 ｜ 吹毛求疵 1）

### CLAUDE-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-critic/SKILL.md:37-72（同段还见于 QUICKSTART.md:505-522、PROTOCOL_dual_critic_relay.md:481-498、ADR_003_agent_access.md:48-65、GUIDE_local_pitfalls.md:115-132、RUNBOOK_pipeline_ops.md:486-498、CASE_manual_acceptance.md:574-591、MANUAL_user.md:932-944）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：本轮补丁把多段带日期的轮次状态快照（16B/19B/20C/22B 等，含『准入673/689、review283/288、正式22/23』『当前v8仅枚举有界16B/17C、18仍拒绝』这类瞬时数字）逐字追加进 SKILL.md，并以完全相同文本散落在另外 8 个手册文件里。段落本身自述『历史采样，当前口径以恢复报告最新段为准』，即每份手册都内嵌了一份注定过期的状态镜像：读者无法就地分辨数字新鲜度，未来轮次只需改动一处就会造成多文件漂移，而这批文件正是『实现与说明书同口径』的说明书本体。

**依据**：读了被审 diff 中 skills/dual-critic/SKILL.md 的新增段（changes-20261011T212239Z.diff 133363-133407，全部为 + 行）；随后对仓库 grep read_content_diagnostic|write_contract_diagnostic|deny_evidence，发现『第16B/r20获批取证契约…』等同一段落在 SKILL.md、PROTOCOL_dual_critic_relay.md、QUICKSTART.md、ADR_003_agent_access.md、MANUAL_user.md、GUIDE_local_pitfalls.md、RUNBOOK_pipeline_ops.md、CASE_manual_acceptance.md 九处逐字并存，且各段互相声明为『已修订』『历史采样』。

**建议**：把带日期的轮次状态快照收敛到 doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md 单一权威源；各手册只保留当前生效契约的规范式陈述（无轮次数字）并链接该报告。若『SKILL.md 为核心容器源、其余渲染』是有意方案，则把渲染副本标记为生成物（勿手改），并给出渲染命令，避免九份手工同步。

### CLAUDE-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-recipes.mjs:5-8` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：assertProductionArm 用负向黑名单（五个 combination 名）拦 Claude 写臂的付费启动。黑名单语义是『列出的才拦』：今后往 agent-access-closeout.mjs 的 combinations.claude 增删组合（改名、加 -pro 变体、新增 profile）时，该守卫默认放行且无任何测试会因『新组合未被拦』而红，预算消耗门与能力结论（probe 记录）就此脱钩。

**依据**：读了 diff 133200-133213 的 recipes.mjs 新增段与 132803-132808 closeout 的替换点：旧内联检查为 ['kimi','kimi-pro','deepseek']，新函数扩为 ['qwen-pro','kimi','kimi-pro','deepseek','deepseek-pro']；对照 closeout.mjs 实际文件 line 36-51 的 combinations 映射（我 grep 了真实文件），黑名单与组合清单是两处独立手写字面。SKILL.md:55 的口径是『无新机制的组合不再付费碰样本』，实现依赖人工维护名单而非能力事实。

**建议**：反转判定方向：付费写臂只允许显式白名单（或从 probe/能力记录中派生『已批准重试』集合），新增 combination 默认拒绝并报错要求显式裁决；同时给『组合清单与守卫名单的一致性』补一条断言测试。

## 认为正确的部分

- claudeDenyEvidence 的严格双射配对（唯一 init/成功终态、每目标唯一调用→唯一 is_error 结果→同 ID 同工具同精确路径权限记录、完整覆盖、目标成功读取与哨兵泄漏一票否决、白名单外拒绝形态）与 22B 契约逐字对应；test/unit/agent-access-denial-evidence.test.ts 用真实不可变回放（三个 pin 死 hash 的 variants）加 35 条独立变异覆盖，且 codexCommandEvidence 冻结函数体由 sha256 断言保护——这正是『诊断不改原判据』的可验证落地。
- 目录消费绑定（CLAUDE_DIRECTORY_SHAPE + claudeSensitiveGlobsHash + TTL + wrapper/native 入口 hash + 夹具残留检查）把『旧事实冒充新形态』与『夹具配置冒充项目配置』两个洞关进 fail-closed：verifiedClaudeDirectories 缺 projectHash 即返回 {}，integration 测试断言 v1 旧 shape 与 globs 变更均不触发压缩（compressedTools 为空）。
- freeze.ts 的 SENSITIVE_SCAN_MAX_PARENT_DEPTH=7 成为具名常量并被 freeze-drift.test.ts 直接钉死边界与 8 段不覆盖，注释如实声明『不能宣称全深度枚举』，注释与实现同口径。
- recordAdmissionFailure/cleanupPreservingFailure 双因果保留（AggregateError）与 fixture/scratch 初始化移入 try/finally、cleanup 不冒称未取得的状态，均与 SKILL 20C 段逐字兑现；未知 TypeError 经 doctor 注入测试确认继续上抛。
- read_content_diagnostic / write_contract_diagnostic 严格限定 diagnostic-only（不并 actual_read/deny_pass/准入汇总），captureReadFileState 用 O_NOFOLLOW + dev/ino/size/mtime 双身份复核，逐字节不裁剪——与说明书一致，且 probeClaudeDirectories 的 5 根 30 文件夹具与 ascii-root1-5-depth0-2-v2 形态自洽（covered() 只放开末段文件名特例、中间段强制 ASCII，保守方向正确）。
- ledgerRoot 与 TRIVIUM_ACCESS_EVIDENCE_ROOT 的分离在 selection/closeout 全链贯通（probe.mjs hash、nativeVersionFromLedger、selectedVersion 传参），并由 agent-access-closeout.test.ts 新增『错误使用证据根不得静默获得 native 身份』的 ENOENT 断言守住。

## 未覆盖范围（本侧盲区）

- doc/05_testing/evidence/**/r21 的 mode3/criteria/auth-timestamp 系列 helper（controlled-mechanism-mode3.mjs、criteria-consumer-v3.mjs、auth-timestamp-chain-v2.mjs 等）实现未逐行审查；仅核实了它们的测试引用路径、hash 锚定与 schema 消费断言，不能为其逻辑整体背书。
- 本侧无执行能力：测试全绿结论来自读取留痕 doc/05_testing/evidence/agent-access-20261011-closeout-r21/full-compiled-tests-before27-v4.json（grep 未见 ✖/not ok，仅命中 ✔ 测试名中的 'failure' 字样），非我复跑。
- diff 共 2139 文件、35.9 万行，其中绝大部分为证据 JSON；我只覆盖了 src/scripts/skills/test 的代码面与部分测试面，证据 JSON 仅抽查（prompt-replay、deny-paths-replay 未逐条核对 14 份历史样本原文）。
- SKILL.md 所称『本文件为核心容器源，七入口措辞本轮未改，无需 render』未逐入口核实渲染一致性。
- agent-access-closeout-summary.mjs 未改动，我仅经 denial 测试的 regex 断言间接确认其消费路径，未通读其判定逻辑在新 deny_evidence 语境下的全部含义。
- judgeDirectoryArm 的生产 normalizeAbs 与脚本 normalizedPath 的归一宽窄差异，我按『脚本严格侧一票否决』的组合语义推为安全，未在真实 CLI 上验证（不可执行）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `src/trivium/adapters/claude.ts`
- `src/trivium/probes/claude-directory.ts`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-budget.cjs`
- `test/unit/agent-access-denial-evidence.test.ts`
- `skills/dual-critic/SKILL.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r21/full-compiled-tests-before27-v4.json`
- `.reviews/Agent双模式接入真实准入收口/code/_meta/changes-20261011T212239Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":11,"grep":18,"glob":0,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
