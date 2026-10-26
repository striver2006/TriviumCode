---
schema: trivium.disposition.v1
topic: 网关模型名后缀大小写
stage: code
role: claude
kind: response
run_id: 20261026T153202Z
addresses:
  - 2026-10-26-网关模型名后缀大小写-codex.md
  - 2026-10-26-网关模型名后缀大小写-gemini.md
  - 2026-10-26-网关模型名后缀大小写-glm.md
---

# 应答：网关模型名后缀大小写 · 代码审第 1 轮

> 被审对象：相对 HEAD `1f8e8e87` 的未提交改动（补丁 `_meta/changes-20261026T153202Z.diff`，42 个文件、209.8 KB）。
> 评审循环第 1/3 轮：codex `pass-after-changes`（1 major），gemini `pass`（零意见），glm `pass`（零意见）。计票 2 通过 / 1 修改后通过 / 0 不通过 → 通过。
> 裁决前核过的依据：`diag-suffix-codepoints.mjs` 对已豁免的模型名键直接打印原值 `v`；`gatewayScrubPlan`（`src/trivium/adapters/claude.ts:538-549`）的守卫 ③ 只比完整值，而 `scrubGatewayEnv`（`:562-566`）对输出做子串级逐值替换再过模式脱敏——值 `〈凭据〉/qwen[1M]` 过四道守卫被豁免，产品输出里该凭据子串会被替换，诊断脚本却原样打出。CODEX-01 成立。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| --- | --- | --- | --- | --- | --- |
| CODEX-01 | codex | major | 接受 | 属实：豁免只说明「整值不是凭据、不与凭据同值」，不排除凭据作为子串出现在模型名值里；产品出屏前有子串级逐值替换，诊断脚本绕过了它，违背「不打印任何凭据值」，且清单要求把输出文件交回。 | ①`diag-suffix-codepoints.mjs` 在出屏边界逐行过产品的 `scrubGatewayEnv(行, env)`（与产品同一份替换集与模式脱敏，不另写口径）；某行被改写时在行尾标「（该行含凭据子串或命中模式脱敏，已按产品口径脱敏；此值不作逐字期望）」。②`--self-test` 补一格：模型名键值为「凭据值 + `/qwen[1M]`」（过四道守卫被豁免），断言输出不含该凭据原文与码点序列、且该行带上述标注；本机重跑自检并替换 `diag-self-test-macos.txt`。③`windows-acceptance.md` 第 1 步说明里补「已豁免的值也经产品口径脱敏后才打印，带标注的行不作逐字期望，原样发我」；第 0 步自检的说明补这一类反例。④报告 §6 记本条。不动产品代码（产品侧本就脱敏，缺口只在诊断脚本）。 |

## 其余

gemini、glm 零意见、结论通过，无可裁决条目。驳回 0、暂缓 0。
