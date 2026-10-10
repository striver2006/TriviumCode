---
schema: trivium.disposition.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: codex
kind: revised
run_id: 20261010T062559Z
addresses:
  - 2026-10-10-Agent双模式接入真实准入收口-claude.md
  - 2026-10-10-Agent双模式接入真实准入收口-gemini.md
  - 2026-10-10-Agent双模式接入真实准入收口-glm.md
---

# 计划三审逐条裁决

三份全文已读。共16条：7条major、8条minor、1条nit，全部接受。接受指整改范围和澄清落点，不追认错误前提或把审核者未覆盖项说成实测；修订后的完整计划是同目录r2-codex原稿。本轮一般审批不包含判据变更审批。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 旧admission有0.162.0硬闸且r2/probe入口未建，需明确实际改动载体；当前仅tv通道已实跑。选择新canonical脚本进Git，旧装置冻结，不让未跟踪副本承载第二份判据。 | r2取证装置整改范围：新增scripts/agent-access-closeout.mjs与closeout-summary.mjs，薄probe入口及双hash；旧admission/summary不再执行。 |
| CLAUDE-02 | claude | major | 接受 | ADR和目录指针需要新增本轮状态，历史通过仍按采样时刻保留，不因版本升级删除。 | r2文档同步：ADR_003、doc/02_design/README、主设计、协议、手册、CASE及新报告索引。 |
| CLAUDE-03 | claude | major | 接受 | 旧十模块hash清单漏了实际判据/路由/检测等依赖，不能把“有module_sha256字段”等同于完整绑定。 | r2判定层与指纹预检：完整导入清单及构建inputs/bundle、预算/装载/helper哈希；与旧清单逐项对账。 |
| CLAUDE-04 | claude | minor | 接受 | 接受来源澄清。生产函数确在src/trivium/freeze.ts:275；旧admission内联deny不是该函数，本轮canonical须明确调用生产枚举，不复用不完整集合。 | r2取证范围和禁读段：函数路径、全部同行/.env断言，旧内联结果原样保留。 |
| CLAUDE-05 | claude | minor | 接受 | 判据边界需要常备回归和真实录制抽取样本，不能仅依赖本轮未跟踪自检。 | test/unit/agent-access-budget.test.ts纳入签名同步、精确目标/配对/错误层测试；旧V4 pro派生重算保存在audit-snapshots，进入check和代码审。 |
| CLAUDE-06 | claude | minor | 接受 | 需要只读比对配置键和保留键hash；旧内容不存在时无证据归因，不能凭新版本解释旧漂移，也不自动否定新指纹独立实测。 | r2指纹预检：先比对可用快照，原因未知null；当前路线合法性无法核实则停，不回滚当前配置、不复用旧完整指纹。 |
| CLAUDE-07 | claude | nit | 接受 | Codex命令轨迹与Claude工具配对证据形状不同，必须在判据和矩阵明示，不能统一写成注册层拒绝。 | r2分档段：Codex command ID/cwd/精确目标/失败输出/前后状态核对；维持生产钉死命令，不把正则字面单独当充分证据。 |
| AGY-01 | gemini | major | 接受 | 替代候选要有可执行且有预算的探索；维持原标准导致未完成是诚实停止条件，不应靠改判实现收口。 | r2批次F：2逻辑臂、追加4启动，先零配额旧样本辨别；只做可行性，不作为真实供应商写尝试，判据须另行明确审批。 |
| AGY-02 | gemini | major | 接受 | 需明确flash的失败是summary附加说明导致严格相等未通过；不能用包含关系或pro通过替代。 | r2路线矩阵后专段：实际Read结果与README首词核对、summary逐字完全相等、失败/附加说明保持未通过。 |
| AGY-03 | gemini | major | 接受 | 逻辑臂不等于启动，C必须有提前发布的硬cap、完整路线臂清单与幂等扩容键，包装器子启动全计。 | r2预算表：C21能力+3version预计24启动，累计56→88追加32；D18臂预计36+静态4，F追加4，扩容顺序B/C/F/D。 |
| AGY-04 | gemini | minor | 接受 | 现有单测直接调用旧签名，若缺上下文仍兼容放行会保留漏洞；明确更新用例和签名，不向旧件补写新证据。 | r2范围点名test/unit/agent-access-budget.test.ts，缺cwd/根/结果/前后状态fail closed。 |
| AGY-05 | gemini | minor | 接受 | config.local不进补丁；sensitive_globs只覆盖运行元数据，不能罩住冻结审计副本。需要可读的非敏感前后值和效果断言。 | r2指纹/审查冻结段：audit-snapshots非敏感清单与效果证据送审；显式断言该副本不在deny、真实敏感夹具仍在。 |
| GLM-01 | glm | major | 接受 | 依赖新版目标判定和版本门控的臂必须在装置整改和回归后运行，避免旧函数/旧版本硬闸消耗额度并混用结论。 | r2收尾顺序：先整改与边界回归/旧样本派生，再版本/指纹核对，后真实补测和代码三审；新旧样本结果分开。 |
| GLM-02 | glm | minor | 接受 | config.deepMerge对数组覆盖，写新增项会抹去旧凭据保护。须保留旧全集与新项并集且验证效果。 | r2冻结段：保留凭据四条、旧admission四条及本轮四类；合并后.env及同行夹具仍禁读断言。 |
| GLM-03 | glm | minor | 接受 | 不声称不可进入diff的本机配置天然被代码审查；通过冻结非敏感前后值和效果载体审查实际意图。 | r2冻结段：本机配置不进Git，audit-snapshots前后值及效果作为代码审可读补丁/合法context。 |
| GLM-04 | glm | minor | 接受 | 注册层与权限层错误需要可辨性证据。Driver零CLI读旧真实样本已见对应No such tool available错误；仍不能追认2.1.296，新样本歧义则未测。 | r2判定层预检：配对ID、工具名和原始错误对照，actual permissionMode核对；无法辨别不降低口径。 |

## 审查运行告警与盲区

运行状态success只证明编排器三份审查产出完成，不表示计划已获人工批准或七路线通过。被审原稿hash未变；snapshot的drift为本轮calls/ledger/loaded/plan-start等无关运行元数据新增，on_drift=warn，原始警告与清单保留，不称零漂移，也未改业务源码。

Gemini evidence引用的brief.ts/freeze.ts未列入consulted；GLM consulted_unverified、读取config.local命中orchestrator-state类禁读（不判同行泄漏/不作废）均按编排器原判保留，不改审查原件。Driver亲自读对应实现核对数组覆盖、diff剔除与生产枚举存在；不把各审核者未覆盖的CLI、hash、运行结果说成它们实测。Driver无模型声明，与三侧比较unknown；三审核者的模型族比较来源分别envelope/trace，不推断服务端身份。

## 人工审批范围

待批准的是r2列出的代码/取证装置整改、当前版本补测和候选可行性取证。默认维持原标准；候选分项准入未获批准，缺实际模型写尝试继续未测，M11前置不完成。计划gate通过后按本轮用户要求进入awaiting_approval，不自行approve、不借用旧审批、不开始S5，不提交推送。
