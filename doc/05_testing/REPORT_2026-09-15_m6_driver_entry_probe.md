# M6 第 4 步 · Driver 入口承载面探针与 zcode 复测报告

- **日期**：2026-09-15
- **本机**：macOS 26.0（Darwin 25.6.0），arm64
- **被测 CLI**：`codex-cli 0.154.0`、`zcode 0.16.5`、`agy 1.2.2`、`claude 2.1.270`
- **落盘**：**无**。本报告的结论**不进** `ProbeSection` 机读段，理由见 §0。
- **配额消耗**：**零**。全部结论来自命令行解析、目录枚举与 `debug prompt-input` 渲染，无一次模型调用。

> 本报告记的是**本机实测结论**。凡与演进设计 §3.1 / §3.2 / §7 冲突之处，**一律以本报告为准**（原则 P7）。

---

## 0. 为什么这一步的结论不进机读段

计划双审 AGY-04 定调，此处复述理由而不只复述结论：

入口承载面回答的是「**这家能不能当 Driver、怎么当**」，消费者是 **M10 的设计决策**，
不是运行期代码。塞进 `ProbeSection` 就是又一个**登记而无消费方**的字段——
这正是 BACKLOG **EV-06**（`instructionFiles` 为四家各登记了协议片段文件名，而全仓 grep 只有
注册表自身的赋值与一处类型声明——**没有任何代码读它**）的形状，本项目反复反对它。

所以本步的交付形态是**人读评估**：一份报告 + 主设计回填 + 待拍板项收敛。
将来 M10 真要按承载面分发入口资产时，**那时**再按当时的消费需求决定字段形状。

---

## 1. 最重要的一条：`CODEX_HOME` 隔离不住指令面

第 2 步把 codex 的 `isolation` 记为 `home_copy`，依据是「独立 `CODEX_HOME` 实测被采纳」。
**那条结论对「配置面」成立，对「指令面」不成立**——本步实测把它补全。

### 实测：三条臂

用 `codex debug prompt-input` 渲染模型可见输入（零配额），三次运行只改环境变量：

#### A · 仅隔离 `CODEX_HOME`

```bash
CODEX_HOME=<scratch>/cxhome codex debug prompt-input
```

```text
### Skill roots
- `r0` = `<scratch>/cxhome/skills`           ← 随 CODEX_HOME
- `r1` = `/Users/chenzhenbo/.agents/skills`  ← 真实 HOME 下的路径
- `r2` = `<scratch>/cxhome/skills/.system`
```

`r1` 是**本机用户真实的技能目录**，里面有 14 份第三方 skill。它们的全文描述
**已经进了模型可见的 developer 消息**，而这次运行本该是隔离的。

#### B · 负对照：再叠加隔离 `HOME`（空目录）

```bash
CODEX_HOME=<scratch>/cxhome HOME=<scratch>/cxhome/fakehome codex debug prompt-input
```

```text
- `r0` = <scratch>/cxhome/skills
- `r1` = <scratch>/cxhome/skills/.system   ← 原 r1 消失
```

#### C · 正向哨兵：`HOME` 隔离，但 fakehome 下**放一个 skill**

```bash
mkdir -p <fakehome>/.agents/skills/posctl   # SKILL.md 的 description 写哨兵串
CODEX_HOME=<scratch>/cxhome HOME=<fakehome> codex debug prompt-input
```

```text
- `r0` = <scratch>/cxhome/skills
- `r1` = <fakehome>/.agents/skills          ← 根跟着 HOME 搬过来了
- `r2` = <scratch>/cxhome/skills/.system
```

哨兵串**命中**模型可见输入。

### 三条臂各排除了什么

| 臂 | 观测 | 排除掉的解释 |
| :--- | :--- | :--- |
| A | `r1` 字面解析到真实 `$HOME` 下的路径 | 「这个根由 `CODEX_HOME` 派生」 |
| B | 换掉 `HOME` 后该根消失 | 「这个根是写死的绝对路径」 |
| **C** | 根**移动到新 `HOME` 并挂载** | 「`HOME` 变了导致配置或认证缺失，于是全局根被**关掉**」 |

**只有 A + B 时，C 排除的那条替代假说是成立的**——那正是本报告初稿的缺口，
由 r5 代码双审 AGY-02 指出，补测后结论才站得住。

**结论：`~/.agents/skills` 这个根随 `HOME` 派生。**

> **措辞边界（r5 GLM-01）**：初稿在下一段写的是「指令根**只认** `HOME`」。
> 「只认」是**排他性**断言，三条臂证明不了它——没有排除「还存在第三条环境杠杆」
> （比如某个显式配置键也能改这个根）。已降为「随 `HOME` 派生」。
> 消费结论（M8 双覆盖）在任何一种机制解释下都成立，不受这个收窄影响。

### 后果

