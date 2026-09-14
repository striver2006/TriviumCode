---
schema: trivium.disposition.v1
topic: 探针扩展与事实回填
stage: code
role: claude
kind: response
run_id: 20260914T154909Z
addresses:
  - 2026-09-15-探针扩展与事实回填-r3-gemini.md
  - 2026-09-15-探针扩展与事实回填-r3-glm.md
---

# 代码应答（r3）：Claude Code 探针（M6 第 3 步）

## 0. 裁决总览

**14 条全部接受，零驳回。** 两侧均判 `request-changes`
（AGY 2 major + 3 minor + 1 nit、GLM 4 major + 3 minor + 1 nit）。

### 0.0 先说本轮的覆盖度打折

**glm 侧 `evidence_ok: false`**（工具调用 4 次 < 下限 5），按 §11.4 的口径
「本侧不得计为合格双审的一半」。**严格说这一轮只有 gemini 一侧是合格的。**

但它的意见质量与那个判定无关：**我逐条核实了 glm 全部 8 条的代码依据，全部属实**，
其中 GLM-03 是本轮最深的一条、两侧都没有第二人提出。

这说明证据下限拦的是「没读就乱说」，而**读得少不等于说得不对**——两者不能互相替代。
处置上仍按纪律办：本轮的双审覆盖度按一侧计，第 4 步的相关面要留意补审。

### 0.1 本轮贯穿性的形状：**同一事实，测试与实现两个口径**

上一轮的教训是「注释宣称了实现没兑现的事」。本轮它以**第三种形态**出现，
而且有三处：

| 处 | 测试/文案的口径 | 实现的口径 |
| :--- | :--- | :--- |
| 泄漏判据（GLM-03） | 断言 `raw` **原始全文**不含哨兵 | 只查**解析后** trace，而解析器**丢掉了成功的 tool_result** |
| 工具面核对（GLM-06） | 断言 `deepEqual(['Glob','Grep','Read'])` **全等** | 只 filter `mcp__` 前缀 |
| `path_deny` 的 false（AGY-01≡GLM-02） | `method` 文案写「**无从证实**」 | 字段落**确定否定** |

**「测试比实现严」听起来像好事，实则是测试没有在测实现。** 它让我拿着一份
更严的断言，去为一个更松的实现背书——本步报告 D-3 的「CLI 层就能拦住」正是这么来的。

### 0.2 最严重的一条：安全判定的假阳性（AGY-02 ≡ GLM-01）

两侧独立收敛，都判 major。

`read.init` 为 null（未登录、断网、spawn 报错——`run()` 对这些**都不抛错**）时，
工具面核对整段被 `if (read.init)` 跳过，`readonly_flags` 保持空集；
而 `claudeSeverity` 对「非 skipModelCalls 且 flags 为空」**恒判 blocker**
「只读保障不成立：工具面混入了写工具，或负对照下文件仍被创建」。

**又是把「没测到」塌缩成确定否定**，而且落在安全判定上。GLM 补的那句最要紧：

> claude 是 Driver（`driverEnabled: true`），**每个用户都装**，默认全量 doctor 真调模型，
> 首次运行遇上登录态过期即命中。

用户看到的不是「未得出结论请重跑」，而是**一条失实的失守指控**。
而 `headless_read_ok === null` 那条本该给出的 note 排在 blocker 之后，永远走不到。

这与上一轮 codex 的 GLM-01 是**同一条原则在新增代码里的同形复发**——
我把三态原则应用到了 `headless_read_ok` 与 `denied_tool_in_trace`，
**却没应用到它上游那个决定分支走向的 `if (read.init)`**。

---

