---
schema: trivium.disposition.v1
topic: M9-Driver旗标全链路与选侧收口
stage: plan
role: claude
kind: revised
run_id: 20260918T154204Z
addresses:
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-codex.md
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-gemini.md
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-glm.md
---

# 裁决与修订：M9-Driver旗标全链路与选侧收口（第 1 轮）

- **运行**：`20260918T154204Z` ｜ 三侧均 `request-changes` ｜ 共 25 条（重要 12 ｜ 次要 11 ｜ 吹毛求疵 2）
- **裁决结果**：25 条**全部接受**，无驳回、无暂缓。
- **本轮最有价值的一条**：GLM-03 —— 闸门区在**M9 第 6 步**就会硬失败，不是我以为的 M10。
  它把「EV-58 可以推后」这个前提直接打穿了。

## 0. 关于 glm 侧的证据标记（必须先说）

glm 侧 `evidence_ok: false`，编排器判 `insufficient_evidence：工具调用 0 次 < 下限 5`，
渲染头也打了「本侧不得计为合格双审的一半」。**我不按这个标记降低对它的采信，理由如下，也如实记下风险**：

- 它的 `project_reads` 是 29，而 `read/grep/glob/run_command` 全为 0 —— 这是**轨迹采集的分叉**，
  不是「没读」。zcode 侧此前也出现过同类形态。
- 我**逐条回原文核了它的三条载重断言**（GLM-03 的 `gate.ts:151-153` + `cli.ts:801/876`、
  GLM-09 的 `review.ts:1065-1069`、GLM-08 的 `verify.ts:216`），**三条全部属实**，
  且 GLM-09、GLM-08 指出的是**我自己计划里的失实**——臆测不会精确命中这种东西。
- **风险如实记**：本轮 plan 阶段的三侧独立性，严格说只有 codex 与 gemini 两侧带完整轨迹证据。
  glm 的意见我按「已由我本人复核」采信，而不是按「第三侧独立审查」采信。
  → 新登记 **EV-60**（见 §4），把 zcode 侧 `project_reads > 0` 而工具计数全 0 的形态查清楚。

codex 侧另有三条降级（`consulted` 无法交叉核对、只读核验不可用、路径核验无结构化输入），
均为该侧 CLI 能力所限，指纹比对仍有效，不影响本轮意见采信。

