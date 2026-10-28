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
run_id: 20261028T092749Z
rerun_index: 5
snapshot_hash: sha256:ea0c1ff032fd5a18a014283d2d294c6c3f332f4f2a3abdddd01e6d8f2fff92e0
blind: true
started_at: 2026-10-28T09:27:57.519Z
finished_at: 2026-10-28T10:01:47.226Z
duration_s: 137
tool_calls:
  read: 5
  grep: 8
  glob: 0
  run_command: 0
  project_reads: 9
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
consulted_unverified: true
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
session_id: a74ee859-c4ee-4677-a781-b5637a8b3e0c
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261028T092749Z` ｜ 第 5 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的一条：新采集器 qoder-execution.mjs 把候选臂的真实越权（最小工具面里 Write/Edit/Bash 实际执行成功、假文件被改）也记成 state:'untested'，状态值上和「没调用」分不开，而且采集器不会因此停下。r6 要求「未测」和「失败/拒绝」分列，这里没有兑现。本批真机两条 Write 都是同 ID Tool not found，这个分支没被触发，所以不影响本批结论，但下次跑的原件可能被误读。
其余部分基本同口径：生成器 --project-root/--write 解析与 README、协议一致；生产 qoderAdmissionVerifier 校验 project_root 和顶层 binding_sha256，诊断原件没有顶层 binding，所以实际上进不了台账，和文档里「不供其它项目写台账」的说法相符；原件里的 20 次启动、两组 members_after:3 以及 core_passed:false，都和报告、BACKLOG 的叙述对得上。
次要问题：协议里「精确覆盖由enumerateDenyPaths对账」紧挨着生成器那句，但生成器并不调用 enumerateDenyPaths，对账只发生在消费时；生成器还会在外部项目里硬编码创建本主题的 doc/05_testing 证据目录。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-execution.mjs:126-129` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：只要正控制或候选臂不合格，pair.state 一律是 'untested'。如果候选臂（Read/Grep/Glob 最小面）里危险工具真实调用成功（result.is_error 为 false，或 fixture_after 等于期望写入值），这本来是只读配方被突破的安全失败，却只记 state:'untested'、blocker:'无合格执行层拒绝'，和「没调用＝未测」用的是同一个状态值，循环也照常往下跑其它工具和路线。这和设计文档、协议的口径（未调用才算未测，mode/rule/分发分列，不能让未测变绿，也不能让失败降级成未测）不一致；qoder-index.mjs 的 reported_state 也会原样转抄。

**依据**：读了 qoder-execution.mjs 第 122-129 行：candidateOk 不成立时，state 只在 'pass' 和 'untested' 之间二选一，没有 'fail' 分支，也没有在候选臂成功执行时抛错停止。qoder-index.mjs 新增的 execution 段把 c.state 记为 reported_state，虽然另有重放 trace，但状态字段本身没有改正。设计文档新增段落要求「init 未暴露且无实际调用仅为未测」，PROTOCOL 09:00 段要求区分「真实tool_use和同ID Tool not found」。本批 09:24 原件中候选臂没有成功调用（Write 走的是 tool-unavailable，Edit/Bash 没有调用），所以这个分支尚未被真机触发；这是读代码得出的推理，没有运行验证。

**建议**：在 pair 级把「候选臂危险工具实际成功执行，或假文件被改」单独判为 fail，并给出明确的 blocker；按 r6 的「任一核心必需项阻塞即停」精神立即停止后续派生。'untested' 只保留给「没有调用」或「正控制不合格」这两种情况。在 qoder-cn-trace 或采集器回放测试里补一条合成反例。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/03_api/PROTOCOL_dual_critic_relay.md:558 / scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs:24,34` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：协议写的是「生成器可显式--project-root指定manifest/证据/覆盖/输出根…精确覆盖由enumerateDenyPaths对账」，设计文档也写了「由生产 enumerateDenyPaths 冻结完整精确覆盖」。但生成器的 deny_paths 完全取自手写的 manifest，没有调用 enumerateDenyPaths，req 里也不带 deny_paths，所以生成时不做任何对账；真正的对账只发生在消费时 requireAdmission 的超集检查。按字面读，后来的人会以为生成器已经保证了覆盖与生产枚举一致。

**依据**：qoder-admission.mjs 第 24 行只校验 manifest.deny_paths 是字符串数组，第 30 行构造的 req 不含 deny_paths，第 34 行直接 resolve/realpath manifest 里的条目。admission.ts 第 54-55 行只在 req.deny_paths 存在时检查覆盖。enumerateDenyPaths 只在 qoder-execution.mjs 第 58 行和 test/unit/admission.test.ts 的新用例里调用。

**建议**：二选一：一是改文档，写明生成器只冻结 manifest 给出的集合，与生产枚举的对账在消费端由 requireAdmission 完成；二是让生成器对目标项目调用 enumerateDenyPaths，并拒绝不相等的 manifest。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs:41` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：指定 --project-root 时，生成器会在目标项目里 mkdir -p 一个硬编码的本仓主题目录 doc/05_testing/evidence/qoder-cn-admission-20261028，再写评估文件。不带 --write 的「只读评估」照样会往目标项目写文件。对于外部隔离项目，这个路径约定没有依据，日期主题名也会随时间失效；README 说的「不传根仍兼容本仓只读评估」，实际也会写评估文件。

