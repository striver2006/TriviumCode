# 计划（r2）：ZCode 0.16.9 模型覆盖落点——根因改判，路线改走 legacy 导入（EV-82）

- **主题**：`zcode-模型覆盖落点`（第 2 轮计划稿）
- **起点**：r1 计划审已批（13 条全接受）并已实施，**未提交**；实施后在真实链路上发现 r1 的修法对 GLM 不成立，
  且查出了一条更深的根因。本稿**替换** r1 的方案部分，r1 里与本稿不冲突的内容（守卫、清扫载体清单、
  B-1～B-8 包内字面、D-3 撤回）仍然有效。
- **触发**：2026-09-21 晚间的两件事——① 用户个人 provider 配置被桌面端重写导致 ZCode 起不来，排障时读到了
  CLI 模型选择的完整解析链；② 由此发现 r1 写进副本的 providerId / modelId **形态对不上注册表**（计划 R-1 兑现）。
- **审查形态**：`--critics codex,gemini`，理由不变（EV-82 未结案 + glm 适配层是被审对象）。
- **本稿不改任何业务代码**；批准后实施，再走代码双审。

---

## 一、r1 之后新查明的事实（全部只读 `zcode.cjs` 与本机配置**结构**，零配额，不读凭据值）

### 1.1 模型选择的完整解析链（包内函数名为混淆名，括号内是包内 `r(fn, "name")` 登记的原名）

| # | 事实 | 出处 |
| :--- | :--- | :--- |
| N-1 | `EKe`（`resolveInitialModelSelection`）：先拿 `configuredDefault` 过 `V4i`（`isSelectable`）；验不过就回落到**注册表第一个可见 provider 的第一个模型**（`registry-fallback`）；再没有 → `none` → `WC` 抛 `Select a model before continuing` | `EKe` / `V4i` / `WC` |
| N-2 | `V4i` 要求 **providerId 与 modelId 与注册表精确相等**，且 provider 不 `hidden` | `V4i` |
| N-3 | 内置注册表 `zcode-builtin.json`（应用包内，无凭据键）里智谱套餐的 id 是 `account:bigmodel-individual-coding-plan`、模型 id **小写** `glm-5.3-flash`；**没有** `bigmodel-coding-plan` 这个 id。包内 SQL 迁移表：`builtin:bigmodel-coding-plan → account:bigmodel-individual-coding-plan` | `zcode-builtin.json`、包内迁移 SQL |
| N-4 | `fpe`（`NodePersonalProviderConfigRepository`）`#m()`：个人文件**存在 → 直接用，不导入**；**不存在** → `#f()` → `importLegacy()` → 结果经 `#p()` **写成个人文件** | `fpe.#m` / `#f` / `#p` |
| N-5 | `importLegacy` = `skt`（`readLegacyCliPersonalProviderConfig`）读 `O7()` = `join(iy("~/.zcode/cli"), "config.json")`；`iy` 用 **`os.homedir()`**（POSIX 下读 `$HOME`）——**随副本 HOME 走** | `skt` / `O7` / `iy` |
| N-6 | `Oqa`（`importLegacyCliPersonalProviderConfig`）：`source: custom` 的 provider **连 apiKey 一起**变成 `standard-personal` 规则（providerId 原样、模型来自 `models` 键）；`defaultModelSelection` 取 `Mqa`（`importLegacyCliConfiguredDefault`）= `qEn(input).model?.main` | `Oqa` / `Mqa` |
| N-7 | `qEn` 接受 `model.main` 为 **`"provider/model"` 字符串**（`okt` 按第一个 `/` 切）；`Mqa` 只在 provider 为 `builtin:zapi` 时返回 null | `qEn` / `okt` / `Rqa` |
| N-8 | `importLegacy` 只在 `standalone`（CLI 独立进程）模式下接线；`skipUserConfig` 为真时不接 | `startProcessProviderRegistryRuntime` 的调用点 |
| N-9 | 本机真实 `~/.zcode/cli/config.json`：`model.main = "bigmodel-coding-plan/GLM-5.3"`、`lite = ".../GLM-5.3-Flash"`；provider `bigmodel-coding-plan` 是 **`source: custom`**，models `GLM-5.3` / `GLM-5.3-Flash` | 本机文件（只取键名与模型 id） |

### 1.2 这条链对既有实测的解释力

