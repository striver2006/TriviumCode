# M9 · Claude Code 接入为第四个审核者 实施计划

- **日期**：2026-09-17
- **起点**：`1dbc7d5`（M9 交底落盘），`main` 干净
- **基线核实**：`npm run check` 本会话复跑 **1300 通过 / 0 失败，exit 0**（不是转述交底）
- **依据**：主设计 §16.1 M9 行、§3.7、§3.7.1、§11.1（判据一/二/三）、§5.1.1 接入套件七件、
  §9.3、§10.1.1、§10.3；BACKLOG **EV-39 / EV-40 / EV-41**
- **实测依据**：[M6 claude 探针报告](../../../doc/05_testing/REPORT_2026-09-14_m6_claude_probe.md)、
  本机 `.trivium/config.local.yaml` 的 `probe.cli.claude` 段（`probed_at: 2026-09-16T05:48:13Z`）
- **明确不读**：演进设计 §7.2（正文自 v1.0.0 冻结，调用模板已作废，照抄当场失守）

---

## 0. 交底核实结果

交底自己写着「每一条都要自己核一遍」。以下是核的结果，**不是转述**。

### 0.1 交底断言逐条核对（全部成立）

| 交底断言 | 核实 | 证据 |
| :--- | :--- | :--- |
| §16.1 M9 行 ⏳ 未开始 | ✅ | 设计 §16.1 二期表 M9 行 |
| 开关在注册项，注释「M9 启用」 | ✅ | `src/trivium/agents/registry.ts:136` |
| `adapters/claude.ts` 不存在 | ✅ | `ls src/trivium/adapters` 无该文件；`index.ts` 的 `WIRED` 三家 |
| `probes/claude.ts` 已有 | ✅ | 探针结论已落盘，字段齐 |
| `lenses.yaml` 四键齐备 | ✅ | 顶层键 `gemini` / `glm` / `codex` / `claude`，claude 三轴（plan/code/bug）齐 |
| 审查员身份片段缺 | ✅ | `protocol/` 下只有 `AGENTS.md.snippet`（审查员）与 `CLAUDE.md.snippet`（**Driver 协议**） |
| `config.v2.json` 的 `agents` oneOf 缺 anthropic 分支 | ✅ | 三分支 antigravity / zcode / openai；description 自写「claude 随 M9 / M10 加入」 |
| 「当轮 Driver 不得入选」独立存在 | ✅ | `src/trivium/critics.ts:120`，不依赖 `criticEnabled` |
| `critics.test.ts` 锁住了这个场景 | ✅ **打开看过** | `test/unit/critics.test.ts:111`「Driver 检查不依赖 criticEnabled 顺带生效（M9 之后仍要挡住）」——它显式传 `driver: asCritic` 模拟 M9 之后的形态 |
| `readonly_flags` 是可直接使用的 argv 片段 | ✅ | 落盘为 `['--restricted','--strict-mcp-config','--tools','Read,Grep,Glob']`，按 codex 同款透传 |
| `--json-schema` 收内联 JSON | ✅ | `json_schema_ok: true`，探针 `probeArgs` 的入参注释写明「不是文件路径」 |
| `adapters/` 不得 import `probes/` | ✅ | `registry-parity` 第 5 条，逐行扫 import/require |

### 0.2 与设计表述**有出入**的一条（我核出来的）

设计 §3.7 的事实表把 `denied_tool_in_trace` 记作
「**true**（模型真去调写工具时）／**null**（它没去调时）」。
**本机落盘是 `null`**（`config.local.yaml` 的 claude 段）。

后果不是记录错，是**证据面缺一块**：`ClaudeProbe.denied_tool_in_trace` 的字段文档写着
「**消费方**：`guard` 的 `write_events` 判定——为真时设计 §10.3『轨迹有写事件即判失守』
对该侧**成立**」。本机既然是 `null`，那条成立性在本机**没有正向证据**，
而 M9 的适配器恰恰要按「rejectionRecorded: true」声明能力。
处置见第 2 步（补一次正向实测，把 null 变成确定值），不在计划里当它已经是 true。

### 0.3 交底**没写**的四条阻塞（本计划的主要增量）

