---
schema: trivium.disposition.v1
topic: zcode-模型覆盖落点
stage: plan
role: claude
kind: revised
run_id: 20260921T095827Z
addresses:
  - 2026-09-21-zcode-模型覆盖落点-codex.md
  - 2026-09-21-zcode-模型覆盖落点-gemini.md
---

# 裁决与修订计划：zcode-模型覆盖落点（EV-82）

**13 条意见（codex 7 ｜ gemini 6），全部接受，零驳回、零暂缓。**
两侧独立收敛到**四处**：D-3 成对门控、比对公式在无请求模型时误判、`splitZcodeModel` 无 `/` 防空、
`run.v2.json` 的 `model_route` 枚举。

本轮最重的是 **CODEX-01 ≡ AGY-01**，它打掉的不是一处笔误，而是我**自己制造的一条回归**：
原稿 §三 D-3 依据包内 `resolveNodeProviderRuntimePaths` 的抛错字面，要把 `zcodeProviderEnv`
改成「两份都在才注入」。我读了那个函数体，**没有核它的调用点**，也**没有回头核仓内已有的实测**——
而 `probes/zcode.ts` 的注释白纸黑字写着「只给内置那份则停在『Model creation failed』，
**参数解析已经做完**，正是这里要的停点」（P-30）。那是对我这条前提的直接反证，就在我本轮要改的文件里。
更糟的是它的耦合面：`probeReadonlyFlags` 的内置路径**正是从 `zcodeProviderEnv(entry)` 解构取的**，
而我的 §四 改动清单**没有列这个注入点**——成对门控会让个人配置缺失的机器上内置也不注入，
七个候选全退化成 `indeterminate`，零配额前提同时受损。

这与我记忆里「别把断言的适用范围悄悄扩大」是同一形态：我把一条**只在 Worker 启动路径成立**的
包内字面，当成了对所有调用路径成立的契约，并据此去改一个 fail-closed 的门控。

