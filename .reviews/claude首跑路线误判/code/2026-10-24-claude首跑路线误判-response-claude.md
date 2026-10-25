---
schema: trivium.disposition.v1
topic: claude首跑路线误判
stage: code
role: claude
kind: response
run_id: 20261024T074604Z
addresses:
  - 2026-10-24-claude首跑路线误判-codex.md
  - 2026-10-24-claude首跑路线误判-gemini.md
  - 2026-10-24-claude首跑路线误判-glm.md
---

# 应答：claude首跑路线误判 · 代码审第 1 轮

> 被审对象：相对 HEAD `db876910` 的未提交改动（补丁 `_meta/changes-20261024T074604Z.diff`，20 个文件，大头是两份全量读数）。
> 评审循环第 1/3 轮：codex `pass`（零意见），gemini `pass`（零意见），glm `pass`（1 nit）。计票 3 通过 / 0 修改后通过 / 0 不通过 → 通过。
> 1 条，接受，按下表直接改码。codex、gemini 两侧零意见，无可裁决条目。
> 编排器另报「安装副本不是当前工作树构建的」「安装副本与仓库 HEAD 不同版」：本主题未提交、未重装（重装由用户在提交推送后做），不是缺陷。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | nit | 接受 | 成立：`doctor.ts` 比对处的 try/catch（探测后解析抛出同判失效）是「探测期间真实变化仍须拦下」的另一条路径，计划 D2 表与第一节都写了「profile 文件被删则解析抛出、catch 判失效」，但 R1～R4 只走「指纹不等」，这条只在文档里成立、没有格子守着；补一格成本很低 | `test/integration/claude-route-stability.test.ts` 新增 R5：profile 路线、盘上版本一致，目录桩在窗口内删掉 `profiles/fx.env`，断言与 R2 相同的失效形态（有该 blocker、`profile:fx` 登记删除、只读旗标与目录 deny 字段清空）。变异补 M2b：把比对处的 catch 改成「抛出视为稳定」，期望 R5 红（M2 让 `stable` 不再调用解析，覆盖不到 catch）；重跑预跑与正式装置，更新报告第 3、4 节与证据目录 |

## 实施中发现的留痕更正（不属本轮意见）

计划裁决件（`plan/2026-10-24-claude首跑路线误判-revised-claude.md`）GLM-03 一行的理由写了「EV-253 的 Windows 实测还没做」，r2 计划第五节据此要求「Windows 实测待办那一条同步加一句指向第 15 条」。两处都不准确：EV-253 的 Windows 实测 2026-10-24 已收口（BACKLOG EV-253 行、Bug 清单 §3.1 第 12、13 条），没有可挂靠的 Windows 待办条目。实施时改为只在 Bug 清单第 15 条闭合文与测试报告第 6 节单列 Windows 残余；计划阶段裁决件已过闸，原文未改，更正记在这里与测试报告第 8 节。

另，计划 r2 第四节写 M4「N2、P2 绿」也不准确：这两格的 blocker 断言确实过了，但同格还断言调用方配置未改，写回让它们红在契约断言上；判别意义不变（候选 B 下仍判路线变化的只有全新安装两格），已按实测写进测试报告第 4 节。
