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
run_id: 20260917T162023Z
rerun_index: 2
snapshot_hash: sha256:e1c25fdd0a3170b48b2ea4c62426c9d120434484fd6826044246a42c6fb627af
blind: true
started_at: 2026-09-17T16:20:24.364Z
finished_at: 2026-09-17T17:16:39.670Z
duration_s: 699
tool_calls:
  read: 14
  grep: 7
  glob: 1
  run_command: 0
  project_reads: 12
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 3
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_eba34768-c92d-4a75-bc59-418ad439d2bf
---

# 代码审查：M9-ClaudeCode审核者接入

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260917T162023Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

r1 阻断的两层修法核实各自独立成立：产出侧 judgeStrictMcpConfig（checked!==true 一律 null，赋值确在三个清空点之后）与判定侧 ②' 的三道前置，任一层单独都能拦住「未测机器被判安全失守」；【纵深】用例以 pinned() 注入上游坏值，把修好后走不到的第二层在自己的论域验到了。夹具推导方向正确，unmeasured() 的形状与未登录机器上探针真实产出一致（breach 在模型没跑时确实落 false）。设计 v1.3.20 回填逐条与代码对上：§3.7 两新行、§3.7.1 两行、registry criticEnabled=false、config.v2 的 commonProbe additionalProperties:true 放行三个新字段——无需 schema 同步这一点没漏。残留集中在「修法本体没有守卫」：EV-40 负对照的唯一输入开关 omitVerbose（probeArgs 新分支）与 strict 赋值『挪到清空点之后』的位置，都只有注释、无机器守卫，同形回归时没有任何测试会红（GLM-r2-01/03）；EV-40 正对照取本轮第一个模型调用、距负对照隔四次调用，中途环境劣化仍会误记 true（GLM-r2-02）。结论 request-changes：两层修法与回填本身不用动，缺的是给它们自己补守卫。

**结论**：`request-changes`

## 审查意见（共 6 条：次要 3 ｜ 吹毛求疵 3）

### GLM-r2-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:122` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：本 diff 给模块私有的 probeArgs 加了两个条件分支——omitVerbose（:100/:122，EV-40 负对照的唯一输入侧开关）与 promptVia（:113/:134，设计 §3.7.1 明说第 3 步复验要靠它），两者都没有任何机器守卫：probeArgs 未导出，test/unit/claude-events.test.ts 只断言导出的 READONLY_INVARIANTS 常量与各纯函数（grep 全文件无 omitVerbose/promptVia 的用例）。omitVerbose 若在未来重构中失效（--verbose 恒被拼入），负对照就变成正对照：进程正常跑完、退 0 且有事件，judgeVerboseBinding 会落 false——「绑定已解除、厂商已漂移」的假警报，并触发「适配层注释与设计 §3.7.1 该行都要复核」的复核对齐。EV-40 买的就是漂移可见性，而它自己的输入开关漂移时无人看见。本轮给三个判据抽了纯函数并配用例，唯独装配 argv 的那个函数里的新分支裸奔——v1.3.8 记的「加了守卫不等于守卫被守着」在同一 diff 里又照了一次。

**依据**：实读 src/trivium/probes/claude.ts:89-136（probeArgs 全文：omitVerbose 条件在 :122，promptVia 分支在 :115/:134，函数无 export）与 :473-493（probeStreamVerboseBinding 以 omitVerbose:true 构造负对照）；grep test/unit/claude-events.test.ts 全文确认无 omitVerbose/promptVia/probeArgs 调用（仅 :162 注释提及与 :166-191 的常量断言）；全仓 grep 确认这两个选项名只出现在 probes/claude.ts 与归档留痕里。

**建议**：二选一：把 probeArgs 重新导出并配两条纯断言（omitVerbose:true 时 argv 不含 --verbose；promptVia:'stdin' 时 prompt 不进 argv）——r4 把它改回私有的顾虑（M9 不得 import）如今已由 registry-parity「adapters 不得引用 probes」的 grep 契约机器守着，导出不再构成风险；或按本仓 grep 契约惯用形（known-forms-parity 同族）锁住这两个条件式的存在与形状。

### GLM-r2-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:1036` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：EV-40 的正对照传的是 read.completed——本轮第一个模型调用的结果，而负对照排在 write、structured、path_deny 两次共四次调用之后。「同轮正对照跑通」的归因在时间上是陈的：机器在 read 之后、负对照之前劣化（限流窗口到点、额度耗尽、登录态失效）时，负对照同样呈「退非零+零事件」，judgeVerboseBinding 记 true——若厂商届时真解除了绑定，这次误记恰好掩盖 EV-40 要看的漂移；而同轮更近的 structured/path_deny 失败已是反证，字段却不看它们。这是焦点「EV-40 的 true 臂归因是否真的收住了」的残留半格：三道门（超时/无退出码/正对照）收住了静态归因，没收住时序归因。