---

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | **已复核属实**：`probes/zcode.ts` 的 `probeReadonlyFlags` 从 `zcodeProviderEnv(entry)` 解构取内置路径、把个人那份显式置 `undefined`，且其注释记着 P-30 实测「只给内置那份 → 停在 Model creation failed，**参数解析已经做完**」。这是对 B-3「只给一个必抛错」在 headless `--prompt` 路径上的直接反证；codex 另核到该抛错的唯一调用点在 Worker 启动路径。D-3 声称要防的「内置不在」组合在 `run()` 路径上还被 `availability()` 的 `builtin_file === null` 先挡住，不可达。**撤回 D-3** | 新 §三 D-3 整段改为「维持现有逐键门控」；B-3 改准（见 §二 B-3）；新登记待实测项「成对抛错是否触达 headless 路径」（可用假入口夹具零配额验证） |
| CODEX-02 | codex | major | 接受 | 严格字符串等式与 P-31 亲记的「`bigmodel-coding-plan/…` 与 `<providerUUID>/…` 两形态并存」相抵。已复核 `parseZcodeTrace`：`modelEffective` 取自日志 `context.model`，**形态由 CLI 决定**，我们无法保证它与写入的拼接形态同形。等式判 false 会把已生效的覆盖误报成未生效——而本轮买的正是「响亮」，假阴性会直接污染播报可信度 | 新 §三 E 的比对口径改为分层：`modelId` 段等值为**判据**，`providerId` 段形态差**只记 note 不判 false**；§6.2.3 增显式观察项「本机回读形态与写入形态是否同形」 |
| CODEX-03 | codex | minor | 接受 | 「编排器不再有任何路径能写到用户的个人配置」是过度声明，我自己的 §三 D 表第三行就写着「探活走真实 HOME」——`authProbe` 与 `probeZcode` 仍以默认参数把个人变量指向用户真实文件，而 B-7 的结论正是「CLI 会写它被指向的那份」。这句会被回填进设计 §3.3，写重了会误导后续对敏感面的判断 | §二 B-7 引注与 §三 B 表「凭据面变化」行都限定为「**审查运行路径**的写入面 1→0」；新登记「探活/探针的个人配置是否也应指一次性副本」 |
| CODEX-04 | codex | minor | 接受 | 与 AGY-02 同一缺陷。§E 的可实施判据 `modelEffective === qualified` 没有「`qualified` 为 null 时不比对」的门，而 §E 的 null 语义本意覆盖该情形——**语义定义与作答规则在我自己的文本里就冲突了** | 新 §三 E 的 zcode 作答规则首句增门：请求模型为空 → 恒 `null`（与 `route: 'global'` 同源）；§6.1 比对用例增第四格 |
| CODEX-05 | codex | minor | 接受 | `model_id_form` 缺失且请求为裸名时 `qualifyZcodeModel` 原样返回，串里没有 `/`，切不出 B-2 要求的两个非空段。§A 未写此形态的处置，§6.1 只测「切分与 qualify 同结论」测不到 `prepare` 的行为，`tsc` 也挡不住运行时形态 | 新 §三 A 增一条：切不出两个非空段 → 不写副本、`route: 'global'` 并给原因（与 A-5 同档）；§6.1 增对应用例 |
| CODEX-06 | codex | minor | 接受 | **已复核属实且是确定项**：`skills/dual-critic/schema/run.v2.json:495-501` 的 `model_route` 是封闭 enum `["env","config_copy","global"]`，不改 schema 则 `provider_config_copy` 落盘直接校验打红。原稿写成「若声明了…按实际核」是把一件已可核实的事留成了不确定项。连带的 PROTOCOL 与 SKILL.md 两处回填缺席也属实 | §四 末行改为确定改动项；§五 回填清单增 `doc/03_api/PROTOCOL_dual_critic_relay.md` 与 `skills/dual-critic/SKILL.md` |
| CODEX-07 | codex | nit | 接受 | **已复核属实**：`ZCODE_MODEL[A-Z_]*` 全集另有 `ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY` 与 `ZCODE_MODEL_REASONING_SEPARATOR`。我上一轮用的是带引号的 `"ZCODE_[A-Z_]*"` 正则，漏掉了不带引号的字面。结论不变，但 B-5 是「唯一落点」这个前提的证据，抄录必须精确 | §二 B-5 枚举补这两个，各注「非选型变量」 |
| AGY-01 | gemini | blocker | 接受 | **问题成立，但修法不采纳**（取 CODEX-01 的）。问题诊断与 CODEX-01 同一处且更早点名 `probeReadonlyFlags` 未进改动清单，成立。**但本条的修法建立在「B-3 双变量必需契约属实」之上**，而该前提已被 P-30 实测反证（见 CODEX-01）；其建议的「在临时空 HOME 下放一份合成个人配置」会给旗标探针**新增一个写入面**，为一个不存在的约束付代价。本条所述「命中 `ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE` → 全 indeterminate」在 B-3 不成立时不适用；而其后半句「成对门控下个人配置缺失的机器同样撞 P-28」**成立且正是撤回 D-3 的理由** | 同 CODEX-01：撤回 D-3、维持逐键门控。**不**给 `probeReadonlyFlags` 新增合成配置 |
| AGY-02 | gemini | major | 接受 | 与 CODEX-04 同一缺陷，本条把后果说得更实：未指定 `--model-glm` 是**常规**形态，误报会每轮出现，等于把新增的告警通道当场打成噪声 | 同 CODEX-04 |
| AGY-03 | gemini | major | 接受 | **我自己在原稿 §E 里预告的争议点，被打中了，且指出的是真缺陷**：我把 null 定义成「本侧没做这个比对」，又规定 zcode 在回读不到时也填 null——**两个原因落进同一个观测**，正是本仓反复登记的形态；语义定义与作答规则在同一段里冲突。取原稿备好的退路 + 本条建议的一半。**本条依据有一处偏差**：「Codex/Agy/Claude 不存在通过配置文件副本 override 的机制」不准——`adapters/codex.ts:215` 的 `model_route` 恒为 `config_copy`，codex 侧正是副本路由。偏差不影响结论 | 字段由**必填改可选** `model_override_applied?: boolean \| null`（随 `model_route` 的既有先例）：**只在本侧确实尝试了模型覆盖时产出**；产出而为 `null` 的唯一含义是「尝试了覆盖、没回读到生效模型」；**字段缺席**=「无覆盖尝试／本族未实现」。其余四家本轮不产出。**代价如实记账**：失去 `tsc` 逐处点名的结构保证，换回 null 语义单一 |
| AGY-04 | gemini | minor | 接受 | 与 CODEX-05 同一缺陷；本条给出的签名更完整（返回 `{providerId, modelId} \| null`，切不出就回退），直接可用 | 同 CODEX-05，签名按本条：`splitZcodeModel(model, modelIdForm): {providerId: string; modelId: string} \| null` |
| AGY-05 | gemini | minor | 接受 | 副本 HOME 下 `credentials.json` 的路径由 `homedir()` 派生（B-6），CLI 一旦在运行期写凭据就落在清扫论域内、而我只把 `provider_config.json` 列进了按名整删。按我自己在 §三 C 定的口径（已知含凭据的载体按名整删、形态未知的过扫描器），它**本就该在**那张清单上。`fs.rm({force:true})` 幂等，不存在即静默，零成本 | §三 C 的按名整删清单增 `.zcode/v2/credentials.json`；§6.1 清扫用例增该文件的夹具腿 |
| AGY-06 | gemini | nit | 接受 | 与 CODEX-06 同一处，本条另点了 `test/unit/known-forms-parity.test.ts` 的契约对账会跟着报。**一处措辞要改准**：`dist/test/skills/…/run.v2.json` 是 `npm run build` 的产物，**不手改**——写进清单会引出「手改构建产物」这个错误动作 | 同 CODEX-06；落点写 `skills/dual-critic/schema/run.v2.json` 一处，并注明 dist 副本由构建刷新；`known-forms-parity.test.ts` 进 §四 |

