---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: code
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
run_id: 20261011T005041Z
rerun_index: 3
snapshot_hash: sha256:efc302238e66230a5af4f0626730f529904fd33b7379e1fb39dc8394c5e62816
blind: true
started_at: 2026-10-11T00:50:47.324Z
finished_at: 2026-10-11T01:05:33.339Z
duration_s: 426
tool_calls:
  read: 67
  grep: 8
  glob: 2
  run_command: 0
  project_reads: 52
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
session_id: 77550cb6-94ad-4080-90c7-3400436f8369
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261011T005041Z` ｜ 第 3 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本轮聚焦「授权总8轮核验」与「扫描深度整改」，并对真实准入收口及目录拓扑约束进行完整代码重审：
1. 授权总8轮机制完备：formal-round-authorization-v3.json 严格绑定父链哈希与 new_limit: 8，round-guard.mjs 与 formal-start-precheck.mjs 双重卡紧序号与前置事实，杜绝越界调用；
2. 敏感扫描深度整改精确：SENSITIVE_SCAN_MAX_PARENT_DEPTH 导出常量定为 7，彻底修复 5 段 ASCII 根下 2 级后代未枚举缺陷，同时守住深度 8 边界、目录软链不递归及 .git/node_modules 排除语义；
3. 真实准入事实边界严谨：REPORT 及 ADR_003 诚实记录 6 pass / 5 unmeasured / 1 fail，明确 M11 前置未完成；预算无缝割接与目录投影契约健全；
4. 经全量代码、测试与留痕静态核验，未发现阻断性或功能性缺陷，审查结论为 approve。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- 【焦点一：授权总8轮核验】formal-round-authorization-v3.json 完整串联 v2 sha256 形成单向不可篡改授权链，硬顶 8 轮；round-guard.mjs 强制绑定 formal-round-authority.json 指针校验；formal-start-precheck.mjs 深度绑定构建一致性、settings 字节数预算（<=131072）、skipped_count === 0、file_shape_verified 以及真实目录事实消费，闭环前置校验。
- 【焦点二：扫描深度整改】src/trivium/freeze.ts 导出 SENSITIVE_SCAN_MAX_PARENT_DEPTH = 7 常量，精准覆盖 5 段根 + 2 级后代（深度 7）拓扑，补齐了原上限 6 遗漏的 5 个夹具文件；严格保持深度 8 为未覆盖边界；保留 dirent.isDirectory() 语义以避免目录软链或自环下钻递归，同时保留匹配软链项本身入列与 .git/node_modules 排除规则；全仓 4170 个敏感文件枚举哈希完全一致，零生产漂移。
- 【焦点三：目录拓扑约束与消费】probes/claude-directory.ts 与 adapters/claude.ts 强制 CLAUDE_DIRECTORY_SHAPE = 'ascii-root1-5-depth0-2-v2' 契约，限定根 <= 5 段且后代 <= 2 级子目录，全部段名为 ASCII 标识符；未验证工具严格退回逐文件规则；sensitive_globs_hash 变更即自动失效缓存事实；consumeClaudeDirectories 精确在有效声明下才做二进制读取，并实现调用内路径级去重。
- 【焦点四：预算割接与错误通道隔离】预算割接经 cutover-budget.mjs 与 budget-continuity-r12.json 完整迁移至 ~/.trivium/evidence/.../budget，976 个文件 EXCL 排他写入无重算且哈希一致；probeClaude 健全捕获夹具/预算/系统可预期异常，隔离并脱敏错误信息同时清理临时夹具，核心类型错误正常外抛。
- 【焦点五：准入标准诚实报告】REPORT_2026-10-11_agent_access_recovery.md 如实公布 6 成功、5 未测、1 失败的真实评测结果，明确指出当前未满足 M11 第 12 步前置准入，坚决不通过降低准入指标或模拟传输掩盖真实能力边界。

## 未覆盖范围（本侧盲区）

- 本审查员无 Bash 与外部写命令执行权限，未在实际 macOS 终端实际跑动 node 脚本、doctor、真实构建或调用外部云端大模型 CLI 进行实测。
- 未逐一比对 doc/05_testing/evidence/ 下全部历史 JSON 留痕镜像的全部原始字段值，仅核对了哈希指纹、核心字段与断言结果。
- 未对外部厂商 API 端点与本地网络之间的连通性及鉴权状态做实时探测。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/code/2026-10-10-Agent双模式接入真实准入收口-gemini.md`
- `.reviews/Agent双模式接入真实准入收口/code/2026-10-11-Agent双模式接入真实准入收口-r2-gemini.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r12-codex.md`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v3.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v4.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-selection.mjs`
- `skills/dual-critic/schema/review.v1.json`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/doctor.ts`
- `src/trivium/freeze.ts`
- `src/trivium/parse.ts`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/report.ts`
- `src/trivium/types.ts`
- `test/integration/claude-directory-adapter.test.ts`
- `test/integration/claude-structured-probe.test.ts`
- `test/unit/agent-access-closeout.test.ts`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/claude-directory.test.ts`
- `test/unit/freeze-drift.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":67,"grep":8,"glob":2,"run_command":0,"project_reads":52}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
