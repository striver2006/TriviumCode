---
schema: trivium.disposition.v1
topic: 网关凭据改环境变量注入
stage: code
role: claude
kind: response
run_id: 20261025T101812Z
addresses:
  - 2026-10-25-网关凭据改环境变量注入-codex.md
  - 2026-10-25-网关凭据改环境变量注入-gemini.md
  - 2026-10-25-网关凭据改环境变量注入-glm.md
---

# 应答：网关凭据改环境变量注入 · 代码审第 1 轮

> 被审对象：相对 HEAD `40dbab4f` 的未提交改动（补丁 `_meta/changes-20261025T101812Z.diff`，35 个文件，大头是对拍记录与两份全量读数）。
> 评审循环第 1/3 轮：codex `pass`（零意见），gemini `pass-after-changes`（1 minor），glm `pass-after-changes`（1 minor、1 nit）。
> 3 条：全部接受，按下表直接改码。codex 零意见，无可裁决条目。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | minor | 接受 | 属实：`skills/dual-critic/schema/config.v2.json` 是手写的机读契约（随安装分发，`schemas.ts` / `config.ts` 加载），`settings_env_source` 的 description 仍写「经 --settings 内联注入（受限模式忽略 settings 文件但仍认内联）」；我做对账 grep 时论域只含 `skills-src/`，漏了 `skills/`。已把对账范围扩到 `skills/` 全目录（排除打包产物 `scripts/trivium.cjs`）重查，只有这一处 | 改 `config.v2.json` 该 description 为「经子进程环境变量注入（1.3.2 起，EV-256；此前经 --settings 内联、键值进进程命令行），受限模式忽略 settings 文件但认进程环境变量」，与 `types.ts` 同口径；报告 §6.1 补「对账论域扩到 `skills/`，复查只此一处」并点名本条 |
| GLM-01 | glm | minor | 接受 | 属实：探针侧 `execArgv` 对 stdout / stderr 的 `scrubGatewayEnv` 是「网关值不落探针留痕」的现行机制，但没有任何用例断言它——M10 只变异了 `invokeClaude`。E3 的假 CLI 已把网关值回显进每次探针调用的输出，只差观测面：`probeClaude` 的返回不直接暴露各臂原文 | 给 `execArgv` 加 `export`（注释写明是测试面，与 `probeArgs` 等同一做法），新增集成格 E7：在 `withClaudeProbeRoute(route', …)` 下直接调 `execArgv`，断言返回的 `raw` 与 `stderr` 不含任何网关值、含 `<redacted-env>`；变异补 M12（`execArgv` 的 stdout 不过 scrub）与 M12b（stderr 不过 scrub），期望 E7 红；重跑预跑与正式装置，更新报告 §3、§4 与证据 |
| GLM-02 | glm | nit | 接受 | 属实：E6 经 `runAll` 跑了目录臂却没断言其记录，偏离计划 r2「E6 同 E5」；补几行断言比加跳过开关更贴合计划原文 | E6 解构 `directory` 并对每条记录 `assertNoGateway`、断言恰 7 次 |
