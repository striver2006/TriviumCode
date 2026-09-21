# 计划：ZCode 0.16.9 模型覆盖落点迁移（EV-82）

- **主题**：`zcode-模型覆盖落点`
- **起点**：`98b2fd3`（主题 `zcode-provider配置注入` 收口，EV-81 结案），`main` 干净，无未关闭闸门
- **触发**：BACKLOG **EV-82**（来源：上一主题 r2 代码双审 CODEX-05 的实测，应答件 §三 E0/E1）
- **审查形态**：本主题走**计划双审**，且只能 `--critics codex,gemini`。**两条独立理由**：
  ① EV-82 未结案，glm 会静默跑在个人配置的默认模型上，不构成独立一侧；
  ② glm 适配层正是本轮被审对象，不以待审代码审自己。
- **产出**：本文件（计划原稿）→ 用户发起 `/dual-review-plan` → 裁决件 → 审批 → 实施
- **本轮不改任何业务代码**

---

## 一、目标与范围

### 目标

让 `--model-glm` / 档位配置指定的模型在 ZCode 0.16.9 下**真正生效**：审查运行回读到的
`model_effective` 等于本次请求的模型，FR-06（按任务指定模型）与 NFR-06（异构默认）在 glm 侧恢复；
并让「覆盖没生效」这件事在下一次 ZCode 挪读取点时**响亮**，而不是像这次一样靠三轮双审偶然逮到。

结案后 glm 方可重新作为审核者启用（RUNBOOK §五、BACKLOG EV-81/EV-82、设计 §3.3 达成边界四处同步解除）。

### 做（纪律 1：外部产品行为变化只改适配层；纪律 5：不改用户全局配置，独立配置走每运行临时副本）

1. **`adapters/zcode.ts`**：新增个人 provider 配置的**每运行副本**，把请求模型写进
   `config.defaultModelSelection`，并把 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 指向副本而非真实文件。
2. **`adapters/zcode.ts`**：`scrubZcodeHome` 的载体清单增加这份副本（整删），与 `cli/config.json` 同档。
3. **`adapters/zcode.ts`**：新增请求模型 ↔ 回读生效模型的**比对**，结果落成 `CriticResult` 的必填三态字段。
4. **`guard.ts`**：`renderGuardWarnings` 在比对为 `false` 时播报一条运行时告警（不判失守、不阻断）。
5. **`types.ts` / 其余适配器 / `runner.ts` / 夹具**：新字段必填带来的逐处作答（`tsc` 点名，不手工枚举）。
6. **用例**：零配额的单元与契约用例（详见 §六）。
7. **文档回填**：设计 §3.3 事实表与结论段、§11.3、§21（v1.3.32）、§24 台账；M0 报告 §7 P-31 改结论；
   BACKLOG EV-82 结案 + 新登记；RUNBOOK §五解除 glm 禁用；`.env.example` 与 QUICKSTART 的相关句。

### 不做（逐条附理由）

