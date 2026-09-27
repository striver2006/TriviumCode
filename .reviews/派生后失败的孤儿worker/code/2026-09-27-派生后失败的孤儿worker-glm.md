---
schema: trivium.review.v1
topic: 派生后失败的孤儿worker
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.9
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260927T151757Z
rerun_index: 1
snapshot_hash: sha256:fd2023d4e526ed3425c588ffe65868244d9ea7b84908fa0ae4763fe109463d62
blind: true
started_at: 2026-09-27T15:17:59.764Z
finished_at: 2026-09-27T15:30:30.801Z
duration_s: 751
tool_calls:
  read: 18
  grep: 22
  glob: 0
  run_command: 0
  project_reads: 26
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_31c08cc5-d9a1-457c-a487-e4f760081d8e
---

# 代码审查：派生后失败的孤儿worker

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260927T151757Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险的一条也只是播报措辞：settleOrphanedStart 的「尽力步」失败后，后续 warn 仍宣称成功（「已终止工作进程组」在未能确认退出时照打、「主题锁已记在它名下」在改写失败时照打），D5 排障路径上两条 warn 会自相矛盾（GLM-01，minor）。除此之外五个审查焦点全部核实无误：六步次序与计划 r2 一致、各步吞错不改原退出码；句柄防复用在两个发信号点均成立，cancelRun 改用 terminateProcessGroup 除宽限判据收紧（AGY-04）与一处如实登记的先行 isGone 外逐项等价；锁已改写格的四道守卫与 status.json 三分正确；取值面四处一致、A7 回滚演练成立；15 条源码变异 + 1 条契约变异与 13 项零配额验收真实咬合，第 1 次验收的两条红确系构造问题。建议批准，GLM-01 可随后小修。

**结论**：`approve-with-nits`

## 审查意见（共 1 条：次要 1）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts:584-611` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：settleOrphanedStart 的播报在吞错之后仍宣称成功，同一场景会输出互相矛盾的 warn。（1）第 1 步的「--start 在派生工作进程之后失败：已终止工作进程组 〈pid〉（SIGTERM[，未响应后 SIGKILL]）」无条件打印：D5（t.gone 为假）时紧接着又说「未能确认退出」；terminate 抛错被 catch 的那一格也是先说「终止…时出错」再说「已终止」，且 escalated 硬编码 false，报出的信号序列未必是实际发生的。（2）D5 分支的「主题锁已记在它名下」：前一步 soft('把主题锁改记到工作进程名下') 失败时（已打「…改记…失败」warn），这句仍断言已记，而实际锁仍是 --start 的内容、本进程退出后将按 pid_gone 被回收、孤儿若活着会与新一轮并发。这两句都出现在用户需要照着手工操作的罕见路径上，误导的代价最大。计划 r2 §3.4 的原文即是这个措辞，属计划与实现同源的小瑕疵，不是实现跑偏。

**依据**：src/trivium/run-protocol.ts 的 settleOrphanedStart：第 1 步 try/catch（:576-587）之后无条件 warn「已终止工作进程组」（:584-587）；D5 分支 soft 改写锁（:598-607）之后无条件 warn「主题锁已记在它名下」（:608-611），soft 的吞错只打「…失败」一行（:566-572）。对照 .reviews/派生后失败的孤儿worker/plan/2026-09-27-派生后失败的孤儿worker-r2-claude.md §3.4 第 1、2 步的原文措辞相同。doc/05_testing/evidence/orphan-worker-20260927/acceptance-readout.json 的 A1.stderrTail 展示正常路径输出「已终止工作进程组 58367（SIGTERM）」——gone 为真的那一格措辞准确，问题只在 gone 为假与改写失败的两格。

**建议**：播报按实际结果分支，不改行为：第 1 步那句在 gone 为假时改为「已向工作进程组 〈pid〉 发送终止信号，未能确认退出」一类；terminate 抛错那格沿用出错 warn、不补「已终止」。D5 的锁一句按 soft 结果二选一：成功才说「已记在它名下」，失败时说明锁仍是本进程内容、本进程退出后可能按 pid_gone 被回收，请以 --cancel / 手工结束进程组为准。

