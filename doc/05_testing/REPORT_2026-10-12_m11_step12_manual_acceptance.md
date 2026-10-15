# M11 第12步全量手工验收与收口

本轮起点为 `65e0ea6997a848537f83d79a6bfcacfa48f1796c`，main 工作树干净。Codex 主攻，真实客户端剧本按各自 Driver 验证，Codex 仍为 L2。上位依据为获批计划 r3 §4.12 与 CASE 剧本1～11。当前执行中，**尚未满足 M11 完成判据**。

## 验收矩阵与分批

逐剧本、逐判据的68格矩阵见 [matrix.md](./evidence/m11-step12-20261012/matrix.md) 与 [matrix.json](./evidence/m11-step12-20261012/matrix.json)。其中9.6、11.7为可选，本轮不默认扩大范围。剧本1～7及新增必需判据必须本轮实跑，历史报告、桩与离线检查不替代真实客户端验收。

[预算清单](./evidence/m11-step12-20261012/budget-plan.json)保留旧admission795/815、review373/398；初始本步子上限20/60、总80（后按Bob明确同意修订为40/40，见后文），版本/帮助/失败/超时/包装器与native边界/重试均累计。必要扩容事前追加，不覆盖旧台账、不跨池。客户端批次与硬停止点另见 [client-batch.json](./evidence/m11-step12-20261012/client-batch.json)。

## 本轮零配额实跑

- [baseline.json](./evidence/m11-step12-20261012/baseline.json)：A批90项与受控批150项冻结来源全部一致；生产作用面 `7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f`；四目标28入口逐字hash一致，七个共享同名入口缺席。没有重新迁移或修改全局配置。
- [installed-selftest.json](./evidence/m11-step12-20261012/installed-selftest.json)：安装副本doctor桩自检14步、退出0。本项不证明真实UI、Hook集成或真实模型能力。
- 四条本轮参数负对照（`negative-{tier,effort,glm-effort,profile}.json`）全部退出64，累计两池不变。另实跑不存在profile的准备阶段负对照，退出64、归档hash前后完全一致、两池不变（[negative-profile-prepare.json](./evidence/m11-step12-20261012/negative-profile-prepare.json)）。修正CASE示例注释中的旧69口径，11.1判据本身不变。
- 按用户要求启用 `test/contract/evolution-ledger-parity.test.ts` 的 `NO_PENDING_SKIP=false`；台账全绿只证明文档并入，不代表全量手工验收完成。

## 真实载体与隔离项目

Bob明确答复“现在可操作，Claude Code使用Qwen”。通过computer-use观察到VS Code打开TriviumCode窗口，本次观察仅证明窗口存在，入口发现与Hook实际事件不据窗口存在判通过。初始采样随后收到Bob直接答复“有7个入口”，据此记录Claude Code七入口可见；该采样时刻具体Qwen模型未回答，保持null，当时尚无入口执行及Hook集成通过结论。见 [客户端人工记录](./evidence/m11-step12-20261012/client-observation-01.json)。

既有 `/Users/chenzhenbo/Work/trivium-m11-accept` 有未提交业务改动，未触碰。新建 `/Users/chenzhenbo/Work/trivium-m11-step12-20261012`，初始化安装副本、真实Git基线与BoundedStack小项目；本批主题 `m11-s12-stack` 验证新增peek功能的命令A流程，不借旧准入主题的额外轮数。副本只复用仍在TTL且入口一致的agy/zcode/codex CLI事实，不复制认证，不复制Claude绑定项目的目录证明，不延伸五组合受限准入到新项目。所有审核者调用走安装编排器及既有预算模块，附加本步上限，原始调用记录保存在项目外独立目录。

## 首次真实客户端运行与定向修正

Claude Code / Qwen 实际识别命令 A，S0.5 成功提取主题、目标与两侧；S0.6 因验收准备遗漏 `probe.generated_at` 退出69，客户端停止，没有正式run_id、业务写入或厂商CLI启动。原始调用见 [client-attempt-01.json](./evidence/m11-step12-20261012/client-attempt-01.json)，脱敏会话命令及结果见 [client-session-01.json](./evidence/m11-step12-20261012/client-session-01.json)。客户端 `assistant.message.model` 为 `qwen3.8-flash`，但原运行声明仍为null；这是客户端标识，不是服务端身份验证。

这是本轮准备脚本的问题，不能据此说本机从未跑探针。已在独立项目补回来源原始 `generated_at=2026-10-11T00:12:57.895Z`，逐CLI `probed_at` 不变；没有复制认证、没有刷新时间戳、没有变更生产guard或降低判据。见 [修正证据](./evidence/m11-step12-20261012/fixture-provenance-repair.json)。恢复批只允许同主题从S0.6恢复一次，新失败即停；admission预计6、硬6，review预计8、硬10，原首次失败记录保留。

## 历史辅助证据与边界

第10步文档报告用于说明§24并入范围；第11步AC-23报告用于说明请求/回读分列及gemini可回读、codex/claude明确记空的达成边界，不作为本轮剧本11实跑。AC-25维持第3步已达成的路径通道、三审形态、桩级范围，不扩为真实轨迹覆盖或自动重跑。

受限准入仍严格采用[独立批准记录](./evidence/agent-access-convergence-20261012/restricted-admission-user-decision.json)绑定范围：7组合原标准通过、5个Claude组合受限准入，原标准 `prerequisite_complete=false`；五组合真实模型写尝试未测，受控 `actual_provider_inference=false`、`real_model_attempt=null`，服务端身份null。没有重新开启准入整改，也没有改变原历史结论。

## 收口条件

