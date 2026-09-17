# M6 第 3 步 · Claude Code 探针实测报告

- **日期**：2026-09-14
- **CLI**：`2.1.270 (Claude Code)`（`~/.local/bin/claude`）
- **本机**：macOS 26.0（Darwin 25.6.0），arm64
- **探针模型**：`claude-haiku-4-5-20251001`（探能力不探质量，挑最便宜的一档）
- **落盘**：`.trivium/config.local.yaml` 的 `probe.cli.claude`

> **更正索引**：2026-09-17 更正 **§四.9**（调用形态旗标的归属已裁定，且该条原文对 P7 的转述
> 失实），并补 **§五 M9 行 ⑤** 的取法指向。两处更正的依据见主设计 v1.3.17 的
> 11.1「旗标归属判据」与 3.7.1。原文均保留，见各条的更正块。
>
> 本报告记的是**本机实测结论**。凡与演进设计 §3.2 冲突之处，**一律以本报告为准**（原则 P7）。
>
> 一处身份提醒：claude 是**当前的 Driver**。本步只探它作为**审核者**被 headless 拉起时的能力，
> 接入为审核者是 M9、Driver 任意化是 M10，本步都不做。

---

## 一、最重要的一条：`--strict-mcp-config` 是硬前置

只用 `--restricted --tools Read,Grep,Glob` **不够**。本机实测，不加 `--strict-mcp-config` 时
MCP 服务器的工具会混进工具面，其中含**发信、建草稿、建档、分享、删除**等写操作条目。

后果比「能写项目文件」更严重：**它能越出项目边界**。一个被拉起当审查员的进程，
理论上可以发邮件、改云端文档。

它同时还是**成本项**：

| 配方 | 工具面 | 一次最小任务的成本 |
| :--- | :--- | :--- |
| `--restricted --tools Read,Grep,Glob` | 只读三件套 **+ 数十个 MCP 工具** | **$0.199** |
| 同上 `+ --strict-mcp-config` | `Glob`、`Grep`、`Read` | **$0.0083** |

**24 倍差异**——那堆 MCP 工具的定义本身就占满了 system prompt。
安全要求与成本要求在这里指向同一个旗标。

> **混入的那次没有录成样本。** 那份输出含「本机装了哪些连接器」的完整清单，
> 属于用户的集成情况，不该写进团队仓库（与「凭据不经我手」同源）。
> 证据以本节的文字为准；`test/unit/claude-events.test.ts` 的「锁事实①」
> 断言工具面里一个 `mcp__` 前缀都不能有，从反面守着同一件事。

---

## 二、三条与另两家的关键差异

### D-1 · 读取路径**有**结构化字段

```json
{"type":"assistant","message":{"content":[
  {"type":"tool_use","name":"Read","input":{"file_path":"/private/tmp/.../sentinel.txt"}}]}}
```

路径在 `tool_use.input.file_path` 里。**codex 那边读文件走 shell，路径只在命令文本里**
（M6 第 2 步报告 P-C1）。

**后果**：M9 的 `project_reads` 统计与 `deny_paths` 轨迹核验能走结构化字段，
不必像 codex 侧那样依赖命令文本解析。

> 这**不是** claude 侧免于 EV-01（命令文本扫描）的理由——那个主因是
> **工具面里根本没有 Bash，没有命令可扫**。两件事容易混，归因见第五节。

### D-2 · 被拒的工具调用**留在轨迹里**

```json
{"type":"tool_use","name":"Write","input":{"file_path":".../breach.txt","file_contents":"BREACH"}}
{"type":"tool_result","is_error":true,
 "content":"<tool_use_error>Error: No such tool available: Write. Write is disabled for this
            session, in subagents as well as here.</tool_use_error>"}
```

模型照常发出 `tool_use`（连目标路径与内容都留着），随后收到 `is_error` 的 `tool_result`。
**codex 那边被沙箱挡下的命令一条事件都不产生**（第 2 步报告 P-C2）。

