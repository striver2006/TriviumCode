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
run_id: 20261010T135427Z
rerun_index: 2
snapshot_hash: sha256:3bd70b6d87a91e22b2c06f455e03a37aaf48c4f935604c0503437fd1df64c9e8
blind: true
started_at: 2026-10-10T13:54:30.094Z
finished_at: 2026-10-10T14:06:59.172Z
duration_s: 749
tool_calls:
  read: 43
  grep: 13
  glob: 0
  run_command: 0
  project_reads: 19
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 2
  minor: 1
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
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: 1b1ebce6-c80c-4729-966e-71f4073d3ae3
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261010T135427Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm

> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

1. 计划执行顺序存在致命断层：将安装副本重建推迟至验证阶段，导致代码审前生效的仍为旧版 bundle，代码审拉起 claude 时将直接复现 spawn E2BIG 崩溃。
2. 探针负对照臂将 Read/Grep/目录查询共 4 项操作硬塞入单次启动且缺一判 null，模型遇初次拒绝早退后极易判 null，导致规则压缩永久无法开启。
3. 缺少对目录压缩生效时 peer_deny_applied 聚合与单测契约的规范，存在安全报告字段失真与单测断言断裂风险。
4. 目录投影算法未严格限定路径分隔符 / 边界匹配，存在同名前缀误吞潜在隐患。
5. 方案选择按明确禁读目录做子树压缩、保留原始完整 deny_paths 不缩短审计集、并设置三态探针守卫的方向值得肯定，但须修正上述执行顺序与探针设计缺陷后再推进。

**结论**：`request-changes`

## 审查意见（共 4 条：阻断 1 ｜ 重要 2 ｜ 次要 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r4-codex.md:33,161` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划执行步骤存在依赖倒置缺陷：将「重建重装安装副本」推迟至最终 verify 阶段，而 dual-review-code 调用的是已安装运行副本（.trivium/bin/trivium 指向 ~/.claude/skills/.../trivium.cjs）。若在代码审发起前不先执行 npm run build 与本地重装，代码审运行时执行的仍为未压缩旧版 bundle，拉起 claude 审核者时将再次因单 argv 承载 1.68MB 规则复现 spawn E2BIG 崩溃。

**依据**：.trivium/bin/trivium:4 显式执行 ~/.claude/skills/dual-critic/scripts/trivium.cjs 而非工作树源码；AGENTS.md 已知坑明确「改完代码必须重装才生效：npm run build && node dist/install.cjs 两步都做」；而被审计划第 33 行及第 161 行将重建重装推迟至代码审之后的 verify 阶段。

**建议**：在实施计划中明确：在业务代码整改与能力补测完成后、发起 dual-review-code 之前，必须先执行 npm run build 并本地重装至活跃运行环境（node dist/install.cjs），核对安装副本指纹已包含目录压缩逻辑后再发起三家代码审。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r4-codex.md:22-23,29-30` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：探针负对照臂过约束且单次启动设计不切实际：计划要求在单个启动内对完全禁读目录同时发起 Read、嵌套 Read、Grep 以及目录路径查询并全部取得权限拒绝，且「不足均判 null」。真实 CLI 交互中模型遭遇初次权限拒绝后极大概率不再发起后续工具调用，加之 Glob 权限拒绝支持此前从未验证过，单次启动强求 4 项操作几乎必然导致判定落入 null；而计划第 23 行又规定 null 保持原完整规则不开启压缩，导致修复方案陷入死锁无法激活。

**依据**：src/trivium/probes/claude.ts:953-1050 历史经验表明 Read 拦截、Grep 负对照与逐文件形态必须拆分为独立调用臂才能迫使模型发起调用；src/trivium/types.ts:169 明确记录 Glob 至今未验；doc/05_testing/REPORT_2026-10-10_agent_access_closeout.md:15-25 证实模型在工具被拒后常直接停止后续工具调用，单次启动内强求多操作且缺一判 null 极易落入死锁。

**建议**：解耦探针验证项：将目录级 Read/嵌套 Read 拦截与正对照作为核心三态判定臂，将 Grep 与目录路径查询作为独立诊断项或分步独立提示，避免将多项异质工具操作揉入「每臂最大 1 启动」导致模型早退被全盘判为 null。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r4-codex.md:21-23` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：未定义目录压缩启用时 peer_deny_applied 与 CriticResult 的装配契约：现行实现中 peer_deny_applied 仅读取 file_shape_verified，当 99.4% 路径被压缩为目录子树规则后，CLI 拦截依赖的是 directory_deny_verified。计划未说明 buildClaudeResult 中 peer_deny_applied 如何根据 directory_deny_verified 与 file_shape_verified 复合计算，若维持原逻辑则安全汇报字段失真，若修改则缺乏契约规范与配套单测演进设计。

