# M8 第 3 步 · codex 接入为审核者 实施计划

- **日期**：2026-09-15
- **起点**：`9d511a6`（M8 第 2 步，适配层契约泛化）
- **范围依据**：M8 总计划 §4「第 3 步 · codex 接入（②③④⑥⑦ 五件 + J8 + J2）」
  （[r1 原稿](./2026-09-15-M8-Codex审核者接入-claude.md) §4）
- **规范依据**：主设计 §16.1 M8 行、§5.1.1 接入套件七件、§3.6 实测事实、§11.1 轨迹能力与判定分档、§10.1 措施 b
- **实测依据**：[M6 codex 探针报告](../../../doc/05_testing/REPORT_2026-09-14_m6_codex_probe.md)、
  [M6 入口承载面报告](../../../doc/05_testing/REPORT_2026-09-15_m6_driver_entry_probe.md)，
  **以及本计划起草期间新做的四组实测（§2，含三条此前无人知道的阻断项）**

---

## 0. 本步定位：前两步把契约备好了，这一步是第一次接真东西

M8 第 1 步落地了措施 b（命令文本字面扫描），第 2 步落地了 `TraceCapability`
（判定层按能力分档而非按 Agent id 分叉）。两步都**没有拉起过一次 codex**——
它们的正确性是靠桩 Agent（`adapters/stub.ts` 的 `command-trace` 形态）证明的。

本步是对真检验。M8 总计划 §5.1.1 的「证明边界」写得很清楚，桩**不**证明：
参数构造、只读旗标、轨迹解析、模型覆盖生效档位一概不经过。这四件全在本步。

**本步不跑 AC-20 的真实审查**（那是第 4 步 J3～J6），本步的终点是
「codex 这一侧能被选上、预检过得去、诊断有确定结论」。理由是把「接得上」与
「审得对」分成两次双审——前者的失败形态是环境与契约，后者是证据与判定，
混在一轮里查错成本高，而本步的实测（§2）已经证明前者的坑比预想多。

---

## 1. 范围与完成判据

### 1.1 本步承接的判据（编号沿用 M8 总计划 §1.1）

| # | 判据 | 出处 | 本步交付形态 |
| :--- | :--- | :--- | :--- |
| J2 | 隔离同时覆盖 `CODEX_HOME` 与 `HOME` | §16.1 M8 行前置② | `prepareCodexHome()` + 零配额负对照 |
| J7（另一半） | 接入套件七件齐备 | §5.1.1 | ②③④⑥⑦ 五件落地（① 翻开关、⑤ 显式不做） |
| J8 | 逐家族 provider 探活 | §16.1 M8 行 | `CodexProbe.providers` + 预检拒绝 |

### 1.2 本步的完成判据（可执行）

| # | 判据 | 怎么验 |
| :--- | :--- | :--- |
| S1 | `npm run check` 全绿 | 命令 |
| S2 | `trivium doctor --only codex` 给出确定结论，且含**逐家族 provider** 结论 | 命令 |
| S3 | `trivium review --start --critics codex,glm` 预检通过、codex 入选并记入运行元数据 | 命令（**不等真审完**，见 §7） |
| S4 | 隔离负对照：副本环境下模型可见输入**不含**任何第三方 skill 与 MCP server | `codex debug prompt-input`（零配额） |
| S5 | 既有两家（gemini / glm）的判定结果逐项不变 | 既有用例 + 逐条审视被翻开关带动的期望值变化（§6.3） |
| S6 | 四条变异验证逐条如实变红 | §6.2 |

### 1.3 明确不在本步

- **J3～J6（AC-20 真机验收）**、文档回填、主设计升版 → 第 4 步；
- **第 ⑤ 件入口资产**：EV-06 登记的「`instructionFiles` 无消费方」未解决，
  本步补它等于再造一个假覆盖，**显式不做**（沿用 M8 总计划 §2.1 的裁定）；
- M9 / M10 / M11 的任何内容。

