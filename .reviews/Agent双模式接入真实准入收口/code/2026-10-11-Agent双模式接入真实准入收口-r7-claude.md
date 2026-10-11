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
run_id: 20261011T083951Z
rerun_index: 7
snapshot_hash: sha256:68a0eda8bc65652315149cb2200d77a7cfb4fa0b2ae55188ddda1984caa636f3
blind: true
started_at: 2026-10-11T08:39:58.277Z
finished_at: 2026-10-11T08:55:07.870Z
duration_s: 909
tool_calls:
  read: 22
  grep: 9
  glob: 0
  run_command: 0
  project_reads: 16
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 2
degraded: false
parse_fallback: false
peer_deny: true
drift: false
consulted_unverified: true
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
session_id: b21fb57a-6d7d-449f-ae5e-5f968c456d7b
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T083951Z` ｜ 第 7 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

焦点『授权总15轮，仅追加完整代码重审』的实现链成立：v7 授权逐字记录该指令，round-guard-v2 以指针文件名+完整 hash+主题三重 fail-closed 核验当前权威，assertFormalRoundCore 要求传入授权与磁盘权威逐字相等，15C 唯一允许、第 16 次与新增 plan 机械拒绝；launch-v11 相对 v10 仅改授权载体，恢复报告/SKILL/ADR/PROTOCOL 承诺与守卫、precheck、quiet-v8 脱敏逐项同口径，有两份新测试文件直测。最需处理的一条：quiet-v8 面向用户的拒绝文案仍指示『正式 review 直调 launch-v10』，而同一提交内权威指针已切 v7、v10 硬读 v6，其 review --start 必被守卫拒——v11 才是唯一正式入口；且经 quiet-v8→v10 产生的 r15 认领/预检证据把 round_authorization 记成 v6 路径，谱系标签滞后。其余为 precheck 内 driver 硬编码、README 索引行混写矛盾采样状态、verifiedClaudeDirectories 可选参数静默失效三处小项。无阻断。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 2 ｜ 吹毛求疵 2）

### CLAUDE-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v8.mjs:21,57-59` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：quiet-v8 拒绝非白名单命令时打印『正式review直调launch-v10』，但同一提交内 formal-round-authority.json 指针已切 v7、launch-v10 第 37 行硬读 formal-round-authorization-v6.json，守卫的 JSON 全等核验使 v10 的 review --start 在 15C 必抛『授权已被替代或不是当前权威』——v11 是唯一正式入口，用户可见指引与提交自身状态矛盾；另外 r15 的认领/解析/预检若按既有流程经 quiet-v8→v10，requested.json 会记 round_authorization 为 v6 文件路径，谱系标签与本轮权威 v7 不一致。

**依据**：读 quiet-launch-v8.mjs:21（throw 文案）、:57-59（launcher 硬绑 launch-v10.mjs）；launch-v10.mjs:37（v6）、launch-v11.mjs:1,37（v11 仅换 v7 载体，其余与 v10 逐行一致）；round-guard-v2.mjs:6-15,30（指针核验+授权逐字相等）；被审 diff 第 10338-10345 行显示提交的 authority 指针为 v7/6499270…；diff 第 35772、35828 行回归以旧授权对当前权威断言 /授权已被替代/，证实 v10 的 review 启动在该指针下必拒；v8 的 main() 与 v7 同样把 SCRIPT_SHA256/execution_sha256 绑定 v10 字节（selectCurrentEvidence 比对 launcherSha256）。