串行两次 `npm run check` 均退出0；每次3624项、3622通过、0失败、2个既有条件跳过（不含已启用的台账断言）。完整原始结果见 [check-1.json](./evidence/m11-step12-20261012/check-1.json)、[check-2.json](./evidence/m11-step12-20261012/check-2.json)。[构建后适用性复核](./evidence/m11-step12-20261012/post-check-applicability.json)确认四目标28入口与安装bundle未变；仓库重建bundle仅构建戳不同，历史整文件hash不再适用于该重建产物，真实验收继续消费原安装副本，未重装、未延伸例外。

[Hook CLI辅助记录](./evidence/m11-step12-20261012/hook-cli.json)的10条真实归档判定均符合预期，但没有触发客户端Hook事件；不替代剧本5/6的客户端集成部分。后续真实批次及客户端操作记录待追加。本轮未完成前，主设计16.1、PRD AC-23/FR-30/S8与演进设计M11达成状态不翻绿；AC-25保持原已达成边界。任何新运行审批均需要Bob当次决定，不使用旧批准，也不自行approve。

## 命令A真实闭环（2026-10-12 20:47至21:05，Asia/Singapore）

恢复预检实际执行新认证探活并通过。plan运行 `20261012T125354Z` 与code运行 `20261012T130035Z` 均success、full；gemini为 `gemini-3.8-flash-high`（envelope回读），glm为 `bigmodel-coding-plan/GLM-5.3`（trace回读），各侧首尝试成功。两轮均 `readonly_breach=false`、`snapshot.drift.changed=false`。Driver为Claude Code/Qwen，运行模型声明保持null；客户端模型标识qwen3.8-flash另列，不补写历史。

计划轮两侧零意见；代码轮gemini零意见，glm提出GLM-01（存量容量校验，暂缓到独立变更）和GLM-02（peek语义注释，接受并落实）。两条意见均有真实逐条裁决，gate通过；plan裁决空占位行出现parse_problem告警但failures为空，原样保存。verify运行 `20261012T130542Z` 真实执行npm run build与npm test，两条命令退出0、3项测试通过。Bob确认全程未切换窗口，也没有额外交互授权。

完整命令、退出状态、预算、运行记录、工件、脱敏stdout与轨迹见 [client-a-runs.json](./evidence/m11-step12-20261012/client-a-runs.json)，客户端原始消息见 [client-session-02.json](./evidence/m11-step12-20261012/client-session-02.json)。[进程采样](./evidence/m11-step12-20261012/client-a-processes.json)在代码审查进行中抓到两侧真实cwd、hub的add-dir、归档结论缺席以及两侧齐备后的落盘；采样没有覆盖计划运行时段，2.4的计划阶段物理目录证据仍待补。

客户端执行中的非厂商错误也保留：首次助手输入rerunIndex=null失败，改为1后通过archive.ts写原稿；错误的树外运行目录查询重复两次。均不计为厂商CLI启动，亦不能从证据中删除。后续助手说明明确首轮rerunIndex为1。

## 当前交付边界与剩余行动

截至命令A收尾，本步新增14次CLI：admission +6至801/815，review +8至381/398。版本、Codex包装器/native与ZCode内部CLI边界均计入；两次审查运行不等于两次CLI。未扩容；本步20/60子上限及总80继续生效。

剧本1成功路径已实跑（1.4正式failed条件分支未触发，预检69保留另列），剧本2取得代码阶段进程与落盘证据，11.1负对照已实跑；其余状态逐格见矩阵。下一步推进B/C/D人工闸门、三审与两轮模型/档位对照、真实Hook负对照，以及ZCode/Codex与跨Driver流程。新运行审批仍由Bob逐次决定。本轮未满足M11完成判据。

主设计16.1、PRD、演进设计§14的M11状态未翻绿；AC-25原达成边界不变。五个受限Claude组合的真实写尝试仍未测，原标准前置条件仍false。

## B1准备与后续预算估算

Bob已再次确认当前Claude Code模型为qwen3.8-flash；仅用作新运行Driver声明，不回填命令A。B1通过独立容量校验任务共同取证计划阶段隔离、命令B人工闸门、三审首轮和档位首轮。路线与上限见 [B1批次](./evidence/m11-step12-20261012/client-batch-b1.json)，具体操作见 [客户端步骤](./evidence/m11-step12-20261012/client-steps-b1.md)。预计与硬限admission8/review6，累计809/387；发布不等于已经执行或通过。

B1准备再次核对原安装bundle及28入口，均不变；生产作用面和归档先前hash留存在 [准备记录](./evidence/m11-step12-20261012/b1-preparation.json)。只修改验收助手的正整数输入检查、只读采样字段和夹具任务清单，未修改生产适配器、guard/gate/hooks/schema或验收判据，未重建重装。验收助手对原始rerunIndex=null错误的定向复现已退出1，旧归档字节不变，见 [输入校验记录](./evidence/m11-step12-20261012/archive-input-validation.json)。本次文档与证据增量的索引/台账定向检查30项通过、0失败、0跳过；先前两次全量check仍按各自采样结果引用。

实测每次预检含4个版本启动边界，初始admission20估算不足。已提交 [40/40分池修订提案](./evidence/m11-step12-20261012/budget-repartition-proposal.json)：按联合取证预计38/35，共73次，预留7次，总80不变。该提案尚未批准、未生效、未扩容；B1可在原20/60内执行。旧台账不清零、不重分类、不跨池重记。

## B1真实三侧运行与预算修订（2026-10-12 21:41至21:48）

