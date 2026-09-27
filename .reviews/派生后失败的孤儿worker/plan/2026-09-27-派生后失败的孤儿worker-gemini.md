---
schema: trivium.review.v1
topic: 派生后失败的孤儿worker
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.12
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260927T092419Z
rerun_index: 1
snapshot_hash: sha256:0b3f27d2ae449bef5e3f8f5600962f547bba50dd2597b3cd76ad7dcda7471bd9
blind: true
started_at: 2026-09-27T09:24:21.256Z
finished_at: 2026-09-27T09:35:00.167Z
duration_s: 303
tool_calls:
  read: 41
  grep: 1
  glob: 2
  run_command: 0
  project_reads: 21
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: bd6ae631-800d-45d7-85a6-1b97d9b01e35
---

# 计划审查：派生后失败的孤儿worker

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260927T092419Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本计划核心架构方向明确、论证深入，但在两处写入前提与边界逻辑上存在缺陷：
1. 最危险的是 D5（确认不了退出）分支在改写锁之前的失败场景中，锁保留了 --start 的 PID，--start 退出后锁被判定为 pid_gone 误回收，且 prepareRun 允许 running 闸门槽位，将导致新启动拉起第二个 worker 产生真并发；
2. 步骤 5 盲目将 status.json 覆盖为 failed，会把步骤 4 已经处理并成功完成（phase: success）的运行篡改为失败，破坏终态不可逆并使 --wait 引导失效；
3. 进程号复用论证与时序推断成立，测试方案整体扎实，修改上述缺陷后可实施。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 2 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.4 步骤 2 及 §6.2 确认不了退出` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | high |

**问题**：确认不了退出时（D5 分支）若失败点在改写锁之前，锁内容仍为 --start 自身的 PID，--start 抛错退出后该锁将被 judgeStale 判定为 pid_gone 并被下一次启动自动回收，打破「把锁留给孤儿」的并发防线，导致新一轮启动成功拉起第二个 worker 产生双 worker 真并发。

**依据**：查阅 src/trivium/run-protocol.ts:405-413，改写锁发生在派生、写 worker.pid 与取 workerStartedAt 之后；若失败发生在这些步骤，锁内容仍为 --start 进程自身（pid: process.pid, run_id: null）。查阅 src/trivium/lock.ts:200-210，judgeStale 检查持有者存活，--start 进程一旦退出，processAlive(existing.pid) 即返回 false，判定为 pid_gone 并予以自动回收。查阅 src/trivium/review.ts:914，prepareRun 的比较交换允许 state: ['running']。两相结合，下一次 --start 不会被锁阻挡，而是回收该锁、接管闸门并拉起第二个 worker，与计划宣称的「锁留给它」及报错引导完全矛盾。

**建议**：在 Step 2（确认不了退出）中，若锁内容仍为 --start 自身，应尝试将锁改写为 worker 持有（{ ...lock.content, run_id: rc.runId, pid: born.pid, pid_started_at: workerStartedAt }，写入异常吞掉）。若改写成功，孤儿 worker 活着时下一次 --start 即可通过 processAlive(born.pid) 识别锁被活进程占用并拒绝（报 EXIT.LOCKED 70），切实防范并发。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.4 步骤 5 及 §3.5 status.json 写入前提` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：步骤 5 盲目将 status.json 置为 phase: failed，若孤儿 worker 在被终止前已跑完并写下 phase: 'success'（步骤 4 已专门处理并指路 --wait），该状态会被覆盖为 failed，导致后续 --wait 返回失败退出码 1，与步骤 4 引导文案及 run.json 事实相冲突。

**依据**：查阅 plan §3.4 步骤 4，计划明确考虑了孤儿 worker 在被终止前已收尾的分支，且此时 run.json 为 success，追加播报提示「工作进程在被终止之前已跑完：用 trivium review --wait <run_id> 取结果，闸门按它的收尾在等裁决」。但在步骤 5 中，patchStatus 无条件置 phase: failed。计划 §3.5 称其「只影响 message 文案，不影响终态这一结论」，忽略了 worker 写下的正是 success 终态。查阅 src/trivium/status.ts:233 及 src/trivium/run-protocol.ts:805，waitRun 读到 phase: 'failed' 时直接返回失败退出码 1，破坏了终态一致性。

