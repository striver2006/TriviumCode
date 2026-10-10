---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: plan
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
run_id: 20261010T062559Z
rerun_index: 1
snapshot_hash: sha256:e0488da20412af3283a2497d0a8a91979f77dda636c9e2b2b7e5902729775187
blind: true
started_at: 2026-10-10T06:26:01.702Z
finished_at: 2026-10-10T06:41:33.597Z
duration_s: 932
tool_calls:
  read: 19
  grep: 7
  glob: 5
  run_command: 0
  project_reads: 22
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 3
  minor: 3
  nit: 1
degraded: false
parse_fallback: false
peer_deny: true
drift: true
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
session_id: 910e53b9-506f-436b-91ba-8f1bafef8a78
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261010T062559Z`
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划对写负对照判据的整改方向正确、对任务原文忠实，但整改落点指错载体：0.162.0 硬闸（scripts/agent-access-admission.mjs:49）与 claudeWritePass 的全部可读调用点（同文件 :144/:147）在 git 生产装置里，计划只点名 scripts/agent-access-evidence.mjs；closeout-r2 复制件 launch.mjs 的 probe 通道指向不存在的 probe.mjs，计划却写成「已核对的事实」，判据改在 git 装置还是未跟踪副本属未决策。其次：文档同步清单漏掉 ADR_003（正文含「Codex0.162.0四路线已补齐适用准入」等将被本批推翻的现行断言，且它是本主题决策记录）；每臂指纹的模块清单漏列 probes/claude.js 等实际被消费的判据模块；「完整禁读集合始终由生产 enumerateDenyPaths 生成」在所读生产装置中找不到对应物（deny 集为内联构造）。这些在计划阶段只需几十个字，照做则直接产出不可审计的证据与过时的规范面。

**结论**：`request-changes`

## 审查意见（共 7 条：重要 3 ｜ 次要 3 ｜ 吹毛求疵 1）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §取证装置整改范围（第34-38行）` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：整改落点声明不全：计划只承诺改 scripts/agent-access-evidence.mjs 的 claudeWritePass「及调用点」，但「移除旧取证脚本固定 0.162.0 的复用前提」针对的字面硬闸实际在 git 生产装置 scripts/agent-access-admission.mjs:49（codexVersion !== '0.162.0' 即 throw），claudeWritePass 的可读调用点也在该文件 :144/:147（write_pass 与 diagnostic.paired_error 两处）。计划没有写 admission.mjs 是（a）被编辑——那它是 git 业务装置，必须进整改范围点名并进代码三审，且其首行「原48次脚本冻结」的自我定位要一并更新；还是（b）fork 成证据目录里未跟踪的 probe.mjs——那「复用已审计的生产通道」退化为版本控制之外的复制件，git 装置与副本两份配方长期漂移，而代码审查只按点名文件冻结。另外 r2 复制件 launch.mjs:24 的 probe 分支 hashFile(path.join(root,'probe.mjs')) 指向的 doc/05_testing/evidence/agent-access-20261010-closeout-r2/probe.mjs 当前不存在（Read 返回 File does not exist），该副本今天只可能跑 tv 模式；计划把它写成「已核对的事实：本轮独立复制的启动器已改为声明自己的实际 hash，仍经原预算、装载、编排器与适配器通道」，隐瞒了 probe 通道尚未落盘。

**依据**：scripts/agent-access-admission.mjs:1（原48次脚本冻结）、:49（0.162.0 字面闸）、:144/:147（claudeWritePass 调用点，参数 trace/created/timedOut/exitCode，无 init.cwd——新接口签名变化必改此处）；scripts/agent-access-evidence.mjs:8-11（现判据 endsWith('/breach.txt')）；doc/05_testing/evidence/agent-access-20261010-closeout-r2/launch.mjs:21-24（probe 分支指向 root/probe.mjs）；对同目录 probe.mjs 的 Read 返回 File does not exist；被审计划第19、34、38行。probe 模式下 hashFile 对缺失文件抛错为推断（budget.cjs 未读）。