| 面 | `CODEX_HOME` 副本管不管用 |
| :--- | :--- |
| `config.toml` / `auth.json` / model catalog | ✅ 管用（第 2 步已实测） |
| **skills 指令面** | ❌ **不管用**，从 `$HOME/.agents/skills` 漏进来 |

这与 zcode 的 **C-12 / C-08** 同形：那边是「配置根只认 `HOME`」，这边是
「**指令根随 `HOME` 派生**」。两家踩的是同一个坑的两半。

> 两边的措辞强度**刻意不同**：C-12 的「只认」有排他性证据（`ZCODE_HOME` /
> `ZCODE_DATA_BASE_DIR` / `ZCODE_STORAGE_DIR` 三个候选变量逐个试过、全部无效）；
> 本节只有三条臂，没做过同等的候选穷举，所以不配用同一个词。

**对 M8（codex 作审核者）的意义**：隔离要**同时**覆盖 `CODEX_HOME` 与 `HOME`，
只做前者会让宿主机上任意第三方 skill 的描述进入审查会话的 developer 消息。
沙箱只读仍然挡得住**写**，但挡不住**指令注入**——这两件事不是一回事。

**本轮不改代码**：`probe.cli.codex.isolation` 的取值 `home_copy` 字面上仍然成立
（副本机制就是 home 副本），错的是**它覆盖了什么**的理解。M8 真正搭隔离时按本节执行。
BACKLOG 已登记 **EV-08**。

---

## 2. codex 的 Driver 入口承载面：是 skills，不是 prompts

### 设计原记载

演进设计 §3.1 第 104 行与 §7.1 第 146 行都写 `~/.codex/prompts/<name>.md`
（「会话内以 `/name` 调用；参数展开能力（`$ARGUMENTS` 等）**待实测**」，置信度**中**，来源官方文档）。

### 实测：双哨兵对照

在隔离 `CODEX_HOME` 下**同时**造两个哨兵，再看谁进了模型可见输入：

| 造的东西 | 内容 | 是否出现在 `debug prompt-input` |
| :--- | :--- | :--- |
| `$CODEX_HOME/prompts/dualtest.md` | `SENTINEL-PROMPTS-ROOT` | ❌ **没有** |
| `$CODEX_HOME/skills/dualtest/SKILL.md` | `SENTINEL-SKILLS-ROOT` | ✅ **有**，记作 `- dualtest: SENTINEL-SKILLS-ROOT (file: r0/dualtest/SKILL.md)` |

两个哨兵在同一次运行里，互为对照——不是「只测了一个然后推断另一个」。

### 参数展开：**支持**，且比设计猜的更全

0.154.0 内嵌的 SKILL.md 撰写规范原文：

```text
- Use $ARGUMENTS, $ARGUMENTS[N], or $N (e.g., $0, $1) for user-provided arguments.
```

frontmatter 字段集：`name` / `description` / `argument-hint` / `disable-model-invocation` /
`user-invocable` / `allowed-tools` / `context` / `agent` / `model`。

**这与 Claude Code 的 SKILL.md 几乎同形**——包括 `disable-model-invocation` 这个
本项目七份入口 skill 都在用的字段。`skills/dual-*/SKILL.md` 迁移到 codex 的成本
因此远低于演进设计 §10.2「入口资产：命令契约单源多渲染」按 prompts 形态估的。

### 边界：**没有**证伪 prompts

`debug prompt-input` 渲染的是**常驻**模型可见输入。`~/.codex/prompts` 若是
**TUI 内 `/name` 触发时才注入**的面，它本来就不该出现在这里。

所以本节的结论**只有一句**：**skills 是常驻承载面，prompts 不是**。
「prompts 在 0.154.0 还能不能用」**本轮没测**——测它要真开 TUI 并发一次调用。
M10 若要用 prompts，必须自己补这个实测，不得引本报告。

> 这条边界是刻意写的。上一步 D-3 就是因为把「我测到的」写成了「机制是这样」被审出来，
> 本轮不重复。

---

## 3. zcode 的入口承载面：四个根，两套截然不同的重名规则

### 3.1 根的枚举（实测）

`zcode skills list --json` 输出带 `scope` / `source` / `rootPath` 三个字段。本机实跑：

| scope | source | rootPath | 条目数 |
| :--- | :--- | :--- | :--- |
| user | agents | `~/.agents/skills` | 14 |
| user | zcode | `~/.zcode/skills` | 10 |
| system | plugin | `~/.zcode/cli/plugins/cache/**/skills` | 13 |

在 scratch 目录造项目级根，`--cwd` 指过去，确认 **project scope 存在**：

| scope | source | rootPath |
| :--- | :--- | :--- |
| project | zcode | `<项目>/.zcode/skills` |
| project | agents | `<项目>/.agents/skills` |