**依据**：实读 src/trivium/probes/claude.ts 的探针调用顺序（read :743 → write :861 → structured :970 → path_deny :996 两次 → :1036 probeStreamVerboseBinding(bin, fx, read.completed)）与 :514-547（judgeVerboseBinding 里 positiveControlOk 是唯一归因门）。

**建议**：正对照改取时序上最近、仍在作用域内的 completed 探测（structured.completed，或把 path_deny 那两次的 completed 传出），窗口从四次调用缩到一次以内；若维持 read.completed，至少在 JSDoc 与「同轮正对照跑通」的 note 里登记这个残留时序窗口。

### GLM-r2-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:947` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：GLM-02（r1）修法的本体是「strict 赋值必须排在三个 readonly_flags 清空点（:817 读回为空、:823 工具面脏、:882 breach）之后」，注释自己写「位置是判据的一部分」——但这个位置没有任何机器守卫：probeClaude 是 I/O 函数走不进单测，纯函数用例只看见 (checked, flags) 的取值、看不见求值时机，把赋值挪回 breach 之前不会红，{readonly_flags: [], strict_mcp_config_applied: true} 的矛盾组合会静默回归（消费方 M9 availability() 在 breach 机器上将拿到 true）。本轮给判定侧前置补了纵深用例，产出侧顺序却零守卫——同一个修法的两半，守卫只做了一半。

**依据**：实读 src/trivium/probes/claude.ts:936-961（赋值与「位置是判据的一部分」注释）及三个清空点 :817/:823/:882；通读 test/unit/claude-events.test.ts 与 test/unit/claude-severity.test.ts，确认无任何针对该顺序的断言（后者的 breach 用例喂的是已组装好的 probe 对象，不经过探针流程）。

**建议**：按本仓 grep 契约惯用形加一条源序断言（读 claude.ts 源文本，断言 judgeStrictMcpConfig 调用出现在最后一处 readonly_flags 清空之后——known-forms-parity 已有全文扫加偏移反算行号的先例）；或把 strict 改为函数尾部从最终 probe 状态一次性派生，并把「终态派生」抽成可测纯函数。

### GLM-r2-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/claude-severity.test.ts:47` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：healthy() 里默认只读旗标清单存了两份：基座 :21 与推导 fallback :47 逐字重复（都含 '--strict-mcp-config'）。推导的意义依赖 fallback 与基座一致，而只改其中一份时夹具会静默分叉：未来若把基座默认改成缺硬前置的子集而 fallback 未跟，derived 仍算 true，②' 对一台真缺硬前置的机器不响、用例照绿——这正是本 diff 在 probes/claude.ts:148 自己引的「同一个字面量存两份时，改一份另一份还在」，夹具在同一次改动里新造了一份。

**依据**：实读 test/unit/claude-severity.test.ts:15-50（基座清单 :21、...over :26、推导 :45-48 的 fallback 字面量两处对照）。

**建议**：单源化：两处共用一个模块级 const，或直接展开 READONLY_INVARIANTS（本文件已从同模块 import judgeStrictMcpConfig）。

### GLM-r2-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/types.ts:637` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：「今天两者恰好同真同假，因为该数组要么是整份常量、要么被清空」在一条常见路径上不成立：existing 携带上一轮健康结论（flags 为完整清单）、本轮读探针拿不到 system/init（登录态过期后重跑 doctor）——else 分支只置 tool_surface_checked=false、不清 flags（claude.ts:845-853），落盘为 {readonly_flags: <旧完整清单，非空>, tool_surface_checked: false, strict_mcp_config_applied: null}：length>0 而 strict 非 true。值本身语义诚实（null=没测到，doctor 判定也正确），过度的是那句不变量断言；probes/claude.ts:191-194（「那句断言重新成立」）同引此说。GLM-02（r1）修的正是「types.ts 断言与产出的数据分叉」这一形状，这次是措辞级复发。

**依据**：实读 src/trivium/types.ts:630-644 与 src/trivium/probes/claude.ts:191-197、:845-853（无 init 分支保留旧 flags 不清）、:947-950（judge(false, 旧完整清单) → null）。

**建议**：给那句加限定（如「在 tool_surface_checked===true 的轮次里两者同真同假」），或改述为「本轮核对过时同真同假；未核对轮 flags 保留旧值而 strict 为 null」。

### GLM-r2-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:473` |
| 类别 | performance ｜ 层次 code |
| 置信度 | high |

**问题**：probeStreamVerboseBinding 在 positiveControlOk===false 时仍照常 spawn 负对照，而 judgeVerboseBinding 在解析 stdout 之前就按该前置返回 null（:536）——这次 CLI 调用的结果被无条件丢弃。多数场景只是白等几秒（未登录时快速失败）；但「read 探针仅超时、机器健康且绑定已解除」的组合下这是一次真花钱却被丢弃的调用，与「负对照那一臂不花钱」的口径相悖。

