---
schema: trivium.disposition.v1
topic: zcode-模型覆盖落点
stage: code
role: claude
kind: response
run_id: 20260921T132440Z
addresses:
  - 2026-09-21-zcode-模型覆盖落点-r2-codex.md
  - 2026-09-21-zcode-模型覆盖落点-r2-gemini.md
---

# 代码双审 r2 应答：zcode-模型覆盖落点（EV-82）

**9 条意见（codex 6 ｜ gemini 3），全部接受，零驳回、零暂缓**（CODEX-02 接受问题与措辞修法，其「两臂区分」机制不采纳，理由在表内）。
两侧本轮都结构化产出；codex `request-changes`（1 major），gemini `approve-with-nits`。

**两侧独立收敛在同一处**（CODEX-04 ≡ AGY-01）：`probeZcode` 给探针臂接线那一行没有任何用例——正是我写进焦点第四点的软处，
两侧都判它是缺口而不是可接受的边界。

**最重的一条是 CODEX-01（已复核属实）**：`preflight.test.ts` 那条「`--no-model-calls` 保留上一次 zcode 结论」的回归用例传的是
`null` 入口，`probeZcodeEntry` 会回落到 `ENTRY_CANDIDATES` 的绝对路径——本机装了 ZCode.app，于是这条**单元**用例真实拉起
七次旗标探针加本轮新增的探针臂、读真实用户配置；断言 `model_override === 'config_copy'` 此前靠写死值恒绿，现在靠**本机 CLI 现势
恰好同值**——「保留旧值」的语义在本机根本没被测到，而桌面端一旦弄坏 CLI（EV-87 记的那类事故），用例无代码改动即翻红。
这是我把探针臂实测化时没想到的连带：**一个原本因写死而恒真的断言，实测化之后变成了环境耦合**。

