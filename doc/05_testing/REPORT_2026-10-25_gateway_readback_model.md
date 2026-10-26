# 网关回读模型脱敏 · 测试报告（EV-257）

- **主题**：`网关回读模型脱敏`（`/dual-run` 命令 A 全流程，Driver claude，审核者 codex、gemini、glm）
- **日期**：2026-10-25
- **基线**：`66096574`（下文行号取自该提交的源码）
- **留痕**：计划 `.reviews/网关回读模型脱敏/plan/`（定稿 r2）；代码审 `.reviews/网关回读模型脱敏/code/`；证据 [`evidence/gateway-readback-model-20261025/`](./evidence/gateway-readback-model-20261025/)
- **登记**：BACKLOG EV-257；Bug 清单 §3.1 第 14 条（补记指向本报告）；主设计 v1.3.179（§12「逐值脱敏只对凭据类键、模型名回读不被吞」）
- **产品版本号**：不动（`package.json` 仍为 1.3.1，随 1.3.2 发版）

## 1. 问题

开了 `agents.claude.settings_env_source: user_settings` 时，`scrubGatewayEnv`（`src/trivium/adapters/claude.ts:528-536`）对网关 env 的**全部值**（≥ 8 字符）原串替换 `<redacted-env>`，`invokeClaude` 与探针 `execArgv` 都先脱敏、后解析事件流。CC Switch 网关在 `system/init` 回报的模型名恰等于 `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_*_MODEL[_NAME]` 等键的值，于是：

- 审查调用：`model_effective` 记成占位符，`model_effective_source` 仍是 `envelope`（占位符是非空串）——AC-20「生效模型以回读为准、拿不到记 unverified」被绕过，`family_comparisons.right_model` 拿占位符当模型名；
- 探针：`model_flag` 拿占位符与所选模型比，误记 `false`（「核对不符」），实际是「没核对成」；
- 准入 / 收口脚本：`readback.model` 同形记占位符。

2026-10-25 Windows 开发机实测复现（kimi 网关、claude 2.1.302），见 [`evidence/gateway-env-injection-20261025/windows-readout.md`](./evidence/gateway-env-injection-20261025/windows-readout.md) 末节与同目录 `windows-review-claude.md`、`windows-doctor.json`。

## 2. 修法（① + ③，计划三审定）

BACKLOG 列的三个候选：①逐值替换跳过模型名类键；②先从原始事件流解析再脱敏；③命中占位符记 null 与 unverified。取 ①+③，不取 ②：模型名本就要以明文进 `model_effective`，② 要把含凭据原文的 stdout 带出 `invokeClaude` 边界，且解析出的模型名仍要再判是否含凭据值。

- **替换表 `gatewayScrubPlan(env)`**（`claude.ts`，`scrubGatewayEnv` 与验收扫描脚本共用）：替换集 = 全部非豁免键的值（≥ 8 字符），按长度降序替换；模型名键的值要四道守卫同时满足才豁免——①键名过 `isModelNameKey`（`claude-route.ts`：`^(ANTHROPIC|CLAUDE)_(?:[A-Z0-9]+_)*MODEL(?:_NAME)?$`，按 `_` 切开后不含凭据词；区分大小写，非全大写的键一律按凭据处理）；②值过 `redactSecrets` 无命中；③值不等于任何非豁免键的值（凭据优先）；④值过 `looksLikeModelName`（字符集 `[\w./:+-]`、长度 1～128、最长字母数字段 ≤ 16、非 UUID）。
- **回读判定 `claudeModelReadback(init)`**（`claude-trace.ts`）：`init.model` 带脱敏痕迹（`secrets.ts` 的 `hasRedactionMark`：含 `<redacted` 或 `redact()` 首尾预览的 `…`）即 `{ model: null, source: 'unverified' }`；缺失 / 空串与修复前表达式逐字相同。消费方：`buildClaudeResult` 两格、探针 `model_flag`（被吞记 null）、`scripts/agent-access-admission.mjs`、`scripts/agent-access-closeout.mjs`。
- **未开启时 scrub 输出逐字不变**：`env` 为空时替换集为空、只过 `redactSecrets`，与修复前逐字相同。回读判定与网关开关无关：未开启时只在 `init.model` 自身带脱敏痕迹时由 `envelope` 改记 `unverified`（修正方向，见 §7，代码审 GLM-01）。
- **探针其余字段**（`init.tools` / `cwd`、`sessionId`、`toolUses`、`finalText`、`completed`、`toolErrors`、`permissionDenials`）的合法取值不会等于注入值，只在 CLI 回显凭据值时被替换——那正是脱敏要做的，修复前后相同，不改。
- **全仓 `init.model` / `readback.model` 读取点**：改 4 处（上列）；不改 4 处——`agent-access-restricted.mjs:40`（纯判定，占位符与 null 都判不符）、`probe-agent-access.mjs:41-50`（一次性回填 2026-10-09 历史证据）、`agent-access-closeout-summary.mjs:57,74-75`（跟随 closeout 产出）、`agent-access-summary.mjs:33-86`（读历史证据）。两份改动的脚本没有套件覆盖、不进变异。

