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
run_id: 20261028T063910Z
rerun_index: 4
snapshot_hash: sha256:8963a8ea81e49a2aacb42a01fca62341b1f5cbfb62bc301a92d996e40e45872f
blind: true
started_at: 2026-10-28T06:39:20.983Z
finished_at: 2026-10-28T06:56:23.085Z
duration_s: 255
tool_calls:
  read: 14
  grep: 10
  glob: 1
  run_command: 0
  project_reads: 19
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 2
  minor: 4
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
session_id: 9b167e29-aee5-42e4-b6bc-b892b3f58fad
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261028T063910Z` ｜ 第 4 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

The most serious problem is the real three-reviewer wiring. The production adapter runs the reviewer with facts.invocation_args, which is QODER_MODEL_ARGS from the no-tool model probe (it includes --tools '' and has no --permission-mode dont_ask). admissionRouteBinding hashes those same args. Three things follow. (1) Even if admitted, the Qoder reviewer would have no Read/Grep/Glob, so min_tool_calls is bound to fail. (2) The tool checks in the verifier require the denial arm's init tool surface to be exactly Read/Grep/Glob, but any evidence that carries this binding comes from a no-tool invocation, so there is structurally no route to admission. (3) The 4/30 model controls are counted against a "reviewer" binding that is not actually a review recipe. The report itself says this is "a no-tool callable route, not a review recipe", but the code makes it the production review recipe.
Second: credential leases created outside the lease scope (doctor/probe/verifyQoderBinding/lifecycle) get side_dir=null, and nothing reaps them. If those processes are force-killed, the private auth copy is left behind for good, which contradicts the design's claim that lost leases are reclaimed during the retention period.
The other items are minor: the isolation recipe fingerprint is partly a hand-maintained version label; binding on auth bytes means a token refresh invalidates the entire 30-check ledger; the probe does not pin the CLI bytes; Custom selection is case-insensitive; and several documents still say replace-mode env is unimplemented.
The admission ledger's frozen-record handoff, the verifier's fail-closed behaviour, the codec child sealed protocol, envMode=replace, the separation of request/declaration/readback, and treating exit-0 fallback as failure are all implemented consistently, and the production switches remain false.

**结论**：不通过（`reject`）

## 审查意见（共 7 条：重要 2 ｜ 次要 4 ｜ 吹毛求疵 1）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn.ts:57-58; src/trivium/probes/qoder-cn.ts:13,51,81; src/trivium/admission.ts:19-24; src/trivium/adapters/qoder-cn-admission.ts:69,78` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：The production reviewer invocation reuses the no-tool model-probe recipe. invokeQoderModel passes facts.invocation_args unchanged, and both the probe and the Custom probe set it to QODER_MODEL_ARGS, which contains '--tools','' and no --permission-mode dont_ask. As a result: (a) even after admission, the Qoder reviewer has no Read/Grep/Glob, cannot read the project, and will inevitably fail min_tool_calls/min_project_reads, so the real three-reviewer run cannot succeed; (b) admissionRouteBinding hashes this invocation_args, while the tool checks and the trace check in qoderAdmissionVerifier require the denial/trace arm's init tool surface to be exactly Read/Grep/Glob. Evidence produced by a real run under this binding can never satisfy that, so admission has no achievable path. Evidence from other arguments (such as qoder-readonly.mjs with dont_ask plus --tools Read,Grep,Glob) would only pass if it were stamped with this binding, which would mean the evidence and the production invocation do not match; (c) the evaluation's 4/30 model-control passes are attributed to a 'reviewer combination' binding that is not actually a review recipe. The design §3.5 / 2026-10-28 section says 'the minimal review recipe is only Read/Grep/Glob', and README/BACKLOG describe the production loader as wired, but the code has no review recipe.

