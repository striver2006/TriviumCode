---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.3.3
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261011T171203Z
rerun_index: 12
snapshot_hash: sha256:664dd2998cf12840ef096525d15747ee7f7ca136be37d7090130808b43f41040
blind: true
started_at: 2026-10-11T17:12:08.219Z
finished_at: 2026-10-11T17:25:34.121Z
duration_s: 712
tool_calls:
  read: 39
  grep: 13
  glob: 3
  run_command: 0
  project_reads: 27
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/agy
  launcher_effective: /Users/chenzhenbo/.local/bin/agy
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: gemini
    status: unknown
    left_model: null
    right_model: gemini-3.8-flash-high
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
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: 59af10bc-29b2-4fdd-860e-ac5629d61daa
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261011T171203Z` ｜ 第 12 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

总判断：实施计划对送审重心理解准确，严格保持原准入标准列与未测记录，所提受控机制候选与时间戳适用性候选边界划分审慎，明确「未获正式审查及用户另行明确批准绝不消费」铁律。最需注意的风险在于方案B语义diff规则过窄排除了审核者常规探活缓存刷新、方案B证明边界陈述不对称，以及受控多工具合并执行时缺少机读契约定义。方案总体方向正确，予以有条件通过（approve-with-nits）。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 2 ｜ 吹毛求疵 2）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 与 scripts/agent-access-closeout-summary.mjs:32` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：方案B（auth-cache-timestamp-applicability-v1）在 §4 中对审查焦点的对称性落实不足：针对「明确证明什么、仍不能证明什么」的重心要求，方案A（§2）给出了严格的证明边界对照，而方案B仅用一句话带过（「不把“认证不是能力”当充分证明」），缺少机读/文档化的证明论域清单与非能力边界声明。

**依据**：送审焦点明确要求：「明确证明什么、仍不能证明什么。只有正式审查及我另行明确批准判据变化后才能采用；一般plan/code审批不包含该批准。此前原标准列和未测记录始终保留。」在被审 plan §2 中，方案A以表格和专段详尽声明了 A/B 证明范围与 5 项绝对不能证明之事；而 plan §4 中方案B仅描述了语义 diff 的过滤机制，未正式界定该判据候选的证明边界（例如：仅证明底层二进制、配置语义、模型、effort、Schema、TTL 规则等无任何漂移且仅 TTL 时间戳新鲜度更新；但绝对不能证明上游供应商服务可用性未变化、不能证明认证更新等于准入能力臂重新实测）。

**建议**：在 plan §4 补齐与方案A对等的判据边界陈述：明确定义 auth-cache-timestamp-applicability-v1 能证明什么（配置/CLI/模型/环境全指纹语义零漂移，仅 TTL 时间戳按生产逻辑合规刷新）与仍不能证明什么（不证明供应商真实服务端稳定性，不证明未测能力臂已自动具备），并在诊断记录契约中包含该边界字段。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 与 src/trivium/preflight.ts:1123-1124` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：方案B中语义 diff 规则将允许变更键狭隘限定为「只允许相同具名auth_route键的checked_at变化」，忽视了三审审核者（如 gemini、glm）在预检时其探活缓存落在 probe.auth（非 auth_routes），会导致正常三审预检刷新后被误判为 not-applicable。

**依据**：plan §4 规定：「预检前后在0600临时副本作全配置语义diff，只允许相同具名auth_route键的checked_at变化；所有其它配置节点...必须一致。出现任何其它变化...均not-applicable/unknown。」然而查阅 src/trivium/preflight.ts:1122-1125，commitAuthCache 的更新逻辑为：if (entry.combination) (p.auth_routes ??= {})[key] = entry; else (p.auth ??= {})[key as CriticId] = entry;。对于无 combination 的常规审核者（如本轮三审中的 gemini、glm），其探活缓存写入的是 probe.auth。当前三审缓存已过 1h TTL，下一次正式预检必然会刷新 probe.auth.gemini 与 probe.auth.glm 的 checked_at；若 diff 规则机械限制「只允许 auth_route 键」，则正常预检后 diff 检测到 probe.auth 的时间戳变动将直接触发 fail-closed 判为 not-applicable，使方案B在生产流水线中不可行。

**建议**：将语义 diff 白名单规则精准修正为：允许 probe.auth_routes.*.checked_at 以及当前入选审核者在 probe.auth.*.checked_at 的时间戳单调前进，同时严格断言其 ok === true、fingerprint、cli_version 以及所有其它非时间戳节点完全一致。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3 与 scripts/agent-access-evidence.mjs:189-190` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：方案A的B层受控取证机制将 Write/Bash 禁用拒绝与六目标 Read/Grep 路径拒绝整合为单次多工具组合输入，现有 claudeDenyEvidence 因覆盖率硬断言无法直接复用，计划缺少新评估脚本的机读输出契约定义。

