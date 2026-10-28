# Kimi Code 与 Qoder CN 双平台验收清单

2026-10-29 main/2b52e24e新隔离B复验见[报告第11节](REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md#11-main--2b52e24e-新隔离根真实命令b复验2026-10-29)及[原始证据索引](evidence/qoder-plan-B-20261029-retest/index.json)。以下为最新分项；后文全部保留其历史时点。

| 2b52e24e新B项目 | 本次状态 | 证据及边界 |
| --- | --- | --- |
| 新隔离根与备料 | 已核实 | hBF8Sm、独立run_root；drafts预建且为空，不代领、不预写计划；与旧m5Km0O区分 |
| 装置/权限/防覆盖/轮次/日志与监督 | 离线回归通过，真实全链未测 | 七个具名Edit暂存路径、dontAsk、私有user settings；Write同ID/hash凭据后才准artifact；最终13项定向、完整check 4185通过/9跳过/0失败，219文件冻结一致 |
| 完整生产preflight及两家认证 | 通过 | gemini-3.8-flash-high/high、GLM-5.3；各一次真实认证，无skip-auth、单审、doctor或额外探针；认证不等于正式评审 |
| 官方B原文、来源字节与原生加载 | 部分已证 | 1.1.80；私有入口hash一致，原生目录及stderr activation存在；无独立Skill/入口Read事件或展开正文逐字回读 |
| 本轮首次工具与正式B结果 | **失败并立即停止** | 唯一test -f复合Bash被同ID原生权限拒绝，decisionPoint=mode.dont_ask.deny；wrapper未执行，不能记为其退64；上游需确认分支未知 |
| claim/材料阅读/原稿Write/artifact | **未测** | 全部尚未发生，drafts仍空；不换tee、补正文或重启；上轮Write正控制沿用但不代替本批链 |
| 正式双审、身份交接、worker、requested_routes | **未测** | 两家正式评审均0、正式轮次0，无新run；配置路线不能当冻结请求快照 |
| 读意见、逐条裁决、下一计划、gate | **未测** | 没有正式意见或写入链，不由CLI退出码或预检通过推断 |
| 官方路线与底层身份 | Auto/auto；底层未知 | 原生计费回读0.90504282 credits，底层模型/provider均null；不把Auto认作模型 |
| 新旧B审批状态 | 新未到达；旧原样待审批 | 新无run/task/state，new_gate=null；旧20261028T151257Z state=awaiting_approval、approvals=[]、task.gate=idle，run.gate为运行期快照 |
| 生产、版本、安装、全局与清理 | 已回读，未提升准入 | 六开关false、1.3.2、生产src未变；安装bundle和14份入口不变、全局14项hash不变；新私有HOME不存在，具名进程/认证根无残留；逃逸后代/SIGKILL仍未测 |
| 剩余与下一项 | 仍未完成Driver准入 | 先离线核精确存在性检查授权/上游分支，补回归；另行授权后才可又一新根真实B。Kimi/A/C/D/桌面/插件/Windows、人工审批与Git交付均未执行 |

以下“日期/状态”为原始清单时点，以以上最新分项为本轮结果。

日期：2026-10-27。负责人：Bob / Codex。状态：待执行，双角色接入尚未交付。

2026-10-29 main/f7167326归档与写权限复核见[报告第10节](REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md#10-main--f7167326-归档契约与原生写入正控制2026-10-29)。以下为最新分项，后续旧表保留其历史时点。

| f7167326本批项目 | 状态 | 证据及边界 |
| --- | --- | --- |
| archive唯一出口/正式B/夹具契约 | 已核实并纠偏 | 唯一出口约束编排器工件模块；Driver可按正式入口自写，artifact是附加传输。旧“通道违规”仅适用装置条件，产品gate结论不改 |
| 旧Write与Bash拒绝/tee成功 | 原始事实已配对；部分分支未知 | 6个原生拒绝、两条tee正文hash成功；旧上游decisionPoint未保存，不判为已证客户端缺陷 |
| 三次artifact 64与轮次 | 已核根因并修装置 | help缺失、错误来源域、暂存ENOENT分别记录；revised取run轮次，下一计划取subject+1 |
| 装置修正与离线回归 | 通过自动化 | 10项定向；完整check 4182通过/9跳过/0失败，冻结指纹未变；不代表真实B |
| 一次真实Qoder原稿Write/归档链 | **通过本次正控制** | 同版本1.1.80、dontAsk；Write命中fs_write.rule.allow，claim/artifact精确规则、同ID/argv/cwd/底层0/hash一致；原稿由客户端撰写 |
| 仅两条Bash提示与正文实测准确性 | 有偏离/局限 | 额外一次只读ls被native允许；正文git status表述无执行事件，不采为实测；不宣称整场完全按提示或计划质量通过 |
| 正式B重新通过、真实裁决/下一版链 | **未测** | 审核者0、正式技能0；新B采集器配方没有完整真实复跑，不以正控制替代 |
| 旧B审批状态 | 原样保留 | state=awaiting_approval/run20261028T151257Z，approvals=[]；task.gate=idle、run.gate为运行期快照；更正旧“双落点”说法，不迁移 |
| 生产、全局、安装与清理 | 已回读 | 六开关false、版本1.3.2、生产src未变；全局14项hash不变，安装bundle不变、14份入口匹配；新认证根不存在、相关进程无残留 |
| 下一次B/其它平台与范围 | 待独立授权/未测 | 全新根及生产preflight、真实原稿和全部写链；旧根不补写；Kimi/A/C/D/桌面/插件/Windows、审批恢复和完整逃逸清理未测 |


2026-10-28 main/3f85882f续验见[报告第9节](REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md#9-main--3f85882f-qoder-cn命令b续验2026-10-28)。已纠正第8节把可选原生路径deny移作gemini/glm硬前置的判定；既有获准机制与完整生产预检仍必须满足。以下表格为0048e086历史批次，不覆盖第9节的新事实；不重复已通过项。

| 3f85882f续批真实B环节 | 状态 | 证据与边界 |
| --- | --- | --- |
| 两家现行前置与认证刷新 | 完整生产preflight通过 | 各一次认证调用；path_deny仍false/null，不记硬隔离通过 |
| 官方Qoder 1.1.80原文B入口 | 实际调用 | 私有正式入口hash匹配；Auto/auto仅路线标签，底层null；无独立Skill/入口Read事件 |
| 原生claim与原稿 | noop调用已证；原稿为既有备料 | qoder-cn声明与原稿未变；另写原稿被拒，不能算成功撰写 |
| 真实worker、run.driver/handoff、requested_routes | 实际完成 | run=20261028T151257Z，两处driver均qoder-cn；两家冻结请求逐项一致；恢复身份依源码强制核对与实际运行证据，无独立身份遥测 |
| Gemini/GLM真实审查与跑后核验 | 完成 | 各一次审查、无降级；两家evidence_ok；无禁读命中、只读失守或漂移；不替代路径事前拒绝 |
| 完整读审查、客户端写裁决/r2 | 实际完成 | Read逐行一致；六条逐项裁决，五接受一暂缓；两条真实tee正文hash与文件相同 |
| 专用archive归档通道/首次无误调用 | **不通过** | 三次装置64、6次原生权限拒绝；最终tee直接写归档，不能把成功文件算成被拒Write成功 |
| gate与人工停点 | 到达并保留 | gate检查/停点0，awaiting_approval；真实B有上述例外，完整验收不通过；审批入口见报告9.4 |
| 自动化/安装/清理 | 已核 | 7项定向；完整check 4179通过/9跳过/0失败；不安装候选；全局hash不变，私有Qoder认证根已清理 |
| 正式产品与其它范围 | 不提升 | 六开关false、版本1.3.2；其它平台/载体/命令未测；未审批、恢复、abandon或Git交付 |

| 0048e086历史Qoder CN命令B环节 | 状态 | 证据与边界 |
| --- | --- | --- |
| 旧夹具有效HEAD、原稿、candidate hash | 通过 | 离线回读；旧夹具不改 |
| 新独立Git夹具、run_root、候选构建、清理责任 | 通过 | 无凭据，仅候选Driver开关变换；不安装 |
| B专用wrapper/归档通道 | 自动化通过；正式能力未测 | 拒绝其它入口/身份/集合和审批，启动前置失败退69 |
| 固定两审路线声明及来源指纹 | 通过 | gemini-3.8-flash-high/high、GLM-5.3/null；实际模型回读未测 |
| 当前账号真实可调用 | 阻塞/未测 | 历史认证缓存指纹匹配但已过TTL；没有重探凑绿 |
| gemini/glm严格只读与禁读覆盖 | 阻塞 | 既有path_deny=false及同行读取反例，覆盖/形状null，不是本批新反例 |
| 真实Qoder斜杠入口、工具ID、argv/cwd与退出码 | 未测 | 严格前置失败，未启动客户端；本地备料账本不代替 |
| 原稿认领/后缀 | 备料通过；真实客户端未测 | 装置认领，claimed_by=unknown-session，qoder-cn原稿；固定正文不算真实撰写 |
| run.driver、handoff、worker身份、requested_routes冻结核对 | 未测 | 无run，不补写 |
| 两家真实审查、修订计划、逐条裁决、gate | 未测 | 不伪造审核意见或裁决 |
| 人工审批停点/确切审批入口 | 未到达/null | 没有可供approve的run；下一入口仍是原Qoder命令B |
| 生产Driver、审核者、默认选侧 | 关闭/阻塞 | Kimi与Qoder六开关false，候选不等于正式产品 |

2026-10-28 main/892c4767续验以[报告第7节](REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md#7-main--892c4767-独立身份续验2026-10-28)为最新事实：Bob完成Kimi私有官方登录后，两家均取得真实模型的plan/code/bug认领、归属材料、第二官方CLI会话继承、noop及异身份退64；实际安装入口经Read加载为参考，正式四条斜杠入口未执行。Qoder一次fixture-draft参数错误被拒后纠正，独立身份项通过，但原件整场总检查仍失败，不能抹除。以下早期“认证阻塞”保留为历史时点。

| 本批macOS独立项 | Kimi | Qoder CN | 边界 |
| --- | --- | --- | --- |
| 真实模型status | 通过 | 沿用上一批通过，本批未重跑 | Kimi原生Skill→Bash→底层退出0 |
| plan/code/bug实际入口参考加载、Driver认领及归属材料 | 三阶段通过 | 三阶段通过 | 候选隔离；正文由archive夹具生成，不代表正式原稿质量 |
| 第二官方CLI进程继承、幂等、错误身份拒绝 | 三阶段通过 | 三阶段通过 | 有真实模型工具与落盘关联；不等于审核worker交接 |
| 首次无误调用总检查 | 通过 | 失败（参数错误后纠正） | 分列单项与整场；原件passed=false保留 |
| Kimi真实模型特殊字符参数 | 未测 | 上一批通过 | 不升级旧受控来源 |
| 跨进程序列化契约测试、有效Git HEAD/材料/run_root夹具 | 通过 | 通过 | 独立自动化，不启动审查 |
| 正式A/B/C/D、worker、裁决、人工停点/恢复/放弃 | 未测 | 未测 | 具体文本与前置条件已准备，wrapper未解锁 |
| 生产Driver、严格只读审核者准入 | 阻塞，开关关闭 | 阻塞，开关关闭 | 本批未做审核者重测 |
| 桌面端、Kimi Extension Host、Windows全部 | 未测 | 未测 | 仍逐客户端、逐平台验收 |

2026-10-28 Driver独立续批：[报告与逐项证据](REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md)。两家macOS CLI七技能发现/来源与同名控制已测，Qoder官方真实模型status通过；Kimi仅受控原生Skill→Bash→status通过，真实模型认证前置阻塞。独立构建两家认领/另一进程继承通过，实际审核worker未测。下文历史“十行全部未测”是本轮前基线，以以下细分矩阵更新，不整体提升为Driver通过。

| macOS CLI独立项 | Kimi | Qoder CN | 证据类别 |
| --- | --- | --- | --- |
| 身份/版本/七技能来源、唯一数量 | 通过 | 通过 | 官方CLI实际输出；Kimi使用受控响应捕获原生目录 |
| 共享哨兵/同名来源、安装拒绝重复项 | 通过（仅所测根） | 通过（仅所测根） | 原生发现及生产安装检查 |
| 中文空格cwd/特殊字符argv/底层status退出0 | 受控原生通过，真实模型未测 | 真实模型通过 | 不跨来源合并 |
| 独立候选Driver认领、原稿归属、第二进程继承 | 通过 | 通过 | 临时构建，本地自动化；生产仍退64 |
| A/B/C/D、worker交接、裁决、人工停点、恢复/放弃 | 未测 | 未测 | 待Bob显式正式入口 |
| 桌面端、Kimi VS Code Extension Host | 未测 | 未测/不含Qoder插件 | 各自客户端取证 |
| Windows全部项目 | 未测 | 未测 | 不继承macOS |

2026-10-28 追加：Kimi macOS 新根因工具与复跑命令见 [实验说明](../../scripts/acceptance/kimi-qoder-cn/README.md)、[本次报告](./REPORT_2026-10-28_KimiCode_macOS规则根因与只读准入.md)。它们不修改以下旧 probe / Windows 控制臂，不把本地受控机制结果填入真实路线准入列。两个开关仍关闭，Windows/其它客户端仍未测。

本清单分开记录能力前置和交付后验收。产品已登记两个 L2 Driver 并生成入口产物，但尚未完成本机安装、客户端调用和审核者安全准入；不能提前把后半部分填写为通过。macOS 当前结果见[前置取证报告](./REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md)。

## 1. Windows 能力取证（现在可复跑）

使用 Windows 原生 Node ≥ 18（建议 ≥ 22）、Git for Windows 和已经登录的两家官方 CLI。确认 Qoder 是 CN 产品，入口版本应明确显示 CN；国际版、IDE、插件不代替 CLI。不要更改全局供应商、模型或账号配置。

在含中文与空格的仓库路径准备本工作树及依赖。脚本只复制需要的原生认证文件到临时目录，先用当前用户 SID 收紧 Windows ACL；认证文件不存在、形状不支持或 ACL 设置失败即停止。Kimi 只接受当前已配置的官方 managed provider，Qoder 的 `auto` 是本次显式实验选择，不是已验证的生产默认模型。

在 PowerShell 中运行（把示例路径替换为本机实际路径）：

```powershell
Set-Location 'C:\验收 工作\TriviumCode'
node --version
git --version
& 'C:\实际路径\kimi.exe' --version
& 'C:\实际路径\qoderclicn.exe' --version
& .\scripts\acceptance\kimi-qoder-cn\windows.ps1 `
  -KimiExe 'C:\实际路径\kimi.exe' `
  -QoderCnExe 'C:\实际路径\qoderclicn.exe' `
  -OutputDirectory 'C:\验收 工作\Kimi Qoder证据\PowerShell'
```

在 Git Bash 中另跑一份独立证据：

```bash
cd '/c/验收 工作/TriviumCode'
bash scripts/acceptance/kimi-qoder-cn/git-bash.sh \
  '/c/实际路径/kimi.exe' '/c/实际路径/qoderclicn.exe' \
  '/c/验收 工作/Kimi Qoder证据/Git Bash'
```

若 PowerShell 执行策略不允许脚本，不修改全局执行策略；直接逐条运行以下 Node 命令，把 `open` 依次改成 `deny`、`tools`、`failure`、`cancel`，然后对另一家重复：

```powershell
node .\scripts\acceptance\kimi-qoder-cn\probe.mjs --agent kimi --bin 'C:\实际路径\kimi.exe' --case open --output 'C:\验收 工作\证据'
node .\scripts\acceptance\kimi-qoder-cn\probe.mjs --agent qoder-cn --bin 'C:\实际路径\qoderclicn.exe' --case open --output 'C:\验收 工作\证据'
```

Kimi 追加工具级禁读对照：`--agent kimi --case deny --rule-mode tool-deny`。每次 `open/deny/tools/failure` 至多 180 秒，`cancel` 为 1.5 秒超时触发，另有版本/配置校验及结束宽限。两份包装脚本均为 Windows **未测**，不得把 macOS 的语法检查当作 Windows 验收。

Kimi 规则定位新增 `--rule-mode none|allow-only|deny-only|allow-first|paths-only`，分别表示无自定义规则、仅三种读工具 allow、仅三种读工具 deny、allow 在前再 deny、仅路径 deny。旧 `paths` 和 `tool-deny` 形状保留。逐次指定一个值，结合实际调用判读；这些是根因对照，不能自动登记准入。JSON 记录生成的 `permission_rules`。Windows 新控制臂全部未测。

| 用例 | 必须核对 | 当前 Windows 状态 |
| --- | --- | --- |
| open | Read、Grep、Glob 实际调用、普通 canary、正确 cwd、中文空格路径 | 未测 |
| deny | 同行工件/敏感文件的 Read 实际拒绝；Grep/Glob 不泄漏；与能读出的对照逐项配对 | 未测 |
| tools | 有效工具面仅 Read/Grep/Glob；实际禁用工具调用被执行层拒绝及成功放开对照 | 未测 |
| failure | 不存在模型应拒绝；回退警告不能被当成功；请求与回读分开 | 未测 |
| cancel | 原生进程超时、派生进程树退出、无遗留配额进程、凭据副本清理 | 未测 |
| 扩展注入 | 项目/全局 Hook、MCP、插件、技能、子代理不能绕过隔离 | 未测 |
| 路径变体 | 相对/绝对路径、分隔符、大小写、符号链接/联接点、中文空格 | 未测 |

JSON 的 `待核验` 只表示采集完成；`admission` 始终为 false。`tools` 没有实际禁用工具调用时标“未测”。`cancel` 只自动记录超时与清理，`process_tree_exit_verified` 为 false；不能据此判整树退出通过。Bob 应用任务管理器或只读进程查询观察该次 CLI 的 PID、父 PID、创建时间及取消后的退出，避免回传完整命令行中的敏感值。不能用 PID 单独判定身份。

正常完成及可捕获信号下脚本清理临时根。强制断电、SIGKILL 或整个 Node 进程被系统强杀的异常清理仍未测；若发生，先停止同次 CLI 派生树，再由 Bob 检查系统临时目录中的 `trivium-native-probe-*`，只清理对应本次测试的临时目录，不触碰原生账号目录。

## 2. 五个 Driver 客户端（生产接入就绪后执行）

每个平台分别执行以下五行，不能跨客户端借用结果。当前十行全部“未测”：

| 客户端 | macOS | Windows | 身份证据 |
| --- | --- | --- | --- |
| Kimi 官方 CLI | 未测 | 未测 | 实际 exe/二进制、版本、会话 cwd |
| Kimi Code 桌面端 | 未测 | 未测 | 关于页、工作区、技能清单与实际会话 |
| VS Code Kimi Code 插件 | 未测 | 未测 | VS Code/插件版本及 Extension Host 实际调用日志 |
| Qoder CN 官方 CLI | 未测 | 未测 | CN 产品、原生入口、版本、原生路线 |
| Qoder CN 桌面端 | 未测 | 未测 | CN 关于页、工作区、技能清单与实际会话 |

逐客户端界面步骤：

1. 打开隔离验收项目（中文空格路径），记录当前工作区路径和客户端版本；不使用正在进行业务工作的会话。
2. 打开技能/命令清单，记录 `dual-run`、`dual-review-plan`、`dual-review-code`、`dual-review-bug`、`dual-approve`、`dual-status`、`dual-abandon` 七项。记录实际读取路径、同名项数量、来源和生效优先级；发现另一个 Agent 的同名入口则阻塞，不删除它来凑通过。
3. 用客户端实际显示的调用语法调用 status；记录正文含单引号、美元符、中文空格和 `--` 字面时的传参证据。不得凭文档猜每个 GUI 与 CLI 语法相同。
4. 在验收项目使用固定 `gemini,glm` 审核者完成真实预检；缺账号或模型则该项阻塞，不自行缩减集合。依次验 A/B/C/D：阶段认领、原稿、真实审查、逐条裁决、gate。run 与工件的 Driver 必须分别为 kimi 或 qoder-cn；不得自审。
5. B/C/D 的人工审批由 Bob 发起，截图并核对审批前停点和审批后恢复。A 通常无人工审批，只有达到最大轮次等实际触发条件才验对应停点，未触发的格子记未测，不能强造通过记录。另建可放弃的测试主题验 abandon。
6. 每项保存客户端界面与脱敏运行工件的关联。CLI 会话不能替代图形客户端。VS Code 必须在 Kimi 插件面板发起，并取得 Extension Host 内启动/调用/结果关联证据；集成终端启动 CLI 不算。

七技能 × 五客户端 × 两平台逐格登记“通过/失败/未测/阻塞”；任务入口的真实运行、身份、裁决、人工停点、恢复分别登记，不能只填一列总通过。

## 3. Bob 回传清单与核验

回传：版本与二进制 SHA-256、操作系统与 Node/Git 版本、两套终端证据 JSON、各调用退出码、五客户端七技能矩阵、GUI 截图、Extension Host 脱敏日志、原生进程树取消记录、凭据清理结果、对应 run/meta/裁决路径及哈希。

不要回传账号配置原件、认证文件、token、完整用户目录或厂商运行目录。证据脚本会做已知凭据逐值与模式脱敏；回传前仍检查邮箱、用户标识、业务文件内容和未知格式密钥。随机 canary 是专门生成的虚构内容，可以保留以核验泄漏。

Codex 收到后按脚本/二进制指纹、平台、请求与回读、调用↔结果关联、拒绝与正向对照、退出/取消/清理逐项复核。缺失证据保持 null/unknown/未测，不追加为历史通过。