**建议**：在允许变更的指导面（SKILL/恢复报告的 15C 采样段，或未来 quiet-v9）写明当前正式 review 入口为 launch-v11，不再指向 v10；若坚持『旧原件不改』，至少在 15C 收口记录勘误一格，说明经 v10 产出的认领/预检证据其 round_authorization 字段固定为 v6、判谱系须以 current_authority_sha256 为准。方向而非补丁。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs:44` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：measureCodeStart 调 enumerateDenyPaths 时把 critic 写死 'claude'、driver 写死 'codex'，而不是从传入 args 的 --driver 或授权文件的 driver/critics 字段取。当前主题恰授权 driver=codex、critics 固定三侧，守卫也已把 --driver/--critics 钉死到授权值，所以本轮无实际偏差；但该测量链（settings 软线门禁与 directory_fact_consumed 判定）依赖的同行归档剪枝集与真实运行注入集之间的等式没有任何机械核验，launcher 谱系（v10/v11 互相抄写）一旦在别的授权下复用，门禁量的是错位的禁读集合。

**依据**：读 formal-start-precheck-v2.mjs:27-44（签名收 args 仅用于 stage/overrides，第 44 行硬编码）；launch-v11.mjs:44-51（measureCodeStart(repo, topic, args) 的 args 含 --driver 却不传递语义）；round-guard-v2.mjs:45-48（flag 核验保证 --driver==authorization.driver）；formal-round-authorization-v7.json 的 driver/critics 字段。等式成立纯属本主题取巧，而非代码约束。

**建议**：把 authorization.driver（或解析后的 --driver 值）传入 enumerateDenyPaths，或在 measureCodeStart 内断言 args 的 --driver 与硬编码值一致、不一致即拒测；与冻结/证据格式变更一并评估。

### CLAUDE-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/README.md:137（新增 REPORT_2026-10-11 条目）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：该索引行在同一句话里先写『单次15C资格待独立授权』『M11前置未完成』，紧接『；最新独立总15仅C已授权…15C待执行』，两个互相矛盾的采样时刻未加时间标签混排，且留有『。；』双标点。本提交其余文档（REPORT 追加节、SKILL、ADR、PROTOCOL、GUIDE、CASE）对旧采样一律显式标注『按当时采样保留』，索引条目反而违背了这套自身纪律——而索引恰是读者判断当前状态的第一入口。

**依据**：被审 diff 第 610-614 行（README.md hunk，+行含上述原文）；对照同 diff 第 963-971 行 REPORT『第15次独立授权』节与第 31028 行 SKILL 补记均逐字注明『授权总15轮』及采样语义；grep 设计文档第 2030 行『v1.3.148 当前规范引用：进展见恢复报告』也体现同一收敛约定。

**建议**：把该 bullet 拆成带时刻的两段（或只保留当前态，旧段标注时间），并去掉『。；』；不改其它索引格式。

### CLAUDE-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/claude.ts:439-442` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：verifiedClaudeDirectories 的新参数 projectHash 带默认值 null，而 directoryDeclarationUsable 要求 !!projectHash——任何漏传第五参的调用会编译通过并静默返回 {}（目录事实全弃），把『忘了传』伪装成『事实不可用』。测试（claude-directory.test.ts:142,173）把这一语义钉成了契约，说明是有意的 fail-closed，但对未来调用点它仍是无声的退化通道，与全仓『失配要可观测（notes/降级旗标）』的惯例相比差一层。

**依据**：读 claude.ts:430-455（DirectoryProbe、directoryDeclarationUsable、新签名与 consumeClaudeDirectories 的唯一生产调用）；grep 结果 claude-directory.test.ts:137-142,173 显示 4 参调用被断言为 {}；claude.ts:1012 生产路径由 consumeClaudeDirectories 显式传五参。

**建议**：去掉默认值、把 projectHash 改为必填，保持语义不变而让漏传在编译期暴露；如保留默认值，则在返回 {} 的原因里区分『projectHash 未提供』与『事实失配』并进 notes。

## 认为正确的部分