**后果**：设计 §10.3「轨迹有写事件即判失守」对 claude 侧**成立**，对 codex 侧恒为假。

**判据要扫 `tool_use` 的工具名，不是 `permission_denials`**——白名单外的工具走
「工具不存在」路径，`permission_denials` 为空。那个字段是给 D-3 那条路准备的。

错误信息里还有一句要紧的：**「in subagents as well as here」**——子代理也禁用，
堵住了经 Task 工具绕过的路。

### D-3 · 路径级 deny 对 `Read` 可用 —— 三家里唯一，**但覆盖不完整**

`--settings` 内联注入（`--restricted` 明说 managed settings 与 `--settings` 仍生效）：

```json
{"permissions":{"deny":["Read(./.reviews/**)"]}}
```

实测结果：对方产出的哨兵**没有出现在整条事件流里**，且该次尝试记入了
`result.permission_denials`，**带完整 `tool_input.file_path`**。

| | agy | zcode | codex | **claude** |
| :--- | :--- | :--- | :--- | :--- |
| 路径级 deny（Read） | ❌（M0） | ❌（M0） | ❌（第 2 步） | ✅ |

#### ⚠️ 但它挡不住 `Grep`

**初版这一节的结论是错的。** 当时写的是「第 ③ 道屏蔽对该侧**不必退化**为
『禁读清单 + 事后核验』，CLI 层就能拦住，三层屏蔽对这一侧是完整的」——
而那是**只验过 `Read` 一条路**就下的结论。

代码双审 GLM-03 提出怀疑（并诚实地标了 `medium` 置信度、说明「审查员无写权限
且不应烧用户配额去实测，需 Driver 决定是否补负对照」）。补了两轮实测：

| 实测 | 结果 |
| :--- | :--- |
| 规则只写 `Read(./dir/**)`，用 Grep 去捞 | **Grep 取到了哨兵** |
| 规则显式写全 `Read \| Grep \| Glob` 三条，再用 Grep 去捞 | **Grep 照样取到了哨兵** |

第二轮排除了「规则没写全」这个解释。**但到此为止就是实测能说的全部**：

> **可确定的**：路径形 deny 规则（`Read(./dir/**)` 这种形态）对 `Read` 生效、对 `Grep` 不生效，
> 显式写上 `Grep(./dir/**)` 亦然。
>
> **未验的**：为什么绕得过。一种可能是 `Grep` 的 deny 匹配单位是**搜索 pattern** 而非路径，
> 路径形规则对它根本不适用、pattern 形规则或许可用——**那只是假说，本步没测过**。

初版这里写的是「规则是**按工具生效**而非按路径生效」「能力本身就不完整」。
**那个说法与第二轮实验自相矛盾**：若规则真按工具生效，显式写的那条 `Grep(...)` 就该管用。
代码双审 GLM-04 指出这一点——我把一个**被自己实验否定的机制假说**
以事实口吻写进了「凡与演进设计冲突一律以本报告为准」的文档。
上一轮是「结论超出证据」，这次是**结论与证据矛盾**，重一档。

**修正后的结论**：第 ③ 道屏蔽对 claude 侧**仍需事后轨迹核验兜底**，
而且那道核验**必须同时覆盖 `Grep` 的 `path` 参数**，不能只查 `Read` 的 `file_path`
（代码双审 AGY-04）——`Grep` 恰恰是唯一能穿透 CLI 拦截的那条路，
只核验 `Read` 等于把兜底漏在了唯一需要它的地方。
CLI 层的 deny 是一道**有用但有洞**的补充，不是替代品。
探针的 `path_deny.method` 里如实记着这个洞，`doctor` 的 note 也会打出来。

> 这一条的价值不在「发现 claude 支持 deny」，而在**及时拦住了一个错误前提**：
> M9 若按初版结论免做事后核验，被拒目录的内容仍可经 Grep 流出，
> 而那时既没有 CLI 拦截也没有事后发现的手段。

---

## 三、探针清单实测结果