---

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | 重要 | 接受 | 属实且我自己早前就读到过那段注释却没意识到后果：`review.ts:670` 的「下面 `driver` 字段的注释记的就是第一次」**就在 freeze 实参块内**，裸词断言今天即绿；而 §5.5 我写的落地形态是简写 `driver,`，`includes('driver:')` 又会对着它红。三侧独立同构（AGY-01、GLM-02） | §4.2 T-3 钉死判据形态（剥注释后按属性位匹配）；§10 变异表逐条补行 |
| CODEX-02 | codex | 重要 | 接受 | 两处真问题：①T-4 只断 `Handoff.options` 类型键集，`writeHandoff` / `rebuildContext` 漏传值时类型照样成立；②本步要在**同一个** `newRunMeta` 块里同时加 `driver` 与 `driverEnabled`，任何 `includes('driver')` 都会被后者满足——而那正是失败形态。进程切分的指正见 GLM-06 | §4.2 T-4 改断值表达式且能区分两个键；§5.5 改理由；§10 补三行变异 |
| CODEX-03 | codex | 重要 | 接受 | 我把两个同名函数混成一个了。`locateSubject`（`topic.ts:76`）才是 `review --start` 真实走的那条，而 T-5 只落在 `topic-args.test.ts`；验收清单也漏了 `topic.test.js`（实核 `topic.test.ts:50-85` 确有既有用例）。只改一处时 T-5 全绿而真实链路仍误判 | T-5 拆两条；§10 验收补 `topic.test.js`；变异表按函数分行 |
| CODEX-04 | codex | 重要 | 接受 | 与我自己在 §4.1 立的规矩同构，只是换到 EV-54 这一格：T-9 用合成入参验的是**接收侧**（我自己说它已完整接通），写入侧 `review.ts:1144/:1341` 忘传时 T-9 照样绿 | T-9 增扫 `isHeterogeneous(` 所在实参块含 `overrideReason`；§10 补变异行 |
| CODEX-05 | codex | 重要 | 接受 | 焦点一得到了我要的答案：**今天没有第四条写入路径**（84 份运行元数据、162 条登记条目逐条核过），但它成立靠的是**调用点清单**而非不变式——`roleIsAllowedForWriter` 实核确为 `writer === 'driver' ? role === driver`，编排器本就把「Driver 产出角色工件」当一等公民。我改判据形态（见 §2.1）。边界：**不采纳**「显式路径降为告警」这一子建议，理由见 §2.1 | §5.6 判据由「登记反推」改为文件自身 front-matter 判定；§5.6 依据 2 改写 |
| CODEX-06 | codex | 重要 | 接受 | 与 GLM-03 同一区域，合并处置。`cli.ts:731` 的轮次仍按缺省 Driver 算，而 `artifactMeta` 在 :760 同分支内就已到手——这不是必须等 M10 的循环依赖，是我把它推早了 | 并入 §2.2 的闸门区同批收口 |
| CODEX-07 | codex | 重要 | 接受 | 真缺口：我让 `newRunMeta` 写 `driverEnabled`，却没说它在 `prepareRun` 里从哪来（`ReviewOptions` 只加了 `driver?`）。要么编不过，要么静默漏写，而 T-8 用合成入参调 `newRunMeta` 照样绿 | §5.5 写明就地由注册表派生 `agentById(driver)?.driverEnabled`，不改交接文件；补落盘真值判据 |
| CODEX-08 | codex | 次要 | 接受 | R-8 的「零配额」写错了：T-1/T-2 是真起子进程的集成用例，且 `driver-flag.test.js` 每次 `npm run check` 都跑。不注入桩就是每次提交闸门都烧一次配额 | §4.2 写明 T-1/T-2 注入 `TRIVIUM_STUB_CRITIC` 并断言桩指纹；R-8 改为带前提的表述 |
| CODEX-09 | codex | 次要 | 接受 | USAGE 的取值清单我只写了「用插值」没说插哪份，而 `DRIVER_AGENT_IDS` 今天只含 claude、且我在 §2.3 刚点名过它——很容易被下一个人当成「就是这个」。附带项（`--model-*` 那行也写死两家）超本步范围，登记不做 | §5.1 写明 USAGE 论域与 `resolveDriver` 接受集同源；`--model-*` 一行登记 EV-61 |
| CODEX-10 | codex | 次要 | 接受 | 两点都没定：`listRecordedRuns` 无 stage 参数、一次读四个阶段；`unreadable` 是错误还是提示我没写。verify 阶段一份坏记录挡住 plan 的原稿定位，是一次与它无关的连带失败 | §5.6 钉死只读同阶段记录；`unreadable` 分流按 GLM-05 处置 |
| CODEX-11 | codex | 次要 | 接受 | 我漏了 `:466` 的回落分支 `resolveCriticSelection(cfg)` 同样不传 driver。防御条本意是补「直传 critics」那条绕过路径，却让 Driver 互斥出现两处实现——与我在 §5.0 自己立的口径相反 | §5.5 回落分支传 driver；防御条只留给直传 critics 形态，文案复用判定处 |
| CODEX-12 | codex | 次要 | 接受 | 变异表那行没有对应判据：预检提示只在 `driver !== DEFAULT_DRIVER` 时推入，而既有用例都不传 driver，改 `ok` 为 false 在现有套件里全绿。`preflight.test.ts:240` 还断言了 `checks.length === 1` | §4.2 新增预检提示用例（非缺省 + 未启用两种取值）；变异行绑到新用例 |
| CODEX-13 | codex | 次要 | 接受 | 我自己的计划内部矛盾：§1.2 把闸门区整行标为「不做」，而 §2.1 步骤表逐字含「`checkStageArtifacts`（:762）的 driver 位补上」、§5.7 做的正是它。范围表会被后续按字面执行 | §1.2 该行收窄；并按 §2.2 重写（闸门区已整体进范围） |
| AGY-01 | gemini | 重要 | 接受 | 与 CODEX-01/CODEX-02 独立同构，并多出一条我没想到的：T-4 扫 `locateSubjectReadOnly` 若不锁定调用点前缀，会命中 `topic-args.ts:520` 的**函数声明**（它本就带第 5 形参），又是一条永绿 | §4.2 T-4 断言一律锁 `await <fn>(` 调用点形态 |
| AGY-02 | gemini | 重要 | 接受 | 两半都真：①`override_reason` 取值规则未定（≡ GLM-04）；②`isHeterogeneous` 只判模型串含不含 claude、**不感知当轮 Driver**，第 6 步以非 claude 为 Driver 时 claude 审核者会被判「与主脑同源」——而主脑根本不是 claude。第②半是语义缺陷，但改它超出本步范围 | §5.8 定死取值来源；§5.8 写明本步沿用旧判据并在留痕说明；语义问题登记 EV-62 |
| AGY-03 | gemini | 次要 | 接受 | 路径格式确实没归一化：登记的是 `<主题>/<阶段>/<文件>` 相对归档根，而两个定位函数遍历的是目录条目（文件名）、`explicitPath` 可能是绝对或相对项目根。直接查 Set 会恒不命中——判据静默失效，比误判更糟 | §5.6 写明统一归一化为相对归档根的规范化路径后再比对 |
| GLM-01 | glm | 重要 | 接受 | 除与 CODEX-02 同构外，两条独有且更好：①把 `Handoff.options.driver` 声明为**必填**，让「类型可选＋漏写」在编译期就不可达——这是比测试更强的机制，符合本仓「靠记性的纪律换成不依赖记性的机制」；②我漏了 `topic-args.ts:328` 这个**第三个**选侧调用点没进扫描集 | §5.5 `Handoff.options.driver` 改必填；§4.2 T-4 扫描集补 `topic-args.ts:328` 与两处值传递点 |
| GLM-02 | glm | 重要 | 接受 | ≡ CODEX-01 / AGY-01。三侧独立命中同一处，且它额外指出既有用例的三件套骨架（唯一调用计数、结尾定位断言、值表达式）正是应当沿用的形态 | 并入 CODEX-01 落点，按三件套骨架写 |
| GLM-03 | glm | 重要 | 接受 | **本轮最有价值的一条，我已回原文核实属实。** `gate.ts:151` 按 `input.driver ?? DEFAULT_DRIVER` 定位裁决件，`cli.ts:801` 与 `:876` 两处调用都不传，`cmdGate` 无旗标可传 → 非缺省 Driver 下去找 `-revised-claude.md` 而实际是 `-revised-<真Driver>.md`，`missing_disposition` 硬失败，`--run-id` 救不了。它直接打穿了我「EV-58 可推后」的前提：第 6 步剧本正是 `--critics claude`，即 driver ≠ claude | §5.7 扩为闸门区整体收口（见 §2.2）；EV-58 改写显形时点 |
| GLM-04 | glm | 次要 | 接受 | ≡ AGY-02 前半，且说得更准：「非空」会把取值决策推迟到写测试那一刻由实现者临场发明，两处还可能发明出两份不同文案——恰好踩破 T-9 自己要守的「两处同值」 | 并入 AGY-02 落点，两处共用同一派生函数 |
| GLM-05 | glm | 次要 | 接受 | 姿态不一致确实存在：hooks 见 `unreadable` 即硬拦提交，选原稿却放行——而「搅坏一份运行元数据即可让它登记的审查件从过滤集消失」正是 CODEX-07 要堵的洞 | §5.6 分流：`topic resolve` 只读路径记 notes；`prepareRun` 的 `locateSubject` 遇 `unreadable` 硬失败 |
| GLM-06 | glm | 次要 | 接受 | 我那句「worker 才是真正跑审查的那一侧」是外推，实核不成立：driver 的全部消费方（`resolveRerunIndex`/`locateSubject`/`freeze`/`newRunMeta`/`resolveCriticSelection`）都在 `prepareRun`（`--start` 侧），`executeRun` 今天不读 `opts.driver`。按本仓纪律，这句落进注释就是又一处失实 | §5.5 改为「与 critics/sessionId/entry 同构，为交接完整性预留」，接线照做 |
| GLM-07 | glm | 次要 | 接受 | 好建议，直接消掉我在 §11.2 自曝的那条无机器判据的人工约束：先落 `selectableCritics` 导出并让 `legalList` 改调它（行为等价），再在下一步一并接 driver——矛盾窗口为零 | §3 顺序表 5.3 与 5.4 互换；删去「不得留过夜」的人工约束 |
| GLM-08 | glm | 吹毛求疵 | 接受 | 已核实：`verify.ts:216` 确是第二个写 `artifacts[]` 的地方。结论不变（`buildVerifyName` 不带角色后缀、落在 verify/ 目录），但「写入方唯一」是我那条推导的支点之一，写不准会让后人按「唯一」做扩展时踩空 | §5.6 依据 2 补一句点破这一支 |
| GLM-09 | glm | 吹毛求疵 | 接受 | 已核实：`review.ts:1065-1069` 恰恰是**防**分叉的（抬升时同步改写 `meta.rerun_index`），我写的「运行元数据与文件名分叉」与所引代码相反。这是留痕里的失实断言，按本仓纪律先改再提交 | §2.1 末段与 R-2 改写为准确代价（骨架短暂失真 + 一次抬升告警 + 触发条件收窄） |

