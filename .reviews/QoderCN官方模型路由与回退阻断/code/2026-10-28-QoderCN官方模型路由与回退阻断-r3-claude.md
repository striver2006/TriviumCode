---
schema: trivium.review.v2
topic: QoderCN官方模型路由与回退阻断
stage: code
role: claude
vendor: anthropic
agent_cli: claude/2.1.310
model_requested: opus
model_effective: claude-opus-5-5
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
run_id: 20261028T002149Z
rerun_index: 3
snapshot_hash: sha256:7810c1a4aa6a0c2c2b02d516ea17d02ce7ae57b159244127a7f0359433710e0b
blind: true
started_at: 2026-10-28T00:21:58.738Z
finished_at: 2026-10-28T00:34:16.368Z
duration_s: 120
tool_calls:
  read: 13
  grep: 5
  glob: 2
  run_command: 0
  project_reads: 15
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 2
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: native
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/claude
  launcher_effective: /Users/chenzhenbo/.local/bin/claude
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: claude
    status: unknown
    left_model: null
    right_model: claude-opus-5-5
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: claude-opus-5-5
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / claude
override_reason: 左侧模型信息缺失
session_id: 9e17761d-0045-4120-9f08-e33d6b8dc08c
---

# 代码审查：QoderCN官方模型路由与回退阻断

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261028T002149Z` ｜ 第 3 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

I checked my 4 second-round findings against the repo and all are fixed. CLAUDE-01: qoder-cn now implements normalizeModelForCatalog, so preflight and the direct adapter call use the same case normalization, and a unit test covers it through checkModelSlugs. CLAUDE-02: a failure in the preparation stage now produces a RunResult for a process that never spawned, with execution_failure set to "准备失败" and native_model kept. CLAUDE-03: verifyQoderBinding runs --version inside withQoderHome. CLAUDE-04: the probe checks spawn, timeout, exit and final result before calling finish; the null-request message is now a dedicated wording; resultError is gated by !monitor.failure.
The main path holds. The probe's default comes only from the first init label, cross-checked against the catalog. source=config is produced only for a config value that is in the catalog. NativeModelRequest and NativeModelResult keep request, declaration, envelope labels and billing keys separate, and match the run.v3 schema field by field, including the final value in the stop_observation channel enum. Exit code 0 with a fallback still fails. Before running, the adapter rebuilds the request and deep-compares it to the frozen snapshot.
Two nits remain. On the adapter's pre-execution failure path, execution_failure takes the raw Error.message instead of going through qoderFailureMessage. And one integration test, now that verify also copies credentials, actually exercises the verify failure rather than the invokeQoderModel preparation branch. Neither blocks implementation.

**结论**：通过（`pass`）

## 审查意见（共 2 条：吹毛求疵 2）

### CLAUDE-01 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn.ts:89-101` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：Pre-execution failures in adapter.run (snapshot mismatch, binding drift, or verifyQoderBinding throwing because withQoderHome is missing credentials) go through fail((e as Error).message). invokeQoderModel uses qoderFailureMessage for the same kind of error, which expands AggregateError and calls redactSecrets; this path does neither. When withQoderHome's cleanup also fails, the execution_failure written here is only the generic 'Qoder CN 临时环境清理失败', with the primary cause lost. The ENOENT absolute path also goes in without redaction. That falls short of the r2 commitment that cleanup errors keep their classification detail.

**依据**：In qoder-cn.ts:101, catch(e){return fail((e as Error).message);}. qoder-cn.ts:17-20, qoderFailureMessage expands AggregateError and redacts. qoder-cn-native.ts:80 wraps cleanup failures in AggregateError with the fixed message 'Qoder CN 临时环境清理失败'. qoder-cn-native.ts:86 shows that verifyQoderBinding now also copies credentials via withQoderHome, so a missing credential source is caught here first. r2-response-codex.md, GLM-04 disposition: 安全展开AggregateError子消息.

**建议**：Have the adapter's pre-execution catch reuse qoderFailureMessage too, so both failure paths share one message format and redaction.

