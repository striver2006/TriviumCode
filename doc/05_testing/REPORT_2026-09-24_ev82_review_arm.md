# EV-82 小主题第一段 · 审查臂形态实验报告（两臂对比）

> **性质**：M10b 计划 r5 §3.3.3 T1 ② 的具名证据；EV-82 小主题第一段计划 r2 §4 的实验与判读。
> **结论先行**：两臂在**配置读取层**都成立，落判读表 **(config_copy, config_copy)** 格——**副本形态差异（H2）排除**，
> 问题在**配置读取层之后**。按 r5 §2.2 / R-s 与本段计划 r2 §4，**停下向用户报告**，「形态换源」是否纳入由用户定。

- **日期**：2026-09-24
- **主题**：`EV-82-同形第二臂与构建标识`（第一段，代码提交 `7212255`）
- **上位**：M10b r5 §1.4 ④⑤、§3.3.1～§3.3.3；本段计划 r2 §4、§4.1、§4.2；诊断主题 `EV-82-审查臂诊断` r3

## 1. 实验条件

| 项 | 值 |
| :--- | :--- |
| 代码 | `7212255`（本段两轮代码双审收口后的提交），工作树干净 |
| 构建与安装 | `npm run build`、`npm run install:local` 各单独一条；构建标识 `7212255`、不带未提交改动，inputs `83724e9b4139`；构建产物与安装副本 sha256 前 16 位均为 `e8045ff0881eba78` |
| 构建标识自检 | doctor：「本仓模式（按根提交判定）：安装副本与当前工作树一致」 |
| ZCode | CLI 版本串 0.16.9；入口 `zcode.cjs` sha256 前 16 位 `b1df2ef3e5bd76c4`（与诊断时相同；2026-09-22 被替换过，环境漂移相对 09-21 那次不可排除） |
| 宿主凭据 env | 无任何 `ZCODE_` 前缀环境变量（同形臂未报宿主预置） |
| 命令 | `.trivium/bin/trivium doctor --only zcode --no-model-calls`（两臂零配额，凭据换哨兵后拉起） |

## 2. 两臂读数

| 臂 | 副本形态 | 请求 | CLI 写出的 `defaultModelSelection` | 结论 | 本轮产出 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 白名单臂（`model_override`） | 白名单重建（provider 只留 name / kind / source / enabled / models，options 只留 baseURL / apiKeyRequired / 哨兵 apiKey） | `bigmodel-coding-plan/GLM-5.3-Flash` | `bigmodel-coding-plan/GLM-5.3-Flash` | `config_copy` | 是 |
| 同形臂（`model_override_full_copy`） | 审查臂同一构造函数 `prepareZcodeHome` 整份拷贝；凭据写盘前换哨兵：替换凭据键 1 处，另对每个 provider 的 apiKey 无条件写哨兵；拉起前残余扫描未拦截 | `bigmodel-coding-plan/GLM-5.3-Flash` | `bigmodel-coding-plan/GLM-5.3-Flash` | `config_copy` | 是 |

两臂一致，doctor 未出 EV-94 ② 的不一致告警。

## 3. 判读前提

| 前提 | 读数 | 成立 |
| :--- | :--- | :--- |
| 1 请求值一致（计划 r2 §4 判读前提 1） | 白名单臂、同形臂、诊断实跑三者请求都是 `GLM-5.3-Flash`（同 provider `bigmodel-coding-plan`、同 modelId） | 是 |
| 2 (D) 隔离腿（§4.2，诊断 r3 §6 第 2 条） | 用仓库只读函数 `listPersonalProviderIds` 读个人 `~/.zcode/v2/provider_config.json` 的 provider **键名**（不读值）：个人配置在场，provider 键 1 个，UUID 形态（`84044858…`），**不含** `bigmodel-coding-plan` | 是。诊断运行生效模型的 provider 段 `bigmodel-coding-plan` 只可能来自副本源的 legacy 导入，个人配置确被隔离 |
| 3 环境 | 同一 CLI 版本串与入口摘要下，两轮诊断与本实验先后进行 | 本实验与诊断同环境；相对 09-21 那次的环境漂移不可排除（不影响本结论） |

## 4. 判读

按本段计划 r2 §4 判读表（先判 null，再查两臂三态组合）：两臂都非 null，组合为 **(config_copy, config_copy)**。

