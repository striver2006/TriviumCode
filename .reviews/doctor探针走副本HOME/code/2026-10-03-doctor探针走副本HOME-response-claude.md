---
schema: trivium.disposition.v1
topic: doctor探针走副本HOME
stage: code
role: claude
kind: response
run_id: 20261003T050949Z
addresses:
  - 2026-10-03-doctor探针走副本HOME-codex.md
  - 2026-10-03-doctor探针走副本HOME-gemini.md
  - 2026-10-03-doctor探针走副本HOME-glm.md
---

# 应答：doctor探针走副本HOME · 代码双审第 1 轮

> 被审对象：相对 `292fa79` 的工作树补丁（29 个文件，`_meta/changes-20261003T050949Z.diff`）
> ｜ 运行：`20261003T050949Z`（约 8 分 41 秒）
> ｜ 结论：codex `approve-with-nits`（次要 3、吹毛求疵 3）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 共 7 条：接受 7、驳回 0、暂缓 0（CODEX-01 的认证探活一半另登条目，见说明）

每条都回源码核过。gemini 零意见，其「未覆盖范围」两条（未实跑、未核后台心跳并发写的极限竞争）与本题改动正交，不另处置。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：`fs.rm` 的 `force` 只吞 ENOENT，ENOTEMPTY / EBUSY / EACCES 会从 `finally` 抛出、顶替原异常，`probeZcode` 不返回，doctor 的 `checkpoint('zcode')` 不执行，本轮已探的旗标 / 模型覆盖结论随之丢失。这是本题新引入的抛出面 | doctor 侧：删除改为 `fs.rm(runDir, { recursive: true, force: true, maxRetries: 3 })`，失败不抛、推一条 note（写明前缀与残留路径、家目录归一 `~`、提醒其中有副本凭据请手工删）；新增用例 D10（把私有 TMPDIR 在拉起时改成只读，删除必失败）断言不抛、结论照常刷新、note 在；变异补一条「删除失败照抛」。认证探活那处同形，但决策一定了不改认证探活，本题不动，另登 BACKLOG（说明 §2） |
| CODEX-02 | codex | minor | 接受 | 属实：`readTrace` 改读全部分片后只有 `readdir` 在兜底里，任一分片在 `readdir` 与 `readFile` 之间消失或读失败都会整体抛出；读旧分片扩大了竞态面 | 逐片 `readFile` 各自兜底、失败跳过；全部跳过时返回 null（走既有「未能从会话日志回读生效模型」note）。用例 D9 加一格：日志目录里放一个名为 `*.jsonl` 的子目录（读它必失败），断言照样回读到模型。审查运行 `run()` 的日志回读整段在 try 里、读失败已被兜住，决策一不改审查运行，不动 |
| CODEX-03 | codex | minor | 接受 | 属实：副本源读取或解析失败那一支同样只出 note、不拦不警告，与 EV-196 同族但登记只写了 headless 失败一支 | 改 BACKLOG EV-196：论域扩成「本轮没刷新任何结论的两条静默支——headless 失败、副本源读取或解析失败」，补出处（本轮 CODEX-03）。判据不在本轮改 |
| CODEX-04 | codex | nit | 接受 | 属实：`readRuntimeSelectedModel` 注释写「取法与 `readTrace` 对齐：取最新一片」，`readTrace` 现已读全部；设计 §11.3 要点 5 的 `trace_source` 只描述真实 HOME 下的模板位置，没说 doctor 回读点已挪 | ①注释改为三处取法各自有据：探针臂 HOME 单会话、取最新一片；审查臂与 doctor 探针读独占落点目录的全部分片；②设计要点 5 补半句：`trace_source` / `trace_args_source` 记的是真实 HOME 下的模板位置，doctor 探针自 EV-194 起从递给 CLI 的 `ZCODE_LOG_DIR` 与落点根回读 |
| CODEX-05 | codex | nit | 接受 | 属实：doctor 侧显式传 `srcConfig: cliConfigPath`，认证探活走缺省 `zcodeOverrideSourcePath()`，生产同值，但同源只写在文档里 | 只加注释、不改行为（决策一）：在认证探活调 `prepareZcodeHome` 那行注明缺省源与 doctor 门控用的 `ZCODE_CLI_CONFIG` 同一文件，日后给探活加注入口须同传 |
| CODEX-06 | codex | nit | 接受 | 属实：「headless / path_deny 探的是」那条 note 在两次调用之前推入，headless 失败时 path_deny 根本没跑 | 该 note 挪到 headless 成功之后再推（此后 path_deny 必跑）；失败时只出带 `probed` 的失败 note。D4 加断言：失败时不出这条前缀 note |
| GLM-01 | glm | nit | 接受 | 属实：`prep.homeDir === null` 有 `no_model` 与 `source_missing` 两种成因，后者在门控与 `prepareZcodeHome` 两次存在性读之间副本源被挪走时可达，括注写死「档位未给模型」会自相矛盾 | 括注按 `prep.cause` 分：`no_model` 写「档位未给模型」，其余写「副本源在探测中途不见了」；D2 断言保持，退路措辞仍由 `describeZcodeProbedPath` 那半句给原因 |

## 2. 说明

- **CODEX-01 的认证探活一半**：`authProbe.probe()` 的 `finally` 删除同形，抛出会穿过无兜底的 `probeAuth` 把预检崩成内部错误。决策一明确「不改认证探活」，本题只修 doctor 侧；探活一侧作为双审核出的新缺口登记 BACKLOG（决策四允许），修法与本题 doctor 侧相同。
- **改动后重跑**：S9 改完后重跑相关用例、变异（第三批，前两批读数留 `.r1` / `.r2`）、全量一次；真实对照不重跑（S9 不改两次真实调用的拉起形态与判据所看的输出，且授权已用 3 次，计划约定不追加）。