---

## 2. 实质修订（三处改变计划形状的）

### 2.1 §5.6 判据换底：由「登记反推」改为**文件自身 front-matter 判定**（CODEX-05，含 GLM-08 / AGY-03 / CODEX-10 / GLM-05）

原判据「候选命中任一运行元数据的审查件登记 ⇒ 是审查件」被三条事实推翻了其**不变式地位**：

1. `roleIsAllowedForWriter(writer, role, driver)` 实核为 `writer === 'driver' ? role === driver`
   —— 编排器把「Driver 产出角色工件」当一等公民，M10 之下让 Driver 的原稿也走 `writeArtifact`
   是自然做法，那时这条判据会把合法原稿判死；
2. `verify.ts:216` 是第二个写 `artifacts[]` 的地方（结论不变，但「唯一」这个支点是错的）；
3. 登记清单里**没有产出方信息**，「任一 run 的登记」比「某次审查的某一侧产出」宽。

**改用本仓既有口径**：`freeze.ts:200-215` 的 `classifyArtifact` 走文件自身 front-matter。
审查件带 `schema: trivium.review.v1`，原稿与裁决件不带（或带 `trivium.disposition.v1`）。
这是**内容级判据**，不依赖调用点清单、不依赖登记、也不受第四条写入路径影响。

