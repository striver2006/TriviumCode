---
schema: trivium.review.v2
topic: E1-审查员stdout实时输出
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.5.13
model_requested: gemini-4-neon-high
model_effective: gemini-4-neon-high
model_effective_source: envelope
effort_requested: null
effort_effective: high
effort_effective_source: envelope
tier: medium
tier_source: profile
run_id: 20261120T031519Z
rerun_index: 2
snapshot_hash: sha256:a088b439ae58f09317a7474872e5885e757ab80abcdf0137ea61b55099b9fb8b
blind: true
started_at: 2026-11-20T03:15:28.381Z
finished_at: 2026-11-20T03:35:06.826Z
duration_s: 286
tool_calls:
  read: 55
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 45
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 6
  minor: 0
  nit: 0
findings_degraded:
  - AGY-08
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
    right_model: gemini-4-neon-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: glm
    right: gemini
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: gemini-4-neon-high
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / gemini
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-4-neon-high
    right_model: qwen4-max
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / qwen
override_reason: 左侧模型信息缺失
session_id: ef4a4086-2f07-427a-90d0-1fbce4504ccc
---

# 计划审查：E1-审查员stdout实时输出

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-4-neon-high` ｜ 请求模型 `gemini-4-neon-high`
> ｜ 运行 `20261120T031519Z` ｜ 第 2 轮
> ｜ 本轮审核者 glm、gemini、claude

> ⚠️ **逐条降级**：本侧有 1 条意见不合 schema，单列在「不合格意见」一节，保留原编号、须逐条裁决，但不参与阻断与共同阻断判定。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划在安全前置脱敏、解析输入隔离、端到端闩锁验收与性能红线前置冻结方面方向正确，但在进入编码前仍有 1 项阻塞级和 6 项主要级的架构与跨模块缺口未定稿：跨进程 E1 状态文件契约（路径、命名、schema 版本归属、0600 原子发布）尚未冻结；未覆盖 orchestrator-logs-parity 契约测试、scrub.ts 改名文件漏扫及 runner→adapter 的 attempt 透传；256 KiB 高水位暂停 child.stdout 在慢盘/阻塞盘场景会反压阻塞子进程直至超时改票；流式脱敏安全后缀上限与 RSS +32 MiB 预算及 secrets.ts 后顾规则冲突；exec.ts 的 treeShutdown 取消路径与 SIGKILL 无法靠核心自行封口；缺少回退开关与 Windows 读时改名兼容性设计；插件侧缺少隐藏/终态排空补读、renderRuns 卡片清空保护以及独立于 open-file 的安全打开契约。建议修订计划定稿这些不可逆边界后再进入编码。

**结论**：不通过（`reject`）

## 审查意见（共 7 条：阻断 1 ｜ 重要 6）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `## 核心 第 3 条；## 插件 第 1、3 条` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：核心与插件之间的跨进程 E1 协议契约未在编码前冻结。计划仅抽象描述“小型能力/状态记录（格式版本、尝试号、受支持的文件名、状态）”“每次尝试专属文件身份”“按 attempt 改名保留”“文件和状态按已验证顺序发布”，未明确以下不可逆细节：(1) 状态文件落盘位置与精确文件名——落于运行根目录会触碰 run-files.ts、run-files-parity.test.ts 及 freeze.ts 禁读边界，落于 <critic>/out/ 会随 stashVoidedOutput 整目录搬迁并触碰 orchestrator-logs-parity.test.ts；(2) 状态机枚举集合、文件身份判据（如 dev/ino 或 nonce）及每轮 attempt 命名规则；(3) 新格式版本是否纳入 extension/src/env/versionCheck.ts 的 SUPPORTED_SCHEMAS——当前 cockpit.ts 对任一 schema 出现 worstVerdict !== 'ok' 即整体降级只读并禁止点火，若未明确将 E1 能力归为单侧降级，跨版本组合会误伤整座驾驶舱；(4) src/trivium/util/fsx.ts 的 writeAtomic 当前未设置 0o600 权限（依赖进程 umask），直接复用无法满足状态文件 0600 要求。

**依据**：src/trivium/run-files.ts（RUN_FILES 固定白名单与 test/unit/run-files-parity.test.ts 双向校验）；src/trivium/review.ts（stashVoidedOutput 整目录搬迁 <critic>/out）；src/trivium/util/fsx.ts（writeAtomic 未传 mode: 0o600）；extension/src/env/versionCheck.ts（SUPPORTED_SCHEMAS 判级）与 extension/src/ui/cockpit.ts（worstVerdict !== 'ok' 触发只读与禁点火）。

