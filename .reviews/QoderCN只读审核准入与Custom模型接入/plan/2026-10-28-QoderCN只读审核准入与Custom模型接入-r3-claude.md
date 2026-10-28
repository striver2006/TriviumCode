---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
stage: plan
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
run_id: 20261028T090050Z
rerun_index: 3
snapshot_hash: sha256:2305a6fa60c077dd3ade2747ea934e5ec8e072f8737e3d0f632ff5f7327133af
blind: true
started_at: 2026-10-28T09:00:58.435Z
finished_at: 2026-10-28T09:13:08.369Z
duration_s: 207
tool_calls:
  read: 7
  grep: 9
  glob: 4
  run_command: 0
  project_reads: 8
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 4
  minor: 4
  nit: 0
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
session_id: e76def43-d078-497b-b5e0-53a016bd8f7d
---

# 计划审查：QoderCN只读审核准入与Custom模型接入

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261028T090050Z` ｜ 第 3 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

Most dangerous: even if all 30 checks pass, the end goal in §6, a real three-review in the isolated project, would most likely be refused by the existing coverage check. verifyAdmissionRecord requires every requested deny_path to be in the ledger's coverage by exact path match (admission.ts:54-55). But enumerateDenyPaths always adds .trivium and the absolute global ~/.trivium/runs to a real review's deny set (freeze.ts:413-414), and peer artifact file names grow with each round. The coverage in §2 is limited to project-relative fake fixtures, so it cannot cover these entries. Coverage semantics is an admission contract decision and should be settled before implementation.
Second: several required checks are structurally unreachable under the plan's own constraints, and the plan makes no decision about them in advance.
- The minimal recipe removes Write/Edit/Bash from the tool surface, and earlier evidence shows the model does not call tools it is not offered. Separately, the wording "未暴露不计" conflicts with the code's acceptance of tool-unavailable.
- network-denied requires WebSearch coverage, but the plan only allows loopback network controls.
- Excluding config layers, skills, hooks and plugins produces no native event, and the plan names no acceptable alternative evidence such as a paired effective-config readback.
These decisions change the evidence contract, so the plan should be reviewed again after revision.

**结论**：不通过（`reject`）

## 审查意见（共 8 条：重要 4 ｜ 次要 4）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2「禁读覆盖使用非空…隔离验收项目相对路径：同行假工件、敏感假 canary、私有凭据假 canary、待新增工件路径及目录」与 §6「在隔离验收项目验证 Qoder 加两家已准入审核者的真实三审」` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：Admission coverage and the deny set of a real review are two different things, and they are compared by exact path match. When the worker consumes the ledger, every requested deny_path must appear exactly in record.deny_paths, both as a literal path and as its resolved target, or the request is rejected with 'exceeds verified coverage'. A real review's deny set always contains: (1) .trivium; (2) the absolute global run_root, ~/.trivium/runs; (3) the peer artifacts for that round, enumerated file by file, so the file names (-rN-<agent>.md, _meta/review-<agent>-<runId>.json) differ every round; (4) sensitive_globs hits. §2 limits coverage to project-relative fake fixtures, and also forbids using real user paths as positive-control targets. So (1) and (2) are never covered, and (3) cannot match round names that do not exist yet. In the likely outcome, the real three-review in §6 is refused at the coverage check even if all 30 checks pass, and the plan offers no response to that.

**依据**：src/trivium/admission.ts:54-55: covered=new Set(record.deny_paths.map(path.resolve)); any req.deny_path not in the set → throw '本次禁读矩阵超出准入已验覆盖'. src/trivium/freeze.ts:383-393 adds peer artifacts and _meta files one by one; :413-414 out.add('.trivium'); out.add(expandHome(cfg.runtime.run_root)); :433 sensitive files. src/trivium/adapters/qoder-cn-admission.ts:40 evidence must be bound to the current project_root.