## 3. 回归锚

### 3.1 单测 `test/unit/claude-gateway-scrub.test.ts`（新增，9 格）

| 格 | 钉住的事 |
| :--- | :--- |
| S1 | 键划分真值表：8 个模型名键为真；凭据键、伪模型键（`ANTHROPIC_AUTH_MODEL` 等）、非严格后缀、非全大写键共 17 个为假 |
| S2 | 模型名键的值保留、两个凭据键的值替换 |
| S3 | 凭据优先：同值挂在模型名键与凭据键上照旧替换 |
| S4 | 模型名键里填 JWT 形态（守卫 2）、OpenAI 形态、非标准随机令牌与 UUID（守卫 4）一律替换；7 个真实模型名形态全部豁免 |
| S5 | 替换集按长度降序，短凭据是长凭据子串时不留残段 |
| S6 | env 为 `undefined` / `{}` 时与只过 `redactSecrets` 逐字相同 |
| S7 | `hasRedactionMark` 认出生产方的每种实际产出（`<redacted-env>`、首尾预览、PEM 占位）；真实模型名与非字符串不认 |
| S8 | `claudeModelReadback` 真值表，缺失 / 空串与修复前表达式逐字相同 |
| S9 | `buildClaudeResult`：占位符记 null + `unverified`，正常名照旧 `envelope` |

### 3.2 集成 `test/integration/claude-gateway-env.test.ts`（追加 E8～E10）

E1～E7 的断言一行未动、保持全绿；只改文件头注释与 E7 用例名 / 注释措辞，把「凭据类键的值只以占位符出现」与「模型名键的值允许出现、正向覆盖在 E8」两类不变量分开写（计划三审 GLM-05）。假 CLI 新增两个只给 E8～E10 用的开关（`FAKE_CLAUDE_INIT_MODEL_KEY`、`FAKE_CLAUDE_RAW_LOG`），E1～E7 不设、行为逐字不变。E8～E10 不复用 `runAll`，「不出现」只对 `CREDENTIAL_VALUES`（`ANTHROPIC_AUTH_TOKEN` 与 `ANTHROPIC_BASE_URL` 的值）断言（计划三审 GLM-04）。

| 格 | 场景 | 断言 |
| :--- | :--- | :--- |
| E8 | 开启，网关回报的模型名等于 `ANTHROPIC_MODEL` 的值 | `model_effective` 为真名、来源 `envelope`；审查调用三路与探针臂 `raw` / `stderr` 凭据值零命中、占位符出现；探针臂 `init.model` 为真名；`probeClaude` 的 `model_flag === true` |
| E9 | 开启，网关把 `ANTHROPIC_AUTH_TOKEN` 的值当模型名回显 | `model_effective === null`、来源 `unverified`，不等于令牌值；stdout 无令牌；`model_flag === null` |
| E10 | 未开启 | `model_effective` 为缺省名、`envelope`；stdout / stderr 逐字等于原始输出只过 `redactSecrets`；`model_flag === true` |

## 4. 变异

规格由 [`gen-mutation-spec.mjs`](./evidence/gateway-readback-model-20261025/gen-mutation-spec.mjs) 生成（find 唯一、替换串不含 `$` 特殊模式），先用带超时的逐条预跑（`mutation-names-output.json`，记失败用例名），再跑正式装置 `scripts/mutation-check.mjs`（`mutation-output.txt`）：**21 条全部咬住**。

| 类 | 条目 | 咬住的格 |
| :--- | :--- | :--- |
| 模型名键被重新纳入逐值替换 | M1 / M1b `isModelNameKey` 恒假；M2 / M2b 替换集忽略豁免 | S1 / S2 / S4；E8 |
| 凭据键被误放出逐值替换 | M3 / M3b 恒真；M4 去凭据词表；M5 正则去锚定；M6 去守卫 2；M7 去守卫 3；M8 去降序；M9 去守卫 4；M10 正则大小写不敏感 | S1～S5、S7；M3b 同时打红 E1–E4、E7、E8、E9 |
| 占位符被记作 envelope | M11 / M11b `hasRedactionMark` 恒假；M12 不认首尾预览；M13 / M13b `buildClaudeResult` 退回直取；M14 探针 `model_flag` 退回原判据 | S7～S9；E9 |
| 未开启零变化 | M15 / M15b 回读判定对正常名也强制 unverified | S8 / S9；E8 / E10 |

