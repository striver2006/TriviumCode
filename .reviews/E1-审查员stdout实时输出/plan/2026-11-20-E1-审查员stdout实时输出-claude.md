---
schema: trivium.review.v2
topic: E1-审查员stdout实时输出
stage: plan
role: claude
vendor: anthropic
agent_cli: claude/2.1.328
model_requested: qwen4-max
model_effective: qwen4-max
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
run_id: 20261120T025550Z
rerun_index: 1
snapshot_hash: sha256:a088b439ae58f09317a7474872e5885e757ab80abcdf0137ea61b55099b9fb8b
blind: true
started_at: 2026-11-20T02:56:00.606Z
finished_at: 2026-11-20T03:13:56.306Z
duration_s: 1075
tool_calls:
  read: 25
  grep: 23
  glob: 7
  run_command: 0
  project_reads: 36
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 4
  minor: 3
  nit: 0
degraded: true
parse_fallback: false
peer_deny: true
drift: false
heterogeneous: unknown
access:
  requested_mode: profile
  profile: qwen
  launcher_requested: /Users/chenzhenbo/.local/bin/cld
  launcher_effective: /Users/chenzhenbo/.local/bin/cld
  wrapper_sha256: bc21f5228f4214c85678385c6288898b6daaebcba6f485c1a1ce2de7f02f28bf
  configuration_sha256: 5b1c4230c0db1a84419d63ecf7301992ce7a1ac777bed23db945462b78eb6dc8
  provider_declared: qwen
  provider_declared_source: profile
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: claude
    status: unknown
    left_model: null
    right_model: qwen4-max
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: qwen4-max
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / qwen
  - left: gemini
    right: claude
    status: unknown
    left_model: null
    right_model: qwen4-max
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
override_reason: 左侧模型信息缺失
session_id: 8adc688e-e774-40a9-b536-8263c963613a
---