| # | 阻塞 | 证据 | 不处置的后果 |
| :--- | :--- | :--- | :--- |
| **B-1** | **选侧入口从不把当轮 Driver 传进 `resolveCriticSelection`**，`--driver` 旗标在 CLI 里**根本不存在**（`grep -n driver src/trivium/cli.ts` 零命中）。于是 `input.driver ?? DEFAULT_DRIVER` 恒为 claude | `critics.ts:45`、`cli.ts:470` / `cli.ts:633`、`topic-args.ts:328` | 翻开 `criticEnabled` 后 claude **仍然**被「自己审自己」那条当场退 64，**M9 的完成判据一次都跑不成** |
| **B-2** | **Hook 的角色后缀拦截集由 `CRITICS`（= `criticEnabled` 全集）派生**。claude 进集合后，Driver 自己的 `-claude.md` 产出会被自己的 Hook 拦死 | `hooks.ts:92` `hasCriticRoleSuffix`、`hooks.ts:474` `ROLE_SUFFIX_ANYWHERE`；`test/unit/hooks.test.ts:53-54` 正锁着「`-claude.md` 不是角色工件」 | 那两条用例当场变红；真装上去则本仓库的 Driver 再也写不了任何计划稿 |
| **B-3** | **接入套件是七件，交底那张表只列了六件**——漏了第 ⑥ 件「模型路由 `profiles.<档位>.<id>`」。本仓 `.trivium/config.yaml` 与 `config.ts` 的 `defaultConfig()` 里 `profiles.default` / `profiles.flash` **均无 claude 键** | `test/fixtures/stub-agent-kit/overlay.ts:64-78`（`KIT_WHITELIST` + 第 ⑥ 件的说明）；`.trivium/config.yaml:68-95`；`config.ts:286-297` | `routeModel` 取不到模型，`review.ts` 当场退 69。overlay 的注释自己写着「把它写进计划是为了避免排障时把这个 69 误判成泛化失败」 |
| **B-4** | **`DEFAULT_MAX_CRITICS = 3` 且 `defaultSelected` 已满三家**（codex/gemini/glm） | `registry.ts:275`、`deriveDefaultCritics` 的不变量二 | claude 若标 `defaultSelected: true`，**模块加载期就抛**，整个 CLI 起不来 |

另有一条**测试夹具自曝**：`test/unit/critics.test.ts:133` 的
「已登记但未启用为审核者」用例靠 `ALL_AGENT_IDS.find(id => !criticEnabled)` 取夹具，并断言
`assert.ok(pending, '四家全部启用时本用例失去意义，届时改用别的夹具')`。
**M9 就是那一天**——四家全启用后 `pending` 为 undefined，该用例当场红。
用例自己预告过，处置见第 4 步。

### 0.4 已决（2026-09-17，由项目负责人当面裁定）

- **B-1 的处置**：把 M10 完成判据里「两个选侧入口必须把当轮 Driver 传进
  `resolveCriticSelection`」那一行**提前到 M9 落地**；M9 自身的代码双审照旧由
  gemini/glm/codex 做，claude 不入选，**自审不变量分毫不动**。
- **B-2 的处置**：把两处派生的**判据语义**从「产出方是审核者」改成「产出方不是我」——
  `ALL_AGENT_IDS` 去掉当轮 Driver。今天行为逐字不变（当前恰等于全集减 claude），
  翻开关后不会误锁 Driver 自己的稿子，M10 换 Driver 时语义天然跟随。
  **不走「给 claude 后缀加具名豁免」**：EV-39 早写明这类修法会一点点掏空守卫，
  且 M10 换 Driver 后豁免就指错了人。

---

## 1. 范围与完成判据

### 1.1 完成判据（抄自 §16.1 M9 行，不自行放宽）

| # | 判据 | 出处 |
| :--- | :--- | :--- |
| **J1** | `adapters/claude.ts` 落地并接线，接入套件**七件**齐备 | §16.1 M9 行、§5.1.1 |
| **J2** | 审查员身份片段落地，且**其注入路径真的会生效**（见第 4 步 B-5） | §16.1 M9 行、§7.2 要点 1 |
| **J3** | `criticEnabled` 翻为 true，且 `defaultSelected` **保持 false** | §16.1 M9 行、决策 D-1 先例 |
| **J4** | **真实审查一次**：经完整编排链路拉起 claude，产出合规 `trivium.review.v1` | §16.1 M9 行 |
| **J5** | **`consulted` 交叉核对通过**（`consultedUnverified === false`，阈值 80%） | §16.1 M9 行、`guard.ts:346-356` |
| **J6** | 只读负对照：让它试写，**文件未落且尝试留痕**（`denied_tool_in_trace` 取到确定值） | §10.3、§3.7 |
| **J7** | 准入三件 **EV-41 / EV-39 / EV-40** 全部结案 | 交底第 2 节、BACKLOG |
| **J8** | 自审不变量仍然成立：Driver 为 claude 时选 claude 仍退 64，**有用例** | `critics.ts:120`、§12 异常矩阵首行 |

