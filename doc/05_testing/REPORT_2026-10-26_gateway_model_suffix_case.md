# 网关模型名后缀大小写 · 测试报告（EV-258 第二轮）

- **主题**：`网关模型名后缀大小写`（`/dual-run` 命令 A 全流程，Driver claude，审核者 codex、gemini、glm）
- **日期**：2026-10-26
- **基线**：`1f8e8e87`（`src/` 与第一轮实施提交 `4e21fb76` 逐字相同；下文行号取自源码）
- **留痕**：计划 `.reviews/网关模型名后缀大小写/plan/`（定稿 r2）；代码审 `.reviews/网关模型名后缀大小写/code/`；证据 [`evidence/gateway-model-suffix-case-20261026/`](./evidence/gateway-model-suffix-case-20261026/)
- **第一轮**：[`REPORT_2026-10-26_gateway_model_suffix.md`](./REPORT_2026-10-26_gateway_model_suffix.md)（其 §7「大写单位 `[1M]` 不认」那条已改写并指向本报告）
- **登记**：BACKLOG EV-258（done，记两轮）；主设计 v1.3.181（§12「模型名的上下文窗口后缀与 AC-20 回读口径」末尾）
- **产品版本号**：不动（`package.json` 仍为 1.3.1，随 1.3.2 发版）

## 1. 问题