**一处提议前移，请审查者裁**：**J9（密钥扫描增补）建议并入本步，不留到第 4 步。**
理由不是顺手：本步的 `prepareCodexHome()` 会把 `~/.codex/auth.json` 与含
**明文 bearer token** 的 `config.toml`（§2.3 实测）拷进 `~/.trivium/runs/<run>/`。
凭据副本从本步开始存在，而扫描器要到下一步才认得这种形态——中间隔着一轮双审与一次提交。
「产生风险的那一步」与「覆盖风险的那一步」之间不该有窗口。

---

## 2. 开工前实测（本次新做，2026-09-15）

M6 的两份报告没有覆盖到下面四组事实。**其中 F-2、F-3 是阻断级的**——
按 M6 报告的记载直接实现，第一次真跑就会失败或失守。

### F-1 · 生效模型**不在**事件流里，回读手段是会话文件

`codex exec --json` 的 stdout 只有 JSONL 事件，**没有任何 model 字段**。
本次三组调用的事件流逐行核对，`thread.started` 只给 `thread_id`，
`turn.completed` 只给 `usage`。既有样本
[`test/fixtures/codex-events/read-sentinel.jsonl`](../../../test/fixtures/codex-events/read-sentinel.jsonl)
同形。

回读落点是会话文件首行：`$CODEX_HOME/sessions/<YYYY>/<MM>/<DD>/rollout-<时间戳>-<thread_id>.jsonl`，
`type: "session_meta"` 的 payload 里有三个可用字段：

| 字段 | 本次实测取值 |
| :--- | :--- |
| `model_provider` | `qwen` / `deepseek` |
| `base_instructions.provenance.model` | `qwen3.8-max` / `deepseek-flash` / `qwen3.8-flash` |
| `cli_version` | `0.154.0` |

**三组调用，其中第三组是关键**：

| # | 命令 | 回读到的 provider / model |
| :--- | :--- | :--- |
| 1 | `codex exec -p qwen …` | `qwen` / `qwen3.8-max` |
| 2 | `codex exec -p deepseek …` | `deepseek` / `deepseek-flash` |
| 3 | `codex exec -p qwen **-m qwen3.8-flash** …` | `qwen` / **`qwen3.8-flash`** |

第 3 组证明该字段**跟随 `-m` 覆盖**，而不是复读 profile 意图——
这正是 AC-20 那句「生效模型仍以回读为准、不采信 profile 意图」要的东西。
第 1 组与第 2 组互可区分，AC-20 的 J3 有了可行路径（真跑留给第 4 步）。

文件名里的 `<thread_id>` 与 `thread.started` 事件的 `thread_id` **逐字相同**，
关联不靠「取最新文件」这种会串号的手法（zcode 侧踩过，坑 P-14）。

> **边界，必须写进实现注释**：`base_instructions.provenance` 不是公开契约，
> 字段名可能随版本变。因此实现取不到时**记 `unverified`，绝不用 requested 冒充**
> （沿用 `adapters/zcode.ts:341` 的既定纪律）。
> 另：三组调用都在**共享** `~/.codex` 下取得，隔离副本下会话是否仍落在
> `$CODEX_HOME/sessions` 尚未验证，列为本步开工第一件事（§8）。
> 还有一条：`--ephemeral`（不持久化会话文件）与本回读手段**互斥**，不得使用。

### F-2 ·【阻断】配置里的 `~` 路径跟 `HOME` 走，隔离 `HOME` 后 codex 直接退出

本机 `~/.codex/config.toml` 与 `~/.codex/qwen.config.toml` 都写着：

```toml
model_catalog_json = "~/.codex/models-qwen.json"
```

`~` 由 **HOME** 展开，不由 `CODEX_HOME` 展开。于是按 M6 第 4 步报告的 B 臂做法
（`CODEX_HOME=<副本> HOME=<空目录>`）跑起来是这个结果：

```text
$ CODEX_HOME=<副本> HOME=<fakehome> codex debug prompt-input
Error: No such file or directory (os error 2)      # exit 1
```

**只隔离 `CODEX_HOME` 则正常**——所以这个坑恰好被 M6 第 4 步的三条臂错过了：
那次 B 臂只看「`r1` 根消失了没有」，没看退出码之外的可用性。

**处置**：副本准备时把配置里的 `~/` 前缀路径**重写为副本内绝对路径**，
并把它指向的文件一并拷进副本。验证见 F-3 的第二段。