- 焦点机制成立：formal-round-authorization-v7.json 逐字记录『授权总15轮，仅追加完整代码重审（建议）』，new_rounds 仅 ordinal 15/C/code，new_limit=15 且 count_reset=false；round-guard-v2 的 readCurrentAuthorization（文件名白名单正则+完整 sha256+主题一致）与 assertFormalRoundCore（传入授权与磁盘当前权威 JSON 逐字相等、已启动含失败/运行中定序、--allow-single 拒绝）把『仅开放15C、拒绝16次与新增计划审查』变成机械保证，agent-access-recovery.test.ts『当前v7生产守卫仅允许15C』用例含谱系 supersedes 字节直测、五旗标缺失/重复/错值与集合突变全负例，与 SKILL/ADR/PROTOCOL/CASE 的补记完全同口径。
- launch-v11 对 v10 逐行比对仅改首行注释与第 37 行授权文件路径，『v11只更新授权载体，不修改guard语义或准入判据』的承诺兑现；预算连续性冻结原件双端 hash 核验、token 先于预算/测量/spawn 的 wx 独占、plan 不测量/code 先测 precheck-v2 默认链均与 13B 批准范围一致。
- 目录事实整改与说明书同口径：claudeSensitiveGlobsHash（排序去重稳定 hash）、CLAUDE_DIRECTORY_SHAPE='ascii-root1-5-depth0-2-v2'、covered() 谓词（目录段 ASCII、根≤5、后代≤2）、consumeClaudeDirectories 仅候选声明才读二进制、recorded 追加 cleanup 残留与夹具篡改复核、doctor/快照双路径清理新增两字段，与设计 §3.5 锚点、ADR 当前决策、PROTOCOL 增量条款逐条对应；expectedDirectoryFailure 只降级已定义外部失败、未知内部异常继续抛，兑现『未定义内部错误继续抛』。
- peer_deny_applied 在 claude.ts:745-746 确实是『逐文件实测 ∧ 全部实际压缩工具 verified』合取，types/report/probes/claude 的注释修订（『合取不逐条证明本次规则』『其他侧仍消费原探针格』）与 zcode/agy/codex 三适配器仍读探针格的实测一致——实现与自身文档同口径。
- freeze.ts 以具名常量 SENSITIVE_SCAN_MAX_PARENT_DEPTH=7 替换魔数，注释（根5+后代2需要7、父深度8仍不覆盖、归档同行面无此上限）与设计 §9.4 原型边界声明互证，brief.ts 未披露一事在设计中显式留作独立后续，不冒充已覆盖。
- quiet-v8 的全摘要 redactSecrets+scanSecrets 与 code/signal/边界语义保持（child 0 证据失败→1、非0沿用）、judgeDirectoryArm 的 targets.length>0/permissionComplete/successful 收紧、selectCurrentEvidence 的 requested/completed 全字段等值与时间下界，均有 agent-access-task-launch.test.ts 的合成凭据真实子进程直测，兑现 14C 裁决接受的两项补修且不夹带 guard 语义改动；recipes 抽取（assertProductionArm 五组合拒绝集）与 REPORT 第11节批准记录一致，未重复 14C 已驳回/暂缓的 base 守卫与连续性守卫。

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：v7.supersedes_sha256 与 v6 实际字节、两次 check 3153/3/0、桩 14/14、28 入口与四全局配置 hash 等只能按证据 JSON 与测试断言静态采信，未实测；15C 结果与新版完整指纹本就尚未取得（文档自述）。
- 被审 diff 约 5.9 万行中 doc/05_testing/evidence/ 的 r3~r7 采样 JSON 未逐行通读，审查重心为 src/scripts/test/skills/doc 变更段、r3 关键脚本与授权文件全文、两份新测试文件全文。
- gitStatus 标记 r3/formal-round-authority.json、r3/README.md、test/unit/agent-access-recovery.test.ts、scripts/agent-access-recipes.mjs 等工作副本相对 HEAD 为 M：无法读 git 对象取得 HEAD 字节，相关结论一律引用被审 diff 的提交内容（如 authority.json 的 10338-10345 行 hunk），工作副本仅用于确认当前态未退回 v6 指向，未决是否存在其它字节级漂移。
- agent-access-budget.cjs 的 limit()/reserve() 实现未通读，『守卫拒绝不消耗预算』仅由 preload 调用点顺序与测试 reserved==0 断言间接佐证；trace.json 中 directoryGuard 新增字段（observed/recordedProjectHash 等）的全仓消费方未展开核查。
- 厂商 CLI 真实行为（claude/codex 实际目录 deny、泄漏、E2BIG）全部为静态推断加留痕采信，未复测；brief.ts 运行模板的深度边界披露按既往裁决留作独立后续，本次不作为新缺陷重复提出，也未重复 14C 已驳回的 --base 守卫与已暂缓的授权数值连续性 guard。
- plan 阶段测量取消（设计 v1.3.150）对未来新 plan 轮次的重评义务仅确认其记录存在，未评估该方案本身的完备性。

## 实际查阅的项目文件

- `CLAUDE.md`
- `.reviews/Agent双模式接入真实准入收口/code/_meta/changes-20261011T083951Z.diff`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v7.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v6.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v10.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v11.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v8.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs`
- `src/trivium/adapters/claude.ts`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/freeze.ts`
- `src/trivium/doctor.ts`
- `src/trivium/types.ts`
- `src/trivium/report.ts`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-selection.mjs`
- `scripts/agent-access-budget-preload.cjs`
- `test/unit/agent-access-task-launch.test.ts`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/agent-access-applicability.test.ts`
- `test/unit/claude-directory.test.ts`
- `test/integration/claude-structured-probe.test.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/04_development/GUIDE_local_pitfalls.md`
- `doc/05_testing/CASE_manual_acceptance.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `skills/dual-critic/SKILL.md`
- `.reviews/Agent双模式接入真实准入收口/code/2026-10-11-Agent双模式接入真实准入收口-r6-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":22,"grep":9,"glob":0,"run_command":0,"project_reads":16}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