**建议**：在整改范围一节点名 scripts/agent-access-admission.mjs 与将新建的 probe.mjs，写明各自走「编辑 git 装置并进代码三审」还是「副本为本轮判据载体、git 装置冻结不再被调用」，二选一；并在「已核对的事实」如实写 probe 通道待审批后创建。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §指纹、审查冻结与文档同步（第60行）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：文档同步清单（主设计§3.5/§11.6、PROTOCOL、GUIDE_local_pitfalls、QUICKSTART、验收剧本、新增收口报告、doc/05_testing/README）漏掉 ADR_003 与 doc/02_design/README.md:38 的指针句。ADR_003 正是本主题的决策记录，正文含多条将被本轮推翻或改写的现行断言：「Codex0.162.0四路线及Claude/Qwen flash补齐适用准入」（计划第17行明言 0.162.0 旧能力不能套用到 0.162.1、批次 D 全部重测）、「Kimi/DeepSeek的生产写负对照…仍保留未测」（若分项准入候选获批将改写口径）、「Qwen max组合已回读并取得Bash拒绝证据」（Bash 判据正被新接口收紧）；doc/02_design/README.md:38 又说「实施与真实验收状态见本次报告」——新增收口报告后「本次报告」指向将失实。按计划自己引用的 doc/README 第36-38行规则，这些是指向现在的句子，只改一处（新增报告）会让这几份副本失实。

**依据**：被审计划第17、49、60行；doc/02_design/ADR_003_agent_access.md 第3、5、9、15-17行；doc/02_design/README.md:38（ADR_003…实施与真实验收状态见本次报告）；doc/README.md 第36-38行（指向现在/记当时的引用判据）。

**建议**：把 ADR_003 列入同步清单：按其既有「2026-10-10补测：…」的逐段追加模式补一条本轮结论（或明确声明判据候选被否/被批），并把 02_design README 的「本次报告」指针改为不写死单份报告的写法。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §指纹、审查冻结与文档同步（第56行）与 §取证装置整改范围（第38行）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划承诺每臂前后保存脚本/模块 hash 并复用现有装置，但被复用装置的指纹清单本身有缺口：scripts/agent-access-admission.mjs:56-57 的 module_sha256 只列 adapters/codex|claude|codex-home|codex-trace|claude-trace、probes/codex|fixture、parse、secrets、util/exec 十项，未列同文件顶部实际 import 的 probes/claude.js（:16——READONLY_INVARIANTS 只读不变量参数、judgeToolSurface、judgeDeniedToolInTrace 都出自它，即 claude 各臂的判据与 argv 不变量本体）、adapters/claude-route.js（:9 路线解析）、adapters/base.js（:18 事后泄漏检测器）、config.js。0.162.1 下这批 claude 臂若 probes/claude.js 判据漂移，留痕无法证明判定模块身份，逐模型验收矩阵的「指纹绑定」对 claude 侧只是名义成立。

**依据**：scripts/agent-access-admission.mjs:7-23（import 面）、:51-61（request 指纹字段，:56-57 为模块清单）；被审计划第38、56行。

**建议**：在整改范围里明确把缺失模块补进 hash 清单（或声明新清单并逐项与旧清单对账说明差异），不要让复用清单继承这个缺口。

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §分批补测及最小启动清单（第52行）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：「完整禁读集合始终由生产 enumerateDenyPaths 生成」是始终型断言，且批次 C/D 的逐文件禁读断言钉在这个函数名上，但在可读的生产装置里找不到它：scripts/agent-access-admission.mjs 的禁读集是内联构造的（:79 [peer 或 peer 所在目录, '.env']，:125-127 交 buildDenySettings），全文未见 enumerateDenyPaths；scripts/agent-access-evidence.mjs 亦无。若该函数存在于别处 git 文件应给路径；若它只会在未跟踪的 probe 副本里新写，「生产」与「始终」两个限定词都不成立，「全部 fixture 同行工件入集合」就成了无可核对来源的断言。