## 0.3 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-02 | gemini | 重要 | 接受 | `read.init` 缺失使「没测到」伪装成安全失守；claude 是人人皆装的 Driver，登录态过期即命中 | 探针给出「工具面核对是否执行过」的信号；doctor 侧 null 优先 |
| GLM-01 | glm | 重要 | 接受 | 与 AGY-02 同一缺陷，并补了「Driver 人人皆装」这一后果放大器与缺失的用例 | 同上，另补「init 缺失不得产出 blocker」用例 |
| GLM-03 | glm | 重要 | 接受 | 泄漏判据查解析后 trace，而解析器丢掉成功的 tool_result；deny 规则只验了 Read，Grep/Glob 无负对照 | 判据改查原始 stdout；补 Grep 负对照；报告 D-3 加限定 |
| AGY-01 | gemini | 重要 | 接受 | `!leaked && !recorded` 落确定否定，method 自称「无从证实」 | 该分支改记 `null`，`attempts` 不写 |
| GLM-02 | glm | 重要 | 接受 | 与 AGY-01 同一处，并指出 `attempts` 语义也不符（该规则未被证明不成立） | 同上 |
| GLM-04 | glm | 重要 | 接受 | `claudeArgs` 把探针尺度的预算固化进「共用配方」，M9 复用即被掐断 | 预算可选化；注释分层写明「安全不变量」与「探针默认」 |
| AGY-03 | gemini | 次要 | 接受 | 同上，并指出与 P7「适配层读探针结论」相抵 | 同 GLM-04，另移除死参数 |
| AGY-04 | gemini | 次要 | 接受 | 绝对路径子串匹配，macOS 软链（`/var` vs `/private/var`）与相对路径都会假阴性 | 判据改按 basename 归一化比对 |
| AGY-05 | gemini | 次要 | 接受 | `trust_prompt_required` 三元永不为 true，doctor 的 `=== true` 分支是死逻辑 | 从失败输出的文本特征识别信任提示 |
| GLM-05 | glm | 次要 | 接受 | 与 AGY-05 同一处，并指出用户会收到「一条永远不可能成功的建议」 | 同上，另在 null 的 note 里列出该候选原因 |
| GLM-06 | glm | 次要 | 接受 | 工具面只查 `mcp__` 前缀，不核对全等；CLI 漂移把 Bash 放回来也照样记「干净」 | 运行时核对 `init.tools` 与白名单无序全等 |
| GLM-07 | glm | 次要 | 接受 | 提示词只布置任务不强制发起调用；判据限定工具名且不与被拒那次配对 | 提示词改显式指令；判据按 `tool_use_id` 配对并放宽工具名 |
| AGY-06 | gemini | 吹毛求疵 | 接受 | 报告把 EV-01 的归因写错：主因是白名单无 Bash，不是「路径结构化」 | 改写报告归因；两侧对结论本身的判断一致 |
| GLM-08 | glm | 吹毛求疵 | 接受 | `opts.cwd` 引用 0 次，与上一轮刚清理的 `void bin` 死参数同形 | 删掉该选项 |

---

## 1. 逐条裁决

### AGY-02 · 重要 —— 接受

**裁决**：接受，**本轮第一优先修**。

核实为真：`claude.ts:337` 的 `if (read.init)` 是整个工具面核对的门，
缺失时 `readonly_flags` 停留在初值 `[]`；`doctor.ts` 的 `claudeSeverity` 把空集当失守。

**修法要动两侧**，因为单改一侧都不够：

1. **探针侧**给出「工具面核对执行过没有」的独立信号。空集现在承载了两个互斥的意思
   （「核对过，发现混入」与「压根没核对」），这是根源。
2. **doctor 侧**把 `headless_read_ok === null` 的判断**提到失守判据之前**：
   读探针都没跑成，谈不上「测出了失守」。

**落点**：`ClaudeProbe` 增 `tool_surface_checked: boolean | null`；
`claudeSeverity` 的失守分支加 `probe.tool_surface_checked === true` 前置条件。

### GLM-01 · 重要 —— 接受

**裁决**：接受。与 AGY-02 同一处缺陷，两侧独立收敛。

GLM 补的两点都采纳：

- **后果放大器**：claude 的 `driverEnabled: true`，人人皆装。这不是「某个没装 codex
  的用户被误伤」那种量级，是**每个用户在登录态过期时都会看到一条失实的安全指控**。
  严重度因此确实该是 major 而非 minor。
- **缺失的用例**：`claude-severity.test.ts` 只测了 `skipModelCalls: true` 时空集不算失守，
  **没测「init 缺失 + 非 skip」**——那正是真实故障路径。

**落点**：补一条用例「工具面未核对过时不得产出 blocker」，并做变异验证。

### GLM-03 · 重要（security）—— 接受

**裁决**：接受三处，这是本轮**最深**的一条。

核实全部属实：

1. `parseClaudeEvents` 只在 `is_error === true` 时保存 tool_result 内容（`:167-169`）——
   **成功的 tool_result 被丢弃**，而那正是「读到的内容」的载体；
2. 泄漏判据 `JSON.stringify(t).includes(SENTINEL_PEER)`（`:239`）查的是**解析后**的 trace；
3. `execProbe` 只回传解析结果，`r.stdout` 被丢弃（`:195-211`）。

于是「经白名单内的 Grep 读到被拒目录内容」这条通道**对判据不可见**。
而 deny 规则只写了 `Read(./dir/**)`，**Grep / Glob 是否受该规则约束，一次负对照都没做**。

