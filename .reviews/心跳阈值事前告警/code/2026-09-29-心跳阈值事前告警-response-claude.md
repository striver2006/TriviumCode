---
schema: trivium.disposition.v1
topic: 心跳阈值事前告警
stage: code
role: claude
kind: response
run_id: 20260928T170313Z
addresses:
  - 2026-09-29-心跳阈值事前告警-codex.md
  - 2026-09-29-心跳阈值事前告警-gemini.md
  - 2026-09-29-心跳阈值事前告警-glm.md
---

# 应答：心跳阈值事前告警 · 代码双审第 1 轮

> 被审对象：相对 `4097aaa` 的未提交改动（25 个文件）
> ｜ 运行：`20260928T170313Z`（约 9 分 18 秒）
> ｜ 结论：codex `approve-with-nits`（次要 1、吹毛求疵 1）｜ gemini `approve`（零意见）｜ glm `approve`（零意见）
> ｜ 共 2 条：接受 2、驳回 0、暂缓 0

## 0. 核实记录

- **CODEX-01**：成立。`status.ts` `interpretStatus` 的判定是 `age > heartbeatStaleMs`（严格大于）；阈值恰为 30 s 时，健康 worker 的未更新时长只在心跳回调延迟与一次读写耗时（δ）那段越过阈值，`--wait` 每 2 s 一次的轮询碰上它的概率很小。
  计划 r2 §2 的表已写明这一格「按概率」，但正文「每一轮审查里它的未更新时长都会反复越过这个阈值，--wait 轮询到就判 heartbeat_stale」没有把「越过的时段随阈值趋近 30 s 缩到很短」说出来，读起来像是每一轮都会被判。判据取 `≤`（D1）本身不变：「阈值没有盖住一个心跳周期」只凭配置就成立，30 s 这一格属于保守多告警的一侧。
- **CODEX-02**：成立。新集成测试的 `seedProbes` 与 `codex-wiring.test.ts` 的同名夹具逐段相同，验收脚本里还有第三份；`test/helpers/fixture.ts` 是共享夹具的既有出口。

## 1. 逐条应答

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立：正文把「保守多告警」这一判别取舍写成了在 30 s 这一格也成立的必然后果；判据（D1）不改，改正文的措辞并在判据注释里写明这一格是保守一侧 | `preflight.ts` `checkHeartbeatThreshold` 正文在「反复越过这个阈值」之后补「阈值越接近 30 s，越过的时段越短、被轮询碰上的机会越小」，四项结构不变；`status.ts` `staleThresholdWithinHeartbeat` 文档块补「30 s 这一格属保守多告警：等于间隔时只在心跳抖动的那几毫秒越过」；主设计 v1.3.57 版本记录与 §8.1 表格同步一句；U2 加断言钉住补句；按接受项修订后重跑全量、变异、失败用例名、验收与 selftest，读数写进报告 §6 |
| CODEX-02 | codex | nit | 接受 | 核实成立：同一夹具已有三份（两个测试文件 + 验收脚本），提取进 helpers 的改动面小、行为不变 | `test/helpers/fixture.ts` 新增导出 `seedFakeProbes(root, codexOver = {})`（内容逐字取自 `codex-wiring.test.ts` 的 `seedProbes`）；`codex-wiring.test.ts` 的 `seedProbes` 改为调用它（签名与调用点不变）；新集成测试删掉自己的副本、改调它；验收脚本改为从 `dist/test/test/helpers/fixture.js` 导入同一函数，不再自带一份 |

## 2. 不改的

- 判据边界（D1，`≤`）、两个调用点、`--wait` 报错文字、配置契约。
- gemini / glm 零意见，无需应答项。