第一轮在 `src/trivium/adapters/claude-route.ts:76` 定义的上下文窗口后缀片段 `\[[1-9][0-9]{0,3}[km]\]` 只认小写单位。2026-10-26 Windows 验收第 1 步（构建 `4e21fb76`，追加诊断确认 `dist/test` 已是新代码）：CC Switch 写进 5 个生效模型名键（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE}_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`）的后缀，码点逐个为 `U+005B U+0031 U+004D U+005D`——大写 `[1M]`。片段剥不掉 ⇒ 守卫 ④ 判不像模型名 ⇒ 这些键留在逐值替换集 ⇒ `init.model` 照旧被换成 `<redacted-env>`。判读 [`evidence/gateway-model-suffix-20261026/windows-readout.md`](./evidence/gateway-model-suffix-20261026/windows-readout.md)。

### 1.1 第一轮「只认小写」的依据为什么不成立

第一轮计划 r2 §2.1 写「Claude Code 文档与 CC Switch 实测写的都是 `[1m]`」。前半句成立（Claude Code 自己的示例用小写），但说明不了第三方工具写进 settings.json 的是什么；后半句的出处是 EV-257 Windows 判读里的 `qwen3.8-max[1m]`，而那次逐键诊断对未豁免的模型名键只打印「形状」（字母一律换 `a`、数字换 `9`），读数是 `aaaa9.9-aaa[9a]`——形状抹掉了大小写，判读把它还原成了小写的具体值，计划又把还原值当成实测，据此定判据并把 `[1M]` 锁成反例（单测 S11、S14 一行、access-modes 后缀格、变异 M5a）。

### 1.2 验收清单为什么没先逐字核后缀大小写

第一轮 Windows 清单第 1 步沿用 EV-257 的诊断口径（未豁免的值只打印形状，为了不把可能是凭据的值打出来），期望表直接写了「值列为 `qwen3.8-max[1m]`」——期望值本身来自上面那次形状还原，清单里没有任何一步在定判据之前单独核后缀的真实字符。失败时第 1 步也只能读出「守卫 4 `N`」，要追加一段码点诊断才定位到大小写。本轮的对策见 §6：诊断直接打印后缀码点，期望值一律以第 1 步逐字读数为准。

## 2. 修法（计划三审 r2 定）

- **片段单位改为显式字符类 `[kKmM]`**（`claude-route.ts:76`）：`\[[1-9][0-9]{0,3}[kKmM]\]`。只放宽单位字母的大小写；数字 1～4 位不以 0 开头、末尾恰好一个、剥后其余判据（字符集、长度、UUID、最长段）、守卫 ②③ 看完整值、`gatewayScrubPlan`、≥ 8 字符阈值、`isModelNameKey` 与凭据键词表全部不变。
- **不用 `i` 旗标**：片段嵌进 `claudeProfileMetadata` 的整行正则，整行加 `i` 会让键名 `ANTHROPIC_(?:MODEL|DEFAULT_[A-Z_]+_MODEL|SMALL_FAST_MODEL)` 一起大小写不敏感；`iu` 还会把开尔文符号 `K`（U+212A）折成 `k`（本机实测：`/…[km]…$/iu` 对 `x[1K]` 为 true，无 `u` 为 false，显式 `[kKmM]` 为 false）。
- **三个使用点同批生效**：守卫 ④（`stripContextWindowSuffix` / `looksLikeModelName`）、`PROFILE_MODEL_VALUE`、`claudeModelConsistency` 都由同一片段派生，代码一行不改。`claude-trace.ts` 只改注释。

## 3. 回归锚

### 3.1 第一轮锁成反例的大写后缀，逐处改为正例

| 位置 | 第一轮 | 本轮 | 依据 |
| :--- | :--- | :--- | :--- |
| S11 反例表 | 含 `${B}[1M]` | 移出；由 S15 当正例 | Windows 码点实测（§1） |
| S14 真值表 | `qwen[1M]` 对 `qwen` ⇒ false | 改断言 true；「后缀不合法 ⇒ false」换用 `qwen[1G]` | 同上；这一处不在任务目标点名之列，读 S14 时核出 |
| access-modes 后缀格 | `qwen3.8-max[1M]` 三形态不收 | 换成 `[1G]`；大写由新格当正例 | 同上 |
| 变异 M5a | 加 `i` 旗标当过宽、须咬住 | 删除（放宽后是等价变异） | 同上 |

S1～S10、S12、S13 与 E1～E11 的断言一字未动。`REAL_MODELS` 追加 `qwen3.8-max[1M]`，S4（豁免）与 S7（不算脱敏痕迹）随之覆盖大写；第一轮那条 `[1m]` 的注释由「Windows 实测」订正为「实为从形状推出」。

### 3.2 单测 `test/unit/claude-gateway-scrub.test.ts`

| 格 | 钉住的事 |
| :--- | :--- |
| S11（改） | 反例表补 `[1G]`、`[1MB]`、`[1mM]`、`[M1]`、`[0M]`、`[12345M]`、`[1M][1M]`、`qwen[1M]-max`、开尔文符号 `[1K]`、全角 `[1Ｍ]`——过宽方向，沿用三层断言 |
| S15（新） | 5 个大写后缀形态（`[1M]`、`[200K]`、`[1000K]`、`[9999M]`）守卫 4 为真、豁免、替换集只剩凭据、原样保留；按 Windows 码点实测形态（`[1M]`）重做 S13 的 12 键整表：10 个模型名键全部豁免、替换集恰为两个凭据值；加挂同值的非模型名键 ⇒ 三键不豁免、该值被替换、其余 7 键照旧 |
| S16（新） | 随机令牌 / UUID / OpenAI 形态各加 `[1M]`、`[1K]`：先断言剥得掉，仍不豁免、被替换；大写后缀也只剥一个；一致性 `gw-a[1M]` 对 `gw-a` ⇒ true，真前缀、两个大写后缀、`[1G]` ⇒ false；`modelFamily` 照旧 |

### 3.3 `test/unit/access-modes.test.ts`

新格：三种引号形态都收 `[1M]` / `[200K]`；`[1G]`、`[1MB]`、`[1mM]`、`[1M][1M]`、开尔文符号三形态一律不收；小写或混写键名（`export anthropic_model=…`、`export Anthropic_Model=…`）不收——钉住「没给整行正则加 `i`」。

### 3.4 集成 `test/integration/claude-gateway-env.test.ts`（新增 E12）

照 E11 的装置，模型名键值为 `gw-ev258-model-02[1M]`（两键同值）、`*_OPUS_MODEL_NAME` 不带后缀：`model_effective` 为带 `[1M]` 的名、来源 `envelope`；审查调用三路凭据零命中、占位符出现；`reportedModels` 为不带后缀的名、一致性 true；探针臂 `init.model` 为带 `[1M]` 的名；`probeClaude` 的 `model_flag === true`。文件头注释补 E12，`FAKE_CLAUDE_MESSAGE_MODEL_KEY` 那句改为「只给 E11 / E12 用」（计划三审 GLM-03）。

## 4. 变异

规格由 [`gen-mutation-spec.mjs`](./evidence/gateway-model-suffix-case-20261026/gen-mutation-spec.mjs) 生成：第一轮 21 条按新源码重生成（find 与 M4、M5b 替换串里的单位类同步为 `[kKmM]`，计划三审 GLM-01），M5a 删除，余 20 条；本轮新增 9 条。先用重打 bundle 的带超时逐条预跑（[`mutation-names-output.json`](./evidence/gateway-model-suffix-case-20261026/mutation-names-output.json)），再跑正式装置（[`mutation-output.txt`](./evidence/gateway-model-suffix-case-20261026/mutation-output.txt)）：**29 条全部咬住**，两次各条 fail 数逐条一致。

| 方向 | 条目 | 咬住的格 |
| :--- | :--- | :--- |
| 去掉大写放行（过窄） | C1 单位回到 `[km]`；C1b 同，对集成；C1c 同，对 profile | S4、S14、S15、S16；E12；profile 大写格 |
| 丢了小写（过窄） | C6 单位改 `[KM]` | S4、S10、S12～S14、S16 |
| 单位任意字母（过宽） | C2 `[A-Za-z]`；C2b 同，对 profile | S11、S14、S16；profile 两格 |
| 多个字母（过宽） | C3 `[kKmM]+` | S11（`[1mM]`） |
| Unicode 折叠（过宽） | C4 `exec` 前加 `iu`（单点替换，计划三审 GLM-02） | S11（开尔文符号） |
| 键名随之放宽（过宽） | C5 profile 整行正则 `exec` 前加 `i` | profile 大写格（小写键名） |
| 第一轮 20 条 | M1～M16（不含 M5a） | 同第一轮，另多红 S15 / S16 / E12 若干格 |

C4、C5 都改 `exec` 那一行而不碰正则构造：构造是以 `$` 加反引号收尾的模板串，改写它的替换串会撞 `String.replace` 的 `$` 特殊替换模式。

## 5. 本机零配额验收（macOS，假 CLI）

`git archive 1f8e8e87` 导出基线树（`node_modules` 软链、`--with-tests` 构建），与当前工作树各跑 [`accept-run.mjs`](./evidence/gateway-model-suffix-case-20261026/accept-run.mjs)（照第一轮那份改：网关 env 再加两个同值的大写后缀模型名键 `ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL` 与不带后缀的 `*_SONNET_MODEL_NAME`——计划写的是 SONNET 与 SUBAGENT，SUBAGENT 已被第一轮占作不带后缀的键，换成 SMALL_FAST；加情形 `suffixU`；被测产物指纹改记 `claude-route.js`），[`accept-readout.mjs`](./evidence/gateway-model-suffix-case-20261026/accept-readout.mjs) 判读：**47 项全部通过**（[`accept-readout.txt`](./evidence/gateway-model-suffix-case-20261026/accept-readout.txt)）。

| 情形 | 基线 `1f8e8e87` | 当前构建 |
| :--- | :--- | :--- |
| 未开启 × 五情形 | 缺省名、`envelope`、`model_flag` true | 归一化后全部输出、组装结果、探针结论、目录臂结论**逐项相同**（未开 `settings_env_source` 的机器 scrub 输出逐字不变） |
| 开启 × default / model / cred / suffix（小写） | 第一轮的行为 | 逐项相同，回读、`model_flag`、回报与一致性相同 |
| 开启 · `init.model` 取大写后缀键（suffixU） | 回读被吞：null + `unverified`，探针臂 `init.model` 为占位符，一致性 null，`model_flag` null | `gw-ev258-flash-02[1M]` + `envelope`；探针臂同名；`reported_models` 为不带后缀的名、一致性 **true**；`model_flag` false（所选 haiku ≠ 回读名） |
| 凭据值（两侧全部 20 份输出） | 零命中 | 零命中 |

## 6. Windows 验收清单与码点诊断

新清单 [`windows-acceptance.md`](./evidence/gateway-model-suffix-case-20261026/windows-acceptance.md)，第 1 步换成 [`diag-suffix-codepoints.mjs`](./evidence/gateway-model-suffix-case-20261026/diag-suffix-codepoints.mjs)：首行自证构建（`stripContextWindowSuffix('x[1M]') === 'x'`）；凭据类键只打印长度；已豁免的模型名键打印原值与末尾方括号段码点；未豁免的模型名键前段只打印形状，末尾方括号段只有恰为「1～4 位 ASCII 数字 + 恰好一个 ASCII 字母」、整值无模式脱敏命中、不与任何非模型名键同值时才打印码点，否则只报长度与类别（计划三审 CODEX-01：长度上限挡不住可逆编码）。另外每一行出屏前再过产品的 `scrubGatewayEnv`（代码三审 CODEX-01：豁免只说明整值不是凭据、不与凭据同值，凭据仍可能以子串混在模型名值里，如 `〈凭据〉/qwen[1M]`），被改写的行带「此值不作逐字期望」标注。`--self-test` 用合成 env 核四类反例（误填进模型名键的短凭据、与凭据键同值的值、方括号里的长随机串、以子串混进豁免值的凭据）既不以原文也不以码点出现：本机 17 项全过（[`diag-self-test-macos.txt`](./evidence/gateway-model-suffix-case-20261026/diag-self-test-macos.txt)）。期望表不再写死具体串，第 2、3 步的模型名一律「逐字等于第 1 步打印值」，第 3 步再打印一次 `model_effective` 后缀码点对照。全程输出写到 `%TEMP%\ev258b`，落文件 `Out-File -Encoding utf8`、读文件 `-Encoding UTF8`。动用凭据、花配额，由用户在 Windows 上执行，结果回填 §8。

## 7. 全量与双审读数

代码审之前，`npm run check` 前台串行两次（开跑前确认无残留 `node --test`）：

| 次 | 用例 | 过 | 红 | 跳过 | 退出码 | 耗时 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 4013 | 4003 | 0 | 10 | 0 | 351 s |
| 2 | 4013 | 4003 | 0 | 10 | 0 | 340 s |

用例数对第一轮收口读数 4009 净增 4：单测 S15、S16，profile 大写格，集成 E12（S11、S14 与第一轮 profile 后缀格在原用例里改）。

- 计划三审 1 轮（run `20261026T145019Z`）：codex、glm 修改后通过，gemini 通过零意见；4 条全接受（CODEX-01 码点诊断只对白名单形态打印、GLM-01 M5b 替换串同步、GLM-02 C4 改单点替换、GLM-03 集成头注），合入 r2。
- 代码三审 1 轮（run `20261026T153202Z`，42 个文件、209.8 KB）：gemini、glm 通过零意见，codex 修改后通过 1 条（CODEX-01 major：诊断脚本对已豁免值直接打印原值，凭据以子串混在模型名值里时会出屏），计票 2 / 1 / 0 → 通过；接受，只改证据目录里的诊断脚本、自检读数、验收清单与本报告 §6，产品代码与测试不改。
- S10 `trivium verify`（`.reviews/网关模型名后缀大小写/verify/`，代码审应答改完之后、先 `npm run install:local`，安装副本与仓库构建 sha256 前缀 `74c96317` 一致）：`npm run typecheck`、`npm run build`、`npm test` 三条命令均退 0，测试 4013 / 4003 / 0 / 10，347 秒。之后只回填了本报告这一行读数。

## 8. 已知边界

- **形似模型名的短段凭据加一个合法后缀**（现在含大写单位）与不加后缀时同样放行——EV-257 剩余边界的延伸，本轮只多了单位大小写这一位，不新开口子。
- **只认 ASCII 的 k / K / m / M**：开尔文符号、全角字母等不认，fail-closed。
- **第一轮报告里其余小写措辞**（§2、§3 举例用 `[1m]`）是当时的事实陈述，不改原文；§2 那句「大写或其它单位」加了指向本报告的注。

## 9. Windows 真实网关验收

待用户执行（见 §6）。
