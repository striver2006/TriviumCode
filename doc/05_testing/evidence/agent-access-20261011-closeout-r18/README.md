# 第25B补充计划审查准备

本目录为新的独立证据作用面；r17全部70文件原样保留。采样时正式24/26，第25B与第26C尚未启动；v14授权以既有按需轮数委托登记，不重置计数，不修改旧失效运行，不包含准入判据采用。

第25B原稿为`.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r27-codex.md`，经archive.ts唯一出口归档，SHA为`d769e5ac860d97a475b59bd917ce5e8b125bb5e294d6257d8aa3c73db15af35a`。计划明确先审临时HOME内显式权限模式配置及认证时间戳变化链、实际loopback限额与全部清理测试、Schema形状对账，再实施；当前新模式设置未实施。

本批review预计15启动、硬上限20，从313起累计池上限333。预检实际10启动至323/333，准入732/742不变；只读核对四目标运行时、28入口、7备份、生产输入7ac37129和bundle1737c946保持。预检仅三项具名auth_routes.checked_at变化，local从fb64a35a变为c5b4d9a9，原始语义比对且临时0600快照已清理，不修改全局配置。

`static-checks.json`记录typecheck、仅测试构建与125项定向测试通过；没有重打包运行时，不把旧两次全量check当本次独立证据资产的全量检查。`static-audit-before25.json`记录生产禁读枚举/三侧49个literal context冲突0、settings71384字节、Read/Grep/Glob保守目录事实消费、扫描878文件0候选；`static-audit-guard-contract-supplement.json`另按真实run契约显式核验旧24B的readonly/peer/forged字段和批准计划hash。初次审计的错误字段限制保留，不能独立消费初件证明peer零违规。

旧local496下7通过/5未测与两禁读Read false全部保留；当前完整配置指纹下全量准入仍0通过/12未测。受控首次pilot的auto/default不符、没有真实provider推理或实际模型负对照，不变成生产准入。两项候选判据仍须Bob另行明确独立批准，普通plan/code批准、按需轮数及配额委托不代替该决定。客户端实际同名发现和其他仓库全部依赖仍未测；官方Claude待订阅恢复，服务端身份无证据为null。

主要原件：`formal-round25-26-authorization-verification.json`、`review-round25-plan-batch.json`、`plan25-original-archive.json`、`plan25-resolved.json`、`plan25-preflight-call.json`、`config-after25-preflight-observation.json`、`static-checks.json`、`static-audit-before25.json`与guard补件。审查启动前冻结全部相关源/文档/证据，审查和审批停点禁止业务写入。
