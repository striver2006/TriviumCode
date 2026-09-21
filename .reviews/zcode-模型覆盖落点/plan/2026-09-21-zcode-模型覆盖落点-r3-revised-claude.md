---
schema: trivium.disposition.v1
topic: zcode-模型覆盖落点
stage: plan
role: claude
kind: revised
run_id: 20260921T114825Z
addresses:
  - 2026-09-21-zcode-模型覆盖落点-r3-codex.md
  - 2026-09-21-zcode-模型覆盖落点-r3-gemini.md
---

# 裁决与修订计划（r2 稿 → r3 裁决）：zcode-模型覆盖落点（EV-82）

**8 条意见（codex 5 ｜ gemini 3），全部接受，零驳回、零暂缓。**
两侧独立收敛在一处：§4.2 用默认档位 `GLM-5.3` 做真实链路验证是**假阳性**——它恰是该 provider 的第一个模型，
「Mqa 读到了 `model.main`」与「Mqa 返回 null 回落到首位模型」两个世界里回读值相同（CODEX-01 ≡ AGY-r2-01）。

裁决前把四条可零配额核实的事实核了一遍，其中两条**加重**了意见的分量：
- **CODEX-02 的依据属实**：包内 `FZi` 按 `dataBaseDir ?? ZCODE_DATA_BASE_DIR ?? homedir()` 推导个人路径并写回 env。
  宿主当前**没有**任何 `ZCODE_*` 变量，故是潜在风险而非活风险，但要 fail-closed 处理。
- **CODEX-03 是当前活缺陷**：探针结论里 `model_id_form` 此刻就是 UUID 形态 `84044858-…/qwen3.8-max`
  （本日修复个人配置后重探所致）。按 r2 稿写进副本的会是 `<UUID>/GLM-5.3-Flash`，在路线 L 的注册表里**必然验不过**。
  codex 标 medium，实际今天就会踩中——r2 稿 §2.2 那句「现有 `qualifyZcodeModel` 的产出直接可用」正是本轮教训①要防的登记形态，我又写了一次。

根因改判（§1.3）与路线 L 的方向，两侧都在包内逐字复核后判成立；codex 还补了一条我漏掉的机理（FZi 合成缺失键），见 §三。

