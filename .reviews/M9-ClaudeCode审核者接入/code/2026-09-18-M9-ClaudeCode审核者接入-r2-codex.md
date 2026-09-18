---
schema: trivium.review.v1
topic: M9-ClaudeCode审核者接入
stage: code
role: codex
vendor: openai
agent_cli: codex/0.154.0
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260917T162023Z
rerun_index: 2
snapshot_hash: sha256:e1c25fdd0a3170b48b2ea4c62426c9d120434484fd6826044246a42c6fb627af
blind: true
started_at: 2026-09-17T16:20:24.364Z
finished_at: 2026-09-17T17:16:39.670Z
duration_s: 3375
tool_calls:
  run_command: 62
  project_reads: 37
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 4
  minor: 3
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0b02b-5324-7f01-a8fc-a7c23c81d251
---

# 代码审查：M9-ClaudeCode审核者接入

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260917T162023Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

两层修法方向对、纵深用例确实把第二层钉住了（去掉 ②' 两道前置当场红），夹具改推导也比上一版诚实；但四点未收。最危险的是 CODEX-01：`probeArgs` 的 `promptVia: 'stdin'` 分支是非功能化的死路（无任何调用方、`execProbe` 固定 `stdin: ''`、且 `adapters/` 被契约禁止 import `probes/`），设计 §3.7.1 却拿它当「复验不必复制配方」的保证——这句话会把 M9 第 3 步引向一条走不通的路。其次 CODEX-02：EV-40 的 true 臂仍漏一格（判据完全不看 stderr，任何「非零退出 + stdout 零字节」的静默失败在正对照成立时被记成「实测确证」，漂移当天恰好不可见）。CODEX-03：`healthy()` 的推导把默认值抄了第二份，与它自己 JSDoc「再也分不开」不符。CODEX-06：`coverage_complete` 的「形状一致」只在 defaultProbe 做齐，真实产出的若干路径仍不带这一格。另有四处回填/措辞问题。

**结论**：`request-changes`

## 审查意见（共 8 条：重要 4 ｜ 次要 3 ｜ 吹毛求疵 1）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:101-135（promptVia 分支）；doc/02_design/…设计.md:401（3.7.1 stdin 行的括号保证）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：为「第 3 步在 stdin 形态复验」预留的 `promptVia` 分支是**不可用的死路**，而设计把它写成一份保证。三件事叠在一起：①全仓没有任何调用方传 `promptVia`（只有类型声明与 `viaStdin` 两处自用），分支零覆盖；②该分支只负责**不**把 prompt 放进 argv，而唯一的执行封装 `execProbe` 固定传 `stdin: ''`（claude.ts:431-435）——即便有人传 `promptVia:'stdin'`，prompt 也送不进去，等于发一次没有 prompt 的调用；③设计 §3.7.1 说「`probeArgs` 已留 `promptVia` 分支，复验不必复制配方」，但 `adapters/` 不得 import `probes/` 是既有契约（registry-parity:1058），M9 适配层本来就用不到这个函数。于是这句话既是失实断言，又会诱导 M9 第 3 步去找一条不存在的通路。

**依据**：src/trivium/probes/claude.ts:113（`promptVia?: 'argv' | 'stdin'`）、:115、:133-134（仅在 false 分支放入 argv）、:425-436（`execProbe` 硬编码 `stdin: ''`，且不接 promptVia）；grep 全仓 `promptVia` 仅命中本文件与该行设计；test/unit/registry-parity.test.ts:1058-1075（adapters/ 不得 import probes/）；设计 §3.7.1 line 401 原文「复验不必复制配方」。

