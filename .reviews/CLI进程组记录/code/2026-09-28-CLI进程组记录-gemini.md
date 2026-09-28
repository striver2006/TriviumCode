---
schema: trivium.review.v1
topic: CLI进程组记录
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.12
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260928T030117Z
rerun_index: 1
snapshot_hash: sha256:92e1d25bef20c845b40f1671219f99742cfa992958f6525daf6b05be1a761f35
blind: true
started_at: 2026-09-28T03:01:19.646Z
finished_at: 2026-09-28T03:16:57.389Z
duration_s: 238
tool_calls:
  read: 24
  grep: 4
  glob: 1
  run_command: 0
  project_reads: 14
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
consulted_unverified: true
heterogeneous: true
session_id: 60077baf-0e02-4d68-8ae4-76d9831bfbef
---

# 代码审查：CLI进程组记录

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260928T030117Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

审查结论为批准（approve）。
变更完整落地了已批准的计划 r2（EV-154 连同 EV-38），彻底解决了 worker 被强杀或事件循环卡死时后台 CLI 遗留以及凭据副本被过早抹除的问题。
设计以 liveTrees 为唯一事实源，通过 AsyncLocalStorage 优雅穿透侧归属，启动时刻强制采用 LC_ALL=C/TZ=UTC0 规范化比对，判定层（alive/gone/reused/unverifiable/malformed）逻辑闭合且安全默认。
测试用例覆盖全面（单测、集成、变异验证 18/18 咬住），对外契约与文档保持高精度同步，未发现逻辑缺陷与契约漂移。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- 以 liveTrees 作为进程内 CLI 的唯一登记源，通过 trackedTrees() 投影与 watchTrackedTrees 唯一观察者机制派生至 status.json 的 sides[c].cli，避免了多头登记与状态撕裂风险。
- 侧归属传递采用 AsyncLocalStorage（withTreeTag），仅在 runner.ts 的 runOneSide 单点包裹，无需修改四个厂商适配器的参数签名与调用栈，保证了隐式上下文的安全传播与低侵入性。
- 启动时刻引入规范化环境（processStartTime 增加 canonical 选项，强制以 LC_ALL=C、TZ=UTC0 执行 ps），彻底消除了跨进程比对时因父子进程 TZ 或 Locale 环境变量差异导致的误判复用（reused）。
- judgeCliGroup 状态判定逻辑严密闭合：在进程仍在但 started_at 为 null 时返回 unverifiable，取 ps 返回 null 时二次复核存活并区分 gone 与 unverifiable，防止将不可验证状态错误放行。
- terminateRecordedCliGroups 对记录中的 alive 组并行执行宽限终止（Promise.all），信号下发前动态复核 isGone 防止误击复用进程，并在组长退出后检查非僵尸成员残留；主路径精准清理已确认退出的侧记录。
- 凭据清扫准入（admitScrub）在 workerConfirmedGone 之后追加 cliGroupsConfirmedGone 校验，对处于 alive、unverifiable 或 malformed 状态的目录一律计入 deferred 拦截抹除，彻底关闭 EV-38 凭据误删窗口。
- 单元测试（U10～U16）、集成测试（I3～I7）与变异测试（M1～M18，包含 M10a/M10b 替代变异）设计完备，零配额验收（B1～B10）真实复现并翻转了上一主题 A3 的缺陷。

## 未覆盖范围（本侧盲区）

- 真实厂商 CLI（agy / zcode / codex / claude）在真实网络与凭据下收到 SIGTERM/SIGKILL 后的退出行为未进行带配额实跑测试（沿用零配额桩与进程组测试）。
- 非 macOS 平台（如 Linux）环境下的 ps lstart 规范化输出与非僵尸组成员统计未进行跨平台测试（本项目当前明确仅面向 macOS）。
- Node.js 18 / 20 低版本运行时下 AsyncLocalStorage 在多层异步与事件流下的传播稳定性未作实测验证（本机环境为 Node v25.2.1）。
- 子进程刚派生至 status.json 首次写入落盘之间的极短毫秒级窗口内 worker 猝死（f 格）未构造确定性时序用例，依赖代码逻辑的 fail-safe 处理。
- 计划中明确暂缓并另登 BACKLOG 的余项未作代码级测试：EV-146（心跳停顿下杀挂住 worker）、EV-157（--cancel/--wait 自身准入与到期整删未核 CLI）、EV-158（既有 worker_started_at 对环境敏感性）。

## 实际查阅的项目文件

- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/07_manuals/MANUAL_user.md`
- `doc/08_project/BACKLOG.md`
- `.reviews/CLI进程组记录/code/_meta/changes-20260928T030117Z.diff`
- `.reviews/CLI进程组记录/plan/2026-09-28-CLI进程组记录-r2-claude.md`
- `src/trivium/status.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/runner.ts`
- `src/trivium/retention.ts`
- `src/trivium/adapters/stub.ts`
- `test/unit/cli-group-record.test.ts`
- `test/unit/retention.test.ts`
- `test/integration/gate-loop.test.ts`
- `doc/05_testing/REPORT_2026-09-28_cli_pgroup_record.md`
- `doc/05_testing/evidence/cli-pgroup-record-20260928/acceptance-output.txt`
- `doc/05_testing/evidence/cli-pgroup-record-20260928/check-2.txt`
- `doc/05_testing/evidence/cli-pgroup-record-20260928/mutation-output.txt`
- `doc/05_testing/evidence/cli-pgroup-record-20260928/mutation-output-m10.txt`

> 编排器从工具轨迹中记录到的读取次数：{"read":24,"grep":4,"glob":1,"run_command":0,"project_reads":14}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