| 不做 | 理由 |
| :--- | :--- |
| 停止写 `<副本HOME>/.zcode/cli/config.json` 的 `model.main` | 0.16.9 下它已无读取点（P-31），但**那份副本本身不能删**——它是 provider 定义与内联凭据的来源（E1 的旁证：只给内置变量、副本 HOME 下 `bigmodel-coding-plan/GLM-5.3` 能跑通，凭据只可能来自它）。写入本身无害且方向一致（万一有残余读取点，写的是请求模型）。一次只改一件事：本轮加新落点，不动旧落点。登记为新条目 |
| 合成一份最小 provider 配置副本（不拷真实文件） | 包内 schema 是 `.strict()` 且 `providerConfigRules.providerRules` / `modelConfigRules.{providerModelRules,manualProviderModelRules}` 都是必填结构：合成等于丢掉用户手工添加的 provider 与模型规则，`<providerUUID>/…` 那一族会整体消失。省下的是「副本里多一份凭据」，代价是「副本与真实环境不等价」——而副本已经在清扫论域内，省的那点收益不值 |
| 把 `defaultModelSelection` 写进用户真实的 `~/.zcode/v2/provider_config.json` | 直接违反纪律 5。本计划的整个形状就是为了避免这件事 |
| 接线 `agents.glm.unsupported_override` | 它是 EV-30 已登记的死配置（`test/unit/config-consumers.test.ts` 的豁免清单里写着「用户设 reject 不会让它报错」）。接线要先定「探针说不支持时 auto 意味着什么」，属 EV-30 族，不是本轮的修复 |
| 把「请求模型 ≠ 生效模型」升格为阻断（该侧判 failed） | 用户已拍板取「响亮但不阻断」。一次误判会让整轮双审作废，而模型档位差异本身不影响审查有效性；先让它可见，阻断与否等有了真实误判/漏判样本再谈 |
| 判定层做跨族的模型字符串比较 | 各族模型 id 形态不同（zcode `<providerId>/<name>`、codex profile+model 两维、claude slug），统一比较必然误报。比对只能在**各自适配器内**做，判定层只播报结论 |
| 修 `probeZcodeModels` 的目录来源（仍读 `cli/config.json`） | 它只喂 preflight 的 slug 存在性校验，与本轮的生效落点是两件事；两者同时改会让「覆盖没生效」与「slug 判错」在验证时混在一起。单独登记 |
| `os.homedir()` 口径（EV-83）、布局版本门控（EV-85）、旗标冻结（EV-86） | 各自有独立触发条件，不在本轮 |

---

## 二、事实基线

### 2.1 已有实测（**不重测**，原始记录见留痕）

| # | 事实 | 来源 |
| :--- | :--- | :--- |
| F-1 | 0.16.9 把模型选择迁到 `~/.zcode/v2/provider_config.json` 的 `defaultModelSelection`；`cli/config.json` 的 `model.main` **已无配置读取点** | M0 报告 P-31 |
| F-2 | E0（副本 HOME + 两个变量 + 副本 `model.main` 写 `bigmodel-coding-plan/GLM-5.3-Flash`）→ 回读生效模型 `<providerUUID>/qwen3.8-max`（个人配置默认模型） | 上一主题 r2 应答件 §三 |
| F-3 | E1（副本 HOME + 只给内置变量）→ 回读 `bigmodel-coding-plan/GLM-5.3`，退 0、响应 OK | 同上 |
| F-4 | 两种形态**都不是**请求的模型；AC-13 的回读会如实记差异，但 FR-06 / NFR-06 在 glm 侧失效 | 同上 |
| F-5 | 2026-09-21 起 codex 侧配成 `qwen3.8-flash`，与 glm 静默跑的 `qwen3.8-max` **同家族**——两侧只差一个档位 | BACKLOG EV-82 |

### 2.2 本轮新核的 CLI 包内字面（只读 `zcode.cjs`，零配额，构成方案前提）

