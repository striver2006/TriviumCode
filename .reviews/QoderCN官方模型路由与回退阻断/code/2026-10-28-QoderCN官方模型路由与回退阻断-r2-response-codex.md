---
schema: trivium.disposition.v1
topic: QoderCN官方模型路由与回退阻断
stage: code
role: codex
kind: response
run_id: 20261027T235110Z
addresses:
  - 2026-10-28-QoderCN官方模型路由与回退阻断-r2-gemini.md
  - 2026-10-28-QoderCN官方模型路由与回退阻断-r2-glm.md
  - 2026-10-28-QoderCN官方模型路由与回退阻断-r2-claude.md
---

# 第二轮代码审裁决与修改计划

三份全文已读。9 条全部接受，修改后校验并进入 S10；不把审核者「修改后通过」改写成无意见通过。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-r2-01 | gemini | nit | 接受 | 目录与归一取表应一致，候选准入仍另处限制 | preflight normalizeModelForCatalog 改用 wiredAdapter |
| GLM-01 | glm | minor | 接受 | 坏 tier 不能靠只核错误名防止回落 | 三条入口（CLI/profile/agent）断言 model=null、tierSource非probe_default |
| GLM-02 | glm | minor | 接受 | 新停止时序字段必须有断言锚 | 真实 executable 流式前后结果断言；final为exec按行flush之外的防御分支，提取收尾函数用缺回调的合成结果验证，不伪称其为真机自然可触发 |
| GLM-03 | glm | minor | 接受 | 次要result错误不能盖过回退首因 | resultError分支增加无模型failure前置，补原生错误result+告警摘要回归 |
| GLM-04 | glm | nit | 接受 | 清理错误应保留分类细节，避免聚合后只剩泛化文案 | 安全展开AggregateError子消息，execution_failure保留细节与类型化单测 |
| CLAUDE-01 | claude | minor | 接受 | CLI预检与直调适配器必须使用同一大小写规则 | 厂商normalizeModelForCatalog返回目录规范名；预检入口与直接调用同值回归 |
| CLAUDE-02 | claude | minor | 接受 | 准备阶段失败也应保留请求和原生失败证据 | synthesize未派生RunResult，adapter早期失败也附native_model，补缺认证负例 |
| CLAUDE-03 | claude | minor | 接受 | 执行前版本验证应复用探针隔离环境 | verifyQoderBinding版本调用置withQoderHome内，未复制用户模型/Hook配置 |
| CLAUDE-04 | claude | nit | 接受 | 探针执行失败优先、默认未知文案不应打印null；回退保首因 | 探针先核进程/超时/退出/最终结果，再finish；默认缺回读专门文案；result错误不遮盖模型failure |
