---
schema: trivium.review.v1
topic: CLI进程组记录
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.12
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260928T015235Z
rerun_index: 1
snapshot_hash: sha256:7a2799a4c0fdf98add9900de34c2177a1bb86d58a66352e348d4febfa2135c98
blind: true
started_at: 2026-09-28T01:52:37.148Z
finished_at: 2026-09-28T02:04:09.367Z
duration_s: 282
tool_calls:
  read: 34
  grep: 2
  glob: 0
  run_command: 0
  project_reads: 21
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 9b7849f4-8233-459b-b7d0-50ba7e1f8079
---

# 计划审查：CLI进程组记录

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260928T015235Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本计划架构方向正确，严格遵照送审前 8 项用户决策与单一登记面纪律，AsyncLocalStorage 传参与 D3 终态早退兜底设计合理。
主要改进点在于：
1. 修正 §4.5 关于 unverifiable 记录「在 PID 复用时可判 reused 放行」的逻辑漏洞（无启动时刻时复用仍判 unverifiable，仅退出后判 gone）；
2. cancelRun 在确认结束 CLI 进程组后应在 status.json 中将对应 sides[c].cli 置为 null，避免在磁盘留下陈旧 live 标记；
3. 补齐 processStartTime 异步链的 catch 兜底，防范未捕获异常。
整体质量优良，建议带意见通过。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 3）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.5 & §7.2` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：§4.5 与 §7.2 认为 unverifiable 的记录「在组长退出或 pid 被复用时判 gone / reused 即可放行清扫」，此推导与 §4.3 的判据定义冲突：当 started_at 为 null 时，若该 PID 被后续新进程复用，由于缺乏历史启动时刻比对基准，judgeCliGroup 仍将恒定返回 unverifiable，绝不可能判为 reused；它只有在该 PID 进程彻底退出（kill 为 false）时才会返回 gone。将「PID 被复用」视为放行时机属于逻辑漏洞。

**依据**：对比被审计划 plan §4.3「组长不在 ⇒ gone；在而 started_at 为 null ⇒ unverifiable；在而启动时刻不符 ⇒ reused；相符 ⇒ alive」与 plan §4.5「代价是这类目录一直 deferred 到组长退出或 pid 被复用（届时判 gone / reused 即放行）」，并对照 src/trivium/util/exec.ts:420-441 与 src/trivium/status.ts:165。

**建议**：修正 §4.5 与 §7.2 的边界论证：澄清 started_at: null 的记录在 PID 被其他进程复用且占有者存活期间，判定仍将持续为 unverifiable，只有在该 PID 进程退出（系统无该进程）时才转为 gone 并放行脱敏。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.4 & src/trivium/run-protocol.ts:1303-1308` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：cancelRun 在按记录终止 CLI 进程组后，未在 status.json 回写收尾中清理已确认退出的 cli 记录（将其置为 null）。这导致已取消的运行在磁盘 status.json 中永久保留当时的 CLI 进程组号与时间戳；后序的 retention 清扫或重复 --cancel 仍需反复核对进程表，若遇到 PID 复用且原记录 started_at: null，更会引发不必要的持续 deferred。

**依据**：对照 src/trivium/run-protocol.ts:1303-1308 与 plan §4.4。cancelRun 在常态终态写入处调用 patchStatus 将 phase 设为 cancelled，但并未清理 sides[c].cli；plan §4.3 规定 cli: null 代表「没有在跑的 CLI」。

**建议**：在 cancelRun 正常取消链路的 patchStatus（run-protocol.ts:1303）中，对已确认退出的 CLI 侧记录同步将 sides[c].cli 置为 null；在 D3 终态早退分支中也应阐明是否收敛已结束的 cli 字段。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.1 & src/trivium/util/exec.ts:146-154` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：§4.1 中通过 processStartTime(pid).then(...) 异步回填 startedAt 的 Promise 链若缺乏 .catch() 兜底，在 /bin/ps 执行超时或 notify() 抛错时，将触发 Node.js 未捕获拒绝（UnhandledPromiseRejection），导致 worker 进程意外终止。

**依据**：plan §4.1 代码段使用 processStartTime(pid).then(...) 异步更新 startedAt 并通知，但未显式包含 catch 保护；参考 src/trivium/run-protocol.ts:798-802 对 Node.js ≥ 18 异步未捕获异常导致崩溃的防御纪律。

**建议**：在 processStartTime(pid).then(...).catch(...) 链条尾部附加显式异常吞掉逻辑，确保异步取启动时刻过程中的任何扰动都不会连累 worker 主进程。

## 认为正确的部分

- 坚持单一登记面原则（用户决策 2），由 exec.ts 的 liveTrees 统一派生快照与通知，未另建第二份同职注册表。
- 采用 AsyncLocalStorage 传递侧标签（D1），避免侵入修改四个厂商适配器与 AdapterContext 签名，跨异步调度与子进程事件实测有效且改动高度收敛。
- 覆盖关键真实时序 c′ 格（D3）：worker 强杀后被 --wait 先判为 failed 终态、用户随后才 --cancel 时，能结束孤儿 CLI 且严格保持终态历史不变。
- 零配额验证方案完备，复用 Atomics.wait 构造事件循环阻塞（Q3/b 格），新旧构建对照与 M1～M14 变异设计详实。
- 严格遵守架构纪律 10，状态模型与快照投影未向 src/ 引入任何具体 Agent ID 字面量。

## 未覆盖范围（本侧盲区）

- macOS 之外操作系统（Linux/Windows）在进程组（PGID）及 ps -o lstart= 的差异与兼容性。
- 真实厂商商业 CLI（agy / zcode / codex）在极端长周期超时重试下的多进程并发细节（遵照用户决策 7 不烧配额，由桩模拟）。
- EV-146 挂死 worker 强杀与 run.json 补收的实际编码实现（遵照用户决策 6 仅做方案论证）。

## 实际查阅的项目文件

- `.reviews/CLI进程组记录/plan/2026-09-28-CLI进程组记录-claude.md`
- `src/trivium/util/exec.ts`
- `src/trivium/status.ts`
- `src/trivium/retention.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/runner.ts`
- `src/trivium/cli.ts`
- `src/trivium/hooks.ts`
- `src/trivium/util/log.ts`
- `src/trivium/util/git.ts`
- `test/unit/registry-parity.test.ts`
- `test/helpers/proc.ts`
- `scripts/mutation-check.mjs`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/REPORT_2026-09-28_cancel_cli_reach.md`
- `doc/05_testing/evidence/cancel-cli-reach-20260928/acceptance.mjs`
- `README.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":34,"grep":2,"glob":0,"run_command":0,"project_reads":21}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