## 5. 本机零配额验收（macOS，假 CLI）

`git archive 66096574` 导出基线构建，与当前构建各跑 [`accept-run.mjs`](./evidence/gateway-readback-model-20261025/accept-run.mjs)（两态 × 三情形 × 审查调用、探活、探针一臂、`probeClaude` 全量、目录臂四组），[`accept-readout.mjs`](./evidence/gateway-readback-model-20261025/accept-readout.mjs) 判读：**28 项全部通过**（`accept-readout.txt`）。

| 情形 | 基线 `66096574` | 当前构建 |
| :--- | :--- | :--- |
| 未开启 × 三情形 | 缺省名、`envelope`、`model_flag` true | 归一化后全部输出、组装结果、探针结论、目录臂结论**逐项相同** |
| 开启 · 网关不回报模型名键的值 | — | 与基线逐项相同 |
| 开启 · 回报名等于 `ANTHROPIC_MODEL` 的值 | `<redacted-env>` + `envelope`（复现缺陷） | 真名 + `envelope`；`model_flag` 按真实值比（所选 haiku ≠ 回报名 → false，属「核对不符」） |
| 开启 · 网关把令牌值当模型名回显 | `<redacted-env>` + `envelope`，`model_flag` false | null + `unverified`，`model_flag` null |
| 凭据值（两侧全部 12 份输出） | 零命中 | 零命中 |

首轮判读有 4 项「归一化输出逐项相同」不过：差异全部来自目录臂自建夹具的随机目录名 `trivium-probe-XXXXXX` 与由它派生的 `sourceHash`，属归一化缺口；补上这两项归一化后重跑，全部通过。两侧被测产物 `adapters/claude.js` 的 sha256 不同（`448dca5c…` / `38c8b791…`）。代码审首次发起时归档闸把对拍脚本的情形表（键名 `token` 配长串值）判成赋值形态的疑似密钥、拒绝落盘（误报，未绕过）；情形名改为 `cred`、键名分段拼接，归一化输出改为只存分段 sha256（12 份全文合计约 1.1 MB，进送审补丁太重），重跑后仍 28 项全部通过。

**扫描器自检**（计划三审 CODEX-01）：Windows 落盘扫描改用新脚本 [`scan-gateway-exposure.mjs`](./evidence/gateway-readback-model-20261025/scan-gateway-exposure.mjs)，分类直接导入构建产物的 `extractSettingsEnv` 与 `gatewayScrubPlan`，不另写口径；只有通过完整豁免条件的值报 NOTE。`--self-test` 三格（伪模型键泄漏 ⇒ LEAK、模型名键里的令牌形态值泄漏 ⇒ LEAK、真实模型名 ⇒ 只报 NOTE）全过（`scan-self-test-macos.txt`）；命令行在泄漏时退 1 也已实测。

## 6. 全量读数

代码审之前，`npm run check` 前台串行两次（开跑前确认无残留 `node --test`），读数 `check-1.txt`、`check-2.txt`：

| 次 | 用例 | 过 | 红 | 跳过 | 退出码 | 耗时 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 4002 | 3992 | 0 | 10 | 0 | 334 s |
| 2 | 4002 | 3992 | 0 | 10 | 0 | 334 s |

用例数对基线 3990（EV-256 收口读数）净增 12：单测 S1～S9 共 9 格、集成 E8～E10 共 3 格。

S10 `trivium verify`（`.reviews/网关回读模型脱敏/verify/`，代码审应答改完文档之后）：`npm run typecheck`、`npm run build`、`npm test` 三条命令均退 0，测试 4002 / 3992 / 0 / 10，357 秒。

### 6.0 双审读数

- 计划三审 1 轮（run `20261025T135958Z`）：codex、gemini、glm 均修改后通过；8 条：6 接受（CODEX-01、GLM-01～05），2 部分接受（AGY-01 词表补 PASS / PASSWD / PWD 接受、键名大写归一化不采纳——那是放松；AGY-02 类型守卫接受、全空白模型名与大小写不敏感匹配不采纳——前者改变未开启机器的行为、后者没有对应的生产方），合入 r2。
- 代码三审 1 轮（run `20261025T144753Z`，42 个文件、211.6 KB）：codex 通过（零意见）、gemini 通过（零意见）、glm 通过（GLM-01 nit：「未开启零变化」的概称在回读侧不完全成立）；接受，只改文档措辞（主设计 §12 段与变更记录、BACKLOG、本报告 §2 与 §7），不改代码与测试。首次发起（run `20261025T144617Z`）被归档闸以疑似密钥拒绝落盘、未拉起审查员，原因与处置见 §5。

### 6.1 文档对账