**依据**：probes/qoder-cn.ts:13 QODER_MODEL_ARGS contains '--tools',''. Lines 51 and 81 write invocation_args:[...QODER_MODEL_ARGS]. qoder-cn.ts:57 is run(executable,['--config-dir',config,...facts.invocation_args,'--model',...,'-p']), with no later override of --tools anywhere. admission.ts:23 includes invocation_args in the binding. qoder-cn-admission.ts:69 requires at.init.tools to be exactly QODER_READING_TOOLS. qoder-readonly.mjs:74 is the only place that uses '--permission-mode','dont_ask','--tools','Read,Grep,Glob'. REPORT line 130 says 'this is a no-tool callable route, not a review recipe', and line 134 says 4/30 model controls passed.

**建议**：Split the 'route callability recipe' from the 'review execution recipe'. The review recipe should explicitly use Read/Grep/Glob plus the tested permission mode, and be produced in one place in the adapter (or as a separate field in the facts). The admission binding should hash the review recipe actually used in production. The model controls should either be re-collected under the review recipe, or the documentation should state explicitly that they cannot be reused across recipes. Add a regression asserting that the args the adapter actually spawns with equal the args hashed into the binding.

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/util/credential-lease.ts:31,71; src/trivium/adapters/qoder-cn.ts:101,122; src/trivium/probes/qoder-cn.ts:22,59; src/trivium/adapters/qoder-cn-native.ts:125,159` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：side_dir comes from the AsyncLocalStorage scope. Only adapter.run enters withCredentialLeaseScope. withQoderHome calls from doctor/probeQoderCn/probeQoderCustom, from verifyQoderBinding outside the worker, and from qoder-lifecycle.mjs (explicitly null) all register leases with side_dir=null. reapCredentialLeases filters on l.side_dir!==sideDir, and its only caller is scrubRunDir, which passes a concrete sideDir. Nothing reaps with null. If a doctor/probe process is SIGKILLed or crashes before finally, its private HOME (including the copied .auth/user and machine_id) and the lease record stay behind permanently. The design §5.3 and PROTOCOL claim that 'normal, cancelled, lost and retention-period cleanup all reuse the scrub entry point', which this path does not honour.

**依据**：credential-lease.ts:31 sets side_dir:scope.getStore()?.sideDir??null, and line 71 skips any lease whose side_dir differs. A Grep over src/test/scripts for reapCredentialLeases finds only the call at qoder-cn.ts:101 (from scrubRunDir(sideDir)) and the test. withCredentialLeaseScope appears only at qoder-cn.ts:122 and as null in qoder-lifecycle.mjs:18. probes/qoder-cn.ts:22 and 59 call withQoderHome directly, which copies auth by default.

**建议**：Give doctor/probe/lifecycle and similar non-side callers a defined reaping entry point, for example an owner-dead reap pass over side_dir=null records at the start of doctor/retention. The existing owner-identity / process-group / private-marker checks stay unchanged. Add an integration regression for a force-killed probe.

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-custom.ts:13; src/trivium/adapters/qoder-cn-native.ts:101-115` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：The design says 'the env/file allowlist, tool/deny policy and permission bits form a deterministic recipe fingerprint'. In qoderIsolationHash, however, the readonly part is the literal label version:'project-read-deny-native-roots-v1'. Neither the env allowlist built by qoderChildEnv nor the rule generation in prepareQoderReadonly (path forms, /var alias expansion, allow/deny shapes) is part of the hash. If someone changes either function without manually bumping the label, recipe_sha256 and the admission binding stay the same, and old evidence keeps admitting a recipe that is now different.

**依据**：qoder-cn-custom.ts:13: only QODER_READING_TOOLS/QODER_EXECUTION_TOOLS, a few constant strings and the CODEC_CHILD hash enter the hash. The deny/allow string concatenation in qoder-cn-native.ts:101-115 and the allowlist keys at 84-93 are not referenced.

