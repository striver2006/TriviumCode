---
schema: trivium.review.v1
topic: M9-Driver旗标全链路与选侧收口
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.155.0
model_requested: deepseek-flash
model_effective: deepseek-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260918T154204Z
rerun_index: 1
snapshot_hash: sha256:72f22a72d59b96304c2f2f8a8c79f282dfc78342b01cb7f2021922f9c1508053
blind: true
started_at: 2026-09-18T15:42:05.305Z
finished_at: 2026-09-18T16:01:42.671Z
duration_s: 400
tool_calls:
  run_command: 72
  project_reads: 42
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 7
  minor: 6
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0b52e-9a62-70e0-b884-3afeb59f36fa
---

# 计划审查：M9-Driver旗标全链路与选侧收口

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260918T154204Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

三处焦点都确有其事，且比计划自陈的更具体：T-3 的断言在**今天的源码上就已经绿**（freeze 实参块内的注释含 `driver`，且计划要写的缩写实参根本没有 `driver:` 这个字面量）；T-4 只钉了 `Handoff.options` 的类型键，两处真正传值的字面量可静默漏传，且同一条子串判据会被同块新增的 `driverEnabled` 满足；T-9/V7 验的是计划自称「已完整接通」的接收侧，EV-54 的两处写入方仍无判据。焦点之外：CODEX-07 的判据在今天的归档上成立（84 份 run.json、162 条带角色后缀登记条目逐条核过，无一例外），但它靠的是调用点清单而非不变式，且显式路径硬拒绝且无出口；`driverEnabled` 在 prepareRun 没有来源，`run.json.driver_enabled` 的实写无人管；gate 区分了一半（checkStageArtifacts 取元数据）却把 :731 的轮次留在缺省 Driver 上，重跑会静默校错轮次。两处范围扩张我认为都站得住（§2.1 的算例可复算；EV-54 的推后理由被本步消灭）。建议先落 01-07 的判据修正，再动实现。

**结论**：`request-changes`

## 审查意见（共 13 条：重要 7 ｜ 次要 6）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.2 T-3 ／ §5.5 ／ test/unit/deny-matrix.test.ts:362-395` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：T-3 的扩写形态没定死，而两种最自然的写法都拦不住「freeze 调用点漏传 driver」：(a) §5.5 给的落地写法是缩写 `driver,`，实参块里不存在 `driver:` 这个字面量，沿用既有用例 `argBlock.includes(key)` 的「值表达式」形态无法表达；(b) 退成裸子串 `driver` 则**今天就已经为真**——现有 freeze 实参块里那条注释逐字含这个词（「下面 `driver` 字段的注释记的就是第一次」）。结果是删掉该实参后 T-3 照旧通过，而这正是本步唯一的 freeze 接线判据。

**依据**：按该用例自己的定位法（`await freeze({` 起、到下一个 `\n    });` 止）只读切出 src/trivium/review.ts 的实参块共 1082 字节，逐键判定：'driver' in blk = True、'driver:' = False、'driver,' = False、'driverEnabled' = False；命中的唯一一行是 `* **这是同一个错误的第二次**：下面 \`driver\` 字段的注释记的就是第一次`。既有用例判据见 test/unit/deny-matrix.test.ts:385-395。