B1运行`20261012T134125Z`记录success/full，三侧首尝试完成；当前正式status出口确认plan处于awaiting_approval，尚无人工审批。GLM-01、CODEX-01、CODEX-02均接受并合入r2计划，gate检查覆盖三个编号且退出0。完整原始命令、运行、客户端和采样见 [运行证据](./evidence/m11-step12-20261012/client-b1-runs.json)、[客户端会话](./evidence/m11-step12-20261012/client-session-03.json)、[进程采样](./evidence/m11-step12-20261012/client-b1-processes.json)。

计划实时采样中，部分审核者已结束而归档仍只有Driver原稿与_meta，2.4取得本轮实证。Codex包装器及native参数均抓到-p kimi、-m kimi-for-coding、-c model_reasoning_effort=low；首轮tier来源cli，gemini为medium且回读medium/envelope，Codex effort回读null/unverified。三侧front-matter的15个档位/effort字段与元数据逐一相同，report人读及JSON输出如实区分未请求/无此概念/未回读到，见 [首轮对账](./evidence/m11-step12-20261012/b1-report-parity.json)。ZCode全局模型与跑前一致。

**B1不能称为合格三审全部通过**：Codex证据仅3次工具调用，小于原下限5，evidence_ok=false；审查件明确不得计为合格双审的一半。只读核验与结构化路径核验unavailable、三侧路径deny未生效、glm/codex镜头重合告警均保留。无门槛下调、无诱导工具重试、无生产修改；三条真实意见仍逐条裁决。[分项结论](./evidence/m11-step12-20261012/b1-assessment.json)把运行成功、档位功能通过、证据质量不足分开记录。

CASE4.3尚残留旧布尔true与名义Driver模型族写法，实际已批准v3为三态different-family/same-family/unknown。尤其原Python示例按真值判断，会把非空unknown字符串打印为异构。本次先提交 [具体修正提案](./evidence/m11-step12-20261012/case43-correction-proposal.md)，未擅改判据、未标绿。report顶部当前闸门来自只读归档task占位，仍显示idle；当前审批状态以正式status的全局state为准，不拿该历史字段证明已审批。

Bob明确答复“同意修订为40/40，总上限80”。[独立决定](./evidence/m11-step12-20261012/budget-repartition-user-decision.json)、[初始分池快照](./evidence/m11-step12-20261012/budget-plan-initial.json)、[修订计划](./evidence/m11-step12-20261012/budget-plan-revision-02.json)及[扩容回执](./evidence/m11-step12-20261012/budget-repartition-extension-receipts.json)均独立保存。既有extend机制追加admission815→835、review398→413，不重记既有消费，B1硬限8/6不变。旧提案的“待确认”按其采样时刻解释，以独立决定为准。

本批实际新增admission8、review6，本步累计14/14，共28次；当前809/835、387/413。客户端收尾误述review+3、start admission+1，不采用该人工估算；预占与完成的实际CLI边界记录为唯一计数依据。下一步是已发布的零厂商CLI客户端Hook负对照，再由Bob针对本轮决定审批。M11仍未完成，原五组合受限准入边界完全不变。

## 真实Hook拦截、CASE口径批准与B1人工决定

Claude Code真实工具事件确认：B1处于awaiting_approval时，`git log --oneline -1`退出0；Edit插入业务sentinel与Bash重定向创建sentinel文件均在PreToolUse写前被拦，两个Hook实际退出2，提示审批/放弃出口。源文件、测试文件hash与批次前一致，临时文件未创建，两池零增量。完整tool_use/tool_result配对、外壳调用和hash见 [真实Hook证据](./evidence/m11-step12-20261012/client-hook-gate-results.json)。这是3.2的B部分、6.5的闸门部分与6.6的闸门只读部分；审批后放行尚待独立实跑。

Bob已明确批准按当前v3规范修正CASE4，见 [独立答复](./evidence/m11-step12-20261012/case43-user-decision.json)。现要求different-family与Driver—审核者逐对比较一致，unknown明确不通过，Python展示不再把非空unknown字符串判成异族。B1三侧逐对模型、来源和原因均齐备；第二轮仍未测。旧提案和旧分项报告按采样时刻保留，不回写历史、不改变生产或准入阈值。

Bob随后明确答复“批准本轮计划，继续放行复测”。[本轮批准回执](./evidence/m11-step12-20261012/approval-b1.json)绑定主题、plan阶段、run `20261012T134125Z`、r2计划hash及精确审批命令；它是人工决定，不能代替客户端approve成功证据。已发布 [审批与放行步骤](./evidence/m11-step12-20261012/b1-approval-and-unlock.md)，厂商CLI预计/硬限均0，失败即停；此刻仍待客户端实际执行。Codex evidence_ok=false继续保留，批准不等于合格三审或M11完成。

本次增量的文档索引与演进台账检查30项通过、0失败、0跳过，见 [检查原始结果](./evidence/m11-step12-20261012/doc-check-hook-approval.json)。[CASE示例定向校验](./evidence/m11-step12-20261012/case43-validation.json)直接提取文档表达式，确认unknown显示未知、旧布尔显示旧版判定，并核对B1逐对来源。验收外壳语法检查通过；生产与安装产物未改动，无重建、重装或新增厂商调用。

## B1真实审批与放行、B2发布

2026-10-12 22:53至22:56（Asia/Singapore），Claude Code实际调用具名approve，退出0，正式status显示open_gates为空、approvals为1；审批原文包含工作树改动摘要。随后以闸门期同一Edit参数、同一Bash重定向命令复测，均成功；删除临时行与文件后，源码和测试文件hash均与B1准备快照相同，sentinel缺席。只读git log在闸门期及空闲期均放行。全部工具对、审批回执引用、外壳退出状态与文件hash见 [放行原始证据](./evidence/m11-step12-20261012/client-b1-unlock-results.json)。本小批两池增量均0，本步仍28/80；3.4的B部分、6.5和6.6取得本轮真实客户端证据，C/D仍待测。

