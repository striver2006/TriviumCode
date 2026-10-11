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
run_id: 20261011T113848Z
rerun_index: 10
snapshot_hash: sha256:da61128f3b8aea16d116be4f5947294879943c2ba2939c330923a67e0515a495
blind: true
started_at: 2026-10-11T11:38:52.960Z
finished_at: 2026-10-11T11:55:34.696Z
duration_s: 820
tool_calls:
  read: 53
  grep: 9
  glob: 5
  run_command: 0
  project_reads: 38
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
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
session_id: e3f50a96-ebaf-4218-bf03-9e8f98985cc0
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261011T113848Z` ｜ 第 10 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

被审计划整体设计审慎，严格隔离了 Codex/write 合同机制，原判据 SHA 与只读约束完整保留。最危险的问题是计划遗漏了现有单测 test/unit/agent-access-read-evidence.test.ts:96 对 closeout.mjs 中 buildAdmissionPrompt 调用签名的源码匹配断言，实施后将直接导致 npm run check 红测试；此外提示词未固定单一 cat 命令可能导致 parsed_cmd 提取失败，且新增脚本未纳入指纹追踪。需修订计划后方可实施。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 与 test/unit/agent-access-read-evidence.test.ts:96` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：现有单测对 closeout.mjs 的 buildAdmissionPrompt 调用签名存在硬编码源码断言，计划未将其纳入同步改造范围，将导致检查闸门阻断。

**依据**：test/unit/agent-access-read-evidence.test.ts:96 包含对 scripts/agent-access-closeout.mjs 源码的精确正则断言 assert.match(source, /const prompt = buildAdmissionPrompt\(agent, arm, firstWord, targets, fx.root\)/)。计划 §3 明确要在 closeout.mjs 中针对 agent===codex && arm===write 分支向 buildAdmissionPrompt 传入可选的合同参数，但计划 §4 仅列出单测新增和 replay 样本覆盖，遗漏了对该处正则守卫的同步计划。若直接实施，npm run check 将在此处断言失败。

**建议**：在计划 §4 中明确同步更新 test/unit/agent-access-read-evidence.test.ts:96，使正则断言兼容 Codex/write 臂传入的可选合同参数。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：对模型的提示词未将合同读取动作精确锚定为单一 cat 命令，可能引发 parsed_cmd 无法识别及诊断直接失败。

**依据**：在 scripts/agent-access-recipes.mjs 中，针对读取指令明确要求「仅实际执行一次单一读取命令 cat README.md；不要串联ls、echo、管道或回退命令」，以确保 Codex trace 能够稳定提取到 parsed_cmd: read。而在计划 §3 中，给模型的提示仅要求「从实际输出取command/cwd/target后在该cwd逐字执行一次」，因 WRITE_CONTROL.json 为 json 后缀，模型极易调用 python3/jq/node 或使用管道过滤，导致 Codex 记录 parsed_cmd: unknown 并破坏单 cat 与双 ID 配对，白白浪费唯一的首尝试机会。

**建议**：在计划 §3 的提示词规范中明确固定要求「仅实际执行一次单一读取命令 cat WRITE_CONTROL.json」，保持与 productionReadPrompt 的约束一致。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3 与 scripts/agent-access-closeout.mjs:88-92` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：新增治理脚本未规划纳入 closeout.mjs 的 fingerprints().assets 审计追踪。

**依据**：scripts/agent-access-closeout.mjs:88-92 中的 fingerprints().assets 显式采集了参与准入治理的关键脚本（recipes、evidence、closeout 等）的 hash。计划 §3 引入了新增模块 scripts/agent-access-write-contract.mjs，但未规划将其纳入 assets 指纹跟踪，导致运行留痕中的资产指纹未能完整反映准入执行依据。

**建议**：在计划 §3 中明确在 scripts/agent-access-closeout.mjs 的 fingerprints().assets 中登记 scripts/agent-access-write-contract.mjs。

## 认为正确的部分

- 坚持单一来源与未改判据：原 codexCommandEvidence 函数体 SHA 逐字保留，不放宽 write_pass，不把额外诊断当作原写通过或替代标准。
- 变更范围严格隔离：合同机制仅在 scripts/agent-access-write-contract.mjs 中局部实现，仅在 agent === 'codex' && arm === 'write' 分支传递，不影响其余非目标臂，且非目标臂 prompt 逐字保持。
- 真实物理夹具安全防护：合同文件仅在独立创建的临时夹具根目录下写入，采用 O_EXCL 与 0600 权限，拒绝软链与外部全局目录，并置于既有清理链内。
- 止损与首尝试原则：明确仅允许一次首尝试，若模型仍不遵守或拒绝则判定失败并终止该机制，不自动循环换提示词。

## 未覆盖范围（本侧盲区）

- 审查员环境为只读隔离，未执行真实命令或启动子进程验证实际测试运行结果。
- Codex/Qwen 真实模型接收合同后的实际遵从行为（是否产生其他不可预见的工具调用偏离）取决于模型运行时推理，无法通过静态分析保证。
- 外部 CLI 探针版本及真实网络环境不在本次计划审查范围。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r21-codex.md`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-evidence.mjs`
- `src/trivium/probes/codex.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/codex-trace.ts`
- `test/unit/agent-access-read-evidence.test.ts`
- `test/fixtures/agent-access-prompt-replay.json`
- `test/unit/agent-access-closeout.test.ts`
- `test/unit/agent-access-task-launch.test.ts`
- `test/unit/scripts-contract.test.ts`
- `test/contract/claude-admission-schema-source.test.ts`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/codex-qwen-write4-diagnostic.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/matrix-after18.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/review-round19-plan-batch-v2.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v14.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v10.json`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":53,"grep":9,"glob":5,"run_command":0,"project_reads":38}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