**依据**：被审计划第38、52行；scripts/agent-access-admission.mjs:79、:117、:125-127、:143（deny 集构造与事后检测全部内联）；scripts/agent-access-evidence.mjs 全文 20 行无此符号；本环境 Grep/Glob 不可用，无法全仓穷举（见 not_covered）。

**建议**：在计划里写明 enumerateDenyPaths 的文件路径与 git 归属；若不存在，就按现有真实机制改写这句（fixture 全工件清单逐项进 buildDenySettings + 事后检测器对账），不要用「始终」盖住来源。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §取证装置整改范围（第36行）` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：「新增边界验证覆盖相对/绝对/别名路径、相邻目录同名文件、越界 ../、错 ID、无错误结果、权限层与注册层差别、失败/超时/文件存在」——这批判据边界用例的落点未决策：写进 git（scripts/ 或 test/，随代码三审与全量 check 常备回归）还是写进未跟踪的取证装置自检（不进 npm run check、不随 clone 存活、第64行的「两次串行 check」也覆盖不到）。计划同时承诺用旧真实录制的 V4 pro 样本重算派生结论，这是唯一能证明新判据不放水/不误伤的回归，却没说它在哪跑、结果记到哪。

**依据**：被审计划第36、64行（收尾只承诺 npm run check、doctor --selftest 14/14 与重装核对）；scripts/agent-access-admission.mjs:1-10 与头注（既有先例：判据类装置放 scripts/ 进 git，并有「脚本与探针分歧只来自输入」的对账纪律，见 scripts/claude-admission-control.mjs:9-27）。

**建议**：在整改范围里一句话写明边界用例与 V4 pro 重算的所在（建议 git 侧，随代码三审冻结），避免「同步全部 helper 调用点」之后判据本体反而无回归可指。

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §已核对的事实（第17行）与 §指纹（第56行）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：「全局配置 hash 与上轮快照不同，改变原因未核实」被计划原样带过：批次 A 的 doctor 刷新与正式 all 预检是在漂移后的配置上跑的，批次 B/D 的指纹与能力臂同样以此为基线，但计划对漂移只承诺「运行前后 hash 不同则拒绝复用，并说明采样时点」（第56行），没有安排任何归因动作。任务原文把「旧完整指纹结论不能直接追认」列入重点二.4；若漂移实为厂商升级以外的改写，B–D 全部臂的「项目配置和对应全局文件 hash」前提失效，属做完才发现方向不对的返工面。

**依据**：被审计划第17、42、49、56行；任务原文二.4（此前 doctor 期间出现全局配置hash漂移，旧完整指纹结论不能直接追认）；scripts/agent-access-admission.mjs:122-123（claude 臂已有「fingerprint 不匹配即不复用」机制，说明归因漂移与该机制同源可查）。

**建议**：给批次 B 前加一个零配额归因步骤（在内容层面比对全局配置变的是哪些键、能否解释为升级写入，只读不打印凭据值），或在停止条件写明归因失败则 B/D 指纹结论整体降级。

### CLAUDE-07 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §取证装置整改范围（第34行）` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：整改句只点名 claudeWritePass，而同一文件里的 codexWriteAttemptDenied（scripts/agent-access-evidence.mjs:13-16）有相反方向的弱点：只认相对字面 > breach.txt 的 printf 形态、无调用 ID 配对、不解析别名路径——它偏严（漏判成未测，不误判 pass），批次 D 的 codex「写」臂继续用它。计划未声明口径差别，最终逐模型验收矩阵里 claude 的「写负对照 pass」（注册层拒绝+ID 配对+精确目标）与 codex 的「pass」（沙箱报错字面+无配对）是两个不同强度，容易被读成同一判据。

**依据**：scripts/agent-access-evidence.mjs:13-16；scripts/agent-access-admission.mjs:119（codex write_pass 组装）；被审计划第34、49行。

