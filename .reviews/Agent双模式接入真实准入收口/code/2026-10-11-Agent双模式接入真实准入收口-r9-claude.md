---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: code
role: claude
vendor: anthropic
agent_cli: claude/2.1.296
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: envelope
effort_requested: null
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: legacy
run_id: 20261011T105033Z
rerun_index: 9
snapshot_hash: sha256:c4d83941bb58551074e8e043e5f25242c908253010b53762b2901ae7646ce005
blind: true
started_at: 2026-10-11T10:50:41.330Z
finished_at: 2026-10-11T11:03:54.769Z
duration_s: 793
tool_calls:
  read: 18
  grep: 20
  glob: 0
  run_command: 0
  project_reads: 22
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 2
degraded: false
parse_fallback: false
peer_deny: true
drift: false
consulted_unverified: true
heterogeneous: unknown
access:
  requested_mode: profile
  profile: qwen
  launcher_requested: /Users/chenzhenbo/.local/bin/cld
  launcher_effective: /Users/chenzhenbo/.local/bin/cld
  wrapper_sha256: e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5
  configuration_sha256: 9a3bfaa3acc006b11a8c5c6422da69841ccc121de244ee7eff9574e4146cb8e5
  provider_declared: qwen
  provider_declared_source: profile
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: claude
    status: unknown
    left_model: null
    right_model: qwen3.8-flash
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
  - left: claude
    right: glm
    status: different-family
    left_model: qwen3.8-flash
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：qwen / glm
override_reason: 左侧模型信息缺失
session_id: dd0ab34d-6e14-4eab-a4fb-cde60f828158
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T105033Z` ｜ 第 9 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本轮补丁（base 39ed2053 → head f63e339f，473 文件）核心代码变更——目录形态 v2 绑定（敏感集 hash + 形态 + TTL + 指纹失配逐文件回退）、只读诊断臂（captureReadFileState/codexReadContentDiagnostic）、配方拆分（agent-access-recipes.mjs）、证据根与台账根分离、守卫失败分级与清理——未发现会造成错误放行的缺陷：新判据一律向 fail-closed 收紧，并有单测/集成/跨进程读回三层锚定。最值得注意的一条是读取契约字面量（README.md / cat README.md / -lc）散落在配方、证据与夹具多处，且被 hash 冻结的原判据函数恰是不可同步的那一处，漂移会以诊断静默退化而非报错的形式消失。次两条是 Codex/read 新提示词与保留旧句的口径冲突（与设计 v1.3.152 描述有出入，留给 Driver 裁决）、以及 expectedDirectoryFailure 对 ENOENT 的无站点化放行。本侧无命令执行能力，报告中 3163 项两遍 check、14/14 桩与 12 组合真实准入未测等断言未复验；未测缺口本身在恢复报告中如实保留，不构成隐瞒。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 1 ｜ 吹毛求疵 2）

### CLAUDE-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-evidence.mjs:25,51,62 + scripts/agent-access-recipes.mjs:12` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：新增诊断链把读取契约字面量（README.md 文件名、argv 形态 -lc / cat README.md）在配方、证据、夹具多处各自硬编码，没有单一常量来源；其中被 hash 冻结的原判据函数 codexCommandEvidence（同文件 :157 也有同一字面量）按设计不得改动，未来任何一侧改名或命令形态调整都无法同步全部副本。

**依据**：读了 scripts/agent-access-recipes.mjs:12（cat README.md 提示词）、scripts/agent-access-evidence.mjs 全文（:25 captureReadFileState 的 path.join(fixtureRoot,'README.md')、:51 normalizedPath('README.md',...)、:62 pair.command[1]!=='-lc'||pair.command[2]!=='cat README.md' 的 not-single-cat 判定、:157 冻结区内既有同字面量）、src/trivium/probes/fixture.ts:120/192（openFile='README.md'）、test/unit/agent-access-read-evidence.test.ts 的全文诊断测试。推理（未运行）：一旦夹具或真实 CLI 的读取命令形态改变，新诊断只会以 reasons:['not-single-cat'] 或 missing-or-untrusted-file-state 静默降级（kind=diagnostic-only 不参与准入），strict_first_word 照旧，测试不会红，取证信号悄悄失效。

