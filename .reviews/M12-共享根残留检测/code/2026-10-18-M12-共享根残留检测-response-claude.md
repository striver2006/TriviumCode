---
schema: trivium.disposition.v1
topic: M12-共享根残留检测
stage: code
role: claude
kind: response
run_id: 20261018T031358Z
addresses:
  - 2026-10-18-M12-共享根残留检测-codex.md
  - 2026-10-18-M12-共享根残留检测-gemini.md
  - 2026-10-18-M12-共享根残留检测-glm.md
---

# 应答：M12-共享根残留检测 · 代码三审第 1 轮

> 被审对象：相对 `a0c3a609` 的工作树改动（26 个文件），计划定稿 `plan/2026-10-18-M12-共享根残留检测-r2-claude.md`
> 三侧：codex `approve-with-nits`（1 minor），glm `approve`、gemini `approve`（均无意见）。1 条接受。
> 裁决前回证据脚本核过：`a2-readings.mjs` 的 `baseEnv()` 只删了 `TRIVIUM_ASSET_ROOT` 与 `TRIVIUM_ENTRY_SCAN_HOME`，`HOME`、`CODEX_HOME` 照原样继承；版本探测那次 `spawnSync` 没传 `env`。CODEX-01 成立。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 成立：A-2 只把共享根扫描指到了夹具，doctor / preflight 子进程与 `agy --version` 仍拿真实 `HOME`，预检链上按 `os.homedir()` 求值的路径（如 zcode 模型覆盖副本源）读的是真实家目录。虽然只读，但与计划「夹具全程隔离 HOME」、报告 §6「HOME 隔离」的表述不符。产品代码与单测不受影响（单测与 A-1 都已整份构造环境） | ①`a2-readings.mjs`：全部子进程（doctor、preflight、`agy --version`）改用同一份隔离环境——`HOME` 指向夹具里单独的 `home-cli/`，删掉 `CODEX_HOME`、`TRIVIUM_ASSET_ROOT`、`TRIVIUM_ENTRY_SCAN_HOME` 后再按格设；读数里记下所用 `HOME` 已归一为 `<FX>/home-cli`。②重跑 A-2，新旧对照与 `self_root` 段的结论若有变化如实写进报告。③报告 §6 改写隔离口径，并说明批次 5 的 A-2 有同样缺口（只记录，不重跑批次 5）|
