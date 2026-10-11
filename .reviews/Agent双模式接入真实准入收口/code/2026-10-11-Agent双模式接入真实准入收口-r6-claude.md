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
run_id: 20261011T070836Z
rerun_index: 6
snapshot_hash: sha256:e00c8bea400fb56e369d7ac8883b285ccd727f5607d148c969fbd86049d48fcc
blind: true
started_at: 2026-10-11T07:08:42.629Z
finished_at: 2026-10-11T07:17:19.998Z
duration_s: 517
tool_calls:
  read: 12
  grep: 11
  glob: 0
  run_command: 0
  project_reads: 12
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
session_id: ff831566-9ca9-49de-a2f9-f23eec0cf439
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T070836Z` ｜ 第 6 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

焦点「授权总14轮，先计划审查再代码重审」机制上成立且逐环可核：v6授权逐字记录该指令，round-guard-v2 以 task.runs 长度定序、13只能B/plan、14只能C/code、15拒绝，第13B(run20261011T061256Z)先获批后实施，本轮14C显式base 39ed经 launch-v10 启动，文档(RUNBOOK/QUICKSTART/设计v1.3.150)均带勘误性"较晚"补记，同口径。最需处理的一条：新 quiet-launch-v7 把子进程原始 stderr 尾三行不经 redactSecrets 直接回显，破坏全链路"脱敏后输出/落盘"惯例（v10 同一流是脱敏后写）。另有两条可执行性缺口：守卫未机械核验 review start 的显式 --base（本轮靠 r6 脚本约定满足）；v6 supersedes 谱系无断言、授权文件形状无自洽性核验，均 nit。无阻断项。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 2 ｜ 吹毛求疵 2）

### CLAUDE-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v7.mjs:53-64` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：quiet-launch-v7 将子进程原始 stderr 的尾三行以 stderr_summary 未经脱敏直接 console.log 输出；同一管道中 launch-v10 对自身回显与落盘均先过 redactSecrets/scanSecrets，证据写盘还强制 wx+扫描。新增包装器层成为唯一例外，破坏了本任务一贯的『脱敏后才允许输出/落盘』惯例，厂商CLI报错文本若夹带环境变量派生凭据会原样进入本层 stdout。

**依据**：读 quiet-launch-v7.mjs:53-64（child.stderr 原样累加并在第64行未脱敏输出 stderr_summary）对照 launch-v10.mjs:85-89（completed 内容先 redactSecrets 再 scanSecrets，回显 stdout/stderr 亦 redactSecrets）与 scripts/agent-access-evidence.mjs:5-9（saveEvidence 落盘前 scanSecrets 失败即拒）。RUNBOOK/QUICKSTART 对 quiet-v7 的承诺只有『错误退出信息保留』，未声称可免脱敏。

**建议**：对 stderr_summary（以及任何本层回显的子进程 stderr）套用与 evidence 模块相同的 redactSecrets 后再输出；保持保留退出码与尾行数语义不变。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs:38-49` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：获批计划与 RUNBOOK 均把『14C 相对 39ed2053 全量审/不得默认 HEAD』写成硬要求，但 round-guard-v2 只核验 topic/driver/critics/entry/stage 与 --allow-single，launch-v10 的守卫分支也不检查 --base 的存在与取值；缺 --base 的正式 code start 会静默按默认 HEAD 送审。本轮实际由 r6/formal-round14.mjs 传了 --base，属约定而非机械保证。

**依据**：读 round-guard-v2.mjs:38-49 与 launch-v10.mjs:39-52（无任何 base 引用）；changes-20261011T070836Z.diff 中 RUNBOOK 补记行『下一14C相对39ed全量审』与历史条款『10C必须显式base39ed…而非默认HEAD』；同 diff 已提交的 v6 直接回归用例（recovery.test.ts『当前v6生产v2守卫…』段）以不含 --base 的 argv 断言成功通过守卫，证实缺口存在。

**建议**：在守卫的 code 阶段分支要求 --base 恰出现一次（值可与授权文件或冻结记录绑定核验），或至少在 pre-round 冻结审计里把 start argv 含显式 base 作为检查格落证，避免未来轮次直接复用 launch-v10 时退化为 HEAD 增量审。

### CLAUDE-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/agent-access-recovery.test.ts:104-141` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：v6 授权的 supersedes_file/supersedes_sha256（声称指向 v5 且 hash 753ef9…）在已提交测试与审计脚本中没有任何消费方断言；v5 的同类谱系字段则有直测，形成谱系链验证的不对称——v5→v6 一条边的字节连续性目前只靠指针 hash 间接钉住。