---

## 二、修订后的方案（只列**变了的**部分，其余以原稿为准）

### §二 B-3（改准）

> **B-3**：`resolveNodeProviderRuntimePaths` 的字面是：两个变量全不给 → 回落自推算；只给一个 →
> 抛「ZCode Built-in 与 Personal Provider Config 路径必须同时提供」。
> **但该抛错在 headless `--prompt` 路径上未被触达**：其唯一调用点在 Worker 启动路径，
> 而 P-30 实测「只给内置那份」停在 `Model creation failed` 且**参数解析已完成**，
> 上一主题 E1 同形态退 0。**故本轮不据此改动门控**（待实测项见 §九）。

### §二 B-5（补全）

枚举补 `ZCODE_MODEL_CONTEXT_BUDGET_STRATEGY`、`ZCODE_MODEL_REASONING_SEPARATOR`，
两者各注「非选型变量」。结论不变：无模型选型环境变量。

### §二 B-7 引注 / §三 B 表（限定措辞）

「**审查运行路径**上，编排器对用户真实个人配置的写入面由 1 减到 0」。
探活与探针路径仍指向真实文件——那条路径是否也该指一次性副本，**另立条目**，本轮不动。

### §三 A（增两条处置）

- **A-3 改**：`splitZcodeModel(model, modelIdForm): { providerId: string; modelId: string } | null`，
  与 `qualifyZcodeModel` 共用 `lastIndexOf('/')` 规则；**切不出两个非空段则返回 `null`**。
- **A-6 新增**：`prepareZcodePersonalConfig` 拿到 `null` 切分结果 → **不写副本**、
  `route: 'global'` 并给出原因（与 A-5 的解析失败、R-4 的 `schemaVersion` 断言同档处置）。

### §三 C（清单 +1）

按名整删的载体清单：`.zcode/cli/config.json`、`.zcode/v2/provider_config.json`、
**`.zcode/v2/credentials.json`**。三份各自计入 `deleted`，不合并计数。

### §三 D-3（**整段撤回**）

维持 `zcodeProviderEnv` 现有的**逐键存在性门控**不变。
其设计注释（r2 CODEX-01 ≡ AGY-02「宿主环境同名变量必须被清除」）与门控粒度无关，不受影响。
`probes/zcode.ts` 的 `probeReadonlyFlags` 注入形态**一并保持不动**。

### §三 E（三处改）