**建议**：二选一：要么**把复验真的落到探针侧**——给 `execProbe` 加「prompt 写进 stdin」的能力、探针自己补一臂 stdin 形态的负对照并加用例（分支从此有消费方），要么删掉 `promptVia` 分支，并把设计 §3.7.1 那半句改准为「复验需在 `adapters/claude.ts` 内自建 stdin 配方、按 EV-41 §1.4 的边界逐格重测」。不留「有分支=有通路」的中间态。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:482-493、514-547（judgeVerboseBinding / probeStreamVerboseBinding）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：EV-40 的 true 臂还差一格没收：判据输入是 `{exitCode, stdout, timedOut, positiveControlOk}`，**完全没有 stderr**。于是「非零退出 + stdout 零可解析事件」这一形态，除了参数拒绝之外还有别的成因——配额/计费闸门掐断、CLI 自身崩溃、外部原因带退出码终止——在正对照本轮成立（读探针成功，二者之间还隔着 deny 探针等若干次调用）时，全都会被记成 `true` = 「实测确证硬前置成立」。误判方向恰好是本条要买的东西的反面：真漂移发生的那天，如果负对照同时因别的原因失败，字段落 `true`，漂移永久不可见，且 notes 会给出一句肯定语气的确证文案。

**依据**：claude.ts:531 已收「拿不到退出码」那一格（`typeof exitCode !== 'number' → null`），:536 收正对照格，:540 `exitCode !== 0 && emitted === 0 → true` 是最后一条未收的路径；:482-492 只透传 `r.code / r.stdout / r.timedOut`，`r.stderr` 从未参与判据；test/unit/claude-events.test.ts:327 的三态用例同样只喂 stdout（`'{ 不是合法 JSON'`），说明判据侧结构上就看不到 stderr。

**建议**：给 `judgeVerboseBinding` 的入参加 `stderrHasOutput: boolean`（或 `stderrLength`），true 臂要求「非零退出 **且** stdout 零事件 **且** stderr 非空」——这是**有无**判据，不是文案匹配，不违背本条刻意不匹配 `requires --verbose` 字串的纪律（报告 §7.2 的理由仍然成立）。同步把四格三态表补成五格，并加一条「非零 + 两头皆空 ⇒ null」的用例。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/claude-severity.test.ts:15-50（healthy 的推导块）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：夹具改推导后带出了它自己要防的那种「两处各存一份」。`healthy()` 的对象字面量在 line 21 给 `readonly_flags` 写了默认清单，line 45-48 的推导又写了**第二份同样的清单**作为 `over.readonly_flags` 缺省值；同理 `tool_surface_checked` 在 :22 与 :46 各一份。JSDoc 却声明「夹具代表的机器与探针真会产出的值**再也分不开**」。实际是：改 line 21 的默认清单（例如有人为了模拟漂移把 `--strict-mcp-config` 从默认清单里删掉）不会让推导跟着变，夹具就落出一个 `{readonly_flags: 不含硬前置, strict_mcp_config_applied: true}` 的自相矛盾组合——正是上一轮 GLM-02 抓到的那个形状，而且没有任何对账用例能发现。

**依据**：test/unit/claude-severity.test.ts:21（`readonly_flags: ['--restricted','--strict-mcp-config','--tools','Read,Grep,Glob']`）与 :47（同一清单的第二份字面量）；:22 `tool_surface_checked: true` 与 :46 `?? true`；对照 :30-43 的 JSDoc 承诺。该文件内亦无任何断言比较这两处。