**建议**：在 recipes（或 evidence）导出单一契约常量（如 READ_TARGET_FILE / READ_TARGET_ARGV），captureReadFileState 与 codexReadContentDiagnostic 消费常量；对 hash 冻结的 codexCommandEvidence 区域，增加一条单测断言冻结切片内含该常量对应字面量，把不可改的副本变成可检查的耦合。

### CLAUDE-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-recipes.mjs:12-14,22-24` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：Codex/read 的交付指引同时保留旧硬句「summary必须逐字等于README第一个单词，不得添加解释。」（productionReadPrompt 共用尾巴）与新增「读取失败时诚实说明失败」，两句在失败场景互相牵制；设计 v1.3.152（SKILL.md 末段）对该臂只描述「无实际首词、无预设结论、单cat要求保留」，未提及保留逐字首词硬句，属实现与获批说明书之间的口径出入。

**依据**：读了 scripts/agent-access-recipes.mjs:11-15（两臂共用尾巴拼接）与 :21-28（codex/read 专属指引）、skills/dual-critic/SKILL.md 本 diff 新增段（第 31386-31395 行附近，diff 内通读）、test/unit/agent-access-read-evidence.test.ts:39932-39936（对 codex/read 仅结构正则断言，无整串 hash 冻结，且回放 fixture 的 14 例不含该臂）。推理（未运行）：该组合因 strict_first_word 恒 fail-closed 不会错误放行，但真实 18C 与后续补测时模型可能为满足「不得添加解释」吞掉失败说明，降低证据可读性。

**建议**：由 Driver 裁决：按设计原意则 codex/read 不复用旧尾巴，只输出带失败分支的单句 summary 约束；若刻意保留旧句以维持判据连续性，则写入设计/授权文本并给该臂增加逐字节回放锚定（同其余 14 例）。

### CLAUDE-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude-directory.ts:21-26` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：expectedDirectoryFailure 把裸 ENOENT 列为可降级外部失败，作用域覆盖整个 probeClaudeDirectories 调用体；模块注释承诺「仅定义过的外部失败可降级、未定义内部错误继续抛」，但未来任何被重构进该函数体的文件系统读取抛出 ENOENT 都会被静默折算成「目录事实失效、主 probe 保留」，不再冒泡。

**依据**：读了 src/trivium/probes/claude-directory.ts:16-26 与 probeClaudeDirectories 全文（diff 段 31621-31776：schemaPath 读取在 try 内、夹具创建失败由 ProbeFixtureError 覆盖，ENOENT 当前主要服务 populate 缺 schema 的预期路径——test/integration/claude-structured-probe.test.ts 新增用例以 /missing-schema-for-directory-probe 触发）、src/trivium/probes/claude.ts:31846-31880（外层 catch 按同一谓词降级）、src/trivium/doctor.ts:793-826（claudeDirectoryProbe 注入口）。推理（未运行）：当前调用点风险低（spawn 失败走 outcome 路径），故只定 nit；但谓词与失败来源路径无绑定，防御边界是约定而非结构。

**建议**：把 ENOENT 豁免收敛到已知读取点（单独包裹 readSchemaJson，或在错误对象上核对 file 路径属于 schema/夹具），其余路径维持继续抛；或为每次降级在 failure/notes 里记录错误来源文件，使静默 null 化可审计。

## 认为正确的部分