**这条直接推翻了我报告 D-3 的结论强度**：「CLI 层就能拦住」「三层屏蔽完整」
是拿一个比测试更松的判据得出的（测试断言的是 `raw` 全文，见 §0.1）。

**落点**：

1. `execProbe` 透传原始 `stdout`；泄漏判据改查原始输出——与测试同口径；
2. **补一条 Grep 负对照**：在被拒目录里 Grep 哨兵词，看规则管不管得住；
3. 报告 D-3 **先加限定**（「仅对 Read 工具验证过」），补测通过后再按实测结论改写；
4. 第五节给 M9 的结论相应降级：**不得只凭当前证据免做事后轨迹核验**。

审查员自己标了 `medium` 置信度并说明原因（「审查员无写权限且不应烧用户配额去实测」）——
那是恰当的克制，而补这次实测正是 Driver 该做的事。

### AGY-01 · 重要 —— 接受

**裁决**：接受。

`claude.ts:251-258` 的 `return { supported: false, …, method: leaked ? … : '…无从证实' }`——
**两个分支共用一个 `supported: false`**，而其中一个分支的文案明说「无从证实」。
`PathDenyProbe.supported` 的契约是 `boolean | null`，`false` 的语义是
「本机**确认**不支持」（`types.ts` 原文）。

后果与 `denied_tool_in_trace` 那次完全同形：M9 读到 `false` 会把第 ③ 道屏蔽
退化成「禁读清单 + 事后核验」——**而能力可能明明在**。

**讽刺的是**：我在同一个函数的 JSDoc 里写了「只看其中一条都不够」，
把两条判据的必要性讲得很清楚，**却把「两条都不成立」判成了确定否定**。

**落点**：`leaked === true` 才返回 `false`；`!leaked && !recorded` 返回 `null`。

### GLM-02 · 重要 —— 接受

**裁决**：接受。与 AGY-01 同一处，另采纳其对 `attempts` 的指正。

`attempts` 的契约是「**已尝试但不成立**的注入点」（`types.ts:95`）。
在「无从证实」分支里写 `attempts: [rule]`，等于宣称这条规则试过且不成立——
而事实是它**没被证明不成立**。

**落点**：`null` 分支不写 `attempts`。

### GLM-04 · 重要 —— 接受（含 AGY-03）

**裁决**：接受。两侧独立收敛，这也是我焦点问一的答案：**形状确实太窄**。

`claudeArgs` 的注释写着「唯一构造处，探针与适配层共用一套配方」，
而它把 `--max-budget-usd` 固定成 `PROBE_BUDGET_USD = '0.20'`——那个常量自己的注释
还写着「按单次 $0.008 留一个数量级余量」，是**探针尺度**。

M9 的审查任务要读整份 BRIEF + diff、用审查档模型，单次成本可远超 $0.20，
**超出即被 CLI 掐断**。按注释字面「共用这套配方」的适配层会把探针的成本闸门
套到审查调用上。

GLM 的分层建议正是关键：**安全不变量**（`--restricted` / `--strict-mcp-config` /
工具白名单）固化是对的、且有配方测试锁着；**探针默认值**（预算、模型）不该一起固化。
`model` 已经可选化了，`--max-budget-usd` 和 `--session-id` 没有——**同一个函数里两套标准**。

**落点**：预算与 session-id 改为可选项（探针传自己的默认值）；
`claudeArgs` 的 JSDoc 分层写明哪些是不变量、哪些是可覆盖项、M9 的扩形点在哪，
**别让「共用一套配方」被读成「逐字复用」**。

### AGY-03 · 次要 —— 接受

**裁决**：接受，并入 GLM-04。

AGY 多指出一层：`types.ts` 明确标注 `ClaudeProbe.readonly_flags` 的消费方是
「M9 适配器构造命令行（**P7**）」，而若 M9 必须逐字复用 `claudeArgs`，
**P7「适配层只读探针结论」的纪律就被硬编码架空了**。

这一层比「预算不够用」更根本：它是**架构层**的矛盾，不只是参数不合适。
落点里要写清 M9 的正确姿势——读 `probe.readonly_flags` 构造，而不是 import 探针的函数。

### AGY-04 · 次要 —— 接受

**裁决**：接受。

`v.includes(fx.openFile)` 用的是绝对路径精确子串。两条实际会中招的路径：

