---
schema: trivium.disposition.v1
topic: 多轮评审循环
stage: code
role: claude
kind: response
run_id: 20261022T005651Z
addresses:
  - 2026-10-22-多轮评审循环-r2-gemini.md
  - 2026-10-22-多轮评审循环-r2-glm.md
---

# 应答：多轮评审循环 · 代码双审第 2 轮

> 被审对象：相对 `faae0483` 的工作树改动（73 个文件），计划定稿 `plan/2026-10-22-多轮评审循环-r2-claude.md`。
> gemini `approve`（0 条），glm `approve-with-nits`（1 条 minor、1 条 nit）。2 条全部接受，修改在审批之后进行。
> 裁决前逐条对过代码：
> - GLM-01：`approval.ts:121` 在 `readTaskStrict` 返回 `unreadable` 时 `return true`。`previousRoundFacts`（`review.ts` 的遍历循环）对每个 run_id 都调用它，于是 task.json 读不出时每一轮都是 `closed=true`：跳过谓词 `!closed && …` 恒假，最新一份（哪怕是失败轮或跳过轮）直接作为「上一轮」返回；`deriveReviewLoop` 的 `open` 要求 `!prev.closed`，human_review 拒绝与 rerun 续链两格都不成立，落到「新链、第 1 轮、上限取显式值」。审查员的推理成立。r2 计划 §四.4 写的「task.json 读不出时 fail-closed 判已表态 ⇒ 新链」，是把闸门推进语境里的 fail-closed（不推进审批）直接搬到了轮次链语境，在这里方向反了，是 fail-open。
> - GLM-02：`test/integration/review-loop.test.ts` 的 L1–L9 里没有 undetermined 形态；桩已有 `legacySchema`（`stub.ts:182`，L9 附近 320 行已用过单侧），两侧都打开就能构造 n=0。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| GLM-01 | glm | minor | 接受 | 核实属实：task.json 读不出会让本轮新补的两道归档守卫（human_review 未表态拒绝起链、失败轮和跳过轮不断链）同时失效，并静默新起一链；这和同一函数里「run 留痕读不出就硬失败」的口径不对称。`humanDecidedThisRound` 在闸门推进语境里的 fail-closed 保持不变（`gate --check` 依赖它），只在轮次链判定这一处把「读不出」和「确已表态」区分开 | `src/trivium/review.ts` `previousRoundFacts`：`ids` 非空时先 `readTaskStrict(layout)` 一次，`unreadable` ⇒ 抛 `EXIT.GATE_BLOCK`，文案点名 task.json、写明「不按已表态新起一链」，发生在分配 run_id 之前（零工件），与读不出 run 留痕同口径；遍历内的 `closed` 改为用这次读到的 task 判定（不再逐轮重复读文件）。`humanDecidedThisRound` 不改，注释补一句「轮次链语境不经它判读不出」。函数头注释同步。r2 计划 §四.4 那句改写为硬失败（写进 r3 计划或在交付说明里登记计划偏差，按用户选）。`test/integration/review-loop.test.ts` 补 L10：上一轮 human_review 未表态，task.json 写坏 ⇒ `review --start` 退 `GATE_BLOCK`、点名 task.json、零工件；设计 6.7.1 补一句 |
| GLM-02 | glm | nit | 接受 | 收尾计票到 cli 分流、`--wait` 透出这条接线只有纯函数层（R8/R18）钉住，接线回归时单测照绿；桩已有现成旗标，补一格的成本很低 | `test/integration/review-loop.test.ts` 补 L11：双审两侧都 `legacySchema: true` ⇒ run.json `round_verdict.outcome = 'undetermined'`、`next_action = 'human_review'`，`gate` 立 `awaiting_approval`，`--wait --json` 透出 `next_action: human_review`；接着不表态再 `--start` ⇒ 退 64（与 L7 同一出口） |

## 修改计划

审批后两处一起改：GLM-01 改 `previousRoundFacts` 和对应注释、补 L10；GLM-02 补 L11。然后 `npm run check`，全量测试跑两次，`install:local` 后实测一次 L10 的形态。

GLM-01 改的是续链判据（拒跑与否），按 M11 分档属于「改判据」，改完再送一轮代码双审（第 3 轮）；GLM-02 只加测试，随同一轮一起审。

## 遗留事项（提请用户处理）

- r2 计划 §四.4 的「fail-closed 判已表态 ⇒ 新链」与本轮接受的 GLM-01 冲突。需要你选：补 r3 计划后再改码，还是直接改码、在交付说明里登记这一处偏差。
- gemini 一侧 `consulted_unverified: true`，它的「实际查阅」清单里列了 `CLAUDE.md` / `AGENTS.md` 等，我没有逐条核验它的轨迹。它判 approve、0 条意见，不影响本轮裁决，仅记录在此。