**依据**：src/trivium/adapters/claude.ts:642 明确 peer_deny_applied 绑定 probe.path_deny.file_shape_verified === true；test/unit/claude-adapter.test.ts:459 A14 契约单测严格断言该三态；被审计划第 21-23 行仅提及记录规模与跳过项，未定义 peer_deny_applied 在目录压缩场景下的判定逻辑。

**建议**：在计划中补齐 peer_deny_applied 在目录压缩下的契约定义：明确注入包含目录规则时必须要求 directory_deny_verified === true，对混合规则明确两者的逻辑与判定关系，并同步更新 test/unit/claude-adapter.test.ts 的 A14 契约单测。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r4-codex.md:19` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：目录投影函数的路径归属算法未明确路径分隔符边界规则：第 19 行定义纯目录投影函数认完整禁读目录声明，但未明确匹配被覆盖路径时必须严格以 '/' 为路径段边界。若仅以字符串前缀匹配，会导致同名前缀但不同路径的条目（如 calls_extra）被误判为处于 calls 目录内而被错误收敛。

**依据**：src/trivium/adapters/claude.ts:276-294 及 denyPathRepresentable 说明；被审计划第 19 行仅描述「目录必须实际覆盖本次deny成员；最小祖先归并去重」，未显式界定前缀截断与路径分隔符边界规范。

**建议**：在算法规范中显式约定路径匹配边界判定：候选目录 D 与路径 P 的归属判定必须满足 P === D || P.startsWith(D + '/')，防止无分隔符同名前缀发生误吞。

## 认为正确的部分

- 采纳按配置明确禁读目录进行子树规则压缩的方案③，避免了删除证据缩小禁读集违规或未经等价测试的文件传输风险
- 坚持保持生产 enumerateDenyPaths 完整逐文件输出供 BRIEF 与事后核验，不把 CLI 投影缩短回写为机器集合，保障了审计留痕的完整性
- 严格限制目录候选仅来源于 sensitive_globs 中字面路径且末尾为 /** 的项，明确不压缩包含合法输入的 .reviews 主题根与 audit-snapshots，避免同前缀误伤
- 将子树压缩有效性定义为厂商运行时能力事实，通过三态 directory_deny_verified 探针与当前路线指纹绑定，未核实时诚实报错而非盲目开启
- 严格维持人工审批闸门（gate --await-approval），预算超限采用具名扩展与原子发布，不搞私自放行或替代判据

## 未覆盖范围（本侧盲区）

- 由于审查员只读环境限制，未能在真实环境中执行 claude CLI 验证 Qwen 路线下实际目录 deny 规则的运行时表现
- 未测算高并发或极端长路径场景下 Node spawn argv 的精细内核边界差异（如非 macOS 平台的 ARG_MAX）
- 未复核后续正式代码审查阶段各模型服务端的实时额度与网络延迟状况

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `src/trivium/adapters/claude.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/types.ts`
- `scripts/agent-access-selection.mjs`
- `doc/05_testing/REPORT_2026-10-10_agent_access_closeout.md`
- `src/trivium/freeze.ts`
- `src/trivium/config.ts`
- `src/trivium/adapters/claude-route.ts`
- `src/trivium/probes/fixture.ts`
- `test/unit/agent-access-budget.test.ts`
- `test/unit/claude-adapter.test.ts`
- `package.json`
- `scripts/build.mjs`
- `.trivium/bin/trivium`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r4-codex.md`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/audit-snapshots/settings-options-analysis-7b018aff-9d4f-41a1-bd62-7b6c64acd144.json`
- `skills/dual-critic/schema/run.v3.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":43,"grep":13,"glob":0,"run_command":0,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