**依据**：grep changes-20261011T070836Z.diff 全文 supersedes：仅 :35651（v5 夹具用例）读取 current.supersedes_* 并核 hash；:36271-36272 只是 v6 文件正文声明；各 r5/r6 prepare 脚本只在生成时写 hash(old)，无事后核验。

**建议**：在当前 v6 直测用例中补一条与 v5 用例对称的断言：读 v6.supersedes_file 实际字节算 sha256 等于 v6.supersedes_sha256。

### CLAUDE-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs:22-31` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：assertFormalRoundCore 的 wellFormed 只验形状不验自洽：不检查 previous_limit+新轮数与新_limit 的连续性、historical_run_ids 数量与既往上限的关系、new_rounds 的 ordinal 是否恰为 len(historical)+1 起连续。一份形状合法但数字笔误的授权文件会被守卫全盘接受。

**依据**：读 round-guard-v2.mjs:22-31 全部条件（类型/数组/整数，无等式核验）；对照 formal-round-authorization-v6.json 的 previous_limit=12、historical 12 条、new_rounds ordinal 13/14、new_limit=14——数值自洽但纯靠人工撰写保证；本轮 launch-v10 与 recovery.test.ts 也均未复核该不变式。

**建议**：在纯核验里追加低成本的连续性断言（如 new_limit===previous_limit+new_rounds.length 且 ordinal 连续），拒绝自洽性破缺的授权，保持 fail-closed 语义不变。

## 认为正确的部分

- 焦点要求被忠实实现且证据链完整：v6 授权逐字记录『授权总14轮，先计划审查再代码重审』，new_rounds 13B/plan→14C/code 由守卫按 task.runs 长度定序机械执行，15 拒绝、count_reset=false、判据变更不随轮数授权放行
- 指针式权威绑定正确：formal-round-authority.json 以文件名+完整 sha256 钉 v6，readCurrentAuthorization 对载体名正则、hash 漂移、主题不符三重 fail-closed；assertFormalRoundCore 第五参必须显式且与当前权威全等，杜绝『旧授权当本轮声明』
- 已提交测试把上一轮 CLAUDE-01 缺口补上了：v2 生产守卫的错 topic/driver/critics/entry/stage、重复与缺失旗标、--allow-single、集合不等/孤儿/重复/unreadable、历史 fixture 固化等负例齐备，旧 v5/v4 边界不随实时指针漂移
- token 生命周期与文档一致：REQUEST_TOKEN 贯通 LOAD_TOKEN/load_id/marks，claim 走 wx 独占且先于预算/测量/spawn，跨label与孤儿 token 复用均拒；quiet-v7 证据配对含时间下界、launcher 双 hash、requested/completed 全字段等值、child 2/64 保留与 0 转 1
- precheck-v2 的 stage 路由（缺/未知拒绝、--profile 拒猜、仅 code 测量）与设计 v1.3.150『取消任务级 plan 测量、未来新 plan 重评』的说明同口径；directory_fact/deny_settings/软线核验与产品常量同源
- 文档面同步到位：RUNBOOK/QUICKSTART/recipes 头注/恢复报告均追加具时点的『较晚』补记，把 v5/launch-v8 文字显式降为历史采样，未倒改原件；r6 冻结与 pre-round14-state 证明 13B 获批在前、14C 启动在后的顺序成立

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：『两遍 check、桩14/14、build 与四目标重装』只能依据 r6 证据 JSON 记录的退出码与 hash 静态采信，未实测
- gitStatus 快照标记 r3/formal-round-authority.json 相对 HEAD 为 M，但其工作副本七行与被审 diff 提交块逐字一致；无 git 对象读取手段，未决是否存在字节级漂移，相关结论均未依赖该文件的工作副本
- 产品侧 src/trivium 代码（freeze.ts/adapters/probes、CLI 对 --base/--critics 的解析语义）与 test/unit/agent-access-task-launch.test.ts、agent-access-task-launch 全量未逐行复审，本轮重心在轮数授权链与包装器
- 对 round-guard 全仓检索时，根级 Grep 曾命中 _meta/brief-gemini/glm-*.md 的行（内容为我收到的同一 BRIEF/diff 头部镜像，不含任何他侧意见）；本审查全部结论仅依据被审 diff、注册必读件与项目源码，未引用、未推测他侧审查产出
- scripts/agent-access-budget.cjs 的 limit/reserve 实现未通读，『拒绝不计预算』的表述系由 preload 调用点与测试断言（reserved==0）间接佐证

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/code/_meta/changes-20261011T070836Z.diff`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v6.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v10.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v7.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r6/formal-round14.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r6/pre-round14-state.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r6/frozen-before-round14.json`
- `test/unit/agent-access-recovery.test.ts`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-budget-preload.cjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-launch.mjs`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":12,"grep":11,"glob":0,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