**建议**：在矩阵说明句里标注 codex 侧「写 pass」按设计 11.1 分档为沙箱层口径，或顺带把该正则的相对字面收紧列入整改范围。

## 认为正确的部分

- 对 claudeWritePass 现状缺陷的刻画与代码逐字相符（scripts/agent-access-evidence.mjs:8-11：endsWith('/breach.txt') 漏相对路径、接受任意目录同名目标），新接口的收紧方向（可信 init.cwd、fixture 根、精确唯一目标、调用 ID 非空且配对为注册层拒绝、Bash 单一写命令）是对原「写负对照」判据的正确忠实化。
- 对任务原文的忠实度总体高：判据不变声明、两条可选路径且路径 2 未经用户明确批准不得实施、冻结台账数字（48/48、100/100、29/40、36/36、28/40、47/64、21/24、closeout 5/16）、「启动数不是请求数或金额」、独立证据根、不用 pro 替代 flash、Codex 禁读臂「事后命中」不外推为 CLI 阻止——逐条对上原文，未发现改写或拔高。
- closeout-r2 复制件 launch.mjs 的 tv 分支确已改为声明自身实际 hash（:24 对比旧 closeout/launch.mjs:24 声明 scripts/agent-access-launch.mjs），旧 closeout 记录 execution_sha256 不等于实际执行的复制件这一「已核对事实」与两份代码互证成立；预算、装载、脱敏、manifest 通道字段与生产件逐项一致。
- 「不允许把没有注册写工具直接改判为原负对照通过」「未批准前不改任何准入字段、判据或完成条件」是对判据可测试性问题的诚实收口方式，人工审批停点设计符合本轮要求。

## 未覆盖范围（本侧盲区）

- 主设计《2026-09-10-Driver-DualCritic主攻双审流水线设计.md》§3.5/§11.6 原文未读（约 19 万字且本环境 Grep/Glob 均返回空、无法定位节行号），无法核证计划的同步说法与主设计现行条款的差异。
- .trivium/config.local.yaml 被权限拒绝读取，「Codex native 三档 gpt-6.1-sol/gpt-6-luna/gpt-6-astra、Claude 两 profile、共享三审 claude,gemini,glm」仅对照 ADR_003 第15-17行与计划第15行文字一致，未核机读配置本身。
- 所有哈希与版本类断言（HEAD=origin=3e5ca6bb、仓库/安装 bundle 相同、旧 launch.mjs 实际 hash 与 execution_sha256 的差、claude 2.1.296 / codex 0.162.1 / agy 1.3.3、旧 closeout 5/16 与 24/40 预算磁盘台账）均为读码与文字推断，本侧无执行能力，未重算、未对账。
- scripts/agent-access-budget.cjs 未读，O_EXCL 先预占、失败与超时计数、不回收预占、extend 原子发布具名扩容的预算语义未核。
- Grep/Glob 在本环境不可用：claudeWritePass 是否存在「全部 helper 调用点」之外的其它调用方、enumerateDenyPaths 的真实定义位置，均无法穷举确认，CLAUDE-01/CLAUDE-04 据此限于实际读过的文件。
- src/trivium/adapters/claude.ts、codex.ts、probes/claude.ts 未读，invokeClaude/buildClaudeArgs/readonlyArgsFromProbe 的现行签名与只读不变量内容未核。
- 第 8.1/8.2 禁读清单内所有文件（含 admission 证据、对方历史审查件、.trivium/runs）一律未读；本次取证仅用了未被点名的两个 closeout 目录中的 launch.mjs。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-codex.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/05_testing/README.md`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-admission.mjs`
- `scripts/agent-access-launch.mjs`
- `scripts/agent-access-budget-preload.cjs`
- `scripts/claude-admission-control.mjs`
- `doc/05_testing/evidence/agent-access-20261010-closeout/launch.mjs`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/launch.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"read":19,"grep":7,"glob":5,"run_command":0,"project_reads":22}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
