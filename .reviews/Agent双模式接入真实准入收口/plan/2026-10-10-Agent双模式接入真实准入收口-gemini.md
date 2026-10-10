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
run_id: 20261010T062559Z
rerun_index: 1
snapshot_hash: sha256:e0488da20412af3283a2497d0a8a91979f77dda636c9e2b2b7e5902729775187
blind: true
started_at: 2026-10-10T06:26:01.702Z
finished_at: 2026-10-10T06:41:33.597Z
duration_s: 290
tool_calls:
  read: 16
  grep: 4
  glob: 0
  run_command: 0
  project_reads: 16
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 3
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: true
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
session_id: 66edeaea-d6f2-4748-961a-95406c332ba9
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261010T062559Z`
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本次计划整体严守了人工闸门与 Driver 护栏纪律，但存在关键路径断裂与需求遗漏：
1. 替代判据（路径2）未在补测计划中规划受控传输臂 restricted 验证的具体执行步骤与预算，而默认路径1直接预设无写模型0次尝试，导致前置任务注定无法收口，二选一陷入无法落地的僵局；
2. 遗漏了任务目标中明确点名的 DeepSeek flash‘严格读取首词断言未通过’缺口的排查与修复方案；
3. 补测预算未按‘路线×缺口×所需启动’形成三维精确矩阵，批次C缺乏明确上限与双重 spawn 折算，执行中极易意外撞顶中断；
4. 取证脚本改造未显式覆盖已有单元测试文件的同步适配；
5. 敏感保护配置归属与代码审查及 BRIEF 禁读扫描机制存在冲突。
建议修订补测矩阵与替代路径排期后再行审批。

**结论**：`request-changes`

## 审查意见（共 5 条：重要 3 ｜ 次要 2）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-codex.md:25-30` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：替代判据（路径2）未在补测计划中安排可执行性验证步骤，而默认路径1直接预设写负对照0次尝试导致前置任务必然无法收口。

**依据**：计划在第28行指出路径2受控臂须先验证restricted与生产配置形态能否保持，但在第44-50行分批补测清单及批次C（第48行）中直接对无写调用模型设为0次，且全局未安排受控臂验证的逻辑臂和预算。对照任务目标原文第三节要求‘提出具体、可审查的替代方案’，当前计划导致无论审批走哪条路径，执行时都会陷入或无验证数据或必然不达标的返工困境。

**建议**：在补测批次中明确补齐受控传输臂可行性验证（restricted模式与配置形态）的独立实验步骤、所需逻辑臂与预算；或在计划中明确若路径2待决，是否在批次C中先执行受控臂探索，避免二选一陷入无法落地的真空。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-codex.md:48` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：遗漏任务目标中明确点名的 DeepSeek flash‘严格读取首词断言未通过’缺口的整改与验证方案。

**依据**：任务目标原文‘二、重点处理剩余缺口’第2条明确规定：‘deepseek-flash 的写尝试仍未测，严格读取首词断言也未通过；逐项核对，不用 pro 替代 flash’。但被审计划全文未提及首词断言未通过的排查、修复或验收口径，仅在批次C（第48行）笼统列出‘读取和逐文件 Read/Grep’，遗漏了核心交付标准。

**建议**：在已核对事实与批次C补测方案中补充关于 DeepSeek flash 严格读取首词断言失败的原因分析、取证修复措施及具体验收标准。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-codex.md:42-50` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：启动预算未按‘路线×缺口×所需启动’精确细化，批次C预算无上限且未考虑Node包装器双重spawn计数。

**依据**：任务目标原文第四节要求‘先输出路线×缺口×所需启动的最小补测清单...每批设明确上限并提前记录’；scripts/agent-access-budget.cjs 第34行规定达到cap直接抛错拒绝spawn。但计划批次C仅写‘先最多24个逻辑臂；依实际包装器预占，必要时发布下一批’，未计算包装器与原生CLI的双重计数（scripts/agent-access-budget-preload.cjs:38-39），缺乏明确的追加预算规划与上限控制。

**建议**：补齐‘路线×缺口×所需启动’的三维显式清单，按每个逻辑臂实际折算的spawn次数计算上限，为批次C明确预留具体的扩容追加值与幂等键，避免执行时随机撞顶中断。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-codex.md:34-37` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：整改 scripts/agent-access-evidence.mjs 未将既有单元测试 test/unit/agent-access-budget.test.ts 纳入同步与兼容范围。

**依据**：scripts/agent-access-evidence.mjs 中 claudeWritePass 签名当前为 (trace, created, timedOut, code)；test/unit/agent-access-budget.test.ts:101-108 直接测试该函数。计划提出修改该函数增加 init.cwd 和 fixture 根等参数，却仅称‘同步全部 helper 调用点’，未声明对既有测试文件的同步改动，存在打破现有自动化检查的风险。

**建议**：明确说明在重构 claudeWritePass 时保持对原有签名的兼容性，或将 test/unit/agent-access-budget.test.ts 显式列入整改与适配范围。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-codex.md:58` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：元数据加入敏感保护的配置归属表述前后矛盾，且可能引发 BRIEF 禁读告警副作用。

**依据**：计划第58行称‘用受支持的项目本机配置将本轮这四类元数据加入敏感保护...敏感规则变更也纳入代码审查’。但依据 src/trivium/config.ts:4-5，本机配置 config.local.yaml 不进 Git 无法纳入代码审查；且依据 src/trivium/freeze.ts:376 与 src/trivium/brief.ts:600-675，进入 sensitive_globs 的路径会被 BRIEF 标为 sensitive 禁读告警，这与‘代码审只读冻结副本’产生冲突。

**建议**：厘清敏感保护规则的配置落点（config.yaml 还是仅本地忽略规则），并评估加入 sensitive_globs 对代码审查阶段 BRIEF 生成及读取审计副本造成的告警副作用。

## 认为正确的部分

- 计划严格坚持 Driver 护栏纪律，明确要求在计划审查、逐条裁决和 gate --check 后使用 gate --await-approval 停点，坚决不自行 approve，也不借用旧审批。
- 对写负对照的可测试性保持严谨定性，明确指出不能把注册 Write 权限诊断、本地模拟返回或文件未生成偷换为原标准通过，未批准前不擅自修改判据。
- 预算机制坚持独立台账，先 O_EXCL 预占且不回收，失败、超时、help 和 version 均计入启动数，符合严格的预算追踪规范。
- 对 Claude 2.1.296 和 Codex 0.162.1 底层版本升级保持审慎，拒绝将旧版本的探针与能力结论直接沿用。
- 明确在正式审查期间只执行 --wait，不生成能力臂、不修改业务文件，有效防止工作树快照漂移。

## 未覆盖范围（本侧盲区）

- 由于本审查员无执行命令权限，未能实测 scripts/agent-access-budget.cjs 在高频并发 spawn 下的真实计数开销与锁行为。
- 未能实际调用各厂商 CLI 验证 2.1.296 与 0.162.1 底层在 macOS 真实环境下的行为差异。
- 未能实测受控传输臂在 restricted 模式下的拦截效果，其可行性推论仅基于代码逻辑与任务书描述。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `scripts/agent-access-evidence.mjs`
- `test/unit/agent-access-budget.test.ts`
- `scripts/agent-access-budget-preload.cjs`
- `scripts/agent-access-budget.cjs`
- `src/trivium/util/git.ts`
- `src/trivium/config.ts`
- `src/install.ts`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-codex.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":16,"grep":4,"glob":0,"run_command":0,"project_reads":16}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
