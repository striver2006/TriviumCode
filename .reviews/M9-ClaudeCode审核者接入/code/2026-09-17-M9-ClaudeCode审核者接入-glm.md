---
schema: trivium.review.v1
topic: M9-ClaudeCode审核者接入
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.5
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260917T151624Z
rerun_index: 1
snapshot_hash: sha256:a0015ec1bc42e355743eb642f1498aa8d519bd745bcbc84178ae7bb33b52212f
blind: true
started_at: 2026-09-17T15:16:25.629Z
finished_at: 2026-09-17T15:28:47.771Z
duration_s: 742
tool_calls:
  read: 13
  grep: 5
  glob: 0
  run_command: 0
  project_reads: 12
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 3
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_0a119831-7c0a-452a-95a6-7b9a477993cf
---

# 代码审查：M9-ClaudeCode审核者接入

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260917T151624Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险一条：strict_mcp_config_applied 的生产侧会从「从未核实的空 readonly_flags」算出 false，doctor 新 blocker ②' 据此把未登录/断网这类「没测到」状态判成「已核实的失守」blocker，并截住 ⑤/⑥ 的诚实诊断（GLM-01，major）。②' 在判定函数内的排序、null 放行与 skipModelCalls 门控本身正确且有测试钉住；EV-40 换「干净拒绝」判据方向成立、四格三态测试到位，三字段各有真消费方、config schema 无需同步。其余：breach 路径会产出 strict=true 与 flags=[] 的矛盾落盘（GLM-02）；EV-40 负对照缺正对照前置、坏机器上记假 true（GLM-03）；回填漏了设计 §3.7 事实表两行（GLM-04）与版本历史行（GLM-05）。

**结论**：`request-changes`

## 审查意见（共 5 条：重要 1 ｜ 次要 3 ｜ 吹毛求疵 1）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:741（消费侧 src/trivium/doctor.ts:277-287）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：strict_mcp_config_applied 的赋值在 `if (read.init)…else` 之后无条件执行，而「读探针没拿到 system/init」分支（claude.ts:719-727）只置 tool_surface_checked=false、不清 readonly_flags。全新机器上该数组是初始 []（config.ts:110 defaultProbe），于是 [].includes('--strict-mcp-config') 落 false，探针还在 742-747 推出「该侧不可用于审查」的失守 note。doctor ②'（doctor.ts:277）只判 === false：null 与 skipModelCalls 都正确放过，但没有 ② 那道 tool_surface_checked === true 前置（doctor.ts:252-265）——于是未登录、断网、spawn 报错等「整轮什么都没测到」的机器会收到安全失守指控的 blocker，且 ②' 在 ⑤（doctor.ts:313）⑥（doctor.ts:326）之前 return，把「登录态过期…请重跑」的诚实提示压掉。这正是 doctor.ts:719-726 注释与 claude-severity.test.ts:103-132（AGY-02≡GLM-01，flags 空集双义）早已修掉的同形塌缩在新字段上的复发，也直接命中本次审查焦点「有没有把没测到判成失守」。测试缺口：新增四条用例（claude-severity.test.ts:226-270）全部基于 healthy 夹具（tool_surface_checked: true），从未构造生产侧真实产出的 {tool_surface_checked: false, readonly_flags: [], strict_mcp_config_applied: false} 组合，所以这条不会被现有测试打红。

**依据**：实读 src/trivium/probes/claude.ts 全文（741 行赋值位置、719-727 无 init 分支保留旧值、571-594 existing 克隆与初始空数组）、src/trivium/doctor.ts 全文（claudeSeverity 完整分支序与各自前置）、src/trivium/config.ts:103-117（defaultProbe 的 claude 空壳 readonly_flags: []）、test/unit/claude-severity.test.ts 全文（healthy 基座与四条新用例的取值域）。

