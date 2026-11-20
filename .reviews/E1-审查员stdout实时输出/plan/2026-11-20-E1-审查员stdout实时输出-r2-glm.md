---
schema: trivium.review.v2
topic: E1-审查员stdout实时输出
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.17.3
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
effort_requested: null
effort_effective: null
effort_effective_source: null
tier: null
tier_source: legacy
model_route: config_copy
run_id: 20261120T031519Z
rerun_index: 2
snapshot_hash: sha256:a088b439ae58f09317a7474872e5885e757ab80abcdf0137ea61b55099b9fb8b
blind: true
started_at: 2026-11-20T03:15:28.381Z
finished_at: 2026-11-20T03:35:06.826Z
duration_s: 678
tool_calls:
  read: 8
  grep: 13
  glob: 2
  run_command: 0
  project_reads: 18
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 2
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
  launcher_requested: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  launcher_effective: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: glm
    status: unknown
    left_model: null
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: glm
    right: gemini
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: gemini-4-neon-high
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / gemini
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: qwen4-max
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / qwen
override_reason: 左侧模型信息缺失
session_id: sess_42210c36-0f10-40b5-9187-5e0694ee3b09
---

# 计划审查：E1-审查员stdout实时输出

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261120T031519Z` ｜ 第 2 轮
> ｜ 本轮审核者 glm、gemini、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

被审计划文本与本侧上一轮所审为同一快照（哈希一致，属降级轮重跑），本轮对现状陈述重新逐点核实全部属实：runner.ts 的 runOneSide 尝试循环与每次尝试后强制 scrubSideDir（runner.ts:179-199）、exec.ts 的 setEncoding/PTY 规整/appendOut 32MiB 截断/onStdoutLine 丢空行（exec.ts:103、596-615）、claude 返回前逐值替换再模式脱敏（claude.ts:563-566、585-588）、codex/agy 原文一次性落盘且解析走内存缓冲（codex.ts:785-786、agy.ts:426-427）、zcode stdout.json（zcode.ts:1342）、statusWatch 去抖尾部窗口与 cockpit onLog→pushRuns（statusWatch.ts:118-124、214-220、cockpit.ts:1424）均与代码一致，「先写后抹窗口」判断成立，写前脱敏方向正确；范围与 11 月 5 日插件计划 G3/§6.4 的 E1 定义一致，验收与性能判定方法可复算。两条重要意见：其一（上轮已提、计划未改故仍成立）E1 的 attempt 改名文件落在事后脱敏兜底的固定名清单之外，防御纵深缺口未做决定；其二为本侧镜头新增：持续慢盘下高水位暂停会拖到该侧被既有超时链杀掉，E1 诱发的 I/O 停滞将改变审查结局，与计划自身「禁止以 E1 I/O 故障改票」相抵触，且慢盘用例通过判据未定义。另有三条次要：状态记录契约归属未定、冻结性能口径中「计划采样标记缺失数 0」的分母未钉死、Windows 立场缺失。补齐这些决策后即可实施，无需再审一轮。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 5 条：重要 2 ｜ 次要 3）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划「核心 3」（写入沿用 stdout.json/jsonl、重试前按 attempt 改名、处理 stashVoidedOutput 搬迁）与「验收与证据」终态哈希核对` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：事后脱敏兜底的扫描面只认固定文件名：scrub.ts:77 的 ORCHESTRATOR_LOG_FILES 仅含 stdout.jsonl/stdout.json/trace.json/rollout.jsonl；scrubSideDir 按「侧目录层 + out/ 层」的固定名扫描（scrub.ts:393-397）；redactVoidedAttempts 在 voided/<侧>/attempt-n/ 内同样只扫这四个固定名（scrub.ts:505-528，其中 522 行）。E1 引入每次尝试专属文件身份、重试前按 attempt 改名后，改名文件与搬进 voided 的带 attempt 后缀文件不匹配任何一层清单，事后 scrub 兜底对这类文件静默失效。review.ts:2526-2538 的注释明确写着「三家适配器写进 out/ 的都是固定文件名，删不掉时重跑的同名输出也会覆盖它们」——该固定名不变量正是 E1 改名方案要打破的前提，兜底扫描面却未随之扩展。这层兜底是流式脱敏漏过某形态时的最后防线；计划仅以「scrub 审计计数需回归核对」带过，未决定改名文件是否进扫描集，也未让终态哈希核对覆盖各次 attempt 的文件。

**依据**：src/trivium/scrub.ts:77（固定四名）、393-397（sideDir+out 两层固定名扫描）、505-528（voided 目录内仍按固定名，522 行）；src/trivium/review.ts:2526-2538（stashVoidedOutput 整目录搬迁与固定文件名注释）；src/trivium/runner.ts:199（每次尝试后 force scrubSideDir）；被审计划「核心 3」。

