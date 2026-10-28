---
schema: trivium.review.v2
topic: KimiCode-macOS规则根因与只读准入修复
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.4.8
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261027T174141Z
rerun_index: 1
snapshot_hash: sha256:7cf25a0ee5780e32808af123feb4fb1174555845c47dc7707218add3787c2c78
blind: true
started_at: 2026-10-27T17:41:49.418Z
finished_at: 2026-10-27T17:48:56.404Z
duration_s: 427
tool_calls:
  read: 25
  grep: 5
  glob: 2
  run_command: 0
  project_reads: 21
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 3
  minor: 3
  nit: 0
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
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
override_reason: 左侧模型信息缺失
session_id: 68dcda8c-9dd4-444e-ad80-424a68ecdec7
---

# 计划审查：KimiCode-macOS规则根因与只读准入修复

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261027T174141Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本计划总体方向正确，严格坚持单因素正反对照、不以假通过兜底、保留历史反例与凭据安全边界。但在关键实验设计上存在三处主要缺口：一是权限规则单因素矩阵缺少针对普通文件的正向生效哨兵（Positive Control）及配置表/模式语法变异对照，若全局失效将无法隔离语法错误；二是非交互模式（-p）下无 TTY 导致 manual 权限模式隐式回退或自动放行的假设与探查规划不足；三是受控本地服务（Mock）与生产准入证据的界限未完全闭环，需严禁将非真实模型调用作为生产准入依据。按意见修订实验矩阵与判定闭环后，整体方案可直接指导实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 6 条：重要 3 ｜ 次要 3）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：单因素实验矩阵缺少规则引擎敏感度的正向生效哨兵（Positive Enforcement Control）以及配置表结构与模式语法的细分对照，若所有 deny 均失效将无法区分是规则引擎未加载还是模式语法失配。

**依据**：查阅 .reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md §4 表格中，规则匹配因素仅列出「无规则/全工具 deny/精确路径 deny」，并未设计针对正常文件（如普通 文件.txt）的主动 deny 哨兵臂；且对照既有证据 doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-38-09-575Z-4578e9a0.json 与 scripts/acceptance/kimi-qoder-cn/probe.mjs，历史 6 种规则形态全数泄漏同行 canary，原因可能涵盖表结构名（[permission] vs [[permission.rules]] vs [permissions]）、工具名大小写（Read vs read）、或路径带空格模式未加引号等。若不设置能让原本成功的普通读取变为拦截的正向生效对照，将无法判断规则引擎是否处于完全脱敏或静默忽略状态。

**建议**：在 §4 矩阵中增设规则引擎生效基准对照：配置对普通文件（如普通 文件.txt）显式 deny，验证规则能否真正拦截读操作；同时补齐配置表层级、工具大小写及含空格路径括号内带引号的语法变异单因素测试。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2, §4` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：对非交互模式（-p）下权限模式回退与 TTY 依赖的单因素控制规划不足，缺少对 CLI 权限参数与 headless 下 default_permission_mode 实际行为的针对性验证设计。

**依据**：查阅 .reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md §4，非交互模式仅表述为「尽可能同配置工具面下对比 headless 与官方交互/API 模式；若官方不能固定同输入，记录混杂变量及未测」。对照 scripts/acceptance/kimi-qoder-cn/probe.mjs 第 130 行设置 default_permission_mode = "manual"，而在 headless (-p) 无 TTY 环境下，CLI 可能因无法弹窗询问而隐式 fallback 为自动放行（fail-open）以防进程挂起，或绕过静态 deny；且计划未对 CLI 命令行参数中的权限控制旗标（如 --permission-mode）做探查设计。

**建议**：在 §2 与 §4 中将「headless 下的权限模式」明确列为独立自变量，针对不同 default_permission_mode（如 manual / auto / 其它官方支持模式）及可能的 CLI 命令行权限标志进行单因素正反对照，并测试无 TTY（stdin 重定向）下的权限决策分支。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3, §5, §6` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：受控本地模型服务（Mock）与生产准入证据的界限未在准入分支中形成硬性闭环，未明确声明本地 Mock 产生的拒绝证据不得作为生产 TraceCapability 与审核者准入依据。

**依据**：查阅 .reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md §3 虽指出「如使用本地服务仅替代模型响应，必须明示其为受控机制实验，不能伪称真实模型推理或生产路线证据」，但 §5 中对于裁剪臂触发禁用工具要求「官方 dispatcher 返回不可用/拒绝」，并在 §6 中允许据此修复。对照任务书焦点「不得把未调用工具或 CLI 退出 0 作为安全准入证据」及 doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md §1 中的原则，受控本地服务仅能作为定位执行层机制的诊断工具，若真实官方模型路线因工具未调用而无法取得执行层拒绝，必须判定为未测/阻塞，不可用受控 Mock 证据替代生产准入。

**建议**：在 §3、§5 与 §6 中明确硬性契约：受控本地服务仅用于验证 Kimi CLI 内部机制是否存在拦截能力；若真实官方模型无法在裁剪臂触发禁用工具调用，该项在生产准入矩阵中必须保持为未测/阻塞，严禁据此填写生产 TraceCapability 或启用审核者。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：项目 Hook/MCP/插件注入隔离实验缺乏具体的拓扑结构、配置隔离项及执行检测判据定义。