---

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 已复核：`bigmodel-coding-plan` 的 models 顺序是 `GLM-5.3` 在前，注册表回落取的正是它；默认档位跑出 `GLM-5.3` 分不出「configured-default」与「registry-fallback」。§4.2 把两档并列为可选是错的。守卫 `decideModelOverride` 只比 modelId 段，对「请求 == 首位模型」恒盲，这个边界 r2 稿没写 | §4.2 判定跑**钉死**为请求非首位模型 `GLM-5.3-Flash`（`--model-glm` 或 thrifty 档），`GLM-5.3` 档只算回归确认；§2.2 与 §4.3 补守卫失明边界；CODEX-04 的探针臂用 Flash，把这个盲区在探针层消解 |
| CODEX-02 | codex | major | 接受 | **已复核属实**：`FZi(prepareCliProviderRuntimeEnv)` 在 `--prompt` 形态下按 `e.dataBaseDir ?? env.ZCODE_DATA_BASE_DIR ?? homedir()` 推导个人路径并 `Object.assign(process.env)`；`run()` 以 `{...process.env}` 为底，适配层只删两个 provider 键。宿主预置该变量 → 个人文件在副本外「存在」→ legacy 导入被跳过——本轮根因换个入口复发，且 CLI 自写的凭据文件落到清扫论域**之外**。宿主当前无该变量（已查），但 fail-closed 是本仓既定口径（r2 CODEX-01 ≡ AGY-02「判据是子进程拿不到」）。另：C-08「`ZCODE_DATA_BASE_DIR` 对配置解析无效」是 0.16.5 结论，0.16.9 对 provider 配置根**有效**，我方三处登记过期 | `zcodeProviderEnv` 的 env 片段增 `ZCODE_DATA_BASE_DIR` / `ZCODE_HOME` / `ZCODE_STORAGE_DIR` 三键**恒置 `undefined`**（与两个 provider 键同一口径）；`zcode-provider-env.test.ts` 增「宿主预置 `ZCODE_DATA_BASE_DIR` → 子进程拿不到」一腿；M0 C-08 补 0.16.9 适用范围，适配器头注释第 8 行与探针 note 同句改准；§4.2「v2 文件被自写」哨兵注明前提是推导根 = 副本 HOME |
| CODEX-03 | codex | minor | 接受 | **已复核为当前活缺陷**（比意见判的更重）：`model_id_form` 此刻是 `84044858-…/qwen3.8-max`。`qualifyZcodeModel('GLM-5.3-Flash', 它)` → `<UUID>/GLM-5.3-Flash`，而 legacy 导入后注册表里的 providerId 是副本源 `cli/config.json` 的键 `bigmodel-coding-plan`——异源拼串必验不过，Flash 档报 false 却不报真因，默认档静默假绿。根因是 `model_id_form` 记的是**上一次真实 HOME 运行的生效模型**（个人配置的默认），与 `config_copy` 路径的 provider 键不同源 | `config_copy` 路径的模型限定**改为从副本源 `cli/config.json` 自身派生**：裸名 → 在 `cfg.provider[*].models` 里找到**唯一**含它的 provider 键补前缀；带 `/` 的请求 → 核 provider 键存在且 model 在其 `models` 内；不满足 → **不覆盖**、`route: global` 并给明确 reason。`model_id_form` 不再参与 `config_copy` 路径。零配额用例覆盖四种输入。`normalizeModelForCatalog` 仍用 `model_id_form` 的口径问题另立条目（EV-93） |
| CODEX-04 | codex | minor | 接受（修法微调） | 问题成立：§4.1 与 §4.2 之间没有中间档，唯一判定点要烧整轮三侧双审；而 legacy 导入与 `#p` 回写发生在配置读取阶段、**先于任何模型调用**，自写 v2 文件的 `defaultModelSelection` 本身就是判据。**不采纳「拉起后立即终止」**：有竞态，来得及发请求就烧配额；改用**哨兵密钥**——副本里 apiKey 换成假值，CLI 读完配置、写完 v2、到鉴权层自己停下，零配额且副本里**没有真实凭据** | 新增 doctor 探针臂，把 `probe.model_override` 从写死值改成**实测值**：`mkdtemp` 副本 HOME + `cli/config.json` 副本（apiKey 换哨兵、`model.main` 写非首位 `…/GLM-5.3-Flash`）+ 只给内置变量 → headless → 读副本 `v2/provider_config.json` 的 `defaultModelSelection` 是否等于请求 → `config_copy` / `global` + note。清理只认 `mkdtemp` 返回值（R1）。放 §4.1 之后作为路线 L 的**前置判据**；§4.2 仍跑，作端到端确认 |
| CODEX-05 | codex | nit | 接受 | 属实：`ZCODE_CREDENTIAL_CARRIERS` 注释第二条写着「`prepareZcodePersonalConfig` 抄来改 `defaultModelSelection` 的那份」，撤除后挂空。它是清扫清单语义的出处说明，留死引用会误导下一次论域扩删 | §三改动清单补一行：该条来历改为「CLI 从 `cli/config.json` 副本 legacy 导入后自写的迁移结果，含从副本带过去的 apiKey」 |
| AGY-r2-01 | gemini | major | 接受 | 与 CODEX-01 同一缺陷；本条另指出 `config.ts:324` standard 档位的 glm 默认正是 `GLM-5.3`——即**不显式指定模型的常规运行就落在盲区里**，比 codex 的表述更实 | 同 CODEX-01 |
| AGY-r2-02 | gemini | minor | 接受 | 属实：去掉 string 态后 `undefined` / `null` 只剩二态，用 `null` 当 magic value 在 `?? ` 表达式里易混（r1 的 `personalOverride ?? p.personal` 就把 `null` 吃成了「派生」——正是这个坑）。布尔开关与 `ZcodeInvokeOptions.omitPersonalProviderConfig` 同构，一眼可读 | §2.3 改为 `zcodeProviderEnv(entry, userHome, opts?: { omitPersonal?: boolean })`；删 null 三态 |
| AGY-r2-03 | gemini | nit | 接受 | 属实：`authProbe` 与 `probeZcode` 仍读宿主 v2 文件，宿主那份坏了 preflight 照样阻断（本日就是这样）。「与桌面端解耦」要限定为审查执行期 | §2.2 表该行改为「审查执行期与桌面端解耦；preflight 探测仍依赖宿主 v2（EV-87）」 |

