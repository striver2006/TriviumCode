---
schema: trivium.review.v2
topic: claude首跑路线误判
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.163.0
model_requested: gpt-6.1-sol
model_effective: gpt-6.1-sol
model_effective_source: trace
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
model_route: config_copy
run_id: 20261024T065502Z
rerun_index: 1
snapshot_hash: sha256:1a6275046cb3bc98a6e6ab0a5770c42ffd36b48f9846b42d6aee269d0af2ec5f
blind: true
started_at: 2026-10-24T06:55:11.048Z
finished_at: 2026-10-24T07:10:31.362Z
duration_s: 121
tool_calls:
  run_command: 21
  project_reads: 24
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
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: native
  profile: null
  launcher_requested: /opt/homebrew/bin/codex
  launcher_effective: /opt/homebrew/bin/codex
  wrapper_sha256: null
  configuration_sha256: 6f362d55250bd71f04dcc7b908b61b5522fe845803f7fe6e03239cca16ae846c
  provider_declared: openai
  provider_declared_source: config
  provider_effective: openai
  provider_effective_source: trace
family_comparisons:
  - left: claude
    right: codex
    status: unknown
    left_model: null
    right_model: gpt-6.1-sol
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: codex
    right: gemini
    status: different-family
    left_model: gpt-6.1-sol
    right_model: gemini-3.8-flash-high
    left_source: trace
    right_source: envelope
    reason: 模型族不同：gpt / gemini
  - left: codex
    right: glm
    status: different-family
    left_model: gpt-6.1-sol
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: trace
    right_source: trace
    reason: 模型族不同：gpt / glm
override_reason: 左侧模型信息缺失
session_id: 01a16cb1-263d-7193-859a-2ec309981035
---

# 计划审查：claude首跑路线误判

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261024T065502Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

未发现必须修改后才能实施的问题。已核对路线指纹来源、doctor 前后比对、首跑引导、目录臂配置复制与登记消费链。副本方案能消除本次探测写回造成的误判，同时保留现有环境变化检测；计划中的正反回归与变异覆盖能够区分这两类变化。本结论基于源码静态审查，未执行测试或真实 CLI。

**结论**：通过（`pass`）

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- 候选 A 的取舍成立：仅固定版本不能解决全新安装时 nativeBin 从空到有的问题；局部配置副本同时解决两项来源变化。
- 目录臂内部会 structuredClone(input.cfg)，因此计划保留 review、agents 引用的浅副本方案与现有消费方式相容；doctor 后续登记也显式使用本次探针，无需依赖调用方配置被写回。
- R1～R4 分别覆盖网关 env、profile 内容、包装器内容和现场发现的包装器入口变化；它们仍会改变重新解析的路线指纹。M2 配合 blocker 断言能够防止把稳定性检查整体放宽。
- N1、P1 的入口、目录事实和登记可消费断言，加上 M3，能够防止修复误判时破坏首跑引导。
- 原生二进制中途替换属于既存检测边界，副本方案没有新增这一盲区。支持按计划如实登记，本主题无需因此增加版本调用或改变 doctor 时序。
- 主要验证使用假 CLI，无需模型配额；真实验收单独征询用户，未执行时明确标记未验，成本边界合理。

## 未覆盖范围（本侧盲区）

- 计划尚未实施，未验证新增套件、M1～M4 变异及全量检查的实际读数。
- 未调用真实 Claude CLI，未验证真实配额、耗时或外部自升级行为。
- 未执行 Windows 验收；新增集成套件计划在 win32 跳过，不能据此宣称 Windows 实跑通过。
- 未验证既存盲区之外的新检测能力；尤其不能将本次通过理解为原生二进制在整个探测窗口内的替换均能被 blocker 拦截。

## 实际查阅的项目文件

- `.reviews/claude首跑路线误判/plan/2026-10-24-claude首跑路线误判-claude.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/04_development/GUIDE_env_setup.md`
- `doc/04_development/GUIDE_local_pitfalls.md`
- `doc/05_testing/README.md`
- `doc/08_project/BACKLOG.md`
- `doc/08_project/现存Bug与未完成工作清单.md`
- `src/trivium/adapters/claude-route.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/doctor.ts`
- `src/trivium/config.ts`
- `src/trivium/cli.ts`
- `test/integration/claude-structured-probe.test.ts`
- `test/integration/claude-profile.test.ts`
- `test/helpers/entry-scan-home.ts`
- `test/helpers/scratch.ts`
- `scripts/build.mjs`
- `scripts/mutation-check.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":21,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