- **副本形态差异（H2）排除**：整份拷贝与白名单重建两种副本，在配置读取层都把请求值写成了默认选择。
- **结合诊断两轮**：真实审查运行里，隔离成立、legacy 导入发生（provider 段为副本源 legacy 键），而生效模型是 provider 首位 `GLM-5.3`，rollout 10 条请求全为 `GLM-5.3`。
- **所以问题在配置读取层之后**。候选（计划 r2 §4 与代码双审 r1 GLM-06）：
  1. 运行期注册表精确匹配（`isSelectable` 一类，H3）配不上 `bigmodel-coding-plan/GLM-5.3-Flash`，静默回落首位；
  2. 可选性或套餐过滤：套餐层面只开放首位模型；
  3. 服务端映射回落：请求发出的是 Flash，服务端按套餐映射回 GLM-5.3，回读记的是回落后的值。

**层级边界**：本实验看得见配置读取层与两臂副本形态差异，**看不见运行期注册表层**；上面是排除法结论，不是直接观测。三种候选本实验区分不了。

**关于 (A) 行 reason 的载体**（诊断 r3 §6 第 3 条）：`model_route` 的 reason 实际载体是运行目录 `trace.json` 的 `modelSelection.reason`，不是 stderr。本实验两臂都判 `config_copy`，未用到这一格。

## 5. 对上位计划的影响

| 上位 | 影响 |
| :--- | :--- |
| M10b r5 §3.3.1 分支表 | 诊断落 (D)，本实验落 (cc, cc)：H3 或其它「配置层之后」的候选成立，按 r5 §2.2 与 R-s **停下向用户报告** |
| M10b r5 §3.2 P-c（T1 ∧ T2） | T2 要求真实运行 `model_override_applied: true`；在「配置层之后」的回落消除之前，T2 不可能成立 ⇒ P-c 不成立 ⇒ 第 4 步不开工 ⇒ C-P2 不成立。这条链 r5 已预先写明 |
| M10b r5 §2.2「形态换源」不在本里程碑 | 需要用户在「纳入形态换源（另估量级、依赖桌面端 OAuth 账号态等外部条件）」与「本里程碑卡在 P-c，先做第 1～3 步与第 5 步里不依赖第 4 步的部分」之间拍板 |
| T1 ②（r5 §3.3.3） | 本报告是 ②(a) 的具名证据：同形臂在配置读取层成立。它证明「审查臂的副本形态没问题」，**不证明**审查臂的模型限定在运行期生效 |
| BACKLOG | EV-82：追加「第一段实验：两臂配置读取层均成立，H2 排除，问题在配置读取层之后（候选三种）」；EV-94 ②：追加「已由 `7212255` 实现第二臂；本轮两臂一致，触发条件未因副本形态成立」。按 r5 §8.4 口径追加、不改原文，排在本段收口 |

### 5.1 用户拍板（2026-09-24）

**选 A：纳入「形态换源」**。按 M10b r5 §14「改动越出本稿范围 ⇒ 用户拍板后另起修订稿」：
- EV-82 另起**第二段**计划（形态换源），走计划双审；
- 第二段计划落笔前先做第 6 节的零配额静态佐证，用来缩小三种候选；
- M10b 的范围变更（r5 §2.2「形态换源不在本里程碑」一句失效）与量级重估，另起 M10b 修订稿登记，不回改 r5。

## 6. 静态佐证（2026-09-24，用户拍板 A 之后做）

