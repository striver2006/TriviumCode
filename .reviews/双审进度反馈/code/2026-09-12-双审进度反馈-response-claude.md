---
schema: trivium.disposition.v1
topic: 双审进度反馈
stage: code
role: claude
kind: response
run_id: 20260912T150433Z
addresses:
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - AGY-05
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
  - GLM-07
---

# 代码审查应答：双审进度反馈

## 0. 裁决总览

12 条意见（gemini 5 ｜ glm 7）**全部接受**，无驳回、无暂缓。

**AGY-01 是本轮唯一的 major，也是这次审查最有价值的一条。** 它指出等待期
`status.json` 从不更新单侧状态——`workerMain` 在 `executeRun` 之前一次性把两侧置
`running`，直到返回才写终态，中间 `runBothSides` 没有任何回调
（[run-protocol.ts:409-413](src/trivium/run-protocol.ts#L409-L413)、
[runner.ts:96-139](src/trivium/runner.ts#L96-L139)）。

后果正中本次需求的要害：我这套改动要回答的三个问题里，「两侧各自什么状态」
**在真实运行中永远答不出来**——两侧恒为「审查中」、`attempt` 恒为 0、
`elapsed_s` 恒为 0。我为「状态变化时补一句说明」「重试收尾中」写的分支全是不可达代码，
QUICKSTART 里「gemini 已完成 · glm 审查中」那行示例也打不出来。

**这一条我有实地佐证**：本次代码双审我跑了 6 次 `--wait`，每次两侧都是
`running ｜ 模型名`，连 `elapsed_s` 都没有（为 0 时不渲染），直到终态才一起跳成 `ok`。
当时我把它当成「两侧确实都还在跑」，没有意识到那是**写入侧的缺失**。审查员从代码
反向指出了我从现象里没看出来的东西。

AGY-04 同理有实地佐证：等待期间用户插了一次 `/dual-status`，输出只有
「plan: running（自 …）」——没有已用时、没有两侧状态。我当时照转了，也没意识到
自己刚在四个 skill 里把它写成了「想自己看进度可以随时 `/dual-status`」。

## 1. 逐条裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 已回查并有本次运行的实地佐证（6 次 `--wait` 两侧状态零变化）。等待期单侧状态不可感知，使本次需求的核心目标之一落空 | §2 修改 1：`runner.ts` 加 `onSideProgress` 回调，`review.ts` 透传，`workerMain` 内 `patchStatus` 落盘 |
| AGY-02 | gemini | minor | 接受 | `budgetFor(cfg, stage0)` 取的是配置窗口，而 `waitRun` 收到的 `timeoutS` 可被 `--timeout` 覆盖。「第 N 次等待」会与实际节奏脱节 | §2 修改 2：`budgetFor` 增可选 `waitTimeoutS`，`waitRun` 透传实际生效值 |
| AGY-03 | gemini | minor | 接受 | 设计 7.5 表的 `--status` 行写「同上」，而我本次给 `--wait` 行加了结构化字段——「同上」因此也承诺了它们，但 `--status --json` 没给 | §2 修改 3：`statusRun` 返回 brief 与 budget，CLI `--status --json` 对齐字段 |
| AGY-04 | gemini | minor | 接受 | 已回查并有实地佐证：`trivium status` 是闸门概览，不查运行进度。我的播报指引把用户指向了一个答不出问题的命令 | §2 修改 4：四个 skill 指引改 `TV review --status <run_id>`；`dual-status` skill 补一句指路 |
| AGY-05 | gemini | nit | 接受 | 与 GLM-04 同一缺口。AC-19 单列的 Given 没有任何测试保护 | §2 修改 5：补 null 边界集成用例 |
| GLM-01 | glm | minor | 接受 | 设计 7.5.1 那句「上述字段存在但取值为 null」把 `sides`（`{}`）、`max_waits`（仍给数字）、两个提示句一并囊括了，与已批准的修订 E 不符。实现是对的，文档这句会误导 | §2 修改 6：按修订 E 的精确表述重写该句 |
| GLM-02 | glm | minor | 接受 | 同 AGY-03。二选一中选「补齐字段」——设计表既已承诺，补齐比削承诺更合契约本意 | 同 AGY-03，§2 修改 3 |
| GLM-03 | glm | minor | 接受 | FR-23 纯文档跳过路径上 `--start` 早返回不含 `models`/`stage_timeout_s`，而我新加的播报义务正建在这个缺口上。默认关闭所以触发面小，但义务与数据来源应闭环 | §2 修改 7：四个 skill 的播报义务前补 `finished_inline` 分支 |
| GLM-04 | glm | minor | 接受 | 同 AGY-05。`seedRun` 总写 `status.json`，null 分支只被人工路径触达，改坏了不会红 | 同 AGY-05，§2 修改 5 |
| GLM-05 | glm | minor | 接受 | `cli.ts` 按另一份 `Date.now()` 手写重算 `pct`/`waits_done`，而 `budgetOf` 是模块私有。两份真相，且我刚在 `statusRun` 为同构问题写过「不能在两个地方显示成两个样子」——同一纪律的漏网 | §2 修改 8：`WaitOutcome` 直接带算好的值，CLI 只透出不自算 |
| GLM-06 | glm | nit | 接受 | 示例「已用 10m12s / 预算 25m（40%）」在任何配置下都打不出来：25m 是本项目覆盖值，且 612/1500 按 `Math.round` 是 41%。本补丁的主题恰是让这些数字可信 | §2 修改 9：换成出厂默认能自洽产出的数字 |
| GLM-07 | glm | nit | 接受 | 时钟回拨时 `elapsed` 为负会渲染「（-3%）」与「第 0/32 次等待」——正是 AGY-04（计划轮）刚修掉的同款。`fmtDuration` 已钳负，同族函数防护不一致 | §2 修改 10：`budgetOf` 先钳 `elapsedS` 非负 |

## 2. 修改计划与落点

### 修改 1 · 等待期逐侧状态回写（AGY-01）

- [src/trivium/runner.ts](src/trivium/runner.ts)：`RunnerInput` 增可选
  `onSideProgress?: (critic: CriticId, patch: SideProgress) => void`。
  `runOneSide` 在**三个时刻**回调：每次尝试开始（`state: 'running'`、`attempt`）、
  该次尝试结束（`elapsed_s`）、该侧收口（终态 `state`）。
  回调失败不得影响审查本身——包 try/catch 吞掉。
- [src/trivium/review.ts](src/trivium/review.ts)：`executeRun` 接可选
  `onSideProgress` 并透传给 `runBothSides`。
- [src/trivium/run-protocol.ts](src/trivium/run-protocol.ts)：`workerMain` 传入回调，
  回调体内 `patchStatus(runDir, …)` 更新对应侧。`patchStatus` 已按 `runDir`
  串行化（[status.ts:110-118](src/trivium/status.ts#L110-L118)），与心跳定时器并发安全。
- 单测：以假适配器驱动 `runBothSides`，断言回调在开始/重试/收口三点各触发一次且
  `attempt` 递增。

### 修改 2 · `budgetFor` 用实际生效窗口（AGY-02）

`budgetFor(cfg, stage, waitTimeoutS?)`，缺省回落 `cfg.review.wait_timeout_s`；
`waitRun` 把自己收到的 `timeoutS` 传进去。`maxWaits` 随之按实际窗口重算。

### 修改 3 · `--status --json` 对齐结构化字段（AGY-03、GLM-02）

`statusRun` 的返回增 `progressBrief` 与 `budget`，CLI 的 `--status --json`
输出与 `--wait` 同一组字段。两个分支共用同一段字段组装，避免再长出第三份真相。

### 修改 4 · 播报指引指向真能查进度的命令（AGY-04）

四个 skill 的开场播报：「想自己看进度可以随时 `/dual-status`」→
「想看本次运行的实时进度用 `TV review --status <run_id>`；想看全局闸门与降级记录用
`/dual-status`」。同时 [skills/dual-status/SKILL.md](skills/dual-status/SKILL.md)
补一句：本命令给的是闸门概览，要运行级进度请用 `review --status <run_id>`。

### 修改 5 · null 边界测试（AGY-05、GLM-04）

`test/integration/run-protocol.test.ts` 增一例：布置**只写 `worker.pid`、不写
`status.json`** 的运行目录，以短窗口调 `waitRun`，断言 `status === null`、
`exitCode === 73`、`progressBrief` 匹配「仍在启动中」、`budget` 仍是有效对象。

### 修改 6 · 设计 7.5.1 的 null 措辞收紧（GLM-01）

改成修订 E 的精确表述：`elapsed_s` / `budget_s` / `pct` / `waits_done` 置 null，
`sides` 置 `{}`，`max_waits` 仍按配置给出，`progress` 与 `progress_brief`
均为同一句启动提示。

### 修改 7 · `finished_inline` 分支（GLM-03）

四个 skill 的播报义务前补一句：返回含 `finished_inline: true` 时**跳过开场播报与
`--wait` 循环**，直接转述 `notice` 收尾；`dual-run` 的 S2/S6 同样继承。

### 修改 8 · 消除 CLI 里的第二份换算（GLM-05）

`WaitOutcome` 增 `view: { elapsedS, pct, waitsDone } | null`，由 `status.ts`
统一算出（与 `progress`/`progressBrief` 同一份 `now`）。CLI 只透出，不再自算。
`statusRun` 同样带上。

### 修改 9 · QUICKSTART 示例数字自洽（GLM-06）

换成出厂默认（plan 900s、窗口 180s）能真正产出的一行：
`plan 审查中 ｜ 已用 5m0s / 预算 15m0s（33%）｜ gemini 已完成 · glm 审查中`。

### 修改 10 · `budgetOf` 钳非负（GLM-07）

`elapsedS` 先 `Math.max(0, …)`，与 `fmtDuration` 同口径；`pct`/`waitsDone`
自然归 0/1。补一条时钟回拨的单测。

## 3. 验收口径澄清（非意见，回应 glm 盲区第 5 条）

glm 在盲区里提请裁决：修订 F 的验收 `grep -rn "540s\|（600000）" skills/`
会命中再生成的 bundle 注释（`trivium.cjs` 里「原值 540s」）。

**裁决：验收 grep 的范围限定为 `skills/*/SKILL.md`，排除生成物。**
`skills/dual-critic/scripts/trivium.cjs` 是 esbuild 产物且在 `.gitignore` 里，
其中的字符串来自 `config.ts` 的注释，随源码走、不会独立漂移——它正是修订 A
「不手改产物」的同一条理由。本次实际执行的验收命令即为
`grep -rn "540s\|（600000）" skills/*/SKILL.md`，结果无命中。