| # | 字面 | 含义 |
| :--- | :--- | :--- |
| B-1 | 版本化文件 schema：`{ schemaVersion: literal(1), config: { providerOrder?: string[], providerConfigRules, modelConfigRules, defaultModelSelection? } }`，**内外两层都 `.strict()`** | 副本必须保留原有全部键，多一个键会被拒 |
| B-2 | `defaultModelSelection` 的 schema：`{ providerId: string(min 1), modelId: string(min 1), options?: { reasoningLevel?: string } }`，`.strict()` | 写入形态确定：两个必填字符串。**不是**一个 `<providerId>/<modelId>` 合串 |
| B-3 | `resolveNodeProviderRuntimePaths`：两个变量**全不给**→ 回落自推算；**只给一个**→ 抛「ZCode Built-in 与 Personal Provider Config 路径必须同时提供」 | 现有 `zcodeProviderEnv` 的「各自存在性门控」在**只有一份存在**时会踩到这条。本轮顺带核准（见 §三 D-3） |
| B-4 | 全局 argv 解析器是 `parseArgs({ strict: true })`，选项表里**没有任何 model 相关项**（`--disallowed-tools` 在 parseArgs 之前被单独抠走） | 无 CLI 旗标可走 |
| B-5 | 包内 `ZCODE_*` 变量全集里与模型有关的只有 `ZCODE_MODEL_RETRY_*` 与 `ZCODE_MODEL_TELEMETRY_ENABLED` | 无环境变量可走。**`defaultModelSelection` 是唯一落点**，这一条是整个方案成立的前提 |
| B-6 | 凭据存储路径 = `<ZCODE_DATA_BASE_DIR ?? homedir()>/.zcode/v2/credentials.json`；个人 provider 配置默认路径 = `dirname(credentialStore.filePath)/provider_config.json`，可被 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 覆盖 | 副本 HOME 下 `credentials.json` **不存在**（ENOENT 按空表处理）——今天如此，改动后不变 |
| B-7 | CLI 侧存在 `saveConfiguredDefault`（把 `defaultModelSelection` 写回个人仓库）与一个版本化迁移器 | **CLI 会写它被指向的那份文件**。今天编排器指的是用户真实文件 |
| B-8 | `~/.zcode/v2/provider_config.json` 0600、3870 B，含 `"apiKey"` 键 2 处（**按键名 grep 核实，未读取任何值**） | 副本是凭据载体，必须进清扫论域 |

> B-7 是本轮的**净收益**而不是代价：今天编排器把 CLI 指向用户真实的个人配置，CLI 的迁移/回写路径
> 作用在真实文件上；改指副本后，编排器不再有任何路径能写到用户的个人配置。

---

## 三、方案：正面回答三个难点

### A. 落点与写法

在 `prepareZcodeHome` 之外新增 `prepareZcodePersonalConfig(runDir, qualifiedModel)`：

1. 真实个人配置不存在 → 返回 `{ path: null, route: 'global', reason }`，不注入覆盖（与现有 `cli/config.json`
   缺失时的处置同构）；请求模型为空同理。
2. 存在 → 整份读入、`JSON.parse`、把 `config.defaultModelSelection` 定点改为
   `{ providerId, modelId }`，写到 `<副本HOME>/.zcode/v2/provider_config.json`，`chmod 0600`。
   **其余键一律原样搬运**（B-1 的 `.strict()` 不容多减）。
3. `providerId` / `modelId` 的切分**复用 `qualifyZcodeModel` 的同一条规则**（`lastIndexOf('/')`），
   抽成导出的 `splitZcodeModel()` 供两处共用——两份切分实现就是 BACKLOG 顶部「重复实现」那一族。
4. `options` 键：真实文件里若原本有 `defaultModelSelection.options`，**不继承**（那是上一个模型的
   `reasoningLevel`，跟到新模型上是张冠李戴）；本轮不产出 `options`。effort/档位是 M11 的事（AC-23）。
5. 解析失败（文件损坏 / 非 JSON）→ **不写副本、不注入、route 记 `global` 并给出原因**，不抛。
   与 `probeZcodeModels` 的 `catch { return [] }` 同一取向：个人配置坏了不该让整次审查崩在准备阶段。

`ZcodeInvokeOptions` 增 `personalProviderConfig?: string | null`；`zcodeProviderEnv` 增同名可选参数，
**给了就用它、没给才按真实用户目录派生**。存在性门控保持不变（副本刚写完，必然存在）。

`model_route` 增加取值 `provider_config_copy`（`types.ts` 两处 union + 探针的
`ZcodeProbe.model_override` 同步）。**不复用 `config_copy`**：那个名字指的是 `cli/config.json` 那一档，
两档同名会让留痕分不出「写了哪份副本」，而这正是 EV-82 被埋了两天的原因。

### B. 副本的写入面