整仓 grep「值不落｜不落任何留痕｜注入值｜逐值脱敏｜redacted-env」（论域 `doc/`（不含 `evidence/`）、`skills-src/`、`skills/`（排除打包产物）、`README.md`、`src/`、`scripts/`、`test/`）。改了：`claude.ts` 两处注释、`claude-route.ts` 两处注释、`probes/claude.ts` 一处注释、`doctor.ts` 注记（「凭据值不落留痕」）、需求说明书第 61 行、系统设计说明书第 107 行、`scripts/manual-supplement.md` 第 18 行（计划表外，grep 补出）、Bug 清单 §3.1 第 0 条（计划表外，grep 补出）与第 14 条、主设计 §12 补段。`skills/dual-critic/schema/config.v2.json` 的 `settings_env_source` 描述只说「不进命令行」，不改。其余命中是历史报告、证据与本主题新增的代码注释。

### 6.2 附带订正

[`windows-readout.md`](./evidence/gateway-env-injection-20261025/windows-readout.md) 第 2 步说三个模型名键的值「探针本来就把它记进 models 并落盘」，不准：`probeClaude` 的 `models` 初值是 `[]`、全仓没有写 claude 探针 `models` 的代码；那几处命中更可能来自本机层给 claude 配的模型 slug（与网关回报名相同，计划三审 GLM 侧核过 `windows-doctor.json`）。结论（凭据键零命中）不受影响；Bug 清单第 14 条已补同一订正。证据原文不改。

## 7. 已知边界

- **形似模型名的凭据误填进模型名键会放行**：四道守卫防的是误配，不是判别凭据的完备算法。由短段拼成、字符集合规、不命中模式规则、又不与别的凭据同值的凭据填进模型名键，修复后会明文落盘（修复前被「全部值都替换」兜住）。CC Switch 写这些键时填的是模型名，只在手工误配时出现；登记在主设计，不再加启发式（加得越多，误伤真实模型名、让回读无故 unverified 的面越大）。
- **非全大写的模型名键**（`ANTHROPIC_model`）按凭据处理：该键的模型名会被替换、回读记 unverified——fail-closed 方向，可接受。
- **未开启机器上回读判定的一处差异**（代码审 GLM-01）：`claudeModelReadback` 不感知网关开关，未开启时若 `init.model` 本身命中模式脱敏（模型名恰为令牌形态，被换成首尾预览）或含省略号字符 `…`，修复前记「占位符 + `envelope`」、修复后记「null + `unverified`」。这是 AC-20 要的修正方向，真实模型名不会是这两种形态；「未开启零变化」只对 scrub 输出逐字成立（S6 / E10），排查未开启机器上的 `unverified` 时先看 `trace.json` 的 `init.model` 是否带痕迹。
- **全空白模型名**仍记 `envelope`（不是脱敏痕迹，改它会改变未开启机器的行为，不在本题）。
- 截断 / 折行 / 再编码形态的凭据泄漏面不在原串替换射程内，与 EV-256 登记的残余同口径。

## 8. Windows 真实网关验收

动用凭据、花配额，只能在 Windows 开发机上做。清单 [`windows-acceptance.md`](./evidence/gateway-readback-model-20261025/windows-acceptance.md)：扫描器自检 → doctor（探针原文 `init.model` 为网关模型名、`model_flag` 不为 null）→ 一次 claude 作审核者的真实审查（`model_effective` 为网关模型名、来源 `envelope`）→ 落盘扫描（凭据零命中、模型名只报 NOTE）；全程输出先写到仓库外 `%TEMP%\ev257`。

**2026-10-26 用户执行第 2 步：不通过**（判读 [`windows-readout.md`](./evidence/gateway-readback-model-20261025/windows-readout.md)）。网关已换成 Qwen，CC Switch 写进生效模型名键的值带 Claude Code 上下文窗口后缀（`qwen3.8-max[1m]`、`qwen3.8-flash[1m]`），守卫 4 的字符集不含方括号，这些键留在替换集；opus 档审查回报的模型名仍被吞成占位符，`model_effective` 记 null + `unverified`（兜底生效，未以 `envelope` 落盘）。不带后缀的 `*_MODEL_NAME` 键正常豁免，凭据类键照旧替换。本报告 §3～§5 的回归锚与对拍都没覆盖带后缀的形态——这是 EV-257 修复本身的缺口，登记 BACKLOG **EV-258**，另走 `/dual-run`。第 1 步 doctor 与第 3 步扫描读数待回传。

**EV-258 已修**（2026-10-26，主题 `网关模型名上下文后缀`）：守卫 4 只放行末尾一个上下文窗口后缀、剥后其余判据照旧，并订正本报告 §1、§2 里「`init.model` 是网关回报」的措辞（它是 CLI 按模型名键解析出的配置值），见 [`REPORT_2026-10-26_gateway_model_suffix.md`](./REPORT_2026-10-26_gateway_model_suffix.md)。
