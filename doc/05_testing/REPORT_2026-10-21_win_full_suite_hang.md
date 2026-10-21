# Windows 全量回归三缺陷报告（挂死兜底 / 桩进程泄漏 / --start 终态碾压）

日期：2026-10-21。版本：1.2.7 → 1.2.8。环境：win32 + Node 24.19.0 + Git for Windows，32 GB / 20 逻辑核。
缘起：全项目 Windows 遗留审查发现三项未登记问题（全量 `npm test` 挂死、测试桩进程泄漏累积、文档版本滞后），本批逐一处置；处置过程中又挖出一处**产品级竞态真缺陷**（--start 终态碾压），一并修复。

## 1. 全量套件挂死（根因未定位，已兜底）

**现象**：全量 `npm test`（旧 dist，1.2.7 基线）在本机满载下冻结——主跑进程 11:39 启动，11:43 后 65 分钟整机零新子进程（不止单个测试文件卡住，是所有并发槽位全部停摆）；唯一可观测的最后活动是 `test/unit/lock.test.ts` EV-153 U3 刚派生的持锁桩（`trivium-ev153-u3-holder`）。

**排查**：单跑 `lock-cross-process` 7/7（21 s）；代码层逐段核查未找到无界等待——`acquireLock` 的循环受 `retries` 约束（`retries: 0` 一轮即抛 70）、`enumerateWinProcesses` 每趟有 15 s 超时兜底、EV-153 各用例的 `within()` 上界 ≤ 120 s、ps 桩路径全部有界。带 `--test-timeout=600000` 复跑 55 分钟未复现（挂死为非确定性问题，负载相关）。

**处置**：根因如实登记为未定位（Bug 清单 §3.1-6 第六批）；工程兜底是把挂死从「无声冻结」变成「带名字的红」——`npm test` / `npm run test:unit` 改经 `scripts/run-tests.mjs` 起 `node --test`，按 `--help` 探测追加 `--test-timeout=600000`（Node < 20.3 无此旗标时退回原样，engines ≥ 18 不破）。定点调试仍按 AGENTS.md 直接 `node --test <文件>`，不受影响。

## 2. 测试桩进程泄漏（两处机制 + 77 个存量清零）

**机制一（每跑必漏）**：lock U3 收尾用 `process.kill(-pid, 'SIGKILL')`——win32 上负 pgid 组信号无对应物，**实测抛 ESRCH 且目标进程存活**，catch 静默吞掉后 holder 每次必漏。修法：win32 分支改走生产同款 `winTaskkillTree`（与 `unverifiable-start` 的 `killAll` 同一形态，1.2.6 第四批先例）。

**机制二（强杀孤儿）**：常驻桩（`setInterval` 挂起）不随父进程死，测试运行被外部强杀（挂死后被杀是常态）时收尾代码没机会跑，孤儿永存——本机实测累积 77 个（63 个 `trivium-ev175-test` 来自 10-19 的多轮被杀运行 + 其余零星）。修法：两个派生点（`unverifiable-start.spawnMarked`、lock U3）的桩脚本加 **10 分钟自毁定时**——远超任何单测上界，只兜「收尾代码没机会跑」的形态；正常路径仍由原收尾负责。

**存量清理**：77 个残留进程已全部结束（argv 含 `trivium-ev*` 标记的 node 进程，2026-10-21 清点为零）。`cancel-grace-unverifiable` 的桩形态在 win32 整文件跳过、未派生，本批未动（POSIX 侧同理可加，未做以保持该文件行为零变化）。

## 3. --start 终态碾压（真缺陷，时序探针定位）

**发现路径**：本批最初把 `enumerateWinProcesses({fresh:true})` 的搭车语义改成「一律不搭在飞趟」——全量验证时 plan-final-recheck 等十余族集成翻红（1.2.7 基线全绿），单跑亦红、stash 二分确认由该改动触发。加文件型时间线探针（跨 CLI 进程汇聚）后拼出完整机制：

