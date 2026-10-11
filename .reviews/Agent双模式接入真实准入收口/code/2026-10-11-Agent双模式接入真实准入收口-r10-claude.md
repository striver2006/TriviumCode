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
run_id: 20261011T122355Z
rerun_index: 10
snapshot_hash: sha256:8b7e234a3ed1fbe4805ab7847b92e699b4b4a1b2ca5326a75e47929d19e64cf4
blind: true
started_at: 2026-10-11T12:24:01.475Z
finished_at: 2026-10-11T12:38:16.325Z
duration_s: 855
tool_calls:
  read: 22
  grep: 23
  glob: 0
  run_command: 0
  project_reads: 19
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 1
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
session_id: 281b6ded-199d-454a-a24d-8fd08b1e3144
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T122355Z` ｜ 第 10 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

总体：写合同模块、read 全文诊断、目录形态绑定与冻结深度改动与 r22 计划 §3/§6、设计 v1.3.153、ADR003、SKILL、RUNBOOK 逐条对得上，原 codexCommandEvidence 判据被测试以函数体 hash 钉死不变，未发现会导致线上出错或判据漂移的 blocker/major。四条遗留：consumed 目录压缩谓词比夹具实测矩阵略宽（特殊文件名+ASCII 后代目录组合未测）；contractPath 的 realpath==root 严格性叠加 normalizedPath 仅剥 /private/var，TMPDIR 走 /tmp 别名的机器上 Codex/write 臂会在 spawn 前 fail-closed 而 read/deny 臂照常跑；closeout 的 catch 里 save('failure.json') 自身抛错（脱敏拒写或 wx 冲突）会顶替原始错误；写合同诊断把至少七类失败原因折叠进单条 reason 标签，抬高事后取证分诊成本。均不阻断，建议 Driver 择机以小 PR 收。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 3 ｜ 吹毛求疵 1）

### CLAUDE-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/claude.ts:380-390 与 src/trivium/probes/claude-directory.ts:119-123` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：covered() 允许「ASCII 根 + ≤2 级 ASCII 后代目录 + 任意文件名」的逐路径入列被目录规则压缩消费，但探针夹具矩阵只在各根下直接层测了特殊文件名（中文空格逗号.txt、file[1].txt），第 2–3 级后代只测了 ASCII 文件名（nested/.hidden、nested/deeper/deep.txt）。组合「特殊文件名位于 ASCII 后代目录内」落在消费域内却从未被实测，与 claude.ts:364-365 注释「已测ASCII拓扑的形态版本」的承诺存在小范围外推。

**依据**：读了 src/trivium/adapters/claude.ts:372-390（covered() 仅对 slice(0,-1) 的中间段要求 ^[A-Za-z0-9_-]+$，末段文件名不校验）与 src/trivium/probes/claude-directory.ts:119-128（files 矩阵六名单：special 名单只出现在 ${d}/ 直接层）；对照设计文档 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 第 310 行契约「后代0至2级…仅真实新拓扑doctor通过…才消费」及 REPORT 表「中文/空格/逗号/点目录逐文件」。本仓真实主题名含非 ASCII，压缩今日不触发，属未来 ASCII 主题批的潜在未测面。

**建议**：把夹具 files 矩阵扩为在各根下补一条「special 名 + ASCII 后代目录」组合（如 nested/中文 空格.txt），或把 covered() 的末段也限制为已测名单形态；改动小且不动形态常量语义。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-write-contract.mjs:10-17 与 scripts/agent-access-evidence.mjs:12-16,27-28` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：contractPath 要求 realpath(root) 与 root 经 normalizedPath 后全等，而 normalizedPath 只剥 macOS 的 /private/var 前缀；若 TMPDIR 指向 /tmp/* 或其它带符号链接别名的路径，createWriteContract/captureWriteContractState 会在 spawn 前抛「写合同根必须是独立真实目录」，使 Codex/write 臂整臂 fail-closed 失败，而同一 fx.root 上 captureReadFileState（仅 lstat 根非软链）与 read/deny 臂照常通过——两采样器对根形态的接受度不对称。

**依据**：读了 scripts/agent-access-write-contract.mjs:10-17（realpath==root 校验）与 scripts/agent-access-evidence.mjs:12-16（normalizedPath 仅 ^\/private\/var 剥离）、:27-28（captureReadFileState 用 lstat 根、无 realpath 校验）；src/trivium/util/fsx.ts:117-119 的 makeTempDir 直接拼 os.tmpdir()，不 realpath。按此代码语义推导（无执行能力，未实测）：/var/folders 路径靠剥离成立，/tmp 路径不成立。属推理结论，实际暴露面取决于机器 TMPDIR。

**建议**：统一根的「真实」判定口径：要么让 normalizedPath 同时剥 /private 别名（或所有已知平台别名），要么让 read/write 两侧采样器共用同一 root 校验函数，避免臂间接受度分叉；至少在 closeout 文档注明 TMPDIR 需为真实路径。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-closeout.mjs:282-284 与 scripts/agent-access-evidence.mjs:6-10` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：catch 分支里 save('failure.json', ...) 自身可能抛错——saveEvidence 以 scanSecrets 失败拒写、且用 flag:'wx' 排他创建；一旦它抛出，第 284 行的 throw error 永远走不到，原始失败原因被 saveEvidence 的次生错误顶替，failure.json 也一并丢失，违背 SKILL/RUNBOOK「各失败脱敏可见」的承诺。

