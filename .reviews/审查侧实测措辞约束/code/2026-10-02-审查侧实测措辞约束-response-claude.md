---
schema: trivium.disposition.v1
topic: 审查侧实测措辞约束
stage: code
role: claude
kind: response
run_id: 20261002T023804Z
addresses:
  - 2026-10-02-审查侧实测措辞约束-codex.md
  - 2026-10-02-审查侧实测措辞约束-gemini.md
  - 2026-10-02-审查侧实测措辞约束-glm.md
---

# 应答：审查侧实测措辞约束 · 代码双审第 1 轮

> 被审对象：相对 `a03a056` 的工作树补丁（89 个文件，含证据目录）
> ｜ 运行：`20261002T023804Z`（约 9 分 28 秒；真实审查员运行计数 5/12）
> ｜ 结论：codex `approve-with-nits`（次要 1、吹毛求疵 1）｜ gemini `approve-with-nits`（吹毛求疵 1）｜ glm `approve-with-nits`（次要 1）
> ｜ 共 4 条：接受 4、驳回 0、暂缓 0（GLM-01 的接受落点是登记，不改代码，理由见下）

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：claude 侧「不能执行命令」的成立条件是三件合取——`--tools` 白名单、`--restricted`（移除执行命令 / 代码的内建工具）、`--strict-mcp-config`（挡住 MCP 工具混入），而对账只看了第一件；`claude-adapter.test.ts` 的期望值从同一常量自推，删项不红 | `command-execution-parity.test.ts` 的 claude 事实推导改为：`READONLY_INVARIANTS` 必须含 `--restricted` 与 `--strict-mcp-config`，缺任一即红（报错点名是哪个旗标），再按 `--tools` 白名单分类；补一格负例（内存里删掉 `--restricted`）；变异装置追加两条（删 `--restricted`、删 `--strict-mcp-config`），期望对账用例红；设计 11.1 表 claude 行的事实源补这两个旗标 |
| CODEX-02 | codex | nit | 接受 | 属实：新用例复制了第 N 份「向上找 package.json」，且比 `test/helpers/fixture.ts` 的 `findRepoRoot` 少到达根的终止检查；`run-files-parity` / `archive` / `mutation-device` 三个单测已从 fixture 导入 `REPO_ROOT`，有现成出口 | 新用例改为 `import { REPO_ROOT } from '../helpers/fixture.js'`，删掉内联副本；补 `= path.join` 的空格（同 AGY-01）。不动 `brief.test.ts` 等既有副本（不在本主题改动面，收敛另议） |
| AGY-01 | gemini | nit | 接受 | 属实：`const AGY_DEFINITION_PATH =path.join(…)` 少一个空格 | 同 CODEX-02 的第二半 |
| GLM-01 | glm | minor | 接受（登记，不改代码） | **已核实工具面事实**：本轮 glm 侧 rollout 共 25 次请求，每一次的工具清单都声明了 `mcp__node_repl__js`（经插件缓存带进副本 HOME 的 MCP 工具，JS 执行）；`ZCODE_READONLY_DENYLIST` 只管内置工具名，`command-execution-parity` 的 zcode 推导对这一层恒绿。编排器轨迹计数（`toolCalls`：read 25 / grep 18 / glob 1 / run_command 0）不分类 MCP 调用，**有没有被调用判不出来**，该侧自述未用。**不在本主题改代码的理由**：这首先是 zcode 侧**只读保障**的缺口（一个能执行 JS 的工具在审查员手里，`--disallowed-tools` 管不到），其次才是本字段声明失实；修法要动 zcode 适配器的副本 HOME 构造或拉起参数（codex 侧在 `codex-home.ts` 裁掉 `node_repl` 与 plugins 是先例），还要核 zcode CLI 是否支持按 MCP 工具名禁用、轨迹如何计数 MCP 调用——显著超出「措辞约束进模板」的范围，按任务目标的口径登记暂缓。意见里「可顺带把 `none` 首句收窄为『没有可用的命令执行工具』」不采纳：收窄后的句子做的是同一个断言，真正的出口是关掉通道或如实声明，不是换措辞；第 7 节措辞因此不变，不触发「改措辞后新构建重跑一轮」 | BACKLOG 新登 **EV-188**（zcode 侧 MCP / 插件工具面不在只读名单与命令执行能力对账的论域，`mcp__node_repl__js` 已在工具清单里实见；优先级按安全面标注，触发即修：不等再现）；设计 11.1「命令执行能力」边界句补一句并指向 EV-188；实施报告记本条与它对 A/B 判定的影响（A/B 三轮 glm 侧都自述无执行工具、去找子代理，未见调用 node_repl 的自述；轨迹判不了，如实写「不能排除」） |

## 2. 修改范围

只改已接受的项：`test/unit/command-execution-parity.test.ts`（CODEX-01 / CODEX-02 / AGY-01）、变异规格生成脚本追加两条并重跑装置、设计 11.1 两处、BACKLOG EV-188、实施报告 §6。`src/` 不改；第 7 节措辞不改。