| 面 | 结论 |
| :--- | :--- |
| 写到哪 | `<运行目录>/<侧>/home/.zcode/v2/provider_config.json`——**在副本 HOME 之内**，不在运行目录别处 |
| 为什么在 HOME 之内 | 清扫论域是 `zcodeHomeUnder(sideDir)`（即 `<侧>/home`）。放到 HOME 之外就要同时改清扫入口的论域，那是把一个 fail-closed 的边界改宽；放进去则**天然被现有论域覆盖** |
| 权限 | `0600`，与 `cli/config.json` 副本、`prepareCodexHome` 拷入的 `auth.json` 同档 |
| 凭据面变化 | 副本 HOME 下的凭据载体由 1 份增到 2 份。两份都在同一论域、同一清扫机制、都整删。**用户真实文件的写入面由 1 减到 0**（B-7） |
| 编排器是否读它的内容 | 读——`JSON.parse` 整份以便定点改写。**只在进程内，不打印、不进任何留痕、不进错误消息**。异常消息只取 `(e as Error).message` 且不回显文件内容 |

### C. `scrubZcodeHome` 的清扫论域

现状：`cli/config.json` 一份**按名整删**，其余过 `scanAndRemoveSecrets`（`plugins/`、`db/` 排除，
`rollout/`、`log/` 命中脱敏不删）。

改动**只有一处**：把 `.zcode/v2/provider_config.json` 加进按名整删的载体清单。

- **为什么必须按名整删，而不是靠扫描器命中**：扫描器认的是凭据**形态**（ZCode 凭据是
  `<apiKeyId>.<apiKeySecret>`）。形态一旦变（换 provider、换鉴权方式、值被编码），扫描器就漏，
  而这份文件**已知**含凭据——「已知含凭据的载体按名整删，形态未知的过扫描器」是 codex 侧
  `isCredentialCarrier` 已经定下的口径，本轮照抄，不新立。
- **论域不扩大**：`v2/` 下不加任何排除项。跑后 CLI 可能在副本 HOME 的 `v2/` 里写别的东西
  （B-7 的迁移器、`credentials.json`、sqlite），它们落在扫描器的通用规则里
  （命中即删 / 论域内扫不进去的二进制整删 EV-36），这正是后验扫描要覆盖的面。
- **`exists()` 不当门禁**：沿用现有写法，直接依赖 `fs.rm({force:true})` 的幂等性并只捕真异常
  （r2 AGY-03 的教训：权限异常会让「删不掉」被读成「本来就没有」）。
- **两份载体的删除结果分别落进 `deleted`**，不合并计数——哨兵说什么删了就得真删了什么。

> **本轮不复用、不手搓任何清扫助手**（2026-09-20 事故 R1/R2/R6）。`scrubZcodeHome` 的调用方
> 仍然只有 `zcodeAdapter.scrubRunDir(sideDir)` 一处，其入参仍然只由 `zcodeHomeUnder(sideDir)` 拼出，
> 本计划不新增任何一个能把外部路径喂给它的口子。

### D. 跑后还有没有代码回读它

| 回读方 | 读什么 | 会不会碰这份副本 |
| :--- | :--- | :--- |
| `zcodeAdapter.run()` 的轨迹段 | `<副本HOME>/.zcode/cli/log/*.jsonl`、`rollout/model-io-<sessionId>.jsonl` | **不碰**。这两处在 `cli/` 下，且 `rollout/` 会被拷一份进 `out_dir` |
| `zcodeProviderConfigPaths` / `zcodeProviderEnv` | 每次**拉起前**重算，且默认按真实用户目录 | 不是跑后回读 |
| `authProbe().fingerprint` / `probe()` | `~/.zcode/cli/config.json`（真实）、`homeDir: null` | **不碰副本**——探活不做模型覆盖 |
| `probeZcodeModels` / `probeZcode` | `~/.zcode/cli/config.json`、两条 provider 路径的**存在性** | 不碰副本 |
| `retention` / `scrubRunDir` | 副本本身 | 这是删除方，不是读取方 |

**结论：跑后没有任何代码回读这份副本**，与 `cli/config.json` 副本同结论，故整删安全。