---

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | **已复核属实**：`preflight.test.ts:405-423` 传 `null` 入口，`probeZcodeEntry(null, node)` 仍遍历 `ENTRY_CANDIDATES`（首个是 `/Applications/...` 绝对路径），本机存在 → 真实拉起版本探针 + 七次旗标 + 探针臂（读真实 `~/.zcode/cli/config.json`）；`existing.model_override` 恰为 `'config_copy'`，与实测结果同值，「未判定 ⇒ 保留旧值」的语义没被测到，探针合法判出 `global` 时该用例会翻红。CI 上入口不存在则早退、断言靠 existing 恒真——两台机器测的是两件事 | `probeZcode` 的 `opts` 增两个**测试注入口**：`cliConfigPath?: string`（默认 `ZCODE_CLI_CONFIG`，同时喂 `cliConfigured` 判定与探针臂）与 `modelOverrideProbe?: typeof probeModelOverride`（默认真实臂）。该回归用例注入「恒返回 `null`」的桩臂，`existing.model_override` 改为臂永远不会产出的 `'env'`，断言保留 `'env'`——假绿即现形。旗标探针七次真实拉起是既病、本轮不动（零配额、P-30 前提有守卫），登记 EV-94 |
| CODEX-02 | codex | minor | 接受（措辞修法采纳；「两臂区分」机制不采纳） | **问题成立**：探针臂输入是白名单重建、审查运行是整份拷贝，两者不同形；「无 v2 + 停在模型层 ⇒ `global` + ⚠️『请核对 ZCode 版本』」把探针自身可能的裁剪失误归因给 CLI，与 r1 子项 03 我自己写的「缺键只是可见的导入不成」相抵——可见，但以对本轮装置失败下断言的形式可见。**机制不采纳的理由**：包内 `Oqa`（`importLegacyCliPersonalProviderConfig`）对 custom provider 读的是 `name` / `source` / `kind`（→`Dqa` api 类型）/ `options.apiKey`（`Fqa` 无鉴权时抛）/ `models`（`Nqa`）/ `options.headers`（`Lqa` 合并，可缺）——白名单 ⊇ 导入器**必需**键，被裁掉的 `headers` 等都是可缺项；导入不成只可能来自 `Fqa` 抛错（无 apiKey）或 models 为空，而这两者在整份拷贝下同样不成。补第二臂是为一个论证上不存在的形态付一次拉起 | ① `why` 与 ⚠️ 文案改为**不承诺 CLI 行为**：「白名单重建的副本未触发 legacy 导入——可能是 CLI 改了流程，也可能是探针裁剪掉了导入需要的键；请先核对 `buildProbeCliConfig` 的白名单是否仍 ⊇ 导入器必需键」；② `buildProbeCliConfig` 注释写明上述必需键清单及其出处（`Oqa` / `Nqa` / `Fqa` / `Dqa`），并注明「同形第二臂」是可选后续（登记进 EV-94） |
| CODEX-03 | codex | minor | 接受 | 属实：探针臂用 `observed === q.qualified` 整串等式，run() 侧刚裁决「判据只看 modelId 段」。在配置层整串等式**其实合法**（写出的 providerId 来自副本 `model.main` 自己的切分，必与副本源同形）——但两份判据并存且无说明，doctor 结论与留痕可能互相矛盾，而探针臂正是 EV-82 结案判据引用的证据来源。单一口径便宜且无害 | 探针臂比对改用 `zcodeModelTail`：modelId 段相等 ⇒ `config_copy`，providerId 形态差落 `why` 当 note；用例补一腿「写出 UUID 前缀 + 请求的 modelId」⇒ `config_copy` |
| CODEX-04 | codex | minor | 接受 | **焦点第四点的直接回答，与 AGY-01 独立收敛**：接线行（传 `readonlyArgs`、`null` 时不覆盖、`global` 时出 ⚠️）无用例；探针臂用例全部直接 import 臂函数显式传参；`probeZcode` 唯一的用例（preflight 那条）在 CI 早退、在本机则退化为环境耦合执行。删掉接线里的 `readonlyArgs`，1557 条照绿 | 借 CODEX-01 的注入口：桩臂记录收到的 `readonlyArgs`，用例用 `zcode-provider-env` 的假入口布局跑 `probeZcode(fakeEntry, node, { cliConfigPath: 合成文件, modelOverrideProbe: 桩 })`，断言 ① 桩收到 `readonlyArgsFromProbe(probe.readonly_flags)` 的等价 argv；② 桩返回 `null` 时 `probe.model_override` 保留 existing；③ 桩返回 `global` 时 notes 含 ⚠️ 且结论写 `global` |
| CODEX-05 | codex | nit | 接受 | 属实：version 探针用例标题写「七个键」，实际只预置并断言四项；`ZCODE_HOME` / `ZCODE_STORAGE_DIR` / `ZCODE_BASE_URL` 三键在两条探针用例里都没覆盖，调用点漏清其中一个不会翻红——正是 r1 抓的「整包 spread 改回手拼」变异形态 | 假入口日志补 `zhome` / `storage` / `baseUrl` 三字段；两条探针用例的预置表按 `ZCODE_DIR_ENV_KEYS` + `ZCODE_CREDENTIAL_ENV_KEYS` **全量派生**并逐键断言 |
| CODEX-06 | codex | nit | 接受 | 属实：r3 裁决件 §五曾预留「EV-92 旗标探针改用三态参数（纯重构）」，随后 AGY-r2-02 把三态改成布尔开关，该项消失，编号没登记也没注销——台账跳号无注 | BACKLOG 在 EV-91 后补一行 `EV-92 已撤销`：预留给「旗标探针改用三态参数」，r3 AGY-r2-02 改布尔开关后该项不存在；本轮 EV-94 登记「旗标探针七次真实拉起 + 探针臂可选同形第二臂」 |
| AGY-01 | gemini | minor | 接受 | 与 CODEX-04 同一缺陷，独立收敛；本条另核实 preflight 那条用例「传入 entry 为 null，直接在行 601 返回」——**只在没装 ZCode.app 的机器上成立**，本机会回落到绝对路径候选并真跑（见 CODEX-01）。两侧各看到了同一个用例的一半 | 同 CODEX-04 |
| AGY-02 | gemini | minor | 接受 | 属实：集成层只锁了「桩侧缺席」，`true` / `false` / `null` 三态经 `review.ts` 落盘并过 `run.v2.json` schema 校验这条链没有端到端用例；`review.ts:1444` 键名手误现有用例抓不到 | `StubSpec` 增可选 `modelOverrideApplied?: boolean \| null`，桩结果按 `CriticResult` 同样条件展开；`code-stage` 集成用例增一格：注入 `{"glm":{"mode":"ok","modelOverrideApplied":false}}`，断言 run.json 该侧字段为 `false`、schema 校验通过、且 guard 告警里出现「请求的模型没有生效」 |
| AGY-03 | gemini | nit | 接受 | 属实：`run()` 正格两腿的请求与回读前缀相同，run() 内部若误用整串判等照样绿——`decideModelOverride` 的单测覆盖了 UUID 前缀，端到端没有 | `runWithFakeEntry` 正格增一腿：日志 `context.model = '84044858-fake/GLM-5.3-Flash'` ⇒ `model_override_applied === true` 且 trace.json 的 `modelSelection.note` 记录 providerId 形态差 |

---

## 二、修改方案（**审批通过后执行**）

### 2.1 `src/trivium/probes/zcode.ts`

1. `probeZcode` 的 `opts` 增 `cliConfigPath?: string` 与 `modelOverrideProbe?: (…) => Promise<ModelOverrideProbe>`；
   `cliConfigured` 改判 `opts.cliConfigPath ?? ZCODE_CLI_CONFIG`；探针臂调用改走 `opts.modelOverrideProbe ?? probeModelOverride`，
   并把 `cliConfigPath` 透传（CODEX-01 / CODEX-04 / AGY-01）。
2. 探针臂比对改 `zcodeModelTail`，providerId 差落 `why`（CODEX-03）。
3. 「无 v2 + 停在模型层」支的 `why` 与 `probeZcode` 的 ⚠️ 文案改为不承诺 CLI 行为（CODEX-02）；
   `buildProbeCliConfig` 注释补导入器必需键清单及出处。