B2按原计划在同一主题审查已批准r2计划，以deepseek profile/deepseek-flash/high替换首轮Codex kimi路线，Gemini明确high模型并请求low effort以验证告警与真实回读，GLM切到GLM-5.3。路线来自原探针确认目录；两profile的provider与endpoint互异，只有配置声明，不等于服务端身份验证。准备核对安装bundle、28入口和业务文件未变，第一轮工件hash另存，未重建重装、未复制认证。见 [准备记录](./evidence/m11-step12-20261012/b2-preparation.json)、[批次清单](./evidence/m11-step12-20261012/client-batch-b2.json)和[客户端步骤](./evidence/m11-step12-20261012/client-steps-b2.md)。本批预计/硬限admission8、review6，累计817/393；首次失败、69、漂移或预算拒绝立即停止。本节只记录发布，尚不宣称B2执行成功；B1批准不能用于B2。

## B2真实第二轮结果（2026-10-12 23:40起，Asia/Singapore）

run `20261012T154021Z`为plan第2轮，success/full，三侧evidence_ok均true；Codex记录14次工具调用、12次项目读取。五条意见（GLM-01、CODEX-01～04）全部接受，落入r3定稿，gate退出0、编号齐备、无警告；正式status为awaiting_approval。没有新增审批，B1批准不移用。原始留痕见 [运行与预算](./evidence/m11-step12-20261012/client-b2-runs.json)、[客户端会话](./evidence/m11-step12-20261012/client-session-04.json)，分项核对见 [B2核验](./evidence/m11-step12-20261012/b2-assessment.json)。

两轮三侧生效模型均发生预期变化且由envelope/trace回读；Driver—审核者逐对模型族均为different-family，Driver来源declared、审核者分别envelope/trace，并非所有来源都是declared。第二轮Codex profile/provider为deepseek，首轮为kimi，配置endpoint互异；ZCode全局配置整文件hash不变。第一轮既有工件全部字节不变，仅task索引随新轮正常更新，第二轮审查件使用r2后缀。CASE4各项与8.4～8.6已取得本轮两轮对照；8.2缺一行负对照仍未测，B1 Codex证据不足不追改，因此不称两轮合格三审全部通过。

CASE11精确指定轮：两侧tier=null、tier_source=override；Gemini effort请求low、生效high/envelope，预检明确告警low不生效；Codex请求high、生效null/unverified。三侧15个front-matter字段全部与元数据一致，report人读/JSON均退出0，第四节准确显示low→high告警、high→未回读到、GLM无此概念；首轮的Codex证据不足仍显示。可选11.7未执行。

本轮进程采样窗口15:04～15:34 UTC，早于15:40正式启动，故[B2采样文件](./evidence/m11-step12-20261012/client-b2-processes.json)不能证明本轮实时ps参数；不倒填、不为此重开审查。8.3和11.3要求的第一轮参数已有B1实时证据。本轮真实启动由预算边界与脱敏运行轨迹另证。guard保留Codex的orchestrator-state命令字面命中：原命令中的`.trivium`在find的`-not -path`排除式内，这支持误命中的解释，但不改变原guard值；未检出审查意见读取、readonly_breach或工作树漂移。三侧deny未生效与Codex核验降级继续明示。

预算实际为admission8（4个版本边界、4个探活边界）、review6（审查启动的包装器/native及ZCode内部边界），均到本批硬限。本步累计admission22、review20，共42/80；当前817/835、393/413，剩余18/20，不跨池。客户端“探活3＋审查3算review6、start算admission1”的口头账不采用。版本和认证均由既有编排器及预算机制执行，无手动CLI、无重试、无新增扩容。

建议批准r3容量计划，但其中npm回退不得改变正式验收判据：配置命令失败时先保留失败、停止正式验证，等价Node命令仅作辅助，不自动替换verify配置或判绿。[具名审批提案](./evidence/m11-step12-20261012/b2-approval-proposal.md)已提交Bob，尚待本轮明确决定。后续仍需Claude C/D、ZCode与Codex真实主攻及跨Driver、剩余Hook与缺件/改件/缺裁决行负对照；M11状态保持未完成，五组合受限准入边界不变。

随后Bob明确答复“批准本轮计划，保持正式verify判据”。[独立批准](./evidence/m11-step12-20261012/approval-b2.json)绑定本轮run和r3 hash；Codex主会话通过预算外壳执行具名approve，退出0，正式status为open_gates空、approvals=2，理由原文写入审批记录，见 [审批结果](./evidence/m11-step12-20261012/b2-approval-result.json)。该次载体为Codex主会话CLI（L2），不算新增Claude UI证据；B1已有真实UI入口及放行对照。未开始业务实现、未重开三审、厂商预算零增量。

已发布[H1客户端步骤](./evidence/m11-step12-20261012/client-hook-h1-steps.md)，仅六次真实Bash负对照补6.1～6.4，厂商CLI预计/硬限0；目标四文件的原字节备份位于归档外，[准备清单](./evidence/m11-step12-20261012/h1-preparation.json)保留hash与权限。预期Hook写前拦截；意外放行立即停，不由模型自行清理/恢复。此处只记录准备，尚不记通过。B2证据增量的文档索引/台账检查30项通过、0失败、0跳过，见 [检查原始结果](./evidence/m11-step12-20261012/doc-check-b2-results.json)。

## 2026-10-13续跑：H1核验与H2准备