# 计划审查：E1-审查员stdout实时输出

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen4-max` ｜ 请求模型 `qwen4-max`
> ｜ 运行 `20261120T025550Z`
> ｜ 本轮审核者 glm、gemini、claude

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划的现状陈述与仓库逐处核对基本属实，总体方向（写前脱敏、安全前缀、按 attempt 的文件身份、能力记录带文件名、冻结性能口径）可行。最危险的一条：E1 的改名 attempt 文件与新增状态文件落在 ORCHESTRATOR_LOG_FILES 和 orchestrator-logs-parity 契约的论域之外，计划只写「scrub 审计计数需回归核对」，没有决定脱敏论域与机器对账机制——这正是 EV-20 当年修过的失效形态。其次，「禁止以 E1 I/O 故障改票」这条绝对断言与暂停 child.stdout 的背压机制冲突：磁盘阻塞时 CLI 会被堵到超时判失败（超时不重试）；写失败时「停用该次展示」与「只顺序写一次、不重写全量」及 raw_stdout_path 的归档完整性之间的回退契约未决策；安全后缀「记截断或暂缓」是未决二选一，且沿用 32 MiB 收集上限与三侧并发下 RSS+32 MiB 的冻结预算矛盾。另有退出宽限迟到数据、派生失败终态缺失、Windows 边界未声明三条小项。按意见补上这些决策后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 7 条：重要 4 ｜ 次要 3）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §核心 3（重试改名、能力/状态记录）与 §交付` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：E1 引入两类新盘上面：重试前按 attempt 改名保留的旧 stdout 文件、每次尝试的能力/状态记录；且「共用写入器」大概率不在 adapters/ 目录内。scrub.ts 的 ORCHESTRATOR_LOG_FILES 是固定四名清单，redactLogs 与 redactVoidedAttempts 只认这四个名字；orchestrator-logs-parity 契约测试只扫 src/trivium/adapters/*.ts 里 path.join(req.out_dir, '字面量') 的写法。改名文件与共用写入器的写入都落在这两套机制的论域之外：事后脱敏兜底不再覆盖它们，契约测试也不会报错。计划只说「scrub 审计计数需回归核对」，没有决定改名 attempt 文件是否进脱敏论域、状态记录按什么理由豁免、以及写入点与清单之间用什么机器对账（扩清单、扩测试论域或同源派生）。流式脱敏即使与整段等价，事后 scrub 仍是本仓刻意保留的纵深防御层，漏掉它正是 EV-20 登记过的「副本原样躺 30 天」形态。

**依据**：读 src/trivium/scrub.ts:77（ORCHESTRATOR_LOG_FILES 固定清单）、393-397（redactLogs 只扫清单名）、505-529（redactVoidedAttempts 同样只认清单名）；test/contract/orchestrator-logs-parity.test.ts:16-30（论域仅 adapters/*.ts 的 path.join(req.out_dir, 字面量)，豁免需逐条写理由）；scrub.ts 文件头「适配器往 req.out_dir 写的每一份原始日志都必须在这里（契约测试对账）」；AGENTS.md 纪律 11/12 与 run-files.ts 文件头「靠记性的纪律要换成不依赖记性的机制」。被审计划 §核心 3 只写改名保留与审计计数回归核对。

**建议**：在计划里明确决定：改名 attempt 文件与状态记录各自进 scrub 论域还是具名豁免（豁免要写理由，照 EXEMPT 形态）；共用写入器的文件名与 ORCHESTRATOR_LOG_FILES、能力记录的「受支持的文件名」之间建立单一来源或机器对账（扩 orchestrator-logs-parity 的扫描论域或同源派生），并把该契约测试列入交付的回归面。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §核心 4（256 KiB 暂停 child.stdout、「禁止以 E1 I/O 故障改票」）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：「禁止以 E1 I/O 故障改票」写成无例外断言，但机制本身能违反它：E1 写队列满时暂停 child.stdout，而 appendOut/onStdoutLine 与 E1 接收器共用同一条流——暂停同时饿死解析器输入并对 CLI 形成管道背压。磁盘阻塞（不是错误，计划对「永久错误」有停用排空规则，对「阻塞」没有）时队列永不降水位，CLI 被堵到 timeoutMs 触发 SIGTERM→SIGKILL，该侧判 timeout；runner 的 isTransientFailure 明确超时不重试，侧结果直接改变，strict 策略下整轮受影响。计划需要给暂停一个有界规则（最长暂停时长或慢盘检测后停用 E1、恢复排空），或把断言就地写明例外与降级路径，否则慢盘用例实测出的正是「E1 I/O 故障改了票」。

**依据**：读 src/trivium/util/exec.ts:596-615（appendOut 与 data 监听同流）、686-692（超时链）；src/trivium/runner.ts:21-23（timeout 不判瞬时、不重试）；被审计划 §核心 4 同时写了「256 KiB 高水位时暂停 child.stdout，降到 64 KiB 恢复」「磁盘阻塞……须有不同可观测结果」「禁止以 E1 I/O 故障改票」，但没有暂停上限或阻塞降级决策。背压致 CLI 停写是管道语义的结构推理，未实测。

**建议**：为暂停补一条有界决策：例如暂停超过某阈值即停用该次 E1 展示、resume 并排空管道让原审查按原节奏跑完；或明确慢盘检测判据与降级动作。把「禁止改票」的成立条件（含降级路径）写进计划，并让慢盘用例断言侧结果不受 E1 影响。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §核心 3/4（「输出只顺序写一次」「run 结束时不重写全量」「写失败停用该次展示」）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：写失败后的最终文件契约未决策，三条条款互相打架：若流式写入中途永久失败，「停用该次展示、排空管道让原审查继续」之后，适配器手里的完整 out.stdout 还写不写？不写，则 raw_stdout_path 指向半截文件，任务书完成条件「最终内容与原归档语义一致」被破坏（今天 codex 等适配器在 run 返回后一次性写全量 scrubbed stdout，失败/超时也写）；写，则与「输出只顺序写一次」「run 结束时不重写全量」冲突，除非把这两条就地限定为 E1 成功路径。计划还需说明回退时封口标记、文件身份与状态记录如何表达「本次展示失败但归档完整」，插件侧「缺少成功封口一律显示未确认完整」才不会把一份完整的归档文件误报成不完整。

**依据**：读 src/trivium/adapters/codex.ts:785（await fs.writeFile(stdoutPath, out.stdout) 在 invoke 返回后无条件执行，超时/失败分支同样带 rawStdoutPath）；src/trivium/types.ts:2161（raw_stdout_path 为 CriticResult 必填）；被审计划 §核心 3/4 的三条原文；任务目标原文第五节「最终内容与原归档语义一致」是完成条件。

**建议**：在计划里明确写失败回退契约：建议把「只写一次/不重写全量」限定为 E1 成功路径，写失败时回退既有的一次性全量落盘并更新状态记录为「展示失败、归档完整」，同时规定该格的文件身份/封口语义与插件展示文案；或选择别的方案，但必须把三条条款的适用范围 reconciled 写明。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §核心 2（「安全后缀积累达到既有收集上限时记截断或暂缓」）与 §性能目标（峰值 RSS ≤ 基线 + 32 MiB）` |
| 类别 | performance ｜ 层次 plan |
| 置信度 | medium |

**问题**：两处未决/矛盾：其一，「记截断或暂缓」是二选一未决策——截断意味着展示/文件与整段脱敏结果分叉（分割点穷举等价测试的前提被破坏），暂缓意味着继续持有、内存无上界；插件 §3 又要求「UI 截尾与文件截断分别标注」，两种选择的界面语义不同，必须先定。其二，「既有收集上限」是 exec.ts 的 DEFAULT_MAX_BUFFER = 32 MiB（按 JS 字符串长度计），三侧并发各自最坏持有 32 MiB 安全后缀即 +96 MiB，直接击穿同一份计划冻结的「峰值 RSS ≤ 基线 + 32 MiB」；性能负载（每侧约 8 MiB）走不到这格，冻结预算与允许的行为不一致。「内存预算再计一次 Node 管道块和安全后缀」也没有给出具体口径。

**依据**：读 src/trivium/util/exec.ts:103（DEFAULT_MAX_BUFFER = 32 * 1024 * 1024）、597-599（按 stdout.length 字符串长度比较）；grep 确认四个审查适配器均未传 maxBufferBytes（只有 verify.ts:136 传 4 MiB），审查侧用缺省 32 MiB；被审计划 §核心 2、§核心 4、§性能目标第二条、§插件 3 的原文对照。最坏后缀规模是结构推理（需要无安全切点的 pathological 输入），未实测。

**建议**：先裁定「截断」还是「暂缓」及其界面/文件语义；再为安全后缀单独定一个与 RSS 预算相容的上限（例如远小于 32 MiB 的每侧后缀预算，超限即按已裁定的语义处置并提示），不要把解析器的收集上限直接复用为后缀上限；把该上限写进冻结的性能口径。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §现状（「close 或退出宽限到期才返回」）与 §核心 3/4（封口、drain）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：run() 有一条 exit+2s 兜底收尾路径：子进程已退出但孙进程继承着 stdout 管道时，close 永不触发，finish 按已收到的输出提前兑现，而 data 监听仍挂着、迟到数据还会继续 appendOut。计划把「退出宽限到期」写进了现状，却没有决定 E1 在这条路径上的封口/停收时机：若在 run 返回时封口，迟到数据要么丢（与解析器输入边界一致，可接受但要写明）要么继续写（违反「只顺序写一次」与封口哈希）；若当时 child.stdout 正处于 E1 暂停态，还要决定恢复/释放。这是「超时、中止、强杀」枚举之外漏掉的一格。

**依据**：读 src/trivium/util/exec.ts:659-668（child.on('exit') 挂 2s exitTimer 兜底 finish，注释明说孙进程持管道时 close 永不触发）、596-615（finish 后 data 监听未移除）；被审计划 §核心 4 的故障枚举未含此格。

**建议**：在计划里补一句决策：E1 接收器以 run 兑现（含 exit 宽限兜底）为停收/封口边界，迟到数据不再进展示文件，与解析器输入同边界；并规定该路径上暂停态的恢复与监听释放。

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §核心 3（派生前发布能力/状态记录）与 §插件 3（状态文案枚举）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：状态机缺「未派生/早失败」终态。能力记录在派生前发布，但存在大量根本不派生的出口：run() 的 cmd 垫片元字符拒绝、Windows pty 拒绝、doctor 中止合成结果、启动预算耗尽，以及适配器在 run() 之前的失败（未探测、入口缺失、准备隔离副本失败）。这些格子之后该次尝试不会有 stdout，计划的界面状态枚举（等待输出/缺能力记录/状态不可读/写入中断/取消/超时）没有对应终态，插件可能永远停在「等待该侧输出」。

**依据**：读 src/trivium/util/exec.ts:439-446（aborted 合成结果）、497-527（cmd 垫片与 Windows pty 拒绝，spawned:false）、447-458（LaunchBudgetExceeded）；src/trivium/adapters/codex.ts:727-761（探测缺失/准备副本失败在 run() 之前返回）；被审计划 §插件 3 的状态枚举。

**建议**：给能力/状态记录的状态集补一个「本次尝试未产生输出（未派生/早失败）」终态，规定由谁在哪个出口写入（runner 的尝试收尾是自然落点），插件按该终态如实显示并保留失败原因入口。

### CLAUDE-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §核心 3（权限 0600）与 §性能目标（同一台 Mac）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：Windows 边界未声明。插件侧 macOS-only 有 extension/README.md 的明文边界，性能验收限定 Mac 与之相符；但 E1 的核心改动（流式写入器、暂停/恢复、0600、能力记录）随核心 bundle 在两个平台发布：0600 在 NTFS 上是空操作、agy 的 pty 在 Windows 被显式拒绝、cmd 垫片路径行为不同。本仓惯例是平台差异落设计 §7.1 并在计划/报告里如实登记未测边界（Bug 清单大量同形态条目），计划对此一字未提，实施后容易把「Mac 验收通过」误读成两平台行为已验。

**依据**：读 extension/README.md:78-80（「当前插件的运行与安装包验收环境为 macOS。Windows 真机未测」）；src/trivium/util/exec.ts:512-527（Windows 无 pty 等价物、显式拒绝）；doc/08_project/现存Bug与未完成工作清单.md 第 13/17 条的平台边界登记形态；被审计划全文无 Windows 字样。

**建议**：在计划里加一句边界声明：E1 核心侧在 Windows 的行为口径（是否启用、0600 语义降级、未测项如实登记），验收报告按同一口径登记；不要求本次在 Windows 实测。

## 认为正确的部分

- 现状陈述经逐处核对属实：review.ts:1215 建 <run>/<critic>/out；runner.ts runOneSide 管 attempt/证据/作废搬迁/重试且每次尝试后 force scrubSideDir；四适配器经 util/exec.ts run() 接收数据；setEncoding('utf8')、ptyOutputNormalizer、appendOut 有限收集、close/exit 宽限收尾均与 exec.ts 一致；onStdoutLine 丢空行与换行（exec.ts:609）确实不能作逐字节传输；收集上限按 JS 字符串长度（exec.ts:597）。
- Claude 侧脱敏顺序与模型名豁免描述准确（claude.ts:539-595：gatewayScrubPlan 逐值替换→redactSecrets，豁免四道守卫）；gatewayScrubPlan 只依赖 spawn 前已知的 env，流式逐值替换在派生前即可取得替换表，方案可行。
- 「写前完成脱敏、只提交已确定安全的前缀、对照整段脱敏做分割点穷举、不复制规则表」是正确方向：secrets.ts 的规则确有前后文依赖（isDeclaredMethodCall 看匹配两侧文本、PEM 跨行、熵判定看完整 token），安全前缀+EOF flush 的设计与这些规则形态相容。
- 能力记录携带「受支持的文件名」、插件只从记录派生文件名而不硬编码第二份，符合本仓单一事实源纪律；按 attempt 的文件身份、改名保留、stashVoidedOutput 整目录搬迁的处理与 review.ts:2532-2561 的实际行为对得上。
- 插件现状描述准确：statusWatch 目录级监听+去抖+末尾字节窗口重读 worker.log+终态 --status 复核后 dispose；cockpitHtml renderRuns 全量重建卡片、logView 以 textContent 虚拟绘制并保留滚动/展开状态；「逐批 stdout 不应触发全部卡片重建」是针对真实架构的正确约束。
- 验收设计忠实于任务书：退出闩锁（磁盘可见+安装态 DOM 可见才放行退出）正是真流式判据；Phase 4 五万行样本确为直接向 Webview 注入（REPORT_2026-11-19 第 131 行），只作滚动对照的定位正确；桩/可控 CLI/真实厂商分账、真实 CLI 不作性能对照、未测如实登记均与仓库测试纪律一致。
- 性能口径冻结质量高：基线用同一测试输出生成器而非空载作分母、交替运行、五轮中位数、逐进程 CPU/RSS、隐藏与无活动零开销、失败轮保留与同负载复跑；交付保留 Phase 4 与 glm-relay 包并核哈希、E1 包另名、doc/05_testing/README.md 索引同步、Bob 审批停点，均符合任务书与 AGENTS.md 同步清单。
- 版本号核对无误：核心 package.json 1.3.7、extension/package.json 0.3.0，与任务书「版本沿用当前值」一致。

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：背压致 CLI 停写→超时、流式脱敏与整段等价、短写处理、P95 延迟可达性等全部是结构推理，未做任何实测或复跑。
- 四个适配器的 invoke/parse 实现只读了关键段落（codex/claude/zcode 的落盘点与脱敏出口、agy 的 pty 接线），parseCodexEvents/parseClaudeEvents/parseAgyStream/envelope 解析器全文未读，计划适配器表格的解析细节只做了抽查。
- 主设计文档（2026-09-10）、LLD、PROTOCOL 全文未逐句审计 E1 可能使其失实的表述，只核了运行目录布局、raw_stdout_path 与 scrub 相关段落；「设计文档对应行为」具体要改哪几节留给实施时逐条对账。
- extension/test/e2e 与 scripts/runE2E.mjs 的实现未读，e2e 夹具复用能力取自计划陈述与 Phase 4 报告；Phase 4 原包与 glm-relay 包的实际存在与哈希未核。
- Windows 侧行为完全未验证（本侧只在 macOS 工作树读码）；性能目标数值（750 ms / 1 s P95、+32 MiB RSS）的可达性只做了结构判断。
- secrets.ts 规则表只读了前 180 行与 PEM/赋值族，其余规则（熵阈值、confirm 回调全集）未逐条核对流式安全前缀的可行性。

## 实际查阅的项目文件

- `.reviews/E1-审查员stdout实时输出/plan/2026-11-20-E1-审查员stdout实时输出-codex.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/05_testing/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/08_project/现存Bug与未完成工作清单.md`
- `doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/02_design/系统设计说明书.md`
- `doc/02_design/LLD_orchestrator.md`
- `src/trivium/util/exec.ts`
- `src/trivium/scrub.ts`
- `src/trivium/runner.ts`
- `src/trivium/review.ts`
- `src/trivium/run-files.ts`
- `src/trivium/secrets.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/adapters/agy.ts`
- `test/contract/orchestrator-logs-parity.test.ts`
- `extension/src/monitor/statusWatch.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/src/ui/cockpit.ts`
- `extension/README.md`
- `package.json`
- `extension/package.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":25,"grep":23,"glob":7,"run_command":0,"project_reads":36}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