> 口径要一般化，不能只修 `model_catalog_json` 这一个键：凡副本配置里
> 以 `~/` 开头的值都会在 HOME 隔离下失效。实现按「扫描并重写」做，
> 命中项逐条留痕，而不是按键名白名单挑一个改——后者下次换个键就再犯一次。

### F-3 ·【阻断】不裁剪配置直接隔离，等于把宿主机的 MCP 与第三方 skill 带进审查会话

`codex debug prompt-input`（零配额，渲染模型可见输入）在**真实环境**下的输出里有：

- **6 个 skill 根**、约 25 份第三方 skill 的**完整描述**，其中包括
  `deliver: 代码提交、推送和版本管理的完整流程`、
  `autoglm-browser-agent: 智能浏览器自动化…点赞/评论/转发/收藏、发帖/发消息、登录网站`；
- `mcp_servers.node_repl`（一个 JS REPL）与十余个 plugins。

前者是 EV-08 已登记的指令面泄漏；**后者是新的**——MCP server 是独立进程通道，
`-s read-only` 管的是模型生成的 **shell 命令**，管不到 MCP 工具。
「只读审查员」的承诺与「会话里挂着一个 JS REPL」不能同时成立。

**处置 + 验证**：副本的 `config.toml` 按**白名单**裁剪，只保留
`model` / `model_provider` / `model_reasoning_effort` / `model_catalog_json`
与 `[model_providers.*]` 段；`mcp_servers` / `plugins` / `marketplaces` /
`features` / `notify` / `tui` / `desktop` 一律剥掉。叠加 F-2 的路径重写后实测：

```text
$ CODEX_HOME=<裁剪副本> HOME=<fakehome> codex debug prompt-input     # exit 0
skill roots: ['`r0` = `<副本>/skills/.system`']
含 deliver 技能: False    含 autoglm: False    含 node_repl: False
输入总长 17098（真实环境下为其数倍）
```

第三方 skill 与 MCP **全部消失**，且 codex 能正常渲染——F-2 与 F-3 的处置**合在一起才成立**，
单独做任一条都不行（只裁剪不重写路径 ⇒ F-2 退出；只重写不裁剪 ⇒ F-3 泄漏）。

> `[projects.*]` 段的 `trust_level` 也在剥掉之列，但被审项目根需要它，
> 否则 codex 可能在非交互下要求信任目录。实现按当次 `project_root`
> **重新生成一条**，而不是把宿主机整张信任表抄过去。
> 这一条**尚未实测**（本次 `debug prompt-input` 不走信任判定），见 §8。

### F-4 · 两条实现细节

- **`item.type` 出现了 `reasoning`**——探针记录的 `json_item_types`
  （`command_execution` / `agent_message` / `error`）里没有它。说明 item 类型集
  随模型与版本变，解析器对未知类型必须宽容（跳过而不是抛），
  但**新类型要能进探针结论**，否则「新类型出现时重录样本」这条口径无从触发。
- **即使 argv 已给 prompt，codex 仍读 stdin**（stderr：`Reading additional input from stdin...`）。
  适配器必须显式给空 stdin，否则会挂到超时。
  `codex exec --help` 确认 `[PROMPT]` 支持 `-` 从 stdin 读，
  **本计划选择走 stdin 传 BRIEF**：BRIEF 是几十 KB 量级的文本，塞进 argv 是在赌 `ARG_MAX`。

---

## 3. 设计要点

### 3.1 适配器形状

新增两个文件，与既有两家同构：

| 文件 | 职责 | 同构参照 |
| :--- | :--- | :--- |
| `adapters/codex-trace.ts` | 事件流解析（纯函数） | `adapters/zcode-trace.ts`、`adapters/agy-events.ts` |
| `adapters/codex.ts` | argv 构造、隔离准备、执行、结果组装 | `adapters/zcode.ts` |

**解析器从 `probes/codex.ts` 搬出来，探针改为 import 它。** 现在
`parseCodexEvents` 住在探针里（`probes/codex.ts:265`），适配器再写一份就是第二事实源
（纪律 7）。搬家要保证 `test/unit/codex-events.test.ts` 逐条不变地通过——
**它是这次搬家唯一的安全网，先跑一遍确认它现在就是绿的，再动。**

