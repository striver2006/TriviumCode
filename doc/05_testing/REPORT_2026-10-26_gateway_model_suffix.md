# 网关模型名上下文后缀 · 测试报告（EV-258）

- **主题**：`网关模型名上下文后缀`（`/dual-run` 命令 A 全流程，Driver claude，审核者 codex、gemini、glm）
- **日期**：2026-10-26
- **基线**：`bcd24640`（`src/` 与 EV-257 提交 `f1ca93bb` 逐字相同；下文行号取自源码）
- **留痕**：计划 `.reviews/网关模型名上下文后缀/plan/`（定稿 r2）；代码审 `.reviews/网关模型名上下文后缀/code/`；证据 [`evidence/gateway-model-suffix-20261026/`](./evidence/gateway-model-suffix-20261026/)
- **登记**：BACKLOG EV-258；主设计 v1.3.180（§12「模型名的上下文窗口后缀与 AC-20 回读口径」）；EV-257 报告 §8 补记指向本报告
- **产品版本号**：不动（`package.json` 仍为 1.3.1，随 1.3.2 发版）

## 1. 问题

EV-257 的守卫 ④ `looksLikeModelName`（`src/trivium/adapters/claude-route.ts`）字符集 `[\w./:+-]` 不含方括号。2026-10-26 Windows 开发机（Qwen 网关，构建 `f1ca93bb`）上 CC Switch 写进生效模型名键的值带 Claude Code 的上下文窗口后缀：`ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` 为 `qwen3.8-flash[1m]`，`ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_FABLE_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` 为 `qwen3.8-max[1m]`。这 5 个键过不了守卫 ④，留在替换集；同值的几个键互为「与凭据同值」，守卫 ③ 连带不过。opus 档审查的 `init.model`（`qwen3.8-max[1m]`）被换成占位符，`claudeModelReadback` 兜底记 null + `unverified`；探针 `model_flag` 记 null。判读与逐键诊断见 [`evidence/gateway-readback-model-20261025/windows-readout.md`](./evidence/gateway-readback-model-20261025/windows-readout.md)。

同一份探针原文还显示：`init.model` 是 CLI 按别名 `opus` 读 `ANTHROPIC_DEFAULT_OPUS_MODEL` 解析出的**配置值**（带后缀），assistant 消息的 `message.model` 才是服务端回报的名（`qwen3.8-max`，CLI 发请求前剥掉了后缀）。EV-257 的代码注释与文档把 `init.model` 写成「网关回报」，不准确，本批订正。

## 2. 修法（计划三审 r2 定）

- **守卫 ④ 只放行末尾一个上下文窗口后缀**（`claude-route.ts`）：无锚片段 `CONTEXT_WINDOW_SUFFIX_PATTERN` = `\[[1-9][0-9]{0,3}[km]\]`（1～4 位不以 0 开头的数字加小写 k 或 m）；`CONTEXT_WINDOW_SUFFIX` 由它加 `$` 构造，`stripContextWindowSuffix` 只剥一个。`looksLikeModelName` 先剥，再对剥后部分照旧判字符集、长度 1～128、UUID、最长段 ≤ 16。方括号在别处、两个后缀、大写或其它单位、0 开头或超过 4 位、只有后缀，都剥不掉或剥后仍不合字符集，照旧替换。守卫 ②③ 看的仍是含后缀的完整值；`gatewayScrubPlan` 不改，同值的模型名键守卫 ④ 放行后都是候选、一并豁免，挂同一个值的非候选键仍让它进替换集。
- **`claudeProfileMetadata` 同一缺口同批修**：三种形态（双引号、单引号、不加引号）的值都改为 `[\w.\/:+-]+(?:片段)?`，由同一个无锚片段派生、行级正则自管锚定（计划三审 AGY-01 ≡ GLM-01）。不加引号的形态也收：包装器 `~/.local/bin/cld` 是 bash、`source` 读 profile；shell 对赋值右侧不做路径名展开（目录里放一个能匹配的 `qwen1` 文件，sh / bash / zsh / dash 对 `export M=qwen[1m]` 都输出原串，计划三审 CODEX-01）。消费面只有 doctor 的「配置声明模型」注记。
- **AC-20 回读口径**：`model_effective` 仍取 `init.model`、来源 `envelope`。理由：与另三家同为「CLI 自己回报按什么配置跑」（codex rollout、zcode 会话文件、agy 信封都是客户端记录）；`message.model` 在无 assistant 消息的运行里缺失、回落备用模型时多值、网关下同样由网关控制；`result.modelUsage` 按模型分桶、含旁路调用，不是单值。不一致时：`parseClaudeEvents` 新收 `reportedModels`（assistant 的非空 `message.model`，去重保序；空串不收，计划三审 AGY-02），`claudeModelConsistency(init, reported)` 判一致（每个回报值等于 `init.model`，或在 init 恰为「不含方括号的基名 + 一个后缀」时等于基名，计划三审 CODEX-03；取不到或无回报记 null），二者写进 `trace.json` 的 `modelReadback: { init, reported, consistent }`，只留痕、不进判定面、不降级不告警。
- **不动**：守卫 ①②③、替换集构造与降序、≥ 8 字符阈值、`claudeModelReadback`、探针 `model_flag` 的比法、run.json / `CriticResult` 契约。