**依据**：plan §3 提出「强制协议输入依次覆盖两种写工具及六目标Read/Grep」，且 pilot 预计仅「逻辑2、保守包装/native预计4启动」，表明每个模型在单次受控 CLI 调用内依次验证 Write、Bash、6个Read目标与6个Grep目标。在此执行模式下，终端事件中的 permission_denials 将累积包含 Read 和 Grep 共 12 条拒绝记录；而 scripts/agent-access-evidence.mjs:189-190 明确要求 permissions.length === targets.length（targets 长度为 6），直接调用必然报 permission-coverage-mismatch。虽然 plan §3 说明评估脚本位于独立证据域，但未给出其输出 JSON 结构或判据结构契约，可能导致 25C 实施时契约口径模糊。

**建议**：在 plan §3 明确受控机制评估函数的机读产出契约（例如分别提取并校验 Write/Bash 的 disabled 报错、Read 的 6 目标拒绝配对、Grep 的 6 目标拒绝配对，以及总 12 条 permission_denials 的无悬空全覆盖），并固定产出结果的 JSON Schema 形状。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.4 与 test/unit/agent-access-recovery.test.ts:286-298` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §5.4 的独立变异测试范围遗漏了「受控多工具拒绝总数失配」以及「方案B非时间戳键（如探活结果/指纹/版本）伴随变化」的变异用例。

**依据**：plan §5.4 列举了变异测试覆盖点，包括「错/缺/重复ID与权限、错误cwd/相邻路径、模式和工具面失配、包/配置漂移、授权缺失/撤销/错范围、清理失败/内部错误和loopback限额」。但在受控多工具输入中，最容易漏防的形态是：CLI 漏拦截了某一个目标（例如 6 个 Read 只拦截了 5 个）、或者 permission_denials 出现多余/工具名错位记录；在方案B中，最危险的逃逸是预检返回了 ok: false 或被篡改的 fingerprint 但仅因 checked_at 更新而被误判适用。

**建议**：在 §5.4 测试清单中增列：1）受控多工具执行中拒绝记录总数不足或超量（如 11/13 条）、工具名与目标路径错位的变异测试；2）方案B语义 diff 中，ok 置 false、fingerprint 变动或 cli_version 漂移时必须严格断言为 not-applicable 的变异测试。

## 认为正确的部分

- 恪守送审焦点约束：保留原标准列与未测记录，两项判据候选（restricted-tool-surface-and-path-v2 与 auth-cache-timestamp-applicability-v1）明确未获Bob独立明确批准前绝不消费，不以普通plan/code审批混淆判据变更。
- 面对生产未注册Write/Bash工具面及模型口头拒读时如实停止，不外推模型行为、不循环换提示碰运气、不伪造生产负对照。
- 方案A四层设计解耦清晰（A只读正例、B受控机制、C原标准对照、D授权留痕），并详尽列出了5项不可证明之事（模型主动性、任意诱导、系统调用、外部服务、服务端未来行为等）。
- 受控机制要求严格对齐生产default权限模式与init工具面，通过PID/lstart真实消费观测防伪装，不复制真实凭据，pilot失败即停。

## 未覆盖范围（本侧盲区）

- 官方Claude待订阅恢复状态、第三方服务商后端真实网络身份及握手过程。
- 受控loopback本地传输服务的内部并发连接治理及底层Node.js实现细节。
- 未启动禁读臂的Claude路线在生产提示下的实际模型交互行为。
- 计划中变异测试与端到端回归的实际执行结果（本侧为只读审查员，仅作静态推理，不宣称实测）。

## 实际查阅的项目文件

- `skills/dual-critic/schema/review.v1.json`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/parse.ts`
- `skills/dual-critic/agents/trivium-critic.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r11-gemini.md`
- `test/unit/agy-events.test.ts`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r25-codex.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r15/post-round23-admission-criteria-plan-proposal.md`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-evidence.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r15/status-after-all-positive.json`
- `doc/02_design/ADR_003_agent_access.md`
- `test/unit/agent-access-recovery.test.ts`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v13.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r15/claude-final-positive-after23/routes/claude-qwen-pro-deny-read-3/raw.json`
- `src/trivium/adapters/claude-route.ts`
- `scripts/agent-access-closeout-summary.mjs`
- `test/unit/agent-access-denial-evidence.test.ts`
- `src/trivium/preflight.ts`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `src/trivium/gate.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":39,"grep":13,"glob":3,"run_command":0,"project_reads":27}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