**建议**：Decide in §2/§6 how coverage relates to the deny set of a real review. Either (a) define the coverage unit as a directory or prefix plus a class (peer artifact directory, orchestrator directory, run_root, sensitive glob), revise the admission.ts matching contract accordingly and add a reverse test; or (b) have the isolated acceptance project use a disposable run_root, and have the fixture pre-create the exact deny set enumerateDenyPaths will produce for that real three-review round. In either case, name explicitly how .trivium and the absolute run_root are covered, and add an end-to-end regression where the coverage check runs against the real enumerateDenyPaths output.

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3「候选臂…仅更换为当前最小审核配置，要求真实工具调用/同 ID 失败与原生拒绝事件」及「不得通过扩大候选工具面…制造绿色候选」` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：The minimal review recipe removes Write/Edit/Bash from the tool surface with --tools Read,Grep,Glob, and the verifier requires the candidate arm's init.tools to equal exactly the three reading tools. Rejection evidence can therefore only come from the model calling a tool it was never offered and receiving a dispatch-level 'Tool not found'. The latest evidence already shows the model made no dangerous tool calls in the minimal arm. The plan also forbids changing the prompt to induce calls and forbids widening the tool surface. Taken together, the 12-call / 36-minute stage 1 is very likely to end in the stop condition, and the experiment design itself does not answer the core question: does removing a tool from the surface count as an execution-layer constraint, and if so, what observable evidence is acceptable? This is direction-level. If the decision is left open, the result can only ever be 'blocked'.

**依据**：src/trivium/probes/qoder-cn.ts:17-19 QODER_REVIEW_ARGS sets --tools to QODER_READING_TOOLS and adds --permission-mode dont_ask. src/trivium/adapters/qoder-cn-admission.ts:70 the candidate arm's init.tools must equal the reading tools exactly, otherwise '拒绝臂不是最小审核工具面'. doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:132 'the minimal review arm's init has only Glob/Grep/Read… the model made no dangerous tool calls, so native dispatch rejection is missing'. :51 the deny-visible arm only produced Tool not found after the model actually called a tool. :131 the scoped configuration that keeps Write produced a rule rejection but is not the production minimal surface.

**建议**：Decide before stage 1 which of these applies: (a) accept 'tool removed from the surface + a real call + a dispatch-level Tool not found' as evidence for the corresponding check, and define a legitimate fixed prompt to elicit the call (written into the recipe and frozen in advance, not changed per attempt); or (b) state that removal is the production constraint but is not observable, and escalate to Bob immediately for a decision instead of spending 12 calls re-confirming a known outcome. Whichever is chosen, state the expected outcome and the criterion for stopping.

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3「网络仅 loopback 无敏感数据」与 network-denied 必需项` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：The verifier requires the network-denied check to cover both WebFetch and WebSearch, each with a successful positive arm and a rejection arm. WebSearch is a search service hosted by the vendor, so its positive control cannot be confined to loopback. Under the plan's constraint, network-denied can never be satisfied. A required check made unreachable by construction is different from 'could not be triggered', and this is not decided in advance.

**依据**：src/trivium/adapters/qoder-cn-admission.ts:13 'network-denied':['WebFetch','WebSearch']; :25 every listed tool must be covered. src/trivium/agents/registry.ts:423 network-denied is among the required admissionChecks. REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:132 WebSearch has already succeeded in the open arm (not over loopback).

**建议**：Decide in §3 whether WebSearch's positive control may use a fixed, non-sensitive public query, with the leak boundary recorded. Otherwise mark that check as a constraint-induced block that is planned for and reported to Bob. Do not let the run discover it during execution.

### CLAUDE-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4「配置叠加逐项用真实生效正控制验证…审核臂只未触发不可通过。先取得原生实际排除/拒绝格式，再实现验证器消费」` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：The review recipe excludes the project layer with --setting-sources user. The mechanism is not loading the layer, which by nature produces no native 'exclusion' or 'rejection' event. The evidence already shows the user-source review arm did not trigger the hook and had no exclusion event. The plan makes 'obtain the native exclusion format first' a precondition and also forbids 'not triggered' as evidence. The four checks config-layers, shared-skills, hooks and plugins therefore have no reachable evidence form. The task actually asks to 'verify the effective tool list and configuration layering'. A paired readback of the effective configuration (positive init or effective-source lists show the item loaded; with the same fixture, the candidate's lists show it absent) is a legitimate candidate evidence form, and the plan neither considers nor rejects it.

**依据**：src/trivium/probes/qoder-cn.ts:15 '--setting-sources','user'. src/trivium/adapters/qoder-cn-admission.ts:90-91 these checks always return blocked. REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:132 'the user-source review arm did not trigger the hook, but there is no execution-layer exclusion/rejection event, still blocked'.

**建议**：Decide in §4 whether paired effective-config readback (the init or a native diagnostic command lists loaded skills, plugins and hook sources, compared between the positive and candidate arms) is accepted as evidence for these checks, and specify its binding fields and the forbidden substitutes (silence and absence of side effects still do not count). If no such readback exists, state these checks as a planned block.

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3「工具未暴露或模型不调用单列，不能用它们证明拒绝」 vs 同节「只有真实可配对的规则或分发拒绝才可成为对应执行层证据」` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：Read literally, 'a tool not exposed cannot prove rejection' rules out every candidate-arm rejection for a removed tool, because the candidate arm's Write/Edit/Bash are by definition not exposed. The same section and the verifier, however, accept a 'dispatch rejection' (tool-unavailable). The absolute wording has an exception that is not written down, and the implementer or a reviewer may read the plan as conflicting with qoder-cn-admission.ts:77.

**依据**：src/trivium/adapters/qoder-cn-admission.ts:77 accepts channel ∈ {permission-rule, tool-unavailable}. src/trivium/adapters/qoder-cn-trace.ts:68 tool-unavailable is classified only when a real tool_use exists and its result is 'Error: Tool "X" not found'.

**建议**：Narrow the wording to: 'absence from init with no call, or the model not calling the tool, does not count; a real call to a removed tool that receives a dispatch-level Tool not found with the same ID counts as tool-unavailable dispatch rejection.' Sync this definition to the design and protocol text.

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3「先由实际 init.tools 清单确定其它工具」「Agent/Task」` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：Execution-tool names now have three representations. The plan says they are derived from the actual init.tools. The trace module lists both Agent and Task. The verifier hard-codes 'agent-denied':['Agent'], and other-execution-denied requires all six of Write/Edit/Bash/Agent/WebFetch/WebSearch to appear in the positive init. If the real list uses Task, or lacks one of these names, the verifier fails even when the experiments are complete. If the plan updates only one of these places, the others become inaccurate.

