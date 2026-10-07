---
schema: trivium.disposition.v1
topic: M11-配置契约与档位解析
stage: code
role: claude
kind: response
run_id: 20261007T152248Z
addresses:
  - 2026-10-07-M11-配置契约与档位解析-codex.md
  - 2026-10-07-M11-配置契约与档位解析-gemini.md
  - 2026-10-07-M11-配置契约与档位解析-glm.md
---

# 应答：M11-配置契约与档位解析 · 代码三审第 1 轮

> 被审对象：相对 `HEAD`（`951dc8d7`）的工作区补丁（41 个文件）
> ｜ 运行：`20261007T152248Z`（25 分 28 秒）
> ｜ 结论：codex `approve`（零意见）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1）
> ｜ 共 1 条：接受 1、驳回 0、暂缓 0

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| GLM-01 | glm | minor | 接受 | 属实：`adapters/base.ts` `resolveTier` 第一段把空串裸 slug 当作「未命中」（`typeof cell === 'string' && cell` 不成立），于是落到 `default_tier` 分支；计划 r2 §3.3 写的是「空串裸 slug 按『无模型』处理」，计划三审 CODEX-03 接受时的预期也是「空串 slug 仍可加载、到 slug 校验退 64」。只有没设 `default_tier` 时两种读法结果相同（R4 只钉了这一形态），设了 `default_tier` 的组合会把一个显式写空的格子静默解析成默认档的模型照常发起。取审查员给的第二种：**空串格子终止第一段、不回落 `default_tier`**——显式写空是配置错误，与「写错档名不落到下一级」同一口径（失败闭合），且与计划文本、CODEX-03 的预期一致；旧配置（没有 `default_tier`）行为不变 | ①`resolveTier`：格子是空串时记一个空串标记、不再往下找 `default_tier`；解析结果增 `emptySlug` 字段（布尔）；注释由「按未命中」改为「按无模型、不回落」。②`checkModelSlugs` 的无模型分支：`emptySlug` 时文案点明「档位表该阶段写的是空串，空串不回落 default_tier」，仍退 64、仍含既有「未定义模型且无覆盖」字样。③`tier-resolve.test.ts`：R4 补「空串格子 + `default_tier` ⇒ 不回落、模型为 null、`emptySlug` 为真」一格；S2 旁补「空串格子 + `default_tier` ⇒ slug 检查退 64 并点明空串」一格。④变异补一条（空串格子回落 `default_tier`）进预跑与正式装置。⑤主设计 11.5 第一段补一句「空串裸 slug 按无模型、不回落 `default_tier`」，测试报告用例表与变异表同步；重跑全量两次 |

## 2. 不涉及驳回与暂缓

本轮唯一一条意见接受。codex、gemini 两侧零意见，各自「未覆盖范围」已读，无需另行处置。
