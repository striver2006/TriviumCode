---
schema: trivium.disposition.v1
topic: zcode-模型覆盖落点
stage: code
role: claude
kind: response
run_id: 20260921T124003Z
addresses:
  - 2026-09-21-zcode-模型覆盖落点-codex.md
  - 2026-09-21-zcode-模型覆盖落点-gemini.md
---

# 代码双审 r1 应答：zcode-模型覆盖落点（EV-82）

codex 侧**解析回退**（EV-84 形态：JSON 块外多了一行中文引言与一段复述，JSON 本身完整、7 条意见结构齐全）。
编排器把它切成三个单元 `CODEX-F01`（引言行）/ `CODEX-F02`（整个 JSON 块）/ `CODEX-F03`（末尾要点复述），
闸门按这三个编号收裁决；**7 条实质意见作为 F02 的子项在 §二逐条裁决**。gemini 侧 4 条结构化。
共同阻断档位本轮未执行（`joint_check: skipped-insufficient-sides`），两侧均无 blocker。

**实质意见 11 条（codex 7 ｜ gemini 4），全部接受，零驳回、零暂缓。**

**两侧独立收敛在同一处 major**（codex 子项 01 ≡ AGY-01）：`probeReadonlyFlags` 从 `zcodeProviderEnv` **只解构了内置键**，
另建两键对象递给 `run()`，本轮刚加的三个目录键被丢在解构之外。而我在适配器头注释、M0 C-08、P-28 三处刚写下
「一律从子进程环境删掉」。**同一轮写下的口径，在最需要它的那条路径上没做到**——旗标探针恰是 `--no-model-calls` 下最常跑、
零配额前提最脆弱的一条。修法与 `probeModelOverride` 现成同形：整包 spread。

裁决前核过三件事：`ZCODE_API_KEY` 在 0.16.9 包内**零命中**（codex 子项 03 的一半依据是 0.16.5 的 M0 快照，已过期）；
`provider_config_copy` / `personalOverride` 在 RUNBOOK:266、设计 :247、:2418 三处残留属实；旗标探针的假入口日志面现成。

