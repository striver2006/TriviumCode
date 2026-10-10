当前补充计划：目录压缩方案经Gemini、GLM审查及8条裁决后，用户已明确批准本轮plan“开始实现”，源码整改已完成。见[r5完整计划](../../../../.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r5-codex.md)、[8条裁决](../../../../.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r2-revised-codex.md)。Qwen flash/Kimi coding/DeepSeek flash目录机制各7/7，独立实际ID配对拒绝、完整交付与合法正对照均通过；其余模型完整能力边界分列，不能互相替代。两次最终check各3121通过/3跳过/0失败，桩14/14；[最终安装核对](directory-final-checks-install-audit.json)bundle/inputs匹配、dirty=true，共享七入口重名未处理。旧预检8→9偏差及本轮纠正批提前启动6次的[偏差](directory-model-correction-prepublication-exception.json)保留，不追认合规。目录纠正批最终228/232；[能力批G](batch-g-final-current.json)从228起预计63、新增64硬上限、累计292。三家正式预检通过，审查33/40、主题3/4，最后代码审尚未启动。当前完整指纹能力批进行中，M11前置任务未完成；不删旧证据或缩减机器禁读集合。

本索引以下主体是首轮计划审批前的历史采样，保留原时点表述。当前实施及C/D/F/E批结果见[收口报告](../../REPORT_2026-10-10_agent_access_closeout.md)；首轮计划已由用户批准，代码审已测但运行失败，11条裁决齐备且本轮code审批已收到；最终检查尚未完成。新增全局config hash漂移已另记批E，不将旧“本轮不变”外推到实施阶段。

# Agent 双模式接入真实准入收口：本轮计划审批交付

采样日期：2026-10-10，Asia/Singapore。正式入口 A，Driver=codex；主题参数已按用户澄清改为 `--topic Agent双模式接入真实准入收口`，不把主题当 context 路径。

**状态：awaiting_approval；前置任务未完成，不能进入 M11 第12步。** 本轮尚未实施业务整改，也未改变准入判据。计划批准只授权整改、补测及受控传输可行性取证；任何判据替代仍须另行明确审批。

## 可审查工件

- [修订后的完整计划](../../../../.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r2-codex.md)：整改范围、路线×缺口×启动清单、累积预算上限、实施顺序及停止条件。
- [逐条裁决](../../../../.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-revised-codex.md)：三审16条，全部接受、逐项列出落点；`gate --check` 通过。
- [审批前核对与逐模型矩阵](delivery-pending-approval.json)：预算、当前配置、历史保留、全局hash、回读及未测字段。
- [零厂商启动基线](baseline.json)、[原48次台账保留核对](old48-preservation.json)、[授权及初始硬上限](approval.json)。

原稿与三家审查员原始工件保留在 `.reviews/Agent双模式接入真实准入收口/plan/`，统一经 archive.ts 出口归档。本轮正式审查 run_id=20261010T062559Z；三家原 verdict 均为 request-changes，裁决校验通过不改写它们的原结论。

## 当前实际结果

HEAD及核对时远端origin/main均为 `3e5ca6bb5d5d69c7cfc5059b4d9bcf1418fb5c0a`。仓库与安装bundle相同，嵌入HEAD正确、dirty=false；业务tracked diff为空。起始旧closeout未跟踪证据保留。本轮全量check、自检、重装均未测；此前记录不冒充本轮运行。

本轮正式预检通过，共享三审claude/gemini/glm实际运行完成。CLI实测Claude2.1.296、Codex0.162.1、agy1.3.3、zcode0.16.9；对应旧能力版本不同，不能直接套用。与旧采样相比全局配置hash已漂移，原因未核实；从本轮基线至本轮收尾这些hash不变，未手工修改全局配置。

正式计划审查CLI回读：Claude为qwen3.8-flash（envelope），Gemini为gemini-3.8-flash-high（envelope），GLM为GLM-5.3及bigmodel-coding-plan（trace）。详细来源保留在原工件；不可由请求或配置推断服务端身份。Driver模型本轮未声明，相关模型族比较unknown。Qwen flash此次完成计划审查不替代完整能力臂验收。

| 当前路线×模型组合 | 本轮完整能力结论 | 重点待补 |
| :--- | :--- | :--- |
| Codex/native：Sol、Luna、Astra | 各自未测 | 当前指纹下读取/Schema、写负对照、禁读检测与实际回读 |
| Codex/Qwen、Kimi、DeepSeek | 各自未测 | 0.162.1完整能力，不复用0.162.0 |
| Claude/Qwen flash、max | 各自未测 | 当前版本完整能力；flash显式Grep完整交付；max/Qwen pro独立核对 |
| Claude/Kimi coding、k3 | 各自未测 | 当前版本读取/Schema及逐文件禁读；两模型真实生产写尝试仍未测 |
| Claude/DeepSeek flash、V4 pro | 各自未测 | flash严格首词及生产写尝试；pro当前版本独立核对，旧pro结果不替代flash |
| Claude/native | 未测 | 待订阅恢复，不计七条当前可用路线 |

十三组合的请求、配置声明、CLI有效回读及服务端身份分列在delivery JSON；缺证据为null。没有实际写调用不判原标准通过；受控返回、注册Write权限诊断及未生成文件不能替代真实模型主动尝试。

零CLI分析发现旧claudeWritePass的suffix判定既漏相对路径，又接受其它目录同名目标。旧真实Qwen/V4 pro样本的Write注册层拒绝与调用ID可以辨识，但其CLI版本为2.1.295；旧受控样本实际permissionMode=auto，真实供应商为default，不能直接视作生产同形。新版本尚未测；整改落点及回归在修订计划中明确，待审批后实施。

## 启动台账与指纹

本轮准入15/24、正式审查5/40，预占与完成记录均已收尾，无遗漏；准入包含6次版本启动，实际退出均0。业务命令的参数解析失败已记calls，但没有启动厂商，不增加厂商CLI启动数。版本、失败、超时、重试与实际包装器子启动均按既有预算模块记录；启动数不是请求数或金额。

旧48/48、准入100/100、正式29/40、后续36/36、28/40、47/64、21/24，以及旧closeout准入5/16与正式0/40均保留；本轮独立计数，不清零或覆盖。后续扩容仅在各批执行前按计划发布，当前未发布或消费这些额度。

audit.mjs是零启动核对；launch.mjs的tv分支已经实际使用，声明自身真实执行hash。每次包装调用的script_sha256与execution_sha256一致，primary装载记录齐备；具体版本、入口、包装器与配置hash见baseline和calls/loaded。probe.mjs尚未创建，probe通道未测，批准后建立canonical薄入口。不得将当前启动器的tv通道验证外推至尚不存在的probe通道。

证据落盘经既有脱敏器处理；收尾扫描138个文件，候选0（后续新增本索引及old48保留件另做扫描）。审查期间仅编排器wait/status必需元数据变化，保留实际无关漂移告警；不称零漂移。审查员证据/consulted警告保留在原始工件。

## 人工停点

已执行 `gate --stage plan --topic Agent双模式接入真实准入收口 --await-approval`，返回ok=true、state=awaiting_approval；未执行approve。此停点来自用户本轮明确要求“计划、审查、逐条裁决、人工审批、实施流程”，不沿用旧会话审批。

用户可执行：`$dual-approve --topic Agent双模式接入真实准入收口 --stage plan`。批准前不实施业务整改；提交、推送等待另行明确授权。