## 3. 回归锚

### 3.1 单测 `test/unit/claude-gateway-scrub.test.ts`（追加 S10～S14；S1～S9 断言未动）

`REAL_MODELS` 加 `qwen3.8-max[1m]`，S4（豁免）与 S7（不算脱敏痕迹）随之覆盖带后缀形态。

| 格 | 钉住的事 |
| :--- | :--- |
| S10 | 5 个带后缀的真实形态（`[1m]`、`[200k]`、`[1000k]`）守卫 4 为真、豁免、替换集只剩凭据、输出原样保留——过窄方向 |
| S11 | 12 个方括号反例（中间、两个后缀、`[abc]` / `[1g]` / `[0m]` / `[12345m]` / `[1M]` / `[]` / `[ 1m]`、尾随空白、只有后缀、方括号包随机令牌）：形态拒、不豁免；≥ 8 字符的进替换集且输出不含原值；`[1m]`（4 字符）不进替换集、与修复前相同（计划三审 CODEX-02）——过宽方向 |
| S12 | 随机令牌 / UUID / OpenAI 形态各加合法后缀：先断言后缀剥得掉（咬的是剥后判据），仍不豁免、被替换 |
| S13 | Windows 实测 12 键形态（合成值、保持同值关系）：10 个模型名键全部豁免、替换集恰为两个凭据值；加一个挂同值的非模型名键 ⇒ 挂它的三个模型名键不豁免、其余 7 个照旧 |
| S14 | `reportedModels` 去重保序、空串 / 非字符串 / 非 assistant 不收；`claudeModelConsistency` 真值表（取不到 / 无回报 ⇒ null；逐字相同、带后缀对基名 ⇒ true；完全不同名、真前缀非剥后结果（计划三审 GLM-02）、两个后缀只剥一个、后缀不合法 ⇒ false）；`modelFamily` 对带后缀的 qwen / claude 名照旧判族 |

### 3.2 `test/unit/access-modes.test.ts`（追加一格）

`claudeProfileMetadata` 三种形态各收一个带后缀的值；方括号在中间、两个后缀、`[abc]`、`[1M]`、`[0m]` 在三种形态下一律不收。

### 3.3 集成 `test/integration/claude-gateway-env.test.ts`（追加 E11；E1～E10 断言未动）

假 CLI 新增只给 E11 用的开关 `FAKE_CLAUDE_MESSAGE_MODEL_KEY`（多吐一条 assistant 事件、`message.model` 取该键的值），E1～E10 不设、行为逐字不变。文件头注释补 EV-258 一类不变量，并说明用例名里「网关回报的模型名」沿用 EV-257 叫法（改名会让历史读数与变异规格对不上）。

| 格 | 场景 | 断言 |
| :--- | :--- | :--- |
| E11 | 开启；`ANTHROPIC_MODEL` 与 `ANTHROPIC_DEFAULT_OPUS_MODEL` 同为 `gw-ev258-model-01[1m]`，`*_OPUS_MODEL_NAME` 不带后缀，另有两个凭据键 | `model_effective` 为带后缀名、来源 `envelope`；审查调用三路凭据值零命中、占位符出现；`reportedModels` 为不带后缀的名、一致性 true；探针臂 `init.model` 为带后缀名、凭据零命中；`probeClaude` 的 `model_flag === true` |

