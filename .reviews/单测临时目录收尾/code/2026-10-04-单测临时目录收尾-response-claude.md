---
schema: trivium.disposition.v1
topic: 单测临时目录收尾
stage: code
role: claude
kind: response
run_id: 20261004T140527Z
addresses:
  - 2026-10-04-单测临时目录收尾-codex.md
  - 2026-10-04-单测临时目录收尾-gemini.md
  - 2026-10-04-单测临时目录收尾-glm.md
---

# 应答：单测临时目录收尾 · 代码双审第 1 轮

> 被审对象：相对 HEAD（`ae5dfbd`）的 75 个文件变更（`_meta/changes-20261004T140527Z.diff`，778.2 KB，大头是证据目录的两次全量输出）
> ｜ 运行：`20261004T140527Z`（约 22 分 18 秒，三侧到齐）
> ｜ 结论：codex（`k3`）`approve-with-nits`（吹毛求疵 1）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 共 2 条：接受 2、驳回 0、暂缓 0

三侧都独立核了守卫的对账面：codex 用 `dist` 里的 `stripNonCode` 复算，162 个 `.ts` 的非零分布与豁免表 23 个文件 / 39 处逐项相等、表外零裸调用；glm 抽查了 6 个豁免文件的调用形态，并核出表外 6 个有命中的文件全是注释。机械替换方面 codex 做了全 diff 增删行扫描加 12 个文件细读、glm 抽查 8 个，均未见走样、无悬空的 `os` / `fs` 引用。登记时机（与 mkdtemp 返回同一同步段）、登记时解析路径、退出防呆三条件、`makeFixture` 三句提示逐字不变，三侧都认为由用例与变异钉住。

codex 在盲区里提到守卫认不出解构别名（`import { mkdtemp as m }`）与方括号拼名调用——与报告残余 3「字符串里的调用」同属形态外盲区，现状为零，本轮不补，报告残余 3 补写这两种形态。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | nit | 接受 | 属实：报告 §3 的 G1 行照抄了计划 r2 §3 的「现 159」，那是 `scratch.ts`、`scratch-guard.test.ts`、`scratch-cleanup.test.ts` 三个新文件建出来之前的数，落地后是 162。按建议改成「前置断言 > 100；本题落地后 162 个」——写明这个数取自哪个时点，守卫本身仍只断言下限。计划 r2 是当时的留痕，不回改 | `doc/05_testing/REPORT_2026-10-04_test_scratch_cleanup.md` §3 G1 行 |
| GLM-01 | glm | nit | 接受 | 属实：`^trivium-[A-Za-z0-9_-]*$` 放行 `trivium-`（尾段为空）与 `trivium-a`（无尾连字符），而错误消息与两处文档（报告 §2、BACKLOG EV-208）都写「形如 trivium-xxx-」（审查件说设计 §17.1 也这么写，核过不是：§17.1 补的那句与 v1.3.86 变更记录都没写前缀形状）。取「收紧实现」而不是「放宽文案」：尾连字符把随机后缀与前缀隔开，退出防呆按名字认目录时更不含糊；现有 118 个字面前缀与 `cancel-grace-unverifiable` 的模板前缀 `trivium-ev176-〈格名〉-`（格名均为字母数字）全部满足收紧后的形状，已逐个核过。正则改为 `^trivium-[A-Za-z0-9_-]*[A-Za-z0-9_]-$`（`trivium-` 之后至少一个字母数字下划线、以连字符结尾），错误消息与注释同步写明；SC6 的拒绝样例补 `trivium-` 与 `trivium-a` 两个边界 | `test/helpers/scratch.ts` 的 `PREFIX_RE`、`checkPrefix` 消息与注释；`test/integration/scratch-cleanup.test.ts` SC6；报告 §2 前缀一句、§3 SC6 行 |

## 2. 修改计划

1. `scratch.ts`：收紧 `PREFIX_RE`，消息改为「前缀必须形如 trivium-xxx-（trivium- 之后至少一个字母、数字或下划线，只含字母、数字、下划线、连字符，以连字符结尾）」。
2. `scratch-cleanup.test.ts`：SC6 子用例的拒绝样例加 `'trivium-'`、`'trivium-a'`。
3. 报告：§2 前缀一句、§3 G1 与 SC6 两行、残余 3 补别名与拼名两种形态、§7 代码双审小结。
4. 改后：重建并单跑三个套件；变异 M7（去掉前缀校验）与全量照规矩重跑，读数补进报告。
