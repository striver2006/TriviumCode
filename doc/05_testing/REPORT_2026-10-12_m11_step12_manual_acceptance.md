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
