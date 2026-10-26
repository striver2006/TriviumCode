---
schema: trivium.review.v2
topic: KimiCode与QoderCN双角色接入
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.17.0
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
effort_requested: null
effort_effective: null
effort_effective_source: null
tier: null
tier_source: legacy
model_route: config_copy
run_id: 20261026T174236Z
rerun_index: 1
snapshot_hash: sha256:4dd32c184995dc930cb3ae2094e7063faa1b86de1640a195f648c4403c464ad2
blind: true
started_at: 2026-10-26T17:42:42.202Z
finished_at: 2026-10-26T18:02:42.064Z
duration_s: 1199
tool_calls:
  read: 27
  grep: 12
  glob: 2
  run_command: 0
  project_reads: 25
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 5
  minor: 2
  nit: 1
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
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: sess_3ce28ee8-a08d-452e-9178-24d558e19c1e
---

# 计划审查：KimiCode与QoderCN双角色接入

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261026T174236Z`
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划整体方向正确：取证前置、fail-closed、注册表单一来源、请求/回读分离均与仓库既有契约吻合，五条 major 集中在「计划把已可判定的事留成条件分支」与「验收判据在自设的生产形态下不可满足」。最危险的是 GLM-01：动态默认模型解析的绑定机制与时点未决策，而 requested_routes 的 tier_source 是闭合枚举、resolveTier 是纯函数，这一契约改动必然触及 run.v3 与预检。其次 GLM-02 的写入负对照在工具白名单形态下按原文不可满足；GLM-03 的单 Agent 多载体数据模型是不可逆决策。GLM-04/05 是存量配置接入与 Windows 验收前置的边界缺口，均可按意见在计划层面补齐，不需要推翻架构。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 8 条：重要 5 ｜ 次要 2 ｜ 吹毛求疵 1）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2.3 / §3.1 第 6 项` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：「若纯配置表不能表达动态默认，新增通用可选适配解析契约」把一个现在就能判定的事实留成条件分支，且未决定动态默认的绑定机制与时点：探针期落盘还是在 review 准备期现读厂商目录。「来源」在运行快照里如何表达也未决策。

**依据**：src/trivium/adapters/base.ts 的 resolveTier 是纯函数（文档块明写「不读盘、不读环境」），模型只有三个来源：cli.tier 指向档位表、profiles[active_profile][critic][stage] 格子（裸 slug 或 {model,effort} 或 {tier}）、agents.<id>.default_tier；src/trivium/preflight.ts:553-560 显示模型解析为 null 即「未定义模型且无覆盖」退 64；src/trivium/config.ts 内置 profiles 仅 default/flash 两表且格子都是具体 slug；skills/dual-critic/schema/run.v3.json:758-803 的 requested_routes 条目 additionalProperties:false 且 tier_source 为闭合枚举 cli|profile|agent_default|legacy|override|null，src/trivium/types.ts:1005 的 TierSource 同枚举。结论：现有配置表确实表达不了厂商目录动态默认，条件分支的前提已成立；新增来源无论作为 tier_source 新枚举值还是新字段都触及 run.v3、types、parse/meta/gate 与 PROTOCOL。另外计划 §2.3 自己要求「默认模型变化须新探针及能力绑定、不能复用旧模型证据」——只有探针期落盘并在预检比对厂商配置现值时这条才可执行，准备期现读会让模型在 doctor 与 review 之间悄然切换而能力证据仍绑在旧模型上。

**建议**：去掉「若」，在计划里定死三件事：①适配层可选钩子的契约形状（返回模型+来源或「配置缺失」三态）及其在 resolveTier 第一段中的优先级位置（应在 agent_default 之后，不得覆盖显式格子与命令行覆盖）；②绑定取探针期落盘（非敏感字段进 probe.cli.<cliName>），预检比对厂商配置现值与探针值，不一致按既有 fix: doctor 通道处理；③点名 run.v3 tier_source/ requested_routes 的扩展与 parse/meta/gate/PROTOCOL 同步点，并把「探针值与现值不一致」「显式覆盖优先于动态默认」加进自动化测试清单。

### GLM-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2.2 能力矩阵「写入」行 / §3.2` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：写入负对照的通过要求「同一动作在生产限制组合下实际被拒；没有调用尝试不能记为拒绝有效」与计划 §2.3 自设的生产形态（Kimi tools 只含 Read/Grep/Glob，Qoder --tools 精确白名单）互斥：工具不在清单里，模型根本发不出该调用，「实际被拒」与「有调用尝试」都不可得，该行按原文不可满足，结果是两侧要么永远阻塞、要么在实现期被口头放宽。

