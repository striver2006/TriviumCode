---
schema: trivium.disposition.v1
topic: M9-Driver旗标全链路与选侧收口
stage: code
role: claude
kind: response
run_id: 20260918T191610Z
addresses:
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-r2-codex.md
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-r2-gemini.md
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-r2-glm.md
---

# 应答与修改方案：M9-Driver旗标全链路与选侧收口（代码审 第 2 轮）

- **运行**：`20260918T191610Z` ｜ codex / gemini `request-changes`，glm `approve-with-nits`
- **共 12 条**（阻断 0 ｜ 重要 5 ｜ 次要 5 ｜ 吹毛求疵 2）
- **裁决结果**：**接受 11 条，暂缓 1 条（AGY-02），无驳回。**
- 本轮审的是上一轮 13 条裁决落地后的新面（+1354/−84，23 个文件），三侧都是第一次看到这批代码。

---

## 0. 三条焦点的答案

### 焦点一 · 中间态硬失败会不会误伤历史主题

**方向对，文案错，而且错得有害。** 三侧同时打中同一处（CODEX-03 / AGY-01 / GLM-01），我逐条复核后确认：

那句「请修复或移除这些文件，或用 --run-id 指定一份可读的运行」给的两条路**在该状态的定义下都不成立**：

1. `--run-id` 同样走 `readRunMeta`（[cli.ts:762](src/trivium/cli.ts#L762)），而该状态的定义就是「扫到的全都读不出」，于是必然返回 `null` 并撞上更前面那条硬失败（[cli.ts:763-769](src/trivium/cli.ts#L763)）。**按构造不可实现。**
2. 「修复或移除」会撞上本仓自己的提交锚：`run-*.json` 一经 `registerRun` 即不可删（`checkRunManifests` 报 `manifest_missing`），已提交版本也不可改（`hooks.ts:321` 的 `immutableChangeReason` 逐字写着「运行清单是留痕核对的锚，改锚即可整枝绕过」）。**照做会把提交永久拦下。**

真正可用的第三条路我没写：**重跑该阶段**。`prepareRun` 会先落一份 `status: running` 的骨架，其 `run_id` 是最新的，`latestRunMeta` 取首个可读项即返回它——闸门当场恢复。我核过 `latestRunMeta` 的实现（[meta.ts:396-418](src/trivium/meta.ts#L396)），这条路确实通。

**误伤范围**：glm 用只读脚本实测归档全部 86 份运行元数据，审查阶段 81 份（28 份 v1 + 53 份 v2）按两份契约逐份核对零缺失；codex 独立实测同样得出 plan/bug/code 三阶段 `unreadable` 全为空。**今天没有任何历史主题会落入该态**——所以这是潜伏面不是现行失效。但两侧都指出触发条件不假想：本仓把 schema 收严当常规动作，一旦某阶段历史留痕集体失校，该主题三条子命令会一起锁死，而彼时用户手上没有任何合法自救手段。

### 焦点二 · EV-66 的反向断言处置是否成立

**处置成立，但我把边界记错了一格。**

glm 支持推后（「其修法按改动同步清单波及 gate 解析与三份 skill 模板，不在第 5 步落点表内，推后正确」），gemini 主张本步就改。我维持推后（见 AGY-02 的暂缓理由）。

但 **CODEX-04 指出了一件我和 gemini 都没看到的事**，这条比「改不改契约」重要得多：

我以为 EV-66 是「非缺省 Driver 写不出合法裁决件」。实况是**写得出来，但必须是谎报的**。「这份裁决件是谁写的」有两个独立来源：

| 来源 | 判据 |
| :-- | :-- |
| 文件名后缀 | `listStageArtifacts` 解析出 `parsed.role`，[gate.ts:152](src/trivium/gate.ts#L152) 按 `driver` 定位 |
| front-matter 的 `role` | 只过 `validateDispositionFrontMatter`，被钉成 `const: claude` |

而 `checkAdjudication` 的一致性比对（[gate.ts:185-215](src/trivium/gate.ts#L185)）里**没有 role 与 driver 那一条**——我逐行核过 `mismatches` 列表，确实只有 schema / topic / stage / kind / run_id / addresses 六项。于是：

> 文件名 `-revised-codex.md` + front-matter `role: claude` 这份**自相矛盾**的裁决件会**通过闸门，且没有任何一处会发现**。

这不是构造出来的形态：资产面今天写死的正是 `role: claude`（`disposition.md.template:4`），三份 SKILL.md 与 `templates/README.md` 也仍写 `…-revised-claude.md`。非缺省 Driver 下两条路都不成立——照资产写则定位不到、报 `missing_disposition`（失败点与 EV-66 记的那一格**根本不同**）；照代码改文件名而保留 `role: claude` 则静默通过，产出一份作者身份自相矛盾的留痕。

T-11 锁住的只是第三格（诚实写 `role: <当轮 Driver>`），而它恰好是资产面今天**不会**产出的那一格。**我的边界断言是准的，但它守的不是实际会发生的形态。**

### 焦点三 · 接线扫描判据自身的盲区

三侧给出的答案高度一致，且都先否掉了我在问题里预设的两个形态：

- **多行写法**——不会变绿，锚点的 `\s*` 覆盖（glm、gemini 均实核）。
- **既有调用点改中间变量**——不会安静变绿，锚点计数会对不上而**变红**，是 fail-closed（glm 实核）。

真正的盲区是四处，我逐条复算确认全部成立：

| # | 盲区 | 谁提 | 我的复核 |
| :-- | :-- | :-- | :-- |
| ① | `stripComments` 不剥字符串/模板字面量；`argBlockAt` 把字符串内的括号计入深度 | CODEX-02 / AGY-03 / GLM-02 | 成立。四条自测覆盖了注释与词边界，**没有一条碰过定位函数** |
| ② | 守卫 `block.length < src.length` **恒成立**，永不触发 | CODEX-02 | **成立，这是我写的真 bug**：兜底路径返回 `src.slice(from)`，长度恰为 `src.length - from`，而 `from > 0` 恒真 |
| ③ | 值来源判据只收紧在 `checkAdjudication` 两处，其余目标对 `driver: DEFAULT_DRIVER`（形对值错）照样绿 | CODEX-01 / GLM-02 | 成立。上一轮 CODEX-05 我只修了闸门那一处，同类缺口原样留着 |
| ④ | 枚举是封闭世界：新增调用点（新文件、或传预构造对象）不改变任何计数，全绿放行 | GLM-02 | 成立 |

②尤其讽刺：那条守卫的断言文案写的是「定位不到实参块——扫描写错了会让本条永绿」，而它**自己就是永绿的**。

---

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-03 | codex | 重要 | 接受 | 两条自救路按构造都走不通，已逐条复核：`--run-id` 同走 `readRunMeta` 必然落到前一条硬失败；「移除文件」撞 `checkRunManifests` 的提交锚。真正可用的「重跑该阶段」我没写。且该分支全仓零测试覆盖。 | **L1**：[cli.ts:787-794](src/trivium/cli.ts#L787) 文案按 `scan.unreadable.length === scan.scanned` 分档——全不可读时删掉 `--run-id` 那句，改写为「重跑该阶段即可落一份新的可读留痕并恢复闸门」，并写明「不要删改 `run-*.json`，那会触发提交锚」。**L2**：`test/integration/gate-loop.test.ts` 新增 T-12 覆盖这一格（含「`--run-id` 走不通」这一点）。 |
| AGY-01 | gemini | 重要 | 接受 | 与 CODEX-03、GLM-01 同源，问题陈述成立（伪逃生门 + 与留痕不可变纪律相抵）。**但其建议不采纳**：给 `cmdGate` 加 `--driver` / `--force` 覆盖旗标，正是本批改动要消灭的形态——`cmdGate` 不加 `--driver` 是本步显式立的原则（事实来源是留痕不是旗标，与「事实来源是 `critics_selected` 不是键集」同源）。开这个口子等于允许人工声明一个与留痕不符的 Driver，闸门就失去了它唯一的事实锚。 | 落点合并到 **L1** / **L2**；不新增旗标。理由写进 L1 的注释，避免下一个读到这条意见的人再提一次。 |
| GLM-01 | glm | 次要 | 接受 | 与 CODEX-03 同源，问题部分落点同上。其第②条建议（把「契约演进不得锁死老主题」从纪律换成机制）单独接受：本仓已有「靠记性的纪律换成不依赖记性的机制」的口径，而今天这条只有 `driver_enabled` 一个字段的回归锁，覆盖面远不够。 | 问题部分合并到 **L1**。**L11**：`test/unit/run-meta.test.ts` 新增对 `.reviews/` 真实语料的回归用例——plan / code / bug 三阶段（即 `latestRunMeta` 的论域）全部 `run-*.json` 必须能被当前 `readRunMeta` 读回，任何未来收紧在合入当场红。verify 阶段排除在外（不在该函数论域，且归档里已知有一份 v1 形状记录缺 7 个字段）。 |
| CODEX-04 | codex | 重要 | 接受 | 三处独立核实全部成立：`checkAdjudication` 的 `mismatches` 列表里确实没有 role 与 driver 的比对；`disposition.md.template:4` 确实写死 `role: claude`；三份 SKILL 与 `templates/README.md` 确实仍写 `-revised-claude.md`。**「谎报件静默通过」比 EV-66 原本记的那一格严重得多**，而且它不需要改契约就能堵上。 | **L3**：[gate.ts:185-215](src/trivium/gate.ts#L185) 的 `mismatches` 补一条 `fm.role !== driver` 的比对——不改契约、今天就能落，把谎报件当场判红。**L4**：T-11 的边界断言由一格扩成两格（诚实件因 schema 失败 / 谎报件因新判据失败），两格都写明「修好时该改成什么」。**L5**：`BACKLOG.md` EV-66 描述改准（失败点不是「写不出来」而是「三条路各自失败在不同的地方」），并列全资产面清单：`disposition.v1.json`、两份模板、三份 SKILL.md、`templates/README.md`。 |
| AGY-02 | gemini | 重要 | 暂缓 | 问题成立——非缺省 Driver 的闸门闭环确实断在最后一米，「全链路」在这一米名不副实，我在收口叙述里已如实写明且不会宣称闭环已通。**但修法不在本步落地**，三条理由：①三侧里 glm 明确支持推后、codex 的建议给的是「补 role 比对**不改契约**」这条同款路径，2/3 倾向一致；②gemini 拿 `run.v2.json` 的改动作类比不成立——那是**加一个可选字段**（不进 `required`、不加 enum、专为历史留痕读得回而设计），而把 `role` 从 `const` 放宽成 `string` 是**松一条既有约束**，必须同时补注册表身份校验否则契约净变弱，风险等级不同；③改动同步面波及 `gate.ts` 解析、两份模板、三份 SKILL.md 与 `templates/README.md`，本步已经 23 个文件。**本步以 L3 把失败从「静默通过谎报件」变成「显式阻断」——这比现状更接近正确，且不会让第 6 步验收撞上没人提过的失败点。** | 不在本步改 `disposition.v1.json`。**L5** 把 EV-66 改写为可执行的登记：修法（`role` 改 `string` + `validateDispositionFrontMatter` 补注册表身份校验，与 `run.v2` 同源处理）、全资产面同步清单、触发条件钉死「**M9 第 6 步验收之前**」。 |
| CODEX-05 | codex | 重要 | 接受 | 实核成立且是我的台账失实：`collectModelOverrides`（[cli.ts:311](src/trivium/cli.ts#L311)）论域是 `CRITICS`（启用全集，四家都在内），而下游 `checkModelSlugs` 只遍历入选侧——`review --start --critics gemini --model-glm X` 与 `--model-claude X` 在这条路上**仍是解析成功后被悄悄丢弃**，正是 EV-53 原文的症状。我把 EV-53 标 done，但收口只落在 `topic resolve` 一个入口。按本仓「留痕里的失实断言先改再提交」的口径，这条必须本步修。 | **L6**：`cmdReview` 在 `sides` 解析之后对 `modelOverrides` 的键做一次 `selectableCritics` 校验（判据现成，本步刚把 `driver` 接进 `cli.ts`）；`BACKLOG.md` 的 EV-53 落地记要改成「两个入口都收口」。配一条负例用例（`--critics gemini --model-glm X` 退 64 且文案列出本轮可选侧）。 |
| CODEX-01 | codex | 次要 | 接受 | 成立。`hasProperty` 是词边界匹配，`driver: DEFAULT_DRIVER` 里键名 `driver` 照样命中——**正是要防的「形对值错」那一格**。上一轮 CODEX-05 被接受后我只在 `checkAdjudication` 一处升级成「取值来自 `gateDriver`」，同类缺口在其余目标原样留着，而 plan §10 的变异表也只写了「删实参」，所以这一格从未被真正变异验证。 | **L9**：给 TARGETS 族补「取值形态」约束——实参块内出现 `DEFAULT_DRIVER` 即判红，或要求出现 `driver` / `opts.driver` / `gateDriver` 之一；无法收紧的目标在条目里注明「本点只证在场、不证取值」，让边界可读。变异表同步补「值替换」一类。 |
| GLM-02 | glm | 次要 | 接受 | 三条子项全部成立，且它先否掉了我预设的两个形态（多行、既有调用点改中间变量）——后者是 fail-closed，这个回答本身有价值。①字符串不剥②封闭世界③值来源只覆盖 2/13 处。②尤其重要：新增调用点在当前判据下完全不可见，而那正是「实参经中间变量转手」会在新增侧发生的形态。 | ①合并到 **L8**；③合并到 **L9**。**L10**：给每个被扫函数加「全局调用计数对账」——`src/` 内该函数名出现总数 == 各 TARGET 计数之和 + 声明处，把「新增调用点」从不可见变成当场红（与 `deny-matrix` 的「唯一调用计数」骨架同族，论域升到全 `src`）。 |
| AGY-03 | gemini | 次要 | 接受 | 成立，与 GLM-02① 同源并补了两个具体形态：同名右值遮蔽（`driver_enabled: isEnabled(driver)`）与位置参数前置（`locateSubject(ref, pathFor(driver), root)`）——在词边界判据下都会误判为「传了」。 | **L8**：`stripComments` 之后、`hasProperty` 之前，把 `'…'` / `"…"` / 反引号模板内容替换为占位符；并给四条自测补字符串形态（如 `warn('driver 未传')` 不得满足判据）。属性位收紧与位置实参槽位计数并入 **L9**。 |
| CODEX-02 | codex | 次要 | 接受 | **这条是我写的真 bug，已复算确认**：`argBlockAt` 兜底返回 `src.slice(from)`，长度恰为 `src.length - from`，而锚点匹配位置 `from > 0` 恒真，所以守卫 `block.length < src.length` **永远成立**——它想抓的失效形态恰好是它唯一抓不到的。而断言文案写的还是「扫描写错了会让本条永绿」。三条约束里唯一没被自测覆盖的就是定位函数。 | **L7**：`argBlockAt` 在括号未闭合时返回 `null`（不回落成 `slice(from)`），调用方拿到 `null` 即判红；守卫换成能真正触发的判据（块必须以 `)` 收尾）；补一条定位函数的自测，含「块内有未配对括号」与「块正常闭合」两格。 |
| GLM-03 | glm | 吹毛求疵 | 接受 | 成立且风险已经是活的：[driver-flag.test.ts:59-61](test/integration/driver-flag.test.ts#L59) 用 `out.slice(out.indexOf('当前可用'))` 无前置断言——锚点漂移则 `indexOf` 返回 −1、`slice(-1)` 只剩一个字符，负例静默恒过。而文案**已经分叉**：`critics.ts` 四处写「当前可用」，`topic-args.ts:514` 本步新写的是「本轮可用」。 | **L12**：断言锚点命中在前（`assert.ok(out.includes('当前可用'))` 再截取）；同时把两层文案统一（倾向都用「当前可用」，`critics.ts` 是四处旧文案的所在，改 `topic-args.ts` 一处代价最小），并在 `topic-args.ts` 该处注明为什么与 `critics.ts` 同词。 |
| CODEX-06 | codex | 吹毛求疵 | 接受 | 成立。给了 `--run-id` 时 `rerunIndex` 恰恰来自那份被钉住的留痕，而 [cli.ts:857-859](src/trivium/cli.ts#L857) 的文案仍说「轮次取自最新一次运行……可用 `--run-id` 指定更早的完整轮次」，与事实相反，会把排障者推去用已经用过的旗标。 | **L13**：该文案按 `pinnedId` 是否为空分两句——为空时保留现文案，非空时改成「轮次取自 `--run-id` 指定的运行 `<id>`」。 |

---

## 2. 落点汇总（审批后按此实施）

| 落点 | 文件 | 内容 | 对应意见 |
| :-- | :-- | :-- | :-- |
| L1 | `src/trivium/cli.ts` | 三态硬失败文案按「是否全不可读」分档，给出真正可用的出口，写明提交锚 | CODEX-03 / AGY-01 / GLM-01 |
| L2 | `test/integration/gate-loop.test.ts` | 新增 T-12：全不可读这一格（含 `--run-id` 走不通） | CODEX-03 |
| L3 | `src/trivium/gate.ts` | `checkAdjudication` 补 `role` 与 `driver` 一致性比对 | CODEX-04 |
| L4 | `test/integration/gate-loop.test.ts` | T-11 边界断言扩成两格（诚实件 / 谎报件） | CODEX-04 |
| L5 | `doc/08_project/BACKLOG.md` | EV-66 描述改准 + 全资产面同步清单 + 触发条件钉死第 6 步验收之前 | CODEX-04 / AGY-02 |
| L6 | `src/trivium/cli.ts` + `BACKLOG.md` | `review --start` 补 `--model-<id>` 键的 `selectableCritics` 校验；EV-53 记要改准 | CODEX-05 |
| L7 | `test/unit/driver-wiring.test.ts` | `argBlockAt` fail-closed + 守卫可触发 + 定位函数自测 | CODEX-02 |
| L8 | `test/unit/driver-wiring.test.ts` | 剥字符串与模板字面量 + 对应自测 | AGY-03 / GLM-02① |
| L9 | `test/unit/driver-wiring.test.ts` | 值来源约束（`DEFAULT_DRIVER` 即判红）+ 边界注明 | CODEX-01 / GLM-02③ |
| L10 | `test/unit/driver-wiring.test.ts` | 全局调用计数对账，新增调用点当场显形 | GLM-02② |
| L11 | `test/unit/run-meta.test.ts` | `.reviews/` 真实语料回归：plan/code/bug 全部留痕必须读得回 | GLM-01② |
| L12 | `test/integration/driver-flag.test.ts` + `src/trivium/topic-args.ts` | 锚点前置断言 + 两层文案统一 | GLM-03 |
| L13 | `src/trivium/cli.ts` | `--check-artifacts` 缺件文案按 `--run-id` 分两句 | CODEX-06 |

**变异验证**（每条都该当场红）：

- 把 L1 的文案改回「或用 `--run-id` 指定一份可读的运行」→ T-12 红
- 删 L3 的 `role` 比对 → T-11 的谎报件那一格红
- 把任一 TARGET 的实参改成 `driver: DEFAULT_DRIVER` → L9 红（今天只有闸门两处会红）
- 在 `src/` 新增一个不传 driver 的 `newRunMeta` 调用点 → L10 红（今天全绿）
- 构造一个块内含未配对 `(` 的调用点 → L7 红（今天守卫恒不触发）
- 把 `topic-args.ts` 的「当前可用」改回「本轮可用」而不同步用例 → L12 红

---

## 3. 本轮三侧确认正确的部分（不改动）

三侧独立核过并一致认可、本轮不再调整的落点：

- **直读留痕取代后缀反推**：`latestRunMeta` 消除循环依赖，`cmdGate` 不加 `--driver`（事实来源是留痕不是旗标）——方向与落点均成立。
- **排序依据**：codex 在真实归档上核过 86/86 全部匹配 `^[0-9]{8}T[0-9]{6}Z$`，字典序即时序**按构造成立**，plan §11 第 1 问结案。
- **`driver_enabled` 可选、不进 `required`、不加 `if/then`**，并配「删字段仍须读得回」的回归锁——本步唯一不可逆选择，三侧均判为正确处理。
- **`isReviewArtifact`**：四类失败一律坍缩为「不是审查件」（放行不误拒）、显式路径硬拒 / 自动候选过滤的不对称、不复用 `freeze.ts` 三值 fail-closed 版的理由——codex 逐条核过成立，EV-63 的残余风险登记准确。
- **`driver` 在 `prepareRun` 一处解析、随骨架落盘**，交接文件用「类型必填 + 运行期 `handoffDriver` 回落并告警」两层防线——codex 判为「本步做得最干净的接线」。
- **`selectableCritics` 单点派生**（白名单、`legalList`、选侧排除三处合一）与 **`overrideReasonFor` 双写点闭环**——三侧均核实成立。
- **把判据写成可执行代码并配自测**这一做法本身，以及 T-11 用运行期用例补源码扫描语义盲区的取向——三侧均判为正确，本轮的意见都是加固而非推翻。

---

## 4. 本轮核验降级说明

编排器记录了三条降级，如实转述：

- **codex 侧只读核验不可用**：该侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守，只读保障从三重降到两重（指纹比对仍有效）。
- **codex 侧路径核验无结构化输入**：读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b 承担（已知形态必检，非完备）。
- **gemini / glm 侧 `consulted` 无法与工具轨迹交叉核对**。
- 另有 codex 侧 `evidence` 引用了两份未列入 `consulted` 的构建产物（`test/src/trivium/meta.js`、`test/test/unit/driver-wiring.test.js`）——那是它实跑 `dist/` 产物做复算时读的，与结论一致，不影响采信。

codex 侧还报告：本环境文件系统只读，`mkdtemp` 被拒，因此 T-11 / driver-flag 等集成用例与 EV-65 parity 用例它跑不起来（实跑 `driver-wiring.test.js` 得 17 通过 / 1 因沙箱失败）。**CODEX-04 的「谎报件会通过」那一格是静态核对得出，未实跑**——我在 L4 落地时会用真实用例验一次，如果实跑结果与静态推导不符，会在下一轮如实说明。
