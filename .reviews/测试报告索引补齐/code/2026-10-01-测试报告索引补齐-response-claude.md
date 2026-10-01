---
schema: trivium.disposition.v1
topic: 测试报告索引补齐
stage: code
role: claude
kind: response
run_id: 20260930T235225Z
addresses:
  - 2026-10-01-测试报告索引补齐-codex.md
  - 2026-10-01-测试报告索引补齐-gemini.md
  - 2026-10-01-测试报告索引补齐-glm.md
---

# 应答：测试报告索引补齐 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260930T235225Z.diff`（相对 `466bb59` 的 17 个文件）
> ｜ 运行：`20260930T235225Z`（约 11 分 56 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 7）｜ gemini `approve`（零意见）｜ glm `approve`（零意见）
> ｜ 共 9 条：接受 8、驳回 1、暂缓 0（CODEX-05 部分采纳，理由见表）；三侧均为结构化结论，无降级、无回退

## 0. 核实记录

- **CODEX-01**：不成立。`parseSection` 在条目行上先把**全部**链接收进 `links`，`ENTRY_RE` 命中后 `links.shift()` 去掉的是第一条（即条目链接本身），其余链接随后照常进 `inline`——不会被丢弃。用编译产物对活仓库实测，审查意见点名的五处条目行同行链接全部在 `inline` 里：05_testing :42 `./evidence/m10a-step4-mutation-20260923/`、:46 两条（`m10b-ev107-20260925/`、`m10b-entry-probe-20260925/`）、:47 `./evidence/m10b-step2-20260925/`，04_development :25 `../07_manuals/QUICKSTART.md`，02_design :24 PRD 链接。反向验证 D7 改的 `(./evidence/m10b-step2-20260925/)` 恰在 :47 这一**条目行**上，已红出 `[inline_dangling]`（`reverse-check.json`）；B11 也断言条目行 `REPORT_2026-09-11_b.md` 上的 `./evidence/x/` 在 `inline` 里。
- **CODEX-02**：一半成立。`'other'`（fifo 等）排除在覆盖之外是头注释写明的口径；但**断链软链**（列得出名字、`stat` 失败、`kind` 为 null）同样被静默滤掉，注释没写、也没有用例——与「fail-closed」不符。
- **CODEX-03**：成立。`dateOf` 不锚定、不校验月日：错打日期的文件名能过顺序判据，版本号尾巴也会被认成日期。
- **CODEX-04**：成立（形状假设未进前提检查，构造不出来时报的是 fs 原始异常）。
- **CODEX-05**：一半成立。`read_fork_check.forks` 写死 0 成立（虽然非零时脚本早已退 2，但读数不该写常量）。「读数默认写到仓库外」不采纳：证据目录里的读数 JSON 就是本主题要交付的证据，重跑即刷新是有意的用法，与以往各主题证据脚本同一口径；且这些文件目前未跟踪（不是「已跟踪」），审查期间我没有重跑任何脚本。
- **CODEX-06**：成立。mtime 判新鲜度不可靠；改为脚本开头自己跑一次 `node scripts/build.mjs --tests-only`，产物与源码同批，不再依赖 mtime。
- **CODEX-07**：成立。子进程无超时，挂住时镜像目录留在 tmpdir。
- **CODEX-08**：成立。AGENTS.md 那一行比规范句窄（只说「按日期升序」），会成为口径更窄的第二事实源。
- **CODEX-09**：成立（文档层面）。spec 报告器输出形状是隐含前提，脚本文首没写。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 驳回 | 实测不成立：`links.shift()` 只去掉条目链接本身，同行其余链接照常进行内链接；点名的五处全部被解析，D7 正是改在条目行 :47 上并已变红，B11 也钉住了这一形态 | 无修改（核实记录见 §0） |
| CODEX-02 | codex | minor | 接受 | 断链软链静默不可见与 fail-closed 口径不符；改为「列得出名字而 `kind` 为 null」也计入覆盖，没进索引报 `missing`、进了索引报 `dangling`，两条路都红；`'other'` 维持排除并在注释里写明理由 | `test/helpers/doc-archive-index.ts` `checkIndex` 覆盖过滤与头注释；契约测试新增 B12（断链软链没进索引 ⇒ missing、进了 ⇒ dangling，`other` 不报）；反向验证新增弱化 W9（断链不计覆盖） |
| CODEX-03 | codex | nit | 接受 | 日期段改为锚定文件名起头（可带一个大写前缀加下划线，如 `REPORT_`），其后须跟 `_` 或 `-`，并校验月 01～12、日 01～31；不合格的按「无日期」处理，于是错打日期的报告会被「非报告文件在前」那条判红 | `dateOf`；B10 补 `dateOf` 正反例（含 `REPORT_2026-99-99_x.md`、`v1.2026-01-01.md`、主设计那种无前缀形态） |
| CODEX-04 | codex | nit | 接受 | 镜像依赖 `dist/test` 是真目录、`dist/test/test` 是真目录这一构建形状，补进前提检查，不满足退 2 | `reverse-check.mjs` 前提检查（`lstat`） |
| CODEX-05 | codex | nit | 接受 | 采纳 `forks` 取实际计数；不采纳「读数默认写到仓库外」——证据 JSON 就是交付物，重跑刷新是有意用法，与以往证据脚本同口径，且审查期间未重跑任何脚本 | `baseline-red.mjs` 的 `read_fork_check.forks` 改取 `forks.length` |
| CODEX-06 | codex | nit | 接受 | 两个证据脚本开头先跑 `node scripts/build.mjs --tests-only`（失败退 2），去掉 mtime 判据 | `lib.mjs` `checkPrereqs` |
| CODEX-07 | codex | nit | 接受 | git 与 `node --test` 子进程都加 `timeout`；超时按退 2「环境前提不满足」报，镜像在 `finally` 里照常删除 | `lib.mjs` `git()`；`reverse-check.mjs` `runTest` |
| CODEX-08 | codex | nit | 接受 | 这一行改为只指向规范出处：条目形态与顺序口径见 05_testing README 的规范句、判定以 `test/helpers/doc-archive-index.ts` 为准；仍只有这一行 | `AGENTS.md` 改动同步清单那一行 |
| CODEX-09 | codex | nit | 接受 | 只补文档：脚本文首写明按本机 Node 的 spec 报告器解析（本次 v25.2.1）、解析不出即退 2；浅克隆或部分克隆下 `baseline-red` 退 2 | `reverse-check.mjs`、`baseline-red.mjs` 文首注释；报告 §5 证据表 |

## 2. 修订后的验证计划

按修订后的代码与文档重跑：目标测试、`baseline-red`、`reverse-check`（新增 W9）、门面测试、`npm run check` 一次、doctor 自检；读数写进报告 §6。
