---
schema: trivium.disposition.v1
topic: EV-82-审查臂诊断
stage: plan
role: claude
kind: revised
run_id: 20260924T025839Z
addresses:
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
---

# 裁决：EV-82 审查臂诊断 · 单侧派发第 2 轮

> 被审对象：`2026-09-24-EV-82-审查臂诊断-claude.md`（原稿，与第 1 轮同一份，`subject_sha256` 未变）
> ｜ 运行：`20260924T025839Z`（12m30s）｜ 入选审核者：glm 一侧（配置意图，非降级）
> ｜ glm 侧结构化产出（`approve-with-nits`）：共 6 条，次要 4 ｜ 吹毛求疵 2 ｜ 零阻断
> ｜ **全部接受**，落点是新写的 `2026-09-24-EV-82-审查臂诊断-r3-claude.md`（下称 r3 稿）；原稿不改

## 0. 本轮的形状

- 本轮焦点里加了一句「勿调用 `ExitPlanMode`，直接在最终回复里输出完整 JSON」。审查员照做了：rollout 末条以 `stop` 收尾，结构化结论落盘。
  这只是用提示词绕开了第 1 轮的截断成因，**成因本身没有处理**（r3 稿 §6 第 4 条）。
- **模型路由读数与第 1 轮一致，仍落 (D)**：`model_effective` = `bigmodel-coding-plan/GLM-5.3`，`model_override_applied: false`，`model_route: config_copy`；
  rollout 共 10 条记录，顶层 `model` 与 `response.modelId` 全为 `GLM-5.3`。两轮的读数与判读合并写在 r3 稿 §5。
- 6 条意见我逐条回到代码与台账核过，引用全部属实：
  - `zcode-trace.ts` 两处解析都是「首个即定值」，`response.modelId` 不读（GLM-01）；
  - `failedResult` 不带两个路由字段，`review.ts` 对它们是条件展开，`status` 恒写（GLM-02）；
  - `providerId` 缺失时 `model_effective` 落为裸 modelId；EV-87 记有 09-21 个人配置被重写（GLM-03）；
  - `cli_version: probe.version`；r5 第 119 行记着当日 preflight 的读数（GLM-04）；
  - reason 只写进 `trace.json` 的 `modelSelection`（GLM-06）。
- GLM-04 我多核了一层：preflight 的 `readCliVersion` 是现场执行入口取版本，并与探针记录比对，不一致即判失败。所以「版本串未变」可以落到实测上。
- GLM-05 的落点里，副本源摘要是本轮派发后新取的读数：sha256 前 16 位 `ca15dc0c018cce74`，mtime 2026-09-20 19:12:00（+0800）。只取摘要，不打印内容。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | 次要 | 接受 | 核实属实：`zcode-trace.ts` 日志解析取首个非空 `context.model`，rollout 解析取首条记录的顶层 `model`，两处都是「首个即定值」，`response.modelId` 不读，`zcode.ts` 取 `modelFromLog ?? modelFromRollout`。所以 run.json 的形态只能证明首条请求。(C) 会导向 BACKLOG 追加与 T2，假阳性代价高，旁证又便宜（rollout 已拷进 `out/`）。第 1 轮裁决件 §0 已按这个核法做过，本条把它从临时动作升为判读规则 | r3 稿 §3「`model_effective` 只取首个非空记录」一段、判读次序第 4 条、(C) 行观测形态加「rollout 逐条一致」、(E) 行加「rollout 与 run.json 不一致」；T2 判据面同步补这一条，列为 r3 稿 §6 第 1 条（r5 已定稿不改，交 EV-82 小主题计划落） |
| GLM-02 | glm | 次要 | 接受 | 核实属实：`zcode.ts` 的三条失败出口（拉起失败、脚本超时、执行失败）都先于 `decideModelOverride` 返回 `failedResult`，后者不带 `model_route` / `model_override_applied`，`review.ts` 对这两个字段条件展开，只有 `status` 恒写。于是失败侧同时符合 (A)「字段缺席」和 (E)「运行失败」，五格不互斥。先按 `status` 分流就能消除重叠 | r3 稿 §3 判读次序第 1、2 条（先读 `status`，非 `ok` / `parse_fallback` 一律 (E)）；字段清单加 `status`；(A) 行观测形态加「`status` 正常」前提；(E) 行加「`status` 异常」 |
| GLM-03 | glm | 次要 | 接受 | 核实属实：「provider 段为 UUID 形态」来自一次回读快照，不是机制不变量。个人配置的键形态按凭据纪律未读，EV-87 记有 09-21 个人配置被重写；`zcode-trace.ts` 在 `providerId` 缺失时落裸 modelId。这两种形态原表都接不住。反方向同样成立：(D) 的「隔离成立」一腿以「个人 provider 键 ≠ legacy 键」为前提，而这一前提本轮没有机制支撑。放宽 (B)、给 (D) 加前提注，两件都做 | r3 稿 §3 (B) 行改为「provider 段 ≠ 副本源 legacy 键（UUID 是已见形态之一），或无 provider 段」，读出改为「疑似隔离失效」；§3 注第 2 条写明 (D) 隔离腿的前提；§3 判读次序第 5 条兜底归 (E)；机制支撑的补法列为 r3 稿 §6 第 2 条 |
| GLM-04 | glm | 次要 | 接受 | 核实属实：run.json 的 `cli_version` 是 `probe.version` 冻结值，原稿 §2 没写版本串读数的来源。我另核了 preflight：`readCliVersion` 现场执行入口取版本，并与探针记录比对，不一致即判失败。本主题两轮派发前各跑一次，都报 `zcode 0.16.9`，两次都晚于 09-22 的入口替换。所以这半条前提能落到实测上，只需补来源声明 | r3 稿 §2 第 3 步「版本串」一段：写明来源是 2026-09-24 preflight 实测（r5 §1.4⑤），并注明 run.json 的 `cli_version` 是冻结值、不能单独作为证据；「环境前提」第二条改为「版本串未变（实测）」 |
| GLM-05 | glm | 吹毛求疵 | 接受 | 副本源的键序决定首位，成员集决定限定能否通过，键名就是 (C)(D) 的字面判值，却没进基线；原稿 (C)(D) 行写死了 `bigmodel-coding-plan`，副本源一变字面值就会失准。补读数的代价很低（只取摘要与 mtime，不碰内容） | r3 稿 §2 第 3 步新增「副本源」读数（sha256 前 16 位、字节数、mtime，并注明 mtime 是弱证据）；「基线」段并入 `cli/config.json`，加「判读异常格前先复核摘要一致」；§3 (C)(D) 行改为「副本源 legacy 键（本机为 `bigmodel-coding-plan`）」 |
| GLM-06 | glm | 吹毛求疵 | 接受 | 核实属实：`zcode.ts` 只把 `home.reason` 写进 `trace.json` 的 `modelSelection`，run.json 的 glm 段没有 reason 字段。原稿 (A) 行只说「登记环境原因」，没指明去哪读成因 | r3 稿 §3 (A) 行「接下来」列补「成因见该侧 `trace.json` 的 `modelSelection.reason`（run.json 没有这个字段）」；r5 §3.3.1 (A) 行同一处措辞的更正列为 r3 稿 §6 第 3 条 |

## 2. 被审对象的修改

原稿不改：它是两轮派发的被审对象，目录尚未进 git，原地改会丢掉被审原文。修订写进 r3 稿，差异清单在它的抬头；
编号取 r3 而不是 r2，是为了避免和本轮审查件 `-r2-glm` 读混成「审的是 r2 稿」。
