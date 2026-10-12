# B2 本轮审批对象与执行边界

本文件是待决定提案，不是批准回执，不得据此执行approve。

- 主题/阶段/run：`m11-s12-capacity / plan / 20261012T154021Z`，第2轮。
- 定稿：独立项目 `.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r3-claude.md`；精确hash见`b2-assessment.json`。
- 五条意见已逐条接受：bigint用例（GLM-01、CODEX-01同落点）、npm环境错误诊断（CODEX-02）、保留peek交付的局部回滚（CODEX-03）、被拒push后size断言（CODEX-04）。gate退0，五编号齐备，三侧evidence_ok均true。
- 建议批准本轮容量计划，后续按原验收清单执行；此批准不移用至新运行、不代表M11完成。

## 随批准明确的执行边界

r3 §3.3写了npm环境失败时“verify改以”直接Node命令执行。原M11验收要求正式执行配置中的构建/测试：**本轮批准不授权自动替换verify配置或将失败改判通过**。若npm失败，先留存退出码并停止正式验证；与package.json等价的直接Node命令仅可作辅助定位，单独记结果，不替代正式验收。该边界源自本次总任务约束；若用户批准此提案，需一并传给后续Driver，保留r3原件，不改写历史裁决。

B1 Codex证据不足继续保留。B2的orchestrator-state命令字面命中也保留：命中的`.trivium`位于find排除式；这支持误命中解释，但不修改原guard结论。无readonly_breach或工作树漂移。Driver模型来源declared，审核者来源envelope/trace；不声称服务端身份已验证。

本轮实际admission8/review6，本步22/20，共42/80；当前817/835与393/413。审批操作本身预计/硬限零厂商启动。B2无实时ps采样，不能补写为已观测；已有B1参数实证仍有效。

批准后才建立绑定本轮的独立回执，并在原Claude Code窗口单独执行：

```text
/dual-approve --topic m11-s12-capacity --stage plan
```

审批之后也不自行进入code或重开三审；先完成后续具名批次准备。
