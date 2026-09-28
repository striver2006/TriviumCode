---
schema: trivium.disposition.v1
topic: 心跳阈值事前告警
stage: plan
role: claude
kind: revised
run_id: 20260928T162126Z
addresses:
  - 2026-09-29-心跳阈值事前告警-codex.md
  - 2026-09-29-心跳阈值事前告警-gemini.md
  - 2026-09-29-心跳阈值事前告警-glm.md
---

# 裁决：心跳阈值事前告警 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-29-心跳阈值事前告警-claude.md`（r1，起点 `4097aaa`）
> ｜ 运行：`20260928T162126Z`（约 14 分 19 秒）
> ｜ 结论：codex `approve-with-nits`（次要 1、吹毛求疵 1）｜ gemini `approve-with-nits`（次要 1、吹毛求疵 2）｜ glm `approve-with-nits`（次要 2、吹毛求疵 2）
> ｜ 共 9 条（去重后 7 条）：接受 9、驳回 0、暂缓 0
> ｜ AGY-01 ≡ GLM-01 为同一条；AGY-02 ≡ GLM-03 为同一条
> ｜ 修订后的计划：`plan/2026-09-29-心跳阈值事前告警-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01**：成立。`test/helpers/fixture.ts` :120-136 只在传 `probeModels` 时写 `probe:` 段；`preflight.ts` 的 ① 探针新鲜度在 `generated_at` 为 null 时 `ok: false`，
  ④‴ 挂在 `checks.every((c) => c.ok)` 之后（:741-753），照 `override-source-start.test.ts`（不种探针）施工的 I3 与 A1 / A2 / A6 到不了新项。
  `codex-wiring.test.ts` :128-141 在跑 bundle 的预检前先 `seedProbes()`，是现成先例。
- **CODEX-02**：成立。出口句里的「120（缺省值）」与 `config.ts` :290 的字面缺省是两份互不联动的事实；本稿对心跳间隔已经做了共享常量，缺省值没有同样处理。
- **AGY-01 ≡ GLM-01**：成立。`code-stage.test.ts` :205-230 的纯文档跳过用例只写 `skip_doc_only_review: true`，阈值取缺省 120 ⇒ `checkHeartbeatThreshold` 恒 null，
  N11（`finished_inline` 分支也带阈值项）改不动它的 `warnings`，变异会存活；r1 的矩阵里也没有「2 s + `finished_inline`」一格，D3 的这半个决策无测试承载。
- **AGY-02 ≡ GLM-03**：成立。K2 的 `lostScenario` / `seedRun` / `staleHeartbeat` 在 `test/integration/run-protocol.test.ts` :811-844，要起真实子进程；
  r1 把 U3 列在「单测」节下，落点与分层纪律不符，九个阈值全跑也没有必要——`waitRun` 只是调共享函数，边界全集交给纯内存的 U1 即可。
- **AGY-03**：成立。主设计 :1593「**标**——上表四行」指 §8.1 表里四个只警告行（覆盖面、运行期选模、副本源、探活已跳过）；新增一行后不同步就过期。
- **GLM-02**：成立。`run-protocol.ts` :1224 的「已 X s 未更新」随判定时刻与轮询相位（:1142，2 s）变化，新旧两次独立运行几乎必然不同，r1 的归一化清单没覆盖它。
- **GLM-04**：成立。`override-source-start.test.ts` :40-43 给 glm 侧配了 `modelOverrideSource`，:76-80 只在 `populate` 为真时 `warnings` 才为空；I2 没写「副本源在」这一前提。

## 1. 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立：真实 bundle 的预检不种探针即在 ① 失败，④‴ 走不到；验收要在新旧两次运行里得到同形的覆盖面项，前提必须写明 | r2 §6.2 I3 与 §6.4 A1 / A2 / A6：夹具以 `makeFixture({ probeModels })` 种新鲜探针（`bin` / `entry` 为 `/bin/echo`、版本 `stub/0.0.0`），一律带 `--skip-auth-check`；§6.4 新增 A0（同一构建同一配置跑两次，JSON 逐字相同）证明比对基线确定，覆盖面项在新旧两侧同形 |
| CODEX-02 | codex | nit | 接受 | 缺省值与心跳间隔同理，应当只有一处事实 | r2 §3.1：`config.ts` 导出 `DEFAULT_HEARTBEAT_STALE_S = 120`，缺省配置（:290）与告警出口句都引用它；§3.2 正文改为插值；§6.1 U2 断言按常量拼期望值 |
| AGY-01 | gemini | minor | 接受 | 核实成立：N11 的咬合对象在缺省阈值下恒绿，变异会存活 | r2 §6.2 新增 I6（2 s 阈值 + `skip_doc_only_review: true` + 纯文档改动 ⇒ `finished_inline: true` 且 `warnings` 为 `[]`）；§6.3 N11 的预期咬住改指 I6 |
| GLM-01 | glm | minor | 接受 | 同 AGY-01（两侧独立发现同一处） | 同 AGY-01 的落点 |
| AGY-02 | gemini | nit | 接受 | 核实成立：U3 实为集成层用例，边界全集放纯内存单测即可 | r2 §6.1：U1 在 `test/unit/status.test.ts` 纯内存跑满九个取值；原 U3 改名 R1、落 `test/integration/run-protocol.test.ts`，沿用 K2 构造，只取 2 / 30 / 30.5 / 120 四个阈值（含等于与略大于两个边界） |
| GLM-03 | glm | nit | 接受 | 同 AGY-02 | 同 AGY-02 的落点 |
| AGY-03 | gemini | nit | 接受 | 核实成立 | r2 §7 主设计落点：§8.1 表加「失联阈值」一行，表下「上表四行」改「上表五行」 |
| GLM-02 | glm | minor | 接受 | 核实成立：不归一化这一相对时长，A5 会在它要证明「逐字不变」的那一行上随机红 | r2 §6.4 归一化清单加「`已 \d+ s 未更新` → `已 N s 未更新`」，并在 A5 判据里写明 |
| GLM-04 | glm | nit | 接受 | 核实成立 | r2 §6.2 I2 补「副本源在（`populate` 为真）」前提；I1 / I5 / I6 同样写明 |

## 2. 汇总

- 实质面：无（三侧都认可 D1～D7 与 §5 的论证；GLM 另替 §7 核了 PRD：FR-18 不逐条列举预检项 ⇒ 按条件分支不改，编码时复核后写进报告）。
- 验证面：探针前提（CODEX-01）、N11 承载（AGY-01 ≡ GLM-01）、U3 分层（AGY-02 ≡ GLM-03）、A5 归一化（GLM-02）、I2 前提（GLM-04）。
- 代码面：缺省值常量（CODEX-02）。
- 文档面：主设计「上表四行」（AGY-03）。