`buildCodexArgs()` 是纯函数（同 `buildZcodeArgs`），形态：

```text
exec [-p <profile>] -m <model> -c model_reasoning_effort=<effort>
     <探针实测的只读旗标…> --json --skip-git-repo-check -C <project_root> -
```

**只读旗标一律由 `probe.cli.codex.readonly_flags` 构造**（原则 P7，本机实测为
`['-s','read-only']`），不抄设计文档里的示例；探针没实测到旗标即判该侧不可用。

### 3.2 能力声明

`base.ts` 补一个与 `TOOL_TRACE_CAPABILITY` 对称的导出：

```ts
export const COMMAND_TRACE_CAPABILITY: TraceCapability = {
  traceShape: 'command-trace',
  rejectionRecorded: false,   // P-C2：被沙箱拒绝的命令不产生事件
};
```

codex 适配器声明它即可，判定层（`guard.ts` / `checkEvidence` / `effectiveReadPaths`）
在第 2 步已全部改为面向能力，**本步不动判定层一行**。这是第 2 步先泛化后接入的兑现点，
若本步发现判定层仍需为 codex 改动，那是第 2 步泛化不彻底的证据，要如实记，不要顺手改。

### 3.3 `write_events` 的判据

codex 侧没有结构化写事件，只能从命令文本判。两种错法的代价不对称：

- **误判成写** ⇒ 整侧作废，流水线不可用（假阳性）；
- **漏判** ⇒ 只读失守漏检（假阴性）。

判据取**两个条件同时成立**：`status: "completed"` 且 `exit_code: 0`，**且**命令形态为写类。
理由是沙箱是第一道防线且负对照通过——只读模式下写命令**跑不成**（被拒则依 P-C2
完全不留痕，未被拒则退非零码）。于是「写命令 + 成功退出」只在**沙箱真失守**时出现，
误报面极小。写动词的识别复用措施 b 已有的资产（`base.ts:276` 起的 `WRITE_VERB_TARGET`
那张表的动词集），**不新起一张表**——两张表会漂移，EV-17 记的就是这种漂移 grep 级对不出来。

> 阴性方向的不可信由 `rejectionRecorded: false` 在第 2 步已经处理：
> 没检出写事件时排除不了「试过但被拒」，降级如实留痕在
> `guard.verification_degraded.readonly`。本步不重复实现，也不放宽。

### 3.4 隔离：`prepareCodexHome()`

与 `prepareZcodeHome()`（`adapters/zcode.ts:159`）同位，但要做的事多两件：

1. 建 `<runDir>/codexhome`（`CODEX_HOME`）与 `<runDir>/codexhome/fakehome`（`HOME`）；
2. 拷入 `auth.json`、基底 `config.toml`（**按 F-3 白名单裁剪**）、本次 profile 的
   `<name>.config.toml`（同样裁剪）、`model_catalog_json` 指向的目录文件；
3. **重写 `~/` 前缀路径**为副本内绝对路径（F-2），命中项逐条留痕；
4. 按当次 `project_root` 生成 `[projects."<root>"] trust_level`；
5. 凭据文件 `chmod 600`（同 zcode 侧的既定做法）。

**绝不改用户全局配置**（纪律 5）。副本是只读消费，源文件一个字节都不动。

### 3.5 J8：逐家族 provider 探活与预检拒绝

`CodexProbe` 增一个字段（名字待定，暂记 `providers`）：逐 provider 家族的配置结论。
判据取自 `[model_providers.<id>]` 段是否存在、以及该段是否带得出凭据
（本机形态是 `experimental_bearer_token`，也要认 `env_key` 指向的环境变量）。
**只记「有没有」，不记凭据值**，与 `secrets.ts` 的既定口径一致。

预检接线（AC-20 末条）：选了 codex 且其本次模型所属家族**未配置** ⇒ 退 `EXIT.ENV`
并给**可粘贴的配置样例**，不代写、不改全局配置（§18.1 #2 已拍板）。