所以承载面是 **`{project, user} × {.zcode, .agents}` 四个根**，外加插件根。
且 project 侧是**从 cwd 逐级上溯到含 `.git` 的目录**、每一级都算一个根——
不是只有项目根一个。

### 3.2 skills 重名：**不去重，不告警**（实测）

本机 10 个 skill 同时存在于 `~/.zcode/skills` 与 `~/.agents/skills`，
`skills list` **两份都列**，`diagnostics` 为**空数组**。

### 3.3 commands 重名：**去重，且 user 赢 project**（实测）

同样的机制在 commands 上是反的。用独立 `HOME` + scratch git 仓库造三份同名命令：

| 落点 | 结果 |
| :--- | :--- |
| `<fakehome>/.zcode/commands/dup.md` | ✅ **胜出** |
| `<repo>/.zcode/commands/dup.md` | ❌ 被忽略 |
| `<repo>/sub/.zcode/commands/dup.md` | ❌ 被忽略 |

被忽略的两份各产出一条 `diagnostics`：

```json
{"code":"custom_command_duplicate_name","message":"Duplicate custom command ignored: dup","severity":"warning"}
```

**user 级命令盖过项目级命令**，方向与「项目配置覆盖全局配置」的常识**相反**。

### 3.4 对 M10 的意义

若把 trivium 的四条入口命令装到项目里，宿主机上任意同名的 user 级命令会**静默盖掉它们**
——留痕上看不出来，只在 `diagnostics` 里有一行 warning，而 warning 没人读。

对应地，skills 那边是另一种坏法：**两份都在**，谁被模型选中取决于模型，
而 `skills list` 给不出答案。

**结论**：zcode 侧的入口资产**必须装在 user 级**（`~/.zcode/skills` 或 `~/.agents/skills`），
且安装器要先查重名、撞名就报错而不是覆盖。

### 3.5 边界

`skills list` 是**枚举面**，不是**加载面**。重名 skill 里模型实际加载哪一份，
要发一次真实调用才知道，**本轮没测**。commands 侧因为有 `duplicate_name` 诊断，
枚举面就是加载面，故 3.3 的结论比 3.2 强。

---

## 4. agy 的 Driver 入口承载面

### 4.1 已在用的：agent 定义（实测）

```console
$ agy agents
flutter_a11y_agent
trivium-critic
```

`trivium-critic` 由本项目安装器落在 `~/.gemini/config/agents/trivium-critic/agent.md`
（`install.ts:34`）。这条链路**已经接通并在生产使用**——它是 agy 只读保障的第 ① 道屏蔽。

### 4.2 待拍板项 J3 的答案：有第三个选项

演进设计 §16 第 3 项写的是「优先自定义 agent 定义，退路 `GEMINI.md` 契约」。
实测发现 agy 1.2.2 有**与另外三家同形的 skills 承载面**，二进制内嵌文档给出的迁移表：

| 作用域 | 旧形态 | 新形态 |
| :--- | :--- | :--- |
| 全局 | `~/.gemini/config/workflows/<name>.md`、`global_workflows/<name>.md` | `~/.gemini/config/skills/<name>/SKILL.md` |
| 工作区 | `<workspace>/.agents/workflows/<name>.md` | `<workspace>/.agents/skills/<name>/SKILL.md` |

且 `agy --help` 有 `--disable-slash-commands`，说明 slash command 与 skill 展开
在 print 模式下**默认开启**。

**J3 的建议答案改为**：优先 **skills**（四家同形，单源多渲染的成本最低），
agent 定义保留给**只读审查者**身份（它承载的是工具白名单，与入口资产是两件事），
`GEMINI.md` 契约降为退路。

### 4.3 边界：这一节是**静态证据**

4.2 的两条来自二进制内嵌文档与旗标帮助，**没有行为实测**。
`agy` 没有 `skills list` 一类的枚举命令，验证它要发真实调用。

**且 P-05 的教训正对着这里**：ZCode 的 `--help` 列过 `--max-turns`，实测被拒。
**旗标帮助不是能力证据。** M10 落地前必须补一次行为实测。

---

## 5. zcode `effort_flag` 复测：结论不变，但发现一条新线索

### 5.1 复测结论：**CLI 层无 effort 旗标**（实测，三条负对照）

版本仍是 **0.16.5**（与 M0 同版，`~/.zcode` 未升级）。

| 试的旗标 | 结果 |
| :--- | :--- |
| `--effort medium` | `Unknown option '--effort'`，**退 1** |
| `--reasoning-effort medium` | `Unknown option`，退 1 |
| `--thinking medium` | `Unknown option`，退 1 |

`--help` 的完整旗标表里也无 effort / think / reason / tier / depth 任何字样。

**M0 的记载成立，演进设计 §11 的「zcode 三档用模型选择承载」不必改。**