---

## 二、修订后的方案（只列相对 r2 稿**变了的**部分）

### §2.1 第 1 步（CODEX-03）——模型限定改从副本源派生

`prepareZcodeHome(runDir, model)` 不再接收已由 `model_id_form` 补全的串，改为接收 `req.model` 原值并**自行限定**：

1. 读入 `~/.zcode/cli/config.json`（现有），取 `cfg.provider` 的键集与各自 `models` 键集；
2. `req.model` 不含 `/` → 在所有 provider 里找 `models` 含它的；**恰好一个** → `<providerKey>/<model>`；零个或多个 → 不覆盖，
   reason 写明「副本源里没有 / 有多个 provider 提供该模型」；
3. `req.model` 含 `/` → 按最后一个 `/` 切；provider 键必须存在且 model 在其 `models` 内；否则不覆盖并给 reason；
4. 通过才写 `model.main` / `model.lite`，`route: config_copy`；否则 `route: global`，`reason` 进 `trace.json` 的 `modelSelection`。

`model_id_form` 从 `config_copy` 路径**退出**。`normalizeModelForCatalog`（preflight 的目录比对）仍用它——那是另一条口径问题，登记 EV-93。

### §2.3（AGY-r2-02）——布尔开关

`zcodeProviderEnv(entry, userHome = os.homedir(), opts: { omitPersonal?: boolean } = {})`：
`omitPersonal` 为真 → 个人键恒 `undefined`；否则按真实用户目录派生 + 逐键门控（不变）。

### §2.5 新增（CODEX-02）——三键恒清

`zcodeProviderEnv` 返回的 env 片段**恒含** `ZCODE_DATA_BASE_DIR` / `ZCODE_HOME` / `ZCODE_STORAGE_DIR` 三键、值为 `undefined`。
理由与两个 provider 键同源：判据是「子进程拿不到」，不是「编排器没主动给」。C-08 的适用范围随之改准
（0.16.5「对配置解析无效」；0.16.9 对 **provider 配置根与凭据根** 有效——`FZi` / `gUs` / telemetry 三处读它）。

### §2.6 新增（CODEX-04）——探针臂 `zcode.model_override` 实测化

`probes/zcode.ts` 新增 `probeModelOverride(entry, node, cwd)`：
- `makeTempDir` 一个副本 HOME；把真实 `cli/config.json` **按 §2.1 的限定逻辑**拷进去，`model.main` 写 `…/GLM-5.3-Flash`
  （非首位；若本机目录里 Flash 不存在则取目录里任一**非首位**模型），**所有 provider 的 apiKey 替换为哨兵串** `trivium-probe-sentinel`；
- env：只给内置变量、个人键与 §2.5 三键 `undefined`、`HOME` = 副本；跑 headless（`--prompt ok`，30s，`killTree`）；
- **不看退出码判成败**（预期停在鉴权/模型层），读副本 `v2/provider_config.json`：`config.defaultModelSelection` 等于请求 →
  `model_override: config_copy`；文件不存在 / 键缺失 / 不等 → `global` + note 写出实际值；