### 3.4 `test/integration/claude-directory-adapter.test.ts`（追加断言）

经 `claudeAdapter.run()` 落盘的 `trace.json`：三种模型（正常、失败、超时）`modelReadback` 三键恒在；正常一格为 `{ init: 'stub/0.0.0', reported: [], consistent: null }` 且 `init` 等于 `model_effective`；入口不可执行那一格（run 层返回 spawned:false、走正常落盘路径）为三键全空。计划 r2 原写「spawn 失败那条早退分支不加」——那条分支（`run()` 抛出）在本用例里走不到，本用例的「入口不可执行」走的是正常路径，断言按实际路径写。

## 4. 变异

规格由 [`gen-mutation-spec.mjs`](./evidence/gateway-model-suffix-20261026/gen-mutation-spec.mjs) 生成（find 唯一、替换串不含 `$` 特殊模式），先用重打 bundle 的带超时逐条预跑（[`mutation-names-output.json`](./evidence/gateway-model-suffix-20261026/mutation-names-output.json)，记失败用例名），再跑正式装置 `scripts/mutation-check.mjs`（[`mutation-output.txt`](./evidence/gateway-model-suffix-20261026/mutation-output.txt)）：**21 条全部咬住**，两次读数一致。

| 类 | 条目 | 咬住的格 |
| :--- | :--- | :--- |
| 去掉后缀放行（过窄） | M1 / M1b 恒不剥；M8 / M8b 字符集改看原值 | S4、S10、S12～S14；E11 |
| 后缀放行过宽 | M2 任意位置方括号；M3 任意后缀内容；M4 多个后缀；M5a 大小写不敏感；M5b 位数不限 | S11（M2 另红 S12，M3 / M5a 另红 S14） |
| 剥后跳过或看原值 | M6 剥得到就放行；M7 UUID 判据看原值 | S11、S12 |
| profile 元数据两向 | M9 不放行后缀；M10 放行任意方括号内容 | access-modes 新格 |
| AC-20 留痕 | M11 前缀比较；M12 / M12b 去掉剥后缀分支；M13 / M13b `reportedModels` 恒空；M14 不核剥后部分；M15 `trace.json` 的 `consistent` 恒 false；M16 空串混入 | S14；E11；目录臂适配器断言（M15） |

## 5. 本机零配额验收（macOS，假 CLI）

`git archive bcd24640` 导出基线树（`node_modules` 软链、`--with-tests` 构建），与当前工作树各跑 [`accept-run.mjs`](./evidence/gateway-model-suffix-20261026/accept-run.mjs)（照 EV-257 那份改：网关 env 加两个同值的带后缀模型名键与一个不带后缀的 `*_MODEL_NAME` 键，加情形 `suffix`，多记 `reported_models` 与 `consistency`；两态 × 四情形 × 审查调用、探活、探针一臂、`probeClaude` 全量、目录臂四组），[`accept-readout.mjs`](./evidence/gateway-model-suffix-20261026/accept-readout.mjs) 判读：**38 项全部通过**（[`accept-readout.txt`](./evidence/gateway-model-suffix-20261026/accept-readout.txt)）。

| 情形 | 基线 `bcd24640` | 当前构建 |
| :--- | :--- | :--- |
| 未开启 × 四情形 | 缺省名、`envelope`、`model_flag` true | 归一化后全部输出、组装结果、探针结论、目录臂结论**逐项相同**，回读与 `model_flag` 相同 |
| 开启 × 不带后缀的三情形（default / model / cred） | EV-257 的行为 | 与基线逐项相同 |
| 开启 · `init.model` 取带后缀的键（suffix） | 回读被吞：null + `unverified`，探针臂 `init.model` 为占位符，`model_flag` null | 带后缀名 + `envelope`；探针臂 `init.model` 为带后缀名；`reported_models` 为不带后缀的名、一致性 true；`model_flag` false（所选 haiku ≠ 回读名，核对不符） |
| 凭据值（两侧全部 16 份输出） | 零命中 | 零命中 |

两侧被测产物 `adapters/claude.js` 的 sha256 不同。对拍 JSON 只存分段 sha256（每份 1～2 KB）。

## 6. 全量读数