**依据**：plan §2.2 表格与 §2.3 两段候选调用形态；src/trivium/adapters/base.ts:49-66 TraceCapability 文档写明 rejectionRecorded=false 意味着「尝试写」的检测失效、只修饰阴性结论可信度，且被拒命令可能一条事件都不产生（COMMAND_TRACE_CAPABILITY 的依据 P-C2）。「工具面裁剪（不提供）」与「权限拒绝（提供但 deny）」是两种机制、留痕形态不同，而矩阵把负对照统一压成「实际被拒」一种。计划 §4 测试清单里「未知工具执行失败」一条说明作者已预见模型会调用不存在的工具，但没有把它接回 §2.2 的判据。

**建议**：把「写入」负对照拆成两格并分别定义证据形态：(a) 生产形态为工具不在清单时，证据＝工具清单回读/会话首帧不含 Write/Edit/Shell，加「诱导模型调用未提供工具时 CLI 是否留错误事件」（该结论直接决定 rejectionRecorded 取值）；(b) 生产形态为工具在场但路径/权限 deny 时才要求拒绝事件与前后 hash 不变。并在计划里写明两家各采哪种生产形态，TraceCapability 按所采形态如实填。

### GLM-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1 / §3.1 第 1、5 项 / §3.3` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：Kimi 三个 Driver 载体（CLI、桌面端、VS Code 插件）与 Qoder 两个载体共用一个 AgentId，但注册表对每个 Agent 只登记一个安装根（entrySkillRoot）和一个调用写法（entryInvocation），carriers 也是一家一个 yaml。计划自己承认「可能不共享同一二进制或技能语义」，却没有写当探针证实读取根或调用语法不同时数据模型怎么裁：单 Agent 多载体（扩展描述符为列表）还是按载体登记。这是数据模型级、难以回退的决策，留到实现期才碰会同时返工注册表、install、entry-collisions 与停点话术生成。

**依据**：src/trivium/agents/registry.ts 的 AgentDescriptor：entrySkillRoot 为单个 EntrySkillRootSpec、entryInvocation 为单个字符串，glm 条目注释写明桌面端与命令行调用写法不同（/名字 与 /skill 名字）而只能登记一种、按桌面端登记；entrySkillExtraReadRoots 文档写明这些根「只查不装」；src/install.ts:183-202 planInstall 按 loadCarriers × entrySkillRootOf 一家产出一个安装目标；entryCommandOf(driverId, name) 按单一 entryInvocation 生成闸门停点话术。若某 Kimi 载体需要第二个安装根，现有模型装不到。

**建议**：在计划里补一条裁定规则：探针后若同一家各载体技能根与调用语法一致，沿用单值登记；若不一致，先决定把 EntrySkillRootSpec/entryInvocation 扩为按载体的列表（连带安装清单、卸载、查重、entryCommandOf 消费点）并回补设计 §5.1.1/§7.4.1，再进实现；同时明确某载体不支持独立入口时按 §3.3 末句报告阻塞，不得借用别家根凑数。

### GLM-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1 第 7 项 / §3.1 第 1 项` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：只写了「不选就不用配新段」，没写「要选时怎么配得上」：入选审核者必须在配置 agents 段有条目（缺段退 64）且模型能解析，而 trivium init 把整份缺省冻进项目 .trivium/config.yaml，存量项目不会自动得到 agents.kimi/agents.qoder-cn 段与 profiles 格子。计划未决定 defaultConfig() 是否新增这两段（影响所有新项目的 init 产物与 doctor 面）、存量项目的接入路径（迁移、手工补段还是重跑 init）、以及选侧缺段时报错是否给可粘贴配置。

**依据**：src/trivium/critics.ts:383-390：入选审核者在 agents 段无条目即退 64；src/trivium/config.ts:344-347 注释「段本身必须在：resolveCriticSelection 把『入选审核者在 agents 段有条目』当作统一前置条件，缺段则退 64」；src/trivium/agents/registry.ts codex 条目注释 ①：已 init 项目把当时缺省整份冻进进 Git 的配置文件，此后改注册表对它们无效；skills/dual-critic/schema/config.v2.json:299-316 agents 值以 vendor const 做可辨识联合，新 vendor 不加形状时由 schemas.ts 的 configurableVendors() 报「已登记但形状未定义」。

**建议**：计划明确：①defaultConfig() 对两家给最小 {vendor} 段、不给 profiles 格子，模型走 GLM-01 的动态默认；②存量项目接入路径写进使用/部署手册，不做静默迁移；③预检与选侧的缺段/缺模型报错附可粘贴最小段；④「显式选入 kimi 而配置缺段」作为用例进自动化测试清单。

