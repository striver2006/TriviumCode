---
schema: trivium.disposition.v1
topic: doctor旗标提示与start共享根检查
stage: plan
role: claude
kind: revised
run_id: 20261018T072932Z
addresses:
  - 2026-10-18-doctor旗标提示与start共享根检查-gemini.md
  - 2026-10-18-doctor旗标提示与start共享根检查-glm.md
---

# 裁决：doctor旗标提示与start共享根检查 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-18-doctor旗标提示与start共享根检查-claude.md`（r1，起点 `7fc1f38a`）
> gemini `approve`（无意见），glm `approve-with-nits`（1 条 nit）。1 条接受，合入后的计划见 `plan/2026-10-18-doctor旗标提示与start共享根检查-r2-claude.md`。
> 裁决前回源码核了 `cli.ts:829-837`：`emitJson` 确实写六个键，`directoryEvidence` 只在跑过 Claude 目录探针时出现（`report.directoryEvidence` 为 `undefined` 时被 JSON 序列化省略），r1 的「五个字段」在全量 doctor 下不成立。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | nit | 接受 | 成立：`directoryEvidence` 是条件出现的第六个键。设计不变，但现状陈述要准，否则照「五个字段」写全量键集合断言会把条件键误判成新代码加的 | r2 §2.1 第 3 条改为「`--json` 既有字段不变（`ok` / `probe` / `notes` / `blockers` / `warnings`，外加条件出现的 `directoryEvidence`）」；U4 与 A-1 的判据维持「顶层键集合与不带覆盖时相同」，不写死键数 |

## 审查员盲区里提到、不构成意见的一处

glm「未覆盖范围」第 4 条提到：第五家在 doctor 里没有探测段、本次又带了 `--only 〈别的值〉` 时，归原因②还是③，r1 没写死。两种归法给出的都是真话，这里写死以免实现与测试各取一种：**`--only` 过滤优先**——只要该家的段（或该家的 cliName）不在本次 `--only` 论域内，就归原因②；原因③只在不带 `--only`（或 `--only` 恰为该家）时出现。r2 §0 D-3 与 U1 ④′ 写明。这不是被接受的意见编号，只是补清楚。