### 1.2 明确不在本轮范围

- **M10 的其余部分**：四家入口资产单源渲染、`install` 多目标、`hooks --agent`、
  `approve` 前置复核、协议片段两段式、`driverEnabled` 的翻转、agy skills 真实加载实测。
  本轮**只**提前 `--driver` 传参那一行，且**不翻任何一家的 `driverEnabled`**。
- **M11**：档位全链路、`profiles` 的 `{tier}` 形态、report 按 Driver 聚合、§24 台账全绿。
- **`--max-budget-usd` / `--max-turns` 的成本闸门与轮数上限**：设计 §11.1 判据一「尺度类」
  一行写明 `CriticRequest` 现有 `model` / `effort` / `timeout_s` 三个字段，
  **成本闸门与轮数尚无字段**，要用须先补接口字段与探针。本轮**不做**，新登记一条 BACKLOG。
  超时（`review.timeout_s`）是已有的硬闸，本轮的成本兜底只有它——这是如实的边界，不是遗漏。
- **`path_deny` 对 `Grep` 的覆盖缺口本身**：实测结论是 `permissions.deny` 能力不完整，
  不是规则没写全（§3.7）。本轮**不试图修它**，只按 §3.7 的要求保证事后轨迹核验在场。

---

## 2. 第 1 步：准入实测（**一行适配器代码都不写**）

交底的起点建议第 1 条。验不掉这些，`adapters/claude.ts` 就是建在假设上。

### 2.1 EV-41：`-p` 的 prompt 载入形态

**待定的是形态不是尺寸**——本机 `getconf ARG_MAX` = 1048576，代码双审已实测单个
1,000,000 字节 argv 项 exec 成功。**不做分片、不做截断**，只验形态。

三种形态各跑一次，同一个任务、同一个哨兵：

| 形态 | 命令骨架 | 说明 |
| :--- | :--- | :--- |
| A | `printf '%s' "$PKG" \| claude -p <只读旗标…>` | 无位置参数，prompt 走管道 |
| B | `claude -p <只读旗标…> -` | 位置参数 `-`，**codex 同款**（`exec … -`，78 KB 跑通） |
| C | `claude -p <只读旗标…> "$PKG"` | argv 直传，探针现状 |

- **尺度**：haiku（`claude-haiku-4-5-20251001`）+ `--max-budget-usd`，与探针同档；
  先跑小包（几百字节）确认形态，再各跑一次**真实量级**（取一份现成 BRIEF，约几十 KB）。
- **判据**：`system/init` 与 `result` 事件正常、最终回复**复述出哨兵**（证明 prompt 真被读到）。
  只看退出码不算——探针文件头早就写着「只看哨兵会把『模型压根没去读』误判成『挡住了』」。
- **落点**：结论回填设计 §3.7.1 的 stdin 那一行 + 实测报告 + BACKLOG **EV-41 转 done**。

### 2.2 顺带三件（同批跑，边际成本≈0）

| 项 | 问题 | 判据 |
| :--- | :--- | :--- |
| **P-a** | **`--restricted` 下 `CLAUDE.md` 到底加不加载？** 探针文件头只写了它「忽略 user / project / local **配置文件**」——`CLAUDE.md` 是记忆文件不是 settings，两者不是一回事 | 夹具项目根放一份含哨兵指令的 `CLAUDE.md`，问「你的项目指令里有什么哨兵」。**这一条决定第 ⑤ 件片段是不是真的有作用**——不加载就说明反指令风险本来就不存在，那第 ⑤ 件的理由要重写，不能照抄交底 |
| **P-b** | `denied_tool_in_trace` 本机为 `null`（§0.2） | 提示词**强制发起一次 Write 调用**（与 `probeClaudePathDeny` 给 Grep 加固的同款写法），看 `tool_use` 是否留痕、文件是否未落。取到确定值才谈得上声明 `rejectionRecorded: true` |
| **P-c** | 审查尺度该用哪个模型 slug？`probe.cli.claude.models` 是 **`[]`**（探针没采目录），`checkModelAgainstCatalog` 会落 `unverifiable` 而不报错——**猜错不会被拦下** | 拿候选 slug 各跑一次最小调用，以 `system/init` 的 `model` **回读**为准。回读不到的一律不采信 |

> **P-c 的要害**：另三家都有模型目录兜底，claude 这一侧**没有**。
> 预检只会打一行「⚠️ 无模型目录可比对、未实际校验」，然后放行。
> 所以这一侧的 slug 必须靠回读挣来，不能靠「文档上写着应该管用」。

