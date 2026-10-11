---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.3.3
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261010T224543Z
rerun_index: 4
snapshot_hash: sha256:0eea11306dd7296e4ae580f2c67d7d3d59cb4789882419c8d1aa050212151efb
blind: true
started_at: 2026-10-10T22:45:48.032Z
finished_at: 2026-10-10T23:08:01.430Z
duration_s: 375
tool_calls:
  read: 32
  grep: 5
  glob: 0
  run_command: 0
  project_reads: 24
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: true
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
  - left: claude
    right: gemini
    status: different-family
    left_model: qwen3.8-flash
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：qwen / gemini
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: 7c7e2fba-45ac-48b4-a7e4-8a8c66439315
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261010T224543Z` ｜ 第 4 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本次计划修订精准定位并解决了 r7 因根目录段数限制（<=4）导致 8 个实际 5 段生产禁读根无法压缩、引发 2.89MB settings 与潜在 E2BIG 崩溃的核心瓶颈。
方案严格落实用户「授权总 7 轮，先补充计划审查，再完整代码重审」的焦点要求，依托 formal-round-authorization-v2.json 与 round-guard.mjs 锁死第 6 轮 B/plan 与第 7 轮 C/code 边界，不突破总 7 轮上限且不重置历史失败事实。
5 段 ASCII 根扩展（ascii-root1-5-depth0-2-v2）保持了保守的段字符白名单（^[A-Za-z0-9_-]+$）与 0-2 级后代深度，并通过将目录探针扩展至 5 根覆盖确保实测先验性。
提出的次要意见集中在离线回放与集成测试的断言补充上：需在 test/unit/claude-directory.test.ts 中肯定性断言 8 个 5 段根被成功压缩，防止 0 目录退化场景假阳性全绿；并在 adapter 集成测试中补强 5 段根端到端验证。总体方案成熟严密，予以通过并附带次要意见。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 2）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/claude-directory.test.ts:44` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：离线回放测试 test/unit/claude-directory.test.ts 仅断言路径存在于 projected.paths 或被 directories 覆盖，缺乏对 directories.length 实际匹配到 8 个生产根的肯定性断言；在拓扑限制过窄导致 0 目录压缩的退化场景下该测试仍会假阳性全绿，未能对压缩有效性形成防漂移闭环。

**依据**：test/unit/claude-directory.test.ts:44-50 仅校验循环包含断言，当 projectClaudeDenyPaths 产出 directories=[] 时，所有 3924 条路径均保留在 projected.paths 中，断言依然通过；doc/05_testing/evidence/agent-access-20261011-closeout-r3/shape-boundary-diagnostic.json:66-68 证实 4 段限制下 compressed_tools 为空但该测试此前依然通过。

**建议**：在 CLAUDE-02 / GLM-02 的回放用例中明确追加对压缩效果的肯定性断言，显式断言 assert.equal(projected.directories.length, 8) 以及 assert.ok(projected.paths.length < f.paths.length)。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/integration/claude-directory-adapter.test.ts:34` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：集成测试 test/integration/claude-directory-adapter.test.ts 仅配置了 2 段的 sensitive_globs（evidence/calls/**），未将本次补充修订新增的 5 段 ASCII 根拓扑纳入生产适配器真子进程 argv/settings 拼装与投影的端到端覆盖。

**依据**：test/integration/claude-directory-adapter.test.ts:34 硬编码 cfg.review.sensitive_globs = ['evidence/calls/**']，仅测试了 2 段深度的目录前缀；而计划 §二 GLM-01 与被审修订提出升级为 ascii-root1-5-depth0-2-v2 且覆盖 5 段根，若集成测试不覆盖 5 段敏感目录，无法端到端验证真实适配器调用链对 5 段根的 settings 注入行为。

**建议**：在 test/integration/claude-directory-adapter.test.ts 的用例中补充包含 5 段深度 ASCII 目录的 sensitive_globs 夹具，断言 fake CLI 捕获到的 settings 包含 5 段根的压缩规则。

## 认为正确的部分

- 准确识别并诚实暴露了 4 段根限制导致生产禁读规则完全无法压缩（3924 条全部逐文件、settings 达 2.89MB）的根本缺陷，未在无实测证据情况下盲目推进代码重审。
- 轮数授权与边界控制严密：将用户追加轮次约束固定于 formal-round-authorization-v2.json，任务包装器与 round-guard.mjs 严格对账 task.runs 与 archive，第 6 轮仅限 B/plan、第 7 轮仅限 C/code，上限 7 轮触顶即止，坚守不重置计数与不篡改历史状态的纪律。
- 拓扑扩展克制安全：敏感目录仅扩展至 5 段 ASCII 根，版本标识升至 ascii-root1-5-depth0-2-v2，旧 v1 事实自动失效回退，非 ASCII、空格、逗号及点目录维持逐文件，且要求真机 doctor 重新取证后方可消费。
- 对 4 个未注册写工具的模型组合坚持原标准不退让，不把权限诊断偷换为生产写通过，诚实坚守前置未完成定性。
- 共享七入口迁移坚持整目录备份、逐文件哈希核验、可恢复移动与原子回滚方案，流程清晰稳健。

## 未覆盖范围（本侧盲区）

- 审查员处于只读环境，无法执行 Node/Bash 命令，未能实测 launch-v2.mjs 在真实终端中的调用拦截与文件锁并发表现。
- 未能在真实终端中运行 doctor 验证 Claude 3 条实际路线在 5 根拓扑扩展后的真实耗时与网络/配额开销。
- 未能在线调用真实模型 CLI 验证 30 个文件及 5 个目录目标在单个 prompt 下的 tool_use 并发与 permission_denials 完整回读表现。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r8-codex.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r3-gemini.md`
- `.reviews/Agent双模式接入真实准入收口/task.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/shape-plan-amendment-proposal.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/shape-boundary-diagnostic.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v2.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v2.mjs`
- `src/trivium/adapters/claude.ts`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/doctor.ts`
- `src/trivium/types.ts`
- `test/unit/claude-directory.test.ts`
- `test/integration/claude-directory-adapter.test.ts`
- `test/integration/claude-structured-probe.test.ts`
- `test/fixtures/claude-deny-paths-replay.json`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `test/unit/agent-access-recovery.test.ts`
- `doc/02_design/README.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":32,"grep":5,"glob":0,"run_command":0,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
