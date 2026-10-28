---
schema: trivium.review.v2
topic: KimiCode-macOS规则根因与只读准入修复
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
run_id: 20261027T180347Z
rerun_index: 1
snapshot_hash: sha256:20ec8a5c5be271215e88e8753b42e184704672fced8475834dc42075e88ac208
blind: true
started_at: 2026-10-27T18:03:54.844Z
finished_at: 2026-10-27T18:19:37.667Z
duration_s: 178
tool_calls:
  read: 10
  grep: 7
  glob: 1
  run_command: 0
  project_reads: 11
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 1
  minor: 5
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
session_id: e6a81656-83a2-462d-93a8-c959f0a9f751
---

# 代码审查：KimiCode-macOS规则根因与只读准入修复

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261027T180347Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

The most serious problem is reproducibility. The six evidence files carry six different script_sha256 values, and only one of them can match the committed kimi-rootcause.mjs. The managed error stack points at line 98, but the throw in the current file is on line 99. The README presents the commands as rerun instructions and the plan requires an exact rerun command per arm, yet the script revisions that produced the main rules/extra/verify matrices are not preserved anywhere.
On the review focus, the overall direction is right. Admission is still decided only from native tool results, and doctor, exit 0, prompt-level read-only instructions and absence of a tool call are all kept out of the security evidence. Both switches remain false. The registry change is a comment only.
Several narrower gaps remain:
- The evidence-judgment tests have no positive samples for rule_denied or sensitive_blocked, and the path/realpath and cleanup-failure tests the plan requires are missing.
- The verify-suite comment says doctor and the -p run use the same invalid rule, but the code switches straight to valid rules for the next arm.
- A managed run that fails before launch is still labelled as loopback.
- The source summary does not record the search patterns behind the "no consumer" claim, or any search for other seeding routes.
- The default permission-mode arm and the Edit arm deviate from the plan without being flagged.
None of these require a re-review; after the fixes the change can go ahead.

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 6 条：重要 1 ｜ 次要 5）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs:30 (script_sha256); doc/05_testing/evidence/kimi-macos-20261028/*.json` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：Each evidence file was produced by a different script revision: spike eed568…, rules 158167…, managed 54ac06…, extra 5b2354…, verify bf9551…, final 978bff…. Only the final revision of the script is committed. The managed evidence's error stack points to kimi-rootcause.mjs:98:82, but the no-access-token throw is on line 99 in the current file, which confirms the code has changed. As a result, the main matrices cited in report §3/§4 (rules 22 arms, extra 17 arms, verify 5 arms) cannot be reproduced from any file in the repository. The README still gives these commands as rerun instructions. Plan §3 also requires an exact rerun command per arm, and the code deletes commandLine (line 144).

**依据**：Grepping script_sha256 across the evidence directory returns six different values. The managed error field contains kimi-rootcause.mjs:98:82; in the current kimi-rootcause.mjs, line 99 is `if(typeof credential.access_token!=='string'...)throw Error('no-access-token')`. The rules evidence has no execution_path or execution_sha256_after fields, so it was produced by the older version without a pinned copy. The report §1 wording ('rules batch read the same hash before launch') reflects this, but the README does not explain it.

**建议**：Choose one of three: (a) save each script revision that produced evidence (or its commit/stash reference) next to the evidence and map script_sha256 to source in the index; (b) state explicitly in the README and report that the current script corresponds only to the final run, and that the rules/extra/verify matrices were produced by earlier revisions that are not preserved; (c) within an explicitly declared launch budget, rerun the minimal counterexample matrix once with the committed script. Also make the per-arm record keep the full reproducible command line with sensitive values redacted.

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/kimi-evidence.test.mjs:6-60; kimi-evidence.mjs:37-39` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：Four gaps in the evidence-judgment tests. (1) No test has a positive sample for the rule_denied regex `Tool "X" was denied by permission rule.` or for sensitive_blocked. No rule ever took effect, so this denial text has never appeared in native output, yet the report's recovery condition (a working custom-deny example) depends entirely on that regex. (2) Plan §7 requires tests for path/realpath boundaries and cleanup failure; neither exists. (3) The fixture is chosen with `files.find(x=>x.startsWith('kimi-extra-'))`. Re-running with the default output directory adds another kimi-extra-*.json, and the test then picks whichever file readdir returns first, so it is not stable. (4) The README describes this test file as the judgment test, but it does not cover the lifecycle supervision logic.

**依据**：The test file contains 14 tests. Its mutations cover only ID, name, target, duplicates, final state, resume hint, non-zero exit, malformed JSON, extra calls, and Glob/Grep path leaks. No test asserts rule_denied===true or sensitive_blocked===true. Plan r2 §7 explicitly lists 'path/realpath boundaries, cleanup failure'.

**建议**：Add positive and negative tests that build rule_denied and sensitive_blocked results from mutated samples, and note in a comment where the denial text comes from (the official source line). Pin the sample by fixed filename or by the hash recorded in the index. Add the path-boundary and cleanup-failure cases the plan requires, or explicitly record them as a deviation from the plan.

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs:221-225; doc/05_testing/REPORT_2026-10-28_KimiCode_macOS规则根因与只读准入.md §2 item 3` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：The verify comment says 'doctor and the real -p run use exactly the same invalid rule', but after doctor the code runs the `rule-runtime-state` arm, whose config is overwritten with valid deny rules. The '-p still runs with the invalid rule' fact the report relies on actually comes from the rules batch's `invalid-rule-sentinel` arm. That arm used a different temp root, a different loopback port (so base_url differs), and a different script revision. The doctor run also records no hash of the config file it used. Together, the comment and the report's 'same invalid rule' wording overstate how controlled the pair is.

**依据**：In kimi-rootcause.mjs, line 222 writes config([{decision:'invalid-decision'...}]) and line 223 runs doctor. Line 225 calls arm('rule-runtime-state',{rules:deny}), and arm() rewrites config.toml at line 115. invalid-rule-sentinel appears only at line 180, in the rules branch.

**建议**：Either run one -p arm immediately after doctor using the same config file bytes, recording the config sha256 for both runs, or change the comment and report §2 to say 'same rule content, different batch and port'.

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs:28-29,96-103` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：In the managed suite, source_kind/real_model/real_credentials are only changed to the real-route values after the credential check passes. When access_token is empty and the run fails before launch, the evidence file still says source_kind='controlled-loopback-native-cli' and real_model=false. The managed evidence in the repo is therefore labelled as a loopback run, which contradicts the report's description of it as a real-model bridge that failed before launch.

**依据**：kimi-managed-1793123729239-a63d5d.json line 6 has source_kind 'controlled-loopback-native-cli' and line 19 has error no-access-token. In the script, `manifest.source_kind='real-official-model-static-access-token'` is set at line 103, after the throw at line 99.

**建议**：Set intent fields from the suite at manifest creation (for example intended_source_kind), and record actual native_launches separately, so a pre-launch failure cannot be mistaken for a loopback-batch artifact.

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/kimi-macos-20261028/official-source-1793123673.json; REPORT_2026-10-28 §2 paragraph 2` |
| 类别 | contract ｜ 层次 rca |
| 置信度 | medium |

**问题**：The source summary records only a scope ('all src TypeScript'), one hit in rule_add_calls (new PermissionRulesAdd), and excerpts that are mostly import lines, `});` or blank lines. It does not record the patterns behind 'no .addRules(...) consumer call anywhere in src/**/*.ts', and it does not record searches for other routes that could seed or read rules. permissionRules/configSection.ts calls registerConfigSection, but the summary never shows who consumes that section key, or whether the policy reads rules directly from IConfigService or dispatches permission.rules.add directly. The root-cause conclusion rests on an absence claim that cannot be reproduced from the artifact.