**D-3（顺带核准的一处）**：B-3 说明「只给一个变量」会让 CLI 抛错。现有 `zcodeProviderEnv` 对两条路径
**各自**做存在性门控，于是「内置在、个人不在」或反之时会注入单个变量、撞上这条抛错。
本轮把门控改成**成对成立**：两份都在才注入两个，否则**两个都置 `undefined`**（让 `run()` 删掉宿主环境的同名变量）。
这不是新语义，是把既有门控改准到 CLI 的真实契约上；不改的话，本轮引入的副本会让这个组合更容易出现
（副本必然存在，而内置那份可能不在）。

### E. 守卫：覆盖没生效时要响亮

- `CriticResult` 新增**必填三态** `model_override_applied: boolean | null`。
  语义**只有一个**，钉死在类型注释里：
  - `true` —— 本侧比对过，回读生效模型与请求模型一致；
  - `false` —— 本侧比对过，**不一致**；
  - `null` —— **本侧没做这个比对**（不是「没有这个概念」，也不是「没采到」）。
- zcode 适配器作答：`modelEffective === qualified` → `true` / `false`；`modelEffective` 为 null（没回读到）
  → `null`，理由与 `model_effective_source: 'unverified'` 同源。
- 其余四家（agy / codex / claude / stub）本轮一律 `null`，注释写明「本族比对未实现，落点在此」。
  必填让 `tsc` 逐处点名，不靠人工枚举产出点（这条纪律在 `path_deny.coverage_complete` 上验过一次）。
- `guard.ts` 的 `renderGuardWarnings` 在 `false` 时 push 一条：
  「`<侧>` 侧请求模型 `X` 未生效，实际跑的是 `Y`——模型路由（FR-06）与异构默认（NFR-06）在该侧失效，
  本轮结论仍然有效但不构成独立一侧」。**不判失守、不改 `evidence_ok`、不阻断**。
- `run.v2.json` 逐侧段**恒写**该字段（含 `null`），不走条件展开——与 `profile_requested` /
  `model_provider` 同一条口径。
- **双审最可能挑的一处，先说在前面**：把一个只有 zcode 答得出的事实做成跨族必填字段，
  是否属于「断言范围悄悄扩大」。我的理由是：该语义（本侧验证过请求模型是否生效）对四家都成立且都
  答得出，只是本轮只实现一家；`null` 的含义单一、可枚举、可翻转。**退路**（若双审认为过宽）：
  收窄成 zcode 适配器内的本地判定 + `trace.json` 增一格 + guard 直读该侧，代价是 `run.v2.json` 里看不见，
  而 guard 自己的注释写过「只落 `trace.json` 等于埋起来」。

---

## 四、改动清单

| 文件 | 改动 |
| :--- | :--- |
| `src/trivium/adapters/zcode.ts` | `splitZcodeModel()`；`prepareZcodePersonalConfig()`；`zcodeProviderEnv` 增覆盖参数并改成对门控；`ZcodeInvokeOptions` 增 `personalProviderConfig`；`invokeZcode` 透传；`scrubZcodeHome` 载体清单 +1；`run()` 串起准备、路由取值与比对 |
| `src/trivium/types.ts` | `CriticResult.model_override_applied` 必填三态（+ `run.v2` 逐侧段同名字段）；`model_route` union 增 `provider_config_copy`；`ZcodeProbe.model_override` 同步 |
| `src/trivium/guard.ts` | `renderGuardWarnings` 增一条播报（`judgeSide` 透传该字段到 `SideVerdict`） |
| `src/trivium/review.ts` | `run.v2.json` 逐侧段恒写新字段 |
| `src/trivium/runner.ts`、`adapters/{agy,codex,claude,stub}.ts` | 新字段逐处作答（`tsc` 点名） |
| `src/trivium/probes/zcode.ts` | `probe.model_override` 结论与 note 改准（`config_copy` → `provider_config_copy`），说明词里的「`<home>/.zcode/cli/config.json` 副本」改为新落点 |
| `skills/dual-critic/schema/*.json` | `run.v2` 若声明了逐侧字段集，同步（实施时按实际 schema 核，不预设） |
| `test/unit/zcode-model-selection.test.ts`（新） | 见 §六 |
| `test/unit/zcode-provider-env.test.ts` | 补成对门控的用例 |
| `test/unit/render.test.ts`、`test/unit/credential-scrub.test.ts` | 随新路由值与新载体调整 |

