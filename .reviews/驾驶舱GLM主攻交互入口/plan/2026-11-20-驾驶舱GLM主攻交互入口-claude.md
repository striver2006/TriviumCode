---
schema: trivium.review.v2
topic: 驾驶舱GLM主攻交互入口
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
run_id: 20261120T062746Z
rerun_index: 1
snapshot_hash: sha256:1c58bb58890026bbef945d72722cf96aefa441c43a407e8a908fd6b6407ce59d
blind: true
started_at: 2026-11-20T06:27:55.265Z
finished_at: 2026-11-20T06:40:44.570Z
duration_s: 769
tool_calls:
  read: 18
  grep: 7
  glob: 7
  run_command: 0
  project_reads: 21
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 3
  minor: 4
  nit: 0
degraded: false
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
    status: different-family
    left_model: gemini-4-neon-high
    right_model: qwen4-max
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / qwen
override_reason: 左侧模型信息缺失
session_id: 2b604b8a-ae45-4bfc-86cc-89c4d11ba9f0
---

# 计划审查：驾驶舱GLM主攻交互入口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen4-max` ｜ 请求模型 `qwen4-max`
> ｜ 运行 `20261120T062746Z`
> ｜ 本轮审核者 glm、gemini、claude

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

现状段与代码、Phase 4 报告逐句核对属实，任务边界（后台探针不动、仅扩展进程读新设置、macOS 范围、不跑 shell 初始化）忠实。最危险的一条：解析出的启动模式/来源与静态 CARRIERS.glm.launchMode 的归属未决策——cockpit 三处按静态值 gate 解释器与 provider 环境，照现状实施要么把桌面探针的 provider 文件传给独立发行版、要么打红 AGY-02 对账断言。其次：v2 基线文档 C1/§4.1「按探针 entrypoint 拉起」的多份副本未列入修订交付；规则 2 拦截确认缺 TUI 的候选后是终止还是落空到探针入口未决。另有手册旧表述、报告索引登记、直接可执行形态未测声明、keyring 缺件承接四条小项。按意见补齐决策与交付清单后即可实施，无需再审一轮。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 7 条：重要 3 ｜ 次要 4）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §点火规则3 / extension/src/ui/cockpit.ts:613-635 / extension/src/launch/carriers.ts:36,71` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划引入逐次点火解析出的「启动来源/模式」，但未决策它与静态载体事实 CARRIERS.glm.launchMode='shellCommand' 的归属关系。cockpit 目前三处按 carrier.launchMode 消费：决定是否解析解释器（613）、传给 ensureSession 的 launchMode（631）、以及 scriptEnv 是否取桌面探针的 provider 路径（635）。若保留静态值只换入口：解析为独立 JS 脚本时仍会带上桌面探针的 ZCODE_BUILTIN/PERSONAL_PROVIDER_CONFIG_FILE，与「独立发行版优先使用自身配置」冲突（适配器头注 P-28/P-29：这两个变量先于参数解析、直接决定 provider 配置定位）；解析为直接可执行时还会错误地强制要求 Node 并按脚本模式拉起。若改静态表，carriers.test.ts 的 AGY-02 断言（glm 必为 shellCommand）当场红。计划对「哪份副本改、哪份留、gate 改用什么判据」均未写明。

**依据**：读 extension/src/launch/carriers.ts（launchMode 定义与 glm=shellCommand）、extension/src/ui/cockpit.ts:612-635（三处消费点，scriptEnv 按 carrier.launchMode gate）、extension/test/unit/carriers.test.ts:101-106（断言 glm launchMode=shellCommand）、extension/src/launch/terminalRelay.ts:98-109（direct 分支不收 env）、src/trivium/adapters/zcode.ts 头注 21-24 行（P-28/P-29 provider 环境变量语义）。计划只写「扩展端解析出启动来源、入口、模式与实际解释器」「保留旧探针脚本的 provider 路径传递；独立发行版优先使用自身配置」，未落 gate 判据与镜像表/断言的去留。

**建议**：在计划中决策：解析出的模式/来源成为解释器解析与 scriptEnv 的唯一 gate 判据；写明 CARRIERS.glm.launchMode 是降为缺省值还是退役，并把 carriers.test.ts 的 AGY-02 断言、carriers.ts 与 terminalRelay.ts 的模式 docblock 列为同步修订副本；按来源（旧探针脚本 / 独立发行版 / 直接可执行）逐一写明 provider 环境传或不传。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §回归与交付 / doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md:43,63,90,188,276` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：插件基线文档把「复用 wrapper + 探针 entrypoint」写成决策 C1 与 §4.1 M1 运行形态（「用探针 entrypoint 的可执行文件拉起交互会话」），架构图（188 行）与决策对照表（276 行）同口径。本次把入口选择改为「显式设置→PATH→常见位置→探针兜底」，这些表述将失实；计划的交付清单只有扩展手册，未列基线文档修订，违背仓库「与设计文档不一致先回补修订、禁止两套规范并行」的同步纪律。Phase 4 报告正是以该 v2 计划为范围基线，漂移会直接误导后续验收对照。