[H1真实工具证据](./evidence/m11-step12-20261012/client-h1-results.json)确认六项各发起一次，六个PreToolUse:Bash结果均为编排器独占文件禁令，对应六个hook-pre-bash调用全部退出2；四个目标的hash和权限与归档外备份一致，未执行删除、覆盖或恢复。6.1～6.4已取得本轮真实客户端证据，预算仍817/393，本步42/80。该结论不代替剧本5完整性负对照或6.7。

[H2准备](./evidence/m11-step12-20261012/h2-preparation.json)与[逐步操作](./evidence/m11-step12-20261012/client-hook-h2-steps.md)已发布：Bob在系统终端仅临时取消本项目wrapper执行权限，Claude Code真实发起Edit、Bash及Stop，之后Bob在终端恢复+x。厂商CLI预计/硬限0。需逐个确认实际Hook事件及恢复后的hash/权限；看不到的项记未测，恢复核对前不启新批次。

本地日期跨到10月13日，验收落盘助手原固定首日日期已改为不传date，交给同一生产archive.ts的localDate默认值；生产代码、安装副本和历史工件均未改动。语法检查退出0、生产命名函数生成本地当日名称，零归档写入、零厂商启动，见[定向核验](./evidence/m11-step12-20261012/archive-date-followup.json)。这是验收助手的跨日修正，不触发生产重建、重装或准入重跑。

## H2部分实证、恢复及命令C准备（2026-10-13早间）

[H2原始事件](./evidence/m11-step12-20261012/client-h2-results.json)保留真实Edit的hook-pre-write拒绝、Bash中具名hook-pre-commit拒绝，以及5次Stop反馈。另一个hook-pre-bash没有独立呈现的执行结果，具名debug日志不存在，对应时段也没有其它可用进度事件；6.7仅部分完成，不从配置或另一个Hook推断通过。不重复触发Stop循环。期间一次Artifact list工具调用因未登录被拒，同样保留，不为此改认证或登录。

恢复核对确认wrapper为原755，wrapper、项目Hook配置、源码和测试的hash及权限均与H2前一致；未由主会话恢复受保护文件。两池仍817/393，本步42/80。恢复后独立验收可继续。[C批次](./evidence/m11-step12-20261012/client-batch-c.json)在既有peek主题执行code第2轮，只验命令C审查、应答与人工闸门；预计/硬限admission6、review4，累计823/397。Gemini和GLM沿用已核实的B2模型/effort路线，跨夜探活纳入预算；不实现容量计划，不沿用旧审批。[准备证据](./evidence/m11-step12-20261012/c-preparation.json)复核安装运行时、28入口及工件hash，[操作步骤](./evidence/m11-step12-20261012/client-steps-c.md)已发布，尚不宣称执行完成。

采样助手改为先只读status等待新批次开始，最长8小时；检测到真实运行后才高频采集，运行结束后停止，避免重复B2“30分钟窗口先于人工启动结束”的漏采。只改验收采样脚本，不启动厂商、不修改生产。旧B2实时ps缺口不回填。

跨夜冷缓存使余下四个正式入口至少需admission20、review15；当前40/40仅剩admission18。[44/36提案](./evidence/m11-step12-20261012/budget-repartition-proposal-03.json)预计本步42/35=77、余3，总上限80不变。提案尚未批准、未扩容，C可在现有40/40内继续；旧账不重分类，不自行跨池。

定向环境核对还发现：七个共享同名入口于2026-10-13 05:13（Asia/Singapore）重现，其中四份与四目标基线入口均不相同，来源unknown；[当前快照](./evidence/m11-step12-20261012/shared-entry-reappearance.json)保存hash、文件时间及匹配结果。初始“共享七入口缺席”只适用于当时采样。主会话未重新迁移或修改全局配置，原四目标28入口及安装运行时仍不变；Claude C消费已验证的Claude专属入口，后续Codex Driver入口解析来源须定向核对。此变化不自动触发全量准入重跑，也不延伸任何旧批准。

[共享计划入口定向差异](./evidence/m11-step12-20261012/shared-entry-source-diagnostic.json)显示它仍为Claude参数占位形态，并把driver字面替成大写`Codex`；已验证的专属Codex入口则使用小写`codex`。未烧CLI去试错、未再次迁移；后续Codex客户端须明确绑定专属入口并留存实际读取来源。本次四个验收脚本语法检查与30项文档索引/台账检查均通过，原始结果见[检查记录](./evidence/m11-step12-20261012/doc-check-h2-c.json)。

## C正式运行与44/36独立批准

Bob明确答复“同意44/36，总上限80”，[本次独立批准](./evidence/m11-step12-20261012/budget-repartition-user-decision-03.json)已保存。按既有机制只追加admission全局835→839，review全局413不改、本步附加上限收紧到409；[扩容回执](./evidence/m11-step12-20261012/budget-repartition-extension-receipts-03.json)和[第3版分池](./evidence/m11-step12-20261012/budget-plan-revision-03.json)保留完整链。旧账未清零或重分类，C批次6/4硬限不变。

C于2026-10-13 06:57启动code第2轮，run `20261012T225703Z`，success/full，Gemini与GLM证据阈值均通过，project_reads各7，无漂移、只读越界或对方工件读取。Gemini请求low、生效high/envelope；GLM模型由trace回读；逐对different-family，来源如实分开。14次进程采样已保留，见[运行原始证据](./evidence/m11-step12-20261012/client-c-runs.json)、[进程采样](./evidence/m11-step12-20261012/client-c-processes.json)、[实际客户端事件](./evidence/m11-step12-20261012/client-session-05.json)。