**建议**：在计划里把 T-3 要断言的字面量钉死为「不会被注释命中的形态」（行级正则 + 排除注释行，或直接断言行内出现该缩写实参并保证注释不计入），并把「落地后删掉该实参必须当场红」写进变异表——本步新增的每一条扫源码判据都要有自己的变异行，现在只有 T-3 一行。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.2 T-4 ／ §5.5（run-protocol 三处）／ src/trivium/run-protocol.ts:74-88、104-115、150-170；src/trivium/review.ts:775-795` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：T-4 被声明为「唯一能拦住『函数支持了、调用点没传』的判据」，但它对交接文件只断 `Handoff.options` 的**类型键集** ⊇ {…, driver}。真正决定 worker 侧取值的是两处字面量：writeHandoff 构造的 options 对象、rebuildContext 回填 opts 的对象；两处都漏 driver 时类型照样成立（ReviewOptions.driver 可选，且返回处是 `satisfies ReviewOptions`），T-4 依旧绿。同一判据扫 newRunMeta 实参块时还有一个更隐的坑：本步要在**同一个块**里同时加 `driver` 与 `driverEnabled`，任何 `includes('driver')` 形态都会被 `driverEnabled` 满足——而那恰好就是「driver 没传」的失败形态。另外 §5.5 给这三处的理由「worker 才是真正跑审查的那一侧」与实际进程切分不符：prepareRun 在 --start 进程跑，worker 只 rebuildContext → executeRun，所以这三处更像一致性保险而非当下必需；理由写歪会让人以为 executeRun 已经在消费 opts.driver。

**依据**：src/trivium/run-protocol.ts:104-115 的 options 字面量逐字列了 promptHint/contextPaths/subjectFile/modelOverrides/command/critics/sessionId/allowSingle/entry/assetRoot，无 driver；:150-170 以 `satisfies ReviewOptions` 收口；src/trivium/review.ts:775-795 的 newRunMeta 实参块（547 字节）今天 'driver' 为假，接上后同块出现 `driver` 与 `driverEnabled`；进程切分见 src/trivium/review.ts:445 与 src/trivium/run-protocol.ts:287、:415。

**建议**：把这条判据从「类型键集」升级为「真实传值」：最便宜的是让 T-1/T-2 的那次真实子进程运行断言落盘事实（交接文件里的 driver 与 run.json.driver 同值），其次才是扫源码，且断言必须能区分 `driver` 与 `driverEnabled`；并把三种漏传（writeHandoff / rebuildContext / newRunMeta）逐条写进变异表。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.6 ／ §4.2 T-5 ／ §10 变异表 ／ src/trivium/topic.ts:76` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：§5.6 要求 `locateSubjectReadOnly`（topic-args.ts:520，命令 A/`topic resolve` 走它）与 `locateSubject`（topic.ts:76，**真实审查路径** review.ts:610 走它）必须同改，但唯一的 CODEX-07 用例 T-5 落在 test/unit/topic-args.test.ts，只覆盖前者；验收清单里也没有 topic.test.ts（该文件 :50-85 才是 locateSubject 的既有用例所在）。于是「只改了 topic-args 那一处」时 T-5 全绿，而 `review --start` 仍会把审查件当原稿——正是 R-1 要防的形态。变异表那行「删 `locateSubject` 的登记过滤 → T-5」把两个同名家族的函数混成一个，读起来像已覆盖。

**依据**：`grep -rn locateSubject src/` 显示两处定义（src/trivium/topic.ts:76、src/trivium/topic-args.ts:520）与两处调用（src/trivium/review.ts:610、src/trivium/topic-args.ts:473），两处候选过滤逐项同形（role === driver && kind === null）；test/unit/topic-args.test.ts:563+ 调 resolveTopicArgs；test/unit/topic.test.ts:50-85 直接调 locateSubject；计划 §10 验收命令不含 topic.test.js。

