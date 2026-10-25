---
schema: trivium.review.v2
topic: claude首跑路线误判
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.4.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261024T065502Z
rerun_index: 1
snapshot_hash: sha256:1a6275046cb3bc98a6e6ab0a5770c42ffd36b48f9846b42d6aee269d0af2ec5f
blind: true
started_at: 2026-10-24T06:55:11.048Z
finished_at: 2026-10-24T07:10:31.362Z
duration_s: 397
tool_calls:
  read: 28
  grep: 11
  glob: 0
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 1
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
  - left: codex
    right: gemini
    status: different-family
    left_model: gpt-6.1-sol
    right_model: gemini-3.8-flash-high
    left_source: trace
    right_source: envelope
    reason: 模型族不同：gpt / gemini
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: 51fefc60-bef7-4886-aa81-4f1d95d11b11
---

# 计划审查：claude首跑路线误判

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261024T065502Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划对 EV-254 根因定位准确，不仅抓住了 CLI 升级后首跑误判的原因，还排查出全新安装时 nativeBin 从 null 到实测入口的第二触发面。
稳定性比对的语义边界划分清晰：精准区分了环境类真实变化与探针自身产出。
方案取候选 A（首跑引导改用局部配置副本 cfg）从根本上消除了 probeClaude 突变外部入参的副作用，彻底修复两个触发面，同时首跑引导与目录臂正常获取有效路线，功能完备无损。
环境类变化在修复后依然能被探测后的 resolveClaudeRoute 重新读取并拦截推 blocker，拦截能力毫无降级。
回归锚设计了 N1~N3/P1~P3 正向放行与 R1~R4 真实环境变化拦截，配合 M1~M4 变异测试，双向严密守卫，能确凿区分两类变化。
针对计划中关于探测中途 CLI 自升级是否另立条目的疑问，赞同仅在报告和清单中登记为已知边界，无需另立项（已有 preflight 版本核验兜底）。
计划完整周密，结论为通过（pass）。

**结论**：通过（`pass`）

## 审查意见（共 1 条：吹毛求疵 1）

### AGY-01 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §D1（probes/claude.ts:1754, 1760, 1765）` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：首跑引导块内已创建局部配置副本 cfg，且路线重建与目录臂入参均已改用 cfg，但 sensitive_globs 的三处散列比对计划仍保留原写法 opts.config.review.sensitive_globs。虽然浅拷贝下 review 共享同一对象引用，但同一局部作用域内混用 opts.config 与 cfg 破坏了代码引用的一致性，容易给后续维护者造成困惑。

**依据**：已查阅 src/trivium/probes/claude.ts:1744-1765 与 plan §D1。计划中写明「块内三处 opts.config 换成 cfg... claudeSensitiveGlobsHash 三处与副本共享同一个 review，保持原写法」。在同一个首跑引导块内，统一使用局部副本 cfg.review.sensitive_globs 能更彻底贯彻「不读取/不依赖外部可变入参」的封装纪律。

**建议**：在首跑引导块内统一将 opts.config.review.sensitive_globs 替换为 cfg.review.sensitive_globs，消除同一上下文内对 opts.config 的多余交叉引用。

## 认为正确的部分

- 准确识别出全新安装时 nativeBin（null -> entrypoint）与 CLI 升级时 version 的双重触发面，指出既有用例因显式设定 agent.bin 而遮蔽 nativeBin 变化的盲区。
- 方案坚定选择候选 A（首跑引导改用局部配置副本 cfg），否决了无法修好全新安装且破坏入参不可变契约的候选 B，设计决策扎实。
- 语义边界定义精准：明确指纹中 nativeBin 与 version 属于探测产出类，而 wrapperSha256、configurationSha256、settingsEnvSha256 与 profile 下 bin 属于环境类，比对只关注环境类在探测窗口内的漂移。
- 真实路线变化拦截能力完整保留：R1~R4 覆盖了网关 env、profile 文件、包装器内容及包装器路径被替换的全部真实场景，且文件被删时的 catch 逻辑依然成立。
- 首跑引导与目录臂在局部副本 cfg 下能够正确解析出当前路线指纹并完成目录臂实测与前后指纹比对，首跑引导机制未受任何破坏。
- 测试设计严谨：N1~N3/P1~P3 守住正向不误报，R1~R4 守住真实变化必拦截；结合 M1~M4 变异测试形成双向可判定闭环。
- 同意将探测中途 CLI 自升级登记为已知边界而不另立 BACKLOG（preflight 已有 CLI 版本核验守卫，多加一次 --version 收益极小）。

## 未覆盖范围（本侧盲区）

- 因审查员无执行命令权限，未在实际终端运行 node --test 执行新套件与变异测试验证读数，结论基于代码逻辑分析与推演。
- 未在真实多平台环境（macOS / Windows）中挂载假 CLI 或真实 Claude CLI 进行端到端实机验证。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `doc/08_project/现存Bug与未完成工作清单.md`
- `src/trivium/doctor.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/adapters/claude-route.ts`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/types.ts`
- `src/trivium/cli.ts`
- `test/integration/claude-structured-probe.test.ts`
- `.reviews/claude首跑路线误判/plan/2026-10-24-claude首跑路线误判-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":28,"grep":11,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