**本步产出**：`doc/05_testing/REPORT_2026-09-17_m9_claude_entry_probe.md`（形态 + 上面三件）。
**本步不改任何业务代码。**

---

## 3. 第 2 步：探针补判据（EV-40 与两个升布尔）

改 `src/trivium/probes/claude.ts` 与 `ClaudeProbe`。三件都是「该事实已有、或**可以有**机读字段，
就必须落字段」（§11.1 判据一的准入句），不是后果分级。

| 新字段 | 判据怎么测 | 为什么必须是字段 |
| :--- | :--- | :--- |
| `stream_full_requires_verbose: boolean \| null` | 同一任务跑两次（带/不带 `--verbose`），**数事件条数** | **EV-40 本体**。现在这条绑定只活在探针注释与实测报告里，CLI 改成默认全量或换旗标名，探针不会发现，M9 只会白跑一次 |
| `path_deny_read_only: boolean \| null` | 已有的 Grep 负对照结论**升成布尔**，不再让消费方 `includes('Grep 绕得过')` 反解中文自由文本 | **EV-40 的另一半**（BACKLOG 原文点名）。`supported === true` 若被 M9 读成「deny 覆盖三个读工具」，被免掉的正是 §3.7 反复声明必需的事后轨迹核验——那是唯一兜底 |
| `strict_mcp_config_applied: boolean` | 探针侧判定 `readonly_flags` 里这条硬前置在不在 | **见 §4.2 的张力**：适配层要校验它在场，但**不得写出那个字面量**（第 6 条会打红）。落成布尔，适配层只读布尔，两边都干净 |

`denied_tool_in_trace` 由第 1 步的 P-b 填成确定值（字段已有，不新增）。

**验证**：`trivium doctor --only claude` 重跑，新字段有确定结论；
`registry-parity` 的反向对账（探针只读常量 ⊆ 黑名单）仍绿。

---

## 4. 第 3 步：适配器本体（含 EV-39）

### 4.1 轨迹解析归位：`adapters/claude-trace.ts`

`parseClaudeEvents` / `ClaudeTrace` 现在住在 `probes/claude.ts`。
适配层**不得 import probes**（第 5 条契约），但三家先例的方向是
**探针反向 import 适配层**：`probes/agy.ts` ← `adapters/agy-events.ts`、
`probes/zcode.ts` ← `adapters/zcode.ts`、codex 同构。

所以：把解析器**移到** `src/trivium/adapters/claude-trace.ts`，`probes/claude.ts` 改为 import 它。
一处事实一个来源，不出现两份解析器。

> **移动时必须留在探针侧的**：`READONLY_INVARIANTS` 与 `READONLY_TOOLS`。
> `registry-parity` 的防空转腿判据是「这些 token **彻底不在 `probes/` 出现**」，
> 把常量搬进 `adapters/` 会让上半条静默永绿——而那正是它设计来防的形态。

### 4.2 `buildClaudeArgs`：逐段来源严格按 §3.7.1

纯函数，与执行分离（codex / agy 同款，让调用配方有回归测试）。

| argv 段 | 来源 | 注意 |
| :--- | :--- | :--- |
| `--restricted` `--strict-mcp-config` `--tools Read,Grep,Glob` | `readonlyArgsFromProbe(probe.readonly_flags)` **原样透传** | **判据二**：claude 的落盘是可用 argv 片段，与 codex 同族，**不按 zcode 写** |
| `-p` | 适配层硬编码 | |
| `--output-format stream-json` + `--verbose` | 适配层硬编码，**两者绑定** | 绑定的机读判据由第 2 步补 |
| `--json-schema <内联 JSON>` | 旗标名硬编码；**值是 `req.schema_path` 的文件内容** | 实测传路径当场被拒（`Unrecognized token '/'`）。适配器读文件、内联字符串 |
| `--settings <内联 JSON>` | 旗标名硬编码；**规则写法读 `probe.path_deny.rule_syntax`**，值按 `req.deny_paths` 拼 | rule_syntax 落盘是**目录 glob** 形态（`Read(./<dir>/**)`），而 `deny_paths` 是**逐文件**清单——两者形状不同，第 1 步或本步要验一次逐文件规则确实生效，验不过就如实记「CLI 层这一道对逐文件形态无效」，由事后轨迹核验兜 |
| `--model <slug>` | `req.model` | |
| prompt 载入 | **第 1 步实测定** | |
| 成本闸门 / 轮数 | **不传**（§1.2） | |