对 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`（sha256 前 16 位 `b1df2ef3e5bd76c4`）做只读检索，零配额。
打包后的混淆名随版本变（09-21 记的导入器 `Mqa` 在本版已是别的函数），下文一律引**登记名**（包内 `r(<混淆名>, "<登记名>")` 的第二参数），混淆名只作定位。

| # | 读到什么 | 登记名 |
| :-- | :--- | :--- |
| 1 | legacy 导入把 `model.main` 转成默认选择时只取 `{ providerId, modelId }`，**不带 `options.reasoningLevel`** | `importLegacyCliConfiguredDefault` |
| 2 | 初始选择：配置的默认选择先过 `isSelectable`，通过才记 `configured-default`；否则遍历可见 provider 的模型，取**第一个**补得出思考档位的，记 `registry-fallback` | `resolveInitialModelSelection`、`completeNewModelSelection` |
| 3 | `isSelectable` 的最后一关要求 `options.reasoningLevel` 存在且在该模型可选值内；缺失即 `reasoning-level-missing`，判不可选 | `isSelectable`（内调的校验函数，返回码 `reasoning-level-missing` / `reasoning-level-not-supported`） |
| 4 | 另一条解析路径只对 `reasoning-level-not-supported` 走旧档位兜底（`resolveLegacyReasoningLevel`），对 `reasoning-level-missing` **不兜底** | `resolveEffectiveModelSelection` |
| 5 | CLI 启动日志有一条 `bootstrap.app.startup.runtime_config.completed`，`context.model` 是运行期选定的模型；诊断运行 `20260924T025839Z` 记的是 `bigmodel-coding-plan/GLM-5.3`，**先于任何网络请求** | 日志事件名 |
| 6 | ZCode CLI 自身**没有**选模型的命令行旗标（包内 `"--model"` 两处都在内置的其它工具补全表里） | — |

**推断链**（静态，**未在 headless 调用路径上验过**）：导入得到的默认选择缺思考档位 ⇒ 不可选 ⇒ 回落到第一个可见 provider 的第一个模型 `GLM-5.3`。这与全部读数一致：
- 两臂只读 v2 文件，文件里确实写着 Flash，所以判 `config_copy`；
- 真实运行走到选择器，Flash 被判不可选，回落首位。

**对第 4 节三种候选的收窄**：落在候选 1（运行期注册表层），但成因**不是 ID 形态配不上，而是缺思考档位**；候选 2、3 没有证据支持。
所以「形态换源」这个说法不准确，修法可能小得多，不涉及 providerId / modelId 换源，也不依赖桌面端 OAuth 账号态。
**用户 2026-09-24 同意按此改写第二段范围**：先做零配额的运行期观测（第 5 行的日志事件），再定修法。

按设计 §3.3 纪律，本节只作佐证、不作改动依据；第二段计划以运行期实测为准。

## 7. 本段收口前待登记的偏离（代码双审两轮裁决承诺）

1. 缺构建标识或被审项目取不到根提交时，用 `package.json` 的 `name` 兜底判本仓（r2 §2 原文只按根提交判）；
2. 测试构建不注入固定构建标识，以 null 为测试值（r2 §2 原文写注入固定测试值）；
3. 残余扫描不扫副本顶层（已知残余，设计文档探针行已写明）；
4. 「两臂调同一判据函数」以行为对拍加代码评审代替引用断言。

## 8. 第二段实验：运行期选定与置首变体（2026-09-24，计划 `EV-82-运行期选模观测` r2 §5）

### 8.1 条件与环境登记

- 代码：提交 `c673ba3`（第二段代码双审 r1 收口）。工作树干净时 `npm run build`、`npm run install:local` 各跑一条，
  再 `node scripts/build.mjs --tests-only` 重编脚本要导入的模块；
- 脚本：[`evidence/ev82-seg2-20260924/runtime-selection.mjs`](evidence/ev82-seg2-20260924/runtime-selection.mjs)，只读，调仓库函数拉起三次，
  输出写进同目录的 `runtime-selection-output.json`；
- 三次都显式请求 `bigmodel-coding-plan/GLM-5.3-Flash`；只读参数取自探针结论（`--mode plan` + 完整 denylist）；
  副本凭据一律换哨兵，零配额；
- 环境：入口 `zcode.cjs` sha256 前 16 位 `b1df2ef3e5bd76c4`，**与 S5 验证时相同**；版本 0.16.9；
  包内启动事件名字面仍在；宿主**没有**预置 `ZCODE_LOG_DIR` / `ZCODE_API_KEY` / `ZCODE_BASE_URL`；
  目录首位（按导入器规则）是 `bigmodel-coding-plan/GLM-5.3`。

### 8.2 三次读数

| 次 | 臂 / 变体 | 请求 | 配置层结论（CLI 写出） | 运行期选定 | 置首 |
| :-- | :--- | :--- | :--- | :--- | :--- |
| ① | 白名单臂 | `…/GLM-5.3-Flash` | `config_copy`（`…/GLM-5.3-Flash`） | `bigmodel-coding-plan/GLM-5.3` | — |
| ② | 同形臂 · 原样 | `…/GLM-5.3-Flash` | `config_copy`（`…/GLM-5.3-Flash`） | `bigmodel-coding-plan/GLM-5.3` | 不适用 |
| ③ | 同形臂 · 置首 | `…/GLM-5.3-Flash` | `config_copy`（`…/GLM-5.3-Flash`） | `bigmodel-coding-plan/GLM-5.3-Flash` | 生效 |

三次的运行期读数都是 `ok`，没有复跑。同形臂两次各替换了 1 处凭据键（`provider.bigmodel-coding-plan.options.apiKey`），
残余扫描没有拦下。③ 的 `why` 带了「置首后配置层判据按构造失明」标注，这是预期内的：该次的配置层结论不作判据，只看运行期。

### 8.3 判读（r2 §5.3，按次序首命中）

1. (V) 不中：入口摘要与 S5 相同，事件名字面在；
2. (N) 不中：三次读数都是 `ok`；
3. (F4) 不中：白名单臂与同形原样都选了 `GLM-5.3`，两种副本在启动阶段选择相同；
4. **(F1) 命中**：同形原样选首位 `GLM-5.3`，置首已生效且选中请求的 `GLM-5.3-Flash`。

**读出什么**：
- 两臂在配置读取层都写出了请求值，运行期启动阶段却都回落首位。这就是 EV-82 的形态，在零配额的探针上**复现**了；
  与真实运行的既有留痕（C5：审查臂启动事件记的也是 `GLM-5.3`）一致，所以 (F2)「哨兵与真实不同」不成立；
- 回落**对该 provider 的 `models` 键序敏感**：请求挪到首位后，回落正好落在它上面。S2（回落取可见 provider 的第一个模型）在 models 一级成立；
- **没有读出的**：请求值被判不可选的具体成因仍**未定**。§6 的静态推断（缺思考档位 `reasoning-level-missing`）与这组读数相容，
  但本实验只看到结果、没看到返回码；provider 一级的顺序在多 provider 副本源上也未验。

**层级**：本实验看得见哨兵凭据下的启动阶段选定，看不见真实凭据下的启动选定（那一格由 C5 的既有留痕给出），也看不见启动之后。

### 8.4 下一步

按 r2 §5.3 (F1) 一格：进入第三段，**M1「置首」进入修法候选**。守卫口径二选一由第三段计划双审定（r2 §6）。
第三段同时处理 BACKLOG **EV-110**（审查臂继承宿主 `ZCODE_LOG_DIR`，用户 2026-09-24 拍板第三段修）。

### 8.5 补注：历史变异规格的可复跑性（第三段计划 r3 §5）

第三段的代码改动让下列三份规格在当前工作树上**不可再跑**：`scripts/mutation-check.mjs` 的闸 7 要求每条 find 恰好命中一处，
命中 0 次会在写盘之前拒跑。这不是规格写坏了；三份都按历史留痕保留，不改写。

| 规格 | 对应提交 | 失效成因 |
| :--- | :--- | :--- |
| `evidence/ev82-seg1-mutation-20260924/mutation-spec.json` | `7212255` | MF5 的 find 是 `prepareZcodeHome` 里 `transformCopy` 那一行，第三段加置首后改写 |
| `evidence/ev82-seg2-mutation-20260924/mutation-spec.json` | `c673ba3` | RV1～RV4 的 find 在 `reorderRequestedFirst` 函数体内，函数搬到 `adapters/zcode.ts` 后在原文件命中 0 次；RS7 引用的 `ZCODE_PROBE_EXTRA_CLEARED_ENV` 已删除（EV-110 并入 `ZCODE_DIR_ENV_KEYS`） |
| `evidence/ev82-seg2-mutation-20260924/mutation-spec-r1.json` | `c673ba3` | 同上，另有 RV5、RV6（函数体内）与 RN3（引用该常量） |

这些形态在第三段规格 `evidence/ev82-seg3-mutation-20260924/` 里重新表述（置首函数的四类落在 `adapters/zcode.ts`）。

## 9. M3：上游缺陷描述草稿（第三段计划 r3 §6，是否提交由用户定）

> 以第二段实验结论为准：只写观察到的，不写成已证实的「缺思考档位」。

**标题**：headless 模式下 `cli/config.json` 的 `model.main` 被导入为默认选择，但启动时实际选中第一个 provider 的第一个模型

**环境**：ZCode CLI 0.16.9（`zcode.cjs` sha256 前 16 位 `b1df2ef3e5bd76c4`），macOS，headless `--prompt` 调用，独立 `HOME`。

**复现**：
1. 新建空目录作 `HOME`，写 `<HOME>/.zcode/cli/config.json`：一个 `source: "custom"` 的 provider，`models` 里依次两个模型 A、B；`model.main` 与 `model.lite` 都写 `<provider>/B`；
2. 不设 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`（让 CLI 走 legacy 导入），以该 `HOME` 跑一次 headless `--prompt`；
3. 看 `<HOME>/.zcode/v2/provider_config.json` 的 `defaultModelSelection`，以及 `<HOME>/.zcode/cli/log/*.jsonl` 里
   `bootstrap.app.startup.runtime_config.completed` 事件的 `context.model`。

**期望**：启动选定为 `<provider>/B`。

**实际**：`defaultModelSelection` 是 `<provider>/B`（导入成功），但启动事件的 `context.model` 是 `<provider>/A`；
之后的模型请求也都发给 A。

**附证**：只把 `models` 里 B 挪到 A 前面、其余不变，启动选定随之变成 B。可见默认选择在运行期被判不可选，回落到第一个可见 provider 的第一个模型。

**线索（未证实）**：静态阅读推断，legacy 导入写出的默认选择只有 `{ providerId, modelId }`、不带思考档位，
可选性检查因此判它不可选（成因码疑似 `reasoning-level-missing`）。这一条只作线索，没有在调用路径上验过。