**建议**：让推导读**合并后的对象**而不是 `over`：先 `const base = {…defaultProbe().cli.claude, …固定项, …over}`，再 `strict_mcp_config_applied: judgeStrictMcpConfig(base.tool_surface_checked, base.readonly_flags)`，默认清单只留一份（并可直接引用导出的 `READONLY_INVARIANTS` 作缺省，与 claude-events.test.ts 的用 `READONLY_INVARIANTS` 那组用例同源）。这样 JSDoc 那句话才成立。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/08_project/BACKLOG.md:137-138；doc/02_design/…设计.md:363、401、2812` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：本版新登记了三处 M9 第 3 步的前置待定项，却一条 EV 都没补，而 EV-40 / EV-41 同时转了 done——待办池在这一格净变薄。三处是：①3.7 表新增的「`rule_syntax` 落的是目录 glob、`deny_paths` 是逐文件清单，**等价性未验**，M9 第 3 步接适配器前须补测」；②3.7.1 stdin 行新增的「本表其余各格都是在**探针的 argv 形态**下测的，stdin 形态是否同结论未验，第 3 步须复验」；③16.1 M9 行的「第 ⑤ 件对 claude 侧的取舍待代码双审裁定」。它们只活在表格与注释里。

**依据**：doc/08_project/BACKLOG.md 全文 grep `等价` / `复验` / `rule_syntax` / `身份片段` 均无命中（唯一 `复验` 命中是 M1 的 `reclaimStaleLock`），EV-40/EV-41 两行现为 done；设计 line 363（形状等价性未验）、line 401（stdin 形态未验）、line 2812（第 ⑤ 件取舍待定）。对照 EV-41 条目自己的登记理由：「此前只活在 3.7.1 散文里，按本项目『登记才算承诺边界』的口径补登」。

**建议**：为 ①②③ 各补一条 EV（或一条合并条目、按触发点分行），触发条件统一写「M9 创建 `adapters/claude.ts` 时一并做」，与既有的 EV-39 同形；③若确实要留给本轮代码双审裁定，也在 BACKLOG 记一条 `doing`，别让它只存在于里程碑表的状态列里。

### CODEX-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/types.ts:634-643；src/trivium/probes/claude.ts:189-198` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：两处都断言 `strict_mcp_config_applied` 与 `readonly_flags.length > 0`「今天恰好同真同假」，并把这当成搬到清空点之后求值的收益。但产出侧清空 `readonly_flags` 的路径有三条，其中「`system/init` 的 tools 读回为空」那条同时把 `tool_surface_checked` 置 false（claude.ts:816-817），于是该路径下字段是 `null`、`length > 0` 是 `false` —— 一个 null 一个 false，「同真同假」不成立。probe 注释自己也写了末行只把「breach 与工具面脏」两种清空算 false，与 types.ts 那句「要么整份常量、要么被清空」并不等价。这是一句没有断言守着、且按现实现为假的等价断言。

**依据**：src/trivium/probes/claude.ts:812-821（empty 分支：`tool_surface_checked = false; readonly_flags = []`）、:823（脏分支：只清 flags）、:191-197（承认只有两种清空算 false）；src/trivium/types.ts:637-638（「不与 length>0 等价。今天两者恰好同真同假，因为该数组要么是整份常量、要么被清空」）；test/unit/claude-events.test.ts 的两组 judgeStrictMcpConfig 用例锁的是判据本身，没有任何用例锁这个等价关系。

**建议**：把这句等价断言改成可核的陈述：「`false` 当且仅当已核对且组合内确无该旗标（含 breach 与工具面脏两种清空）；`null` 当且仅当本轮没核对成（含 tools 读回为空）」，或者直接删掉等价句——判据表已经说清了。若坚持保留，就在 claude-events.test.ts 补一条 `judgeStrictMcpConfig(false, []) === null` 与「length>0 真但字段 null」并存的对账用例。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/config.ts:37-50；src/trivium/probes/claude.ts:578-585；probes/agy.ts:336-342；probes/zcode.ts:409-415；probes/codex.ts:680` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：新增 `coverage_complete` 的理由被写在 `emptyCommonProbe` 的注释里——「不给就会让**空壳与探针真实产出的形状不一致**，读盘侧看不出这一格存在」。但真实产出这一侧没同步：claude 自己的 path_deny 早退分支（未跑完）返回的对象不带 `coverage_complete`，agy / zcode / codex 三家探针函数构造的 `path_deny` 也一律不带。于是改完之后，**恰恰是真实产出**（`doctor` 跑过一轮后落进 config.local.yaml 的形状）在多数路径上缺这一格，而空壳有它——目标反了。可选字段（`?:`）意味着读侧仍分不清「没有这一格」与「没测到」。

**依据**：src/trivium/config.ts:44-48（新增该键并写明理由）；src/trivium/probes/claude.ts:578-584（`if (!t.completed) return { supported: null, rule_syntax: null, method: …, attempts: [] }` —— 无该键）；probes/agy.ts:336-342、probes/zcode.ts:409-415、probes/codex.ts:680 与 :778（probeCodexPathDeny 返回体同样只含四键）；skills/dual-critic/schema/config.v2.json:703（`path_deny` 只校 `type: object`，不约束键集，故形状漂移不会被打红）。

**建议**：把 path_deny 的空壳抽成单一构造函数（导出 `emptyPathDeny()`，各家与 claude 早退分支都走它），或至少补齐上述四条真实产出路径的 `coverage_complete: null`；并在 registry-parity 或契约测试里加一条「真实产出的 path_deny 键集 ⊇ 空壳键集」的兜底对账——与纪律 12 的「schema 全目录兜底扫描、不靠记性」同一手法。

### CODEX-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/…设计.md:345、352（3.7 表头与 entrypoint/version 行）vs 358、364-365` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：§3.7 表的版本环境行没跟上新回填。表头仍写「**实测环境**：`claude 2.1.270` … 2026-09-14」，`entrypoint/version` 行仍写 `2.1.270`；而本版新填进去的三格数据（`denied_tool_in_trace` 正向样本、`stream_json_requires_verbose`、`strict_mcp_config_applied`）逐格标的是 2.1.273。该表顶部明写「CLI 在活跃迭代，下表是**版本相关**的事实」，那么混合两个版本的表就必须分层标注环境，否则后来者会以为 2.1.273 的结论是 2.1.270 上测的——这与 M6 报告「凡与实测冲突以实测为准」的口径也对不上。