**依据**：grep 读 doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md 的 43/63/90/188/276 行；AGENTS.md「改动同步清单」首行；doc/02_design/README.md「实现与本文冲突时，先回溯修订本文与 PRD，禁止两套规范并行」；doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md 121 行引用 v2 计划为范围。计划「回归与交付」四段均无文档修订项。

**建议**：交付清单加一条：修订 v2 文档 C1、§4.1 终端宿主行、§5 架构图与对照表的入口口径（或写一份范围化增量并在基线登记）；注明 C1 对「登录 Shell 提取」的否决仍然有效——本计划不执行 shell 初始化，被收窄的只是「复用探针 entrypoint」这一肯定句，且仅对 GLM 主攻生效。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §点火规则2` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：拦截后的落空语义未决策：PATH/常见位置找到的候选被确认为「桌面包布局且缺 TUI」时，若探针还登记着可用旧入口（独立脚本、夹具或可执行文件），是拦截并结束本次点火，还是跳过该候选继续落到探针入口？「没有自动候选时用原探针入口」与「只在……时拦截」两句对此容得下两种读法。同机并存「PATH 上的桌面 zcode」与「探针登记的可用独立入口」是 Phase 4 实测过的现实形态；取硬终止读法会让已登记可用入口被影子候选挡死，与任务「旧工作区或夹具已登记可用交互入口时怎样继续工作」相抵触。

**依据**：读被审计划规则 2 全文；extension/src/ui/cockpit.ts:594-599（现状直取探针入口，无候选链）；doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md 152-156 行（桌面包缺 @zcode/tui、本机探针指向桌面脚本、夹具另行登记独立入口，两类入口同机并存）；任务目标原文（任务书附录）一节第 3 条。

**建议**：在规则 2 写明：确认缺 TUI 的候选被跳过并记录原因，候选链继续走到探针入口；仅当全部候选不可用时才拦截终止并给修复指引。或者明确选择硬终止，并写明此时如何保住已登记的可用入口；两种选择都补一条对应单测。

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §回归与交付（手册项）/ extension/README.md:44,90` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：手册交付只承诺新增配置示例与排错内容，未列出将失实的既有表述：功能区「M1 终端协同：按探针 entrypoint 拉起交互会话」（44 行）与平台边界段「若 ZCode 的终端立即退出，请用探针登记的入口检查能否进入交互界面……该环境下可使用 M3 监控」（90 行）。改后前者不再准确；后者把用户引向 M3 监控，与新的「配置独立交互入口」修复路径冲突——同一事实在手册里留下两份旧副本。

**依据**：读 extension/README.md 44-46 行与 90 行；被审计划「回归与交付」手册项仅枚举新增内容（两套配置、路径核对、桌面缺依赖、登录/选模提示），无既有表述修订清单。