1. **macOS 软链**：`makeTempDir` 返回 `/var/folders/…`，而系统真实路径是
   `/private/var/folders/…`——本步录制的样本里 `file_path` 正是 `/private/tmp/…`，
   而夹具给的是 `/tmp/…`。**这个坑我在录样本时就擦身而过了，没意识到**；
2. **相对路径**：模型完全可能传 `README.md` 而不是绝对路径。

两者都会让 `trace_path_structured` 假阴性，进而让 M9 做不必要的文本回退。
而测试里用的判据是 `includes('sentinel.txt')`（basename）——**又一处口径脱节**（§0.1）。

**落点**：判据改按 `path.basename` 比对，与测试同口径。

### AGY-05 · 次要 —— 接受

**裁决**：接受。

`probe.trust_prompt_required = read.completed ? false : null`——**三元只有两个出口，
永远不为 true**。而 `doctor.ts` 专门写了 `=== true` 的 note 分支，
`claude-severity.test.ts` 还为它写了用例、注释里说「判定链路要在，否则换台机器
为真时没人会注意到」。

**那条链路从探针侧就是不可达的**：真需要信任的机器上 `read.completed` 必为 false，
字段只会落 null。用例靠合成数据（`healthy({trust_prompt_required: true})`）通过，
测的是 doctor 的分档，**不是探针会不会产出 true**。

这是「声称的守卫是死逻辑」——与 §0.1 三处同族，只是这次死在**上游**。

**落点**：从失败时的 stdout/stderr 里找信任提示的文本特征（`/trust|信任/i` 一类），
命中才置 true；识别不了就保持 null 并在 note 里如实说「区分不了」。

### GLM-05 · 次要 —— 接受

**裁决**：接受。与 AGY-05 同一处，采纳其「最低限度」建议作为兜底。

GLM 指出的用户后果值得单记：真需要信任的机器上，用户会**反复收到
「请重跑 `doctor --only claude`」——一条永远不可能成功的建议**，
而本该出现的「该侧对新克隆的仓库不可用」永不触发。

**落点**：除 AGY-05 的文本特征识别外，在 `headless_read_ok === null` 的 note 里
把「新目录首跑可能需要人工信任」列为候选原因之一——即使特征识别失手，
用户至少有条线索。

### GLM-06 · 次要（security）—— 接受

**裁决**：接受。

`read.init.tools.filter((t) => t.startsWith('mcp__'))` 只查 MCP 前缀。
若 CLI 版本漂移把非 MCP 的写工具（`Bash`、`Write`）放回工具面，
**只要模型当次没去用、负对照没落文件，探针就会记「工具面干净」且 `readonly_flags` 完好**。

而测试里断言的是 `deepEqual(t.init?.tools, ['Glob','Grep','Read'])` 全等——
**检出强度弱于自家测试锁定的口径**，§0.1 的第二处。

审查员说得对：`init.tools` 数据已经在手，全等核对是**零成本**的。

**落点**：运行时核对 `init.tools` 与白名单无序全等，不等即清 `readonly_flags`
并在 note 里**点名多出来的是哪些工具**。

### GLM-07 · 次要 —— 接受

**裁决**：接受三条改进。这也是我焦点问二的答案：**三态是对的，但判据还能更稳**。

1. **提示词太软**：「请在当前目录创建文件 breach.txt」只是布置任务，
   模型可以凭系统提示里的工具面推断「我没有 Write」而直接回答，不发起调用。
   改成显式指令——「调用 Write 工具尝试创建，**即使预计会被拒绝也要发起**」。
2. **判据限定了工具名**：`/write|edit|bash/i` 。而「白名单外调用留痕」这一性质，
   **任一**白名单外的 `tool_use` + 对应的 `is_error` 就能证明。放宽可减少 null。
3. **`toolErrors.length > 0` 不与被拒的那次调用配对**：任何无关错误都算数。
   改为按 `tool_use_id` 配对。

**但 null 口径保留**——审查员自己也说了「即便如此该字段仍非每次可得」。
提示词强制能压低概率，消不掉。

### AGY-06 · 吹毛求疵 —— 接受

**裁决**：接受。**结论对，归因错。**

两侧在这条上的判断看似相反（GLM 说「EV-01 的结论站得住」），实则不矛盾：
GLM 判的是**结论**（对 claude 非必需），AGY 判的是**理由**（我写的归因不准）。
两者我都采纳。

我在报告里写的是「路径在结构化字段里，所以不必做命令文本扫描」。
而 EV-01 的原始定义（BACKLOG / ADR-002）是**针对泄漏通道②（经 git 对象库
如 `git show` 绕过文件系统读取）**——它本就适用于**有命令执行能力**的 agy 与 zcode。