1. `--start` 派生 worker 后要取其两种启动时刻（经 PowerShell 枚举，win32 两形态同值仍各取一次）；
2. 初版 fresh 语义让第二个形态的取值**多付一趟串行枚举（+0.95 s）**，`--start` 的 `patchStatus`（补 pid / 启动时刻 / `phase: 'running'`）被拖到 ~T+1.8 s 落地；
3. 桩侧 worker ~1.3 s 即完成整轮并写下终态 `success`——**`--start` 的补写把 `success` 碾压回 `running`**；
4. worker 随即正常退出，`--wait` 读到「running + 进程确已不在」→ 判 `worker_lost（pid_gone）`，归档已是 success 仍整轮判败（外显为「运行没成功收尾（退 1）」）。

**关键判定**：碾压竞态是**产品级真缺陷、独立于 fresh 语义存在**——满载下枚举变慢即可触发（多趟在飞、TTL 过期重取），这正是登记在案的「19 条集成长尾」中 `worker_lost`/「退 1」家族的形态；初版 fresh 改动只是把它从「满载偶发」放大成了「单跑必现」，反而促成了定位。

**修复（两层）**：
- 产品层：`--start` 补写改为**只加身份字段，`phase` 已终态不再改回 running**（`isTerminal` 护栏，run-protocol）。设计说明书 §7.1 新增「--start 补写与终态次序」段。
- 平台层：fresh 的搭车判据终版为**启程时刻**——在飞趟启程不早于本次请求 ⇒ 对本请求已是新表，直接搭（`processStartTimes` 两形态并发取值共享一趟，这是缺省路径的时序前提）；启程更早的等它落地后自起一趟（1.2.6 的「强制重枚举不得拿旧表充数」语义保留）。platform-win 新增可控假枚举用例钉住两个场景（毫秒边界自旋保证时序确定）。

## 4. 顺带修复

- lock.test「不可解析但刚写下的锁文件」在满载下偶发红：`acquireLock` 构造锁内容的冷枚举（满载可上秒级）会把「刚写下」的 2 s 判龄窗口跑穿，本进程活锁被按 unparsable 回收、用例等不到 70。夹具先暖进程身份缓存再写锁文件（夹具时序修复，被测行为不变）。

## 5. 验证

- 定点族：platform-win + lock（unit）+ plan-final-recheck + unverifiable-start + lock-cross-process 全绿（69/69 / 21/21）；修复后的全量运行零桩泄漏（自毁 + taskkill 收尾在真实满载下守住）。
- 全量单测（经 `run-tests.mjs`）：2355 例，通过 2347 / 失败 0 / 跳过 8（带理由）。
- 全量 `npm test`（修复后，`--test-timeout` 武装）：2893 例，通过 2858 / 失败 13 / 跳过 22（带理由），全程 ~6 分钟无挂死。对照：竞态未修时同套件 30+ 条失败（worker_lost「退 1」家族打穿 plan-final-recheck / task-goal-fulltext / code-stage / stub-agent-kit / tier-flags-cli / worktree-hash-concurrency / reclaimed-lock-settle 等十余族）；修复后这些族全部回绿，剩余 13 条全部落在既有登记的集成长尾家族（lock-cross-process 并发、run-dir-collision 秒窗、override-source-start `~` 折叠 ×2、scratch-cleanup POSIX TMPDIR/chmod ×2、scrub T7、worktree-hash-cleanup，另 handoff-dedupe / heartbeat-threshold / run-protocol 窗口计时各 1 属同族负载时序，登记后续批次逐条排查）。

## 6. 残余与后续

- 全量挂死根因仍未定位（§1）；`--test-timeout` 保证再发时以带名字的红收场，_red 的堆栈即排查入口。
- `--start` 补写对**锁文件**的改写未加同类护栏（worker 极快时锁可能已被 worker 释放、补写会重建出一把短暂遗留锁，下轮按 pid_gone 自愈回收）——本批未观测到由它产生的失败，登记备查。
- 文档版本滞后三处已修（部署手册 §2 双平台示例与「版本应为 1.0.0」、发布说明支持范围时点注记、Bug 清单文件头）；版本 1.2.7 → 1.2.8（package / lock / cli VERSION / 手册与设计书头部同步）。
