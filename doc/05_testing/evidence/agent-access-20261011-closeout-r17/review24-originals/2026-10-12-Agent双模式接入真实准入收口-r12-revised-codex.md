---
schema: trivium.disposition.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: codex
kind: revised
run_id: 20261011T171203Z
addresses:
  - 2026-10-12-Agent双模式接入真实准入收口-r12-claude.md
  - 2026-10-12-Agent双模式接入真实准入收口-r12-gemini.md
  - 2026-10-12-Agent双模式接入真实准入收口-r12-glm.md
---

# 第24B逐条裁决

三原件全文已读；13条意见12接受/1驳回，完整定稿Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r26-codex.md，SHA af93c0bb996da1b2125e70f66784b1151dc6d09c87853d2c8a77c718672ea2f9。1357冻结文件与10本轮原工件hash一致，subject/tree无漂移，readonly_breach和peer_artifact_read均false。原failed run20261010T170416Z保持失败。三个模型/首轮/完整交付与运行资格按meta核实，不以approve类意见代替gate。业务、夹具和候选消费均未实施；两项独立判据未批准。当前完整fingerprint0通过/12未测；旧496指纹7通过/5未测只保留历史。

保留告警：Driver模型/供应商/会话未声明null，Gemini/GLM路径级deny未生效，仅任务书及事后核验；Gemini和GLM镜头重合度高，模型族比较unknown。三侧parse_repairs均空，consulted与evidence交叉完整性以既有guard/gate输出为准，不补写原件或改变判据。

|意见编号|来源|严重度|裁决|理由|落点|
|---|---|---|---|---|---|
|CLAUDE-01|Claude|major|接受|两写工具必须分别具唯一同ID严格error及现生产注册禁用白名单；未知错误形态停并另审，混合读取单列严格配对。|定稿§3|
|CLAUDE-02|Claude|major|接受|独立批准/撤销局部Schema、用户原文来源、范围版本和所有hash消费校验；普通审批与轮数授权不能通过，未知不启用。|定稿§5.5|
|CLAUDE-03|Claude|minor|接受|明确旧restricted/component v1从未采用以及v2包装桥/权限/live/审批差异，同名同步规范。|定稿§2/§5.3|
|CLAUDE-04|Claude|minor|接受|纠正动态测试已跟指针但未执行；新增锁定v13及四个v9至v12固定历史测试，criteria=false单独断言。|定稿§5.4|
|CLAUDE-05|Claude|minor|接受|恢复报告、坑指南、Runbook、核心SKILL及索引补入完整规范同步清单。|定稿§5.3|
|AGY-01|Gemini|minor|接受|列明只证明本机已列事实差异，不证明上游稳定/能力重测/未测通过，机读can/cannot字段固定。|定稿§4|
|AGY-02|Gemini|minor|驳回|probeAuthAll(981-995)对全部三侧传resolveTier具名route，因此probeAuth形成combination；本轮完整diff实际只有三auth_routes.checked_at。commitAuthCache的无组合else存在不证明本轮会进入；不泛化扩大probe.auth白名单。|保持定稿§4三具名键限制|
|AGY-03|Gemini|nit|接受|单次混合原件不能直接调用固定N的单工具谓词或裁切raw；新mixed合同核全局2N权限及两写/合法Read，局部Schema固定。|定稿§3|
|AGY-04|Gemini|nit|接受|补11/13及工具错位/多余权限变异；非时间戳ok/fingerprint/版本/TTL等变化必须不适用。|定稿§5.4|
|GLM-01|GLM|minor|接受|明确动态指针现状、尚无绿色结果；补v9至v12具名历史及v13锁定，旧原件不改。|定稿§5.4|
|GLM-02|GLM|minor|接受|写类使用生产已录制注册禁用错误+逐工具唯一严格配对，读取沿完整已录制拒绝合同而非自由文本。|定稿§3|
|GLM-03|GLM|nit|接受|所有节点包括凭据原值先比较后脱敏，凭据变化即not-applicable；临时旧重建必须精确旧hash匹配。|定稿§4|
|GLM-04|GLM|nit|接受|B层具名计admission池且类别分列；后续硬14超过当前剩11时按授权先发布扩容，再启动。|定稿§3|

建议有效gate后依Bob普通审批委托批准本定稿夹具/只读诊断/局部证据契约与新增测试范围（含上述敏感取证守卫边界）；这不是判据采用批准。先取得实际A/B和适用性诊断，再将两项具体判据单独交Bob决定；未批准不启用任何替代消费。所有后续业务动作须在本轮ordinary plan审批之后。