**依据**：读了 scripts/agent-access-closeout.mjs:55（save=saveEvidence）、:282-284（catch 内先 save 再 throw error）与 scripts/agent-access-evidence.mjs:6-10（scanSecrets 命中即 throw、writeFileSync flag:'wx'）。触发路径为推理：原错误消息含凭据形态片段，或同一 out 目录二次失败写 failure.json。概率低但后果是取证面最坏的一种——失败原因被静默替换。

**建议**：把 failure.json 的落盘包一层 try/catch（落盘失败时至少 console.error 原始 error 再抛原始 error），或对 failure.json 用 flag:'w' 覆盖写并容忍脱敏拒写降级为固定文案。

### CLAUDE-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-write-contract.mjs:66-82` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：诊断 reasons 标签粒度过粗：'contract-read-not-completed-at-target' 一条同时容纳会话 exit≠0、timedOut、缺 turn.completed、读事件 cwd 错、parsed_cmd 非唯一/非 read、status/exit 非完成六类以上异因；'missing-or-ambiguous-single-cat' 又把「没有 cat 读」与「cat 读重复」混在一格。该诊断的唯一定位就是人工证据分诊（如 codex-qwen-write4-diagnostic 这类历史样本全靠 reasons 判形），粗标签直接抬高每轮真实取证的复盘成本。

**依据**：读了 scripts/agent-access-write-contract.mjs:47-87 各 reason 聚合条件与 SKILL.md:60 / RUNBOOK_pipeline_ops.md:482「…均false列reasons」的承诺；对照 r10 证据目录存在 codex-qwen-write4-diagnostic.json 这类靠 reasons 分诊的实际用法。函数语义本身正确，属可读性/取证性打磨。

**建议**：把聚合标签按失败类拆成独立 reason（如 session-not-clean、read-coordinate-mismatch、read-duplicate、read-missing），不改判定语义，只细化列名。

## 认为正确的部分

- write-contract 模块把合同命令从 probes/codex.ts 导出的 READONLY_CONTROL_FILE/MARK_* 常量拼装、BREACH 负载按 r22 §6 CLAUDE-04 澄清保留字面并独立锚定，且单测断言 READONLY_CONTROL_PROMPT 含同一固定串，未用共享常量掩盖漂移
- 原 codexCommandEvidence 函数体被测试以 sha256 8662c803… 钉住，write_pass/completed/首词判据逐字未改，诊断 false 不反噬原判据——与设计 v1.3.153 承诺一致
- closeout 的 buildAdmissionPrompt 唯一调用点带条件式第六参，14 样本历史逐字回放 + codex/write 样本显式断言不再相等，未接线的旧五参路径仅作兼容且被测试锁住
- ledgerRoot/evidenceRoot 分离配 nativeVersionFromLedger(root) 的 /ENOENT/ 与 selectedVersion 缺证据负例，闭合了用证据树伪造 native 身份的路径
- SENSITIVE_SCAN_MAX_PARENT_DEPTH 以具名常量+边界注释（父深度8不覆盖）进入 freeze-drift 回归，软链/自环/.git/node_modules 语义有独立负例
- claude 侧 peer_deny_applied 注释在 claude.ts/types.ts/report.ts 三处同步改为「合取不逐条证明本次规则」，兑现了上一轮承诺的口径修正
- consumeClaudeDirectories 只在声明候选时才读两份二进制，directoryDeclarationUsable 的缺 projectHash/缺形态/零 true 一律 fail-closed 回退逐文件

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：未跑 npm run check、未起任何厂商 CLI；REPORT 宣称的 3160通过/3跳过 两遍检查、准入矩阵 5/1/6 与 22 项零 CLI 核验均只核对了文字与代码，未复测
- 五段目录新拓扑的真实机器 doctor 通过与否（报告自述「真机新拓扑未测」）未验证；CLAUDE-01/02 的触发概率均为静态推导，未在任何 TMPDIR 变体上实测
- ~/.trivium/evidence 运行树（预算根 probe.mjs 是否实存、thin_entry_sha256 实际非空效果）与 task.json 运行留痕未逐一核对
- design 文档 §9.4 第8段与 SENSITIVE_SCAN_MAX_PARENT_DEPTH 的「同一边界」交叉引用未逐字核对
- test/fixtures/agent-access-prompt-replay.json 与 claude-deny-paths-replay.json 内部逐样本内容未全文读，仅核对数量、来源声明与被测断言
- 本轮 545 文件中的绝大多数为证据 JSON 归档，只抽查了 README/诊断/冻结类件，未逐件核验 hash 自洽

## 实际查阅的项目文件

- `CLAUDE.md`
- `scripts/agent-access-write-contract.mjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-budget.cjs`
- `scripts/agent-access-selection.mjs（经被审diff）`
- `src/trivium/probes/codex.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/probes/fixture.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/util/fsx.ts`
- `src/trivium/doctor.ts（经被审diff）`
- `src/trivium/freeze.ts（经被审diff）`
- `src/trivium/types.ts（经被审diff）`
- `src/trivium/report.ts（经被审diff）`
- `test/unit/agent-access-write-contract.test.ts`
- `test/unit/agent-access-read-evidence.test.ts`
- `test/unit/agent-access-closeout.test.ts（经被审diff）`
- `test/unit/freeze-drift.test.ts（经被审diff）`
- `test/unit/claude-directory.test.ts（grep 断言行）`
- `test/integration/claude-structured-probe.test.ts（grep 断言行）`
- `skills/dual-critic/SKILL.md（grep 合同契约段）`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md（grep 合同契约段）`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md（经被审diff）`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v14.mjs`
- `.reviews/Agent双模式接入真实准入收口/code/_meta/changes-20261011T122355Z.diff`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r22-codex.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":22,"grep":23,"glob":0,"run_command":0,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
