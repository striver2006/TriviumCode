---
schema: trivium.disposition.v1
topic: 取不到启动时刻当不在
stage: code
role: claude
kind: response
run_id: 20260930T120934Z
addresses:
  - 2026-09-30-取不到启动时刻当不在-codex.md
  - 2026-09-30-取不到启动时刻当不在-gemini.md
  - 2026-09-30-取不到启动时刻当不在-glm.md
---

# 应答：取不到启动时刻当不在 · 代码双审第 1 轮

> 被审对象：相对 `c4d082e` 的未提交改动（36 个文件，补丁约 874 KB，大头是证据 JSON）
> ｜ 运行：`20260930T120934Z`（约 12 分 46 秒）
> ｜ 结论：codex `approve-with-nits`（吹毛求疵 3）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 共 4 条：接受 4、驳回 0、暂缓 0

## 0. 核实记录

- **CODEX-01**：成立。`unverifiable-start.test.ts` 十处 `await processStartTimes(w.pid)` 之后都没断言取到了值；两种形态都取不到时 `mkStatus` 写下两个 null，记录落进「期望为假值即相符」，新行为格会以与缺陷几乎相同的文案翻红（U6「应抛出而不是返回 0」、U1b「same ≠ unverifiable」），把夹具的环境问题读成 EV-175 回归。本进程那一处（U1b 开头）有自证，夹具进程没有。
- **CODEX-02**：成立。`killAll` 按组 SIGKILL 之后等 `exit` 的 10 s 超时被 `.catch(() => undefined)` 吞掉；夹具是 detached 的常驻定时器进程，泄漏后用例照绿、进程永久空转。概率极低（SIGKILL 不可挡），但与本仓「等待一律带超时、超时不静默」的纪律不符。
- **CODEX-03**：成立。`doc/05_testing/README.md` 的已归档报告索引最新一条是 `REPORT_2026-09-29_facade_version_pointers.md`；本主题报告 §2 的文档清单也没列它。EV-172 登记的正是「各主题不补索引」；EV-167 的先例是主题自己进索引，只并入自己。
- **GLM-01**：成立。`workerStillAlive` 对 `unverifiable` 返回 true 后，非终态而判不了的目录计入 `SweepResult.alive` / `PruneResult.kept`，而 `alive` 的注释仍是「因 worker 现势还活着而没动」，`kept` 没有注释；判不了的非终态目录走不到 `admitScrub`，不进 `deferred`。行为方向正确（U5 断言），只是计数的含义在注释里没写清。人读输出里另立一格会改 `trivium scrub` 的输出格式（EV-157 起的冻结面），不在本主题范围。

## 1. 逐条应答

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | 吹毛求疵 | 接受 | 夹具启动时刻没取到时，红因会被误读成被测缺陷 | 新增 `fixtureRecord(pid)`：最多取 3 次（间隔 100 ms），两种形态都取到才返回，否则以「夹具进程 N 的启动时刻没取到……是测试环境问题，不是被测行为」断言失败；十处 `processStartTimes(w.pid)` 全部改用它。改后重跑新用例、移植验收与变异（锚点不在测试文件里，规格不变） |
| CODEX-02 | codex | 吹毛求疵 | 接受 | 收尾超时不能静默 | `killAll` 等待超时后对仍活着的 pid 再发一次组 SIGKILL，仍活着就抛错并列出 pid（不再吞） |
| CODEX-03 | codex | 吹毛求疵 | 接受 | 按 EV-167 先例只并入自己，不扩到补其它主题（EV-172） | `doc/05_testing/README.md` 已归档报告索引加本报告一行；报告 §2 文档行补「README 索引」 |
| GLM-01 | glm | 吹毛求疵 | 接受 | 只补注释，不改人读输出（输出格式另立一格属冻结面改动，不扩范围） | `retention.ts`：`SweepResult.alive` 注释补「含活着而取不到启动时刻（判不了，EV-175）」；`PruneResult.kept` 补同义注释；`pruneRunDirs` 里「还在跑，无论多老都不动」补「（含判不了）」 |

gemini 零意见，无需应答。

## 2. 修订后要重跑的

新用例单跑、移植验收（改前树期望不变）、变异预跑与正式（规格不变）、`npm run check` 一次；读数补进实施报告 §6。
