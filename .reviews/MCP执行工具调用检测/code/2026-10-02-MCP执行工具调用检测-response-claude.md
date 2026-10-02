---
schema: trivium.disposition.v1
topic: MCP执行工具调用检测
stage: code
role: claude
kind: response
run_id: 20261002T081745Z
addresses:
  - 2026-10-02-MCP执行工具调用检测-codex.md
  - 2026-10-02-MCP执行工具调用检测-gemini.md
  - 2026-10-02-MCP执行工具调用检测-glm.md
---

# 应答：MCP执行工具调用检测 · 代码双审第 1 轮

> 被审对象：相对 HEAD `6aee012` 的全部改动（54 个文件）
> ｜ 运行：`20261002T081745Z`（约 12 分 53 秒；真实审查员运行计数 3/6）
> ｜ 结论：codex 解析回退（原文自报 `approve-with-nits`，4 条：次要 3、吹毛求疵 1）｜ gemini `approve`（0 条）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）
> ｜ 共 6 条：接受 6、驳回 0、暂缓 0

codex 侧整份解析回退（成因 `json_syntax`：结论 JSON 的键没加引号），闸门对它只认 `CODEX-F01` 一个编号；原文里的 `CODEX-01`～`CODEX-04` 四条在表内合为 `CODEX-F01` 一行，逐条裁决见表外 §2。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-F01 | codex | minor | 接受（原文 4 条全部接受，逐条见 §2） | 回退原文四条（次要 3、吹毛求疵 1）逐条核过，均属实：成因注释漏一种、五面文案不读成因、历史计数口径不一、PROTOCOL 键路径漏侧段 | 见 §2 逐条落点 |
| GLM-01 | glm | minor | 接受 | 属实：rollout 条目缺 id（`parseZcodeRollout` 记空串、不进 `rolloutIds`）而日志带着同一批 id 时，同一次调用既进 `ro.length` 又进 `logOnly`，计数翻倍、执行型还多出一条「另记 k 次」。五次真实运行未见缺 id 形态，判定不受影响（已判失守），错在计数与留痕条数——而这正是该字段的用途 | `summarizeZcodeMcp`：某工具名在 rollout 里只要有一条缺 id，该名就退回按名取大（`max(ro.length, logCounts)`），不累加 `logOnly`；补 U14 钉住（rollout 两条无 id + 日志同两次带 id ⇒ 计 2、无「另记」条目）；变异补一条（去掉该退回分支，预期 U14 红） |
| GLM-02 | glm | nit | 接受（同步） | 同 §2 的原文 CODEX-03：设计 11.1、BACKLOG EV-188 / EV-191 写「213 份 / 10 轮」，证据与报告 §5 写「214 / 11」，差的是本主题计划双审那一轮，扫描时点没写明 | 同 §2 原文 CODEX-03 的落点 |

## 2. codex 回退原文的逐条裁决（表内合为 CODEX-F01）

- **原文 CODEX-01（minor）· 接受**：属实，`types.ts` 里 `unattributed_drift_files` 的注释只写了两种成因，漏了 MCP 执行型（G8 证明它单独就能让漂移落桶）；schema 描述与设计 11.1 写的都是三种。**落点**：`types.ts` 该注释补成三种成因、与 schema 描述同口径；机器盯防并进原文 CODEX-02 的落点。
- **原文 CODEX-02（minor）· 接受（取 ①）**：属实，guard / render / report 三处文案把成因写死成「MCP 调用」，不读 `untrusted.cause`；`EvidenceUntrusted` 的注释却承诺按成因分句，将来 `cause` 加值时文案会静默说错——`path_cause` 那族问题的复发形态。**落点**：`types.ts` 新增按成因键控的文案表 `EVIDENCE_UNTRUSTED_CAUSE_TEXT: Record<EvidenceUntrusted['cause'], …>`，三处文案改为按 `cause` 取；`cause` 加值而文案表不跟即编译失败。现有文案逐字不变，G2 / I1 断言照旧。
- **原文 CODEX-03（minor）· 接受**（与 GLM-02 同一处，两侧独立收敛）：属实，设计 11.1、BACKLOG EV-188 / EV-191、报告索引、zcode-trace 名单注释、上一题应答件更正节写「213 份 / 10 轮」，证据 `history-scan-output.json` 与报告 §5 写「214 / 11」。**落点**：各处统一为证据文件的读数（214 份里 38 份、共 95 次；10-01 起 11 份里 1 份），注明「截至 2026-10-02 本主题计划双审之后扫描，见 `history-scan-output.json`」；证据不重扫（重扫会把代码双审这一轮也算进去，数字又变）。
- **原文 CODEX-04（nit）· 接受**：属实，PROTOCOL 新段写 `guard.verification_degraded.evidence_untrusted`，漏了逐侧那一层。**落点**：该句改为 `verification_degraded.〈侧〉.evidence_untrusted`。

## 3. 修改范围

只改已接受的项：`src/trivium/types.ts`（注释、成因文案表）、`src/trivium/guard.ts` / `render.ts` / `report.ts`（文案按成因取）、`src/trivium/adapters/zcode-trace.ts`（缺 id 退回分支、名单注释计数）、`test/unit/zcode-mcp-detect.test.ts`（U14）、变异规格加一条并重跑预跑与装置、设计 11.1 与台账、BACKLOG、PROTOCOL、报告与索引、上一题应答件更正节的计数。修订后重跑单测、全量两次与自检；改前改后对照与契约变异重跑一次核读数不变。
