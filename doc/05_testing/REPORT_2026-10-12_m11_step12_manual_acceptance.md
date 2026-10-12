# M11 第12步全量手工验收与收口

本轮起点为 `65e0ea6997a848537f83d79a6bfcacfa48f1796c`，main 工作树干净。Codex 主攻，真实客户端剧本按各自 Driver 验证，Codex 仍为 L2。上位依据为获批计划 r3 §4.12 与 CASE 剧本1～11。当前执行中，**尚未满足 M11 完成判据**。

## 验收矩阵与分批

逐剧本、逐判据的68格矩阵见 [matrix.md](./evidence/m11-step12-20261012/matrix.md) 与 [matrix.json](./evidence/m11-step12-20261012/matrix.json)。其中9.6、11.7为可选，本轮不默认扩大范围。剧本1～7及新增必需判据必须本轮实跑，历史报告、桩与离线检查不替代真实客户端验收。

[预算清单](./evidence/m11-step12-20261012/budget-plan.json)保留旧admission795/815、review373/398；本步子上限20/60、总80，版本/帮助/失败/超时/包装器与native边界/重试均累计。必要扩容事前追加，不覆盖旧台账、不跨池。客户端批次与硬停止点另见 [client-batch.json](./evidence/m11-step12-20261012/client-batch.json)。

## 本轮零配额实跑

- [baseline.json](./evidence/m11-step12-20261012/baseline.json)：A批90项与受控批150项冻结来源全部一致；生产作用面 `7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f`；四目标28入口逐字hash一致，七个共享同名入口缺席。没有重新迁移或修改全局配置。
- [installed-selftest.json](./evidence/m11-step12-20261012/installed-selftest.json)：安装副本doctor桩自检14步、退出0。本项不证明真实UI、Hook集成或真实模型能力。
- 四条本轮参数负对照（`negative-{tier,effort,glm-effort,profile}.json`）全部退出64，累计两池不变。另实跑不存在profile的准备阶段负对照，退出64、归档hash前后完全一致、两池不变（[negative-profile-prepare.json](./evidence/m11-step12-20261012/negative-profile-prepare.json)）。修正CASE示例注释中的旧69口径，11.1判据本身不变。
- 按用户要求启用 `test/contract/evolution-ledger-parity.test.ts` 的 `NO_PENDING_SKIP=false`；台账全绿只证明文档并入，不代表全量手工验收完成。

## 真实载体与隔离项目

Bob明确答复“现在可操作，Claude Code使用Qwen”。通过computer-use观察到VS Code打开TriviumCode窗口，本次观察仅证明窗口存在，入口发现与Hook实际事件不据窗口存在判通过。其后Bob直接答复“有7个入口”，据此记录Claude Code七入口可见；具体Qwen模型未回答，保持null，尚无入口执行及Hook集成通过结论。见 [客户端人工记录](./evidence/m11-step12-20261012/client-observation-01.json)。

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

## 当前交付边界与剩余行动

本轮CLI新增0次：admission仍795/815、review仍373/398；本步20/60子上限未消费，未扩容。预算以原台账记录为准。正式审查运行0次，尚无任何新运行审批；不能把入口识别、桩自检、台账全绿或代码提交当成M11完成。

68格中，11.1完成本轮CLI负对照；7格仅取得真实归档Hook CLI辅助证据；其余必需项未完成或未测，9.6/11.7两格可选未执行。下一步是Bob在同一Claude Code会话恢复S0.6一次，成功后完成命令A及运行期间证据，再依矩阵推进B/C/D、模型切换、Hook负对照、ZCode/Codex及跨Driver等真实验收。后续人工审批须绑定各自新运行并逐次由Bob决定。

主设计16.1、PRD、演进设计§14的M11状态未翻绿；AC-25原达成边界不变。五个受限Claude组合的真实写尝试仍未测，原标准前置条件仍false。