三条GLM意见逐条裁决：GLM-01接受并说明额外文件归属，GLM-02/03暂缓Codex Hook提示路径和环境变量静态风险。gate退出0，三编号齐备，无警告，正式status停awaiting_approval；无业务修改。[主会话核对](./evidence/m11-step12-20261012/c-assessment.json)同时纠正一项未经证实的归属：AGENTS主题清单确由prepare-b1.mjs调整，`.codex/hooks.json`来源却仍unknown，其创建时刻与共享入口重现相同不证明作者。原裁决不回写，Codex继续L2，暂缓项不自动授权护栏整改。

验收检查脚本初次把每轮可变的`changes.diff`便利副本当成冻结工件，退出1；[失败记录](./evidence/m11-step12-20261012/c-assessment-script-failure.json)保留。对照生产review.ts与hooks.ts后，仅豁免具名便利副本与task.json，并增加便利副本等于本轮冻结diff的hash校验；定向重跑通过，旧冻结工件字节均未变。未修改生产、配置或历史审查原件。

本批实际admission6/review4，当前823/397，本步28/24=52/80，剩余16/12。[C闸门实测步骤](./evidence/m11-step12-20261012/client-hook-c-gate-steps.md)已发布，预计/硬限零厂商CLI；[本轮审批提案](./evidence/m11-step12-20261012/c-approval-proposal.md)尚未获批。3.1及3.3的C部分已有真实证据；3.2/3.4仍待拦截、当次审批及放行。M11未完成，受限准入原边界不变。

本批两个新增脚本语法检查与30项文档索引/台账检查通过，证据脱敏扫描零命中，见[本轮检查](./evidence/m11-step12-20261012/doc-check-c-results.json)。未重建或重装，安装与准入指纹消费边界不变。

## C闸门负对照核实与当次批准

[C真实闸门事件](./evidence/m11-step12-20261012/client-c-gate-results.json)确认status仍awaiting_approval、approvals=0，唯一一次Edit被PreToolUse写前拦截并提示批准/拒绝/放弃。源码及Codex Hook配置hash未变，厂商CLI增量0，3.2的C部分通过。Bob当次明确答复“批准本轮应答，完成负对照后放行复测”，[独立批准回执](./evidence/m11-step12-20261012/approval-c.json)绑定run 20261012T225703Z及应答hash；仅授权本轮审批与放行复测。真实客户端[两步操作](./evidence/m11-step12-20261012/c-approval-and-unlock.md)已发布，尚不宣称实际审批成功。C的Hook暂缓项、来源unknown与Codex L2保持。

等待客户端期间，主会话仅以内存对象实际复现容量非法输入，完整Node命令/退出0/输出/source hash保存在[D根因辅助复现](./evidence/m11-step12-20261012/d-local-reproduction.json)。非法类型/数值被构造器接受，部分push触发隐式转换或延迟异常；zero合法且push拒绝为预期。不修改业务文件，不替代正式verify。D准备脚本与[客户端步骤草案](./evidence/m11-step12-20261012/client-steps-d.md)已写，但未执行prepare-d、未发布新批次、未启动审查；C放行核实是其前置。

本次续跑已再次跨过认证TTL，D草案预留admission6/review4，44/36获批总额不变；按余下计划最坏累计44/35=79，剩1次review。后续缓存若再次失效，须按真实余量停止，不跨池或自动增加总额度。

本批三个验收脚本语法检查、30项文档索引/台账检查及脱敏扫描通过，见[检查原件](./evidence/m11-step12-20261012/doc-check-c-gate-results.json)。本步预算仍28/24=52/80，生产与安装未改。

## C真实审批放行闭环与D发布

2026-10-13 21:38～21:39（Asia/Singapore），原Claude Code会话实际审批退出0，status显示open_gates空、approvals=1。同一组Edit参数由闸门期被拦变为审批后成功；随后仅删除sentinel行，源码、测试及Codex Hook配置hash均与准备快照一致。[C放行原始证据](./evidence/m11-step12-20261012/client-c-unlock-results.json)保存工具对、审批外壳回执与run绑定，厂商CLI增量0。首次归集时工具结果尚未齐备，退出1的[早期采样记录](./evidence/m11-step12-20261012/c-unlock-early-collection.json)保留；齐备后不改脚本重跑通过，未重复客户端动作。3.1～3.4的C部分均完成，D部分仍未测。

C闭环后，[D批次](./evidence/m11-step12-20261012/client-batch-d.json)与[准备核对](./evidence/m11-step12-20261012/d-preparation.json)已发布：既有capacity主题的bug第1轮，Claude/Qwen主攻，Gemini high模型请求low effort、GLM-5.3，预计/硬限admission6、review4，累计上限829/401。源码复现hash、安装运行时及四目标28入口一致；正式status无未关闭闸门。仅读取原配置，不刷新认证、不重建重装。新的只读采样器等待实际运行；[两步客户端操作](./evidence/m11-step12-20261012/client-steps-d.md)已交Bob，尚不宣称D启动或成功。

D仅起草和审查根因，不实施修复，裁决后必须停awaiting_approval。首个失败、69、漂移或预算拒绝即停，不重试；C的批准不移用。当前仍823/397、本步28/24=52/80，余16/12。受限准入边界与Codex L2不变，M11仍未完成。

本批新增归集脚本语法检查、30项文档索引/台账检查及脱敏扫描通过，见[本批检查原件](./evidence/m11-step12-20261012/doc-check-c-unlock-d-results.json)。

## 2026-10-15：D预检版本漂移与获批agy定向刷新

D的bug原稿已形成，阶段认领与解析成功；预检因agy探针1.3.3与实际1.3.5不一致退出69，未产生正式bug运行。[原始预检归集](./evidence/m11-step12-20261012/client-d-preflight-69-20261015.json)更正客户端“未烧任何厂商边界”的说法：实际有4次版本查询边界，admission823→827，review397不变。旧失败保留，不冒充正式审查失败或通过。

