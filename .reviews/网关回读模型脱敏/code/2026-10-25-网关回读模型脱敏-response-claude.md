---
schema: trivium.disposition.v1
topic: 网关回读模型脱敏
stage: code
role: claude
kind: response
run_id: 20261025T144753Z
addresses:
  - 2026-10-25-网关回读模型脱敏-codex.md
  - 2026-10-25-网关回读模型脱敏-gemini.md
  - 2026-10-25-网关回读模型脱敏-glm.md
---

# 应答：网关回读模型脱敏 · 代码审第 1 轮

> 被审对象：相对 `66096574` 的工作树补丁（run `20261025T144753Z`，42 个文件、211.6 KB）。
> 评审循环第 1/3 轮：codex `pass`（零意见），gemini `pass`（零意见），glm `pass`（1 nit）。
> 共 1 条，接受。只改文档措辞，不改代码与测试。
> 裁决前核过的依据：`src/trivium/adapters/claude-trace.ts` 的 `claudeModelReadback` 不感知网关开关；`src/trivium/secrets.ts` 的 `hasRedactionMark` 含 `<redacted` 与 `…` 两支——未开启的机器上，`init.model` 若本身命中模式脱敏（被换成首尾预览）或含 U+2026，修复前记「占位符 + envelope」、修复后记「null + unverified」，GLM-01 所述属实；S6 / E10 只锚了 scrub 输出逐字相同，S8 只锚了缺失 / 空串三格。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| --- | --- | --- | --- | --- | --- |
| GLM-01 | glm | nit | 接受 | 属实：「未开启零变化」的概称只对 scrub 输出成立；回读判定与网关开关无关，未开启时 `init.model` 自身带脱敏痕迹（模型名恰为令牌形态被换成首尾预览、或含省略号字符）会从 `envelope` 变 `unverified`。方向是修正（AC-20：带痕迹本就不算回读成功），实际模型名不会出现这两种形态，但概称会误导后来者排查。把口径收窄写准 | 主设计 §12 段末句与 v1.3.179 变更记录、BACKLOG EV-257、报告 §2 与 §7、05_testing 索引的「未开启零变化」改为「未开启时 scrub 输出逐字不变；回读判定只在 init.model 自身带脱敏痕迹时由 envelope 改记 unverified（修正方向）」；报告 §7 已知边界补这一条 |
