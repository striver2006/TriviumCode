---
schema: trivium.review.v1
topic: doctor旗标提示与start共享根检查
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.4.2
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261018T081641Z
rerun_index: 1
snapshot_hash: sha256:db82ccfcbd42b06a42c3dc7bc17a36ac952560480bf33288b11ba6e61e54ff43
blind: true
started_at: 2026-10-18T08:16:47.548Z
finished_at: 2026-10-18T08:22:02.376Z
duration_s: 293
tool_calls:
  read: 40
  grep: 3
  glob: 0
  run_command: 0
  project_reads: 23
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
  - left: claude
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
override_reason: 左侧模型信息缺失
session_id: cb6b5fd7-7f38-43dc-a441-45103aa4fd54
---

# 代码审查：doctor旗标提示与start共享根检查

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261018T081641Z`
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本次变更实现 EV-245（doctor 未使用覆盖旗标提示与判键补全）和 EV-246（review --start 共享读取面同名入口与历史残留检查）。
1. doctor 的覆盖提示严格基于运行期 overridesFor 记录判定，不硬编码厂商名称，新登记 Agent 能自适应归类；退出码与 --json 结构不变。
2. --start 的检查复用 preflight 同一函数 checkSharedReadRoots，仅检验当轮 Driver 与入选审核者，环境干净时返回 null，不破坏告警列表为空的断言，输出保持逐字节一致。
3. 单元测试、集成测试、13 项变异测试及 8 格新旧构建对照均齐备，未发现阻断性或契约偏离问题，整体予以批准。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- doctor 覆盖值消费判定抽象为运行期助手 overridesFor，未硬编码 gemini/glm 等厂商，describeUnusedOverrides 纯函数按固定口径、--only 过滤、无探针三类动态归因，第五家接入时具备自适应能力
- cmdDoctor 统一使用 CRITIC_AGENT_IDS 对模型旗标与档位旗标判键，先键后值顺序与其它入口一致，且提示仅入 warnings 不入 blockers，保证退出码与 --json 顶层字段形状不变
- startRun 告警汇总中追加 checkSharedReadRoots 复用 preflight 同源实现，通过可选参数 occasion 将文案末尾平滑切换为「本次运行」，且无问题时返回 null 保证对干净环境零扰动
- 集成测试 shared-root-start.test.ts、单测 doctor-unused-overrides.test.ts 与 13 组变异矩阵覆盖全面，新旧二进制对照 8 格验证了逐字节一致性

## 未覆盖范围（本侧盲区）

- 因审查员为纯只读环境，未实际执行 npm test、npm run check 或真实厂商 CLI 调用，相关执行结论依赖提供的测试报告与证据读数
- 未在真实多用户 macOS 环境下测试 ~/.agents/skills 存在海量第三方 skill 时的扫描耗时
- 未对除已登记四家之外的实际外部 CLI 扩展进行端到端安装与 doctor 运行验证

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `.reviews/doctor旗标提示与start共享根检查/plan/2026-10-18-doctor旗标提示与start共享根检查-r2-claude.md`
- `src/trivium/cli.ts`
- `src/trivium/doctor.ts`
- `src/trivium/critics.ts`
- `src/trivium/tier-flags.ts`
- `src/trivium/entry-collisions.ts`
- `src/trivium/preflight.ts`
- `src/trivium/run-protocol.ts`
- `test/unit/doctor-unused-overrides.test.ts`
- `test/integration/shared-root-start.test.ts`
- `test/integration/tier-flags-cli.test.ts`
- `test/unit/entry-collisions.test.ts`
- `test/unit/entry-scan-isolation.test.ts`
- `test/unit/preflight.test.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-18_doctor_flags_start_shared_root.md`
- `doc/05_testing/evidence/doctor-flags-start-shared-root-20261018/a-readings-output.json`
- `doc/07_manuals/MANUAL_user.md`
- `doc/08_project/BACKLOG.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":40,"grep":3,"glob":0,"run_command":0,"project_reads":23}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