### 5.2 新线索：provider 层**有** `reasoning_effort`，但那不是 CLI 面

按 C-07 的手法扫二进制字面量，`reasoning_effort` 命中 **6 处**，全部在
OpenAI 兼容 provider 的请求构造层：

```js
reasoning_effort: b.reasoningEffort, service_tier: b.serviceTier, ...
// 以及
extra_body.chat_template_kwargs.reasoning_effort → n.reasoningEffort
```

还有一个显式的键集合：

```js
new Set(["budgetTokens","budget_tokens","effort","enable_thinking",
         "reasoningEffort","reasoning_effort","reasoning_enabled","thinking"])
```

**这意味着 effort 可能经 `config.json` 的 provider options / `extra_body` 传下去。**

**但这条线索本轮没有端到端验证**，不得据其改任何实现。它与 `ZCODE_HOME`
（C-12：字符串存在、对配置解析无效）是同一族风险——**二进制里有这个字符串，
不等于这条路走得通**。登记为 BACKLOG **EV-09**。

---

## 6. 本步新增的坑：**P-19～P-23，落在 M0 报告**

本步产出 5 个新坑，**条目正文写在
[`REPORT_2026-09-11_m0_probe.md`](./REPORT_2026-09-11_m0_probe.md) §7**，不在本报告里重复。

| # | 一句话 | 证据在本报告 |
| :--- | :--- | :--- |
| **P-19** | `CODEX_HOME` 隔离不住 skills 指令面，指令根跟 `HOME` 走 | §1（含负对照） |
| **P-20** | zcode 的 user 级 command **盖过** project 级，只有一条 warning | §3.3 |
| **P-21** | zcode 的 skills 重名**完全不去重不告警** | §3.2 |
| **P-22** | `~/.agents/skills` 是 codex 与 zcode **共享**的用户级技能根 | §1、§3.1 |
| **P-23** | codex 的模型可见承载面是 **skills 而非 `prompts/`** | §2（双哨兵对照） |

> **为什么不写在本报告里**：`P-xx` 在 M0 报告 §7 已经有唯一落点，`P-16～P-18`
> 就是 M4/M5 期间往那里补录的。本报告若另起一张表，同一编号立刻有两个落点、
> 且**会分叉**——这个主题里刚因为「同一事实两个落点」栽过一次
> （`task.json` 的 `gate.state` 与全局 `state.json` 说法不一致）。
>
> 反过来，M6 第 2/3 步报告里的 `P-C1` / `P-C2` 与 `D-1`～`D-3` **刻意不进** `P-xx`：
> 那些是「该家族与另两家的能力差异」，消费方是 M8/M9 的适配层设计；
> `P-xx` 是「本机环境的坑」，消费方是装机与运维。两者混编会让两边都变难查。

---

## 7. 证明边界（本报告不承诺什么）

1. **零模型调用**，所以凡涉及「模型实际加载哪一份」「展开后长什么样」的问题，
   本报告一概**没测**：zcode 重名 skill 的加载优先级（§3.5）、agy 的 skills 行为（§4.3）、
   codex prompts 是否仍作为 TUI 触发面（§2）。
2. **单机单版本**：`codex 0.154.0` / `zcode 0.16.5` / `agy 1.2.2`。三家都在活跃迭代，
   §3.1 的根枚举与 §2 的承载面判定都是**版本相关**的。
3. **§4.2 与 §5.2 是静态证据**（二进制字面量与内嵌文档），不是行为实测，已在原处标注。
4. **本报告不改任何代码**，也不写任何机读字段——理由见 §0。

---

## 8. 给后续里程碑的结论

| 里程碑 | 结论 |
| :--- | :--- |
| **M8**（codex 审核者） | 隔离必须 `CODEX_HOME` + `HOME` 双覆盖（§1）。这是本步对 M8 的**新增**前置条件 |
| **M9**（claude 审核者） | 本步无新增约束 |
| **M10**（任意 Driver） | 四家的入口承载面**都是 SKILL.md 形态**（agy 侧待行为实测）——演进设计 §10.2 的「单源多渲染」因此比原估的更可行：适配的是 frontmatter，不是正文。入口资产一律装 user 级（§3.4） |
| **M11**（档位） | zcode 仍无 CLI effort 旗标，三档继续用模型选择承载（§5.1）。provider 层的线索见 EV-09 |

### 待拍板项 J3 的收敛建议

**议题**：Antigravity 作为 Driver 的入口形态。
**原默认**：优先自定义 agent 定义，退路 `GEMINI.md` 契约。
**建议改为**：优先 `~/.gemini/config/skills/<name>/SKILL.md`；agent 定义保留给只读审查者身份；
`GEMINI.md` 降为退路。**前提是 §4.3 的行为实测在 M10 前补上**——现在就改成默认值，
等于把一条静态证据当成了结论。