- 清理：`fs.rm(tmp)` 只认 `makeTempDir` 的返回值（R1）；副本里没有真实凭据（哨兵替换），清理失败也不泄漏。
- `--no-model-calls` 下**照跑**：本臂零配额、零凭据。

`probe.model_override` 因此从「写死 `config_copy`」变成**实测结论**；`availability()` 本轮不读它（保持 r1 结论：判定层不加新判据）。

### §2.2 表（AGY-r2-03）——措辞限定

「与桌面端解耦」行改为：**审查执行期**与桌面端解耦；preflight 探测仍依赖宿主 v2（EV-87）。

### §4.2（CODEX-01 ≡ AGY-r2-01）——判定跑钉死非首位模型

| 跑法 | 性质 |
| :--- | :--- |
| `--model-glm GLM-5.3-Flash`（或 thrifty 档） | **路线判定**：回读 modelId 段 == `GLM-5.3-Flash` 才算 FR-06 达成 |
| 默认档位 `GLM-5.3` | 只算**回归确认**，不能裁决 E1 矛盾 |

§4.3 补守卫边界：请求模型恰为该 provider 首位时，`model_override_applied: true` 分不出 configured-default 与 fallback——
这个盲区由 §2.6 的探针臂（固定用非首位模型）在探针层覆盖。

### §三 改动清单（增删）

- **增**：`probes/zcode.ts` 的 `probeModelOverride` + `probeZcode` 接线 + 用例（假入口按「读完配置写 v2 再停」应答）；
  `ZCODE_CREDENTIAL_CARRIERS` 注释第二条来历改写（CODEX-05）；`zcode-provider-env.test.ts` 增三键清除腿。
- **改**：`prepareZcodeHome` 签名与限定逻辑（§2.1）；`zcodeProviderEnv` 布尔开关（§2.3）。
- **删**：r2 稿 §2.3 的 string 态与 null 态。

### §五 留痕（增）

- M0 报告 C-08 补 0.16.9 适用范围；P-28 末句补 `FZi` 合成缺失键的机理。
- BACKLOG：**EV-88 关闭**——机理已明（`FZi` 在 `cfr` 之前合成缺失键，headless 路径不会撞成对抛错），逐键门控的依据从「观察」升为「机制」；
  新登记 **EV-93**：`model_id_form` 记的是真实 HOME 运行的生效模型（个人配置默认），`normalizeModelForCatalog` 拿它给短名补前缀会与
  `probeZcodeModels` 的目录（`cli/config.json` 键形态）异源——本日 UUID 形态下 preflight 的 slug 校验只靠短名匹配侥幸过。

---

## 三、两侧「认为正确」里我要收下的两条

1. **codex 补出的机理**：`FZi` 在 `--prompt` 形态下为缺失的 provider 键合成派生路径并写回 `process.env`，`cfr` 的成对抛错因此在
   headless 路径上被兜住。这把上一轮撤回 D-3 时「观察不等于保证」的缺口填上了——EV-88 可以按「机理已明」关闭。
2. **codex 核实 `skipUserConfig` 在 headless 路径恒为假**（包内无任何置真入口，仅桌面嵌入用）——N-8 的前提在审查运行路径上成立，
   r2 稿里这条我只写了「`skipUserConfig` 为真时不接」没写它何时为真。

---

## 四、方法记账

r2 稿 §2.2 那句「现有 `qualifyZcodeModel` 的产出直接可用」，是在**没有查当前 `model_id_form` 取值**的情况下写的——
而它的取值就在 `.trivium/config.local.yaml` 里，一条 grep 的事。同一天里我已经因为「没核当前值就当既成事实」被打过两次
（P-31、D-3），这是第三次，形态完全相同。对策：§二 B 表的纪律「每条字面注明哪条路径上验过」要再加一句——
**凡依赖探针结论文件里的值，写方案时先 grep 一次当前值并把它抄进稿子**。