**建议**：手册交付项把这两处列为必改副本：M1 功能描述改为新入口选择链，平台边界段改为指向 glmInteractivePath 配置与独立发行版的修复指引，保留 M3 作为兜底而非首选。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §回归与交付 / doc/05_testing/README.md:16` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：验收将产出新的测试报告，但计划未把 doc/05_testing/README.md「当前已归档文件」索引的同批登记列入交付。doc-archive-index 契约测试对缺登、悬空、重复、逆序当场红并点名文件；根 npm run check 虽会兜住，但这是具名同步义务，漏写会在交付末尾变成一次返工补丁。

**依据**：读 doc/05_testing/README.md 16 行（新文档与文档本身同批进索引、契约测试对账）；AGENTS.md「改动同步清单」新增测试报告行；被审计划交付段无索引登记项。

**建议**：交付清单加一条：新验收报告按目录 README 的规范句同批登记进「当前已归档文件」，证据目录命名沿用〈名称〉-〈YYYYMMDD〉口径。

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §回归与交付 / extension/src/launch/terminalRelay.ts:98-109 / extension/src/launch/zcodeTurns.ts:17,39-41` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：直接可执行形态的真机验证边界未声明：真实验收只指向「实测独立发行版和解释器」（即 node bin/zcode.mjs 脚本形态，Phase 4 的忙/空闲续话与轮次事件均在该形态实测）；直接可执行支只有可控子进程断言 argv/env。官方直接可执行文件是否支持 ZCODE_LOG_DIR、是否按 ZcodeTurns 期望的文件名与事件形状（zcode-日期.jsonl、module=core.runtime、turn.*）写日志，从未验证。计划未把「直接可执行＋真实 CLI 的交互与续话」列为未测项，Goal 的「续话齐备」也未限定形态，验收报告存在把两支都写成真机通过的空间。

**依据**：读 extension/src/launch/terminalRelay.ts（direct 分支现状无 env、turns 仅脚本支创建）、extension/src/launch/zcodeTurns.ts（文件名正则与事件过滤）；doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md 5、67-69、154 行（实测形态为 node bin/zcode.mjs；当时 command -v zcode 查无独立入口、官方 releases 404）；被审计划回归项 1（可控子进程验两支）与项 3（隔离设置指向实测发行版）；任务目标验收节「真实 CLI、桩和未测项分别记录」。

**建议**：计划明写：本轮真机交互/续话仅覆盖脚本形态；直接可执行的真实 CLI 兼容性（含 ZCODE_LOG_DIR 轮次事件）登记为未测项，Goal 的续话条件按此限定；如实施期取得官方可执行文件，再补一次真机采样并更新未测清单。

### CLAUDE-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §回归与交付（手册与安装态验收项）/ doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md:67-69` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：计划未承接独立发行版已实测的缺件事实：Phase 4 记录官方发行包缺 @napi-rs/keyring-darwin-arm64@2.1.2，首次登录报「系统凭据存储不可用」，修复只作用于本机解压目录，「原发行压缩包仍需同一补件」。手册项只列了桌面缺依赖（@zcode/tui），未列独立发行版的登录缺件排错；安装态验收用本机补件目录，但计划未要求记录补件状态——其文件哈希与官方原包不同，报告若不区分，会 overstating「官方发行版开箱可用」，照手册装新官方包的用户也会撞上同一登录失败。

**依据**：读 doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md 67-69 行（源码构建缺 @zcode/shared/dist、keyring 补件过程、原压缩包仍需补件）；被审计划「回归与交付」手册项与安装态验收项（采集版本与 SHA-256，但无补件状态记录要求）。

**建议**：手册排错节补独立发行版 keyring 缺件的现象与处置；验收交付要求记录实测发行目录的补件状态与关键文件哈希，明确区分官方原包与本机补件目录，未补件官方包的登录可用性如实标未测。

## 认为正确的部分