**建议**：Derive the readonly-settings template (with placeholder paths) and the env-allowlist key list as data and include them in the hash, or at minimum add a contract test that pins the current template, so any change fails CI and forces a label bump.

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/admission.ts:22; src/trivium/adapters/qoder-cn-native.ts:63-73,176; src/trivium/probes/qoder-cn.ts:48` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | low |

**问题**：The admission binding includes the whole route_descriptor (authentication_sha256 = hash of the .auth/user and machine_id bytes, and credential_source_sha256 = hash of the whole customs file). The official v2 configuration_sha256 also includes the auth hash. Any token refresh written to .auth/user, or adding or changing an unrelated Custom model in the account, therefore changes the binding and invalidates the entire 30-check real-acceptance ledger. Re-probing is cheap, but repeating 30 real checks is expensive. This is reasonable as 're-probe on source drift', but whether that drift should also force re-admission is not discussed in the design, and the auth refresh frequency has not been measured.

**依据**：admission.ts:22 puts route_descriptor:f.route_descriptor into the binding hash. probes/qoder-cn.ts:48 and qoder-cn-custom.ts:132 write authentication/credential_source into the descriptor. qoder-cn-native.ts:72 also includes the auth hash in qoderOfficialBinding. GUIDE P-34-era records already note that credential-cache timestamp changes cause hash mismatches.

**建议**：Record and measure how often .auth/user changes. If it changes frequently, keep the auth/source hashes as a re-probe gate on the route facts, and exclude them from the admission binding (or keep only the semantic declaration hash there).

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/qoder-cn.ts:25-33,50,58,62-69,81` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：The adapter checks the hash and pins a private copy of the CLI before spawning ('CLI bytes are checked before model spawn and a private copy is pinned'). The probe instead executes the user-side entrypoint directly. Codec extraction (loadQoderCustom reading entry), --version/--list-models/the positive control, and the final cli_sha256 computation (reading entry again at the end) are three separate reads. If the CLI updates itself mid-probe, the facts record the hash of bytes that differ from the ones actually verified.

**依据**：probes/qoder-cn.ts:69 is run(entry,...) and line 81 computes cli_sha256 from qoderHash(await fs.readFile(entry)) at the end. qoder-cn.ts:45-48 hashes, pins the copy and only then executes.

**建议**：In the probe, read and hash entry once, copy it into the private HOME, and use that same copy for codec extraction and every run, the same way the adapter does.

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/03_api/PROTOCOL_dual_critic_relay.md (2026-10-28 section 3); doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md (§ round-2 addendum of the valid code review); doc/08_project/BACKLOG.md:9; doc/08_project/现存Bug与未完成工作清单.md:11` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：Several documents contradict the current code. The PROTOCOL says 'replace-mode environment entry point not implemented yet', and the design's round-2 addendum says 'replace-mode env not implemented, no claim of isolation for keys added concurrently'. In fact exec.ts already has envMode:'replace' and qoderRun forces it. BACKLOG's second paragraph ('the continuation run has completed the fixed three-way review and verify; Write is still a mode approval denial') comes after the first paragraph ('continuation-batch three-way review/verify still pending') with no date, which reads as if the current batch has been verified. It also conflicts with the 05:55 Write permission-rule denial confirmed in README and in the qoder-cn-trace test.

**依据**：exec.ts:529 is opts.envMode==='replace'?{}:{...process.env}. qoder-cn-native.ts:76-79 forces replace. The PROTOCOL/design addendum text appears in this diff. The qoder-cn-trace.test.ts 05:55 replay asserts that both Write and Bash are permission-rule.

**建议**：Mark the historical paragraphs with their dates ('04:4x batch'), change the replace-env sentences to 'implemented in the continuation batch', and order the BACKLOG and Bug list entries newest first.

### CLAUDE-07 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-model.ts:20` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：Custom selection compares selector.toLowerCase(), so custom:PROVIDER/exact matches custom:provider/Exact. The design and PROTOCOL say 'Custom /provider/modelID must match uniquely and exactly'. This is case-insensitive unique matching, not exact matching, and the native --model is case-sensitive.

**依据**：qoder-cn-model.ts:20 is f.route_descriptor?.selector.toLowerCase()===selector.toLowerCase().