codex 的实测反过来印证了等价性：**162/162 条带角色后缀的登记条目全部含 `trivium.review.v1`**，
0 条是原稿或裁决件——两种判据在今天的归档上结论完全一致，但 front-matter 那条扛得住明天。

换底后连带解决三条：路径归一化（AGY-03）不再需要——不比对路径了；`stage` 论域与
`unreadable` 分流（CODEX-10 / GLM-05）也随之消失,因为不再读运行元数据。
**`recordedArtifactPaths` 这个函数不再需要新增。**

**不采纳** CODEX-05 的子建议「给显式路径降为告警」：换成内容判据后误判面已消除，
而降为告警会让「显式指向一份审查件」这个明确错误静默通过。显式路径**维持硬拒绝**。

### 2.2 §5.7 扩为闸门区整体收口，EV-58 大部分不再可推后（GLM-03 + CODEX-06 + CODEX-13）

我原以为闸门区可以整体推给 M10，前提是「M9 期间 Driver 恒为 claude」。
**这个前提被我自己的第 6 步剧本打穿**：验收要跑 `--critics claude`，而它只在 driver ≠ claude 时成立。

实核后果比「算错轮次」重：

- `checkAdjudication`（`gate.ts:151`）按缺省 Driver 找裁决件 → 非缺省 Driver 下 `missing_disposition` **硬失败**，且 `cmdGate` 无旗标可传、`--run-id` 也救不了；
- `inferLatestRunId`（`cli.ts:759/775/866`）跳过 `role === driver`，critics 含 claude 时恒推不出 run_id，于是 §5.7 依赖的 `artifactMeta` 恒为 null，**我原来那条修复在该场景整段失效**；
- `resolveRerunIndex`（`cli.ts:731`）轮次偏小，gate 会拿过时那一轮静默给 ok。