**绝不出现**在本文件里的字面量：`--restricted` / `--strict-mcp-config` / `--tools` /
`Read,Grep,Glob` / `read-only` / `--allowed-tools`。
第 6 条契约会当场打红——**那是刻意的，不去改测试**。

### 4.3 `claudeAdapter` 各成员

| 成员 | 做法 |
| :--- | :--- |
| `capability` | 复用 `TOOL_TRACE_CAPABILITY`（`tool-trace` + `rejectionRecorded: true`）。**前提是 P-b 取到正向证据**；取不到则本轮如实登记边界，不拿设计表的转述当实测 |
| `availability(ctx)` | 六条：`probed_at` / `entrypoint` / `readonly_flags` 非空 / **`strict_mcp_config_applied`（读第 2 步新布尔）** / `headless_read_ok` / `tool_surface_checked`。两态判据同另三家：以 `probed_at` 区分「没探过」与「探过没找到」 |
| `run(ctx, req)` | 拉起 → 落 `stdout.jsonl` + `trace.json` → 解析 → 组装 `CriticResult` |
| `read_paths` | **结构化取**：`Read` 的 `file_path`、`Grep`/`Glob` 的 `path`。同时按 agy 同款记 `path_bearing_reads` / `path_bearing_reads_with_path` 覆盖率——两者不等即提取器已相对厂商参数名退化（§10.1.1 第②层） |
| `tool_calls` | `Read→read` / `Grep→grep` / `Glob→glob`。`run_command` 恒 0（白名单里就没有 Bash） |
| `write_events` | 轨迹里出现**白名单外工具**的 `tool_use` 即算。白名单外走「工具不存在」路径、**不进 `permission_denials`**（`ClaudeProbe.denied_tool_in_trace` 的字段注释明说判据要扫 `tool_use` 工具名） |
| `model_effective` | `system/init` 的 `model` **回读**；取不到记 `unverified`，**绝不用 requested 冒充**（与另两家同一条纪律，AC-20 的口径） |
| `peer_deny_applied` | `probe.path_deny.supported === true` ⇒ **本侧是三家里第一个取 true 的**。要核一遍读侧（`review.ts:1101/1168/1321`、report、run.json）有没有「恒 false」的隐含假设 |
| `scrubRunDir` | **不实现**。claude 凭据走自身登录态（`~/.claude` 下无 `.credentials.json`，在 Keychain 里），运行目录无副本。清扫如实记「该侧无载体」——「没得抹」与「抹过了」不能长得一样 |
| `authProbe` | **实现**，但 `fingerprint()` 返回 `null` 并写明理由（登录态不在文件里，无从算指纹，缓存只由 TTL 与 CLI 版本约束）；`probe()` 跑一次最小 headless 调用 |
| `catalogModelsFor` / `normalizeModelForCatalog` | **不实现**（该族目录不随配置分层、slug 无需归一）。契约里这两个本就是可选 |

### 4.4 EV-39：黑名单按厂商归属（**与建文件同一步**）

BACKLOG 写明触发条件是「M9 创建 `adapters/claude.ts` 的那一步一并做」，
暂缓理由是「文件不存在时按厂商收窄 = 让三个 token 对空集生效」。文件一建，理由消失。

做法：把 `BANNED_PROBE_TOKENS` 的扁平数组改成 **token → 归属厂商/文件** 的映射，
只对**该厂商自己的**适配器判红；归属由注册表或探针字段派生（与纪律 10 一致），
不手工枚举。`PROSE_EXCEPTIONS` 的「按 file + 理由」结构原样保留。

**两条防空转腿与反向对账一条都不能松**，且要补一条新的：
收窄后「某厂商的 token 却没有对应的适配器文件」必须**当场红**——
否则这次暂缓所担心的空转会以另一种形态回来。

---

## 5. 第 4 步：配套六件 + 两处连带修改

