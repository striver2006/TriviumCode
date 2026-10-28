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
run_id: 20261028T041304Z
rerun_index: 2
snapshot_hash: sha256:4d1bd92e14db876d86c6b6ac001286e57744a56e9695f7c7091874ccdb60f526
blind: true
started_at: 2026-10-28T04:13:12.999Z
finished_at: 2026-10-28T04:25:23.997Z
duration_s: 107
tool_calls:
  read: 8
  grep: 3
  glob: 0
  run_command: 0
  project_reads: 9
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 1
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
session_id: 4a39636f-d135-4c95-a9c6-692e4bdb0325
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261028T041304Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

The most dangerous problem: the qoderChildEnv allowlist never takes effect. Every caller passes its output as the env of util/exec.ts run(), and run() starts from {...process.env} and only overlays or deletes on top of it (exec.ts:527-531). So the unknown parent variables the allowlist means to exclude (NODE_OPTIONS, QODER_*, cloud credentials, unvetted proxy settings) all still reach the vendor process. Worse, this patch removed the old explicit deletion of QODER/QODERCN/ANTHROPIC/OPENAI/CODEX/TRIVIUM_* and NODE_OPTIONS, so production P2 isolation is now weaker than before the patch.
The report, PROTOCOL, design doc, test assertions and the evidence label "uses the production new env policy" all describe protection that does not exist at run time. The unit test only checks the function's return value and never covers the env actually spawned.
Elsewhere: the Custom native minimal load, the request / declaration / readback separation, treating exit-0 fallback as failure, the admission=false bookkeeping and the corrected Write/Bash dispatch rejection are all described carefully and honestly; the problems are concentrated in the env layer.
Smaller items: the secret guard has no minimum length; the open arm's Write allow is unbounded; the index does not separate rejection channels.

**结论**：不通过（`reject`）

## 审查意见（共 5 条：阻断 1 ｜ 重要 1 ｜ 次要 2 ｜ 吹毛求疵 1）

### CLAUDE-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-native.ts:53-69,88; src/trivium/util/exec.ts:527-531` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：qoderChildEnv returns only the allowlisted keys, but every consumer passes it to run() as opts.env. run() builds childEnv from {...process.env} and treats opts.env as overlay/delete only (undefined means delete). Keys not in the allowlist are therefore still inherited unchanged, and the allowlist has no effect at run time. The old code explicitly set QODER_/QODERCN_/ANTHROPIC_/OPENAI_/CODEX_/TRIVIUM_* and NODE_OPTIONS to undefined, so run() deleted them. The new code drops that step, which reopens the paths for injecting NODE_OPTIONS/BUN_OPTIONS and passing vendor or session overrides (for example QODER_* variables that could change model routing). This is a security regression for the production P2 route as well (probes/qoder-cn.ts:16-26, adapters/qoder-cn.ts:33-41, verifyQoderBinding).

**依据**：exec.ts:18 comment: "追加/覆盖到 process.env 之上的环境变量；值为 undefined 表示删除该变量" (env vars are added/overridden on top of process.env; undefined deletes). exec.ts:527-531 builds childEnv={...process.env} and then overlays. qoder-cn-native.ts:88 passes the return value of qoderChildEnv straight to fn. probes/qoder-cn.ts:17,19,25 and adapters/qoder-cn.ts:39-40 both call run(...,{env}). The deleted lines in the diff are the old undefined-assignment loop. The new unit test in test/unit/qoder-cn-model.test.ts only asserts on the qoderChildEnv object and never reaches run(). Grep of test/integration/qoder-cn-routing.test.ts found no assertion that NODE_OPTIONS or unknown canary variables are absent from the child process. This is a conclusion from reading the code, not from running it.

**建议**：Make the isolated env take effect at the spawn layer. Either give run() an explicit "replace instead of overlay" option, or have qoderChildEnv also set every parent key not on the allowlist to undefined. Then add an integration regression with a fake CLI that prints its own env, placing NODE_OPTIONS, QODER_* and an unknown canary in the parent env and asserting they are absent from the child. Also check the qoder-custom/qoder-readonly collectors, which reuse runtime.run.

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:63,74; doc/03_api/PROTOCOL_dual_critic_relay.md (new 2026-10-28 paragraph); 2026-09-10 design doc, new subsection` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：Several documents state as delivered fact that unknown parent variables, NODE_OPTIONS and BUN_OPTIONS are not passed to the vendor process, and that constructed isolation has automated coverage. Given CLAUDE-01, these statements are false at run time. The report also calls the second readonly batch (02-44-15) and later batches "直接使用生产 withQoderHome 传入的环境" (directly using the env passed in by production withQoderHome) under the new env policy. In fact those batches inherited the full parent environment, so the isolation conditions recorded in the evidence do not match what actually ran.

**依据**：Report line 63: "未知凭据、父会话/厂商覆盖、NODE_OPTIONS/BUN_OPTIONS 不传" (unknown credentials, parent-session/vendor overrides and NODE_OPTIONS/BUN_OPTIONS are not passed). Report line 74: "构造级隔离与合法代理/证书正例有自动化" (constructed isolation and valid proxy/certificate positive cases are automated). The PROTOCOL addition says the env is built from an explicit allowlist and unknown parent environment is not inherited. scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs and qoder-custom.mjs both call runtime.run(executionBin,...,{env}), which goes through the same overlay path in exec.ts.

**建议**：After fixing CLAUDE-01, correct each of these statements. Add a note to the existing raw evidence files and report entries that they ran under the overlay env, rather than rewriting history, and do not count them as evidence for the new env policy.

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-secrets.mjs:2-6,13-17` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：collectCredentialValues pushes every non-empty string in the .auth/user JSON into the secret list, and also the whole trimmed file content. secretGuard does an exact-value split/join replacement with no minimum length or entropy threshold. If the auth file contains short, common field values (an enum such as a type or region, a short username, a boolean string), they will be redacted wherever they appear in stdout or the evidence path text, and leaked will be set, so the collector exits 1. This can corrupt the readability of the raw evidence and produce false leak failures. Neither unit test covers this.

