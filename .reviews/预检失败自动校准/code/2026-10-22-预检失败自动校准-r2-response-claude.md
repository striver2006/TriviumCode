---
schema: trivium.disposition.v1
topic: 预检失败自动校准
stage: code
role: claude
kind: response
run_id: 20261022T140408Z
addresses:
  - 2026-10-22-预检失败自动校准-r2-codex.md
  - 2026-10-22-预检失败自动校准-r2-gemini.md
  - 2026-10-22-预检失败自动校准-r2-glm.md
---

# 应答：预检失败自动校准 · 代码审第 2 轮（缺省时限改 15 分钟）

> 被审对象：相对 HEAD `18e6ca38` 的未提交改动（补丁 `_meta/changes-20261022T140408Z.diff`），焦点是缺省时限改 900 秒、上限 900、doctor 工具超时单独按时限加 60 秒至多 960 秒、`--wait` 不变。
> 评审循环第 1/3 轮：codex `reject`（1 major），gemini `pass`（零意见），glm `pass-after-changes`（2 minor、1 nit）。计票 1 通过 / 1 修改后通过 / 1 不通过 → 修改后通过。
> 4 条全部接受，按下表直接改码。gemini 侧零意见，无可裁决条目。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 成立：收尾的每一步在开始等待时就固定了预算（`remainingMs()` 只读一次），正常收尾进行中收到信号，预算虽已按到点时刻缩短，正在等的那一步却还按旧预算等；兜底再调收尾函数，拿到的是同一个缓存着、尚未兑现的 Promise，于是缺省 900 秒时可能等到接近 920 秒才返回，宿主先把 doctor 杀掉 | 把「限时等一步」收进控制器（`DeadlineController.limitStep`）：每一步同时与兜底信号竞速，兜底一触发，正在等的那一步当即放弃（记进 residue），之后的各步只给下限 5 s；报告里的 `stuck` 也改为按控制器的兜底是否触发判，不只看是哪条路径先调的收尾。新增 U7：长时限下 `limitStep` 等一个永不兑现的 Promise，期间发信号（`fire('signal')`），断言它在兜底时长加少许余量内返回 `{ ok: false }` |
| GLM-01 | glm | minor | 接受 | 成立：EV-251 条目前半句仍写计划时代的「（30～540）」，与同条目后半句与实现矛盾 | `doc/08_project/BACKLOG.md` EV-251 条目改为「（30～900）」 |
| GLM-02 | glm | minor | 接受 | 成立：取值范围在 schema 与 `DEADLINE_MIN_S` / `DEADLINE_MAX_S` 两处各写一份，无对账；漂移时照抄的调用会被 CLI 退 64，工具超时封顶也随之失真 | `test/unit/preflight-recalibrate.test.ts` 新增 U3‴：读 `config.v2.json`，断言 `preflight.recalibrate_deadline_s` 的 `minimum` / `maximum` 分别等于两个常量，缺省值也落在范围内 |
| GLM-03 | glm | nit | 接受 | 成立：报告第一节写的是实施中途的中间形态（`bashTimeoutFor` 挪进 exec.ts），终态已撤回 run-protocol，与第六节矛盾 | 测试报告第一节 `util/exec.ts` 一行改为终态表述，并在 `doctor-deadline.ts` 一行补 `doctorToolTimeoutMs` |
