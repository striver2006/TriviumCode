---
schema: trivium.review.v1
topic: 派生后失败的孤儿worker
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.12
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260927T151757Z
rerun_index: 1
snapshot_hash: sha256:fd2023d4e526ed3425c588ffe65868244d9ea7b84908fa0ae4763fe109463d62
blind: true
started_at: 2026-09-27T15:17:59.764Z
finished_at: 2026-09-27T15:30:30.801Z
duration_s: 231
tool_calls:
  read: 31
  grep: 3
  glob: 0
  run_command: 0
  project_reads: 24
evidence_ok: true
verdict: approve
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 512c5805-a4b6-4d0b-a2fa-0c87dbc06c1b
---

# 代码审查：派生后失败的孤儿worker

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260927T151757Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

派生后失败的收尾逻辑严格遵循计划 r2 定稿：先终止 worker 进程组并按父进程持有的子进程句柄确认退出，再回收闸门、收尾元数据、按三分处理状态文件、最后放锁；确认不了退出时不释放锁与闸门。
句柄未观察到退出在 POSIX 与 libuv 机制下可确保 PID 未回收不复用；cancelRun 改用 terminateProcessGroup 且宽限期判据收紧后逐项等价。
锁改写后被新一轮接管时，依靠闸门 CAS、元数据隔离、锁双条件校验与 rename 复验四道守卫严格杜绝串写。
新增 post_spawn_exception 取值在 schema、类型、报表与单测四处完全对齐，保留取值面的回滚方案成立。
十五条源码变异与一条契约变异精准咬住目标断言，验收初次失败确属夹具构造问题，文档改准与 EV-152 登记客观实事求是。整体验收通过。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- 派生后失败收尾时「先按句柄终止确认，再回收闸门」的严格次序，彻底消除了孤儿 worker 事后将已回收闸门误置为待裁决的历史时序漏洞
- 确认不了退出时（D5）的防御处置完备：闸门与运行元数据留给可能存活的 worker，锁与 PID 记在其名下并指路 --cancel，严格不释放锁
- terminateProcessGroup 发信号前先问判据的机制有效避免了向已回收复用的进程号误发组信号；cancelRun 收紧宽限期判据至「不存活或不是同一进程」修复了 PID 复用时误将 SIGKILL 打到无关进程的隐患
- 锁改写后 worker 被终止场景下，闸门比较交换、元数据 runId 隔离、锁内容双条件比对与 reclaimStaleLock 原子 rename 复验四道守卫层层设防，严格保证收尾窗口内新一轮接管绝不串写
- 状态文件「已终态不动、本进程收尾落失败、worker已写归档终态只补 PID」的三分逻辑清晰，不改写历史终态，也不替 worker 妄下结论
- 如实修正文档中关于「--cancel 连同 agy/zcode 一同杀掉」的不实描述，将够不到自成进程组 CLI 的缺口如实登记进 BACKLOG EV-152

## 未覆盖范围（本侧盲区）

- Node 18 等低版本环境下的 libuv SIGCHLD 同步回调与 waitpid 行为未在本机实测（本机环境为 Node v25.2.1 / macOS）
- Linux 平台下的进程组终止与 PID 复用生命周期未做跨平台实测
- 真实厂商 CLI（如 zcode-cli、agy 等）在父级 worker 被 SIGKILL 后是否会因 stdout 管道 EPIPE/SIGPIPE 退出未作实机测试（探针使用的是 sleep）

## 实际查阅的项目文件

- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/01_requirements/PRD_driver_dual_critic.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `.reviews/派生后失败的孤儿worker/plan/2026-09-27-派生后失败的孤儿worker-r2-claude.md`
- `.reviews/派生后失败的孤儿worker/code/_meta/changes-20260927T151757Z.diff`
- `doc/05_testing/REPORT_2026-09-27_orphan_worker.md`
- `doc/05_testing/evidence/orphan-worker-20260927/acceptance.mjs`
- `doc/05_testing/evidence/orphan-worker-20260927/mutation-spec.json`
- `src/trivium/util/exec.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/meta.ts`
- `src/trivium/report.ts`
- `src/trivium/types.ts`
- `src/trivium/lock.ts`
- `src/trivium/status.ts`
- `src/trivium/state.ts`
- `src/trivium/review.ts`
- `src/trivium/hooks.ts`
- `skills/dual-critic/schema/run.v2.json`
- `test/unit/run-meta-strict.test.ts`
- `test/unit/report.test.ts`
- `test/integration/worker-detach.test.ts`
- `test/integration/run-protocol.test.ts`
- `test/integration/gate-loop.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":31,"grep":3,"glob":0,"run_command":0,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