**建议**：步骤 5 调用 patchStatus 时应贯彻「已是终态，不追溯改写」原则，在 mutate 回调内部检查 if (isTerminal(s.phase)) return;（或至少当 s.phase === 'success' 时不降级为 failed），仅在 starting / running 等非终态时才落 failed。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.3 变异表末段及 §4.1 U5` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：计划将「终止必须先于闸门回收」列为无法由变异咬住、仅靠人工审核项；实际上在 U5 进程内注入中，完全可在 mock terminate 中断言闸门此时仍为 running，从而建立确定性的回归守卫。

**依据**：查阅 plan §4.3 变异表末尾注记，称「闸门回收挪回终止之前先后不可观察、咬不住、只在代码审核对」。但查阅 plan §4.1 U5，U5 是针对 settleOrphanedStart 的进程内注入测试，terminate 为桩函数；查阅 src/trivium/state.ts:293，getGate 在进程内可随时查询当前状态。若在 mock terminate 桩内部断言 (await getGate(...))?.state === 'running'，一旦时序颠倒便会当场触发测试红灯。

**建议**：在 U5① 的 mock terminate 桩内部追加对闸门状态仍为 running 的断言，将终止与闸门回收的执行次序由人工盯防转为机械测试约束。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.2 cancelRun 改用 terminateProcessGroup` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：cancelRun 传入的 isGone 判据仅比对了 !processAlive(...).alive，遗漏了 !live.sameProcess，在 5 秒宽限期内若发生罕见的 PID 复用，可能误向复用新进程发送 SIGKILL。

**依据**：查阅 plan §3.2，cancelRun 改用 terminateProcessGroup 时定义 isGone = async () => !(await processAlive(pid, s?.worker_started_at ?? null)).alive。查阅 src/trivium/util/exec.ts:365-382，processAlive 返回 { alive, sameProcess }；查阅 src/trivium/status.ts:165 与 src/trivium/lock.ts:74，全仓判定进程已不在的标准口径均为 !alive || !sameProcess。若仅判定 !alive，当 worker 退出且 PID 在 5 秒内被系统复用时，alive 为 true 但 sameProcess 为 false，isGone 误判为仍在，导致向复用进程错发 SIGKILL。

**建议**：将 cancelRun 的 isGone 判据调整为 async () => { const p = await processAlive(pid, s?.worker_started_at ?? null); return !p.alive || !p.sameProcess; }，与全仓判定口径统一。

## 认为正确的部分

- 目标不变量「启动非零退出 ⇔ 没有工作进程在跑，锁、闸门、留痕都已收拾好」方向明确，消除了孤儿 worker 事后改写闸门与留痕的历史缺陷。
- 基于父进程子进程句柄 watch.hasExited() 确认退出与论证 PID 及同号进程组不复用的依据扎实，完全符合 POSIX 僵尸进程回收语义与 Node.js libuv 事件循环机制。
- 抽出的 terminateProcessGroup 参数化设计良好，支持 killWaitMs 等待配置与 onEscalate 告警回调，实现了 startRun 与 cancelRun 的核心终止链共用。
- 实测核出适配器拉起的厂商 CLI 自成进程组后，采取改准文档、另登 BACKLOG EV-152 的处置取舍合理，且基于启动加载耗时的「来不及拉起审查员」推断成立。
- 验证体系中预建运行目录加命中前置断言、hang 桩钉收尾与防泄漏、ok 桩钉防事后覆盖的分工严谨清晰。
- termination.by 扩展 post_spawn_exception 的 schema 只增不减演进契约与 A7 回滚演练完备。

## 未覆盖范围（本侧盲区）

- macOS 与 Linux 极端高负载或资源耗尽导致内核产生不可中断 D 状态进程时，SIGKILL 5 秒后仍未退出的操作系统极端行为未做真机注入验证。
- 各厂商 CLI 在各类宿主外壳中遭遇标准输出管道破裂（EPIPE / SIGPIPE）时的真实退出行为（已划归 EV-152，本轮未测）。
- 极端磁盘写满（ENOSPC）异常下，原子写临时文件的残留情况。

## 实际查阅的项目文件

- `.reviews/派生后失败的孤儿worker/plan/2026-09-27-派生后失败的孤儿worker-claude.md`
- `src/trivium/run-protocol.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/status.ts`
- `src/trivium/lock.ts`
- `src/trivium/review.ts`
- `src/trivium/state.ts`
- `src/trivium/meta.ts`
- `src/trivium/types.ts`
- `src/trivium/report.ts`
- `src/trivium/hooks.ts`
- `skills/dual-critic/schema/run.v2.json`
- `skills/dual-critic/schema/review.v1.json`
- `test/integration/gate-loop.test.ts`
- `test/integration/worker-detach.test.ts`
- `test/integration/run-protocol.test.ts`
- `test/unit/run-meta-strict.test.ts`
- `test/unit/report.test.ts`
- `doc/08_project/BACKLOG.md`
- `doc/05_testing/REPORT_2026-09-27_residual_finalize.md`
- `.reviews/事后收尾余项/code/2026-09-27-事后收尾余项-response-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":41,"grep":1,"glob":2,"run_command":0,"project_reads":21}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