**依据**：src/trivium/adapters/qoder-cn-trace.ts:8 QODER_EXECUTION_TOOLS includes both Agent and Task. src/trivium/adapters/qoder-cn-admission.ts:13 'agent-denied':['Agent']; :30 the six names are required to be present.

**建议**：State in §3/§5 that the observed init.tools is the single source. Either derive the verifier's required-tool mapping from the recorded list, bound to the evidence, or reconcile the hard-coded names against observation and add a test. Unify the trace constants on the same source.

### CLAUDE-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3「每实际入口同样最多两臂各 2 次/180 秒，按实际清单一次覆盖后停止」` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | medium |

**问题**：Stage 1 has an explicit total cap (12 calls / 36 minutes), but stage 2 only has a per-entry cap. The default tools number 31 and include Cron, Goal, Worktree, Skill, Workflow, image and video tools. other-execution-denied requires every remaining tool to be covered, which is about 25 entries × 4 calls, around 100 model calls with no total time cap. Several of these entries (scheduled tasks, worktrees, media generation) have no clearly harmless positive control.

**依据**：REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:132 'the default tools actually number 31, including Cron, Goal, Worktree, Skill, Workflow, image/video and other extra entries'. src/trivium/adapters/qoder-cn-admission.ts:27-30 every remaining tool must have a proof.

**建议**：Add a total call and time cap for stage 2. Also decide in advance which entries have no harmless positive control and are recorded as blocked directly, so model calls are not spent trying to build controls for them.

### CLAUDE-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3 停止条件「停止扩展执行入口，转为阻塞报告及可独立完成的安全验证」与 §4 路径/生命周期矩阵` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | medium |

**问题**：Once stage 1 has no real rejection, full admission is already unreachable. The plan does not say whether the §4 Read/Grep/Glob path-variant matrix, which is several dozen model calls, and the native lifecycle scenarios still run, nor which of them count as 'safety verification that can be completed independently'. That leaves room for continued native model calls with no admission value.

**依据**：src/trivium/admission.ts:60-62 any single required check that fails rejects the whole admission. The plan's own §3 and §4 both describe an upper limit of 2 attempts × 180 s per variant.

**建议**：In the stop condition, list which §4 items still run and why (for example, lifecycle and credential cleanup because they are a safety regression in themselves). Items whose only purpose is admission are suspended.

## 认为正确的部分

- Restating the current state honestly: at 08:05 only 4/30 checks passed, deny_paths=[], there is no ledger and the three production switches are false. This is consistent with REPORT lines 155 and 166.
- Stage 1's budget of 3 tools × 2 arms × 2 attempts = 12 calls / 36 minutes is internally consistent, and the rule that a second attempt only corrects an explicit argument error while keeping the original is sound.
- The candidate arm uses facts.review_invocation_args and prepareQoderReadonly unchanged, and a positive control is never treated as a review recipe. This matches the qoder-cn.ts:38 / admission.ts:23 binding.
- Keeping permission-rule, permission-mode, tool-unavailable and unknown separate, and not counting mode or an unchanged file as rejection, matches the qoder-cn-trace.ts:65-69 classification.
- Runtime fallback only counts after a valid init, and a fallback for missing configuration stays configuration-invalid. This matches qoder-cn-admission.ts:57.
- The ledger is generated only after every check passes, driver/default stay closed, and verify is not treated as admission.
- Evidence is project-bound to the isolated acceptance project, and the plan explicitly says passing in the isolated project does not authorize production in this repo. This matches qoder-cn-admission.ts:40 and admission.ts:40.

## 未覆盖范围（本侧盲区）

- I ran no commands. Whether Qoder can be induced to call a removed tool, and whether WebSearch exposes a search target that can be confined, are inferences from code and the report.
- I did not read the real-call side of prepareQoderReadonly, credential-lease.ts or the scrub/lease reclamation code, so §4's lifecycle safety details were not checked line by line.
- I did not read the scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs generator or the evidence JSON originals, and did not verify the 31-tool list item by item.
- I did not check the copies of the native_model and deny-coverage wording in the design document, the protocol, the core SKILL or AGENTS.md.
- I did not verify Windows behaviour.

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-claude.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/2026-10-28-QoderCN只读审核准入与Custom模型接入-r4-response-codex.md`
- `src/trivium/adapters/qoder-cn-admission.ts`
- `src/trivium/adapters/qoder-cn-trace.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/admission.ts`
- `src/trivium/freeze.ts`
- `src/trivium/agents/registry.ts`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `package.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":7,"grep":9,"glob":4,"run_command":0,"project_reads":8}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