> 为什么预检必须自己拦：`unknown_profile_rejected` 实测为 **false**，
> codex 对未知 profile **静默回落基底配置**（§3.6）。拼错 profile 名不会有任何提示，
> 用户以为跑的是 deepseek、实际跑的是基底那家。

### 3.6 doctor 能力对账

`CodexProbe.trace_path_structured` 与 `.rejected_command_in_trace` 两个字段，
类型注释里登记的消费方就是「**M8 第 3 步起**：doctor 的能力对账」
（`types.ts:239`、`types.ts:253`），而第 2 步明写「对账代码还不存在」。本步补上：
把探针实测值与适配器 `capability` 声明比对，不符则在 doctor 输出里点名。

这是 EV-06（登记而无消费方）的一次真实清偿，不是新功能。

---

## 4. 三个必须拍板的决策

### D-1 · 翻开关会让**默认审查侧数变成三侧**（成本翻 1.5 倍）

`review.default_critics` 的默认值是 `[...CRITICS]`（`config.ts:220`），
而 `CRITICS` 由注册表的 `criticEnabled` 派生（`types.ts:74`）。
**把 codex 的 `criticEnabled` 翻成 true，默认就从两侧变三侧**——
每次 `/dual-review-*` 多烧一份配额、耗时取最慢侧，`max_critics: 3` 容得下但成本是真的。

那行注释（`config.ts:216-219`）写的是「启用第三家时这里自动跟随，不必记得回来改」，
所以这是设计的**故意选择**，不是遗漏。

**本计划提议**：产品默认语义**不动**（自动跟随保留），但在**本仓库**的
共享配置里显式写 `review.default_critics: [gemini, glm]`，把 codex 留给 `--critics` 显式选；
等第 4 步 AC-20 真机验收通过、这一侧的稳定性有实测依据之后，再由用户决定是否纳入默认集合。

理由：**每次审查的成本翻倍是用户可见的行为变化，不该由一次「接入」顺带决定。**
第 4 步之前 codex 侧一次真实审查都没跑过，让它默认参与每一轮是拿用户的配额做测试。

**这条请用户拍板**（审查者可以评估理由是否成立，但花钱的是用户）。

### D-2 · codex 的审查文档抬头用哪个字母

注册表 `label` 字段现在是 `'OpenAI Codex'`，而 gemini / glm 是
`'Critic-A · Google Antigravity'` / `'Critic-B · 智谱 ZCode'`。
注册表注释明写「codex / claude 启用为审核者时（M8 / M9）字母由届时的设计裁定，现在不预留」
（`agents/registry.ts:52-56`）——**现在就是届时**。

**提议 `Critic-C · OpenAI Codex`**。理由：A/B 是主设计第 0 章术语表钉死的称谓、
不是按运行期位置算的序号，所以新启用者取下一个未用字母；M9 的 claude 取 D。

### D-3 · J9（密钥扫描）是否前移到本步

见 §1.3 末段。**提议前移。**

---

## 5. 改动清单

### 5.1 接入套件内（§5.1.1 的七件）

| 件 | 文件 | 动作 |
| :--- | :--- | :--- |
| ① | `src/trivium/agents/registry.ts` | `criticEnabled: true` + `label` 定字母（**放最后做**，见 §6.3） |
| ② | `src/trivium/adapters/codex.ts` | 新增 |
| ② | `src/trivium/adapters/codex-trace.ts` | 新增（解析器从探针搬出） |
| ② | `src/trivium/adapters/index.ts` | `WIRED` 加一行 |
| ③ | `src/trivium/probes/codex.ts` | 补 provider 探活；改 import 搬出去的解析器 |
| ③ | `src/trivium/types.ts` | `CodexProbe` 加 provider 字段 |
| ④ | `skills/dual-critic/lenses.yaml` | 加 `codex:` 键（三阶段镜头，见 §5.3） |
| ⑥ | `src/trivium/config.ts` | `profiles.{default,flash}.codex` |
| ⑦ | `skills/dual-critic/schema/config.v2.json` | `agents` 的 oneOf 加 `vendor: "openai"` 一支 |
| ⑦ | `src/trivium/types.ts` | 加 `CodexCriticConfig`，并入 `AgentConfig` 联合 |
| ⑦ | `src/trivium/config.ts` | `defaultConfig().agents.codex` |