**建议**：在「核心 3」明确取舍：要么让 attempt 改名文件（含 voided 内的）进入由写入点同源派生的事后扫描集（与 ORCHESTRATOR_LOG_FILES 由适配器落盘契约对账的既有纪律一致），要么明示流式脱敏等价性（分割点穷举性质测试）为唯一防线、固定名兜底不再覆盖历史 attempt 文件，并把「终态以预期脱敏数据的完整字节、顺序和哈希核对」显式扩展到各次 attempt 的文件。

### GLM-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划「核心 4」（256 KiB 高水位暂停 child.stdout、磁盘阻塞可观测、「禁止以 E1 I/O 故障改票」）与「验收与证据」慢盘用例` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：背压策略只定义了两个端点：写失败时停用展示并排空管道让原审查继续；磁盘阻塞时暂停 child.stdout 等队列降到 64 KiB。两个端点之间没有升级规则：磁盘持续缓慢（既不报错也排不干）时队列长期停在高位、子进程 stdout 写阻塞、该侧停摆，最终由既有超时链（runner.ts:181 的 req.timeout_s 上限与 exec.ts 的 hardTimer、SIGTERM→宽限→SIGKILL）杀掉，走失败/重试/证据不足路径——这正是 E1 诱发的 I/O 停滞改变审查结局，与计划自身「禁止以 E1 I/O 故障改票」相抵触。同时「验收与证据」把慢盘列入逐项实测，却未定义慢盘用例的通过判据（审查照常完成且展示标注未确认完整，还是允许超时重试）。按现计划实现后，慢盘行为只是「可观测的副作用」而非「受控的降级」，返工点在写入器流控结构。

**依据**：被审计划「核心 4」「验收与证据」；src/trivium/runner.ts:181（每次尝试的 timeout_s 上限）；src/trivium/util/exec.ts:463-464、593-594（killGraceMs 与 hardTimer 终止链）。

**建议**：为流控补一条升级规则并钉死慢盘判据：暂停持续超过某预算（或队列排干速率低于某下限）即按写失败处理——停用该次展示、排空管道、记录未确认完整，原审查按正常节奏继续；慢盘用例的通过条件写明为「审查照常完成、展示降级且如实标注」，超时不算通过。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划「核心 3」能力/状态记录 与「交付」段` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：每次尝试派发前发布的能力/状态记录（格式版本、尝试号、受支持文件名、状态）是核心写、插件读的跨进程机器可读契约，计划未决定其形状治理归属：是否进 skills/dual-critic/schema/ 并联动 parse/gate/meta 校验与 registry-parity 的 schema 目录扫描，是否回补 doc/03_api/PROTOCOL_dual_critic_relay.md 与 SKILL.md。「交付」段只列中文手册、设计文档、验收报告与 doc/05_testing/README.md 的同步，AGENTS.md 改动同步清单「JSON Schema（含新增一份）」一行的义务未被点名；跨进程契约不登记同步义务，后续任一侧单边改格式不会被发现。

**依据**：被审计划「核心 3」「交付」段；AGENTS.md「改动同步清单」JSON Schema 行；doc/02_design/README.md 对 PROTOCOL_dual_critic_relay.md 对外契约定位的描述（LLD 分工段）。

**建议**：在交付段为该记录补一句契约归属：或登记进机读契约目录并列入对应同步清单，或声明其属核心内部面、格式仅记入设计文档并说明不进 schema 目录的理由。

### GLM-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划「性能目标与判定」可见延迟门槛行` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：「计划采样标记缺失数 0」这一硬门槛与同段「保留原始值、五轮中位数、缺失/被尾窗淘汰数量」的记账口径之间没有界定分母：被尾窗淘汰的标记算不算缺失、可见延迟标记规划在哪些轮（持续大量输出组 16 KiB/20 ms 批次下，单行标记可在采样间隙被顶出可视区，还是只在小批标记观测轮采样）均未钉死。该段标题即「编码前冻结」，口径不先钉死，达标与否留下事后解释空间，验收可能陷入对账争议。

**依据**：被审计划「性能目标与判定」（缺失/被尾窗淘汰数量、计划采样标记缺失数 0、跟随尾部与小批标记观测等句；负载定义 512 次 × 16 KiB、间隔 20 ms）。

**建议**：冻结前写明标记观测协议：哪些轮携带延迟标记、Webview 内探针的观测频率、尾窗淘汰是计为缺失还是记数后从分母剔除，并给该剔除计数自身设上限。