**依据**：实读 src/trivium/probes/claude.ts:473-493（无条件先 run 再判）与 :514-547（positiveControlOk 门在 parseClaudeEvents 之前，返回值与本次观测无关）。

**建议**：正对照不成立时短路：probeStreamVerboseBinding 开头判 positiveControlOk，为假直接返回 null、不 spawn。

## 认为正确的部分

- 阻断的两层修法各自独立成立（本焦点核心结论）：产出侧 judgeStrictMcpConfig（claude.ts:199-205，checked!==true 一律 null、不从空数组反算）与判定侧 ②' 的三道前置（doctor.ts:290-295：!skipModelCalls、checked===true、length>0、strict===false）——单独退化任一层，未测机器都不会再被判安全失守；strict 赋值（:947-950）确在三个清空点（:817/:823/:882）之后，r1 GLM-02 的矛盾组合不再产出。
- 【纵深】用例（claude-severity.test.ts:332-360）用 pinned() 注入「上游退化后会送来的坏值」，让修好后走不到的第二层在自己的论域里被验到——这是「一道走不到的守卫等于没有守卫」的正确解法；unmeasured() 夹具的 {checked:false, flags:[], headless:null, trust:null, breach:false} 与未登录机器上探针的真实产出一致（模型没跑时 breach.txt 不会落盘，readonly_breach 落 false 是如实的）。
- EV-40 的静态归因收住了大半：judgeVerboseBinding 的超时→null、exitCode 非 number→null（r1 GLM-03 点名的空格有了断言）、正对照不成立→null 三道门各有用例（claude-events.test.ts 新增六条），「退非零+零事件」的 true 臂有了归因；notes 逐因分述，不再把「没跑起来」说成「被当场拒绝」。
- 夹具推导方向正确：healthy() 的 strict 一格改调生产侧同一判据并置于 ...over 之后，调用方的 tool_surface_checked/readonly_flags 参与推导，想钉值必须走 pinned() 明路——「夹具代表的机器」与「探针真会产出的值」重新绑定。
- 设计 v1.3.20 回填逐条与代码对上：§3.7 两新行（含三态语义与消费方指向）、§3.7.1 stdin 行与 --verbose 来源列、16.1 M9 行、v1.3.20 历史行、BACKLOG EV-40/41 转 done（被实测否证的原拟判据原样保留而非改写成成功叙事）、M6 报告第 8 条的追加注均核实一致；registry.ts:136 criticEnabled:false 与「这两步不改对外行为」断言一致。
- 跨文件对账点没有漏：config.v2.json 的 commonProbe 对各家专属字段 additionalProperties:true、path_deny 仅校 type:object，三个新字段可落盘可读回，无需 schema 同步；defaultProbe 与 emptyCommonProbe 两处空壳都齐了新键；「什么算一条事件」收敛到 parseClaudeEvents 的 eventCount、coverage_complete 收敛到 judgeDenyCoverage——r1 的 AGY-04/CODEX-07 两处「各存一份判据」确实清了。

## 未覆盖范围（本侧盲区）

- 只读审查：未运行 typecheck/build/test（构建与 pretest 均为写操作）；BACKLOG 与报告 §8.2 所称「变异验证过」按既有用例文本核对，未复跑验证。
- probeClaude 的 I/O 全流程（真实 claude 调用、existing 与 disk 合并、checkpoint 分段落盘）无法静态穷尽，赋值顺序与分支为逐行核对，未实跑 doctor 复现。
- M9 计划稿与 plan/ 目录裁决件未对照（该目录含禁读文件，整目录未进）；报告中的实测数字（31,913 字节、$0.044/次、24 倍、2.1.273、11 条事件）与 §8.3 落盘值无法独立复现，按报告采信。
- dist/ 与 skills/dual-critic/scripts/trivium.cjs 为生成物，未核对与源码一致性；doctor --selftest 桩路径下 ②' 与新字段行为未验证。
- 未读 .trivium/、.env.example 及 ~/.trivium/runs 下他侧子树（任务书 §8 禁读面）；本侧运行目录的编排器运行时文件未逐一检查。

## 实际查阅的项目文件

- `.reviews/M9-ClaudeCode审核者接入/code/_meta/changes-20260917T162023Z.diff`
- `.reviews/M9-ClaudeCode审核者接入/code/2026-09-17-M9-ClaudeCode审核者接入-glm.md`
- `.reviews/M9-ClaudeCode审核者接入/code/2026-09-17-M9-ClaudeCode审核者接入-response-claude.md`
- `src/trivium/probes/claude.ts`
- `src/trivium/doctor.ts`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/agents/registry.ts`
- `test/unit/claude-severity.test.ts`
- `test/unit/claude-events.test.ts`
- `skills/dual-critic/schema/config.v2.json`
- `doc/08_project/BACKLOG.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/REPORT_2026-09-17_m9_claude_entry_probe.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":14,"grep":7,"glob":1,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