### 5.2 接入套件**外**（如实登记，不扩白名单）

| 文件 | 动作 | 为什么它在套件外 |
| :--- | :--- | :--- |
| `src/trivium/preflight.ts` | 探活加 codex 分支、`checkReadonlyCapability` 加 codex 判据、provider 家族校验 | EV-05 已登记：这三项「按厂商写死」 |
| `src/trivium/doctor.ts` | 能力对账（§3.6） | EV-06 的清偿 |
| `src/trivium/adapters/base.ts` | 导出 `COMMAND_TRACE_CAPABILITY` | 与 `TOOL_TRACE_CAPABILITY` 对称的一行 |
| `src/trivium/secrets.ts` | codex 凭据形态（若 D-3 通过） | 扫描规则表按厂商列举 |

> 这张表是 **FR-31「新增一家只需七件、核心零改动」的实测反证**。
> §5.1.1 的「已知缺口」早就预告了 preflight 三项，本步把它坐实，
> 并新增一条（`secrets.ts`）。第 4 步据此回填 §5.1.1 与 EV-05，
> **不是往套件白名单里加几条让断言变绿**——那等于把「核心要改」重新定义成「不算改」。

### 5.3 镜头（第 ④ 件）的内容

两侧现有镜头分工是「需求覆盖 / 架构与不可逆决策」（gemini）与
「边界失败路径 / 并发一致性 / 安全」（glm）。codex 取第三视角，提议：

- **plan**：外部依赖与环境假设（版本、平台、可得性）；成本与配额；可回滚性
- **code**：跨平台与环境耦合（路径、shell、编码）；资源与生命周期（句柄、子进程、临时文件）；对既有调用方的兼容性
- **bug**：时序与环境因素（并发、时钟、locale）；能否在干净环境复现；修复的可观测性

这是**提议**，请审查者判它与既有两侧的重合度——镜头重合会让三审退化成同审，
而 `report` 的 Jaccard 退化提示只在**事后**告警。

---

## 6. 测试计划

### 6.1 新增用例

| 文件 | 测什么 |
| :--- | :--- |
| `test/unit/codex-argv.test.ts` | argv 由探针结论构造；`-s read-only` 必在；profile / model / effort 透传；prompt 走 stdin |
| `test/unit/codex-trace.test.ts` | 事件解析 → `command_texts` / `write_events`；未知 item 类型（`reasoning`）宽容跳过 |
| `test/unit/codex-model-readback.test.ts` | `session_meta` 解析（fixture 取本次实测录制并脱敏）；取不到时记 `unverified` |
| `test/unit/codex-isolation.test.ts` | 裁剪白名单（`mcp_servers` / `plugins` / `notify` 必被剥）；`~` 路径重写；`chmod 600`；`HOME` 指向 fakehome |
| `test/unit/codex-availability.test.ts` | 各档不可用理由互不混淆（未探过 / 无入口 / 无只读旗标 / headless 读不到 / provider 未配） |
| `test/unit/preflight.test.ts`（扩） | 家族未配置即拒 + 指引可粘贴 |

fixture 用本次三组实测的真实输出录制（`session_meta` 只含 provider 名与模型名，
**不含凭据**；`cwd` 字段改写为占位路径）。

### 6.2 变异验证（四条，逐条必须如实变红）

| # | 变异 | 期望变红处 |
| :--- | :--- | :--- |
| M1 | `capability` 改回 `TOOL_TRACE_CAPABILITY` | 证据下限与路径回填相关用例 |
| M2 | argv 去掉只读旗标 | `codex-argv` 用例 |
| M3 | 裁剪白名单放行 `mcp_servers` | `codex-isolation` 用例 |
| M4 | `model_effective` 取 requested 值冒充 | `codex-model-readback` 用例 |

本项目已四次出现「绿测试证明不了任何事」，这一条不省。
M3 尤其重要：它守的是 §2 F-3 那条实测，而那条是**只读承诺**的一部分。

### 6.3 翻开关会带动既有用例，逐条审视而不是批量改绿

