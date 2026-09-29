---
schema: trivium.disposition.v1
topic: 临界区锁超时下限
stage: code
role: claude
kind: response
run_id: 20260929T091044Z
addresses:
  - 2026-09-29-临界区锁超时下限-codex.md
  - 2026-09-29-临界区锁超时下限-gemini.md
  - 2026-09-29-临界区锁超时下限-glm.md
---

# 应答：临界区锁超时下限 · 代码双审第 1 轮

> 被审对象：相对 `53d7476` 的未提交改动（20 个文件）
> ｜ 运行：`20260929T091044Z`（约 10 分 16 秒）
> ｜ 结论：codex `approve-with-nits`（次要 1、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve`（零意见）
> ｜ 共 3 条：接受 3、驳回 0、暂缓 0

## 0. 核实记录

- **CODEX-01**：成立。`status.ts` :459-464 的文档块把消费方写成「心跳定时器、`--wait` 报错、失联阈值只警告项」三类；本补丁给它加了第四个消费方 `lock.ts` `criticalHoldTimeoutMs`（:118），而 `status.ts` 未改。
  心跳间隔与锁下限是两种语义：前者是 worker 刷新进度的频率，后者要求「覆盖最长临界区」——将来有人为更密的进度反馈调小心跳间隔，锁下限会跟着移动，改的人读的是 `status.ts` 这一头。
  计划 r2 §3.4 写的是「`status.ts` 一个字都不改」，本意是不改行为；只补文档块属于注释，行为仍不变，如实记为与 r2 文字的出入。
- **CODEX-02**：成立。`gen-mutation-spec.mjs` 的 desc 是计划期预测集：M2 写「⇒ U1 / U2 / U3」，实测红 5 条（另有 U6 / U8——`Math.min` 让亚秒阈值直接生效，年龄 1 s 与 300 ms 的活锁被回收）；M6 写「⇒ U4」，实测还红了既有「短临界区持有过久」（它的 `run` 锁半段）。报告 §2 用的是实测集，证据件里嵌的 desc 与之不一致。
- **CODEX-03**：成立。`criticalHoldTimeoutMs` 文档块承诺「非有限值与原先同为不回收」，U1 的取值全是有限值；配置契约挡住了 NaN，所以只是加固。

## 1. 逐条应答

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立：常量的消费方登记在它自己的定义处才看得到；两种语义不同，改值要重新论证锁下限 | `status.ts` `WORKER_HEARTBEAT_MS` 文档块补一句：它同时是 `lock.ts` `criticalHoldTimeoutMs` 的短临界区持有超时下限（EV-161），改这个值会移动锁下限，须按「下限覆盖最长临界区（含阶段目录扫描）」重新论证。只改注释，判据与数值不动；报告 §3.1 记与 r2 §3.4 文字的出入 |
| CODEX-02 | codex | nit | 接受 | 核实成立：证据件的自洽要以实测为准 | `gen-mutation-spec.mjs` 的 desc 改为实测红集（M2 补 U6 / U8，M6 补既有「短临界区持有过久」，其余逐条核对）；首轮规格与读数改名 `.r1` 保留，按修订后的源码重新生成规格、重跑变异与失败用例名；报告 §2 注明「desc 以 names-output 的 red 为准」 |
| CODEX-03 | codex | nit | 接受 | 核实成立：注释承诺应有断言承载 | U1 加两格：`criticalHoldTimeoutMs(NaN)` 为 NaN、`criticalHoldTimeoutMs(Infinity)` 为 Infinity；U2 旁加一格 `judgeStale(critical 活锁, { heartbeatStaleMs: NaN, now: 远未来 })` 为 null，钉住「非有限 ⇒ 不回收」 |

## 2. 不改的

- 判据、落点、下限取值、调用方、配置契约、EV-160 告警输出、`--wait`。
- gemini / glm 零意见，无需应答项。

## 3. 修订后重跑

按接受项修订后重跑：全量 `npm run check`、源码变异与失败用例名（新规格）、零配额验收（新旧构建对照）、`doctor --selftest`，读数写进报告 §6。