### GLM-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.1 / §5.2` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：Windows 五个 Driver 入口验收要跑完 A/B/C/D 与人工停点，这需要审核者真实运行；计划没写 Bob 的 Windows 机上审核者取什么集合。真实 gemini,glm 要求 Bob 装好并登录两家 CLI；桩审核者（TRIVIUM_STUB_CRITIC）只证编排不证能力，而计划 §4 又写「桩结果仅证明编排，不算客户端能力验收」。不定下来，manifest 的 pass 判据不唯一，Bob 的环境前置也无法事先交付，验收可能因缺审核者被长期挂起或口径漂移。

**依据**：plan §5.1「使用隔离测试仓库完成 A/B/C/D 任务入口、Driver 身份、逐条裁决、B/C/D 人工停点及用户实际批准后恢复」与 §5.2 交付清单均未提审核者前置；AGENTS.md「故障注入用环境变量 TRIVIUM_STUB_CRITIC（跨进程生效），且必须断言桩指纹 cli_version: stub/0.0.0」说明桩路线存在且可跨进程；README.md 的 Windows 前置只列运行时与 Agent CLI 的笼统要求。

**建议**：在 §5.2 二选一并写明：Driver 入口验收（技能发现、参数、cwd、Driver 身份、停点与恢复）允许以桩审核者完成，manifest 记 critics 为桩指纹并在报告单列；Windows 两家审核者能力另按 §2.2 真实取证。若坚持真实审核者，则把 Bob 机两家 CLI 的安装、登录与 doctor 通过作为前置条件列进交付材料。

### GLM-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1 第 1 项` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：注册字段枚举不完整，漏了三个影响 Driver 侧行为的字段：instructionFiles（trivium init 往哪个文件写 Driver 协议块——两家各载体读 AGENTS.md 还是自家记忆文件需探针，读不到协议块则 L2 停点约束失去主要载体）、hookConfigTarget（两家若有 hooks 机制，登 l2-hook 尽力拦截还是 l2-none，由 guardProfileOf 决定入口资产注入哪段护栏文案）、label 字母（新启用审核者取下一未用字母，影响归档抬头）。

**依据**：src/trivium/agents/registry.ts 的 instructionFiles/criticReadsInstructionFiles/hookConfigTarget 字段与 guardProfileOf() 文档块（l2-hook 与 l2-none 由 hookConfigTarget 有无派生，入口资产按它选护栏文案）；label 字段文档块「新启用者取下一个未用字母，既有两侧不受影响」；CLAUDE.md/AGENTS.md 里的 TriviumCode 协议块即 instructionFiles 的落点实例。

**建议**：把三项并入 §3.1 第 1 项的登记清单，「各载体实际读取的指令文件」加入 §3.3 逐客户端实测项；label 字母按注册表既有规则预先定值。

### GLM-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.2` |
| 类别 | test-gap ｜ 层次 requirement |
| 置信度 | medium |

**问题**：任务目标一.6 要求 Windows 交付「可复跑脚本、界面步骤和脱敏证据清单」；§5.2 只列了脚本、PowerShell/Git Bash 启动说明与 manifest/截图索引，桌面端两家（Kimi 桌面、Qoder CN 桌面）的界面操作步骤——从哪里打开项目、怎样发出技能、每一步对应截什么图与填哪个 manifest 字段——没有作为交付物列出。

**依据**：任务目标原文一.6 与计划 §5.2 第一段交付清单对照；plan §5.1 自己写「桌面客户端…须从对应 UI 发起，不能终端代跑后截图冒充」，说明界面操作本身是验收判据的组成部分，缺步骤单则 Bob 无法按图复跑、截图与 manifest 也难对应。

**建议**：在 §5.2 交付清单补「逐客户端界面步骤单」，每步标注对应的 manifest 字段与截图索引，桌面端两家各自成单。

### GLM-08 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.2 落点 scripts/acceptance/kimi-qoder-cn/ 与 §3.1 第 2 项新模块名` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | low |

**问题**：kimi 与 qoder-cn 注册为角色后缀后进入 Hook 字面集，Bash 侧已知误拦判据（写动词形态＋提及任一角色后缀）将命中一切针对 adapters/kimi.ts、probes/qoder-cn.ts、scripts/acceptance/kimi-qoder-cn/ 的写形态命令——本轮 Driver 为 codex（L2 无 Hook）不受影响，但后续由 Claude（L1）驱动的维护会频繁撞上，需要按 CLAUDE.md 的出口（结构化写工具、git commit -F）绕行。