Bob当次明确授权“批准 agy 定向刷新，admission 最多 6 次，计入原总额 80；刷新后先报告，不启动 D。”[独立回执](./evidence/m11-step12-20261012/agy-refresh-20261015-approval.json)绑定独立验收项目、起点827/397、上限833/397及唯一命令`doctor --only agy --json`。验收外壳仅加入该具名命令的一次性授权，仍用原预算侧车、本步44/36分池及总80上限；未改D批次、未扩容、不启其它厂商探针。

[刷新原始结果](./evidence/m11-step12-20261012/agy-refresh-20261015-result.json)：agy1.3.5已真实执行版本、模型列表、文件读取、JSON Schema及路径负对照，共5次admission边界，全部子进程退出0。`headless_read_ok=true`且读取哨兵命中，`json_schema_ok=true`，`scratch_paths=[]`。路径负对照未命中，记录`path_deny.supported=false`，不能称路径隔离通过。新agy段及实测时间已由doctor写入独立项目的本地配置。

**doctor总体仍退出69**，唯一blocker为本项目预算wrapper不是`trivium init`生成的标准形态；原wrapper明确转发到`client-tv.mjs`。未执行init、未覆盖预算wrapper、未重跑doctor或preflight。安装bundle、四目标28入口、容量主题task及源码/测试hash均与刷新前一致。配置整体hash发生变化；初次采样中的`other_config_sha256`也不一致。[后续精确核对](./evidence/m11-step12-20261012/agy-refresh-20261015-config-reconciliation.json)确认：在原投影已排除agy、generated_at、host的基础上，从当前配置移除doctor新增的`probe.verify_suggestion`与`probe.auth`后，JSON序列化sha256与刷新前投影完全一致；其余配置一致，正式verify配置未改变。原采样false保留，不回写成true。

最终admission832、review397，本步37+24=61/80，余admission7、review12；本次5/6，无跨池。bug正式运行仍为空，D未启动，M11仍未完成。本次授权仅刷新，D恢复与验收wrapper诊断均未据此自动执行；受限Claude组合旧结论不延伸到此次变化后的新绑定。

两份验收脚本语法检查与30项文档索引/台账检查通过，原始证据脱敏扫描零命中，见[检查记录](./evidence/m11-step12-20261012/agy-refresh-20261015-checks.json)。本次未重建重装，未提交或推送。

## 2026-10-15：D单次恢复获批并发布，待原客户端执行

Bob明确批准准备并发布D单次恢复：admission最多6次、review最多4次，计入原总80，不跨池、不自动重试；由原Claude Code测试会话执行，裁决后停awaiting_approval，不审批、不修业务。[本次决定](./evidence/m11-step12-20261012/d-recovery01-user-decision.json)与[具名恢复批次](./evidence/m11-step12-20261012/client-batch-d-recovery01.json)已落盘，当前`client-batch.json`已切换为`D-Claude-recovery-01`。

[准备核对](./evidence/m11-step12-20261012/d-recovery01-preparation.json)确认预算起点832/397、绝对上限838/401，安装bundle与28入口未变，已有2026-10-15 bug原稿存在且hash绑定，源码与既有根因复现一致；新agy探针1.3.5及实测时间吻合，正式status无未关闭闸门，bug正式运行仍为空。仅执行零厂商调用的状态读取，未启动preflight、doctor或review；未修改业务、正式verify或安装配置。

[两条客户端消息](./evidence/m11-step12-20261012/client-steps-d-recovery01.md)要求复用既有原稿、不重建主题，正式preflight与review --start各最多一次；首个失败/69/漂移/预算拒绝即停，裁决后等待Bob另行审批。旧D操作页标注转向恢复页，首次批次与失败原件不改写。`collect-d.mjs`改消费具名恢复批次，避免把前次预检与探针刷新混入本批预算增量。doctor的wrapper形态blocker保留，不执行init、不据此豁免正式预检。

本次仅发布，不能记作D通过或已到审批停点。最坏再用10次后本步71/80，余admission1/review8；这不足以据旧估算承诺其余客户端批次全部完成，后续须按真实余量另行规划。当前预算仍61/80，M11未完成。

## D恢复批真实运行与人工停点（2026-10-15）

run `20261015T123051Z`，bug第1轮、entry D，实际`success/full`。Gemini与GLM两侧均`evidence_ok=true`、project_reads各7；回读分别为`gemini-3.8-flash-high`/envelope与`bigmodel-coding-plan/GLM-5.3`/trace。Gemini请求low、生效high按既定语义保留。无工作树漂移、只读越界或对方工件读取；两侧`peer_deny_applied=false`也保留，不以阴性结果宣称路径deny生效。原始材料见[运行归集](./evidence/m11-step12-20261012/client-d-runs.json)、[34份进程采样](./evidence/m11-step12-20261012/client-d-processes.json)、[真实客户端事件](./evidence/m11-step12-20261012/client-session-06.json)。

Gemini零意见；GLM-01～04全部接受，分别补充树外复现证据引用、将完整命令标注改为节选、归纳第四种恒满退化、收窄测试缺口至零容量等实际未覆盖路径。gate退出0、无failures或warnings，四编号齐备；正式status确认`m11-s12-capacity/bug`为`awaiting_approval`。[主会话核对](./evidence/m11-step12-20261012/d-assessment.json)确认原稿hash与恢复批绑定一致，裁决落bug目录，源码/测试hash与恢复前一致。裁决中“审查侧因禁读/检索范围无法访问树外原件”的归因未据此独立证明，gate通过只说明裁决齐备，不消除该证据边界。

