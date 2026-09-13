---
schema: trivium.review.v1
topic: Agent注册表与多审泛化
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.2
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260913T121713Z
rerun_index: 1
snapshot_hash: sha256:fdccd8aa283cc86bd30e3c506350edaf8a9bc984ddb922baf65a7cc28d7c9d68
blind: true
started_at: 2026-09-13T12:17:13.872Z
finished_at: 2026-09-13T12:28:53.360Z
duration_s: 328
tool_calls:
  read: 44
  grep: 26
  glob: 1
  run_command: 0
  project_reads: 28
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 2
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 7b36cc33-a450-4109-ad76-3e1d17abb52e
---

# 代码审查：Agent注册表与多审泛化

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260913T121713Z`

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险问题在于 freeze() 内部调用 enumerateDenyPaths 时漏传 driver 参数且 FreezeInput 缺少该声明，导致真实流水线中非 Claude Driver 的送审原稿因无 schema 且 role !== 'claude' 被判定为 indeterminate 并推入 denyPaths，审核者读取即触发 peer_leak 熔断。
此外，计划明确批准的 B-8（归档按主题目录剪枝）被遗漏，导致非 Claude Driver 下全仓历史主题的 Claude 原稿全部被当作未识别文件加入禁读集合；B-1 承诺的 topic-args.ts:401 遗漏改造并通过加白绕过了机器对账。
默认双审路径（Claude Driver + Gemini/GLM）在现有参数缺省下行为严格等价，注册表架构与 A-1 二元兜底消除落实到位；建议修齐调用链与剪枝遗漏后推进。

**结论**：`request-changes`

## 审查意见（共 5 条：阻断 1 ｜ 重要 2 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/freeze.ts:187-234` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：freeze() 未暴露且未向 enumerateDenyPaths 透传 driver 参数，导致非 Claude Driver 下被审原稿会被误判为 indeterminate 并强行推入 denyPaths，审核者读取即触发 peer_leak 异常熔断。

**依据**：在 src/trivium/freeze.ts 中，enumerateDenyPaths 虽已支持 driver: AgentId = DEFAULT_DRIVER（行 104），但作为编排器调用入口的 freeze(input: FreezeInput)（行 208）其入参接口 FreezeInput（行 187-205）未声明 driver?: AgentId，且行 234 调用 enumerateDenyPaths(cfg, projectRoot, archiveRoot, critic) 时仅传了 4 个参数。这导致在任何通过 freeze() 的真实运行路径中（如 src/trivium/review.ts:427），driver 恒为 'claude'。当非 Claude 角色（如 ZCode glm）作为 Driver 起草无 schema 的原稿 *-glm.md 时，classifyArtifact 判定 role !== driver（'glm' !== 'claude'）返回 'indeterminate'（行 344），致使本轮送审的原稿被加入禁读清单 denyPaths（行 151）。单元测试 test/unit/deny-matrix.test.ts:1060 因直接绕过 freeze 调用 enumerateDenyPaths 掩盖了该断链。

**建议**：在 FreezeInput 接口中增加 driver?: AgentId 字段，并在 freeze() 调用 enumerateDenyPaths 时显式透传 input.driver。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/freeze.ts:154` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：计划批准的 B-8（freeze.ts 归档按主题目录剪枝）未实现，叠加 classifyArtifact 缺历史推断，导致非 Claude Driver 下全仓历史主题的 Claude 原稿全部被误禁。

**依据**：在已批准的计划修订案 .reviews/Agent注册表与多审泛化/plan/2026-09-13-Agent注册表与多审泛化-revised-claude.md §2.1 表 B-8、§1 AGY-02、§2.2 及 §3 中，明确承诺在 M7a 将 freeze.ts 全归档遍历 walk(archiveRoot) 改为按当前主题目录剪枝，并对 v1 历史主题按 driver = claude 推断。然而在 src/trivium/freeze.ts:154 中，实现依然是全量遍历 await walk(archiveRoot)，且 enumerateDenyPaths 与 classifyArtifact 根本未接收 topic 也未读取 task.json。若当前运行由非 Claude Driver 发起（driver = 'glm'），遍历到全仓任何其它历史主题的 *-claude.md 原稿时，因无 schema 且 role ('claude') !== driver ('glm')，全部被判为 indeterminate 塞入当前运行的 denyPaths 中。

**建议**：落实计划 B-8，使 enumerateDenyPaths 接收当前主题参数并将扫描范围限定在 path.join(archiveRoot, topic)，避免跨主题历史原稿被误判并消除归档遍历的性能隐患。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/topic-args.ts:401` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：topic-args.ts:401 遗漏硬编码改造，仍写死只认 role === 'claude' 原稿，且通过加白豁免绕过了 registry-parity 对账检查。