**建议**：Either make the comparison exact, or update the design wording to 'case-insensitive unique match normalised to the declared form' and add a test.

## 认为正确的部分

- admission.ts requireAdmission/verifyAdmissionRecord share one verifier, filter candidates on the triple of project/binding/agent and require exactly one, reject rather than reselect when the frozen reference changes, and check evidence paths for relative/no-.., realpath equality and byte-hash equality. TTL, future timestamps and the tested_at ≤ source-file time constraints are all present.
- requested_routes.admission is passed into run.json via requestRouteSnapshot. The worker's rebuildContext compares with sameRequestedRoute and then re-checks admissionFor with the frozen reference, and adapter.run checks it a third time. Freezing and handoff are wired end to end.
- In the verifier, the config/skills/Hook/plugin items fall through to 'no tested exclusion-format yet, stay blocked', without inventing vendor events. Mode denials and empty results are not counted as passes. The tool proof requires a real call with a unique id plus a successful positive control.
- envMode:'replace' builds the environment from an empty object, qoderRun forces replace and rejects when HOME/QODERCN_CONFIG_DIR are missing, and the old delete patch remains as a fallback. This resolves last round's CLAUDE-05.
- prepareQoderReadonly does realpath and generates rules for both /var and /private/var forms, and refuses paths containing rule metacharacters. This answers last round's CLAUDE-01 path-namespace issue.
- The Custom codec runs in a short-lived Node child process in a private replace environment. The protocol is sealed with AES-GCM over a one-time key. Only the single selected record is re-encrypted, the declaration fields are on an allowlist, and every parameters string from every record goes into the secret set. The codec layout requires a unique match and is rejected if unknown.
- invokeQoderModel scrubs every exit path value by value before returning, and a hit is reported as a failure. raw_exit_code/raw_signal are recorded separately from cleanup failures. Exit 0 plus a fallback/missing readback is still judged a failure.
- The Custom monitor treats init/modelUsage only as route consistency. model_effective stays null/unverified, and a display name is not promoted to an underlying identity.
- A Custom probe under --no-model-calls throws immediately, so it cannot produce default_verified. Custom probes do not refresh the official probed_at.
- credential-lease registers the lease before copying credentials, records process groups synchronously after a synchronous spawn, and before reaping checks owner identity, the process group being empty, and the private marker. Unverifiable cases leave the lease in place and report an error.
- All criticEnabled/defaultSelected flags are false, and the generator does not create a usable ledger when any item is missing. The current honest conclusion that admission is blocked is correct.

## 未覆盖范围（本侧盲区）

- I cannot run commands. CLAUDE-01's conclusion that the reviewer would definitely fail min_tool_calls under --tools '' is inferred from the code and the CLI semantics; I did not verify it on a real machine.
- I did not read the qoder-cn-trace.ts implementation or the full qoderTraceEvidence logic in detail, and I did not check how write_events with rejectionRecorded=false are consumed downstream by the guard.
- I did not check whether the cancel/force-kill path kills the native process group after the worker is SIGKILLed. If it does not, the lease stays in place while the orphan native process runs to completion holding credentials; I did not verify this.
- I did not read the full contents of the qoder-readonly/qoder-custom/qoder-lifecycle/qoder-index collectors, or each of the custom-*/readonly-*/index-* source files one by one.
- I did not review the details of the plan r4 file, the full report text, the two schema files (admission.v1/run.v3), doctor.ts, preflight.ts or init.ts.
- I did not verify whether availability() is called on paths that do not select qoder-cn, which affects the performance cost of the synchronous 100MB+ hashing (not filed as a finding).
- Windows behaviour and the real three-reviewer run are not covered (not run in this change either).

## 实际查阅的项目文件

- `src/trivium/admission.ts`
- `src/trivium/adapters/qoder-cn-admission.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-custom.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/util/credential-lease.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/scrub.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/model-routing.ts`
- `scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/admission-evaluation-2026-10-28T06-23-13-201Z-0993b5.json`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":14,"grep":10,"glob":1,"run_command":0,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