**校正客户端预算转述**：实际admission6/6（四次版本查询边界＋两次探活），review4/4（agy一次、zcode三次边界），不是admission1、探活计review。累计838/401，本步43/28=71/80；获批分池为44/36，余admission1/review8。review总池未满，满的是本批4次上限；同样不得凭总池余量自行续跑。所有十次边界均退出0，当前无跨池、重试或超额证据。

矩阵3.1、3.3与3.5的D部分已有本轮实证；3.2审批前真实Edit拦截、3.4当次审批及放行仍未测。[D闸门负对照步骤](./evidence/m11-step12-20261012/client-hook-d-gate-steps.md)已准备，厂商CLI预计/硬限0，仅由原Claude客户端触发一次预期被拦的Edit；意外成功即停，不自行恢复。准备不等于执行，本次未审批、未实施修复、未提交，M11仍未完成。

## D真实审批前拦截核实，等待当次人工决定

[真实工具对核验](./evidence/m11-step12-20261012/client-d-gate-results.json)确认：客户端先执行status，capacity主题bug仍awaiting_approval、历史approvals=2；随后唯一一次Edit（`toolu_3e4b7e67176e4a809cfac2a9`）被写前拦截，提示的审批/拒绝/放弃出口均指向本主题bug阶段。当前bug运行仍为`20261015T123051Z`，该run没有审批记录；历史两次审批不属于本轮。

源码、测试与根因裁决hash均未变，预算保持838/401，本次admission/review增量均0。矩阵3.2的D部分通过，3.4的D审批与放行仍未测。已形成[具名审批提案](./evidence/m11-step12-20261012/d-approval-proposal.md)，建议仅批准本轮根因裁决并做零厂商CLI放行复测；保留树外证据访问原因未证实的边界。提案不是批准，本次未approve、未修业务、未提交，等待Bob当次决定。

## D当次根因裁决获批，零厂商审批/放行批次已发布

Bob明确批准`m11-s12-capacity / bug / 20261015T123051Z`本轮根因裁决，保留树外证据访问原因未证实的边界；仅授权原Claude Code会话审批及放行复测，零厂商CLI，不实施容量修复、不启动新审查、不提交。[独立批准回执](./evidence/m11-step12-20261012/approval-d.json)绑定本run、裁决全文sha256及含边界附言的精确approve参数。验收外壳额外核对回执中的裁决hash，原生产审批仍执行自身校验；不改变生产gate或审批规则。

[发布前核对](./evidence/m11-step12-20261012/d-approval-preparation.json)确认源码/测试与裁决未变、正式status仍为bug awaiting_approval且历史approvals=2、本run无审批。当前批次已发布为[D-Claude-approval](./evidence/m11-step12-20261012/client-batch-d-approved.json)，admission/review两池硬增量均0、绝对上限维持838/401，不允许追加厂商边界。准备过程只执行零厂商status读取，没有替原客户端执行approve。

[客户端两步操作](./evidence/m11-step12-20261012/d-approval-and-unlock.md)已发布：先单独执行具名审批入口，退出0后才验证历史approvals从2变3与本run批准记录，再做同参数Edit插入/删除sentinel。每步一次，失败即停。当前只有人工决定与准备证据，实际审批及放行复测仍未测，矩阵3.4不标通过，M11未完成。

## D真实审批、同参放行及恢复闭环核实

[放行原始证据](./evidence/m11-step12-20261012/client-d-unlock-results.json)确认原Claude客户端唯一一次具名approve退出0，外壳回执绑定本轮批准文件hash及run `20261015T123051Z`。其后真实status为open_gates空、approvals=3；task内本run唯一审批记录为bug/approved，reason与Bob批准的边界附言逐字一致，裁决hash仍为`0f4adc251a4336dfb8dc65d28611db593508ba9eca37b0e501911b7247e86a4f`。

负对照Edit `toolu_3e4b7e67176e4a809cfac2a9`与审批后Edit `toolu_852bc9a0c3484a379b3cb770`所有参数一致，后者成功；随后唯一恢复Edit `toolu_2c81aae8fcbe45a68c11b9d1`成功且只删除新增sentinel行。源码恢复到`2509255bf743fc4f1bece7867ee60862d58e485eb67df9a06f55f570fc49ecd2`，测试仍为`57efe6e67e9c511f4b8bebc542ac9a1c75d3fc43744d7218a4e067321bfb964d`。两次Edit的唯一性、先后顺序与审批先行均已核对，预算保持838/401，admission/review增量均0。

矩阵3.4的D部分据实记通过，至此剧本3的B/C/D人工闸门流程全部具有本轮实证。仅命令D验收闭环，不代表M11完成；树外证据访问原因未证实的边界仍保留，容量修复未实施，未启动新审查、未提交。当前本步71/80，剩admission1/review8，后续客户端批次仍需按余量独立规划，不能自行启动。

## 2026-10-15交付检查

Bob明确要求提交、推送后，主仓执行`npm run check`退出0：3624项，3622通过、0失败、2个条件跳过；8份新增/修改验收脚本语法检查通过。交付核对发现矩阵生成误把首条数据行留在表头，已修正三份归集脚本并重出Markdown，同时保留空证据的“尚无本轮满足判据的证据”提示；JSON与Markdown均68条、编号唯一且顺序一致，原始验收证据未回写。完整结果见[交付检查](./evidence/m11-step12-20261012/delivery-check-20261015.json)。本次完整检查包含仓库构建，未重装用户安装副本、未改版本号，验收预算仍838/401，不将自动化检查提升为剩余真实客户端验收通过。