代码审之前，`npm run check` 前台串行两次（开跑前确认无残留 `node --test`）：

| 次 | 用例 | 过 | 红 | 跳过 | 退出码 | 耗时 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 4009 | 3999 | 0 | 10 | 0 | 352 s |
| 2 | 4009 | 3999 | 0 | 10 | 0 | 367 s |

用例数对基线 4002（EV-257 收口读数）净增 7：单测 S10～S14 共 5 格、profile 后缀 1 格、集成 E11 1 格（目录臂适配器的断言追加在既有用例里）。

S10 `trivium verify`（`.reviews/网关模型名上下文后缀/verify/`，代码审之后、先 `npm run install:local`，安装副本与仓库构建 sha256 前缀 `ef5163e2` 一致）：`npm run typecheck`、`npm run build`、`npm test` 三条命令均退 0，测试 4009 / 3999 / 0 / 10，346 秒。

### 6.0 双审读数

- 计划三审 1 轮（run `20261026T112757Z`）：codex、gemini 修改后通过，glm 通过；8 条全接受（CODEX-01 不加引号形态也收后缀、CODEX-02 短反例分层断言、CODEX-03 一致性判定的剥后缀前提、AGY-01 ≡ GLM-01 无锚片段、AGY-02 空串不收、AGY-03 `trace.json` 断言落点、GLM-02 真前缀格），合入 r2。
- 代码三审 1 轮（run `20261026T121048Z`，42 个文件、212.4 KB）：codex、gemini、glm 均通过、零意见，计票 3 / 0 / 0；不改代码与测试。应答件记了一处相对计划的偏离（§3.4 目录臂断言按实际可达路径写），glm 侧已核。

### 6.1 文档对账

grep「`looksLikeModelName`｜四道守卫｜`system/init` 回报｜网关回报」（论域 `doc/`（不含 `evidence/`）、`skills-src/`、`skills/`（排除打包产物）、`README.md`）。改了：主设计 §12 两处（订正措辞、守卫 ④ 补后缀）与新增一段、变更记录 v1.3.180、文档头版本；稳定版系统设计说明书第 107 行；稳定版需求说明书第 61 行（计划表外，grep 补出）；Bug 清单第 105 行与第 131 行（计划表外，grep 补出）；EV-257 报告 §8 补记。代码注释：`claude-route.ts` 三处、`claude.ts` 两处、`probes/claude.ts` 一处。`skills/` 与 `skills-src/` 无命中。其余命中是历史报告与证据（不改原文）。

## 7. 已知边界

- **形似模型名的短段凭据加一个合法后缀**，与不加后缀时同样放行（EV-257 剩余边界的延伸，不新开口子）。
- **大写单位 `[1M]` 不认**：fail-closed，代价是那个值照旧替换、回读记 `unverified`。Claude Code 与 CC Switch 实测都写小写。
- **`model_flag` 在网关机器上记 false**：按别名 `opus` 选模型、回读到的是解析后的全名，两者不等；这是别名比对的既有口径（EV-256 验收时也是 false），不在本题。
- **`trace.json` 在全部机器上多一个 `modelReadback` 键**：诊断留痕，不进判定面；「未开网关零变化」承诺的是 scrub 输出与 `model_effective`。
- **一致性判定只认「剥一个合法后缀」这一种改写**：网关把模型名改写成别的形态时记 false，不告警；生效模型照记 `init.model`。

## 8. Windows 真实网关验收

动用凭据、花配额，只能在 Windows 开发机上做；执行前先问用户。清单 [`windows-acceptance.md`](./evidence/gateway-model-suffix-20261026/windows-acceptance.md)：扫描器自检 → 逐键诊断（零配额，[`diag-scrub-plan.mjs`](./evidence/gateway-model-suffix-20261026/diag-scrub-plan.mjs)，凭据类键只打印长度）→ doctor（探针原文 `init.model` 为带后缀名、`model_flag` 不为 null）→ 一次 claude 作审核者的真实审查（`model_effective` 为 `qwen3.8-max[1m]`、来源 `envelope`，`trace.json` 的 `modelReadback` 一致）→ 落盘扫描（凭据零命中）；全程输出写到仓库外 `%TEMP%\ev258`，落文件 `Out-File -Encoding utf8`、读文件 `-Encoding UTF8`。读数待回传。
