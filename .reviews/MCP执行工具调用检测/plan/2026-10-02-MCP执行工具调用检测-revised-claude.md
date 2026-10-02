---
schema: trivium.disposition.v1
topic: MCP执行工具调用检测
stage: plan
role: claude
kind: revised
run_id: 20261002T072209Z
addresses:
  - 2026-10-02-MCP执行工具调用检测-codex.md
  - 2026-10-02-MCP执行工具调用检测-gemini.md
  - 2026-10-02-MCP执行工具调用检测-glm.md
---

# 裁决：MCP执行工具调用检测 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-02-MCP执行工具调用检测-claude.md`（r1，起点 `6aee012`）
> ｜ 运行：`20261002T072209Z`（约 11 分；真实审查员运行计数 1/6）
> ｜ 结论：codex `approve-with-nits`（次要 4、吹毛求疵 1）｜ gemini `request-changes`（重要 1、次要 1、吹毛求疵 1）｜ glm `approve-with-nits`（次要 1）
> ｜ 共 9 条：接受 9、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-02-MCP执行工具调用检测-r2-claude.md`；命令 A 不设人工闸门

每条都回源码或文档核过；依据里的行号与事实，核对结果写在「理由」列。另：本轮 glm 侧 rollout 的实际调用为 Read 26 / Grep 8 / Glob 1，`node_repl` 0 次（Driver 读运行根核）。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受（改写为边界与次序声明） | 属实：`run.v2.json` 逐侧 `additionalProperties: false`，旧构建读带新键的 run.json 会走「留痕读不出」出口（`meta.ts` 的共用出口段）。但本主题内不会出现混合读：本仓的计划双审与代码双审都由安装副本（旧构建，`904f52c`）执行，它不会写新键；效果层只用新构建、在夹具里跑，不让旧构建读它的 run.json。混合版本只在「提交后、重装前」窗口出现。重装由用户在终端执行（本仓惯例，不由会话执行），所以不把 `install` 列为会话内前置步，而是写明次序与边界 | r2 §2.6 兼容段补「同一轮的全部编排器调用必须出自同一构建」及本主题各次运行分别出自哪份构建；r2 §4 报告与收尾播报写明「提交后先从已提交状态重建、再请用户重装，重装前不要用旧副本跑会出现名单外 MCP 调用的轮次的 gate / report」 |
| CODEX-02 | codex | minor | 接受（按 GLM-01 的构造法） | 属实：r1 §2.2 自己写了「不跳过时结果不变」，变异 10 按自然形态构造必然挂不住。与 GLM-01 同一处，两侧独立收敛；取 GLM-01 给出的可杀构造，而不是把变异登记成等价 | 见 GLM-01 |
| CODEX-03 | codex | minor | 接受 | 属实：历史回放与扫描依赖本机运行根里的原件，换机器或运行根清理后无法重跑；上一题证据目录是「脚本 + 逐字输出快照」双轨 | r2 §3.1「真实历史样本回放」：输入路径做成参数（缺省指向本机那次运行），缺数据时软跳过并在输出里写「已跳过：原件不在」；计数、工具名与「改前 0 / 改后 7」快照连同脚本逐字存档；§1.5 的扫描脚本同样存档并附输出快照 |
| CODEX-04 | codex | minor | 接受 | 属实：`cli.ts` 在没有 `.trivium/config.yaml` 时 Hook 一律放行、critics 与模型配置也无从读取；上一题 `ab-run.mjs` 显式落了 `config.yaml` / `config.local.yaml` | r2 §3.2 夹具配方补一步：照 `ab-run.mjs` 落 `.trivium/config.yaml`（`critics` 只启用 glm、`runtime.run_root` 钉在夹具旁），并在预检前核一遍 |
| CODEX-05 | codex | nit | 接受（改写引用） | 部分属实：脚本**存在**——`doc/05_testing/evidence/orphan-worker-20260927/focus-check.mjs`（审查员只搜了 `src/`、`scripts/`、`skills-src/`）；但 r1 以「既成工具」的口气引用而没给路径，确实含糊。另：它拼的是 `.trivium/bin` 形态的命令，本主题效果层走 `node dist/trivium.cjs`、由脚本以 argv 传焦点，Hook 判据不适用，只需要它的 shell 危险字符检查 | r2 §3.2 写明脚本路径；拷一份进本主题证据目录（`focus-check.mjs`），焦点文件与检查输出一并存档 |
| AGY-01 | gemini | major | 接受 | 属实：`guard.ts:723` 的 `anyReadonlyUnavailable` 只看静态 `rejectionRecorded === false`，zcode 侧为 `true`；名单外 MCP 调用成立时「轨迹无写事件」已不能排除审查员写过，而现实现会把漂移文件全量记进 `fingerprintChangedFiles`（开发者手改），方向与 §11.1 的归因原则相反。补充一个边界：失败 / 超时的一侧不进 `sides`、轨迹不解析，它有没有调 MCP 无从得知——这一格与既有「失败侧不评判证据」同口径，r2 写明为已知边界、不在本主题处理 | r2 §2.4 新增「归因分流」：`judgeRun` 的不可归因条件改为「`anyReadonlyUnavailable` 或本轮有任一判过的侧 `verification.untrusted` 成立」；`renderGuardWarnings` 的「无法归因」段文案改为同时覆盖两种成因（按成因分句）；r2 §3.1 新增 G6（不可信侧 + 漂移 ⇒ 文件进 `unattributedDriftFiles`、`fingerprintChangedFiles` 为空）与 G7（无不可信侧 ⇒ 归因不变）；变异清单加一条「归因条件去掉 untrusted」 |
| AGY-02 | gemini | minor | 接受 | 属实：r1 §2.2 没写明不可信工具名的取集；只从 rollout 取会在 rollout 丢行或没读到时漏记降级，而执行型那支已经有「日志补记」的对称处理 | r2 §2.2：执行型与名单外两支的工具名全集都取「rollout 调用名 ∪ 日志计数键」；r2 §3.1 新增 U10（rollout 为 `null`、日志只有名单外 MCP ⇒ `untrustedTools` 点名、计数正确）与 U11（rollout 有 A、日志另有 B ⇒ 两个都在） |
| AGY-03 | gemini | nit | 接受 | 属实：`doc/03_api/PROTOCOL_dual_critic_relay.md:202-208` 逐项解释 `guard.verification_degraded` 的键，新增 `evidence_untrusted` 不同步就不完整 | r2 §4 文档清单具名列入 PROTOCOL 该段，删去「编码时 grep 决定」的含糊说法（MANUAL 仍按 grep 核，结果写进报告） |
| GLM-01 | glm | minor | 接受 | 属实：`guard.ts:751-763` 的 `breachedAbs` 只做「剥括号 → resolve → 相等比对」，适配器产出的 MCP 摘要以 `{` 或中文开头，自然形态下删掉跳过分支也扣不掉任何文件，变异 10 挂不住。取它给的可杀构造：防御性跳过要守的正是「将来摘要形态变了、括号里恰好是路径」 | r2 §3.1 G5 改为在 `judgeRun` 层直接喂合成写事件 `MCP:mcp__node_repl__js(〈本轮某漂移文件的相对路径〉)`（不经适配器），配一侧 `readonly: unavailable` 让文件进不可归因桶，断言该文件**仍在**桶里；变异 10 保留，预期 G5 红 |

## 2. 修订摘要

- §2.2：两支工具名取集为两来源并集（AGY-02）。
- §2.4：证据不可信参与漂移归因分流；无法归因告警按成因分句（AGY-01）。
- §2.6：同轮同构建的边界与本主题各次运行的构建来源（CODEX-01）。
- §3.1：G5 改为可杀构造（GLM-01 ≡ CODEX-02）；新增 U10、U11、G6、G7；变异清单 +1；历史回放参数化、软跳过、快照存档（CODEX-03）。
- §3.2：夹具落 `.trivium/config.yaml`（CODEX-04）；focus-check 脚本路径与存档（CODEX-05）。
- §4：PROTOCOL `verification_degraded` 段具名同步（AGY-03）；收尾播报写明重装次序（CODEX-01）。

## 3. 另记

- 三侧对 r1 §6 六问的答复：取大去重、`mcp` 为 0 不写、证据不可信挂 `SideVerification`、schema 落点、按 server 前缀判执行型、EV-95 只追加更正——三侧都明确同意或未提异议；glm 对第 3 问答「不必加 gate warning，加了也不反对」，codex、gemini 未提。r2 维持「不进闸门」：五面已保证不塌缩，闸门只放判决。
- 预算：真实审查员运行计数 1/6（本轮）；后续代码双审 1、效果层 1～2。