1. **字段改可选**：`CriticResult.model_override_applied?: boolean | null`（随 `model_route` 先例）。
   - **产出条件**：本侧确实尝试了模型覆盖（zcode 侧即 `route === 'provider_config_copy'`）。
   - `true` / `false` / `null` 的语义：一致 / 不一致 / **尝试了但没回读到生效模型**（单一含义）。
   - **字段缺席** = 无覆盖尝试，或本族未实现该比对。其余四家本轮不产出。
   - **代价记账**：放弃 `tsc` 逐处点名，换 null 语义单一。这是 AGY-03 与原稿 §E 退路的合取。
2. **无请求模型的门**：`qualified` 为 `null`（含 `req.model` 为空）→ **不比对、不产出该字段**，
   与 `route: 'global'` 同源。
3. **比对口径分层**（CODEX-02）：
   - 判据只看 `modelId` 段（回读值与写入值各取最后一个 `/` 之后的部分）；
   - `providerId` 段不同**只记 note**，不判 `false`——`bigmodel-coding-plan/…` 与
     `<providerUUID>/…` 两形态并存是 P-31 亲记的事实；
   - 回读不到 → `null`。

### §四 改动清单（三处改）

- **删**「`probes/zcode.ts` 的 providerEnv 构造点」相关考量（D-3 已撤回）；
  该文件仍在清单里，但**只改** `model_override` 的结论取值与 note 文案。
- **`skills/dual-critic/schema/run.v2.json`**：从「若…按实际核」改为**确定项**——
  `$defs.critic.properties.model_route` 的 enum 增 `provider_config_copy`，并增新的可选字段。
  `dist/` 下的副本由 `npm run build` 刷新，**不手改**。
- **增** `test/unit/known-forms-parity.test.ts`（契约对账会跟着枚举变化报）。

### §五 回填清单（增两处）

`doc/03_api/PROTOCOL_dual_critic_relay.md`、`skills/dual-critic/SKILL.md`
（动 JSON Schema 的连带义务，AGENTS.md 改动同步清单）。

### §六 验证（增四腿）

- §6.1 增：`qualified` 为 null → 不产出字段；切不出两段 → 不写副本且 `route: 'global'`；
  清扫用例增 `credentials.json` 夹具腿；比对用例第四格（无请求模型）。
- §6.2.3 增显式观察项：**本机回读形态与写入形态是否同形**（别名 ↔ UUID），
  结论如实记进 evidence，不论同形与否都不改判据去迁就。

---

## 三、新登记条目（随实施一并进 BACKLOG）

1. **成对抛错是否触达 headless 路径**——`resolveNodeProviderRuntimePaths` 的抛错在
   `--prompt` 路径上未被触达（P-30/E1 反证），但那是**观察**不是**保证**。
   可用假入口夹具零配额验证，验证前不得据此改门控。触发条件：下一次改 `zcodeProviderEnv` 的门控。
2. **探活/探针路径的个人配置仍指用户真实文件**（CODEX-03）——B-7 的回写风险在那条路径上仍在。
3. `cli/config.json` 副本的 `model.main` 写入已无读取点、该副本角色已变为凭据/provider 定义载体。
4. `probeZcodeModels` 的模型目录仍取自 `cli/config.json`，与生效落点不同源。
5. `model_override_applied` 的跨族通用化（其余三家的作答落点）——本轮按可选字段收窄，
   通用化需要先给各族定义「什么算一次覆盖尝试」。

---

## 四、我在本轮的方法失误，记账

**一次，形态明确**：我从 CLI 包内读到一条字面（`cfr` 的成对抛错），
**没核它的调用点**就当成全路径契约，**也没回头核仓内已有的实测**——而那条反证就写在
`probes/zcode.ts` 的注释里，是我本轮要改的文件之一，我在同一次会话里读过它前后的代码。
据此我在 §三 D-3 提出去改一个 fail-closed 的门控，并且 §四 的改动清单漏掉了它真正的耦合点。

**为什么值得记**：上一主题的 EV-81 修的正是「provider 配置定位」，
P-28～P-30 三条坑都是那轮亲手登记的。**我读了新的外部字面，却没有回头对账自己刚写下的实测。**
这与「留痕准确优先于提交速度」是同一条纪律的两端——那条管的是写出去的断言，
这条管的是**据以行动的前提**。

**对策（落成本计划的文本，不靠记性）**：§二 B 表今后每条包内字面都必须注明
**「哪条调用路径上验过」**；未验的路径一律标「待实测」，不得作为改动依据。B-3 已按此改写。