- 现状段逐句核对属实：handleIgnite 冻结表单/主题校验与认领（cockpit.ts:566-599）、carrierOf→loadProbe→resolveAbsoluteNode（runner 绝对路径优先、wrapper 兜底）链路、ensureSession 按 agent|topic|entry 复用且 direct 分支跳过日志目录与环境（terminalRelay.ts:83-109）、injectText 返回终端存活、ZcodeTurns 只消费主会话轮次、relay 用 pending 串行等待轮末、关闭切 M3——与代码一致。
- Phase 4 事实转述准确：桌面 CLI 0.17.3 补齐 provider 路径后仍缺 @zcode/tui、独立启动器 3.18.2 的 bin/zcode.mjs 经 Node 24.14.0 启动内置 0.17.1、旧报告在夹具探针换过入口而本次保留桌面探针——均与验收报告原文一致。
- 后台隔离判断正确：src/trivium/adapters/zcode.ts:1182、1230-1235 确从 cfg.probe.cli.zcode 取 entrypoint 与 readonly_flags 并向 invokeZcode 传 ctx.nodePath；计划不改后台、只在扩展进程读新设置，并用隔离仓不同交互路径做后台对照，忠实于任务边界。
- 「两种启动形态都传 ZCODE_LOG_DIR」正对任务点名的 direct 分支缺环境问题；显式路径失效 fail-closed 不回落，与 cockpit 既有 CLAUDE-02 先例（解释器只认绝对路径、拿不到明示失败）同口径。
- 验收设计与任务逐条对应：最终 VSIX 全新用户数据/扩展目录安装、真实 run_id＋开场文本＋/skill dual-run 核对（不止 --version）、忙/空闲各一次唯一提交、关终端后 M3 原主题原编号、桩侧明确标注、保留既有三个 0.3.0 包（extension/ 下实存 0.3.0、0.3.0-glm-relay、0.3.0-e1 三个 VSIX）。
- 「不执行 shell 初始化」守住了 v2 文档 C1 否决登录 Shell 提取的边界；自动发现只做只读文件判别，不改用户全局 PATH、不补装 @zcode/tui、不动桌面应用，与任务实现边界一致。

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：PATH 发现结果、桌面布局与 TUI 依赖判别、独立启动器对 provider/Node 的实际继承、直接可执行文件的 ZCODE_LOG_DIR 轮次事件兼容性，均为基于代码与报告的推理，未实测。
- 未通读 src/trivium/adapters/zcode.ts 全文（仅头注与 grep 命中行）；核心 registry.ts 与 skills-src/carriers/*.yaml 未直接读，对账面经 extension/test/unit/carriers.test.ts 间接核对。
- runM1.mjs 仅 grep 抽查：现脚本硬编码入口 B（77 行）且 --glm-timing 有守卫条件，计划「沿用 runM1 但选入口 A」所需 harness 改造量未完整评估；runE2E.mjs 未读。
- v2 基线文档仅 grep 命中行未通读；官方 macOS 直接可执行 zcode 发行物当前是否存在未核实（Phase 4 当时 command -v 无、官方 releases 404，计划直启支建立在任务前提上）。
- Windows 与非 macOS 平台不在本计划范围，未审；doc/07_manuals 经 grep 未见驾驶舱启动口径副本，但该目录未逐文件通读。
- 未读取另一位审查员的任何产出，背靠背独立性保持。

## 实际查阅的项目文件

- `.reviews/驾驶舱GLM主攻交互入口/plan/2026-11-20-驾驶舱GLM主攻交互入口-codex.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `extension/src/launch/carriers.ts`
- `extension/src/launch/terminalRelay.ts`
- `extension/src/launch/entryCommand.ts`
- `extension/src/launch/zcodeTurns.ts`
- `extension/src/ui/cockpit.ts`
- `extension/README.md`
- `extension/package.json`
- `extension/test/unit/carriers.test.ts`
- `extension/scripts/runM1.mjs`
- `src/trivium/adapters/zcode.ts`
- `doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md`
- `doc/05_testing/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/02_design/系统设计说明书.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":18,"grep":7,"glob":7,"run_command":0,"project_reads":21}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