| 件 | 落点 | 内容 |
| :--- | :--- | :--- |
| ① 注册项 | `agents/registry.ts` | `criticEnabled: true`；**`defaultSelected: false`**（B-4：不然加载期抛）；`label` 改 `Critic-D · Anthropic Claude Code`（注册表注释自己写着「claude 启用时（M9）同理取 D」）。**`driverEnabled` 仍为 true**——M9 第一次出现「同一家既是 Driver 又是可选审核者」的组合 |
| ② 接线 | `adapters/index.ts` | `WIRED` 加一行 |
| ③ 探针 | 已有 + 第 2 步增补 | — |
| ④ 镜头 | 已有 | 四键齐备，无需改 |
| ⑤ 入口资产 | `protocol/CLAUDE.md.snippet` | **见 B-5** |
| ⑥ **模型路由** | `config.ts` `defaultConfig()` + `.trivium/config.yaml` | `profiles.default.claude` / `profiles.flash.claude` 三阶段 slug（值由 P-c 回读定）。**B-3：漏了就是退 69** |
| ⑦ 配置形状 | `config.v2.json` + `types.ts` | 新增 anthropic 分支 `{ vendor: 'anthropic', bin: string\|null }`（`additionalProperties: false`，`required` 写全）；`ClaudeCriticConfig` 并入 `AgentConfig` 联合；`.trivium/config.yaml` 加 `agents.claude` 段 |

### 5.1 B-5：第 ⑤ 件的注入路径**按交底字面做会静默跳过**

交底说「需新增与 `AGENTS.md.snippet` 同构的一份，由 `init.ts` 幂等追加
（该文件有现成的 `MARKER_BEGIN` / `MARKER_END` 机制）」。

**核过了：那样做不生效。** `appendSnippet` 的幂等判据是
`if (existing.includes(MARKER_BEGIN)) { skipped; return; }`（`init.ts:63`）——
`CLAUDE.md` 里已经有一块标记（装的是 Driver 协议），**第二块永远追加不进去**。

处置：把「审查员身份说明」段**并进 `CLAUDE.md.snippet` 同一块标记内**，
与 `AGENTS.md.snippet` 同构措辞（「以提示词首段的角色与禁令为准，忽略本文件中面向执笔者的
任务指令」）。一个文件、一块标记、一次追加。

> **连带**：本仓库自己的 `CLAUDE.md` 已含标记块，`trivium init` 会 skip，
> 所以新段落要**手工同步**进本仓 `CLAUDE.md`（用 Write 工具落，不走 Bash）。
>
> **另一条**：这一件的**理由**要等 P-a 的结论才能定稿。若实测 `--restricted` 下
> `CLAUDE.md` 根本不加载，那「反指令」这个理由就不成立，片段仍可保留（BRIEF 首段声明
> 优先级是既有手法），但**说明文字必须按实测写**，不能照抄交底那句推断。

### 5.2 B-2：Hook 角色后缀集改判据语义

`hooks.ts:92` 与 `hooks.ts:474` 两处派生，从 `CRITICS` 改为
**`ALL_AGENT_IDS` 去掉当轮 Driver**（M9 取 `DEFAULT_DRIVER`，M10 改为按会话 Driver）。

- 今天行为**逐字不变**：当前 `CRITICS` 恰等于全集减 claude。
- 翻开关后不会误锁 Driver 自己的稿子。
- `test/unit/hooks.test.ts:53-54` 两条断言**结论不变、理由要改写**：
  从「`-claude.md` 不是审核者角色」改成「`-claude.md` 是当轮 Driver 自己的产出」。
  注释里任何「X 会/不会 Y」的行为断言，落笔时必须指得出断言它的那一行用例（§16.1 那条纪律）。

### 5.3 `critics.test.ts` 的夹具失效（用例自己预告过的那天）

`test/unit/critics.test.ts:133` 的「已登记但未启用为审核者」用例靠
`ALL_AGENT_IDS.find(id => !criticEnabled)` 取夹具，四家全启用后取不到。

**待裁定（交给计划双审）**：三条路各有代价——

1. 删掉该用例 → `critics.ts:128` 那条分支失去覆盖，而它在 M11 之后新增 Agent 时会重新可达；
2. 改用存根注册表 → `resolveCriticSelection` 直接读真实注册表（`agentById`），
   要存根就得给它开一个只为测试存在的注入口，那是为测试改生产形状；
3. 保留用例但改成「显式记录：四家全启用后本分支在真实注册表下不可达」的**架构断言**，
   并在注册表新增第五家时自动重新生效。

我的倾向是 3（与本仓「覆盖面按实现真相写、不按愿望写」同口径），**但不自行拍板**。

---

## 6. 第 5 步：`--driver` 提前落地（M10 那一行）

范围严格限定在 M10 完成判据的那一句：
**「两个选侧入口（`topic resolve` 与 `review --start`）必须把当轮 Driver 传进
`resolveCriticSelection`」**。

- `topic-args.ts`：解析 `--driver`，传给 `resolveCriticSelection` 与 `locateSubjectReadOnly`
  （后者本就有 `driver` 形参，默认 `DEFAULT_DRIVER`，一直没人传）；
