---
schema: trivium.review.v1
topic: 取消与失联的凭据准入核CLI
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.12
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260928T235013Z
rerun_index: 1
snapshot_hash: sha256:0712799cb1b2bbacaf97c5997712885a576340c0eb59b8ec508cd8e98977cd46
blind: true
started_at: 2026-09-28T23:50:15.470Z
finished_at: 2026-09-29T00:01:52.238Z
duration_s: 142
tool_calls:
  read: 15
  grep: 6
  glob: 2
  run_command: 0
  project_reads: 12
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
session_id: 18876374-e3b6-441f-bf14-a9a925d75ea1
---

# 代码审查：取消与失联的凭据准入核CLI

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260928T235013Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本次代码变更严格遵照已批准的实施计划 r2 执行，完整解决了 EV-157。
凭据抹除准入抽成单一来源 scrubAdmission，四处消费方逻辑统一收敛；
到期整删准确拦截 CLI 仍在运行的目录并落回未到期路径，不改变 worker 整删语义；
告警文案结构化逐侧展开，交接载荷状态留存严密，归档收尾与 CLI 准入完全解耦；
单元测试、集成测试、变异测试与零配额验收全量通过，文档与台账同步详尽，未发现问题，予以通过。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- 单一来源收敛干净：凭据抹除准入逻辑完整抽象至 status.ts 的 scrubAdmission，使得会话启动清扫、trivium scrub、--cancel 与 --wait 判失联四处调用严格同源，消除了此前只核 worker、不核审查员 CLI 的安全盲区。
- 到期整删设计克制：pruneRunDirs 在到期整删分支仅复用 cliGroupsConfirmedGone 检查 CLI 进程组，被挡目录自然落回未到期路径（kept++ 并由 admitScrub 记录进 deferredCli），既保护了仍在运行的 CLI 副本，又避免了改动 workerStillAlive 带来的整删语义漂移（合理暂缓至 EV-163）。
- 告警与详情交代如实：scrubHoldWhy 与 cliGroupsConfirmedGone 逐条收集 blockers，在 worker 已退出但 CLI 阻挡时，--cancel 与 --wait 能够逐侧列出具体是哪一侧、哪个进程组、为何阻挡（仍在／判不了／读不懂），且在 worker 仍活时逐字保持旧有提示不变。
- 交接载荷与解耦严谨：--cancel 在 patchStatus 收尾时仅清除 settled 侧的 CLI 记录，未确认退出或判不了的记录原样留存以供后续清扫复核；同时归档收尾（finalizeCancelledRunMeta）明确只依赖 worker 退出事实，不与 CLI 准入阻挡产生不当耦合。
- 测试与验证严密完整：新增单测 unit/scrub-admission.test.ts 覆盖五格矩阵（A/B/Br/C/D/E），严格执行进程组标记与 finally 资源清理纪律；16 项源码变异测试全部被目标断言咬住；零配额验收测试 A1～A9 新旧构建对比无意外漂移。
- 工程纪律与留痕完备：严格遵守用户关于冻结清扫子命令输出面（cli.ts:1924 逐字保留）的决策，失实说明规范登记至 BACKLOG EV-164，主设计、LLD、MANUAL、PROTOCOL、BACKLOG 等 5 处文档全部同步到位。

## 未覆盖范围（本侧盲区）

- 真实厂商 CLI 在强杀或信号场景下的物理退出行为（依赖真实 API 配额与外部环境，本次审查依赖进程组 sh+sleep 桩及零配额验收测试）。
- Linux/Windows 平台的行为（本项目明确限定 macOS + VS Code 平台）。
- 未覆盖挂起超过 30 天导致到期整删在 worker 仍活时误删运行目录的场景（该场景已确认不在本主题论域，登记为 EV-163 暂缓）。

## 实际查阅的项目文件

- `.reviews/取消与失联的凭据准入核CLI/code/_meta/changes-20260928T235013Z.diff`
- `src/trivium/status.ts`
- `src/trivium/retention.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/cli.ts`
- `src/trivium/hooks.ts`
- `test/unit/scrub-admission.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/unit/cli-group-record.test.ts`
- `test/contract/bash-recovery-wording.test.ts`
- `.reviews/取消与失联的凭据准入核CLI/plan/2026-09-29-取消与失联的凭据准入核CLI-r2-claude.md`
- `doc/05_testing/REPORT_2026-09-29_cancel_wait_cli_admission.md`
- `doc/05_testing/evidence/cancel-wait-cli-admission-20260929/check-2.txt`

> 编排器从工具轨迹中记录到的读取次数：{"read":15,"grep":6,"glob":2,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