---

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex | nit | 驳回 | 该单元是引言行「审查完成。以下为我的结构化结论…」，不含任何意见，无可裁决内容；解析回退把它切成了独立单元。实质意见全部在 CODEX-F02 | 无修改：非意见单元 |
| CODEX-F02 | codex | major | 接受 | 整个 JSON 块，含 7 条实质意见（2 major ｜ 3 minor ｜ 2 nit），**逐条裁决见 §二，全部接受**。最重的一条（子项 01）与 AGY-01 独立收敛：旗标探针路径漏清三个目录键，已复核属实；子项 02（探针臂把拉起失败记成有定论的 `global`）属实且与 r2 CODEX-02 修过的双义同型；子项 03 主体成立、一半依据过期（`ZCODE_API_KEY` 0.16.9 不读）；子项 04 文档残留三处已复核；子项 05 产出条件零用例属实；子项 06 / 07 两条 nit 属实 | 见 §二逐项落点；汇总在 §三修改方案 |
| CODEX-F03 | codex | major | 接受 | 末尾「要点复述」段，内容是 F02 子项 01 的重述（旗标探针漏清三键为最危险一条）与其余六条的一句话索引，不含新意见。与 F02 子项 01 同一裁决 | 同 F02 子项 01：`probeReadonlyFlags` 改整包 spread + 补目录键用例 |
| AGY-01 | gemini | major | 接受 | 与 codex 子项 01 同一缺陷，独立收敛。本条把后果说到位：`FZi` 按 `ZCODE_DATA_BASE_DIR` 推出的根下若有个人文件，空 HOME 隔离失效，七次全是真实调用。**已复核**：`probes/zcode.ts` 的 `probeReadonlyFlags` 写的是 `const { [BUILTIN]: builtinFile } = await zcodeProviderEnv(entry)` 再手拼两键对象；`exec.run` 只对「值为 `undefined` 的键」做 `delete`，键缺席即原样透传 | `probeReadonlyFlags` 改 `const providerEnv = await zcodeProviderEnv(entry, undefined, { omitPersonal: true })`；假入口日志增 `dataBase` 字段；`zcode-provider-env.test.ts` 增「宿主预置 `ZCODE_DATA_BASE_DIR` → 七次调用的子进程都拿不到」一腿 |
| AGY-02 | gemini | minor | 接受 | 与 codex 子项 03 前半同一缺陷（`replaceApiKeys` 只认键名 `apiKey`，headers / token 形态原样进副本）；**本条另指出一处 codex 没说的**：探针拉起没传只读参数，对本地免密 / openai-compatible 端点，哨兵密钥挡不住真实请求，CLI 可能真跑起来甚至执行工具。探针臂跑在 `probeReadonlyFlags` **之后**，`probe.readonly_flags` 已可用。无网 hang 的形态由子项 02 的修法接住（超时 → 未判定） | 探针副本改**白名单重建**（provider 只留 `name` / `kind` / `source` / `enabled` / `models`，`options` 只留 `baseURL` + 哨兵 `apiKey`）；探针臂传 `readonlyArgsFromProbe(probe.readonly_flags)`；用例夹具补 `headers.Authorization` 与 `token` 两种形态，断言副本里不出现夹具源的任何非白名单字符串值 |
| AGY-03 | gemini | minor | 接受 | 与 codex 子项 05 同一缺陷（`model_override_applied` 的两道产出闸门零用例，去掉门恒写 `null` 全量照绿——M1 形态）；本条补了正向两格（回读 `true` / `false`）也没有端到端 | ① `run()` 负格：模型不在副本源 → `route: global` → `'model_override_applied' in result === false`；② 正格两条：假入口写一份 log（`context.model` 等于 / 不等于请求）→ `true` / `false`；③ 已读 `run.v2.json` 的集成用例里断言 stub 侧该键**缺席** |
| AGY-04 | gemini | nit | 接受 | 与 codex 子项 04 同处；本条另点了设计 :2418（§11.3 要点 7 末句「模型覆盖走个人那份的每运行副本（v1.3.32，personalOverride）」），与要点 1 的路线 L 冲突——已复核属实，都是我 r1 写的、r3 撤除时没扫到 | RUNBOOK:266 改判读路径；设计 :247 改现行档名 + C-08 适用范围；:2418 改「副本 HOME 下省略个人那份（`omitPersonalProviderConfig`）」；`grep provider_config_copy` 在 §24 台账之外须为零 |

---

## 二、CODEX-F02 的七个子项逐条裁决

- **子项 01**（major，`probeReadonlyFlags` 漏清三个目录键）——**接受**。已复核属实（同 AGY-01）。落点：整包 spread `zcodeProviderEnv(entry, undefined, { omitPersonal: true })`；补用例。
- **子项 02**（major，`probeModelOverride` 丢弃 `run()` 结果、拉起失败一律记 `global`）——**接受**。属实：spawn 失败（`code === null`）、30s 超时、内置文件缺失退 1、模块崩溃，凡没写出 v2 文件一律记 `global` 并**覆盖上一次结论**、出 ⚠️。这是把「本轮没判成」记成「判成了、没生效」，与 r2 CODEX-02 修 `readonly_flags` 时的双义同型、方向相反；r3 裁决只对「挑不出非首位模型」做了未判定区分。落点：三分判定——`code === null` / `timedOut` / stderr 命中 `ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE` → `null`（未判定、保留旧值，`why` 带退出码与 stderr 首行、过 `redactSecrets`）；写出 v2 → 比对；没写出且 stderr 命中 `ZCODE_ARGV_PARSED_RE`（停在模型/鉴权层）→ `global`；其余 → `null`。补用例：崩溃 / 无输出 / 缺内置变量 → `null`；停在 `Model creation failed` 但不写 v2 → `global`。
- **子项 03**（minor，凭据面两条破口）——**接受，一半依据已过期**。主体成立：`replaceApiKeys` 只认键名 `apiKey`，headers 里的 `Authorization` 原样进副本，SIGKILL 时残留。**过期的一半**：`ZCODE_API_KEY` 在 0.16.9 包内零命中，CLI 不读它，「哨兵形同虚设」在本机版本不成立（M0 §6.2 是 0.16.5 快照）；但 `ZCODE_BASE_URL` 在包内，探针路径不该继承——fail-closed 理由与三键相同。落点：副本白名单重建（删 `replaceApiKeys`）；探针臂与旗标探针 env 增 `ZCODE_API_KEY` / `ZCODE_BASE_URL` 恒 `undefined`（新常量 `ZCODE_CREDENTIAL_ENV_KEYS`，**只在探针路径**清——审查运行继承宿主凭据 env 是应有之义，意见自己也这么说）；用例改为「副本里不出现夹具源的任何非白名单字符串值」。
- **子项 04**（minor，`provider_config_copy` 文档残留）——**接受**。已复核：RUNBOOK:266 让读者找 `route` 为 `provider_config_copy` 的分支，该取值已不存在，真实形态是 `route: config_copy` + `model_override_applied: false`；设计 :247 仍写「v1.3.32 换成 `provider_config_copy`」与「三个目录键对配置解析全部无效」，与 v1.3.33 条目矛盾。落点：两处改写；grep 清零（§24 台账除外）。
- **子项 05**（minor，产出条件零用例）——**接受**。属实（同 AGY-03）。落点：`run()` 负格 + 集成用例断言缺席；`review.ts` 那段若不便单测则抽纯函数。
- **子项 06**（nit，version 探针不清目录键）——**接受**。属实且口径不对称：`probeZcodeEntry` 的注释自己立论「只在两条主拉起路径兑现就是留口子」。现势无害（P-28），改一行。落点：env 增三键 + 两个凭据键 `undefined`，注释补一句。
- **子项 07**（nit，两处注释漂移）——**接受**。属实：`decideModelOverride` 文档块里的 `hasEffective` 是 r1 草稿残留；`zcodeHomeUnder` 头上那段与 `prepareZcodeHome` 的 doc 重复。落点：删句、并注释。