### 2.2 `src/trivium/adapters/stub.ts`

`StubSpec.modelOverrideApplied?: boolean | null`，结果按条件展开产出（AGY-02）。

### 2.3 用例

- `preflight.test.ts` 回归用例：注入桩臂（恒 `null`）+ `existing.model_override = 'env'`，断言保留（CODEX-01）。
- `zcode-provider-env.test.ts`：假入口日志补三字段；两条探针用例预置表按两组常量全量派生（CODEX-05）；
  新增 `probeZcode` 接线用例三腿（CODEX-04 / AGY-01）。
- `zcode-model-selection.test.ts`：探针臂 UUID 前缀 ⇒ `config_copy` 一腿（CODEX-03）；`run()` 正格异形前缀一腿（AGY-03）。
- `code-stage.test.ts`：桩注入 `modelOverrideApplied: false` 的正向落盘 + guard 告警一格（AGY-02）。
- 变异：接线删 `readonlyArgs`、接线改无条件覆盖、探针臂改回整串等式、桩不展开字段——各一条。

### 2.4 留痕

BACKLOG 补 `EV-92 已撤销` 行与 `EV-94`；设计 §21 v1.3.33 行补「代码双审 r2 落地」段。

---

## 四、实施记录（2026-09-21，审批通过后执行）

| 落点 | 状态 |
| :--- | :--- |
| CODEX-01：`probeZcode` 增 `cliConfigPath` / `modelOverrideProbe` 注入口；preflight 回归用例注入恒 `null` 桩臂、`existing.model_override = 'env'` | ✅ 保留语义被真测到（变异 MR-B 咬住两条用例） |
| CODEX-04 ≡ AGY-01：接线三腿（只读参数透传 + `cliConfigPath` 透传 / `null` 不覆盖不出 ⚠️ / `global` 写结论出 ⚠️） | ✅ `zcode-provider-env.test.ts` 用假入口布局跑 `probeZcode` 真实路径，桩臂记录收到的参数 |
| CODEX-02：`why` 与 ⚠️ 文案不承诺 CLI 行为；`buildProbeCliConfig` 注释补导入器必需键清单（`Oqa` / `Nqa` / `Fqa` / `Dqa` / `Lqa`）；同形第二臂登记 EV-94 | ✅ |
| CODEX-03：探针臂比对改 `zcodeModelTail`，providerId 形态差落 `why` | ✅ UUID 前缀腿 ⇒ `config_copy`（变异 MR-C 咬住） |
| CODEX-05：假入口日志补 `zhome` / `storage` / `baseUrlEnv`；两条探针用例预置表按 `ZCODE_DIR_ENV_KEYS + ZCODE_CREDENTIAL_ENV_KEYS + 两个 provider 键` 全量派生、逐键断言（旗标探针的内置键断言「被派生路径覆盖」而非「被删」） | ✅（变异 MR-E 咬住） |
| CODEX-06：BACKLOG 补 `EV-92 已撤销` 行与 `EV-94` | ✅ |
| AGY-02：`StubSpec.modelOverrideApplied`，桩按同一条件展开；`code-stage` 集成增一格——glm 侧注入 `false` 落盘、gemini 侧缺席、`--wait --json` 终态 `message` 含「没有生效」 | ✅（变异 MR-D 咬住）。guard 播报走 `ReviewOutcome.warnings` → `status.json.message`，文本模式的 `--wait` 输出里没有，改用 JSON 终态查询断言 |
| AGY-03：`run()` 正格增异形前缀腿（回读 `84044858-fake/GLM-5.3-Flash` ⇒ `true`，trace.json 记形态差） | ✅ |

**验证**：`npm run check` 1563 / 1561 pass / 0 fail / 2 skipped。变异五条全部咬住：MR-A 接线丢只读参数、MR-B 接线无条件覆盖、
MR-C 探针臂整串等式、MR-D 桩不展开字段、MR-E version 探针漏清键。变异后源码逐字节核对已恢复。
**真实 CLI 复跑**：`install:local` 后 `doctor --only zcode --no-model-calls`，探针臂仍判 `config_copy`（请求与写出同值），临时目录零残留。

**如实记一条残量**：preflight 那条回归用例在本机仍要 6.5 秒——旗标探针的七次真实拉起与入口候选回落没有被本轮的注入口隔开
（既病，EV-94 ①）；本轮只把探针臂隔开了，`model_override` 的断言不再环境耦合。

## 三、方法记账

CODEX-01 的形态值得单独记：**把一个探针字段从写死改成实测，会让所有依赖该字段旧值的断言从「恒真」变成「环境耦合」**。
我实测化时只想着「让字段说真话」，没回头看谁在断言它——而那条断言的 existing 值恰与真实结果同值，本机全绿掩盖了它。
对策与 r1 的记账同源：改一个产出点，落点要列成「产出点 + 每个消费方（含用例）」。
