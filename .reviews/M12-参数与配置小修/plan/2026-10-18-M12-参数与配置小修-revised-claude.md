---
schema: trivium.disposition.v1
topic: M12-参数与配置小修
stage: plan
role: claude
kind: revised
run_id: 20261017T164003Z
addresses:
  - 2026-10-18-M12-参数与配置小修-gemini.md
  - 2026-10-18-M12-参数与配置小修-glm.md
---

# 裁决：M12-参数与配置小修 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-18-M12-参数与配置小修-claude.md`（r1，起点 `79d2dd57`）
> 两侧：gemini `approve`（零意见），glm `approve-with-nits`（1 nit）。1 条接受，合入后的计划见 `plan/2026-10-18-M12-参数与配置小修-r2-claude.md`。
> 两侧都支持把 §0 / §2.3 的 `cli.ts` `=` 空值一格纳入；glm 建议在提交说明与审批材料里向用户明示这一格超出 D-8 字面改动面——采纳为汇报要求（不是一条编号意见，记在下方）。
> 裁决前回原文核了一处：`AGENTS.md` 「改动同步清单」的「JSON Schema」与「CLI 参数或退出码」两行的同步面，与 glm 引述一致。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| GLM-01 | glm | nit | 接受 | 属实：本批同时动了 JSON Schema（加 deprecated 与描述）和 CLI 退出码行为，`AGENTS.md` 同步清单这两行点名的核对面 r1 的 §5 没有逐项列出，只有一句「PRD、LLD、协议文档 grep 核」兜底；按本仓「靠机制不靠记性」的纪律，应显式列为逐项判定 | r2 §5 新增「同步清单逐项判定」小节：`parse` / `gate` / `meta` 校验、`skills/dual-critic/SKILL.md` 契约面、`AGENTS.md` 契约面描述、`registry-parity` 的 schema 扫描盯防点、PROTOCOL、`USAGE` 字符串、`skills-src/commands/` 命令契约（含是否触发 `npm run render`）逐项写「同步」或「核过、不改 + 理由」，结论进报告 |

## 其余

- 两侧「未覆盖范围」里提到的未运行测试、未实测厂商 CLI，属只读审查的固有边界，由 S5 之后的全量、变异与桩级验收承担，不另作裁决。
- glm 在盲区里点到的 doctor 入口残余不对称（`--model-codex X` 在 doctor 不判键）：r1 §2.5 已明示不扩大，r2 维持；报告里如实写这一残余。
- 汇报要求（glm agreed 段的建议）：S10 之后向用户汇报与提交说明里，明写 `cli.ts` `=` 空值一格超出 D-8 字面改动面、两侧审查均支持纳入，供用户追认。