---

## 三、修改方案（**审批通过后执行**）

### 3.1 `src/trivium/probes/zcode.ts`

1. `probeReadonlyFlags`：`providerEnv` 改整包 `await zcodeProviderEnv(entry, undefined, { omitPersonal: true })`，
   并把 `ZCODE_API_KEY` / `ZCODE_BASE_URL` 置 `undefined`。
2. `probeZcodeEntry`：env 增三个目录键 + 两个凭据键 `undefined`。
3. `probeModelOverride`：
   - 副本改白名单重建 `buildProbeCliConfig(cfg, qualified)`：`provider[k] = { name, kind, source, enabled, models, options: { baseURL?, apiKey: 哨兵 } }`，`model = { main, lite }`；删 `replaceApiKeys`。
   - 接收 `run()` 结果，三分判定（见 §二子项 02）。
   - 新增 `readonlyArgs` 入参，`probeZcode` 处传 `readonlyArgsFromProbe(probe.readonly_flags)`。
   - env 增 `ZCODE_API_KEY` / `ZCODE_BASE_URL` `undefined`。
4. 消费处：`mo.override === null` 时 note 写明「未判定、保留上一次」（已有），不出 ⚠️。

### 3.2 `src/trivium/adapters/zcode.ts`

- `decideModelOverride` 文档删 `hasEffective` 句；`zcodeHomeUnder` 头上的重复注释并入 `prepareZcodeHome`。
- 新增 `ZCODE_CREDENTIAL_ENV_KEYS = ['ZCODE_API_KEY', 'ZCODE_BASE_URL']`，注释写明只在探针路径清。

### 3.3 用例

- `zcode-provider-env.test.ts`：假入口日志增 `dataBase` / `apiKeyEnv`；增「宿主预置 `ZCODE_DATA_BASE_DIR` / `ZCODE_API_KEY` → 七次都拿不到」。
- `zcode-model-selection.test.ts`：探针臂——夹具补 `headers.Authorization` 与 `token`，断言副本里不出现夹具源的任何非白名单字符串值；崩溃 / 缺内置变量 → `null`；停在 `Model creation failed` 不写 v2 → `global`；假入口记下收到的 `--mode plan` 与 `--disallowed-tools`。`run()`——负格字段缺席；正格 `true` / `false`。
- 集成：已读 `run.v2.json` 的用例里断言 stub 侧该键缺席。
- 变异：三分判定、白名单重建、`readonlyArgs` 透传、`probeReadonlyFlags` 的整包 spread 各一条。

### 3.4 文档