- 目录事实消费链收紧得当：claudeSensitiveGlobsHash 绑定真实项目集合、CLAUDE_DIRECTORY_SHAPE 形态版本门、缺值/变化/TTL/指纹失配一律逐文件回退；consumeClaudeDirectories 的先核声明再读二进制并用注入 reader + 本次调用 Map 消除跨调用缓存，单测以 0/1/2 次读取精确验证。
- projectClaudeDenyPaths 的 covered 谓词（根 1-5 段、纯 ASCII 段、后代≤2 级且仅末段允许特殊字符）与夹具七臂拓扑、3924 路径真实集合离线回放（8 目录、3908 覆盖、24 逐文件）互相印证；.hidden、中文、空格、逗号、6 段根等未测前缀明确不压缩。
- captureReadFileState 的 O_NOFOLLOW + open/fstat/lstat 双重身份核对与 finally closeSync 是扎实的 TOCTOU 防御；codexReadContentDiagnostic 字节级固定、不裁剪、不参与准入，原判据函数原文被 hash 冻结，新信号不反噬旧判据。
- 证据根/台账根分离（TRIVIUM_ACCESS_EVIDENCE_ROOT 与 BUDGET_ROOT）配合 selection/closeout 的 ledgerRoot 透传与「错误使用证据根不得静默获得 native 身份」负例测试，闭合了用证据树伪造 native 版本引用的路径。
- round-guard-v2 显式权威、指针 hash/主题/载体名三重核验、supersedes 原件字节回读、唯一 launcher 引用扫描与 v12/v13 真实子进程正负例（token 独占、安装漂移、合成历史达上限拒绝）成体系；我上一轮 r8 提出的委托来源断言不对称，本批已在 v9 与 task-launch 测试中补齐。
- 恢复报告与设计/ADR/SKILL 保持当前采样 vs 历史采样的分层话术，新包 12 组合真实准入、官方 Claude、客户端重名解析等缺口全部如实挂未测，M11 前置未完成结论与提交内容自洽。

## 未覆盖范围（本侧盲区）

- 本侧无命令执行能力：报告中「两遍 check 3163/3160 通过、14/14 桩、定向 46/46」及各 evidence JSON 内的 hash 数值均未独立复算或复跑，仅做静态交叉阅读；captureReadFileState 对真实竞态的兜底效力未经运行验证。
- 70k 行 diff 中 doc/05_testing/evidence/** 大体积 JSON 台账与两份新 fixture 的完整正文（claude-deny-paths-replay.json 全 3924 条、prompt-replay 14 条完整字节）未逐条通读，仅核对与代码断言相关的片段与 hash 锚点。
- 真实厂商 CLI 行为（Codex -lc argv 形态、Claude permission_denials 实际条数对齐）只依赖既有证据文件与测试合成事件，实机重放未覆盖。
- 工作树相对 head 的未提交漂移（git status 中 scripts、recovery 测试、task.json 等 M 项）不在本被审 diff 内，未审。
- Gemini/GLM 侧产出按禁读清单未读，对其视角的盲区不做推断。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/code/_meta/changes-20261011T105033Z.diff`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-selection.mjs`
- `scripts/agent-access-budget.cjs`
- `src/trivium/adapters/claude.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/probes/fixture.ts`
- `src/trivium/doctor.ts`
- `src/trivium/freeze.ts`
- `src/trivium/types.ts`
- `src/trivium/report.ts`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/agent-access-task-launch.test.ts`
- `test/unit/agent-access-read-evidence.test.ts`
- `test/unit/agent-access-applicability.test.ts`
- `test/unit/agent-access-closeout.test.ts`
- `test/unit/claude-directory.test.ts`
- `test/unit/freeze-drift.test.ts`
- `test/integration/claude-directory-adapter.test.ts`
- `test/integration/claude-structured-probe.test.ts`
- `test/fixtures/agent-access-prompt-replay.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v13.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v8.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v9.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v8.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `skills/dual-critic/SKILL.md`
- `CLAUDE.md`
- `.reviews/Agent双模式接入真实准入收口/code/2026-10-11-Agent双模式接入真实准入收口-r8-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":18,"grep":20,"glob":0,"run_command":0,"project_reads":22}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