`criticEnabled: true` 一改，`CRITICS` 从两家变三家，会波及一批既有期望值
（默认侧集合、多审退化的配对数、错误文案里的可用值列表…）。

**纪律**：逐条看每个变红的用例**是不是它本该变**。批量把期望值改成三家，
会把真实缺陷一起改绿——M7b 第 4 步的 `default_critics` 事故就是这个形状
（迁移逻辑按「实有键」补默认集合，把审查面**缩小**了，而测试全绿）。
所以这一步放在最后做，且改动逐条写进代码阶段的裁决件。

---

## 7. 一处口径要先说清：S3 不等于「真审了一次」

S3（`--critics codex,glm` 能选上且预检过）**不包含**等审查跑完。
预检里的探活会真拉起一次最小 headless 调用（既有形态，两家都是这么做的），
那是分钟级、配额极小的动作；而真实代码审是十几分钟 + 真配额，属第 4 步。

**不得**据 S3 声称 AC-20 的任何一条达成。这句话写在这里，是因为本项目
已经有过「拿部分达成当完整达成」的先例（AC-22 的三侧分支）。

---

## 8. 自查：本计划里哪些还没被实测证实

按本主题 r3 的教训（「引用一个已有机制作为新口径的依据前，先读它的实现」），
这里把**没有实测支撑**的部分逐条列出来，不藏在正文里：

| # | 未证实的断言 | 风险 | 何时验 |
| :--- | :--- | :--- | :--- |
| U1 | 隔离副本下会话文件仍落在 `$CODEX_HOME/sessions`（F-1 的三组实测都在共享 HOME 下做的） | 若不落在那里，`model_effective` 回读**整个失效**，AC-20 的 J3 无路可走 | **开工第一件事**，零配额可验（跑一次最小 exec 看副本目录） |
| U2 | `[projects.*] trust_level` 重新生成后，非交互下不会要求信任目录 | 会让每次审查卡在信任提示上 | 同 U1 那一次实测一并看 |
| U3 | `write_events` 判据的误报面「极小」——这是**推理**（沙箱负对照 + P-C2），不是实测 | 误报会让整侧作废 | 第 4 步真机时观察；本步用例只能覆盖构造的样本 |
| U4 | 镜头第三视角与既有两侧不重合 | 三审退化成同审 | 第 4 步真机后看 `report` 的 Jaccard |
| U5 | provider 探活的判据能覆盖 `env_key` 形态（本机只有 `experimental_bearer_token` 一种） | 另一种形态的用户会被误判为「未配置」 | 本步用例用构造样本覆盖，**真实的另一种形态无从实测**，如实记为边界 |

U1 是唯一会推翻方案的一条，所以它排在实现之前。

---

## 9. 请审查者重点看

1. **§3.3 的 `write_events` 判据**：「成功执行 + 写动词 ⇒ 沙箱失守」这个推理链
   有没有第三种解释？（比如：写到 `/tmp` 或工作区外的成功写入算不算失守？
   沙箱 read-only 是否对某些路径本就放行？）这条判错的代价是整侧作废。
2. **§3.4 的裁剪白名单是不是漏了别的通道**：我按本机 `config.toml` 的实有段列的白名单，
   而别人的机器上可能有我这台没有的段。白名单（只保留列出的）比黑名单（剥掉列出的）安全，
   但**新版本 codex 若把模型相关配置挪进新段，白名单会静默丢功能**——这个取舍对不对？
3. **§2 F-2 的处置口径**：「扫描并重写所有 `~/` 前缀值」会不会误伤
   （某个键的值本就该指向用户真实 HOME）？
4. **D-1 的默认侧数**：产品默认自动跟随、本仓库配置显式钉两侧——
   这是「诚实的克制」还是「给纪律 7 开了个后门」？
5. **D-3 的 J9 前移**：凭据副本与扫描覆盖之间不留窗口，这个理由够不够硬？
6. **§5.2 那张「套件外」表**：它是 FR-31 的反证。我主张如实登记 + 第 4 步回填文档，
   **不**扩白名单。有没有哪一条其实是本该泛化掉的核心硬编码，而我把它当成了「固有成本」？