- RUNBOOK:266 判读路径改为「`route: config_copy` 且 `model_override_applied: false` ⇒ 副本写了但 CLI 没按它走」。
- 设计 :247 改现行档名 + C-08 适用范围；:2418 改「省略个人那份」。
- M0 P-28 机理补记末尾加「0.16.9 包内不读 `ZCODE_API_KEY`（零命中）」；§6.2 是 M0 快照不改。
- 设计 §21 v1.3.33 行补「代码双审 r1 落地」段。

---

## 五、实施记录（2026-09-21，审批通过后执行）

| 落点 | 状态 |
| :--- | :--- |
| 子项 01 ≡ AGY-01：`probeReadonlyFlags` 整包 spread + 两个凭据键清除 | ✅ 用例「宿主预置 `ZCODE_DATA_BASE_DIR` / `ZCODE_API_KEY` → 七次都拿不到」 |
| 子项 02：探针臂三分判定（`code === null` / 超时 / 内置定位失败 / 未识别 → `null`；停在模型层且无 v2 → `global`） | ✅ 用例四腿：崩溃、**超时**、缺内置、无导入 |
| 子项 03 ≡ AGY-02 前半：副本白名单重建 `buildProbeCliConfig`（`options` 只留 `baseURL` + 哨兵），删 `replaceApiKeys` | ✅ 夹具补 `headers.Authorization` / `token`，断言副本里不出现任何非白名单字符串值；假入口见到非哨兵即退 99 |
| 子项 03 后半 / 子项 06：`ZCODE_CREDENTIAL_ENV_KEYS`（`ZCODE_API_KEY` / `ZCODE_BASE_URL`）在探针臂、旗标探针、version 探针三条路径清；version 探针同时清三个目录键 | ✅ 三条路径各一腿 |
| AGY-02 后半：探针臂传 `readonlyArgsFromProbe(probe.readonly_flags)` | ✅ 用例断言假入口收到 `--mode plan` 与 `--disallowed-tools` |
| 子项 05 ≡ AGY-03：产出条件用例 | ✅ `run()` 负格（字段缺席）、正格 `true` / `false`（假入口写会话日志）；`code-stage` 集成用例断言桩侧缺席 |
| 子项 04 ≡ AGY-04：三处文档残留 | ✅ RUNBOOK:266、设计 :247、:2418；M0 P-28 补「0.16.9 不读 `ZCODE_API_KEY`」 |
| 子项 07：两处注释 | ✅ |

**验证**：`npm run check` 1557 / 1555 pass / 0 fail / 2 skipped。变异六条：M-A（旗标探针退回只解构内置键）、
M-C（副本 options 整份保留）、M-D（不传只读参数）、M-E（内置定位失败记成 `global`）首轮咬住；
**M-B（拉起失败记成 `global`）首轮逃过**——我的「崩溃」腿是无输出退 137，走的是「未识别形态」分支，没碰到
`code === null / timedOut` 那一支；补一条**超时**腿（假入口挂住、`timeoutMs: 500`）后咬住。变异后源码逐字节核对已恢复。
**真实 CLI 复跑**：`install:local` 后 `doctor --only zcode --no-model-calls`，探针臂在白名单副本 + 只读参数 + 凭据键清除下
仍判 `config_copy`（请求 `bigmodel-coding-plan/GLM-5.3-Flash`，CLI 写出同值），临时目录零残留。

**两处顺手撞上的既有护栏**：① `fixture-credentials` 契约扫描把 `apiKey: ZCODE_PROBE_SENTINEL_KEY` 按「密钥赋值」形态命中
——改成计算属性键 `[PROBE_SENTINEL_FIELD]`，不给扫描器开豁免；② 集成用例的夹具里 `git diff HEAD` 为空退 65，先造一处变更再起跑。

## 四、方法记账

同一轮里写下「三键一律清掉」，却只在两条路径做了、漏了最要紧的第三条。原因不是不知道那条路径——r3 裁决里我自己写的理由
就有「旗标探针正是从本函数解构取内置路径」这句——而是改动清单按「落点函数」列，改完 `zcodeProviderEnv` 就勾掉了，
没有回头 grep 它的**所有调用方**。对策：凡改一个被多处调用的 env 构造函数，落点必须列成「函数 + 每个调用方」，不列调用方不算落地。