### GLM-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划全文（核心 3/4 与插件 1 的文件身份、改名轮转、0600、监听）` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：本仓核心明确支持 Windows 原生且 macOS/Windows 同套代码，平台差异既定落点是 src/trivium/util/platform.ts。E1 引入的目录监听、attempt 改名轮转、0600 权限、短写处理都有平台语义差异，计划通篇未写 E1 在 Windows 的支持或暂缓立场，也未把差异归入改动位置；实现若默认按 macOS 语义写，Windows 侧测试与用户将踩未声明行为。

**依据**：README.md（1.3.0 起 macOS 与 Windows 同套代码、Windows 硬前置 Git for Windows）；src/trivium/util/platform.ts 存在且为既定平台差异落点（AGENTS.md 项目概览）；被审计划全文无 Windows 表述。

**建议**：在计划中写明 E1 的 Windows 立场：本阶段仅 macOS 验收则声明暂缓并列进 Bug 清单，或实现时把平台差异收敛到 platform.ts 对应层。

## 认为正确的部分

- 现状陈述与代码逐点相符：runOneSide 尝试循环与每次尝试后强制 scrubSideDir（runner.ts:179-199）、appendOut 按 32MiB 字符上限截断与 onStdoutLine 丢弃空行和换行符（exec.ts:103、596-611）、setEncoding 与 BSD PTY 规整（exec.ts:613-615）、claude 返回前逐值替换再模式脱敏（claude.ts:563-566、585-588）、codex/agy 原文一次性落盘（codex.ts:785、agy.ts:426-427）、zcode stdout.json（zcode.ts:1342）、statusWatch 300ms 去抖按尾部窗口重读 worker.log（statusWatch.ts:118-124、214-220）、cockpit onLog→pushRuns（cockpit.ts:1424）均核实无误，「先写后抹窗口」的判断成立。
- codex/agy 的解析走内存缓冲而非磁盘文件（codex.ts:785-786 parseCodexEvents(out.stdout)），「解析器仍接收其现有边界的结果、不以展示日志作判定输入」这一前提可实现。
- 写前脱敏、只提交已确定安全的前缀、以完成的记录与可证明安全的分隔符为切点、对照整段脱敏结果做分割点穷举的等价性验证方法方向正确；范围与 11 月 5 日插件计划 G3 与 §6.4 对 E1 的定义一致（该文档 52、233 行）。
- 硬闩锁功能用例（标记磁盘可见→安装态 Webview 可见→才释放退出闩锁，独立断言 PID 存活与时序）正面对应任务目标三.1 的真流式通过条件。
- 性能基线方法论可复算且公平：两份临时测量构建共用输出生成器、不以基线空载作分母、交替运行加预热、五轮中位数与最近秩 P95、交付 bundle 终核，且明确真实 CLI 不用于性能对照。
- 安装态验收记录加载的 runtime bundle 绝对路径与 SHA-256、VSIX 与包内实际安装哈希，正面化解「改完必须重装才生效」的本机已知坑；Phase 4 五万行样本仅作滚动对照的定位与验收报告一致（REPORT_2026-11-19 第 102、116 行）。
- 「写失败停用该次展示、排空管道让原审查继续」「缺少成功封口一律显示未确认完整」「禁止以 E1 I/O 故障改票」的诚实降级与判定保护方向正确（后者的例外见 GLM-02）。
- 旧核心/旧运行降级为「此运行未提供实时 stdout」并保留日志与归档，正面回答任务目标的兼容展示要求；有界队列、隐藏停监控、终态保留尾窗并提供完整已脱敏文件入口对应任务目标二.4 每一条。

## 未覆盖范围（本侧盲区）

- 只读审查：未运行任何构建、测试或性能实测，性能阈值可达性为静态评估，所有需要实测确认的结论均未验证。
- 四家真实厂商 CLI 的 stdout 缓冲行为（是否缓冲到退出才吐出）未验证，计划自身也列为待登记项。
- terminalRelay 的 M1/M3 切换与 E1 交互的代码细节未深读，采信计划陈述与 Phase 4 报告。
- secrets.ts 脱敏规则本身的启发式强度与流式切分的等价性证明不在本侧镜头，仅审了切分结构与兜底覆盖面。
- stub 适配器在 E1 下的文件身份细节未逐行核对，采信能力记录按侧声明文件名的设计。
- 11 月 5 日插件计划仅核对 G3 行与 §6.4 相关行，未读全文；extension/test/e2e 脚本细节未逐行核对。

## 实际查阅的项目文件

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md`
- `src/trivium/runner.ts`
- `src/trivium/review.ts`
- `src/trivium/scrub.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/agy.ts`
- `extension/src/monitor/statusWatch.ts`
- `extension/src/ui/cockpit.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":8,"grep":13,"glob":2,"run_command":0,"project_reads":18}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