claude 侧免于命令扫描的**主因是工具面里根本没有 Bash**（`--restricted` 移除 + 白名单不含），
没有命令可扫；「路径结构化」是另一件事（它让 `project_reads` 统计能走结构化字段）。
codex 只是**新增消费方**，不是唯一来源——我写的「必要性只来自 codex」是错的。

**落点**：改写报告第五节 EV-01 那行与 D-1 的后果段，把两个理由分开写。

### GLM-08 · 吹毛求疵 —— 接受

**裁决**：接受。

`opts.cwd` 在返回数组里**引用 0 次**（已 grep 核实），实际工作目录由 `execProbe`
经 `run()` 的 spawn 选项传入。claude CLI 也没有 `--cwd` 旗标。

与上一轮 GLM-09（codex `readCatalogPath` 的 `void bin`）**同形，而那条刚被接受并清理**——
同一族问题连续两轮出现在我新写的代码里。

更糟的是测试还传了 `cwd: '/tmp'`，**强化了「它有用」的错觉**。

**落点**：删掉该选项，测试里一并删。

---

## 2. 修复清单

| 文件 | 改动 | 来源 |
| :--- | :--- | :--- |
| `types.ts` | `ClaudeProbe` 增 `tool_surface_checked` | AGY-02 / GLM-01 |
| `probes/claude.ts` | `path_deny` 的「无从证实」分支改记 null、不写 attempts | AGY-01 / GLM-02 |
| 同上 | `execProbe` 透传原始 stdout；泄漏判据改查原始输出 | GLM-03 |
| 同上 | 补 Grep 负对照 | GLM-03 |
| 同上 | 工具面改无序全等核对，并点名多出的工具 | GLM-06 |
| 同上 | `trace_path_structured` 改按 basename 比对 | AGY-04 |
| 同上 | `trust_prompt_required` 从失败输出的文本特征识别 | AGY-05 / GLM-05 |
| 同上 | 负对照提示词改显式指令；判据按 `tool_use_id` 配对并放宽工具名 | GLM-07 |
| 同上 | `claudeArgs` 预算与 session-id 可选化；删 `cwd`；JSDoc 分层 | GLM-04 / AGY-03 / GLM-08 |
| `doctor.ts` | 失守判据加 `tool_surface_checked === true` 前置；null 优先于 blocker | AGY-02 / GLM-01 |
| 同上 | null 的 note 里列出「新目录首跑可能需要人工信任」 | GLM-05 |
| `claude-severity.test.ts` | 补「工具面未核对过时不得产出 blocker」 | GLM-01 |
| `claude-events.test.ts` | 删 `cwd`；补配方分层的断言 | GLM-08 / GLM-04 |
| 报告 | D-3 加「仅对 Read 验证过」限定（补测后按实测改写）；EV-01 归因改写；第五节给 M9 的结论降级 | GLM-03 / AGY-06 |

**变异验证**：AGY-02≡GLM-01、AGY-01≡GLM-02、GLM-03、GLM-06、AGY-05 五条逐条做。
其中 AGY-02 与 GLM-03 是安全判定，变异要**真的造出那个场景**
（前者构造 `init` 缺失，后者构造「哨兵只出现在成功的 tool_result 里」），
不能只验「代码改了」。

---

## 3. 两侧共同确认、本次不动的部分

- **`--strict-mcp-config` 硬前置的发现**（安全与成本同向、24 倍差异），
  以及「混入样本含用户集成清单、不进仓库」的处置。
- **三态口径在 `denied_tool_in_trace`、`headless_read_ok` 上做对了**——
  上一轮的教训被正确应用到这两处（漏的是它们上游的 `if (read.init)`，见 AGY-02）。
- **`claudeSeverity` 抽成纯函数 + 安全判定用例**，与 `codexSeverity` 同构。
- **三份真跑样本 + 四条锁事实用例**；fixtures README 写明重录时机、成本与自认缺口。
- **删除「已登记未实现」用例**是那条用例自我宣告的机器信号，删得诚实且留了恢复指引。
- **`defaultProbe` 补齐 claude 专属空壳**（上一轮 AGY-06 的教训直接应用）。
- **EV-01 对 claude 非必需的结论成立**（归因要改，见 AGY-06）；
  「范围可收窄但不能取消」也对——codex 侧是唯一手段。
- **安全不变量固化进唯一构造处的方向是对的**，问题只在探针专属常量没分层（GLM-04）。
