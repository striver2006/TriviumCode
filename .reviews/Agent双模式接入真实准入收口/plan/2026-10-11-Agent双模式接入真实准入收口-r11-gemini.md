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
run_id: 20261011T142848Z
rerun_index: 11
snapshot_hash: sha256:5b2d97a0e3c0bed33f57f5999cebcde7a7595f774dabde18783b2a5a40214548
blind: true
started_at: 2026-10-11T14:28:53.480Z
finished_at: 2026-10-11T14:45:48.225Z
duration_s: 1015
tool_calls:
  read: 34
  grep: 9
  glob: 2
  run_command: 0
  project_reads: 24
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 3
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
session_id: f80e9d77-f80a-4d2a-9f97-a48ecd33e0c8
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261011T142848Z` ｜ 第 11 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划针对 Claude Code 2.1.296 在 /private/var 真实路径下产生的通用目录拒绝错误定位准确，所提三向（工具调用ID、错误结果、终态权限记录）精确配对方案审慎，且严格遵守只读与guard语义变更须经计划审查的纪律。最需注意的实现风险是计划待裁决项中关于错误文本形态的判定：取证函数必须严格白名单比对已录制的旧路径错误与新通用目录错误，拒绝任意非权限错误混入；同时新增导出函数应避开 scripts/agent-access-evidence.mjs 中既有单测守护的代码冻结切片，并保持 result.json 的 per_file_deny 结构兼容。整体方案设计完备，予以有条件通过（approve-with-nits）。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：吹毛求疵 3）

### AGY-01 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2 与 scripts/agent-access-evidence.mjs:89` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划在 §2 提出「旧路径错误与新通用错误作为来源解释单列，是否要求精确已录制错误形态由正式审查裁决」，错误文本白名单口径尚待定夺。

**依据**：在 scripts/agent-access-closeout.mjs:239-242 中，原实现硬编码了正则 /^Permission to read (.+) has been denied\.$/。而新样本 doc/05_testing/evidence/agent-access-20261011-closeout-r13/admission-after21/routes/claude-qwen-deny-read-5/raw.json 中错误文本为 <tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>。若实现时不限定错误文本形态而仅看 is_error 与 permission_denials，可能将运行时内部异常（如解析损坏或子进程意外崩溃）误判为权限拒绝。

**建议**：正式裁决：实现时应采用显式白名单严格比对已录制的错误形态（既有带路径格式与新通用目录格式；针对 Grep 工具同样比对已观测到的标签包裹形态），禁止通配或任意非权限错误字符串通过。

### AGY-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2 与 test/unit/agent-access-read-evidence.test.ts:98-100` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：计划指定在 scripts/agent-access-evidence.mjs 中新增局部导出只读取证函数，未注明避开既有单测中的代码切片 SHA 冻结断言。

**依据**：test/unit/agent-access-read-evidence.test.ts:98-100 与 test/unit/agent-access-write-contract.test.ts:172-174 对 scripts/agent-access-evidence.mjs 中 export function codexCommandEvidence 至 export function primaryLoaded 之间的源码切片进行了 SHA-256 强校验（8662c80393311859b01731f780641647a1be7e89ee3ec186d767355f574b1479）。若新函数插入在该区间内，将直接导致 npm run check 单元测试红灯。

**建议**：在 23C 实施代码时，明确将新增的取证函数放置于冻结切片之外（如 codexCommandEvidence 之前或 cleanupPreservingFailure 之后），确保不破坏既有单测的切片 SHA 守卫。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2 与 scripts/agent-access-closeout.mjs:250` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：计划未明确新增取证函数在 scripts/agent-access-closeout.mjs 中调用时对 result.json 的结构兼容要求。

**依据**：scripts/agent-access-closeout-summary.mjs:49-50 及既有审计脚本（如 doc/05_testing/evidence/agent-access-20261011-closeout-r13/admission-after21/audit-read-denial-variant5.mjs:15-16）显式消费了 result.json 中的 per_file_deny 与 deny_pass 字段。新函数返回「逐目标事实、明确原因和总拒绝结论」时，若替换掉原始字段或改变逐目标结构，会导致下游汇总与回放对账脚本断言失败。

**建议**：在 scripts/agent-access-closeout.mjs 调用新取证函数时，保持 result.json 中 per_file_deny 的数组结构（保留 path、attempts、paired_error 等必要键）以及 deny_pass 的布尔语义兼容，新增详细事实可作为伴随字段扩展存储。

## 认为正确的部分

- 问题定性准确：真实识别了 Claude Code 2.1.296 在 /private/var 真实路径下返回通用目录拒绝错误（而非旧路径错误文本）但 terminal result 中完整保留 permission_denials 详细记录的底层行为事实。
- 整改边界克制：变更严格局限在准入取证脚本（scripts/agent-access-evidence.mjs 与 scripts/agent-access-closeout.mjs），不修改生产适配器、目录规则压缩、全局配置或产品运行时 Schema。
- 三向精确配对判据健全：要求每个目标同时满足唯一工具调用 ID、同 ID 严格 is_error=true、以及 terminal result.permission_denials 中同 ID、同工具、同精确归一路径记录，杜绝单纯依靠子串或通用错误文本冒充通过。
- 轮次与预算边界清晰：严格在 Bob 授权的 22B/23C 有界范围推进，24 明确拒绝，不追认历史 false 记录，不采用宽泛替代判据（如 component-scoped-evidence 或 restricted-tool-surface）。

## 未覆盖范围（本侧盲区）

- 审查员工作于只读环境，未实际运行 CLI 子进程或发起网络模型推理。
- 未在真实运行环境中触发 Claude/Qwen 的 deny-grep 臂，Grep 在新通用错误形态下的具体错误字符串表现需留待后续实测确认。
- 未对非 flash 的 5 个 Claude 写臂进行实际模型生成验证（计划明确指出当前保持 0 启动且未测）。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r23-codex.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r10-gemini.md`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-closeout-summary.mjs`
- `scripts/agent-access-selection.mjs`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/adapters/claude-trace.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/gate.ts`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/agent-access-closeout.test.ts`
- `test/unit/agent-access-read-evidence.test.ts`
- `test/unit/agent-access-write-contract.test.ts`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r13/post-round21-denial-evidence-plan-proposal.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r13/admission-after21/claude-qwen-read-denial-variant5-audit.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r13/admission-after21/routes/claude-qwen-deny-read-5/raw.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r13/admission-after21/routes/claude-qwen-deny-read-5/production-shape.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v12.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":34,"grep":9,"glob":2,"run_command":0,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
