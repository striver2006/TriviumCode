---
schema: trivium.review.v1
topic: zcode探针静默失败收口
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.16
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20261003T071007Z
rerun_index: 1
snapshot_hash: sha256:88202d15fb6e53675e0937b74f46c2872aeeef00a627b268ce647d79c619727f
blind: true
started_at: 2026-10-03T07:10:09.578Z
finished_at: 2026-10-03T07:17:33.371Z
duration_s: 317
tool_calls:
  read: 42
  grep: 9
  glob: 0
  run_command: 0
  project_reads: 21
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
session_id: 10c4f15f-6274-4e9b-8e5a-29982d3ae8b8
---

# 代码审查：zcode探针静默失败收口

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261003T071007Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

代码变更完整兑现了已批准的计划 r2 与 EV-196/EV-197 目标。
在 EV-196 方面，doctor 的 ZCode 真实调用段未刷新 response_field 时，探针将过程事实带出而不落盘，doctor 相应产生 warning 提示沿用旧值及排查 note，且不影响既有 blocker 判据与退出码；
在 EV-197 方面，将认证探活与 doctor 探针的临时目录删除收敛至共用函数 removeZcodeTempDir，实现了重试三次且失败不抛出，同时按是否落盘副本区分残留凭据警告文案，探活结论保持稳定；
单测 A1～A4 与 D10b、D11～D16 完备覆盖各分支与断言，18 条变异测试与全量串行自检均绿，文档及运维手册同步完整，无逻辑缺陷或调用链断裂。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- EV-196 静默失败收口设计严谨：通过 ZCODE_HEADLESS_UNREFRESHED 表统一管理三支失败的人读描述、note 定位字面与沿用旧值字段集合，避免了 warning 提示与探针 note 的文案分叉。
- 未刷新状态作为过程事实返回而不落盘（同 flagsIndeterminate 先例），保持了探针落盘 Schema 与缓存机制的稳定性，未对下游引入契约漂移。
- EV-197 删除逻辑收敛到位：removeZcodeTempDir 与 zcodeTempDirResidueText 抽至 adapters/zcode.ts 供探活与探针复用，按 seen.hasCopy 区分有无真实凭据的两档文案，真实反映残留状态。
- 探活 attempt 拆分合理：通过内部 attempt 函数与外层 finally 结构，保证了无论拉起成败，临时目录删除失败均不会以未捕获异常击穿 probeAuth，且探活 ok 结论不受删除失败干扰。
- 测试与变异防护严密：新增 D10b、D11～D16 以及 A1～A4，结合 18 组变异覆盖了文案改写、分支带出、blocker 判定、以及目录加锁无法删除等全部边界场景，且测试装置均在私有根中隔离并清理。

## 未覆盖范围（本侧盲区）

- 因审查员无执行命令权限，所有测试通过性、变异执行与退出码均依据留痕报告与静态代码分析推导，未在本机实际执行 node --test 或 doctor。
- Node.js 内部 fs.rm 的 maxRetries: 3 机制在不同操作系统内核对瞬时文件锁（EBUSY / ENOTEMPTY）的重试退避行为，无法通过静态审查完全复核。
- 真实 ZCode CLI 0.16.9 在生产环境下若产生非预期 stderr 且伴随 spawn 崩溃时的系统呈现，依赖于环境实际运行情况，未作真机故障注入验证。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-03_zcode_probe_silent_fail.md`
- `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/check-1.txt`
- `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/doctor-selftest.txt`
- `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/mutation-names-log.txt`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/preflight.ts`
- `test/unit/zcode-doctor-probe-home.test.ts`
- `test/unit/zcode-auth-probe.test.ts`
- `test/unit/registry-parity.test.ts`
- `test/helpers/doc-archive-index.ts`
- `.reviews/zcode探针静默失败收口/plan/2026-10-03-zcode探针静默失败收口-revised-claude.md`
- `.reviews/zcode探针静默失败收口/plan/2026-10-03-zcode探针静默失败收口-r2-claude.md`
- `.reviews/zcode探针静默失败收口/code/_meta/changes-20261003T071007Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":42,"grep":9,"glob":0,"run_command":0,"project_reads":21}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