**依据**：qoder-secrets.mjs collects Object.values recursively with no length filter. scrub calls split(variant).join('[REDACTED]') on every value. qoder-readonly.mjs and qoder-custom.mjs both run every case's stdout and the final evidence JSON through guard.scrub. qoder-secrets.test.mjs uses only long fixture values.

**建议**：Set a minimum length / high-entropy threshold for automatically collected values (or collect only known sensitive field names), and record the skipped low-entropy fields as a scan boundary. Add a regression case with short field values.

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs (open arm settings: allow includes unscoped 'Write','Edit'; --permission-mode accept_edits)` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：The open arm uses accept_edits and allows Write/Edit without any path restriction. The only deny rules cover reads under the temporary HOME. The real model running this positive control can write anywhere on the filesystem the current user can write, including the repository root and the user's real home. The README and report emphasise that the Shell auto-allow is a narrow synthetic echo rule "避免无界bypass" (to avoid an unbounded bypass), but Write is unbounded, so the scope statement is inconsistent with the code.

**依据**：In qoder-readonly.mjs, permissions for arm==='open' is {allow:['Read','Grep','Glob','Write','Edit','Bash(echo SHELL_CONTROL*)'],deny:homeDeny}, where homeDeny contains only Read/Grep/Glob(/home/**). Report line 65: "Shell自动许可只含合成echo控制，避免无界bypass" (the Shell auto-allow covers only the synthetic echo control, avoiding an unbounded bypass).

**建议**：Scope Write/Edit to the cwd or canary path, e.g. Write(//<cwd>/**), or state explicitly in the README that Write in the open arm is unbounded.

### CLAUDE-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs:16-22` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：paired_errors counts every is_error result as a paired error. It does not separate tool unavailable / Tool not found (registration and dispatch rejection), permission-rule rejection, and ordinary execution errors (file not found, etc.). The key distinction the report relies on — dispatch rejection is not a permissions rule — therefore still has to be made by reading the raw files by hand. The index cannot carry it automatically.

**依据**：The results map only extracts is_error, error_text and permission_rule. paired_errors filters on is_error alone. Report lines 52-54 make the channel distinction by hand.

**建议**：Add a channel field to the index (permission-rule / tool-unavailable / execution-error / unknown) so later admission records can consume it directly.

## 认为正确的部分

- Custom minimal load re-encrypts only the selected record. The parameter shape is checked strictly (api_key only), the record must be unique, and errors from the native prepare stage are not echoed. Vendor source and WASM exist only in a temporary root and only hashes are recorded. This matches the plan's requirement not to copy other model credentials.
- The missing-config arm (exit 0 but falls back to Auto) is recorded explicitly as a failure counterexample, the invalid-key arm's 401 is not misread as a model fallback, and provider_effective/model_effective stay null. Request, declaration and readback are kept separate, and the model's self-description in its reply is not trusted.
- admission is always false and the collector's exit code is kept separate from each arm's raw exit code. The second batch's wrong 'not called' description was corrected against the raw files without rewriting the historical JSON. Tool-list trimming / dispatch rejection is not equated with proof of a permissions rule.
- Proxy inheritance validation fails closed: URLs with credentials, a query string or a non-standard path throw, and the diagnostic does not echo the value. TMPDIR is moved into the private HOME with mode 0700. Windows still refuses before copying credentials.
- The registry switches, Custom three-tier / worker wiring and the real Qoder three-reviewer run are clearly marked as not delivered, so the documents do not claim them as live.

## 未覆盖范围（本侧盲区）

- I could not run commands, so CLAUDE-01 is a conclusion from reading code. I have not observed the actual vendor child-process env.
- I did not read the evidence JSON files one by one, so I have not checked whether the call IDs and raw exit codes cited in the report match the raw files.
- I did not review the full lifecycle (cancel / force-kill / reaping lost processes) or the stopQoderHomeHelpers code; these are outside this change.
- I did not check the plan text in the r2 plan file item by item; plan deviations are judged only against the report's own self-description.
- Windows behaviour has not been tested and cannot be judged.

## 实际查阅的项目文件

- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/probes/qoder-cn.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":8,"grep":3,"glob":0,"run_command":0,"project_reads":9}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