| 实测 | 链上的解释 | 置信度 |
| :--- | :--- | :--- |
| **E0**（副本 HOME + 两个变量、个人指真实文件）→ 回读 `<UUID>/qwen3.8-max` | 个人文件存在 → 跳过 legacy 导入 → `configuredDefault` = 真实文件的默认 qwen → 可选 → 生效。`cli/config.json` 副本的 `model.main` **根本没被读** | 高——N-4 直接给出 |
| **E1**（副本 HOME + 只给内置变量）→ 回读 `bigmodel-coding-plan/GLM-5.3` | 个人文件不存在 → legacy 导入 `cli/config.json` **副本** → 注册表得到 `bigmodel-coding-plan`（custom + apiKey）→ 按链应取副本的 `model.main`（当时写的是 Flash）。**回读却是 GLM-5.3**——它恰是该 provider 的第一个模型（`registry-fallback`），也恰是真实文件的 `model.main`。链上无法区分 | **低**：E1 记录是 2026-09-20 事故当天凭记忆补的（其 stderr 引文 `ZCode Built-in missing` 在包内**不存在**）；副本当时 `model.main` 写的是什么也无法回查 |
| **本日探活失败**（真实 HOME，个人文件被桌面端重写：键抹掉 + 两个自定义 provider `enabled:false`）→ `Select a model before continuing` | `configuredDefault` 缺失 → 回落 → 注册表无可见 provider（自定义被禁、内置 `account:*` 需要账号态、CLI 注册表里没有）→ `none`。加回键后仍失败、再启用 provider 后通过——与 N-1/N-2 完全吻合 | 高——本日三次实测 |
| **P-30**（旗标探针：空 HOME + 只给内置）→ 停在 `Model creation failed`、零配额 | 个人文件不存在 → legacy 导入 → 空 HOME 下 `cli/config.json` 也不存在 → 空注册表 → `none` | 高 |

### 1.3 根因改判

**EV-82 的根因不是「0.16.9 把 `model.main` 的读取点删了」，而是「EV-81 注入了指向真实个人文件的
`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`，个人文件存在使 CLI 跳过 legacy 导入，`model.main` 因此不再被读」。**
`config_copy` 档在 0.16.9 下**没有死**，是被我们自己的注入关掉的。P-31「`model.main` 已无配置读取点」**不准**：
读取点在 `Mqa`，只是被「个人文件不存在」这个条件门住了。

r1 的方案（拷用户 v2 文件、定点改写 `defaultModelSelection`、指向副本）建立在 P-31 之上，
方向就偏了；它写进去的 id 形态又对不上注册表（N-3），两层都不成立。

---

## 二、方案：路线 L（legacy 导入）——推荐

### 2.1 做什么

审查运行（`zcodeAdapter.run()`）做模型覆盖时：