**依据**：The json's top-level keys are only version_tag/commit/tarball/scope/files/rule_add_calls/not_binary_equivalence_proof, with no record of search patterns or negative results. The configSection.ts excerpts cover only lines 7-13 and 36 (imports and closing braces). The agentLifecycleService excerpts include line 396 `  }` and line 397, which is blank.

**建议**：Add to the summary: the exact search patterns used (`.addRules(`, PermissionRulesAdd, the config section key name, consumers of IConfigService.get and similar), the full list of hits for each, and meaningful excerpts such as the bindBootstrap body and the initial `rules: []`. That would let the 'wiring gap' be re-checked independently.

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs:107,160,173-179; doc/08_project/KimiCode与QoderCN双角色接入实施计划.md` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | medium |

**问题**：Several items from the approved r2 plan are missing, and the report does not flag them as deviations. Plan §4's permission-mode row requires 'manual/auto/yolo/default', but config() always writes default_permission_mode, so there is no default arm. Plan §5 lists Edit, but neither the allowed nor the trimmed arms include Edit. Plan §3's 'read only the expiry information needed to avoid launching near a token refresh' is not implemented in the managed path. Plan §7 requires syncing the implementation plan's §2 status and the design/dev-log/local-pitfalls records, but the diff only adds a header note and one §4 row.

**依据**：In kimi-rootcause.mjs, line 107's config template always outputs default_permission_mode, and line 160 iterates only ['auto','yolo'] (manual is the default parameter). Plan r2 §4 and §5 contain the original wording quoted above. In the diff, the implementation plan's only changes are the line-5 note and the §4 table row.

**建议**：Either add the default arm and the Edit arm within the remaining budget, or add a 'deviations from plan r2' section to report §7 listing each item and the reason, so the Driver can decide.

## 认为正确的部分

- Admission judgments use only same-ID native tool results. Paths in requests and model summaries do not count as leaks. Filtering, verbal refusals, exit 0, unchanged files and absence of a call are not promoted to execution-level denials. This matches the review focus.
- The loopback provider substitutes only the model output, and permissions and execution stay in the official dispatcher. The report clearly labels this as a mechanism diagnostic and does not let it replace the real-model route.
- The invalid-default_model sentinel shows the config file was loaded, and the custom Write/Bash deny pair shows the failure is not specific to the three read tools. The single-factor design is sound.
- registry.ts changes only a comment. criticEnabled and driverEnabled remain false, consistent with plan §1's freeze.
- Evidence is written with wx and mode 0600, the temp root is 0700, the root is preserved when tree exit cannot be verified, and the lifecycle cleanup is driven by an outer supervisor. The direction is correct.
- The report is candid about the unconfirmed spike version drift, the untriggered lifecycle arms, MCP/skills/plugins with no positive control, the 0 managed launches and the untested interactive TUI.
- The 22/17/5/5 arm counts are consistent with the current branches in the script.

## 未覆盖范围（本侧盲区）

- No commands could be run: I did not run node --test to confirm 14/14, did not compute the committed script's sha256 to see which evidence file it matches, and did not reproduce any native behaviour.
- I did not read the official Kimi 2.3.3 source and checked the root-cause claim only against the summary json in the repo.
- I did not read every arm in the rules/extra/verify/final/lifecycle evidence file by file; I only sampled fields such as status and script_sha256 with grep.
- I did not review the full context of the CASE document, the 2026-10-27 report, or the edits to doc/05_testing/README.md.
- I did not read probe.mjs, windows.ps1, git-bash.sh or test/unit/deny-matrix.test.ts in full, so I did not confirm independently that they are unchanged (git status suggests they are).
- I did not read the full implementation of exec.ts terminateProbeSectionGroups, and checked only the option signature.
- AGENTS.md / CLAUDE.md / doc/README.md and the design documents were not read in depth.

## 实际查阅的项目文件

- `scripts/acceptance/kimi-qoder-cn/kimi-evidence.mjs`
- `scripts/acceptance/kimi-qoder-cn/kimi-evidence.test.mjs`
- `scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs`
- `scripts/acceptance/kimi-qoder-cn/kimi-lifecycle.mjs`
- `scripts/acceptance/kimi-qoder-cn/README.md`
- `.reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-r2-codex.md`
- `src/trivium/agents/registry.ts`
- `src/trivium/util/exec.ts`
- `doc/05_testing/evidence/kimi-macos-20261028/official-source-1793123673.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-extra-1793123673700-a7f1fc.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-rules-1793123572082-399108.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-managed-1793123729239-a63d5d.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-verify-1793123895955-a45d0e.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-final-1793124157502-6b3356.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-spike-1793123543180-f18e86.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-lifecycle-1793123829752-4c182c.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":10,"grep":7,"glob":1,"run_command":0,"project_reads":11}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
