---
schema: trivium.disposition.v1
topic: 多轮评审循环
stage: code
role: claude
kind: response
run_id: 20261022T023850Z
addresses:
  - 2026-10-22-多轮评审循环-r3-gemini.md
  - 2026-10-22-多轮评审循环-r3-glm.md
---

# 应答：多轮评审循环 · 代码双审第 3 轮（评审循环第 1/3 轮）

> 被审对象：相对 `faae0483` 的工作树改动（74 个文件），重点是第 2 轮两条接受项（审批正本读不出时续链拒跑、L10 / L11）。
> 计票：gemini `pass`（0 条）、glm `pass`（3 条 nit）⇒ 通过，下一步 `proceed`。3 条全部接受，本轮写完应答件即改码（第 5.5 步）。
> 裁决前逐条对过：
> - GLM-01：r2 应答件给 L11 的落点写了「`gate` 立 `awaiting_approval`」，现行 L11（`test/integration/review-loop.test.ts`）确实没有跑 `gate --check`、没有断言闸门状态，承诺少兑现了一格。
> - GLM-02：r2 应答件 GLM-01 落点末句写「设计 6.7.1 补一句」，实际补在 8.2.1（设计文档 1855 行），6.7.1 的两行字段说明没有改。是我写落点时的笔误。
> - GLM-03：`cli.ts` 的 `--await-approval`（1497 行）与 `--check`（1679 行）在 `humanDecidedThisRound` 返回 true 时都说「本轮已有人工审批记录」，而正本读不出时它也返回 true；`--check` 之后的本机状态对账还会接着说「归档记着本轮已审批」，两句在这一格都不实。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| GLM-01 | glm | nit | 接受 | 核实属实：r2 承诺的四格少兑现了「闸门立停点」一格，而 undetermined 走停点只靠 `next_action` 这一个开关传递，补一格断言成本很低 | `test/integration/review-loop.test.ts` L11：`--wait` 透出之后、删本机状态之前，写合规裁决件（按两侧整份回退时的实际意见编号）并跑 `gate --check`，断言 `next_action` 为 `human_review`、闸门为 `awaiting_approval` |
| GLM-02 | glm | nit | 接受 | 核实属实，是落点笔误：内容已兑现在 8.2.1，6.7.1 没有改，也不需要改（那两行是字段说明，拒跑规则属于 8.2.1 的轮次链判定）。r2 应答件是已审批的留痕，不回改，在这里订正 | 本裁决件订正：r2 应答件 GLM-01 落点里的「设计 6.7.1 补一句」应为「设计 8.2.1 补一句」，实际落在 8.2.1「轮次链与上限」条；设计文档版本记录 v1.3.170 第五段补一句指向这次订正 |
| GLM-03 | glm | nit | 接受 | 核实属实：方向是保守的（不推进闸门），但文案把「正本读不出」说成了「有人表过态」，会把排查引向错误方向；`--check` 后面的本机状态对账在这一格也会接着报错。把三种情形分开，各给各的文案 | `src/trivium/approval.ts`：新增 `humanDecision(layout, stage, runId)`，返回 `decided` / `undecided` / `unreadable`，`humanDecidedThisRound` 改为「不是 `undecided`」（语义不变）；`src/trivium/cli.ts` 的 `--await-approval` 与 `--check` 两处改调它，`unreadable` 时说「审批正本 task.json 读不出，按已表态保守处理：闸门状态保持不变，请先用 git 恢复正本」，`--check` 在这一格跳过「归档记着本轮已审批」的对账告警；`test/unit/approval.test.ts` 补 `humanDecision` 三态一格；`test/integration/review-loop.test.ts` L10 补一步：正本写坏后 `gate --await-approval` 输出新文案、不出现「已有人工审批记录」、不立停点（原定用 `--check` 断言，改码时发现 `--check` 在判定之前就把坏正本覆盖掉了，见下方遗留事项；`--check` 这一支的新文案由 `humanDecision` 单测间接覆盖） |

## 修改说明

三条都在本轮第 5.5 步改完，然后跑 `npm run check`，全量测试跑两遍。本轮计票为 `proceed`，改完进人工审批停点，不再自动重审；GLM-03 只改文案、不改判据（返回值与闸门去向不变），所以不另送一轮。

## 遗留事项（提请用户处理）

- **改 GLM-03 时实测发现，已登记 BACKLOG EV-248**：`updateTask` / `updateTaskAsync` 用宽松读法读正本，task.json 读不出时会当空正本写回，审批记录随之丢失。`gate --check` 在判「是否已表态」之前就会写一次 `joint_checks`，所以正本写坏后跑 `--check`：坏件被覆盖，随后判成未表态并立停点。glm 本轮「认为正确的部分」里说「`gate --check` 的 fail-closed 在轮次链语境不构成静默跳过」，前提是这道 fail-closed 真能生效，而在 `--check` 这条路径上它生效不了。这个问题早于 EV-247，不在本主题范围内，本轮不改，开不开题由用户定。
- L11 的裁决件按结构化编号（AGY-01 / GLM-01）写，不是 `-F` 编号：`gate` 重读归档时两版格式都认，回退侧会被重新解析出结构化意见，这是既有设计（`gate` 的提示里写明了「口径差」）。