**依据**：查阅 .reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md §5 仅用三句话概括配置合成项目 Hook/MCP/插件/skills 注入哨兵，但对照 src/trivium/agents/registry.ts 第 417 行（entrySkillExtraReadRoots: ['.agents/skills']）及 scripts/acceptance/kimi-qoder-cn/probe.mjs 第 130 行（merge_all_available_skills = false、--skills-dir），计划未指明哨兵的具体注入路径（项目级 .kimi/hooks、.kimi/mcp.json、~/.agents/skills 等），亦未明确隔离臂的具体生效参数与哨兵执行/发现的判定方法。

**建议**：在 §5 中细化扩展隔离实验的拓扑定义：明确被测路径清单（项目级 hooks、mcp 配置、skills 目录及共享读取面），给出对照的 CLI 参数与配置键，并明确定义哨兵执行与发现的无害探测手段（如 canary 触碰与 stream-json 事件回读）。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4, §7` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：Glob 名称泄漏判定与含中文空格路径的模式转义未在实验输出校验中建立精确断言机制。

**依据**：查阅 .reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md §4 提出「Glob 的名字泄漏也属失败，不能只按内容 canary 判断」，§7 也列入实验判定测试；但对照既有实现 scripts/acceptance/kimi-qoder-cn/probe.mjs 第 182-186 行，历史判定仅依赖 observed.peer_canary（文件内容 Canary），Glob 枚举出的文件路径本身在历史脚本中并未被视作失败。此外，针对含空格与中文的路径，规则模式语法（如 Read(/path/中文 空格/file)）是否需要引号转义亦未纳入断言设计。

**建议**：在 §4 与 §7 中明确断言规则：Glob 与 Grep 的输出事件必须结构化解析匹配到的路径清单，命中受保护文件名即判失败；同时针对含中文空格路径补充引号包裹（quoted）与裸路径（unquoted）两种模式语法的对比与校验断言。

### AGY-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1, §6` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：未明确锁定生产注册表开关（criticEnabled/driverEnabled）在当前主题范围内的冻结状态，需消除仅凭 macOS CLI 局部修复即开启生产开关的歧义。

**依据**：查阅 .reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md §1 明确「本次不扩展 Qoder、桌面、插件或 Windows 的产品接入」，但 §6 中表述为「未经本轮完整证据不新增生产适配器、不填写未经实测的 TraceCapability、不启用 Driver 或审核者」。对照 doc/05_testing/CASE_KimiCode与QoderCN双平台验收.md 及 src/trivium/agents/registry.ts，完整的生产审核与 Driver 准入必须覆盖跨平台双系统及多客户端形态；本主题定位为根因定位与 macOS 修复，无论实验结果如何，均不应在生产注册表解冻开关。

**建议**：在 §1 与 §6 中明确固化结论：本主题即使完全修复 macOS CLI 只读规则并取得合格正反证据，生产注册表 src/trivium/agents/registry.ts 中的 criticEnabled 与 driverEnabled 仍保持 false，仅生成正式实验报告并更新验收矩阵，后续全平台全客户端准入留待对应批次执行。

## 认为正确的部分

- 坚持保留既有失败证据、旧反例与历史工件，不覆盖或改写历史测试样本。
- 坚决杜绝把 doctor 成功、提示词只读、未发起工具调用或 CLI 退出码 0 作为只读准入证据。
- 单因素正反对照思路方向明确，覆盖了配置来源、路径形态与非交互模式等关键维度。
- 在凭据隔离上保持严格约束，采用 0700 临时根、0600 凭据副本与 wx 防覆盖，且不改动用户全局配置。
- 在进程生命周期管理上坚持拒绝单用 kill(pid, 0)，要求结合 PID/lstart 与后代枚举进行确认。

## 未覆盖范围（本侧盲区）

- 本次未在真实 macOS 系统上执行命令或实际运行 Kimi Code CLI 二进制与受控探针脚本（受审查员只读与无执行命令权限约束，所有判断均基于静态代码与既有留痕证据推理）。
- 未覆盖 Windows 平台（PowerShell/Git Bash）及 Kimi Code 桌面端、VS Code 插件 Extension Host 的实际行为验证（符合本主题既定范围约束）。
- 未逆向分析 Kimi Code CLI 内部实现的二进制机器码或混淆代码。

## 实际查阅的项目文件

- `.reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md`
- `.reviews/KimiCode-macOS规则根因与只读准入修复/plan/_meta/brief-gemini-20261027T174141Z.md`
- `.reviews/KimiCode-macOS规则根因与只读准入修复/task.json`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md`
- `doc/05_testing/CASE_KimiCode与QoderCN双平台验收.md`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `scripts/acceptance/kimi-qoder-cn/probe.mjs`
- `scripts/acceptance/kimi-qoder-cn/windows.ps1`
- `scripts/acceptance/kimi-qoder-cn/git-bash.sh`
- `src/trivium/agents/registry.ts`
- `test/unit/deny-matrix.test.ts`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-36-56-546Z-4ec2d7e1.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-38-09-575Z-4578e9a0.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027/kimi-deny-2026-10-26T18-19-55-543Z-71cf3702.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":25,"grep":5,"glob":2,"run_command":0,"project_reads":21}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
