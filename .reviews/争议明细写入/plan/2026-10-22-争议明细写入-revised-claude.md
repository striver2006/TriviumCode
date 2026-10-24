---
schema: trivium.disposition.v1
topic: 争议明细写入
stage: plan
role: claude
kind: revised
run_id: 20261022T101659Z
addresses:
  - 2026-10-22-争议明细写入-codex.md
  - 2026-10-22-争议明细写入-gemini.md
  - 2026-10-22-争议明细写入-glm.md
---

# 裁决：争议明细写入 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-22-争议明细写入-claude.md`（r1，基线 `3eb27e40`）。
> 评审循环第 1/3 轮：codex `pass`（零意见），gemini `pass-after-changes`（2 minor、1 nit），glm `pass`（零意见）。
> 三条全部接受，合入后的计划见 `plan/2026-10-22-争议明细写入-r2-claude.md`。
> 裁决前核过的依据：`doc/07_manuals/MANUAL_user.md:687` 的「⚠️ 已知缺口」引述块与 `:941` 常见问题表一行确实都写着「`disputes[]` 无写入点」，r1 第二节第 6 项漏列。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | minor | 接受 | 成立：用户手册有两处把这个缺口写成现状（第 687 行引述块、第 941 行常见问题表），r1 的文档清单只列了主设计、LLD、Bug 清单与 BACKLOG。实施后不改，手册就会对用户说一件已经不成立的事 | r2 第二节改动清单第 6 项补 `doc/07_manuals/MANUAL_user.md` 第 687 行（改写为现行行为：明细按轮写入、旧记录有标记无明细时报告如何呈现）与第 941 行（该行删除或改为「旧主题报告里写着『没有留下明细』」的说明） |
| AGY-02 | gemini | minor | 接受 | 成立：`jointRejected` 这个名字读起来是「被驳回的共同项」，而 `hard` 下这些项同样被驳回、只是走了 `failures`；字段只在 `warn` 下给出是一条策略分流的约定，不写清就会被误读成「`hard` 下没有共同驳回」。采纳改名：名字直接说出用途，比靠注释补救更不容易误用 | r2 D3 与改动清单第 1 项：字段改名为 `disputedJointBlockers`，并加 docblock 写明「仅在 `warn` 策略下、即共同驳回进了 `warnings` 放行时给出，是 `gate --check` 要写进争议明细的那一组；`hard` 阻断时缺席，那时的编号在 `failures` 里」；D2 判据随之改为「看 `disputedJointBlockers` 是否非空」 |
| AGY-03 | gemini | nit | 接受 | 成立：D4 明说要照实呈现手改与旧形态，那就不该假设每条明细的字段都齐。成本很低：`finding_ids` 为空（或不是数组）显示「（无编号）」，`note` 为空（或不是字符串）显示「（无说明）」，不出现悬空的「：——」 | r2 D4 补两条兜底与 R4 用例（空 `finding_ids`、空 `note` 各一）；`meta.ts:325` 的形状判据只判顶层四个数组，逐条形状由读点自己兜（该处注释原意），报告这一读点因此要做 |

## 零意见侧

- codex：本轮结论 `pass`、零意见，无可裁决条目。
- glm：本轮结论 `pass`、零意见。其「未覆盖范围」第 2 条提到 T4 / T5 要在两次 `--check` 之间改夹具的 `joint_blocker_policy`，编码时先看 `test/helpers/fixture.ts` 有无配置覆盖机制，没有就补一个改配置的辅助——这不是意见，顺手写进 r2 第三节；第 4 条提到「`--run-id` 固定旧轮重跑」的直接测试是可选加固，r2 第三节加一条 T7。