## 认为正确的部分

- 收尾次序与计划 r2 §3.4 一致：终止并按句柄确认退出 → 确认不了时一概不回收（闸门、run.json、status.json phase 不动，只尽力补 pid 与启动时刻、把仍是本进程内容的锁改记到 worker 名下、不放锁）→ 回收闸门（排在终止之后，消除孤儿事后置待裁决）→ finalizeFailedRunMeta(post_spawn_exception) → status.json 三分 → 放锁（release() 只删自己的锁 + 已改写格按 run_id+pid 复核后 reclaimStaleLock）。settleOrphanedStart 全程不抛（各步 soft / finalize 自吞），startRun 的 catch 原样 rethrow，exitCodeOf 与 CLI 顶层同口径（A1 实测退 1、termination.exit_code=1），吞错不掩盖原退出码。
- PID 复用防护成立：--start 是 worker 的父进程，hasExited() 读 exitCode/signalCode，JS 观察到 false 即子进程未被回收、pid 与同号进程组不可复用；'exit' 监听在拿到 pid 后同步挂上不会漏（exec.ts:354-361）。terminateProcessGroup 每次发信号前先问 isGone()（exec.ts:494、496-499），两个发信号点（刚派生后的 SIGTERM、5s 宽限后的 SIGKILL）都不暴露于「已回收但 exitCode 未置位」的微窗口——前者子进程刚诞生必活，后者要求此前连续 5s 轮询为假，退出事件早已送达；K2 探针实测 kill 后 4ms 收到 'exit'。U3/U4④ 与 M7/M9 守住。
- cancelRun 改用 terminateProcessGroup 后与旧实现（diff :623-635 的旧码）逐项等价：同为 killProcessTree 按组 SIGTERM（ESRCH 退回单进程）、宽限 5s、每 250ms 轮询、SIGKILL 之后不等；唯一行为变化是宽限期判据由「只看存活」收紧为「不存活或不是同一进程」（workerGoneForCancel，与 workerConfirmedGone、judgeStale 同口径），U6/M15 守住。报告 §3.1 如实登记了另一处微小偏离（SIGTERM 前多问一次 isGone，进程恰在两次判断之间死掉时不再发信号）与 step 文案去掉「（含两侧厂商子进程）」（D7）。
- 锁已改写格的并发论证核过：worker 被终止后新 --start 按 pid_gone 接管锁、经 expect.state 含 running 的比较-交换接管闸门（review.ts:914）；四道守卫——releaseRunningGateEntry 按 runId+running（state.ts:286）、run.json 收尾在主题任务锁内且仅 running 时写且按 run_id 键（meta.ts unfinishedRunMetaStep）、第 6 步双条件复核（run_id+pid）、reclaimStaleLock rename 后复验内容不符放回（lock.ts:97-127）——两轮不串写；release() 只删 pid 与 acquired_at 都属于自己的锁（lock.ts:185-191）。U5③ 钉住第③道。
- status.json 三分正确：已终态不动（回调内再查 isTerminal）；run.json 属本进程收尾的落 failed+exit_code+message 并补 pid；worker 已写 run.json 终态的只补 pid 不落 phase（workerWroteTerminal 的判别排除了自写的 failed+post_spawn_exception），指路按 status.json 是否终态分两种。U5④ 与 M14 守住，不把 worker 的 success 降成 failed。
- 取值面四处一致：run.v2.json 的 by 枚举与 status/termination 两处 description、types.ts EXCEPTION_TERMINATION_BY 与文档块、report.ts unlistedLabel 新支（含注释）、S1″/V8′ 新增格；S3/V9 按常量比对/遍历兜底。A7 回滚演练成立：旧代码+取值面 32/32 全绿（S3/V9 不红），纯旧构建读新取值 readRunMeta=null、resolveStageDriver 判 corrupt——「保留取值面、只回退行为代码」的配方被证实。
- 验证装置真实咬合：15 条源码变异 15/15（mutation-output.txt），M1/M2/M4 另存了失败用例名与首行文案且无「预建窗口未命中」（mutation-names-output.json）；契约变异 MC1 咬住 S1″/S3；P4/P4b/P4c 走真实子进程与 EISDIR 构造，finally 断言无残留 worker；U5 用注入钉住零配额造不出的三格与 D5。第 1 次验收的两条红确系构造问题：A4 的 59 个未用预建目录与人为放置的 worker.pid 目录（acceptance.mjs:215-225 撤除后无提示）、A7(ii) 的 git archive 缺 .reviews/（repro-a7.mjs 复现后 32/32）——真实失败形态里两者都不存在，判读可信。
- 文档改准与代码一致：killProcessTree 文档块、cancelRun 注释与 step 文案、LLD 第 5/7 条、MANUAL 取消一节的「已知缺口」、PROTOCOL --start 流程、schema status description 均如实写明「按 worker 进程组发的信号够不到 killTree 拉起、自成进程组的厂商 CLI」，与 A5/K1 探针读数（treeChild 存活、ppid=1）一致；EV-152 新登并如实标注「真实 CLI 会不会因管道断开自行退出未实测」，EV-150 结案注记、EV-146/151/38 注记齐全。

