---
schema: trivium.disposition.v1
topic: M12-作废侧重跑一次
stage: code
role: claude
kind: response
run_id: 20261017T152647Z
addresses:
  - 2026-10-17-M12-作废侧重跑一次-gemini.md
  - 2026-10-17-M12-作废侧重跑一次-glm.md
---

# 代码应答：M12-作废侧重跑一次（第 1 轮）

gemini 侧 `approve`、零意见；glm 侧 `approve-with-nits`、两条 minor。两条都回代码核过，均接受。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | minor | 接受 | 属实：计划 r2 §4.3 的闸门一行（`attempts[0]` 作废、最终干净 ⇒ `voidedSides` 为空；最终 `guard` 作废的旧记录仍排出）没有以闸门层用例交付，`gate.test.ts` 作废侧一组的夹具都不带 `attempts`；AC-25 集成格只是经共同阻断旁路观测到，且报告偏离清单没记这一条 | `test/unit/gate.test.ts` 作废侧一组补一格：同一份 run.json 里一侧 `attempts[0]` 作废、`guard.peer_leak_via_*` 干净 ⇒ `voidedSides` 不含它；另一侧最终 `guard` 作废、无 `attempts` ⇒ 仍排出。报告 §3 删去「无闸门直测」的含糊处，如实写这格是代码双审后补的 |
| GLM-02 | glm | minor | 接受 | 属实：重跑那次若以 `adapter.run` 抛异常收场，`runOneSide` 的重抛路径不带逐次记录与点名段，`runBothSides` 的 rejected 分支只合成失败结果——`status.json` 记着重跑过、run.json 一字不提，实际送出的点名段也没进 `_meta/`，违反「审计材料与实际送审一致」 | `src/trivium/runner.ts`：重抛时把已有的逐次记录（含发生过作废重跑时的全部条目）与点名段挂在错误上（与 `scrub` 同款）；rejected 分支取出交回，只在发生过作废重跑时交（与 fulfilled 分支同口径），抛异常的那次补一条 `status: failed`、`fail_reason` 为异常原文的条目。`test/unit/void-rerun.test.ts` 补一格：首次作废、重跑那次适配器抛异常 ⇒ 结果 failed、`attemptLog` 两条、`rerunBanners` 有键 |

## 修改计划

1. GLM-02：改 `runner.ts` 的重抛与 rejected 分支，补单测；跑 `void-rerun`、`runner` 两个套件与 fault-injection。
2. GLM-01：补闸门单测，跑 `gate` 套件；报告 §3 同步。
3. 改完后补一条对应变异（重抛时不挂逐次记录）验证新用例咬住；全量两次、`install:local`、verify，然后跑真实回归。