---

## 五、留痕与文档回填

- 设计 §3.3：事实表「模型指定」行改准（0.16.9 起落点是 `defaultModelSelection`）、
  新增一行记 B-1～B-5；结论段的「两档降级」改为记清**两份副本各自的角色**；
  **达成边界（EV-82）整段替换为已结案说明**。
- 设计 §11.3：模型覆盖档位描述同步；§21 新增 v1.3.32 行；§24 台账对应行。
- M0 报告 §7 **P-31**：结论从「未修」改为「已修（本主题）」，并补 B-3 / B-6 / B-7 三条包内字面。
- BACKLOG：**EV-82 关闭**；新登记三条——
  - `cli/config.json` 副本的 `model.main` 写入已无读取点、该副本角色已变为凭据/provider 定义载体；
  - `probeZcodeModels` 的模型目录仍取自 `cli/config.json`，与生效落点不同源；
  - `model_override_applied` 的其余三家落点（跨族通用化）。
- RUNBOOK §五：解除「EV-82 结案前不要把 glm 选为审核者」。
- `.env.example`、QUICKSTART 前置表：两个变量的说明补一句「个人那份在审查运行中指向每运行副本」。
- 实测原始输出进 `doc/05_testing/evidence/zcode-model-selection-20260921/`。

---

## 六、验证

**一律走编排器入口（`doctor` / `preflight` / `review`），不手搓脚本复刻副本准备与清扫逻辑**
（2026-09-20 事故 R6）。

### 6.1 零配额（先跑，全绿才进 6.2）

1. `npm run check`（1517 基线，新增用例计入）。
2. 新用例 `zcode-model-selection.test.ts`，全部用临时目录里的**合成**个人配置（不碰 `~`）：
   - 定点改写后，除 `defaultModelSelection` 外**逐键与源文件一致**（防 `.strict()` 被多减的键打红）；
   - 短名 `GLM-5.3-Flash` + `model_id_form` → `{providerId:'bigmodel-coding-plan', modelId:'GLM-5.3-Flash'}`；
   - 全限定名、含多个 `/` 的名、`model_id_form` 缺失三种输入的切分与 `qualifyZcodeModel` **同结论**；
   - 源文件不存在 / JSON 损坏 → `route: 'global'` 且不产出副本、不抛；
   - 源文件里原有 `options` 不被继承；
   - 副本权限为 `0600`。
3. `scrubZcodeHome` 用例：造一份含凭据形态的副本 → 两份载体都进 `deleted`、副本 HOME 下**零残留**
   （沿用 `credential-scrub.test.ts` 的现有夹具形态）。
4. 比对用例：喂造好的 log/rollout 夹具，请求与回读一致 / 不一致 / 回读不到 → 三态各一；
   `renderGuardWarnings` 在 `false` 时出现那条播报、`true` 与 `null` 时不出现。

### 6.2 真实链路（花配额，按序）

> 每步之前先 `npm run build` 与 `npm run install:local`
> （**这两条与任何提到 `.trivium` 的命令分开跑**——`install` 是裸动词，同一条命令里会撞 Hook 误拦）。

1. `trivium doctor --only zcode` → `provider_config` 两格仍记**真实**路径（副本只在审查运行中出现），
   `model_override` 记 `provider_config_copy`。
2. `trivium preflight --stage plan` → 「ZCode 已认证」退 0（探活走真实 HOME，不受本轮改动影响）。
3. **判据实跑**：一次真实的三侧双审（下一次 `/dual-review-*` 即可，不为验证单开一次运行），
   读 `run.v2.json` 的 glm 段：
   - `model_requested` = `model_effective` = 请求的 GLM 模型，`model_effective_source: 'trace'`；
   - `model_route: 'provider_config_copy'`，`model_override_applied: true`；
   - guard 告警里**没有**那条模型未生效的播报。
