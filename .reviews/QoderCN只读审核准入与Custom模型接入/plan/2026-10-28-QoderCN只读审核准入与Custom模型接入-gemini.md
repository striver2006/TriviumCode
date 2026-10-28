---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
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
run_id: 20261028T022148Z
rerun_index: 1
snapshot_hash: sha256:9104189aeb88f3a7bc31841055d23264f8d3500391ed975b6bf97d48e6c627b1
blind: true
started_at: 2026-10-28T02:21:56.879Z
finished_at: 2026-10-28T02:32:36.039Z
duration_s: 639
tool_calls:
  read: 44
  grep: 15
  glob: 3
  run_command: 0
  project_reads: 30
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 1
  major: 3
  minor: 1
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
session_id: ae94c6ea-54e9-4cd9-b958-a9dc9e6416fe
---

# 计划审查：QoderCN只读审核准入与Custom模型接入

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261028T022148Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本次审查结论为修改后通过（pass-after-changes）。最危险的问题是计划 §1 设想「路径拒绝覆盖该临时根」，但编排器 freeze() 阶段并不包含运行期动态生成的临时目录，且 Qoder CLI 缺少原生路径级拒绝机制，存在模型读工具在运行期读取凭据临时根泄露 API Key 的 Blocker 级风险；此外，带斜杠的 Custom 模型 ID 与现有目录正则冲突、预检目录校验契约未闭环；过度苛求裁剪工具面下的拒绝事件存在准入死锁风险；未设计从 stream-json 提取 read_paths 导致闸门核验必挂；散落拦截违反纪律 10。补齐上述方案后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 5 条：阻断 1 ｜ 重要 3 ｜ 次要 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §1 提出「路径拒绝覆盖该临时根，模型正文不可读取凭据」，但未给出在 Qoder 运行期如何对模型读工具屏蔽该临时根的机制设计。编排器的 deny_paths 是在执行前由 freeze() 从工作树和注册表计算得出的，此时 withQoderHome 尚未创建随机临时目录（/tmp/trivium-cn-route*）；且 Qoder CN 当前仅支持 --tools 裁剪工具面，并不原生支持类似 Claude Code 的路径级拒绝拦截。若临时目录未被裁剪掉的读工具（Read / Grep）访问，存在在运行期间泄露 Custom API Key 的严重安全风险。

**依据**：核对 src/trivium/freeze.ts:16-58，freeze() 仅将仓库内受保护的审查/裁决/元数据路径计入 deny_paths，完全不包含 src/trivium/adapters/qoder-cn-native.ts:25-38 中临时生成的 /tmp/trivium-cn-route* 随机路径。再比对 src/trivium/adapters/qoder-cn.ts:117-133，Qoder CLI 参数中只有 --tools，并无原生路径级访问拒绝旗标。计划 §1 设想「路径拒绝覆盖该临时根」在现有架构下缺乏落地机制支撑。

**建议**：明确隔离凭据目录对模型读工具不可见的具体技术手段：例如将 Qoder CLI 工作目录（cwd）与临时 HOME 物理剥离、通过 --tools 仅允许限定在工作树相对路径的工具、或以只读包装/环境变量等方式注入配置而不在模型读工具可触及的路径落盘明文 key，并在方案中明确其边界，不能假设未实现的「路径拒绝」。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §2 将「明确 Custom 请求语法/配置形状」推迟到实施期，但用户首个真实样本是带斜杠的 bailian/qwen3.8-flash-tp，这与现有 parseQoderCatalog 校验规则存在破坏性冲突，且现行预检体系会将未在官方目录中的自定义模型直接判定为非法而阻断。

**依据**：核对 src/trivium/adapters/qoder-cn-model.ts:14-26，parseQoderCatalog 强制使用正则 /^[A-Za-z0-9][A-Za-z0-9_.-]*$/，包含斜杠（/）将直接抛出异常（在 test/unit/qoder-cn-model.test.ts:25 中有明确单测 throws on invalid model identifier: MODEL\nbailian/x）；同时 src/trivium/preflight.ts:563 的 checkModelSlugs 会对 --model 严格校验 catalogModelsFor(cfg)，而 src/trivium/adapters/qoder-cn-model.ts:64-70 的 qoderModelRequest 亦断言 facts.models.includes(requested.model)。计划仅提及「目录来源不混合」，却未给出 Custom 模型的白名单校验、命名校验放宽规则以及预检绕行机制。

**建议**：在计划中明确 Custom 模型命名规则（支持带供应商前缀的 slug 格式如 bailian/qwen3.8-flash-tp）对 parseQoderCatalog / qoder-cn-model.ts 的改造方案；设计预检层 checkModelSlugs 与 catalogModelsFor 如何区分 official 与 custom 目录来源，避免合法 Custom 模型在预检阶段被直接打红。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §3 要求「工具未暴露而无法触发拒绝的必需项仍未测/阻塞，不冒充拒绝证据」且「没有拒绝事件就不能把 rejectionRecorded 写 true。若轨迹不足以核验同行泄漏或写事件则保持准入阻塞」。这混淆了「通过裁剪工具面（如 --tools Read,Glob,Grep）实现结构化只读」与「运行时拦截非法写操作并产出拒绝事件」的区别，存在导致准入死锁的逻辑漏洞。