**建议**：生产侧只在「本轮确实建立过 flags」时计算该字段：tool_surface_checked === true 才赋值、否则置 null（与本仓三态纪律一致）；或判定侧给 ②' 加与 ② 同款的已核实前置。无论取哪侧，补一条 {checked: false, flags: [], strict: false} → note（不得 blocker）的判定用例。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:771` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：readonly_breach 成立的分支在 771 行把 readonly_flags 清成 []，但 strict_mcp_config_applied 已在 741 行算完、不回改。落盘出现 {readonly_flags: [], strict_mcp_config_applied: true} 的组合——types.ts:623-624 声明「今天两者恰好同真同假，因为该数组要么是整份常量、要么被清空」，doctor ②' 注释同引此说，而代码自己就生产出违反该不变量的数据。doctor 判定侥幸正确（① breach 先 fire），但字段契约文档与实现分叉；types.ts:628 点名的消费方 M9 availability() 若只读这个布尔，会在「负对照真落了文件」的机器上拿到 true。

**依据**：src/trivium/probes/claude.ts:741（先算）与 765-773（后清 flags、不动 strict）的顺序对照；src/trivium/types.ts:616-630 的字段契约原文。

**建议**：清 flags 的各落点（至少 771 行）同步把 strict 置 false，或把赋值挪到全部清空点之后统一计算，使「同真同假」的断言重新为真。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:413-423` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：EV-40 负对照判据的 true 格是 exitCode !== 0 && emitted === 0，但这个观测与「CLI 因绑定之外的原因失败」不可区分：未登录、网络不通、配额拒绝等在 API 调用前失败的形态同样是退非零、零事件。JSDoc（361-384）声明正对照「由本文件其余 execProbe 证着」，却没把它用作前置——同轮 read 探针失败时照样记 true，违反 types.ts:609「null = 未测」的字段契约（同场景下 headless_read_ok 老实落 null，形成对照）。另外 run() 在 spawn error 与信号致死时 code 为 null（util/exec.ts:193-196、finish(code,signal)），exitCode === null 同样满足 !== 0；测试只锁了 timedOut: true 的 null（claude-events.test.ts:553-560），exitCode: null && timedOut: false 这一格无断言。当前消费方仅人读 note，实害有限，但这是「把没测到记成确定结论」同族。

**依据**：src/trivium/probes/claude.ts:385-423（probeStreamVerboseBinding 与 judgeVerboseBinding 全文）；src/trivium/util/exec.ts:56-70、172-206（RunResult.code 的 null 来源）；test/unit/claude-events.test.ts:527-573（四格用例覆盖面）；src/trivium/types.ts:600-615（字段契约）。

**建议**：判据把 true 格收紧为「有限的非零退出码」（typeof exitCode === 'number' && exitCode !== 0）；探针侧以「本轮带 --verbose 的探测确实产出过事件」为前置，正对照不成立时记 null。

### GLM-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:344-358` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：设计 §3.7 的「探针项→实测结论→落盘字段」表没有为两个新 ClaudeProbe 字段立行：stream_json_requires_verbose 与 strict_mcp_config_applied 只出现在 §3.7.1 的 argv 分工表与 §11.1，而 §3.7 表才是 claude 探针字段的清点处——本次 diff 还主动更新了表中 denied_tool_in_trace 一行，说明该表被当作活清单维护；§3.6 codex 表逐字段全列是先例。path_deny 行（357）的落盘列也仍只写 .supported / .rule_syntax，未带新字段 .coverage_complete。M9 第 3 步写 adapters/claude.ts 的人按 §3.7 找字段清单会漏掉这两项，属「设计与回填漏掉落点」。

**依据**：实读设计文档 §3.5-§3.7.1（245-433 行）：§3.7 表现行 13 行无新字段行；§3.6 codex 表逐字段全列；types.ts:600-630 两个新字段及其落盘名。

**建议**：§3.7 表补两行（含三态语义与消费方指向），path_deny 行落盘列补 .coverage_complete。

