---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.4.9
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261028T063910Z
rerun_index: 4
snapshot_hash: sha256:8963a8ea81e49a2aacb42a01fca62341b1f5cbfb62bc301a92d996e40e45872f
blind: true
started_at: 2026-10-28T06:39:20.983Z
finished_at: 2026-10-28T06:56:23.085Z
duration_s: 487
tool_calls:
  read: 56
  grep: 9
  glob: 0
  run_command: 0
  project_reads: 34
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/agy
  launcher_effective: /Users/chenzhenbo/.local/bin/agy
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: gemini
    status: unknown
    left_model: null
    right_model: gemini-3.8-flash-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
override_reason: 左侧模型信息缺失
session_id: 1ee8ee18-17a2-43c9-bed1-6f1de4f4632b
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261028T063910Z` ｜ 第 4 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

核心安全底线守卫完备：Qoder CN 只读审核准入评估（4/30 项通过，26 项未通过/未测）保持 admitted=false，registry 中 criticEnabled/defaultSelected/driverEnabled 均严格保持 false，生产准入处于阻断状态，未提前接线真实三审。
Custom 模型接入实现严格遵循最小隔离原则：凭据仅抽取重加密选中条目，codec 限于短命子进程执行，全量已知敏感凭据接入内存脱敏护栏并在泄露时直接阻断；官方与 Custom 具备命名空间消歧，底层身份保持 null/unverified。
子进程环境隔离通过 qoderRun 强制 replace 模式实现父环境与动态新增键的彻底阻隔，且保留 parent undefined 兜底；持久化凭据租约机制可在异常退出的情况下安全追踪与回收孤儿目录。
准入台账 admission.v1 契约与 requested_routes 冻结验证完备，全调用链防篡改防重选，同意通过代码审查。

**结论**：通过（`pass`）

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- Custom 模型采用短命 Node 子进程动态解析与单条目重加密，无秘密内存协议传输，未向临时环境复制全量用户凭据或无关配置，从源头降低凭据泄露面
- 严格实施官方 official:<label> 与自定义 custom:<provider>/<modelID> 命名空间与目录精确比对，禁止以短名模糊匹配，底层身份保持 null/unverified 不伪造
- qoderRun 显式指定 envMode: 'replace' 彻底杜绝父进程环境及动态新增环境变量继承，同时配合 undefined 补丁实现双重兜底
- QoderSecretGuard 对已知凭据值、JSON 敏感键与长字符串进行全量内存扫描与脱敏，且一旦命中泄漏立即置 ok=false 阻止结论生效与凭据落盘
- 建立基于所有者生命周期与进程组成员核对的持久化凭据租约机制，使得在异常终止或 SIGKILL 场景下能够可靠安全地回收外部私有认证根
- 严格遵守安全准入底线：在 30 项准入必需项仅通过 4 项模型控制、最小工具面缺少执行层权限拒绝观测的前提下，如实记录 admitted=false 并保持生产开关全面关闭

## 未覆盖范围（本侧盲区）

- 审查员沙箱无写权限及外部 CLI 运行权限，未在宿主机执行真实配额与真实 Qoder CLI 进程验证
- Windows 平台（win32）原生环境隔离、文件 ACL 继承、环境变量过滤及真实 CLI 执行由于宿主为 macOS 未作实机运行覆盖
- Qoder CLI 长周期进程生命周期信号（SIGTERM/SIGKILL 宽限期中断及进程树退出）在极端异常退出场景下的表现未作全量压力测试
- 31 项额外原生工具（如 Cron、Goal、Worktree、Skill、Workflow、WebFetch、Agent 等）在真实执行层下的全面权限拒绝证据仍有待实机全量覆盖

## 实际查阅的项目文件

- `AGENTS.md`
- `GEMINI.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-gemini.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/04_development/GUIDE_local_pitfalls.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/admission-evaluation-2026-10-28T06-23-13-201Z-0993b5.json`
- `skills/dual-critic/protocol/gitignore.snippet`
- `skills/dual-critic/schema/admission.v1.json`
- `skills/dual-critic/schema/review.v2.json`
- `skills/dual-critic/schema/run.v3.json`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/qoder-cn-admission.ts`
- `src/trivium/adapters/qoder-cn-custom.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-trace.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/admission.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/doctor.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/preflight.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/schemas.ts`
- `src/trivium/types.ts`
- `src/trivium/util/credential-lease.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/util/fsx.ts`
- `test/integration/credential-lease.test.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `test/unit/admission.test.ts`
- `test/unit/init.test.ts`
- `test/unit/qoder-cn-model.test.ts`
- `test/unit/registry-parity.test.ts`
- `scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"read":56,"grep":9,"glob":0,"run_command":0,"project_reads":34}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