**依据**：核对 src/trivium/adapters/qoder-cn.ts:119-122，审核模式通过传入 --tools ${effectiveTools.join(',')} 直接剥离 Write、Edit、Shell 等工具。当工具未暴露给模型时，模型根本无法发出该工具的调用，执行层自然无法产生「工具被拒绝」的事件日志。若计划坚持「必须产生拒绝事件才允许准入」，将导致结构化只读裁剪的载体永远无法满足准入条件。根据 doc/08_project/KimiCode与QoderCN双角色接入实施计划.md §11.1 及 src/trivium/adapters/base.ts:12-19 的 TraceCapability 定义，rejectionRecorded: false 本就是系统合法支持的轨迹分档（如 Codex 模式），不需要强制产生拦截日志。

**建议**：厘清只读准入的判定分档：区分「工具面未暴露危险工具（结构化免疫）」与「工具暴露但被运行时权限策略拦截（产生拒绝事件）」两种不同形态；将 Qoder CN 的只读准入标准锚定在其工具暴露裁剪的有效性上，并将 rejectionRecorded 明确如实声明为 false，避免因无谓苛求拒绝事件而阻塞正常准入。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划将 Qoder 准入为只读审核者（Critic），但未设计如何在审查模式下解析 Qoder 的 stream-json 提取模型实际读取的文件路径（read_paths）及工具调用（tool_calls），这将直接导致双审闸门的证据核验（guard.ts）误报证据不足。

**依据**：核对当前 P2 实现 src/trivium/adapters/qoder-cn.ts:182-184，runQoderCnWorker 直接写死了 tool_calls: [] 与 read_paths: []。根据 src/trivium/guard.ts:285-334，若适配器声明为 tool-trace 能力档（见 AGENTS.md 架构纪律 1），guard.ts 会严格依据 read_paths 与审查产物中的 consulted 进行双向交叉核对；若 read_paths 恒为空，effectiveMinProjectReads 将判定项目阅读数为 0，导致每一轮审查都被 guard 判为证据不足而报红。计划 §3 仅笼统提及「按实际轨迹形成 TraceCapability」，未包含解析 Qoder CLI 输出事件中读工具调用的具体设计。

**建议**：在计划 §3 补充 Qoder CN 审核模式下的事件流解析设计：明确如何从 stream-json（或 Qoder 运行日志）中识别 Read / Grep / Glob 的调用参数，提取相对项目路径填充至 read_paths，或明确依据实测能力将 traceKind 调整为 shell-pipe 并在 registry.ts 中完成能力对齐。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §5 规划「在预检、worker、adapter 三处拒绝不匹配组合」，但在通用预检与通用 worker 中散落厂商特异的组合拦截逻辑违反架构纪律 10（agents/registry.ts 是所有 Agent 差异的唯一来源，通用模块不得出现具体 Agent 硬编码）。

**依据**：核对 AGENTS.md 架构纪律 10：「除它本身与各厂商适配器内部外，任何模块不得出现具体 Agent id / 后缀 / 前缀的字面量——test/unit/registry-parity.test.ts 以 grep 级对账守着，加硬编码直接打红」。若在 src/trivium/preflight.ts 或 src/trivium/run-protocol.ts 中直接硬编码对 qoder-cn 特定平台/模型组合的校验，会被对账单测直接拦截。

**建议**：将特定厂商的准入与组合约束收敛在 src/trivium/adapters/qoder-cn.ts 自身的 availability()、model-routing.ts 的注册表派生接口、或通用配置校验钩子中，通用层仅通过注册表暴露的能力契约（如 criticEnabled 或能力标志）进行无分支判定。

## 认为正确的部分

- 坚持以用户原生 /model 与真实 bailian/qwen3.8-flash-tp 为基线，不在 settings.json 中臆造 BYOK 配置，符合官方规范
- 严格维持 P2 官方模型路由、回退即停（fallback-blocked）及现有单元与集成测试为防退化基准
- 要求真实三审在独立无害夹具中验证，不污染当期生产评议链条，准入前维持生产只读拒绝（criticEnabled 保持关闭）
- 坚持官方模型与自定义模型身份严格消歧，不将请求声明冒充为生效身份，无法确认时回读保持 null/unknown

## 未覆盖范围（本侧盲区）

- 未在真实 macOS/Windows 环境下实际调用 Qoder CLI 执行 /model 向导或验证 bailian/qwen3.8-flash-tp 的真实配置文件格式与字段白名单
- 未验证 Qoder CLI 在包含多个 custom 模型时的 settings/keychain 存储结构及并发隔离稳定性
- 未覆盖 Windows 平台原生执行路径与凭据存储机制（本计划明确因无返回证据列为未测与不可启用）

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-codex.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/ADR_002_multicritic_isolation.md`
- `doc/02_design/README.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `doc/README.md`
- `skills/dual-critic/schema/run.v3.json`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/critics.ts`
- `src/trivium/freeze.ts`
- `src/trivium/guard.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/preflight.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `test/unit/qoder-cn-model.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":44,"grep":15,"glob":3,"run_command":0,"project_reads":30}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