| 探针项 | 结论 | 手法 | 成本 |
| :--- | :--- | :--- | :--- |
| `bin` / `version` | `~/.local/bin/claude`，`2.1.270` | `--version` 抠三段号 | 零 |
| `headless_read_ok` | **true**（哨兵首行回显命中） | 真跑 | ~$0.008 |
| `trace_path_structured` | **true** —— 见 D-1 | 同上 | 同上 |
| `denied_tool_in_trace` | **true**（模型去调写工具时）／**null**（它没去调时） | 负对照 | 一次调用 |
| `readonly_flags` | `--restricted --strict-mcp-config --tools Read,Grep,Glob` | 工具面核对 + 负对照 | 同上 |
| `model_flag` | **true**（`system/init` 回读 `model`） | 事件流 | 同上 |
| `json_schema_ok` | **true**，但两处形态要记（见下） | 真跑 | ~$0.017 |
| `session_id_source` | 每条事件的 `session_id`；`--session-id` 可指定 | 事件流 | 同上 |
| `trust_prompt_required` | **false** —— 全新目录首跑无提示 | 真跑 | 同上 |
| `path_deny` | **对 `Read` true，对 `Grep` false** —— 见 D-3 | 负对照 ×2（含 Grep） | ~$0.014 |
| `scratch_paths` | `[]` —— 项目根零污染 | git 比对 | 零 |

### `json_schema_ok` 的两处形态

1. **参数取内联 JSON 字符串，不是文件路径**。传路径会被拒：
   `--json-schema is not valid JSON: JSON Parse error: Unrecognized token '/'`。
   codex 的对应旗标 `--output-schema` 才是收文件的——**两家形态相反，容易记混**。
2. `result` 字段回来的是**JSON 字符串**而不是对象，调用方要再 `JSON.parse` 一次。

### `denied_tool_in_trace` 记 null 的原因

这一项的判据**依赖模型行为**：只有模型真去调了写工具，才谈得上「这次调用有没有留痕」。
本机跑了两次，一次模型调了 `Write`（留痕成立，见 D-2 的样本），
一次它直接回答「我不能写」、压根没调工具。

后者记 **null（无从证实）而不是 false**：false 的意思是「试了，但轨迹里没留下」，
那会让 M9 误判该侧不能做轨迹核验、按 codex 那样降级——**而事实恰恰相反**。

> 起草时这里写成了二态，`notes` 文案倒是写对了（「无从证实」），字段却落 `false`——
> **文案与字段不一致**。真机跑完一对照才发现。修法是判据改三态。

---

## 四、证明边界（本报告不承诺什么）

1. **`denied_tool_in_trace` 的 true 来自手工实测，探针侧尚未复现**（见上）。
   留痕能力本身是确凿的（样本 `tool-denied.jsonl` 就是证据），
   但**探针每次跑都能证实它**这件事不成立——模型行为有随机性。
2. **只测了一个模型**（haiku）。不同模型对「工具被禁用」的反应可能不同，
   尤其是「会不会先去试一下」这种行为差异，正是上一条不稳定的来源。
3. **`--restricted` 的四条作用只逐项验了两条**：工具移除与配置忽略有实测支撑；
   「把文件工具限制在工作目录内」与「拒绝 bypassPermissions」**未单独做负对照**。
4. **未测 Driver 承载面**。claude 作为 Driver 的入口形态是第 4 步的范围
   （它现在就是 Driver，但那是**交互式**的，headless 承载面另算）。
5. **`auth` 探活缓存未接**。本步的 `doctor --only claude` 不做探活。
   `apiKeySource: none` 说明本机走的是订阅登录态而非 API key，
   换成 API key 的机器上行为可能不同。
6. **成本数字来自单次观测**，随 system prompt 与模型定价变动。
7. **`permissions.deny` 只逐工具验过 `Read` 与 `Grep`**（结论见 D-3）。
   `Glob` 未单独验；其它工具（若将来放宽白名单）也未验。
   **不要把「对 Read 生效」外推成「对读类工具生效」**——`Grep` 就是反例。
