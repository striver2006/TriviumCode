# 下一步任务提示语

以下正文可直接复制到下一轮会话。本文件是任务交接，不是客户端启动或厂商预算授权。

---

继续 TriviumCode 的 M11 Step 12 手工验收。先读仓库 AGENTS.md、报告最新段落、矩阵和 CASE 场景5对应章节，核对实际状态后推进。当前任务是**只读核定新客户端启动链、计数覆盖和最小预算方案**，不启动任何客户端或厂商CLI。

【位置】
- 主仓库：`/Users/chenzhenbo/Work/TriviumCode`
- 原验收工程：`/Users/chenzhenbo/Work/trivium-m11-step12-20261012`
- Z01根：`/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01`
- 已完成setup的新夹具根：Z01根下`s5-client-plan-20261016-01/`，内含`archive`、`backup`、`empty`、`empty-backup`及外部索引。
- 报告：`doc/05_testing/REPORT_2026-10-12_m11_step12_manual_acceptance.md`
- 证据根：`doc/05_testing/evidence/m11-step12-20261012/`
- 本批操作包：证据根下`zero-controls-20261015-01/s5-client-plan-20261016-01/`
- 优先读：`SETUP_COMPLETED.md`、`setup-assessment.json`、`setup-authorization.json`、`configuration-preview.json`、`lifecycle-readback.json`、`proposal-manifest.json`、`setup-delivery-check.json`。
- 两份矩阵：证据根下`matrix.json`与`matrix.md`，68个唯一判据。

【已完成基线：只读核对，不重跑】
1. D根因裁决及审批前拦截/审批后同参数Edit放行与恢复已闭环；容量修复未实施、未获实施授权，“树外证据访问原因未证实”仍保留。
2. 6.7已凭H2/Z01原VS Code扩展日志补齐四Hook真实完成事件。不要回退到旧“pre-bash退出码null”的历史结论，也不要重试chmod-x＋git log。
3. 8.2终端gate 0→2→0已通过，唯一负向原因missing_findings、ids=[CODEX-04]，相关裁决及task已恢复。B1 Codex证据不足仍保留。
4. 场景5 CLI完整/缺件/改件/恢复/无记录负对照已齐备。5.1真实客户端通过：toolu_3fb0ff3d5be3421980559972，pre-bash/pre-commit均0；Git退出1仅因无暂存变更，未产生真实提交。5.2～5.5客户端仍未测。
5. Bob只批准了两个新夹具的本地setup，明确厂商增量0、不启动客户端、不做故障注入。2026-10-16 00:44:25/00:44:48（Asia/Singapore）两次安装bundle及采集进程实际均退出0；顶层终端setup退出码没有独立录制，保持null。
6. archive目前141文件，仅wrapper变化；empty目前27文件，新增9个预期文件、归档只有README。实际init逐文件符合预览，最终采集wrapper为755且符合批准内容。原工程、备份、外部索引及安装运行时指纹均未变，未执行恢复。
7. 本批calls仅两次init请求/完成对，无Hook执行证据。新采集外壳对真实Hook的行为等价性尚未验证；setup成功不证明客户端集成。
8. 当前累计预算admission838/review401，本步71/80，分池剩余1/8；当前允许厂商增量仍为0/0。旧批次估算、剩余额度及setup批准都不构成客户端启动授权。

【本轮优先任务】
1. 只读检查VS Code Claude扩展的必要安装文件、项目配置、已有日志与进程元数据，梳理“VS Code扩展 → SDK/启动器 → 包装器/native → Driver → 项目Hook → runtime.mjs → 安装bundle”的真实或静态可证链路。区分实测与推断；版本只读包元数据/既有日志，不运行help/version。仅输出必要字段，不打印凭据或完整敏感命令行。
2. 核实每个新客户端启动边界是否会被现有预算侧车计数。已知runtime.mjs侧车只覆盖本地编排器及其后代，不能据此认定VS Code启动Driver也受控。列出未覆盖边界、归属池、可观测原始记录和计数证据；无法确认的字段为null，禁止把缺记录当成零启动。
3. 查明能否在不改全局配置、不移除/改序/弱化任何Hook的前提下，对两个新夹具建立真实cwd正确、预算可验证的客户端入口。不能用原会话内cd或伪造CLAUDE_PROJECT_DIR替代项目绑定，不能改旧wrapper绑定来绕过限制。若必须新增项目级采集配置或启动包装器，先准备完整差异、独立备份和恢复方案，标注对被测行为的影响。
4. 给出最小执行批次：先解决一个新夹具的客户端健康前置及采集等价性，再分段做5.2缺件、5.4恢复、5.3改件、5.4恢复和5.5空仓。复用已准备的独立临时索引git commit --dry-run，不制造真实提交。说明每段实际能证明什么、所需原始事件、tool_use与逐Hook进程关联、实际退出码/输出、前后hash/权限、预算上限和失败停点。
5. 如果只读材料不足以确定启动量，准备一次最小动态取证提案：具体入口、包装器/native边界、计数覆盖、预算池及硬上限、超额前拦截、失败即停及恢复。不要自行执行，也不要为了估算调用厂商CLI。未知上限不能写成已验证安全预算。

【执行边界】
- 允许只读核对、编写说明、在新证据目录准备隔离采集脚本，以及不启动厂商/客户端、不修改受保护工件的本地零厂商检查。
- 不启动或恢复VS Code Claude会话，不发客户端工具请求，不运行doctor/preflight/review或任何厂商CLI（包括help/version），不审批/拒绝/放弃闸门。
- 不重跑已完成的prepare、preview、validate、assess、setup、s5、s82、审批或恢复脚本。特别是旧validate验证“未授权”状态，现在不能再用它验证setup已完成状态。
- 原proposal-manifest中的18个文件已冻结，并被setup授权及当前runtime校验引用；不要修改这些文件、改hash或重写批准回执。新增采集/修订必须用新版本、新证据说明影响，保留旧包。
- 不修改业务代码、生产guard/gate/hooks，不实施容量修复、不改全局配置、不重装运行时，不删除/改写真实审查工件或历史原始日志。
- 受保护工件的故障注入及恢复仍需Bob系统终端执行；必须先准备完整独立副本、备份、校验和精确命令，停在用户操作前。
- 不把新外壳的拒绝、cwd错误、缺wrapper、预算错误或待裁决错误当成场景5完整性拒绝。诊断改变被测行为时仅记辅助证据，不能替代原配置集成验收。
- 不自动提交或推送；上一轮交付授权不延伸到本轮。

【留痕及交付】
在证据根下另建`zero-controls-20261015-01/client-start-readonly-20261016-01/`（已存在则换新后缀），沿用saveEvidence脱敏与不覆盖机制。记录前置状态、读取来源和hash、实际参数、退出码（没有证据为null）、预算前后、恢复情况和证据路径。同步报告及两份矩阵，核对68行唯一性、顺序和状态一致；本轮静态分析不能把5.2～5.5改为通过。

先汇报实际核对结果，继续完成所有已授权的独立准备，最终交付“启动链与计数覆盖表＋最小预算提案＋待批准的精确步骤”，停在任何新启动或项目配置生效之前。不重复请求已经授予的本地setup授权。

正式失败分支1.4、B1 Codex证据不足、剧本7/9/10及可选9.6/11.7维持原状态。ZCode Driver、跨Driver、Codex L2仅规划，历史预算不沿用；不依赖过期缓存、不跨池、不因review有余量就启动。M11尚未全部完成。
