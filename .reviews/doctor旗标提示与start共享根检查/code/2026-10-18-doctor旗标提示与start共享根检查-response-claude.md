---
schema: trivium.disposition.v1
topic: doctor旗标提示与start共享根检查
stage: code
role: claude
kind: response
run_id: 20261018T081641Z
addresses:
  - 2026-10-18-doctor旗标提示与start共享根检查-gemini.md
  - 2026-10-18-doctor旗标提示与start共享根检查-glm.md
---

# 应答：doctor旗标提示与start共享根检查 · 代码双审第 1 轮

> 被审对象：相对 `7fc1f38a` 的工作树改动（24 个文件），计划定稿 `plan/2026-10-18-doctor旗标提示与start共享根检查-r2-claude.md`
> gemini `approve`（无意见），glm `approve-with-nits`（1 条 nit）。1 条接受。
> 裁决前核过：`checkSharedReadRoots` 的 catch 分支确实插值了 `occasion`，全仓没有用例走到这一支（`preflight.test.ts` U6 只测三条正常路径，`doctor-shared-roots.test.ts` 测的是 `runDoctor` 自己的内联 catch）。扫描本身对文件系统异常很宽容（`exists`、`readdir` 都吞错），用文件系统造不出抛错；实测给注入口传一个不是字符串的 `home`，`sharedReadRootTargets` 会在 `try` 内抛 TypeError，两种场合词各自出现在 detail 里，可以稳定钉住。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | nit | 接受 | 成立：本题给 catch 分支也加了场合词，但只有正常分支有断言与变异；有人只把错误分支写死成「本次预检」时测试全绿，`--start` 在扫描出错时会念错场合词——正是加场合参数要避免的混淆。补一格代价很小 | ①`test/unit/preflight.test.ts` 加一格：注入口 `home` 传非字符串，缺省调用的 detail 以「⚠️ 共享读取面检查没做成（不影响本次预检）：」开头，传「本次运行」时以「（不影响本次运行）：」开头，两次都是 `ok: true`、`warn: true`、无退出码。②变异规格加 M14（catch 分支的场合词写死成「本次预检」），预跑与正式装置重跑一遍。③报告 §3.2、§4、§5 与主设计修订记录、17.2 行同步计数 |

## 代码双审运行告警的处置

- 「glm 侧结论结构问题：evidence 引用但未列入 consulted」：glm 在 GLM-01 的依据里引用了 `mutation-spec.json`，却没把它列进查阅清单。属审查员输出的结构瑕疵，不影响该条意见本身成立（依据里的其余三处源码与测试位置都已回源核实）。不处置。
- 「模型族 unknown：左侧模型信息缺失」：本轮会话没有声明 Driver 模型（S0.5 `driver_model` 为 null，按约定不推断）。不处置。
- 「安装副本不是当前工作树构建的」「安装副本与仓库 HEAD 不同版（构建于 f08bb7c）」：本机 `.trivium/bin` 指向全局安装副本，本题改动尚未提交、更未重装，这是预期状态。提交推送并从已提交状态重建之后，由用户在终端重装。
