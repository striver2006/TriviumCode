---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
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
run_id: 20261028T043435Z
rerun_index: 3
snapshot_hash: sha256:68596d43252d34f88e6b28a78d2745f91fa202de70b1441a092f410a22d0cb95
blind: true
started_at: 2026-10-28T04:34:43.165Z
finished_at: 2026-10-28T04:43:52.473Z
duration_s: 154
tool_calls:
  read: 9
  grep: 8
  glob: 1
  run_command: 0
  project_reads: 11
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 2
  minor: 2
  nit: 1
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
session_id: c854eb1a-cff6-4fd0-a34b-1aed46093b80
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261028T043435Z` ｜ 第 3 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

The most serious remaining problem is in the path rules. Every deny/allow rule in qoder-readonly.mjs is built from the unresolved os.tmpdir() path (/var/folders/...), but the 04:31 raw init shows the native side canonicalises cwd to /private/var/.... Rules and real paths are not in the same namespace. This plausibly explains why the open arm's exact-path Write allow failed to match, and it leaves the private-HOME / peer / sensitive-path denies with an untested bypass in the /private form.
Second, rejectionChannel in qoder-index.mjs relies only on non_execution_kind. The native side also marks the dont_ask "needs approval" mode denial as permission-rule (decision_reason_type=mode), so the 04:33 index counts the open-arm Write as a paired_permission_rule. That conflates mode denial with explicit deny-rule proof, which is exactly the distinction the report insists on.
Last round's blocker (env overlay) is fixed. qoderChildEnv now sets every parent key to undefined first and then allowlists, which matches exec.ts run's delete semantics. A real-run child-process regression with an unknown canary, NODE_OPTIONS and others was added, and the vendor env-canary arm observed ENV_CANARY__.
Remaining items: the deny-visible arm uses blanket Write/Bash denies, so by construction it can never observe a permissions-rule rejection of a visible tool. Some sentences in the report are stale. The deletion patch is a key snapshot taken at withQoderHome time, not at spawn time.
Production admission stays closed, and the admission=false / exit-0-fallback-as-failure bookkeeping is honest. These changes fix the diagnostic tooling and its wording; no further review round is needed.

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 5 条：重要 2 ｜ 次要 2 ｜ 吹毛求疵 1）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs:15,43-58; src/trivium/util/fsx.ts:214-215` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：Both the script's temp root (fs.mkdtemp(os.tmpdir())) and the production makeTempDir use the unresolved /var/folders/... path. All permissions rules are built by string concatenation on that path: the Read/Grep/Glob denies for peer, secret and home/**, homeDeny, and the open arm's Write(//…/write-canary.txt) allow. The native side canonicalises cwd to /private/var/folders/.... Because rule paths and canonical paths live in two namespaces: (1) the exact-path Write allow plausibly fails to match after canonicalisation, which would explain the 04:31 'needs approval' result; (2) if the model accesses the private HOME, peer or .env through the /private/... path advertised in init, it is unknown whether the deny rules still hit. The two Read path rejections so far only cover inputs in the /var/... form. The path-isolation evidence therefore has an untested bypass surface. (2) is an inference from reading code and evidence, not a verified fact.

**依据**：In readonly-2026-10-28T04-31-58-012Z-0a893e.json, the init cwd for all five arms is /private/var/folders/b_/…/trivium-cn-readonly-58moyQ/<arm>. In index-2026-10-28T04-33-00-586Z-104b6c.json, the open-arm Write input file_path is /var/folders/…/58moyQ/open/write-canary.txt and its tool_result is 'This action needs approval'. In qoder-readonly.mjs lines 54-57 the rules are concatenated from the unresolved cwd/home. fsx.ts makeTempDir does not call realpath. qoder-cn-native.ts stopQoderHomeHelpers already normalises /private/ separately, which shows the project knows about this symlink.

**建议**：Build rules after fs.realpath on temp/cwd/home, or emit deny rules for both path forms. Add a /private-form Read bypass case to the paths arm. In the report, record the Write allow mismatch as a 'path canonicalisation mismatch to be ruled out' rather than inferring that native ignores the exact allow.

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-evidence.mjs:12-19; scripts/acceptance/kimi-qoder-cn/qoder-index.mjs:19-24` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：rejectionChannel returns 'permission-rule' whenever tool_result_meta.non_execution_kind==='permission-rule'. In 1.1.80, however, the dont_ask approval denial also carries that tag; the real distinction is in the decision_reason_type (mode/rule) of a separate type=system event, and the index does not parse that event. As a result, the index's paired_permission_rules includes the open-arm Write mode denial. Any later admission ledger that consumes the index would count 'mode refused to ask for approval' as 'permissions rule blocked it'. This is the report's own explicitly stated boundary, and the tool does not carry it.

**依据**：In index-2026-10-28T04-33-00-586Z-104b6c.json around lines 2229-2233 and 2286-2287, call_48369e751d20484d9e81c8cf has error_text 'This action needs approval, and the "Don't ask" permission mode does not prompt' with channel:'permission-rule', and is listed in paired_permission_rules. In the raw readonly-…04-31-58 file, the open arm's decision_reason_type is mode and the paths arm's is rule. The qoder-secrets.test.mjs fixtures cover only non_execution_kind and not a mode-type denial.

**建议**：Parse type=system/decision_reason_type in the index and join it by tool_use_id. Add a separate permission-mode channel and count only decision_reason_type=rule as permission-rule. Add a regression for a mode denial carrying the permission-rule tag, and annotate the misclassification in the existing index.

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs:53,58,72; scripts/acceptance/kimi-qoder-cn/README.md (deny-visible 段)` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：The stated purpose of the deny-visible arm is 'tools visible, verify a real permissions-rule rejection'. Its settings, however, are the same as the readonly arm: the denies array contains blanket 'Write'/'Bash'. The report has already observed that the native side prunes tools from init under a blanket deny, so by construction this arm can only reproduce the tool-unavailable channel. It can never produce the permissions-rule evidence the report names as the main remaining gap. The README discloses that visibility is not guaranteed, but the expected text at line 72 still describes it as 'tools visible'.

**依据**：In qoder-readonly.mjs line 53, denies starts with 'Write','Edit','Bash', and line 58 gives every non-open/env-canary arm deny:denies. In index-04-33, the deny-visible init tools are only Glob/Grep/Read. Report lines 51 and 73 state that the permissions-rule evidence is still missing.

**建议**：Use path- or command-scoped denies for this arm, for example deny only Write on the canary path and Bash(echo SHELL_CONTROL*), so the tools stay registered and the rule is hit. Alternatively, change the arm's expected text to 'experiment on pruning behaviour'.

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:39,47,96` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：Several sentences in the report contradict the latest state. Line 96 says 'the real vendor parent-env canary is still untested', while lines 11 and 82 say the env-canary arm was collected and passed. Line 39 calls 02-43-17 the 'latest Custom raw file', but 04-10 and 04-30 batches exist and line 11 cites the 04-30 one. Line 47 still calls the 02-44 batch 'using the new production env policy' with no correction marker on that line; it depends on the general correction on line 7, which readers can easily miss.

**依据**：Lines 11, 39, 47, 82 and 96 of the report. The evidence directory contains custom-2026-10-28T04-30-46-046Z-cbceeb.json.

**建议**：Change line 96 to a dated historical sentence or delete it. Point 'latest' on line 39 at 04-30. Add a short inline note to the batch description on line 47: 'env overlay, not counted as isolation evidence'.

### CLAUDE-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-native.ts:52-54,88; src/trivium/util/exec.ts:527-531` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：The deletion patch takes a key snapshot of process.env when withQoderHome builds the env, but run() re-spreads process.env at every spawn. Any key added to process.env during fn (for example the multiple run calls in verifyQoderBinding or the collectors) is not deleted. In the current call chain the window is narrow, but the allowlist semantics depend on 'nobody changes process.env meanwhile'. The comment does not state that premise.

**依据**：qoder-cn-native.ts line 54 is Object.keys(parent).map(...undefined), and line 88 builds the env once before fn. exec.ts line 527 has childEnv={...process.env} at each call.

**建议**：Either give run an explicit replace-env option so the allowlist is computed at spawn time, or state this precondition in the qoderChildEnv comment.

## 认为正确的部分

- qoderChildEnv now first sets every parent key to undefined and then writes back the allowlisted keys, which matches exec.ts run's 'undefined means delete' semantics. Last round's CLAUDE-01 blocker is fixed without changing the shared executor.
- The new real-run child-process regression in the integration test uses fake auth, a nonexistent NODE_OPTIONS require and an unknown canary, and asserts that all five keys are absent in the child process. That exercises actual spawn-time behaviour, not just the return value.
- The env-canary arm sets the canaries before withQoderHome and restores them afterwards. The recorded tool_result is ENV_CANARY__, so the conclusion is limited to these two keys on the native shell path and is not generalised.
- The report and the index both annotate the old batches' env conditions as invalid without rewriting the raw JSON. Every collector records environment_policy and the source hashes of the two runtime files.
- The secret guard now uses a 16-character length threshold plus a sensitive-key regex and counts skipped metadata as a scan boundary, which addresses last round's CLAUDE-03. compareSnapshots/checkAbsence use three-state results, so only ENOENT counts as deleted.
- The open arm moved from accept_edits with an unbounded Write to dont_ask with an exact-path Write and Edit removed, and the report honestly records that the Write positive control failed in that batch.
- The Custom collector re-encrypts only the single selected record, checks the parameter shape strictly, does not echo errors from the prepare stage, adds all decrypted api_keys to the redaction list, and records the codec as public_api:false.
- admission is always false, the missing-config arm with exit 0 that falls back to Auto is recorded as a failure counterexample, and provider_effective/model_effective stay null. Request, declaration and readback are kept separate.

## 未覆盖范围（本侧盲区）

- I cannot run commands. CLAUDE-01's attribution of the Write allow failure to path canonicalisation, and whether /private-form paths bypass the denies, are inferences from the evidence and code that I have not verified on a real machine.
- I did not read the custom-*.json raw files one by one, the earlier readonly batches, or the full stdout of every case. I spot-checked only the 04:31 readonly file and the 04:33 index.
- I did not review in detail the full contents of the unit tests in test/unit/qoder-cn-model.test.ts or test/unit/qoder-secret-values.test.ts, and I did not confirm that the default npm test glob actually picks up the latter.
- I did not check the r2 plan file item by item, or how the design doc and PROTOCOL relate to the rest of the specification.
- I did not cover the lifecycle (cancel / force-kill / reaping lost processes), Windows behaviour, or the Custom three-tier / worker wiring and the real three-reviewer run. All of these are marked as not delivered in this change.

## 实际查阅的项目文件

- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/util/fsx.ts`
- `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-evidence.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs`
- `test/integration/qoder-cn-routing.test.ts`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-31-58-012Z-0a893e.json`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/index-2026-10-28T04-33-00-586Z-104b6c.json`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":9,"grep":8,"glob":1,"run_command":0,"project_reads":11}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
