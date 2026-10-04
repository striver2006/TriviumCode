---
schema: trivium.disposition.v1
topic: 探活指纹读盘兜底
stage: code
role: claude
kind: response
run_id: 20261003T170731Z
addresses:
  - 2026-10-04-探活指纹读盘兜底-codex.md
  - 2026-10-04-探活指纹读盘兜底-gemini.md
  - 2026-10-04-探活指纹读盘兜底-glm.md
---

# 应答：探活指纹读盘兜底 · 代码双审第 1 轮

> 被审对象：相对 `d6404d6` 的工作树补丁（17 个文件，`_meta/changes-20261003T170731Z.diff`）
> ｜ 运行：`20261003T170731Z`（约 8 分 11 秒）
> ｜ 结论：codex `approve-with-nits`（次要 1、吹毛求疵 1）｜ gemini `approve`（零意见）｜ glm `approve`（零意见）
> ｜ 共 2 条：接受 1、驳回 1、暂缓 0

两条都回源码核过。gemini 与 glm 零意见，其「未覆盖范围」（未复跑读数、未实测真实 CLI、`TRIVIUM_DEBUG` 打栈无用例）属只读审查与零配额的固有边界，后者已在报告 §6 第 3 条登记，不另处置。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：`AuthProbe.fingerprint`（`adapters/base.ts`）是新适配器作者定「读不了怎么办」的第一处，注释只写「null = 无从计算」，旁边又有 zcode 的 catch→null 先例，照抄就复刻 EV-203 的窄格。新口径只写在 `probeAuth` 的文档注释里，契约定义处没跟上。只补注释，不改行为 | `src/trivium/adapters/base.ts` 的 `fingerprint()` 注释补一段：文件在而读不了应直接抛、由 `probeAuth` 统一兜（不查也不写缓存、详情注明，EV-202）；null 专留「无从计算」，不要把读盘异常折成 null（zcode 现写法见 EV-203） |
| CODEX-02 | codex | nit | 驳回 | 确认是有意口径，不改：本仓「探活 / 探针一侧的附加提示接在该侧 detail 末尾、不标 `warn`」自 EV-197（zcode 残留）、EV-200（codex 残留）起一致，本题的指纹注明照同一接法（计划 r2 §2.1 要点 4、RUNBOOK 与设计 §8.1 都按「详情末尾」写）。信息并非不可见：文本模式 `renderPreflight` 打 detail，`--json` 的 `checks[].detail` 恒在。审查员自己也指出只改这一条会造出第四份不一致；三条一起改进 `warnings` 是转述口径的统一决策，越出本题（决策四不改判据与输出形状之外的东西），本题不动，也不新登条目（不是缺陷，是口径选择） | 无修改（本应答件记录确认） |

## 2. 改码后的验证计划

只动 `base.ts` 一处注释，不涉行为：重建后跑新用例与相关回归、全量两次（串行）、doctor 自检，读数补进报告 §4 与 §5。