**建议**：T-5 拆成两条（同一夹具、两个函数各一条），或把判据下沉到二者共用的候选过滤函数上，让「同改」由构造保证而不是靠人记得；变异表按函数逐条写，验收清单补 topic.test.js。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.2 T-9 ／ §5.8 ／ §10 V7 ／ src/trivium/review.ts:1144、1341` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：EV-54 的缺口原文就是「缺的只是 review.ts 的两处传值」，而 T-9 只放 render.test.ts / run-meta.test.ts，用合成入参断言「heterogeneous === false 时 override_reason 非空、两处同值」——那验的是**接收侧**，计划自己说它已完整接通。写入侧（review.ts:1144、:1341 的 overrideReason 实参）没有任何判据：忘传时 T-9 与 V7 照样绿，变异表也没有对应行。这与 §4.1 自己立的规矩（「自己构造入参调函数」的用例在这个缺口上必然是绿的，写了等于发假证明）是同一条，只是换到了 EV-54 这一格。

**依据**：`grep -rn 'override_reason|overrideReason' src/` 只命中 src/trivium/render.ts:98/192/313-314；契约侧已就绪（skills/dual-critic/schema/run.v2.json 的 $defs.critic 已声明 `override_reason: [string, null]`、不在 required、additionalProperties: true），所以缺的确实只是写入方；§5.8 自陈「承接侧已完整接通」；§4.2 T-9 的两个文件都不执行 review.ts。

**建议**：把这两处写入方并进 T-4 那套「扫真实调用点」的判据（`isHeterogeneous(` 所在实参块必须含 overrideReason），或在一次桩运行里让该侧模型串落进 claude 家族、直接断言 front-matter 与 run.json 的 override_reason 非空（这一条同时验到端到端）；并补进变异表。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.6 ／ §9「CODEX-07 判据的落点」／ src/trivium/archive.ts:142-190、verify.ts:216` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：焦点一我按今天的仓库核过，**没有找到第四条写入路径**（见 evidence），推导今天成立；但它成立的理由是**调用点清单**而不是不变式，因此不可维持：(1) `writeArtifact` 本身把「Driver 产出角色工件」当一等公民（writer: 'driver' | CriticId，`roleIsAllowedForWriter` 允许 role === driver，测试通篇这么造），任何人以后把 Driver 的原稿/裁决件也经它落盘（M10 之下这是自然做法），这条判据立刻把合法原稿判成审查件，而 §5.6 对显式 `--plan-file/--rca-file` 是**硬拒绝且没有出口**（改名会破坏文件名解析 → 用户无自救手段）；(2) 「artifacts[] 的写入方只有 review.ts」按字面不成立：verify.ts:216 是第二个写 artifacts[] 的落盘点（verify 阶段 run.json），它之所以不污染本判据，靠的是 writeMeta「_meta 内不得出现角色后缀名」那条守卫，而不是「只有一个写入方」；(3) 判据事实源里没有产出方信息，「任一 run 的登记」比「某次审查的某一侧产出」宽，而本仓既有的「这是不是审查件」判定（freeze.ts:200-215 的 classifyArtifact）走的是文件自身 front-matter，其文档块还明写「run.json.artifacts 只收录编排器本轮写出的审查件与 _meta 材料……按登记清单反推对最需要判定的两类文件没有事实来源」。

**依据**：枚举 .reviews/**/_meta/run-*.json 共 84 份，带角色后缀的登记条目 162 条，逐条读目标文件头 400 字节：**162/162 含 `trivium.review.v1`**（无一条是原稿或裁决件），0 条以 -claude.md 结尾；另按 run 的 critics_selected 复核，47 条来自无该字段的 v1 期记录（readRunMeta/migrateRunMetaV1 会补齐）。支持性源码：src/trivium/naming.ts:158-164、test/unit/archive.test.ts:187-194（`{role:'claude', writer:'driver'}` 形状）、src/trivium/verify.ts:188-217、src/trivium/freeze.ts:200-215。

**建议**：把判据收窄成「这一路径是**某次审查运行的某一侧**产出的」：run.json 已有 `critics_selected`（cli.ts:760-762 正是拿它做同类判据，v1 记录经 readRunMeta 迁移后同样有值），代价是 `recordedArtifactPaths` 从 listRecordedRuns 的裸解析换成按 run 读元数据；或与 freeze 的既有口径统一，用文件自身 front-matter 判定。两者都比「被登记过就算审查件」更能扛住第四条写入路径。同时给显式路径保留一条显式豁免（或降为「照常放行 + 响亮告警」），否则一次误判就是无出口的死锁。

### CODEX-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.7 ／ §1.2 ／ §8 EV-58 ／ src/trivium/cli.ts:731-762` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：5.7 让 `checkStageArtifacts` 的 driver 位改从运行元数据取（方向对），但同一分支上游的 `resolveRerunIndex(ref.layout, stage)`（:731）仍按缺省 Driver 算轮次：非缺省 Driver 下它跳过 Driver 后缀的审查件，轮次偏小（§2.1 自己的算例：应为 3 实得 2）。于是重跑场景里 gate 会拿**过时那一轮**校验工件——r1 与 r2 的审查文档都在时，它会以 r1 判「齐备」，静默给出与最新轮次不符的 ok；若 r1 那份被清理过，则反过来报假缺件。修法方向上计划自己已写了「改用 meta.rerun_index」，而 `artifactMeta` 在 :760（同分支内、校验之前）就到手，所以这不是必须等 M10 的循环依赖。

**依据**：src/trivium/cli.ts:731 `const nextIndex = await resolveRerunIndex(ref.layout, stage);`（第三参缺省）、:759-762 先读 artifactMeta 再以 `undefined` 作 driver 调 checkStageArtifacts；src/trivium/archive.ts:65-82 的 `if (i.parsed.role === driver) continue;`、:283-318 用 rerunIndex 过滤本轮审查文档与裁决件；gate.ts 的 inferLatestRunId 也以 rerunIndex 为入参（EV-58 点名的三处）。

**建议**：要么把 :731 与 5.7 同批收口（有 --run-id 或能推断出元数据时用 `meta.rerun_index`，与 5.7 同一事实来源），要么在计划里显式声明「非缺省 Driver 下 gate 的轮次判定在 M10 前不正确」并在该路径拒绝或响亮告警——不能静默给 ok，因为本步正是让这个能力第一次可用。

### CODEX-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.1 ／ §5.5（newRunMeta 与留痕字段）／ src/trivium/review.ts:775-795 ／ src/trivium/meta.ts:214-240` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：`driverEnabled` 在 prepareRun 里没有来源。§5.1 只把 `enabledAsDriver` 传给 `runPreflight`；`ReviewOptions` 按 §5.5 只加 `driver?: AgentId`；交接文件三处也只加 `driver`——而 :776 的 `newRunMeta` 要写 `driverEnabled`。计划没说它从哪来（最合理是 `agentById(driver)?.driverEnabled`），于是要么实现时编不过、要么静默漏写：该入参可选、run.json 该字段可选、worker 末次落盘是读骨架改写（骨架里没有就永远不会有）。后果是本步承诺的反面——`--driver codex` 的运行元数据里既没有 `driver_enabled: false`，也没有任何「该值只用于选侧」的留痕，而 T-8 用合成入参直接调 newRunMeta，照样绿。

**依据**：src/trivium/meta.ts:214-217（`driver?: AgentId`）、:237（`driver: i.driver ?? DEFAULT_DRIVER`）、:262（`artifacts: []`）；src/trivium/review.ts:775-795 的 newRunMeta 实参块今天无 driver；src/trivium/run-protocol.ts:104-115 的 options 字面量无 driverEnabled；src/trivium/cli.ts:638-645 现状只传 critics/modelOverrides/skipAuthCheck/refreshAuth（计划在此加 driver/driverEnabled）；末次落盘见 src/trivium/review.ts:1396。

**建议**：在 §5.5 写明 `driverEnabled` 的取值来源（建议在 prepareRun 就地由注册表派生，不改交接文件），并给「driver 非缺省时 run.json 必带 driver_enabled」补一条真值判据（一次真实/桩运行的落盘断言），否则 V6 只证明了函数本身没问题。

### CODEX-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §7 R-8 ／ §4.2 T-1/T-2 ／ §10 验收` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：R-8 写「5.0～5.8 全部零配额（纯单测 + 类型检查）」，但本步新增的 T-1/T-2 是**集成**用例（真起 CLI 子进程），计划没说它们注入桩。T-2 要「走通选侧」，不注入桩就是真实的 claude CLI 调用，而 driver-flag.test.js 在 `npm run check` 里每次都会跑——配额会在提交闸门里反复烧，且与第 6 步验收的烧法混在一起分不清。T-1 期望退 64、不触适配器，成本为零，这是唯一安全的一条。

**依据**：计划 §10 验收命令含 integration/driver-flag.test.js 与 `npm run check`；test/integration 现有用例一律以 `TRIVIUM_STUB_CRITIC` 注入（test/integration/code-stage.test.ts:320、bug-stage.test.ts:177/197，fingerprint 断言见 fault-injection.test.ts:102/141、command-trace.test.ts:122）；AGENTS.md 测试要点要求「故障注入用环境变量 TRIVIUM_STUB_CRITIC，且必须断言桩指纹」。

**建议**：在 §4.2 写明 T-1/T-2 注入桩并断言 `stub/0.0.0`（或说明 T-2 在拉起适配器之前就收口），并把 R-8 的「零配额」改写成带前提的表述。

### CODEX-09 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.0 ／ §5.1（USAGE :208/:226）／ src/trivium/agents/registry.ts:338` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：`--driver` 的取值论域在四处可能不一致：判别处按 §5.0 用 `ALL_AGENT_IDS`（四家都收，只校验已登记）；USAGE 只写「取值清单用插值（仿 doctorOnlyChoices()）」而没说插哪一份——若插 `DRIVER_AGENT_IDS`（今天只含 claude，且 §2.3 特地指出它零消费方，很容易被当成「就是这个用的」），帮助文本会写「只有 claude」而实际接受四家。skill 本轮不暴露，所以用户能看到的清单只有 USAGE 与报错，两者一旦不同就正是计划反复点名要防的「第一个错误把用户引向第二个错误」。

**依据**：src/trivium/agents/registry.ts:338-341（DRIVER_AGENT_IDS 只含 driverEnabled 的家，registry.ts 另有三处 `driverEnabled: false`）；src/trivium/doctor.ts:47-49 是「注册表全集」插值先例；src/trivium/cli.ts:198 的 `--model-gemini / --model-glm` 一行至今写死两家而代码接受四家，同族漂移的先例。

**建议**：在 §5.1 明确 USAGE 的取值清单与 resolveDriver 的接受集同源，并顺带交代 `--model-*` 那一行是否同批改为插值（它今天也只列两家）；若决定 USAGE 只列「已启用为 Driver」的家，就同时说明接受集更宽的理由。

### CODEX-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.6（recordedArtifactPaths 与 unreadable 处置）／ src/trivium/archive.ts:491-538` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：计划给的签名是 `recordedArtifactPaths(layout, stage?)`，而它要复用的 `listRecordedRuns(layout)` 没有 stage 参数，一次读 plan/code/bug/verify **四个阶段**的 run.json，并把契约不认/读不出来的记为 `unreadable`。两点未决：(a) 过滤是按阶段还是全主题——按全主题时判据论域比函数名暗示的大，任何阶段的一条坏记录都会进入 unreadable；(b) 「有 unreadable 时在错误 / notes 里点名」是错误还是提示没定——若选错误，verify 阶段一份坏 run.json 会挡住 plan/bug 的原稿定位（一次与它无关的连带失败）。

**依据**：src/trivium/archive.ts:491-538 的 `for (const stage of ['plan','code','bug','verify'])` 与 unreadable 分支（含 unreadableReason）；src/trivium/verify.ts:188-217 每跑一次 verify 就多一份 verify 阶段 run.json；src/trivium/cli.ts:739-743 现有消费方拿到 unreadable 时是静默跳过（只当登记清单用）。

**建议**：在计划里钉死两点：判据只读同阶段记录（或说明跨阶段的必要性），unreadable 在自动路径上按 notes/告警处理、只在显式指定路径时升级为拒绝；否则排障者会被引去查错的阶段。

### CODEX-11 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.0「判定只此一处」／ §5.5（:466 与 :497 旁）／ src/trivium/review.ts:466-500` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：计划在 :466 的回落分支 `resolveCriticSelection(cfg)` 仍不传 driver，另在 :497 加一条独立的 `sides.includes(driver)` 抛错。于是「Driver 不得入选」出现两处实现（判定处 + prepareRun 就地抛），与 §5.0 自己立的口径（校验分两处实现就是改一漏二）相反；报错文案也会分叉：一处是 critics.ts 的完整文案，一处是现场 usageError。计划给防御条的理由（「给了 critics 就不再过判定处」）恰好说的是**没给** critics 的那条回落分支，而它连 driver 都没参与。

**依据**：src/trivium/review.ts:466 `const sides = [...(opts.critics ?? resolveCriticSelection(cfg))]`（未传 driver）；src/trivium/critics.ts:150-165 的 Driver 互斥检查与 legalList 文案；src/trivium/review.ts:497-500 的空集合兜底注释（「判定处的非空不变式要延伸到直接传参的路径」）。

**建议**：回落分支也把 driver 传进同一个判定处，防御条只保留给「直传 critics」这一种绕过形态；两处文案统一，或明确它们语义不同。

### CODEX-12 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §10 变异验证表（最后一行）／ test/unit/preflight.test.ts:230-300` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：变异表写「把预检提示的 `ok` 改成 `false` → preflight.test.ts 既有用例必红」，但这条提示按 §5.2 只在 `driver !== DEFAULT_DRIVER` 时推入，而现有用例都不传 driver，因此没有任何既有用例能看见它——改 ok 为 false 在现有套件里全绿。§4.2 也没有为预检提示新增用例，V 列表里同样没有它。

**依据**：`grep -n 'runPreflight(' test/unit/preflight.test.ts` 的全部调用点只传 ctx/scope/skipAuthCheck/critics（:210、:230、:240、:559 等），无 driver；:240 `assert.equal(r.checks.length, 1, …)` 依赖「不新增检查项」；src/trivium/preflight.ts:604-641 的 `checks.every` 短路与 `failed = checks.find(c => !c.ok)`。

**建议**：删掉这一行，或配套新增一条传 driver 的用例（非缺省 + 未启用两种取值），断言 ok 恒 true、detail 文案命中、且不因它短路掉后续检查；变异表只承认有对应判据的行。

### CODEX-13 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1.2（第 6 行「不做」表）` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：§1.2 把「`gate.ts` / `report.ts` / `naming.ts` 以及 `cli.ts` 闸门区的 driver 位」整行标为「不在 §2.1 落点表」的**不做**项，但 §2.1 的逐字表里有一行就是「`checkStageArtifacts`（:762）的 driver 位补上」，§5.7 做的正是这件事。范围表会被后续裁决与回溯按字面执行，读它的人会把 5.7 一起放掉——而 5.7 是 gate 在非缺省 Driver 下唯一的事实来源修正。

**依据**：计划 §1.1 引用的步骤表（与 .reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-revised-claude.md:115-121 一致）含「`checkStageArtifacts`（:762）的 driver 位补上」；§8 EV-58 点名的是另四个位（resolveRerunIndex:731 与三处 inferLatestRunId:759/775/866）。

**建议**：把 §1.2 那一行收窄为「EV-58 点名的四个位」，并保留 5.7 在范围内；范围表与步骤表逐行对齐一次。

## 认为正确的部分

- §2.1 的事实与算例我复算成立：src/trivium/review.ts:559 与 src/trivium/cli.ts:731 都只传两个参数，src/trivium/archive.ts:65-82 跳过 `role === driver`，「应为 3 实得 2」正确。把它补进第 5 步范围我同意——在 review 路径上它是本轮运行自身的轮次事实，不是可以推后的独立区域。
- EV-54 纳入第 5 步我同意：doc/08_project/BACKLOG.md:151 的触发条件原文是「M9 第 5/6 步」，其理由句是「与 claude 真能入选的那一刻对齐」，而那一刻由本步的接线创造；第 4 步推后的「补了也没有路径能端到端验证」确实被 `--driver <非 claude> --critics claude` 消灭。契约侧也已就绪（run.v2 的 $defs.critic 已声明可选 override_reason 且 additionalProperties: true），所以范围裁定「只补写入方」是对的。
- §5.6 的核心推导在**今天的仓库上**站得住：84 份 run.json、162 条带角色后缀的登记条目逐条读文件头，全部含 `trivium.review.v1`，无一条是原稿或裁决件；且原稿/裁决件确实从不登记（与 src/trivium/freeze.ts:200-215 的文档块一致）。焦点一所问的「第四条写入路径」在今天的源码里也没有：`writeArtifact` 全仓只有 review.ts:1147 一处调用，review.ts 的三个 writeRunMeta 点都用 `critics_selected` 的侧，verify 阶段虽另有 artifacts 落盘点但其文件名被 writeMeta 的守卫挡住。
- R-6 的留痕口径正确且必要：run.v2.json 顶层 additionalProperties: true、driver 已在 required 而 driver_enabled 不进 required，新旧两种形状都能被 validateRunMeta 接受；`if/then` 与 override_reason 升格确实都不该做——「不可逆的一半」被识别得很准。
- §5.6 把「显式指定硬拒绝 / 自动候选先过滤」分两路并写进 D4 是必要的：R-1 的跨轮次场景我核过——locateSubject 的候选排序是 `rerunIndex desc, fileName desc`（topic.ts:104-109、topic-args.ts:565-568），日期更晚的审查件确实会排在真原稿前面，一律硬拒绝会把一条合法工作流永久锁死。
- §5.2 用 `ok: true` 的 CheckResult 承载提示是对的：src/trivium/preflight.ts:604-641 的 `checks.every` 短路与 `failed = find(!ok)` 决定了判 false 会把提示变成失败，且 CheckResult 同时喂 --json 与人读两条输出。
- §4.1「不要再写自己构造入参调 resolveCriticSelection 的用例」这个判断正确——那条路径今天就是绿的（test/unit/critics.test.ts:292 已在），补它等于发假证明；把判据落到真实调用点的方向是对的（问题只在于几处判据的实现细节）。
- §5.1 判断 `--driver` 无需登记即可被 parseArgs 接受（src/trivium/cli.ts:80-110 对非布尔旗标不做白名单），以及 §5.3 把 `driver` 加进 STATIC_FLAGS 让 isKnownFlag/findSwallowedFlags 自动覆盖，都与源码一致。
- §1.3 的三条完成判据可判真假：V1（J8 安全不变量：自己是自己的审核者必退 64）与 V4（跳过数 3→2）都能被机器核，不是形容词。

## 未覆盖范围（本侧盲区）

- 本次没有执行任何构建、安装或流水线运行（工作树只读），`--driver` 的端到端行为、桩运行、改名与回滚路径都未实跑；CODEX-05 的结论是「静态枚举 84 份归档 run.json + 源码写入方清点」的结果，不是一次真实流水线的反证。
- 适配层（src/trivium/adapters/*）在非缺省 Driver 下的 argv 生成、deny 注入、轨迹能力分档未逐条核；hooks.ts 的提交锚与 Bash 侧（EV-55）、gate.ts / report.ts 的误算面、naming.ts 的后缀集只做了 grep 级判断。
- 设计文档正文与 PRD 未读（只读了 doc/02_design/README.md 的索引与 doc/08_project/BACKLOG.md），因此「§6.1 明写保留不校验 driverEnabled」「AC-18 只背书『覆盖后的模型可见』」这类转述我按计划采信，未回原文核对。
- 第 6 步验收剧本与配额上限（.reviews/M9-ClaudeCode审核者接入/...-revised-claude.md §2.15）本身的成本核算未核；D3（`--stage all` 是否拒绝 `--driver`）我未给独立结论，也没有评估把 5.4 提前到 5.3 之前的切法是否更好。
- 打包产物（skills/dual-critic/scripts/trivium.cjs、dist/*）与源码是否同步未核——按仓库纪律它们是生成物，且我未构建。`_pending/changes.diff` 等非归档登记路径只做了源码级确认。

## 实际查阅的项目文件

- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-18-M9-Driver旗标全链路与选侧收口-claude.md`
- `.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-revised-claude.md`
- `doc/08_project/BACKLOG.md`
- `doc/02_design/README.md`
- `doc/01_requirements/README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/critics.ts`
- `src/trivium/topic.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/meta.ts`
- `src/trivium/preflight.ts`
- `src/trivium/verify.ts`
- `src/trivium/freeze.ts`
- `src/trivium/render.ts`
- `src/trivium/types.ts`
- `src/trivium/naming.ts`
- `src/trivium/doctor.ts`
- `src/trivium/code-stage.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/adapters/stub.ts`
- `test/unit/deny-matrix.test.ts`
- `test/unit/preflight.test.ts`
- `test/unit/topic-args.test.ts`
- `test/unit/topic.test.ts`
- `test/unit/critics.test.ts`
- `test/unit/archive.test.ts`
- `test/helpers/critic-fixtures.ts`
- `test/integration/code-stage.test.ts`
- `test/integration/bug-stage.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/integration/fault-injection.test.ts`
- `test/integration/command-trace.test.ts`
- `.reviews/**/_meta/run-*.json（84 份，只读枚举 artifacts 与 critics_selected）`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":72,"project_reads":42}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