**建议**：在修订计划中新增跨进程 E1 文件契约表，明确冻结：状态文件路径与命名、版本号策略及单侧能力降级边界（不触发全局 versionCheck 禁点火）、完整字段与状态枚举、每轮 attempt 的文件身份定义与命名规则，以及显式指定 0o600 的原子发布顺序（先建 0600 输出文件取身份，再 0600 原子写状态文件）。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `## 核心 第 1、3 条` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划未交代核心改动对既有跨模块契约与防漏机制的破坏面：(1) test/contract/orchestrator-logs-parity.test.ts 双向严格对账 scrub.ts 的 ORCHESTRATOR_LOG_FILES 与 adapters/*.ts 中所有 path.join(req.out_dir, '...') 字面量（缺项或死项均打红），把 stdout 写出抽入共用写入器或向 out_dir 新增状态/改名文件会直接破坏该契约测试；(2) scrub.ts 的 redactLogs 与 redactVoidedAttempts 仅按 ORCHESTRATOR_LOG_FILES 固定文件名扫描，瞬态重试若把旧 attempt 的 stdout 改名留在 out/ 下，一旦前次因写失败/异常中断留下未完清扫内容，scrubSideDir 与 voided 清扫将静默漏扫；此外单次 stdout 超过 SCAN_SIZE_CAP（32 MiB）时 scrubSideDir 会记 skipped > 0 导致 complete = false，触发 retention.ts 后续持续告警；(3) runner.ts 的 runOneSide 当前调用 adapter.run(ctx, req) 并未传递 attempt 编号（CriticRequest 无 attempt 字段），计划要求“每次尝试派生前发布尝试号、重试前改名保留”，却未说明 attempt 如何透传至各适配器与 stub.ts 而不破坏既有 CriticRequest 契约。

**依据**：test/contract/orchestrator-logs-parity.test.ts（ORCHESTRATOR_LOG_FILES 与 adapters/*.ts 字面量双向断言）；src/trivium/scrub.ts（ORCHESTRATOR_LOG_FILES、SCAN_SIZE_CAP = 32 MiB、redactLogs 与 redactVoidedAttempts 仅遍历固定文件名）；src/trivium/retention.ts（complete === false 产生未完成清扫提示）；src/trivium/runner.ts（runOneSide 仅在作废重试时调用 stashVoidedOutput，未向 adapter.run 传递 attempt）；src/trivium/adapters/base.ts（CriticRequest 类型定义）。

**建议**：在计划中明确：(1) E1 状态文件与按 attempt 保留文件的落点如何与 ORCHESTRATOR_LOG_FILES、orchestrator-logs-parity.test.ts 及 scrub.ts 协同（包括对改名历史 attempt 文件的兜底扫描和 >32 MiB 流式已脱敏文件的 scrub 处理策略）；(2) attempt 编号从 runner.ts 到各适配器及共用写入器的传递机制（如经 CriticContext/AsyncLocalStorage 传递，保持磁盘 CriticRequest 形状不变）。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `## 核心 第 4 条` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | high |

**问题**：高水位反压暂停 child.stdout 与“禁止以 E1 I/O 故障改票”存在直接并发冲突。计划规定写队列达到 256 KiB 时暂停 child.stdout、降到 64 KiB 恢复；但在 src/trivium/util/exec.ts 中 child.stdout 同时供给解析器缓冲（appendOut）与 E1 写入器。当目标盘阻塞或极慢导致写队列长期滞留 ≥ 256 KiB 时，暂停读取会迅速填满 OS 管道缓冲（或卡住 agy 的 BSD script PTY），导致审查员子进程阻塞在 stdout 写系统调用上直至触发 timeoutMs 被超时杀死——原本仅属展示层的慢盘故障最终把一次正常审查拖成超时改票，违背计划的隔离铁律。

**依据**：src/trivium/util/exec.ts（run 内单一 child.stdout 流同时驱动 appendOut 与退出/超时计时）；src/trivium/adapters/agy.ts（pty_required 时经 BSD script 包装，stdout 读端停滞会反压 PTY）；计划 ## 核心 第 4 条（256 KiB 暂停 child.stdout、慢盘/磁盘阻塞测试、禁止以 E1 I/O 故障改票）。

**建议**：为 E1 反压设定明确的最大阻塞/熔断阈值（例如高水位持续时间或单次 write 超时上限）：一旦超过阈值，立即触发 E1 熔断，停止本次尝试的展示写入、标记状态为阻塞/写失败，并立即调用 child.stdout.resume() 排空管道以保证原审查与解析不受慢盘拖累。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `## 核心 第 2、4 条；## 性能目标与判定（编码前冻结）` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：流式脱敏的“安全后缀”边界存在两处实质缺陷：(1) 内存上限与安全语义冲突——计划称“安全后缀积累达到既有收集上限时记截断或暂缓”，而既有收集上限在 exec.ts 中为 DEFAULT_MAX_BUFFER = 32 MiB；三侧并发时每侧滞留 32 MiB 原文后缀将直接击穿计划冻结的峰值 RSS 红线（基线 + 32 MiB）与核心第 4 条的内存预算，且“截断或暂缓”未明确 fail-closed 原则（严禁冲刷未判定原文）；(2) 与 secrets.ts 既有规则语义存在边界失配——plans 要求不复制规则表并做分割点穷举等价，但 src/trivium/secrets.ts 的 isDeclaredMethodCall 同时前瞻（final|const|let|var）与后顾（.method();），且 generic-secret-assignment 与 toml-bearer-token 使用 \s*[:=]\s* 可跨换行匹配、PEM_REDACT 无长度上限；若在赋值后与 .method(); 之前切块，前缀直接调用 redactSecrets 会误抹合法代码，无法与整段脱敏保持逐字节等价。

**依据**：src/trivium/util/exec.ts（DEFAULT_MAX_BUFFER = 32 * 1024 * 1024）；src/trivium/secrets.ts（isDeclaredMethodCall 同时查看 m.input 前缀与后缀 .method();、PEM_REDACT 无固定长度上限、generic-secret-assignment/toml-bearer-token 含 \s 可跨行）；src/trivium/adapters/claude.ts（gatewayScrubPlan 与 scrubGatewayEnv 替换逻辑）；计划 ## 核心 第 2 条与 ## 性能目标与判定（峰值 RSS ≤ 基线 + 32 MiB）。

**建议**：将安全后缀上限与解析器 32 MiB 收集上限解耦，设定远小的独立硬上限（如 64–256 KiB 级）并明确触顶时的 fail-closed 行为（抑制超长未决片段并写入明确占位/截断标记，绝不裸写原文）；同时在安全切点规则中显式覆盖 isDeclaredMethodCall 的句尾/分号后顾边界、跨行赋值与 PEM 状态，并界定分割点逐字节等价测试仅适用于未触发后缀硬上限的输入（触顶场景单独断言零泄露与截断标记）。

### AGY-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `## 核心 第 3、4 条；## 插件 第 3 条` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | high |

**问题**：计划要求对“超时、中止（取消）、强杀、写入中断”给出不同可观测结果，但未解决核心取消路径与强杀路径下 E1 状态文件无法收尾的问题。当前 src/trivium/util/exec.ts 在收到 worker SIGTERM（由 run-protocol.ts 的 shutdownTrackedTrees 触发取消）时会置 treeShutdown = true 并在 finish() 直接返回、刻意不兑现 run() 的 Promise，因此 adapter.run 不会执行后续 drain 或终态状态落盘；而在 SIGKILL 场景下核心进程更是完全无机会写盘。若未明确核心与插件的状态裁定权威，取消、强杀与写入中断在状态文件上都将表现为“未封口”。

**依据**：src/trivium/util/exec.ts（treeShutdown 分支注释“终止中不兑现”，直接 return 不 resolve）；src/trivium/run-protocol.ts（SIGTERM 处理调用 shutdownTrackedTrees）；计划 ## 核心 第 3、4 条及 ## 插件 第 3 条。

**建议**：明确两处设计：(1) 在 worker SIGTERM / shutdownTrackedTrees 流程中接入轻量的 E1 写入器取消封口钩子（短宽限或同步写入 cancelled 状态并关闭句柄，不拖长取消退出时限）；(2) 冻结插件侧的终态判定权威表——对无封口的 E1 状态文件，结合 status.json 的 phase（cancelled / failed / completed）及 review --status 复核结论区分“取消”“强杀/异常中断”“写入中断”与“超时”，避免仅凭单一文件字段判断。

### AGY-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `## 核心 第 3 条；## 性能目标与判定（编码前冻结）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划缺少不可逆改动的回退/开关路径以及核心跨平台（Windows）兼容性说明。(1) 性能章节写明“任何硬指标未达不宣称可默认开启”，隐含 E1 具备默认开关或关闭回退能力，但计划正文中未设计任何配置键或环境变量开关，无法在异常或性能回归时零改码退回原有收尾落盘路径；(2) 核心编排器本身原生支持 macOS 与 Windows（README.md、src/trivium/util/fsx.ts），计划在核心层要求“重试前把上次文件按 attempt 改名保留”与 0600 权限，但在 Windows 上若外部读端（如插件或安全软件）正持有文件句柄，对在读文件执行 rename 极易遭遇 EBUSY/EPERM（仓库历史已有 EV-260 及 fsx.ts 的 renameOverwriting），且 POSIX 0600 在 Windows 无效。

**依据**：README.md 与 CLAUDE.md（核心原生支持 macOS 与 Windows）；src/trivium/util/fsx.ts（renameOverwriting 处理 Windows EBUSY/EPERM/EACCES，注释引 EV-260）；计划 ## 核心 第 3 条（重试前改名、0600 权限）与 ## 性能目标与判定（“不宣称可默认开启”）。

**建议**：(1) 明确是否提供可控开关（配置项或环境变量）以关闭 E1 实时写入并回退原落盘路径，以及对应的测试与发布策略；若决定无开关则去掉“默认开启”的歧义并说明代码级回退路径；(2) 评估每次 attempt 直接写入不可变独立文件名（由状态记录指向当前 attempt 文件，或仅在末尾维护 raw_stdout_path 兼容）以彻底规避 Windows 读时改名竞态，或明确 Windows 侧走 renameOverwriting 及 0600 权限的平台边界说明。

### AGY-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `## 插件 第 1、2、3 条` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：插件设计漏掉了三处与现有 Cockpit / cockpitHtml / RunWatch 代码的实质冲突：(1) 隐藏与终态排空冲突：extension/src/ui/cockpit.ts 当前以 retainContextWhenHidden: true 建面板且完全未订阅 panel.onDidChangeViewState，而 RunWatch.crossCheck 与 cockpit.ts 的 finalizeEndedRun 会在闸门离开 running 时立即 dispose 监控；若未在解绑前对各侧 E1 状态与 stdout 做一次最终排空补读（final drain）并缓存终态上下文，既会漏读最后一批字节误报“未确认完整”，也无法实现“隐藏期间结束的运行在回到面板时复核并保留最后可见窗口”；同时现有 statusWatch.onRender/onLog 仍会在隐藏期经 pushRuns 发 postMessage，需明确隐藏期静默范围；(2) renderRuns 全量清空冲突：extension/src/ui/cockpitHtml.ts 的 renderRuns() 在每次收到 runs 消息（30s 心跳、worker.log 变化、任一侧完成）都会执行 $('runs').innerHTML = '' 重建卡片，仅让 E1 批次不触发 renderRuns 无法阻止普通 runs 推送清空流式 stdout DOM 与滚动状态；(3) open-file 安全边界缺口：现有 cockpit.ts 的 open-file 处理器直接接受 Webview 传入的任意路径 m['path'] 并打开文档，若“查看完整已脱敏文件的入口”复用该消息，将直接违背计划第 1 条“不得从 Webview 接受任意读取路径”。

**依据**：extension/src/ui/cockpit.ts（createWebviewPanel 带 retainContextWhenHidden: true 且无 onDidChangeViewState；case 'open-file' 直接调 vscode.Uri.file(String(m['path']))；finalizeEndedRun 立即 dispose RunWatch）；extension/src/monitor/statusWatch.ts（crossCheck 终态直接 onFinal 后 dispose）；extension/src/ui/cockpitHtml.ts（renderRuns 执行 $('runs').innerHTML = ''，仅 logView 维护独立 Map 缓存）。

**建议**：在插件设计段补齐三项明确实现边界：(1) 监听 panel.onDidChangeViewState 控制 E1 监控/渲染暂停与恢复补读，并在运行终态解绑前强制执行一次 final drain 且在宿主保留终态 E1 摘要与最后可见窗口；(2) 为每侧 stdout 视图建立类似 logView 的持久化容器/状态缓存（或在 renderRuns 中保留已挂载节点），避免心跳与 worker.log 更新冲刷 DOM 与滚动位；(3) 为“查看完整已脱敏文件”新增独立消息（仅传 workspace/runId/critic/attempt），由宿主结合已校验的 runDir 与 E1 状态做路径边界和 lstat 常规文件复核后再打开。

## 不合格意见（逐条降级，共 1 条）

> 下列意见不合 `trivium.review.v2`：保留原编号、**仍须逐条裁决**（接受要写落点），
> 但**不参与阻断与共同阻断判定**——其中声称 blocker 的，被驳回也不会触发共同阻断告警。

### AGY-08 · 不合格

**不合格之处**：
- `kind`：取值不合法（/kind must be equal to one of the allowed values {"allowedValues":["correctness","security","concurrency","contract","test-gap","maintainability","scope-drift","performance"]}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | minor |
| 位置 | ## 插件 第 1、2 条；## 交付与边界 |
| 类别 | requirement（不合法） ｜ 层次 plan |
| 置信度 | high |

**问题**：两项应在编码前收口的容量与同步清单细节尚未明确：(1) 插件侧每侧 stdout 的“显示窗口 / 有限尾部快照”具体容量上限（字节数或行数，以及是否沿用 extension/package.json 中 trivium.monitor.logTailBytes 的配置模式或独立设置/固定常量）未冻结，而性能与验收条款明确依赖该窗口统计“缺失/被尾窗淘汰数量”及控制 RSS 增量；(2) 交付段仅笼统写“设计文档对应行为”，未按本仓改动同步清单列出具体须同步的协议文档（doc/03_api/PROTOCOL_dual_critic_relay.md）与 doc/02_design/ 下的目标设计文档名，存在收尾漏同步风险。

**依据**：extension/package.json（contributes.configuration 已有 trivium.monitor.logTailBytes，默认 65536）；extension/src/ui/cockpit.ts（logTailBytes() 读取配置）；CLAUDE.md / AGENTS.md 改动同步清单（新增/变更契约须同步 doc/03_api/PROTOCOL_dual_critic_relay.md 与 doc/02_design/ 设计文档）。

**建议**：在计划中冻结插件每侧 stdout 显示尾窗的明确容量上限及是否配置化，并在交付同步清单中显式列出 doc/03_api/PROTOCOL_dual_critic_relay.md 与 doc/02_design/ 下需回补的具体设计文档名。

## 认为正确的部分

- 坚持在写入磁盘与送往界面之前完成脱敏，并将解析器输入与展示日志隔离，从根源避免“先落原文后补抹”的泄露窗口且不扰动既有四家适配器的解析边界与证据判定。
- 复用 util/exec.ts 已有的 UTF-8 跨块解码与 ptyOutputNormalizer 规整能力，并严格限定仅正式审查与指定可控桩启用，不波及 doctor、版本查询等非审查子进程。
- 验收与性能方案严谨：采用真实 Extension Host 与双工作区共享运行根隔离夹具，用退出闩锁证明进程存活期间的磁盘可见与 Webview DOM 真实可见先后顺序，并在编码前冻结基线对照、量化红线及真机/桩分账口径。

## 未覆盖范围（本侧盲区）

- 送审任务书第 8.2 节目录树过长导致末尾“附录：任务目标原文”在输入上下文中被截断，本次仅核对到任务书第 4 节摘要前 200 字及 doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md 的 G3 与 §6.4，未能逐字核对任务目标原文后半段可能存在的额外约束。
- 本次审查全程只读、未运行构建或测试命令，所有结论均基于源码与文档的静态核查与并发/边界推演，而非实测结果。
- 未读取 doc/03_api/PROTOCOL_dual_critic_relay.md、doc/02_design/ 主设计全文及 extension/src/history/*、extension/test/e2e/workbench.mjs，上述文件内的细部约定未逐条核对。

## 实际查阅的项目文件

- `.reviews/E1-审查员stdout实时输出/plan/2026-11-20-E1-审查员stdout实时输出-codex.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/05_testing/README.md`
- `doc/08_project/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `extension/README.md`
- `extension/esbuild.mjs`
- `extension/package.json`
- `extension/scripts/runE2E.mjs`
- `extension/src/cli/triviumCli.ts`
- `extension/src/env/versionCheck.ts`
- `extension/src/extension.ts`
- `extension/src/monitor/runDiscovery.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/monitor/statusModel.ts`
- `extension/src/monitor/statusWatch.ts`
- `extension/src/services.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/test/e2e/workspace.mjs`
- `package.json`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/brief.ts`
- `src/trivium/freeze.ts`
- `src/trivium/retention.ts`
- `src/trivium/review.ts`
- `src/trivium/run-files.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/runner.ts`
- `src/trivium/scrub.ts`
- `src/trivium/secrets.ts`
- `src/trivium/status.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/util/fsx.ts`
- `test/contract/orchestrator-logs-parity.test.ts`
- `test/unit/run-files-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":55,"grep":0,"glob":0,"run_command":0,"project_reads":45}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
