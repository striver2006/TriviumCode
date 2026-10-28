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
run_id: 20261028T050945Z
rerun_index: 2
snapshot_hash: sha256:546cdf29a24cfd152b6ebaf1b918c9e548009601a1c593319bede17fcbbeed3d
blind: true
started_at: 2026-10-28T05:09:54.599Z
finished_at: 2026-10-28T05:20:52.554Z
duration_s: 314
tool_calls:
  read: 12
  grep: 13
  glob: 1
  run_command: 0
  project_reads: 18
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 4
  minor: 6
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
session_id: 3c65f39c-2585-4791-9428-8220d0dd928d
---

# 计划审查：QoderCN只读审核准入与Custom模型接入

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261028T050945Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

The most dangerous gap: the plan moves the Custom codec into production code, but nowhere decides where that code runs. The current diagnostic script loads JS extracted from the vendor binary, plus WASM, straight into the orchestrator process via dynamic import (qoder-custom.mjs:38-50). In production that vendor code would run with the full parent environment and filesystem access. The replace-env mode in §1 only covers spawned child processes, so it does nothing here.
Second: the admission ledger is stored per project in .trivium/, yet it holds machine-level facts and points at evidence inside the TriviumCode repo. Outside this repo, the evidence-existence/hash check has nothing to check against.
Third: §5 says both "global switch stays closed" and "enable the matching combination and run a real three-review". But criticEnabled is a static boolean that critics.ts and the run.json validation both depend on, and "conditional enable" has no defined semantics.
Fourth: the Custom positive/negative controls lack the case where the declaration exists but the provider rejects the modelID. That is exactly where a runtime fallback with exit 0 is most likely.
On the two contracts that need confirmation: I agree with replacing the environment wholesale. I agree in principle with splitting route verification from underlying identity, as long as §3's absolute wording is narrowed and the missing control is added. The overall fail-closed direction is correct, and the plan can be implemented once these decisions are filled in.

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 11 条：重要 4 ｜ 次要 6 ｜ 吹毛求疵 1）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1「Custom在内存选择唯一记录并仅重加密该项…内部编解码器按CLI实际字节和codec指纹绑定」；§2「诊断脚本复用生产实现」` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：The plan moves the Custom cache codec into the production adapter but never decides where it executes. The existing method locates JS and WASM inside the installed binary by byte offset, writes them to a temp directory, then dynamic-imports them into the current Node process. In production that means vendor code runs inside the Trivium worker, carrying the full process.env (every vendor's API keys) and full filesystem access. That sits entirely outside §1's replace-env mode and private HOME, which only apply to spawned children. The worker also briefly holds the decrypted plaintext of all six customs records. The report already says this method is not a public API. The plan does not decide: in-process or child-process execution, which environment and tmp the codec runs with, or the cleanup and scan scope for its extracted artifacts.

**依据**：scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs:38 indexOf('n.model_cache_decrypt(',110000000) locates source by byte offset; :45-50 checks WASM exports, then await import(pathToFileURL(temp/native.mjs)) and native.default({module_or_path:wasm}) run it in-process; :55 decrypts the whole records list. doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:27 'this is not a public API the vendor commits to… cannot be claimed as a cross-version production loading contract'. src/trivium/util/exec.ts:527 the env replacement only acts on spawn.

**建议**：Add an explicit decision to §1: the codec runs in a short-lived child process under the replace-env/private-tmp recipe (or give a reason for running it in-process). Put its executable, the extracted-artifact hashes and the extraction recipe into the isolation-recipe fingerprint. Add the decrypted plaintext of every record, not just the selected one, to the known-secret set. Add removal of the extracted artifacts to the cleanup readback checks.

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5「完整验收生成本机.trivium/admission.local.json…记录…相对证据路径/hash…生产消费核证据存在/hash」` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：The location chosen for the admission ledger does not match what it contains. .trivium/ is the per-project directory under the current project root. The admission facts, though, are machine-level: platform, CLI entrypoint, CLI version and the user's global Custom configuration. The evidence they reference lives in this repo under doc/05_testing/evidence/. When Trivium reviews any other project, two things break. First, that project's .trivium/ has no ledger. Second, a 'relative evidence path' relative to that project points at nothing, so the production 'evidence exists/hash' check either always fails or quietly degrades to trusting the hash alone. The installed runtime copy (~/.claude/skills/dual-critic) does not carry the evidence directory either. This storage-layer and path-base decision is hard to change once it lands.