**依据**：qoder-admission.mjs 第 41-43 行无条件 mkdir 并以 wx 写入。test/integration/qoder-admission-generator.test.ts 断言评估文件落在 root 下，等于把这个约定固化了。README 新段落写的是「manifest、facts、证据、覆盖和输出均相对该项目」。

**建议**：把输出目录做成显式参数，或者默认放在 manifest 所在目录；README 里「只读评估」的措辞改成「不写台账，但写评估原件」。

## 认为正确的部分

- 生成器参数解析严格：--write 不带 --project-root 时直接拒绝，并且在任何读写之前完成；集成测试覆盖了隐式写入被拒、坏证据不写台账、评估落在目标项目三种情况。
- relativeFile 增加了 startsWith(project+sep) 和 realpath 一致性检查，manifest、facts、证据都限定在目标项目之内。
- 生产 qoderAdmissionVerifier 校验 doc.project_root 等于 req.project_root，并要求顶层 binding_sha256、cli_sha256 和 schema 都对得上。09:24 诊断原件只有按路线分的 binding，没有顶层 binding，所以实际上不可能被拿去生成台账，和文档声明一致。
- verifier 的 write/edit/shell 检查（qoder-cn-admission.ts:77）同样接受 permission-rule 或 tool-unavailable，与采集器的 candidateOk 同口径；trace 层把 mode、rule、tool-unavailable 分开记录，回放测试还断言 decisions 为空，分发错误伪装不成规则拒绝。
- 采集器原样消费 facts.review_invocation_args 和 prepareQoderReadonly；正控制放宽的配置只存在于 positive 臂，argv 和 settings 都写进原件，可以复核。
- 启动预算按 pinned 的 qoder-native 计数，probe 的 version/catalog 走同一个 pinned 可执行文件，所以计数确实包含这两类调用；原件 used=20、limit=24 与报告一致。
- 原件中两组 members_after:3、exited:false 如实保留，采集器退出 1，报告没有把稍后的回读改写成成功，口径诚实。
- admission.test 新用例用真实 enumerateDenyPaths 走通了台账引擎，并验证新一轮同行工件和 .trivium 下的新文件都会被「超出准入已验覆盖」拒绝。

## 未覆盖范围（本侧盲区）

- 没有运行任何测试、typecheck 或 build。报告里的「定向9/9通过」「typecheck/build退出0」没有核实。
- 补丁正文中被省略的约 1.5 万行（主要是证据 JSON 和 qoder-execution.mjs 前段）只做了按需抽查。原件只 grep 了状态、预算、进程组字段，没有逐条核对 stdout 内容。
- 没有读 execution-harness-failure、execution-cleanup-readback 两个原件和两份 index 原件的全文。
- 没有深入 terminateProbeSectionGroups、processGroupMemberCount、withQoderHome、loadQoderCustom 的实现，也没有判断每臂收尾修正后的行为是否正确（报告承认修正后没有再跑真机）。
- qoder-cn-trace.ts 解析器本身的实现没有逐行复核。
- Windows 行为没有覆盖。

## 实际查阅的项目文件

- `scripts/acceptance/kimi-qoder-cn/qoder-execution.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs`
- `scripts/acceptance/kimi-qoder-cn/README.md`
- `src/trivium/admission.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-admission.ts`
- `test/unit/qoder-cn-trace.test.ts`
- `test/unit/admission.test.ts`
- `test/integration/qoder-admission-generator.test.ts`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/execution-2026-10-28T09-24-01-724Z-562d47.json`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/2026-10-28-QoderCN只读审核准入与Custom模型接入-r4-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":5,"grep":8,"glob":0,"run_command":0,"project_reads":9}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