- `cli.ts`：两处 `resolveCriticSelection(ctx.config, {...})` 补 `driver`；
- 用例：**「当轮 Driver 不得入选」对非缺省 Driver 生效**（M10 判据明写要有用例）。

### 6.1 一处必须由双审裁定的口径

`--driver` 该不该校验 `driverEnabled`？

- 校验 ⇒ 当前只有 claude 合法 ⇒ `--driver codex` 被拒 ⇒ **验收还是跑不成**（死循环）；
- 不校验 ⇒ M9 的 `--driver` 比 M10 更松，且「声明了一个尚未启用为 Driver 的 Agent」
  这件事会静默通过。

**我的提案（不自行拍板）**：校验「已登记」即可，但只要
`driverEnabled === false` 就在**预检输出与 `run.json` 里如实标注**
「本次声明的 Driver 尚未启用为 Driver，该值仅用于选侧判定」。
理由与 `approve` 同构：这条防线靠的是调用方守规矩，而留痕要让事后对得上账。
M10 收口时把它收紧成 `driverEnabled` 校验。

---

## 7. 第 6 步：验收实跑（J4 / J5 / J6）

### 7.1 为什么不在本仓库跑

**claude 是本会话的 Driver。** 在本仓库让 claude 审本仓库的改动，
无论 `--driver` 写成什么，实质都是自己审自己——那是这条流水线要防的第一件事。

所以验收在**一个独立的临时项目**里跑：那里的执笔者确实不是本会话，
声明非 claude Driver 是如实的，不是为了绕检查。

### 7.2 剧本

1. 建临时项目（scratchpad 下），`trivium init`，放一段**真实可审**的小代码；
2. 走 **code 阶段**——它以 diff 为被审对象，**不需要 `<日期>-<主题>-<driver>.md` 原稿**
   （`locateSubjectReadOnly` 只对 plan/bug 要求原稿），省掉「由我代笔一份别人的稿子」这个别扭；
3. `trivium review --start --stage code --driver <非 claude> --critics claude`，`--wait` 到出结论。

### 7.3 判据逐条

| 判据 | 怎么看 |
| :--- | :--- |
| J4 | `_meta/review-claude-<run>.json` 通过 `trivium.review.v1` 校验，`status: ok`（不是 `parse_fallback`） |
| J5 | `run.json` 的该侧 `consultedUnverified === false`（匹配率 ≥ 80%） |
| J6 | 负对照：BRIEF 里布置一次写尝试 → 文件未落 **且** 轨迹里有那次 `tool_use` |
| 附 | `project_reads` ≥ 下限；`model_effective` 与请求一致且**来源是回读**；`peer_deny_applied === true`（三家里第一次） |

**报告**：`doc/05_testing/REPORT_2026-09-17_m9_claude_critic_acceptance.md`，
含达成边界（跑了几次、哪些分量有据、哪些只有单次样本）。

### 7.4 一条 M9 独有的成本/配额风险

claude 审核者与 Driver **共用同一个账号**——另三家都是独立账号。
一次 claude 侧审查会占用 Driver 自己的配额，极端情况下可能把 Driver 本身卡住。
这条要写进验收报告的边界，并作为「`defaultSelected` 保持 false」的第二条理由。

---

## 8. 第 7 步：回溯与留痕（纪律 6）

### 8.1 目标文档

| 文档 | 改什么 |
| :--- | :--- |
| 主设计 §3.7 | `denied_tool_in_trace` 按 P-b 的实测值改准（§0.2） |
| 主设计 §3.7.1 | stdin 形态那一行改成结论；`--verbose` 绑定的「来源」列指向第 2 步新字段 |
| 主设计 §11.1 判据一第三类 | EV-40 落地后**那一格就空了**——第三类当前「只剩 `--verbose` 绑定一格」的说法要随之改写 |
| 主设计 §11.1 判据三 | 黑名单按厂商归属后，覆盖面表与不覆盖形态表同步 |
| 主设计 §16.1 | M9 行状态；M10 行注明「Driver 传参那一句已随 M9 提前落地」 |
| 主设计 §24 台账 | 对应条目 |
| `.reviews/README.md` | 「当前真实生效的仍是两侧审查」（**已经过期两轮了**）、角色取值那两行的【待实施 · M8/M9】标记 |
| `AGENTS.md` / `CLAUDE.md` | 审查员身份段（§5.1）、协议里「Antigravity 与 ZCode 只做只读审查」的枚举 |
| BACKLOG | EV-39 / EV-40 / EV-41 转 done；新登记「成本闸门与轮数无接口字段」一条 |