**依据**：设计 line 345（实测环境 2.1.270）、line 352（version 行 2.1.270）、line 358/364/365（新增三格写 2.1.273）；REPORT_2026-09-17_m9_claude_entry_probe.md 头部（「本机 `claude 2.1.273`；探针结论落盘时是 2.1.272，版本漂移先记一笔」）与 §7.3 落盘核验（`version: 2.1.273`）；REPORT_2026-09-14_m6_claude_probe.md:4（2.1.270）。另：报告说探针原记 2.1.272，而 §3.7 环境行是 2.1.270，两个「原记」值互不相容，总有一处是失实的。

**建议**：§3.7 环境行改为分层（「M6 初测：2.1.270（2026-09-14）；M9 第 1～2 步补测/重跑：2.1.273（2026-09-17）」），并在混合版本的那几格保留已有的行内版本标注；同时核一遍「探针原记 2.1.272」与 §3.7 表的 2.1.270 谁对，改准其一。

### CODEX-08 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:1036、473-493` |
| 类别 | performance ｜ 层次 code |
| 置信度 | medium |

**问题**：正对照本轮已知失败时（未登录 / 断网 / slug 失效 ⇒ `read.completed === false`），负对照那一臂**照样无条件 spawn 一次 claude**，最坏吃满 `PROBE_TIMEOUT_MS = 180_000`，而它的结论随后必然被 `judgeVerboseBinding` 的 `!positiveControlOk` 判成 `null` 丢弃。等于在最不健康的机器上，每轮 claude 探测白多一次进程与一段墙钟——正是本轮「不烧无用调用」预算口径想省的那类。

**依据**：claude.ts:1036 调用点无前置短路；:482-486 直接 `run(bin, probeArgs({…omitVerbose:true}), {timeoutMs: PROBE_TIMEOUT_MS})`；:536 才判 `!o.positiveControlOk → null`。报告 §7.1/§8 的调用预算口径（12 次封顶、按臂计数）也把这一臂算在实耗里。

**建议**：在 `probeStreamVerboseBinding` 开头 `if (!positiveControlOk) return null;`（并在返回 null 的 notes 文案里保留「本轮正对照未跑通」那句现有分述），或退一步把这一臂的 `timeoutMs` 收到远小于 180s（参数拒绝是即时的）。

## 认为正确的部分