8. **「为什么 Grep 绕得过」未验**（见 D-3 的假说）。探针的 `path_deny.method`
   如实记着这条边界，`rule_syntax` 也只留被证实生效的 `Read` 规则——
   M9 只读机读字段时不会误以为规则覆盖了三个工具。
9. ~~**调用形态旗标的归属未定**~~ —— **已裁定，见设计 v1.3.17 的 11.1「旗标归属判据」**
   （BACKLOG EV-12 结案）。`-p` / `--output-format` / `--verbose` / stdin 置空确实
   只活在探针注释与本报告里、`readonly_flags` 一个都不含，这部分事实成立；
   归属结论是**机制类旗标属适配层**，`readonly_flags` 只装安全不变量，
   边界由 `registry-parity` 的架构契约守。

   > **本条初版的一处失实断言，已更正。** 初版写「P7 的字面是
   > 「适配层绝不硬编码 CLI 旗标」」——**该句不是 P7 的原文**。P7 写的是
   > 「实现代码只读探针结论，不硬编码**本文列出的**命令行」：主语是「实现代码」
   > 而非「适配层」，宾语有「本文列出的」限定而非泛指旗标。
   > 这个加强转述被 BACKLOG EV-12 照抄，成为「P7 与 zcode 先例互相矛盾、
   > 且 P7 的字面是绝对的」这一判断的依据——而按 P7 的真实措辞，矛盾并不成立。
   > 与本报告 D-3 的自我修正同族：**凭形态转述、不回去打开原文看**。

---

## 五、给后续里程碑的结论

| 里程碑 | 本报告的直接影响 |
| :--- | :--- |
| **M6 第 4 步** | D-1 / D-2 / D-3 要回填主设计 §3.7 与演进设计 §3.2；三家的只读机制与可核验性差异要并成一张对照表 |
| **M9（claude 接入）** | ① 配方是 `--restricted --strict-mcp-config --tools Read,Grep,Glob`，**漏第二个旗标当场失守且贵 24 倍**；② 写事件判定扫 `tool_use` 工具名；③ 第 ③ 道屏蔽可加一道 CLI 层 `permissions.deny`（只挡 `Read`），**但事后轨迹核验不能免**，且**核验面必须含 `Grep` 的 `path`**（见 D-3）；④ 结构化输出的两处形态与 codex 相反；⑤ **读 `probe.readonly_flags` 自己构造命令行，不要 import 探针的参数函数**——那带着探针尺度的成本闸门，逐字复用会被 CLI 掐断（`registry-parity` 已加契约测试禁止 `adapters/` 引用 `probes/`）。**取法按 `adapters/codex.ts` 的纯透传写，不是按 zcode 写**（2026-09-17 补：本行初版只举了 zcode 先例，而设计 11.1 判据二裁定 claude 的 `readonly_flags` 是**可直接使用的 argv 片段**、与 codex 同族；zcode 那份是「候选串的接受记录」，需取旗标名、值另给全集。两家先例都只证明「从探针结论构造」这条路可行，取法照各自落盘形态定） |
| **EV-01（命令文本扫描）** | 对 claude 侧**非必需**，但**归因要写准**（代码双审 AGY-06）：主因是**工具面里根本没有 Bash**（`--restricted` 移除 + 白名单不含），**没有命令可扫**；「读取路径结构化」是另一回事（它让 `project_reads` 统计能走结构化字段）。EV-01 的原始定义是针对**泄漏通道②（经 git 对象库绕过文件系统读取）**，本就适用于有命令执行能力的 agy 与 zcode——codex 只是**新增消费方**，不是唯一来源。范围可以收窄，但**不能取消** |
| **设计 §10.1 三层屏蔽** | **四家都需要事后轨迹核验**。claude 侧多一道 CLI 层 deny，但它只挡 `Read`、挡不住 `Grep`（见 D-3），是补充不是替代。差异要写进设计，且**不能**因为某侧有 CLI 拦截就免掉那一侧的事后核验 |