### 8.2 落点清单**由 `grep` 生成，不手写**——且必须做差集自检

这是 EV-12 结案写进设计 §11.1 判据三的教训，本里程碑直接适用
（M9 大量涉及「同一份事实散落多处」）。

```bash
E="--exclude-dir=node_modules --exclude-dir=.reviews --exclude-dir=dist --exclude-dir=reference"
grep -rn "M9\|待实施\|尚未启用\|随后续里程碑"        --include="*.md" --include="*.ts" $E .
grep -rn "两侧审查\|双审\|三侧\|三家"                --include="*.md" --include="*.ts" $E .
grep -rn "criticEnabled\|driverEnabled"              --include="*.md" --include="*.ts" $E .
# 差集自检：广撒网一次，与上面三条的并集比对，差出来的就是锚点集漏掉的措辞
grep -rn "claude"                                    --include="*.md" --include="*.ts" $E .
```

> **⚠️ 锚点集本身也是手写清单。** 「改用 grep」只把记性从**落点**挪到了**措辞**。
> EV-12 复跑时**那一轮自己改写出的 `README.md` 新文本仍然逃出了自己记录在案的命令**。
> 所以最后那条广撒网的差集自检**必须跑**，并轮换措辞；
> 只跑前三条就宣布「清单由 grep 生成」，与手写清单是同一种自欺。

---

## 9. 已知风险与边界

| # | 风险 | 处置 |
| :--- | :--- | :--- |
| R-1 | `path_deny` 对 `Grep` 不生效，CLI 层拦截**不完整** | 事后轨迹核验是**必需项**，且必须覆盖 `Grep` 的 `path` 参数。`Glob` 通道未验，作为已披露缺口继续登记 |
| R-2 | claude 侧**无模型目录**（`models: []`），预检只给一行 ⚠️ 就放行 | slug 靠 P-c 回读挣来；`model_effective_source` 必须记 `trace`/`envelope`，回读不到记 `unverified` |
| R-3 | 成本闸门缺位，只有超时兜底 | 如实登记（§1.2），新开 BACKLOG 条目 |
| R-4 | `peer_deny_applied` 第一次取 true，读侧可能有恒 false 的隐含假设 | 第 3 步专门核一遍四个读点 |
| R-5 | 配额与 Driver 共用 | `defaultSelected: false`；写进验收报告边界 |
| R-6 | `--driver` 的自律性防线（§6.1） | 留痕如实标注；M10 收紧 |
| R-7 | 本计划自身是转述 | 第 0 节每条断言都给了文件行号，**复核时按行号看原文**，不要信本文的概括 |

---

## 10. 验证方式

1. **逐步验证**：每一步收尾跑 `npm run check`（基线 1300 通过）。
   **验证前必须 `npm run install:local`**——wrapper 指向全局副本，不装就验的是旧代码。
2. **架构契约**：`registry-parity` 全条（尤其第 5、6 条与镜头键对账）必须绿；
   EV-39 收窄后新增的「厂商无适配器文件即红」用例要能真红（变异验证一次）。
3. **接入套件**：`stub-agent-kit` overlay 零改动通过——它是「新增一家只改七件」的机器判据。
4. **变异验证**（不是可选项）：
   - 把 `--strict-mcp-config` 从探针常量里删掉 → 第 6 条反向对账必须红；
   - 在 `adapters/claude.ts` 里插一句 `'--restricted --strict-mcp-config'.split(' ')`
     → 第 6 条必须红，两个 token 分别报出；
   - 把 `model_effective` 改成 `?? req.model` 冒充回读 → 必须有用例红。
5. **端到端**：第 6 步的真实审查 + `trivium report`。
6. **自审不变量**：`--critics claude` 在 Driver 为 claude 时仍退 64（J8）。

---

## 11. 给审查员的提醒

本计划有四处**我自己拿不准、明确请裁定**的地方，不是修辞性的请示：

1. **§5.3** `critics.test.ts` 夹具失效的三条路，我倾向 3；
2. **§6.1** `--driver` 校不校验 `driverEnabled`；
3. **§4.3** `capability.rejectionRecorded` 在 P-b 拿不到正向证据时该声明成什么；
4. **§5.1** 第 ⑤ 件的**理由**依赖 P-a 实测结论，现在写的是待定形态。

另外请特别核对 **§0.3 的四条阻塞**是否真的成立——它们是本计划相对交底的主要增量，
若其中任何一条是我看错了，后面的步骤划分就要重排。