### GLM-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:6` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：本次对设计正文做了实质修订（EV-40/41 结案、第三类清空为空集、两问式段落的例证更正、§3.7.1 stdin 行改判），但文件头仍是 v1.3.19、版本历史未加行——最新一条 v1.3.19 记的是 EV-12 r2 修复，与本次内容无关。此前连续四版（v1.3.16~v1.3.19，均为 2026-09-17）每次落改动都带历史行，v1.3.16 甚至注明「非里程碑推进」也照记。若这是刻意留待 M9 整体收口一并升版，该决定目前无留痕。

**依据**：实读设计文档头部（第 6 行「当前版本：v1.3.19」）与版本历史区（3155-3158 行 v1.3.16~v1.3.19 各行内容）；被审 diff 对该文档的三处 hunk 均不在头部与历史表。

**建议**：按惯例补 v1.3.20 历史行（EV-40/41 结案 + 第三类清空），或在留痕中写明「升版留待 M9 收口」及理由。

## 认为正确的部分

- ②' 在 claudeSeverity 内的排序本身正确：① 负对照落文件 → ② 工具面脏 → ②' MCP 硬前置 → ③ 信任 → ④ 读失败 → ⑤/⑥ 泛化 null，「确证先于推断、特化先于泛化」的次序成立；null 放行与 skipModelCalls 门控和 ② 同口径，且四条新用例（含「null 是没测到」与顺序断言）把这些钉住了。
- EV-40 换判据的方向正确：在实测形态（硬拒绝）下「干净拒绝」比「数事件条数」更不歧义且负对照零成本；刻意不匹配 stderr 文案、判据抽成纯函数并配四格三态测试，与消掉 path_deny 字面反解是同一条纪律。降级形态（退 0 少吐事件）如今落 false 但附带「该行都要复核」的 ⚠️ note，漂移仍可见。
- 三个新字段各有真消费方：strict_mcp_config_applied → claudeSeverity ②' 与探针 note；stream_json_requires_verbose 与 coverage_complete → 探针三态 note 文案（probes/claude.ts:878-901），后者确已替掉 includes('Grep 绕得过') 的中文反解。config.v2.json 的 commonProbe 对各家专属字段 additionalProperties:true，新字段无需 schema 同步，这一落点没漏。
- STRICT_MCP_CONFIG_FLAG 提成具名常量并留在 probes/ 下，与 registry-parity 第 6 条防空转腿（配方族 token 必须仍在 probes/ 出现，registry-parity.test.ts:1277-1292）兼容，注释自述的约束与测试实现吻合。
- EV-41 结案的回填如实：设计 §3.7.1 stdin 行、BACKLOG EV-41、新实测报告三处一致，两处边界（形态 C 证据强度低、「-」是否 stdin 标记未区分）均如实登记未夸大。

## 未覆盖范围（本侧盲区）

- 只读审查：未运行 npm run typecheck / build / test（构建与测试均为写操作），全部结论来自静态阅读；BACKLOG 所称「变异验证过」按既有测试用例文本核对，未复跑验证。
- 未读 .trivium/ 与 ~/.trivium/runs（任务书 §8 禁读/敏感面），§7.3 的落盘核验值按报告引用采信。
- M9 计划稿与裁决件位于 .reviews/M9-ClaudeCode审核者接入/plan/（含禁读文件），未对照计划核对第 1/2 步是否偏离承诺边界与预算刹车口径。
- 报告中的实测数字（31,913 字节、$0.044/次、11 条事件、24 倍成本、2.1.273 版本）无法独立复现，按报告采信。
- dist/ 与 skills/dual-critic/scripts/trivium.cjs 为生成物，未核对其与源码的一致性；doctor --selftest 桩路径下 ②' 的表现未验证。

## 实际查阅的项目文件

- `.reviews/M9-ClaudeCode审核者接入/code/_meta/changes-20260917T151624Z.diff`
- `src/trivium/probes/claude.ts`
- `src/trivium/doctor.ts`
- `src/trivium/config.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `test/unit/claude-severity.test.ts`
- `test/unit/claude-events.test.ts`
- `test/unit/registry-parity.test.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `skills/dual-critic/schema/config.v2.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":13,"grep":5,"glob":0,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