**依据**：计划修订案 .reviews/Agent注册表与多审泛化/plan/2026-09-13-Agent注册表与多审泛化-revised-claude.md §2.1 表 B-1 明确列出需修改两处：topic.ts:101 与 topic-args.ts:401。但在本次补丁中，仅修改了 src/trivium/topic.ts:106，而 src/trivium/topic-args.ts:401 的 locateSubjectReadOnly 依然硬编码 c.parsed.role === 'claude'。为了让 test/unit/registry-parity.test.ts:164 的 grep 检查通过，直接将 'topic-args.ts' 加入了 LITERAL_ALLOWLIST（行 164）且未标明任何理由。当非 Claude Driver 运行 plan 或 bug 阶段的预检或参数解析时，会报退出码 65（MISSING_ARTIFACT）找不到原稿。

**建议**：为 locateSubjectReadOnly 补充 driver: AgentId = DEFAULT_DRIVER 入参，将行 401 过滤条件改为 c.parsed.role === driver，并在 test/unit/registry-parity.test.ts 中移除无理由加白。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/report.ts:93` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：report.ts 存在同类硬编码 role === 'claude' 未改读注册表与 Driver 参数，被加进对账白名单掩盖。

**依据**：在 src/trivium/report.ts:93（enumerateRounds 中 if (i.parsed.role === 'claude') continue;）以及行 127（loadDisposition 中 i.parsed.role === 'claude'），依然写死字面量 'claude'，与 archive.ts:77、gate.ts:462 重构前的二元假设完全一致。在 test/unit/registry-parity.test.ts:158 中，report.ts 被加入白名单 LITERAL_ALLOWLIST 而未标明原因。非 Claude 作为 Driver 时，复盘报告将无法识别其裁决件且会扰乱轮次统计。

**建议**：参照 archive.ts 与 gate.ts 的模式，为 enumerateRounds 与 loadDisposition 支持 driver 参数，移除写死 claude 的假定。

### AGY-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/disposition.ts:232` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：disposition.ts 对已登记但未启用 Critic 的意见来源报错提示语不准确。

**依据**：在 src/trivium/disposition.ts:263 中，inferSource(id) 虽能通过 agentByFindingId(id) 查到已登记的 Agent（例如 CODEX），但因 CRITICS.includes(agent.id as CriticId) 为假而返回 null。随后在行 232 报出的错误提示为：且编号前缀不属于任何已登记 Agent。然而事实上该前缀属于已登记的 Agent（codex），只是当前阶段未启用为 Critic，报错提示与事实冲突，误导开发者。

**建议**：区分「未登记 Agent」与「已登记但未作为审核者启用（未在 CRITICS 中）」两种情形，优化报错诊断信息。

## 认为正确的部分

- Agent 注册表（src/trivium/agents/registry.ts）作为单一真相源设计完整，正确抽象了 AgentId、display、vendor、findingPrefix 及交替正则派生，为多审泛化奠定了清晰基础。
- 默认双审路径（Driver=claude，critics=['gemini', 'glm']）经逐项核对保持了严格的行为等价性，archive.ts、gate.ts、naming.ts、types.ts 的缺省参数均与重构前语义完全一致。
- disposition.ts 彻底移除了 id.startsWith('AGY-') ? 'gemini' : 'glm' 的二元假定（A-1），未匹配项显式置 null 并在解析阶段报错，根治了第三方意见被静默挪移的隐患。
- gate.ts:419 的 loadRoundReviews 改由 criticsOf(runMeta) 动态驱动（B-5），消除了写死两家导致的静默漏裁盲区。
- deny-matrix.test.ts 与 registry-parity.test.ts 构建了扎实的单元与派生一致性守卫，跨轮角色翻转正例与前缀互斥断言有效守住了核心边界。

## 未覆盖范围（本侧盲区）

- 真实拉起外部 CLI（如 codex exec、claude headless、agy、zcode）的子进程执行流与事件流回读，因二次审查员无执行写命令与拉起外部进程权限，无法在本轮执行。
- 真实多轮运行下的配额消耗与跨网络 API 延时。
- 非 macOS 平台的兼容性表现（当前 TriviumCode 深度绑定 macOS 与 VS Code）。
- M7b 及后续里程碑中的契约升版（config.v2/run.v2）、CLI 旗标多审调度与适配器接入细节。

## 实际查阅的项目文件

- `.reviews/Agent注册表与多审泛化/code/_meta/changes-20260913T121713Z.diff`
- `.reviews/Agent注册表与多审泛化/plan/2026-09-13-Agent注册表与多审泛化-revised-claude.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-13-通用Agent编排与动态多审设计-glm.md`
- `src/trivium/agents/registry.ts`
- `src/trivium/freeze.ts`
- `src/trivium/gate.ts`
- `src/trivium/archive.ts`
- `src/trivium/naming.ts`
- `src/trivium/disposition.ts`
- `src/trivium/topic.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/types.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/review.ts`
- `src/trivium/meta.ts`
- `src/trivium/render.ts`
- `src/trivium/divergence.ts`
- `src/trivium/hooks.ts`
- `src/trivium/schemas.ts`
- `src/trivium/parse.ts`
- `src/trivium/cli.ts`
- `src/trivium/brief.ts`
- `src/trivium/report.ts`
- `test/unit/deny-matrix.test.ts`
- `test/unit/registry-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":44,"grep":26,"glob":1,"run_command":0,"project_reads":28}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