**依据**：AGENTS.md/CLAUDE.md 的 Bash 误拦条款（词边界字面匹配、不区分写它与说它、刻意接受的取舍、不要当 bug 修）；src/trivium/naming.ts 的 suffixAlternation 由注册表全量派生，新增 id 自动进入 Hook 字面集；既有同例：src/trivium/adapters/claude.ts、probes/codex.ts 等后缀命名文件已长期处于同一状态。

**建议**：不改机制；在交付文档/本机坑清单里预先登记这条摩擦面与标准出口，验收脚本目录可考虑不含注册后缀字面量的命名以减少误拦面。

## 认为正确的部分

- 能力取证前置与 fail-closed 准则正确：未取得证据不启用生产审核适配、能力不足阻塞该侧、不以提示词只读降级，与 adapters/base.ts 的 TraceCapability/commandExecution 契约和「按能力分档、不按 Agent id 分叉」的纪律一致
- 禁读矩阵、保护后缀、候选 glob、意见前缀、档位旗标名全部由注册表派生的路线正确；实测核对 naming.ts 的后缀交替正则（懒惰主题匹配＋锚尾）与 freeze.ts 的 ALL_AGENT_IDS glob 在结构上可容纳 qoder-cn 这类含连字符后缀，计划把「含连字符 argv 与归档名字解析」列入测试清单是对的
- defaultSelected:false 与「保持 DEFAULT_DRIVER、默认集合与 max_critics=3」兼容：registry.ts 的 deriveDefaultCritics 两条不变量（缺省⊆启用、缺省数量≤上限）在两家登记后仍成立
- 请求值与生效回读分离、worker 必须核对 requested_routes 快照同一值、失败出口照记请求值，与 run.v3 既有纪律及 failedResult 的既有口径一致
- 入口资产改 skills-src 再 npm run render、不手改生成物、安装目标由 carriers×注册表描述符派生（install.ts planInstall 实证支持）的落点正确
- 清理复用 scrubRunDir/retention/运行目录清扫接口、副本 0600/目录 0700、清理失败显式报错，符合既有隔离纪律
- Windows manifest 三态、缺字段为 null 不默认通过、环境不同重新探针不合并 Mac 证据，是可核验的验收口径

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：未运行任何命令，Kimi/Qoder CLI 的旗标（--agent-file、--tools、--permission-mode dont_ask、stream-json 等）、权限规则语义与事件形态均为未验证推理，结论以源码与计划文本为据
- 未读 .trivium/（任务书 8.2 限制）：本仓 pro 档位表的实际内容、本机 config.local.yaml 探针段均未核对，三档现状由 doc/07_manuals/使用手册.md 与 src/trivium/config.ts 内置缺省推断
- 未读主设计（2026-09-10-Driver-DualCritic主攻双审流水线设计.md）§5.1.1/§11.1/§11.5 原文，七件套与档位契约的对账以 registry.ts、adapters/base.ts、tier-flags.ts 的实现与注释为依据
- 未核 hooks.ts 的 criticRoleSuffixes() 与 Bash 写动词清单实现细节，GLM-08 的判据来自 CLAUDE.md/AGENTS.md 条款而非源码逐行核对
- 未读 entry-render.ts / entry-collisions.ts 内部实现，GLM-03 中关于安装与查重的判断基于 install.ts 的 planInstall 与注册表字段形状
- 未访问外网：计划所列五条官方文档 URL 的内容未验证，其与 2.3.0/1.1.79 版本的差异无法核实
- Windows 平台行为（.cmd 解析、凭据 ACL、taskkill 进程树）未核 util/platform.ts，§5.2 的可执行性按既有文档描述采信

## 实际查阅的项目文件

- `.reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-codex.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/07_manuals/使用手册.md`
- `src/trivium/agents/registry.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/tier-flags.ts`
- `src/trivium/naming.ts`
- `src/trivium/archive.ts`
- `src/trivium/config.ts`
- `src/trivium/preflight.ts`
- `src/trivium/doctor.ts`
- `src/trivium/critics.ts`
- `src/trivium/freeze.ts`
- `src/trivium/types.ts`
- `src/install.ts`
- `skills-src/carriers/codex.yaml`
- `skills/dual-critic/schema/config.v2.json`
- `skills/dual-critic/schema/run.v3.json`
- `skills/dual-critic/schema/review.v2.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":27,"grep":12,"glob":2,"run_command":0,"project_reads":25}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