## 未覆盖范围（本侧盲区）

- 未运行任何构建/测试/变异/验收脚本（审查只读）；npm run check 2159/2157、变异与验收读数采信报告与 evidence 存档。
- 「未回收即不复用」依赖 libuv 在回收子进程的同一回调里置位 exitCode/signalCode 的语义：按事件循环相位推理 + K2 探针（Node v25.2.1/macOS）论证，未读 Node/libuv 源码逐行验证；最低支持版本 Node 18 未实测（报告 §3.2 已如实登记）。
- 锁已改写成 worker 内容且收尾窗口内被新一轮接管——四道守卫按代码论证，U5③ 只钉住第③道，确定的并发时序零配额造不出（与报告 §3.3 一致）。
- --cancel 与 settleOrphanedStart 对 status.json 的后写者胜出（phase 在 cancelled/failed 间取其一）按计划 §3.5 声明接受，未另构造验证；D5 分支锁改写失败且孤儿实际还活着的后续演进（EV-151 家族残留）按计划 §6.2 论证，未深挖。
- focus-check.mjs、gen-mutation-spec.mjs 只粗读用途，未逐行核对生成与判据逻辑；hooks.ts 的会话启动清扫只读了与 W5/W7 相关的调用面。

## 实际查阅的项目文件

- `.reviews/派生后失败的孤儿worker/plan/2026-09-27-派生后失败的孤儿worker-r2-claude.md`
- `.reviews/派生后失败的孤儿worker/code/_meta/changes-20260927T151757Z.diff`
- `src/trivium/util/exec.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/meta.ts`
- `src/trivium/lock.ts`
- `src/trivium/status.ts`
- `src/trivium/state.ts`
- `src/trivium/types.ts`
- `src/trivium/report.ts`
- `src/trivium/review.ts`
- `src/trivium/util/log.ts`
- `src/trivium/exit-codes.ts`
- `skills/dual-critic/schema/run.v2.json`
- `test/integration/run-protocol.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/integration/worker-detach.test.ts`
- `test/unit/run-meta-strict.test.ts`
- `test/unit/report.test.ts`
- `doc/05_testing/REPORT_2026-09-27_orphan_worker.md`
- `doc/05_testing/evidence/orphan-worker-20260927/mutation-spec.json`
- `doc/05_testing/evidence/orphan-worker-20260927/mutation-output.txt`
- `doc/05_testing/evidence/orphan-worker-20260927/mutation-names-output.json`
- `doc/05_testing/evidence/orphan-worker-20260927/contract-mutation-output.txt`
- `doc/05_testing/evidence/orphan-worker-20260927/acceptance-readout.json`
- `doc/05_testing/evidence/orphan-worker-20260927/acceptance.mjs`
- `doc/08_project/BACKLOG.md`
- `doc/01_requirements/PRD_driver_dual_critic.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/07_manuals/MANUAL_user.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":18,"grep":22,"glob":0,"run_command":0,"project_reads":26}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