- 两层修法的**分工**判得对：产出侧 `judgeStrictMcpConfig` 把「没核对成」收成 `null`（claude.ts:199-205），判定侧 ②' 的 `tool_surface_checked === true` 与 `readonly_flags.length > 0` 两道前置不复用上游结论（doctor.ts:290-295），且「不靠 ①② 排在前面侥幸」这条理由成立——`[回归] 空数组 + 已核对由 ①② 认领` 用例（claude-severity.test.ts:313-330）确实锁住了这一点。
- 纵深用例是**有效**的纵深：它用 `pinned()` 绕过推导、注入「上游退化后会送来的坏值」（claude-severity.test.ts:332-360）。我实跑并推演过：把 ②' 的两道前置去掉，该用例当场红；把判据退回无条件反算，严重度用例不红且这是对的——报告 §8.2 第二行的记录没有夸大。
- 赋值搬到全部清空点之后（claude.ts:947 位于 :812-823 与 :882 之后）确实消掉了 `{readonly_flags: [], strict_mcp_config_applied: true}` 这一自相矛盾组合，位置即判据这条记法可核。
- `eventCount` 由 `parseClaudeEvents` 统一给出（claude.ts:310-335、538-539），使「什么算一条事件」不再两处各存一份；`judgeDenyCoverage` 从带 I/O 的 `probeClaudePathDeny` 里抽成纯函数并配三态用例（claude-events.test.ts:405-410 附近），与 AGENTS 纪律「埋在探针里等于没有断言守着」一致。
- 刻意不匹配 stderr 文案这条决定本身是对的（文案匹配失效方向是放松，与刚消掉的 `includes('Grep 绕得过')` 同形），我只在 CODEX-02 里提「有无」这一层，不建议恢复文案匹配。
- `STRICT_MCP_CONFIG_FLAG` 提成具名常量并留在 `probes/` 下，理由（防空转腿的判据位置）与 registry-parity:1277-1292 的实际实现相符；反向对账「探针配方常量 ⊆ 黑名单」仍在位，本次没动 READONLY_INVARIANTS 的取值，未触发该腿。
- `criticEnabled` 仍为 `false`（agents/registry.ts:136），「两步不改对外行为」这句断言与代码一致；`defaultProbe()` 与 `emptyCommonProbe()` 都补了新键，形状基线方向正确（残留缺口见 CODEX-06）。
- EV-41 的两处边界如实登记（形态 C 只证明送达；无实验能区分 `-` 是 stdin 标记与被忽略），报告 §1.3/§1.4 与 BACKLOG line 138 的表述一致，没有把它写成「三种形态等价可随意选」。

## 未覆盖范围（本侧盲区）

- 没有真跑任何 `claude` CLI 调用去复现 EV-40/EV-41 的厂商事实（沙箱只读且禁网）：2.1.273 上「不带 `--verbose` ⇒ 退 1、零事件、零 API 调用」我按报告与代码采信，未独立实测。CODEX-02 因此是**结构分析**（判据输入里没有 stderr），不是复现出的失败样本。
- M9 第 3 步的落地面（`adapters/claude.ts`、`availability()`、`readonlyArgsFromProbe` 的实际拼装、stdin 送 prompt 的进程生命周期）不在被审补丁里，我只能就本补丁留下的接口与断言做可行性判断。
- 未审 gate / freeze / brief / runner 侧对本轮新字段的消费面（本补丁未触及），也未核对 `trivium doctor --selftest` 14 步与 `--no-model-calls` 全链路的实际表现。
- `skills/dual-critic/schema/*.json` 与 PROTOCOL 文档是否需要同步本次三个机读字段，我只查了 `config.v2.json` 的 `path_deny` 与 `probe` 段形状（结论：只校 `type: object`，无强制键集），未逐份对账 review/run/disposition/schema 扫描盯防点与 AGENTS 同步清单的全部条目。
- 跨平台面（Linux/Windows、非 ASCII 路径、`os.homedir()` 与 `~/.local/bin/claude` 候选序）本轮补丁未改 `probeClaudeBin`，我没审；`/usr/bin/which` 之类 macOS 假设只在既有代码里，未纳入本次结论。
- 没有读 `dist/` 之外的安装副本（`~/.claude/skills/.../trivium.cjs`），故「改完必须 `node dist/install.cjs` 才生效」那条已知坑是否影响本轮 doctor 实跑结论，未验证。
- 上一轮我自己那三份意见（含被驳回的 CODEX-05）与裁决件我只按任务书许可读了自己那一份的路径存在性，未逐条重审裁决是否恰当。

## 实际查阅的项目文件

- `AGENTS.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md`
- `doc/05_testing/REPORT_2026-09-14_m6_claude_probe.md`
- `doc/05_testing/REPORT_2026-09-17_m9_claude_entry_probe.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/config.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/probes/agy.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/zcode.ts`
- `test/unit/claude-events.test.ts`
- `test/unit/claude-severity.test.ts`
- `test/unit/registry-parity.test.ts`
- `skills/dual-critic/schema/config.v2.json`
- `doc/05_testing/REPORT_2026-09-16_m8_ac20_acceptance.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":62,"project_reads":37}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