### CLAUDE-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/integration/qoder-cn-routing.test.ts:89-93` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：The test '准备阶段认证缺失保留native请求' asserts on adapter.run in its second half. But verifyQoderBinding now runs before invokeQoderModel and also copies credentials, so a missing credential source makes adapter.run return early from the verify catch. The adapter's invokeQoderModel preparation-failure branch ('准备失败' plus unstartedOutcome, with the stdout/stderr/trace files written) is covered only by direct calls; on the adapter path it is reachable only via TOCTOU, for example credentials removed between verify and invoke. The test name and assertions are true but mixed together, and a later reader could assume the adapter path's out_dir artifacts are covered as well.

**依据**：In qoder-cn.ts:100-102, verifyQoderBinding runs before invokeQoderModel. qoder-cn-native.ts:86 shows verify running inside withQoderHome, and qoder-cn-native.ts:61-65 shows that withQoderHome throws when the credential source is missing. Test line 93 only asserts process_started=false, native_model present and raw_exit_code=null; it does not distinguish the source of execution_failure or check whether the trace was written.

**建议**：In the adapter-path assertion, state which branch it is expected to hit, for example by asserting that execution_failure does not contain '准备失败'. Or inject a credential failure after verify to cover the adapter-side preparation branch.

## 认为正确的部分

- The 4 second-round findings are all fixed and verified in the repo. qoder-cn.ts:75 normalizeModelForCatalog returns the catalog's canonical name, and preflight.ts:768 uses it. qoder-cn.ts:42-46 folds a preparation failure into a RunResult for a process that never spawned. qoder-cn-native.ts:86 runs the version check in an isolated HOME. probes/qoder-cn.ts:27-32 checks execution results before calling finish. qoder-cn-model.ts:127 has the dedicated message for the default-probe case. qoder-cn.ts:60 gates resultError with !monitor.failure.
- Request, declaration and readback are kept separate: facts.model (declared default), requested (canonical name), override (raw value, null for probe_default) and origin are each stored. review.ts:1256-1267 sets req.model to nativeModel.requested, and schemas.ts:285 checks that requested_routes.native_model.requested equals model.
- In run.v3.json, the required fields of nativeResult and the stop_observation enum (stdout/stderr/final) match NativeModelResult in types.ts:1041-1046 field by field.
- Exit 0 is still a failure: in completeQoderModelRun, ok requires code===0, no early stop, failure/verification_failure/execution_failure all empty, a result seen, and that result not an error. The adapter writes raw_response_text only when ok is true.
- Early stop for stderr/stdout fallback warnings: the regex accepts the trailing sentence seen on the real device. stop_observation records the channel, after_result and elapsed time. The integration tests cover chunked delivery on both channels, a missing final newline, and the warning arriving after the result.
- For the probe default, only the first init label is taken and cross-checked against the catalog. Only an in-catalog config value is run explicitly with --model to produce source=config, and validateQoderFacts verifies that this declaration matches observed_user_model.
- The report honestly records the first formal verify failure, intermediate failed evidence, and that Windows is untested, and does not claim the process is closed out.

## 未覆盖范围（本侧盲区）

- I did not run any test, build or real-device command; the reachability of the code paths is reasoned from reading the code
- The Kimi-side scripts, evidence and the docs reporting on them (all of kimi-macos-20261028 and scripts/acceptance/kimi-qoder-cn/kimi-*)
- I did not read the full text of the latest real-device evidence adapter-2026-10-28T00-16-37-108Z; the second formal verify run was not checked
- Changes to render.ts and report.ts on how native_model is presented, and the integration with parse.ts and scrub.ts
- The Windows path, and checkQoderBinding hashing the entrypoint file synchronously on every availability call (performance)
- The stopEarly and killTree implementation in util/exec.ts
- Whether the 4130 total tests mentioned in the report have been run again

## 实际查阅的项目文件

- `.reviews/QoderCN官方模型路由与回退阻断/code/2026-10-28-QoderCN官方模型路由与回退阻断-r2-claude.md`
- `.reviews/QoderCN官方模型路由与回退阻断/code/2026-10-28-QoderCN官方模型路由与回退阻断-r2-response-codex.md`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/review.ts`
- `src/trivium/schemas.ts`
- `src/trivium/preflight.ts`
- `src/trivium/types.ts`
- `skills/dual-critic/schema/run.v3.json`
- `test/integration/qoder-cn-routing.test.ts`
- `test/unit/qoder-cn-model.test.ts`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":13,"grep":5,"glob":2,"run_command":0,"project_reads":15}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