4. **清扫实跑**：同一次运行结束后看该侧的清扫哨兵，两份载体都在 `deleted` 里、`ok && complete`。
5. **负对照**：把请求模型临时改成一个存在但不同的 slug 复跑一次，确认回读跟着变
   （只验「覆盖生效」，不验「某个具体模型可用」）。

**达不成时的处置**：如实登记、保持 glm 禁用，**不改判据去迁就结果**。最可能的失败形态与预案见 §七。

---

## 七、风险与预案

| # | 风险 | 预案 |
| :--- | :--- | :--- |
| R-1 | `defaultModelSelection` 指向 **builtin** provider（`bigmodel-coding-plan`）是否被接受，未实测 | F-3 是旁证（该 provider 在副本 HOME 下能跑通）。若被拒：改用探针回读的 `model_id_form` 所属 provider，或登记「glm 的可选模型集受个人配置约束」并把 slug 校验挂到新目录源 |
| R-2 | 副本 HOME 下无 `credentials.json`（B-6），换模型后凭据可能取不到 | 今天的成功形态（F-2/F-3）说明凭据来自副本里的内联 `apiKey`；若新模型走的 provider 凭据在 `credentials.json` 里，会报 provider 鉴权失败——**这是响亮失败**，`failureKind: provider_not_configured` 已有分支。届时登记，不在本轮扩大拷贝面 |
| R-3 | CLI 的迁移器/回写（B-7）改写副本，与我们写入的内容冲突 | 副本用完即删，且跑后无人回读（§D）。回写只可能影响**本次**运行，而生效模型以回读为准（AC-13） |
| R-4 | `.strict()` schema 在未来版本增删键，整份拷贝的方式天然兼容，但 `schemaVersion` 升版后我们的定点改写可能落在错误的层级 | 写入前断言 `schemaVersion === 1` 且 `config` 是对象；不满足 → 不写副本、route 记 `global` 并给出原因（与 §A-5 同一档处置） |
| R-5 | 新必填字段让四家适配器与夹具同时改，diff 变宽 | `tsc` 逐处点名，每处改动都是一行；§E 已备好收窄退路 |

**回退**：本轮改动全在适配层 + 一个新字段。回退 = 还原 `zcode.ts` 与新字段，glm 回到禁用状态，
其余三侧不受影响。

---

## 八、执行顺序

1. `splitZcodeModel` + `prepareZcodePersonalConfig` + 单元用例（零配额）
2. `zcodeProviderEnv` 成对门控 + 用例
3. `scrubZcodeHome` 载体清单 + 清扫用例
4. `run()` 串接 + 新路由值
5. 新字段（`types.ts` → `tsc` 点名逐处作答）+ guard 播报 + 用例
6. `npm run check` 全绿
7. 文档回填与 BACKLOG
8. 真实链路验证（§6.2）
9. `/dual-review-code`（`--critics codex,gemini`——本轮仍不能用 glm 审 glm）

---

## 九、给 `/dual-review-plan` 的审查焦点建议

焦点会**逐字**进命令行（FR-20），而 skill 要求用 `.trivium/bin/trivium` 调用，
所以焦点里**不能出现 Hook 的写动词字面**：`rm` `mv` `cp` `touch` `mkdir` `rmdir` `ln` `install`
`rsync` `patch` `dd` `truncate` `chmod` `chown` `unzip` `tar` `tee`，以及 `=>`、`>`、`git checkout|commit…`。
下面这句已按此措辞：

> 重点看三件事：一是把含凭据的个人 provider 配置做成每运行副本这个方向本身是否成立、
> 有没有比它敏感面更小的做法；二是副本的清扫论域与权限口径有没有缺口，跑后是否真的无人回读；
> 三是新增的三态字段 `model_override_applied` 是否把只有一家答得出的事实做成了跨族必填，
> 以及它的 null 语义是否单一。

（焦点是你的话、FR-20 承诺逐字，所以**由你决定最终措辞**；我不替你改后发出去。）