**依据**：src/trivium/config.ts:31 TRIVIUM_DIR='.trivium'; :4-5 config.local.yaml is under the project-level .trivium and holds machine conclusions; :939 path.join(triviumDir,'config.local.yaml'). The evidence lives under the TriviumCode repo's doc/05_testing/evidence/qoder-cn-admission-20261028/ (paths cited in REPORT…Custom模型接入.md:11,39).

**建议**：Decide in §5 whether the ledger is machine-level (e.g. under the user's home or the runtime root) or project-level. State what the evidence path is relative to. In particular, decide whether production can see the evidence files at all on other projects or on an installed copy; if not, verify only an embedded digest and say so. Also state how a missing ledger on other projects is handled: always reject.

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5「registry…只声明能力/条件启用…全局开关保持关闭。仅在至少一个真实组合全部通过后，启用匹配组合并以Qoder加两家…跑真实三审」` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：Two statements in the same section contradict each other, and neither has defined semantics. criticEnabled is a static boolean today. When it is false, critics.ts refuses to select the side outright, and schemas.ts rejects any run.json whose requested_routes or round_verdict contains that side. So a real three-review with Qoder needs criticEnabled=true, which is exactly 'opening the global switch'. Otherwise the registry needs a new 'conditionally enabled' state, and every consumer (CRITIC_AGENT_IDS, the CRITICS type set, doctor tiering, validation of archived run.json, the defaultSelected⊆criticEnabled assertion) needs new semantics. The plan does not say which. If criticEnabled is flipped temporarily for the verification and then reverted, the run.json archived during that window will no longer pass validation.

**依据**：src/trivium/agents/registry.ts:192 criticEnabled:boolean, :429 qoder-cn false, :470 CRITIC_AGENT_IDS is derived from it; src/trivium/critics.ts:364 if(!agent.criticEnabled) rejects; src/trivium/schemas.ts:275,282 requested_routes/round_verdict must be criticEnabled.

**建议**：Decide explicitly in §5: (a) keep criticEnabled boolean and flip it to true only after admission, with the combination-level ledger acting as the second gate; or (b) introduce a new registry state for admission-gated enabling, and list its consumers and the compatibility rules for archive validation. Then reword 'global switch stays closed' so it matches the chosen option.

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3「以同版本单项正控制、缺声明回退控制、错误凭据控制证明该最小配置实际被使用」` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：The three controls do not cover a Custom 'invalid model' in the sense the task means: the declaration exists and passes Trivium's own parsing, but the provider does not serve that modelID (it is mistyped, taken down, or has had its permissions revoked). The missing-declaration arm already showed the CLI falls back to Auto with exit 0, so runtime fallback with exit 0 is the most likely outcome here too, and none of the existing three arms can cover it. Without this control, 'runtime fallback must fail' has no real counter-example for the Custom route.

**依据**：REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:33-35 the three arms are positive / no declaration loaded (exit 0 falls back to Auto) / wrong key (401); the task text requires 'invalid model, configuration invalid, authentication failure, runtime fallback… must all fail explicitly'.

**建议**：Add a fourth control to the §3/§4 Custom matrix: same provider and credential, declaration modelID replaced with a synthetic, non-existent value. Record the original exit code, the stderr/result events and whether a fallback happened. If its behaviour cannot be observed, list it separately as a blocker. Do not count it as covered by the three existing controls.

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan 序言「绝不以标签自述代替」 vs §3「原生实际选择标签/原生key与该声明一致」` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：The absolute wording collides with the route rule itself. By the report's account, the init/assistant label is the configured display name and the modelUsage key is the native key; both come from the local declaration. So the per-run route check is, in substance, a 'label matches declaration' consistency check. The real trust comes from the admission-time controls, which are bound by fingerprint. Without spelling out that split, the implementer must either treat the per-run label match as identity proof, which conflicts with 'never', or add some other per-run evidence that does not exist.

**依据**：REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:33 'init/assistant is the configured display name, result.modelUsage is the native key'; :37 'display name and billing key are both tied to the local declaration'. src/trivium/adapters/qoder-cn-model.ts:119-123 existing readback() writes the label as effective/envelope.

**建议**：Narrow that sentence to 'labels are not used as underlying provider/model identity'. State in the route rule that the per-run label check is consistency only. Route credibility comes from the admission-time controls bound to the configuration/codec/recipe fingerprint, and route_verified is computed from both of those together.

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2「预检冻结全部非敏感请求/声明/配方，review及run-protocol按requested_routes确定性校验」与 §5 准入台账` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：The frozen snapshot does not say whether it includes the admission ledger binding. requestRouteSnapshot only covers model/effort/tier/access/native_model. If the worker re-reads the ledger itself, its file can be replaced, expire or be regenerated between preflight and worker, and the two processes then decide from different admission records. That conflicts with the existing principle that the worker does not re-resolve.

**依据**：src/trivium/model-routing.ts:11-19 requestRouteSnapshot/sameRequestedRoute use only those fields for the deep comparison; src/trivium/adapters/qoder-cn.ts:97-100 the worker side only re-checks native_model and binding.

**建议**：Write explicitly in §2/§5 that preflight puts the matched ledger record id/hash (non-sensitive) into native_model or the requested_routes snapshot. The worker and adapter only verify that it is still unchanged and still valid. Include a 'ledger replaced' case in the two-process tamper tests.

### CLAUDE-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5「.trivium/admission.local.json（不进Git）」与 §6 同步清单` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：'Not committed to Git' currently has no mechanism behind it. The .trivium rules in .gitignore are a specific list (bin/logs/lock/state.json/config.local.yaml). The *.local pattern does not match admission.local.json. init also only appends these specific rules via protocol/gitignore.snippet. The §6 sync list covers neither the gitignore rule, protocol/gitignore.snippet nor init, nor the file and schemas registration for the new admission.v1 schema. Updating only the plan text would leave 'not committed to Git' false.

**依据**：.gitignore:11 *.local; :137-147 .trivium/ lists specific entries only; src/trivium/init.ts:9,229,538 init idempotently appends rules from protocol/gitignore.snippet.

**建议**：Add to the §6 list: the .gitignore and protocol/gitignore.snippet rules, init's idempotent append, the design §5.3 runtime-directory section, the admission.v1 schema file and its registration and tests.

### CLAUDE-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6「业务改码前将本次确定契约并入主设计拟交付节」与序言「历史计划/审查/失败证据不覆盖」` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：Several existing statements become untrue once §1/§2 are implemented, and the plan does not decide how to correct them, or how they relate to 'history is not overwritten'. Examples: the RunOptions.env doc comment ('overlaid on top of process.env'); the qoderChildEnv header comment ('the current interface has no replace-style env semantics'); the design sections saying 'replace-style env not yet implemented' and 'current Schema/worker still P2'; and the report's 'this round adds no native_model/run.v3 fields' and 'replace-style env entry point needs a separate design later'. It is unclear whether the current-round report counts as history.

**依据**：src/trivium/util/exec.ts:18; src/trivium/adapters/qoder-cn-native.ts:52-55; doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:3230,3236; REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:73,83.

**建议**：Add to §6: comments and current-status sentences in code and design are updated in place to match the implementation. For the report, decide whether to append a new section and annotate the old lines as superseded, or to rewrite it. List the copies above one by one.

### CLAUDE-09 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1「所有已知明文凭据在stdout/stderr/trace/error写盘前精确脱敏，命中失败且不回显」` |
| 类别 | security ｜ 层次 plan |
| 置信度 | medium |

**问题**：The 'all' in this sentence covers only an enumerated list of sinks, and the list is incomplete. raw_response_text from a production run goes into the rendered review artifact under .reviews/. fail_reason goes into run.json. The worker writes worker.log. None of these is listed. The 'known plaintext' set is also not defined to include every decrypted record (see CLAUDE-01).

**依据**：src/trivium/adapters/qoder-cn.ts:105-107 only stdout/stderr go through redactSecrets; :108 fail_reason; :113 raw_response_text=monitor.resultText goes into later rendering.

**建议**：Define the scan scope as 'every Qoder-related persisted sink' and list them: stdout, stderr, trace, raw_response_text/structured verdict, fail_reason/error messages, worker.log. Define the known-plaintext set as every decrypted Custom record plus the copied auth originals.

### CLAUDE-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2「official:<标签>、custom:<provider>/<modelID>…adapter目录钩子返回规范选择」` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | low |

**问题**：The generic preflight catalog check strips everything before the last '/' and accepts a short-name match. A selector of the form custom:<provider>/<modelID> therefore has its namespace removed in the generic layer, which can produce a match against a bare official catalog entry. Qoder's own conflict rejection will still stop the run later, but the generic layer's 'ok' then contradicts the adapter's verdict, and the preflight message points in the wrong direction. The plan does not say whether catalogModelsFor returns canonical selectors or bare IDs.

**依据**：src/trivium/preflight.ts:768-773 normalized.split('/').pop() then compared with m===short; src/trivium/adapters/qoder-cn.ts:75-77 currently returns only the official bare list.

**建议**：State in §2 that Qoder's catalogModelsFor/normalizeModelForCatalog return canonical selectors, so the provider/model short-name path in the generic layer cannot override the official/Custom distinction. Add a test where a Custom modelID has the same name as an official entry.

### CLAUDE-11 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2「凭据源变化必须校验，指纹不包含密钥值」` |
| 类别 | security ｜ 层次 plan |
| 置信度 | low |

**问题**：The plan does not say what the credential-change fingerprint is computed from. A plaintext hash of the API key is not the key itself, but it is still derived from it, and it would land in config.local or run.json.

**依据**：plan §2 itself; requested_routes stores the full native_model.facts in run.json (src/trivium/model-routing.ts:11-14).

**建议**：State that the fingerprint is computed over the selected record's encrypted cache bytes (or another non-plaintext source), not over a plaintext hash.

## 认为正确的部分

- §1 adds an explicit merge/replace environment mode to run, defaulting to merge so existing call semantics are unchanged, and restricts it to Qoder native calls. This directly fixes the report's own finding that the delete-patch is not protected against parent keys added after construction. I agree with this contract.
- Splitting Custom route verification from underlying provider/model identity is correct: an unknown underlying identity can be null without being a failure in itself, while a missing route requirement, a fallback or an inconsistency must still fail. This fits the task's requirement to keep what cannot be confirmed as null/unknown. I agree with the contract in principle, with the two additions in CLAUDE-04/05.
- The default tier stays on the P2 official default, and the user's global Custom settings do not silently switch the orchestrator to BYOK. This settles the default-tier ownership question from my previous round.
- provider_id is treated only as a directory namespace, and trusted provider identity stays in access.provider_*. This avoids a second source of truth.
- Official/Custom native-key conflicts, entries differing only in case, and duplicates are all rejected before spawn. This settles the question of what to do when the native --model flag cannot disambiguate.
- TraceCapability uses the conservative intersection of the combinations that can be enabled, and rejectionRecorded cannot be upgraded on the strength of what a script expects.
- The Write exact-path problem is diagnosed with single-variable controls first, and new admission is not manufactured by loosening all writes. Empty search results, unwritten files and verbal refusals are not counted as execution-layer rejections.
- doctor does not produce a full admission conclusion, a hand-written passed cannot bypass the evidence-consistency check, and the local record is explicitly not described as a security boundary against host tampering.
- History v1/v2 and old v3 are not backfilled, every new field must have a real consumer, and no dead schema is added.
- The final delivery is split into five categories, and blocked combinations stay blocked with no 'overall pass' written.

## 未覆盖范围（本侧盲区）

- I did not run any command. Whether the Qoder CLI falls back at runtime when the provider rejects the modelID, the codec's actual runtime dependencies, and the behaviour of the replace-env mode under pty/Windows are all reasoning from code and the report.
- I did not read the real-call checks on requested_routes in run-protocol.ts, the worker-side path, or the NativeModelFacts definition in types.ts.
- I did not read the definitions of nativeFacts/nativeRequest in run.v3.json/config/probe schemas this round. Compatibility of the optional binding_version etc. was checked only against the plan text.
- I did not read the readonly/evidence/index/secrets collectors under scripts/acceptance/kimi-qoder-cn other than qoder-custom.mjs, nor the raw JSON evidence files.
- I did not read the protocol document PROTOCOL_dual_critic_relay.md, the core SKILL or AGENTS.md, so their copies of the native_model text were not checked line by line.
- I did not check the Windows implementation details of replace mode on Windows (PATHEXT/ComSpec/.cmd shim resolution).

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-claude.md`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/review.ts`
- `src/trivium/model-family.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/preflight.ts`
- `src/trivium/config.ts`
- `src/trivium/init.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/critics.ts`
- `src/trivium/schemas.ts`
- `.gitignore`
- `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":12,"grep":13,"glob":1,"run_command":0,"project_reads":18}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