1. `cli/config.json` 副本照旧：整份拷、`model.main` / `model.lite` 写请求模型的全限定串（**现有代码，不动**）。
2. **不注入个人变量**：`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 显式置 `undefined`（与旗标探针同形，让 `run()`
   删掉宿主环境里的同名变量）。内置变量照旧按安装布局派生并注入。
3. CLI 在副本 HOME 下找不到个人文件 → 自行从 `cli/config.json` 副本导入 → 注册表得到 `bigmodel-coding-plan`
   （custom + apiKey，模型 `GLM-5.3` / `GLM-5.3-Flash`）→ `defaultModelSelection` = `model.main` → 精确匹配 → 生效。
4. CLI 会把迁移结果**写成** `<副本HOME>/.zcode/v2/provider_config.json`（含 apiKey）——**已在 r1 的按名整删清单里**
   （AGY-05 加的那两份，此处正好用上）。
5. **撤掉** r1 的 `prepareZcodePersonalConfig` 与个人副本注入；`model_route` 回到原义 `config_copy`
   （删掉 r1 新增的 `provider_config_copy` 取值：types 两处 union、`ZcodeProbe.model_override`、`run.v2.json` enum、
   探针 note）。**保留** r1 的守卫（`model_override_applied` + guard 播报）、三份载体清扫、`zcodeModelTail` /
   `decideModelOverride`；`splitZcodeModel` 无消费方，删。

### 2.2 为什么这条路线更好（与 r1 相比）

| 维度 | r1（个人副本） | 路线 L |
| :--- | :--- | :--- |
| id 形态 | 要按注册表换源（`account:*` + 小写），且内置 `account:*` 进注册表还依赖桌面端 OAuth 账号态——本机今天不可见 | `bigmodel-coding-plan/GLM-5.3-Flash` 就是 legacy 导入后注册表里的精确形态（N-6/N-9），**现有 `qualifyZcodeModel` 的产出直接可用** |
| 凭据面 | 副本里 2 份用户凭据载体（`cli/config.json` + 拷来的 v2 文件） | **1 份**（只拷 `cli/config.json`；v2 那份由 CLI 从它派生，不再碰用户的 v2 文件） |
| 与桌面端的耦合 | 依赖用户 v2 文件的健康状态——**今天它被桌面端改坏，审查运行就会跟着坏** | **解耦**：审查运行只依赖 `cli/config.json`，桌面端怎么改 v2 文件都不影响 |
| 改动面 | 已实施的 350 行 | 净**减**：撤掉个人副本机制，`zcodeProviderEnv` 加一个「省略个人」的三态 |
| 与 P-30 的一致性 | 两条路径两套注入规则 | 与旗标探针**同一形态**（只给内置），一条规则 |

### 2.3 `zcodeProviderEnv` 的三态参数

现签名 `personalOverride?: string | null`（`null ?? 真实路径` → 等于「派生」）改为**三态**：

- `undefined` → 按真实用户目录派生（探活、探针 headless 臂走这条，**不变**）；
- `null` → **显式省略**，键置 `undefined`（审查运行的覆盖路径、以及旗标探针可以改用它——旗标探针本轮**不动**，只登记）；
- `string` → 指定路径（本轮无调用方，删掉这一态；留着就是 r1 的死代码）。

逐键门控**不变**（D-3 撤回的结论仍然成立，用例已锁）。

### 2.4 不做（逐条附理由）

| 不做 | 理由 |
| :--- | :--- |
| 路线 P：把 r1 的个人副本改成注册表形态（`account:*` + 小写）+ 拷 `credentials.json` | 三个前提都没摸清：内置 `account:*` 怎样进 CLI 注册表、账号态在副本 HOME 下能否复现、`credentials.json` 的加密密钥（包内 `ZCODE_CREDENTIAL_SECRET`）从哪来。路线 L 一个都不需要。**只在路线 L 的真实链路验证失败后才回头看它**（§四） |
| 改旗标探针改用三态参数 | 它现在手工拼的 env 与三态语义等价，改了是纯重构；本轮论域是审查运行路径 |
| 修 P-31 之外的 M0 报告条目 | 只改 P-31 与 P-28 末句（「个人那份自带默认模型」那句要补「且它存在时 legacy 导入被跳过」） |
| 探活 / 探针改走副本（EV-87） | 独立主题，本日实证已归因到桌面端，优先级不变 |
| `probeZcodeModels` 换源（EV-90） | 路线 L 下 `cli/config.json` 恰恰**就是**审查运行的模型来源，目录与生效落点**重新同源**——EV-90 的理由消失，随本轮**关闭** |

---

## 三、改动清单

| 文件 | 改动 |
| :--- | :--- |
| `src/trivium/adapters/zcode.ts` | 删 `prepareZcodePersonalConfig` / `ZcodePersonalConfigPrep` / `splitZcodeModel` / `zcodePersonalConfigUnder`；`zcodeProviderEnv` 参数改三态（`undefined` 派生 / `null` 省略）；`ZcodeInvokeOptions.personalProviderConfig` 改为 `omitPersonalProviderConfig?: boolean`；`run()` 覆盖路径传 `true`，`model_route` 回 `home.route`，`decideModelOverride(home.route === 'config_copy', …)`；`trace.json` 的 `modelSelection.route` 同步；文档块改写（尤其 `prepareZcodeHome` 上方那段「0.16.9 下 `model.main` 已失效」要改成「legacy 导入的前提是不注入个人文件」） |
| `src/trivium/types.ts` | `model_route` 两处 union 与 `ZcodeProbe.model_override` 删 `provider_config_copy`；`model_override_applied` 注释里「本侧即 `route === 'provider_config_copy'`」改 `config_copy` |
| `skills/dual-critic/schema/run.v2.json` | `model_route` enum 删 `provider_config_copy`；`model_override_applied` 保留 |
| `src/trivium/probes/zcode.ts` | `model_override` 回 `config_copy`，note 改写：「`config_copy` 在 0.16.9 下仍生效，前提是**不注入个人变量**让 CLI 走 legacy 导入」 |
| `test/unit/zcode-model-selection.test.ts` | 删 `splitZcodeModel` / `prepareZcodePersonalConfig` 各腿；增：覆盖路径下 `invokeZcode` 递给子进程的 env **没有**个人变量（用 `zcode-provider-env.test.ts` 的假入口夹具，断言其日志里 `personal: null`，**即使真实个人文件存在**）；三态参数各一腿；守卫与清扫腿不动 |
| `test/unit/zcode-provider-env.test.ts` | 已有「两个键恒定出现」的用例按三态补一腿 |
| 文档 | 见 §五 |

---

## 四、验证

### 4.1 零配额

`npm run check`；新旧用例全绿；对 `omitPersonalProviderConfig` 做一条变异（把 `true` 改 `false`，假入口日志腿必须红）。

### 4.2 真实链路（花配额，这是本轮**唯一能判定路线 L 成不成立**的一步）

`npm run build` 与 `npm run install:local` **分开跑**，然后由用户发起一次含 glm 的真实双审（下一次 `/dual-review-*`），
读 `run.v2.json` 的 glm 段：

| 判据 | 期望 |
| :--- | :--- |
| `model_effective` 的 modelId 段 | 等于请求模型（默认档位 `GLM-5.3` 或 `GLM-5.3-Flash`） |
| `model_route` | `config_copy` |
| `model_override_applied` | `true` |
| guard 播报 | 无「请求的模型没有生效」 |
| 清扫哨兵 `carriers_deleted` | 含 `cli/config.json` **与 CLI 自写的 `v2/provider_config.json`**（后者证明 legacy 导入真的发生了） |
| `trace.json` 的 `modelSelection` | `requested` / `effective` 一致，`note` 为空 |

**E1 的矛盾在这一步一并裁决**：若回读仍是 `GLM-5.3`（第一个模型）而非请求的 Flash，说明 `Mqa` 在本机形态下返回了
null（或 `Pqa.parse` 剥掉了 `model`），路线 L 只能保证「GLM 家族」不能保证「具体模型」——那仍比 r1 强（异构恢复），
但 FR-06 只算部分达成，如实记；然后再看路线 P。

### 4.3 达不成时的处置

如实登记、保持 glm 禁用、不改判据去迁就结果。守卫会把差异说出来，这正是 r1 保留它的理由。

---

## 五、留痕与文档回填

- **M0 报告 P-31 改判**：`model.main` **有**读取点（legacy 导入的 `Mqa`），条件是个人文件不存在；EV-82 的根因是 EV-81 的注入。
  P-28 末句补「个人那份存在时 legacy 导入被跳过」。
- 设计 §3.3：r1 写进去的「模型覆盖落点」两条改写为路线 L；「模型指定」行里「`model.main` 已无读取点」改准；
  §11.3 要点 1 改回 `config_copy` 首选并写明前提；§21 v1.3.33 行；§24 台账。
- BACKLOG：EV-82 状态改「路线 L 待真实链路验证」；**EV-90 关闭**（理由见 §2.4）；EV-88 补一句「路线 L 使审查运行也依赖
  『只给内置』形态，与旗标探针同一前提」；新登记：**EV-92** 旗标探针改用三态参数（纯重构）。
- RUNBOOK：本日加的两行保留；「glm 侧起得来但模型不对」那行改写为路线 L 的说法。
- `.env.example`：r1 改的那段再改（个人那份**不注入**、CLI 从 `cli/config.json` 副本导入）。

---

## 六、r1 → r2 的方法记账

r1 把 P-31 当成了既成事实去设计，而 P-31 本身是上一主题事故当天在没有完整解析链的情况下写下的推断
（「CLI 包内字面：`model.main` 无配置读取点」——当时只 grep 了字面，没有找到 `Mqa` 这个经 `qEn` 归一化后的读取点）。
两层教训：**① 事实登记要写清「怎么核的」**，一句「包内字面」不够；**② 建立在事故当天记录上的设计，第一步应该是复核那条记录。**
r1 §二 B 表已按「哪条调用路径上验过」的纪律改写，本稿 §1.1 每条都标了出处函数名，§1.2 每条标了置信度。

---

## 七、给 `/dual-review-plan` 的焦点建议

与 r1 相同的约束（焦点不能含 Hook 写动词字面）。建议：

> 重点看两件事：一是 §1.3 的根因改判是否成立——EV-81 的个人变量注入是否真的让 CLI 跳过了 legacy 导入，
> 有没有我漏掉的第三条读取路径；二是路线 L 撤掉个人副本、只靠 `cli/config.json` 副本 + 不注入个人变量，
> 在凭据面、清扫论域和与旗标探针的一致性上有没有新缺口。

（措辞由你定。）