**新范围**：`cmdGate` 内部一律以**运行元数据**为 driver 的事实来源（`meta.driver`），
覆盖 `checkAdjudication` 两处、`checkStageArtifacts` 一处、`inferLatestRunId` 三处、
`resolveRerunIndex` 一处。`cmdGate` **仍不加 `--driver` 旗标**（事实来源是留痕不是旗标，
这条原则不变）。EV-58 只保留「先有鸡还是先有蛋」那一格（推不出 run_id 时如何取 meta）。

### 2.3 §4.2 测试判据整体重写（CODEX-01/02/03/04 + AGY-01 + GLM-01/02）

三侧一致指出：我写的扫源码判据**在今天的 HEAD 上就已经全绿**。这是本轮最集中的一处命中，
而它恰恰是我列为焦点三请他们核的——问到了点子上。

重写要点：

- **判据形态**：沿用 `deny-matrix.test.ts:362` 的三件套骨架（唯一调用计数 → 实参块结尾定位断言 → 值表达式），**剥注释行**后按属性位匹配，且必须能区分 `driver` 与 `driverEnabled`；
- **调用点锁定**：一律匹配 `await <fn>(` 形态，不匹配函数声明；
- **扫描集补齐**：`topic-args.ts:328`（第三个选侧入口）、`writeHandoff` 与 `rebuildContext` 两处值传递、`isHeterogeneous(` 所在实参块；
- **机制优先于测试**：`Handoff.options.driver` 改**必填**（GLM-01），让漏写在编译期不可达；
- **T-5 拆两条**，`topic.ts` 与 `topic-args.ts` 各一，验收补 `topic.test.js`；
- **变异表逐条对应**：本步新增的每一条扫源码判据都要有自己的变异行，现在只有一行。

---

## 3. 无需改动的部分

三侧共同确认成立、按原样保留：`resolveDriver` 集中判定（§5.0）；EV-53 源头合一的
`selectableCritics`（§5.4）；R-1 的「显式硬拒 / 自动候选先滤」双轨；R-6 的留痕不可逆口径
（可选字段、保持 `additionalProperties: true`、不加 `if/then`）；§5.2 预检提示必须 `ok: true`；
§4.1「不再自构入参写选侧用例」；§2.1「步骤表漏了 `resolveRerunIndex`」与 EV-54 纳入本步
——**两处范围扩张三侧一致认为站得住**（焦点二的答案）。

D3（`--stage all` 拒绝 `--driver`）glm 明确支持，理由与 `--critics`/`--only` 逐字同构，采纳。
D4 三侧一致支持双轨，采纳。D5 三侧一致支持切分方向，但按 §2.2 修正：`cli.ts` 那半不再推后。

---

## 4. 本轮新登记的台账

- **EV-60**：zcode 侧出现 `project_reads: 29` 而 `read/grep/glob/run_command` 全为 0 的轨迹分叉，触发 `insufficient_evidence` 降级。本轮经人工复核确认该侧确实读了工作树，即**判据与事实不符**。要查清是采集口径问题还是渲染问题——它会让合格的一侧被误判为不合格，而反向（真没读却计数正常）更危险。
- **EV-61**：`cli.ts:198` 的 `--model-gemini / --model-glm` 帮助文本写死两家，而代码接受四家。与 CODEX-09 同族的论域漂移，超本步范围。
- **EV-62**：`isHeterogeneous`（`adapters/base.ts:1670`）只判模型串含不含 claude、不感知当轮 Driver。非 claude 为 Driver 时，claude 审核者会被判「与主脑同源」而实际异构；反之 Driver 为 claude 而审核者用别家 claude 系模型时判据才真正成立。触发条件：M10 换 Driver，或第 6 步验收留痕需要解释时。

---

## 5. 下一步

本件产出后进入闸门。计划正文按 §1 落点与 §2 三处实质修订改写后再实施——
**修订量超出「小改」范畴**（12 条重要意见，其中测试判据整体重写、判据换底、闸门区扩范围三处改变形状），
按本仓惯例，改完后是否需要再跑一轮计划审由用户定。
