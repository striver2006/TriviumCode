# doctor 覆盖旗标提示与 `--start` 共享根检查（EV-245 / EV-246）· 计划 r1

> - **执笔**：claude（当轮 Driver）
> - **日期**：2026-10-18
> - **起点**：`7fc1f38a`（工作树只有 BACKLOG EV-245 一行口径改动未提交，属本主题）
> - **上位**：BACKLOG EV-245、EV-246（M12 收口时登记，主设计 16.1 M12 行残余 ②③）；用户 2026-10-18 定的口径（见任务目标）
> - **分档**：A 档（改 doctor 判键与输出、改 `--start` 的告警复查调用链），`/dual-run` 计划双审 + 代码双审
> - **配额**：零真实调用（双审本身除外）；单测、桩级集成用例与新旧产物对照，扫描家目录全程钉到夹具
> - **行号**：取自 `7fc1f38a` 的源文件，不取 `dist/`

---

## 0. 执笔方先定下的取舍

| # | 取舍 | 本计划的选择 | 备选与不选的理由 |
| :--- | :--- | :--- | :--- |
| D-1 | doctor 的提示走哪个出口 | **进 `report.warnings`**（一条字符串），人读模式由既有的 `warn()` 循环打印，`--json` 里是 `warnings` 数组多一个元素 | 进 `notes`：notes 里是几十行探针流水，提示会被埋掉——EV-245 的病根正是「静默」；新增 JSON 字段（如 `unused_overrides`）：改了 `--json` 的形状，用户要求既有字段不变，新增字段虽不算改既有字段，但没有消费方，徒增契约面。`warnings` 的既有定义就是「不影响退出码、但不该被划过」（`doctor.ts:96-105`） |
| D-2 | 「doctor 不消费」怎么判 | **按运行期实际消费记录判**：runDoctor 里新增唯一的取值助手 `overridesFor(id)`，Codex、Claude 两段改经它取覆盖值（它顺手记下「这一家的覆盖被读过」）；全部段跑完后，用户写了覆盖、却没被读过的那几家进提示。**不维护「哪几家消费」的清单，源码里不写 gemini / glm** | 静态清单（`DOCTOR_OVERRIDE_CONSUMERS = ['codex','claude']`）：又一处要随实现进度手工同步的枚举，第五家接上探针、忘了改清单时提示就错（焦点 1）；按 `agent.id` 硬判：同上 |
| D-3 | 没用上的原因怎么说 | 按该家探测段本次的实际去向分三种，同一条提示里分组列出：① 该段**跑了**（`probedSections` 或 `fixtureFailed` 有它）但没读覆盖 ⇒「这几家的探测不读命令行覆盖值，用的是各自固定的探测口径」；② 被 `--only` 滤掉 ⇒「本次 `--only 〈值〉`，没有探测它」；③ 两者都不是（已登记、doctor 里尚无该段）⇒「doctor 尚无这一家的探针」。三种都由运行期集合推出，第五家落在哪一格由它在 doctor 里有没有段、段里读不读覆盖决定，不需要改提示代码（焦点 1） | 只出①：`--only agy --model-codex X` 时 codex 的覆盖同样没用上，静默同样会误导；第五家无探针时①的「固定探测口径」是错话 |
| D-4 | 提示正文的措辞精度 | 用「固定的探测口径」而不是用户原话「固定探测模型」：agy 段用的是固定的只读 Agent（不选模型），zcode 段按**配置**的 plan 阶段档位取探测模型（`zcodeProbeModel`，`adapters/zcode.ts:963-966`，不读命令行一级），两者都「不随命令行覆盖变」，但 zcode 的模型并非写死。只列**旗标名**、不列取值（取值可能很长，也不需要回显） | 照抄「固定探测模型」：对 zcode 不准；回显取值：无收益 |
| D-5 | doctor 模型旗标的判键 | `cmdDoctor` 在 `collectModelOverrides` 之后调 `assertModelOverrideKeys(cfg, driver, keys, CRITIC_AGENT_IDS)`——与同函数里档位旗标的 `assertTierFlags(…, CRITIC_AGENT_IDS)` 同一份判定、同一个 `picked`、同一个 `driver`（`resolveDriver` 只算一次，两处共用）；次序：档位旗标（不动）→ 模型键 → 模型空值（「先键后值」与 `review` / `preflight` 同） | 把模型键挪到档位之前：会改变「档位与模型同时写错」时先报哪条，与本题无关的行为变化 |
| D-6 | `--start` 的检查放在哪 | `startRun` 的告警汇总（`run-protocol.ts:592-602`）里，在 `checkTierCombos` 之后、`mustReadPruned` 之前追加 `checkSharedReadRoots([rc.meta.driver, ...rc.sides])` 的结果（null 不追加）。与预检同一个函数、同一个 `relevant` 口径（`preflight.ts:1100-1103` 传的是 `[driver, ...selected]`）。`finished_inline` 分支不走这里，仍为 `[]`；同步 `review --stage` 不加（与副本源、失联阈值两项复查同口径：手工调试入口） | 放进 `prepareRun`（`review.ts`）：那里的校验都是阻断级，告警归 `startRun` 的复查是 EV-123 以来的分工；放在 `mustReadPruned` 之后：既有用例按「前三项在前、剔除条目在后」读 |
| D-7 | 告警正文里「不影响本次预检」 | `checkSharedReadRoots` 与 `summarizeSharedRootProblems` 各加一个可选的场合参数，缺省值就是今天的「本次预检」；`--start` 传「本次运行」。预检侧调用不改、输出逐字节不变 | 原样复用：`--start` 的告警会说「不影响本次预检」，是错话；把两处都改成中性措辞：改了预检既有输出，既有用例（`entry-collisions.test.ts:294`）与 M12 的对照读数都要动 |
| D-8 | 测试隔离 | 扫描家目录仍只有一个来源（`entryScanEnv()`），`cli()` 已缺省钉到空夹具（`test/helpers/fixture.ts:193`），经 `cli()` 跑 `--start` 的既有用例自动隔离。U8 对账（`entry-scan-isolation.test.ts:59-80`）把论域扩到 `startRun`：直调 `startRun` 的文件要调 `isolateEntryScanHome()`，自己 spawn 打包产物跑 `--start` 的文件要登记理由 | 给 `ReviewOptions` 加注入口：要穿过交接文件之外的整条选项链，而唯一的读点在 `startRun`，环境变量已够用 |

---

## 1. 问题与现状（源码核实）

### 1.1 EV-245

- `cmdDoctor`（`src/trivium/cli.ts:815-818`）：档位旗标经 `assertTierFlags(cfg, resolveDriver(--driver).driver, …, CRITIC_AGENT_IDS)` 判键；模型旗标 `collectModelOverrides`（收集面 `ALL_AGENT_IDS`，`:397-411`）之后只有 `assertFlagValuesGiven('model', …)`，注释原文「doctor 不判模型覆盖的键（现状，不在 EV-228 范围）」。
- `runDoctor` 只在两处读覆盖：Codex 段 `resolveTier(cfg, 'codex', 'code', {...opts.tierFlags?.codex, model})`（`doctor.ts:761-762`）、Claude 段同形（`:803-804`）。Antigravity 段用配置里的 `bin` / `agent`（`:675-680`），ZCode 段的探测模型是 `zcodeProbeModel(cfg)`（`:700`），两段都不读 `opts.tierFlags` / `opts.modelOverrides`。
- 于是 `doctor --model-gemini X`、`--tier-glm high`、`--effort-gemini …` 照常退 0，值不生效也不提示。键判定上，`CRITIC_AGENT_IDS`（`agents/registry.ts:420`）今天等于全部四家，档位旗标的判键实际全部放行；模型旗标补上同一份判定后**对现注册表同样全部放行**——它只在「登记了第五家、未启用为审核者」时可达（`assertCriticFlagKeys` 的 `picked` 不含它 ⇒ 退 64，`critics.ts:148-180`）。本题的可见行为变化只有提示一条。

### 1.2 EV-246

- 预检 ④⁵（`preflight.ts:1099-1103`）调 `checkSharedReadRoots([driver, ...selected], opts.entryScanEnv)`（`:841-856`）：只看本轮 Driver ∪ 入选审核者里登记了额外读取根的家，无问题返回 null，有问题一行（`summarizeSharedRootProblems`，`entry-collisions.ts:336-349`，结尾「（不影响本次预检）」），扫描出错也只退化为一条告警。
- `startRun` 的告警复查（`run-protocol.ts:592-602`）只有三项：`checkModelOverrideSource`、`checkHeartbeatThreshold`、`checkTierCombos`，末尾接 `rc.mustReadPruned`。没有共享读取面一项——终端直接跑 `--start` 或 skill 漏跑预检时看不到告警（`review.ts:756-760` 的注释正说「只在预检做的话，终端直接跑 `--start` 就绕过了」，但那段只补了阻断级的两项）。
- `--start` 的 `warnings` 恒在、形状 `{ name, detail }[]`（`run-protocol.ts:410-417`），JSON 原样输出（`cli.ts:747`），人读模式逐条打 `detail`（`cli.ts:752`）。

---

## 2. 改动面

### 2.1 EV-245（`cli.ts`、`doctor.ts`）

1. `cmdDoctor`：`const driver = resolveDriver(flagString(args, 'driver')).driver;` 提出来两处共用；`collectModelOverrides` 之后补 `assertModelOverrideKeys(ctx.config, driver, Object.keys(modelOverrides), CRITIC_AGENT_IDS)`，再 `assertFlagValuesGiven`；删掉「doctor 不判模型覆盖的键」那句注释，改写为与档位旗标同一份判键的说明。判定通过后收窄类型的写法照 `review` 那处（`cli.ts:686`）。
2. `runDoctor`：
   - 新增 `const consumedOverrides = new Set<string>()` 与助手 `overridesFor(id)`：返回 `{ ...opts.tierFlags?.[id], ...(opts.modelOverrides?.[id] ? { model } : {}) }` 并把 `id` 记进集合。Codex、Claude 两段改调它，合并结果与今天逐值相同。
   - 「尚无探针实现」循环之后、`generated_at` 之前：`const hint = describeUnusedOverrides({ tierFlags, modelOverrides, consumed, ran, only })`，非 null 则 `warnings.push(hint)`。`ran` = `probedSections ∪ fixtureFailed`（按 cliName）。
   - `describeUnusedOverrides` 导出为纯函数：按注册表顺序遍历用户写了覆盖的 id，id → `agentById(id).cliName`，按 D-3 分三组；每组一行，行首是旗标名（`--model-〈id〉`、`--tier-〈id〉`、`--effort-〈id〉`、`--profile-〈id〉`、`--native-〈id〉`，按这个顺序），后接显示名与原因；首行固定为「以下命令行覆盖本次没有用上（只是提示，退出码与探测结论不受影响）：」。全部被消费时返回 null。
3. 退出码仍是 `report.blockers.length === 0 ? OK : ENV`（`cli.ts:842`），提示不进 blockers；`--json` 的五个字段不变。

### 2.2 EV-246（`entry-collisions.ts`、`preflight.ts`、`run-protocol.ts`）

1. `summarizeSharedRootProblems(problems, home, occasion = '本次预检')`：结尾括号里的词取 `occasion`。
2. `checkSharedReadRoots(relevant, inject?, occasion = '本次预检')`：透传给上一条；扫描出错那句同样取 `occasion`。
3. `startRun`：告警汇总里 `tierCombos` 之后追加 `...(shared ? [shared] : [])`，`shared = await checkSharedReadRoots([rc.meta.driver, ...rc.sides], undefined, '本次运行')`。函数内部已吞掉扫描异常，不会把 `--start` 变成失败；位置在主 `try` 之内（与副本源复查同理，`run-protocol.ts:570-572` 注释）。
4. 文档块：`startRun` 的复查注释与 `StartOutcome.warnings` 的字段注释补第四项；`checkSharedReadRoots` 的文档块写明两个调用点（与 `checkHeartbeatThreshold` 文档块同形）；`checkDeprecatedConfigKeys` 文档块里「`review --start` 不复用它——那里复用的两项」这句随之改成「复用的几项」并补说明（已废弃配置键仍不进 `--start`，不在本题范围）。

### 2.3 测试

| 编号 | 文件 | 内容 |
| :--- | :--- | :--- |
| U1 | `test/unit/doctor-unused-overrides.test.ts`（新） | 纯函数：①全部消费 ⇒ null；②gemini 的模型 + glm 的档位、两段都跑了 ⇒ 一条，含两个旗标名与「固定的探测口径」；③`only: 'agy'` 时 codex 的覆盖 ⇒ 「本次 `--only agy`」；④已登记、未跑、未滤（第五家无段）⇒「尚无这一家的探针」；⑤旗标名顺序与注册表顺序；⑥不含取值 |
| U2 | 同上 | 经 `runDoctor`（`isolateEntryScanHome()`）：`only: 'env'`、`skipModelCalls`、`modelOverrides: { gemini: 'x' }` ⇒ warnings 末项是提示、blockers 不变；不写覆盖 ⇒ warnings 与不传时 `deepEqual`；`only: 'zcode'` + `zcodeProbe` 注入（照 `zcode-provider-env.test.ts:581` 的形态）+ `tierFlags: { glm: { tier: 'high' } }` ⇒ 原因是①；`only: 'codex'` + `probeBins` 假 codex + `modelOverrides: { codex }` ⇒ 无提示（消费被记下） |
| U3 | 同上 | 源码护栏：`doctor.ts` 里 `opts.tierFlags` / `opts.modelOverrides` 只出现在 `overridesFor` 体内（第五家新段绕过助手直接读覆盖时当场红，焦点 1） |
| U4 | `test/integration/tier-flags-cli.test.ts` | doctor `--only env --no-model-calls --model-gemini x --tier-glm high --json`：退 0；JSON 顶层键集合与不带旗标时相同；`warnings` 比不带旗标时恰多一条且以「以下命令行覆盖」开头；人读模式同样出现 |
| U5 | `test/unit/tier-flags.test.ts` 或新文件 | 判键接线：`cmdDoctor` 源码段里 `assertModelOverrideKeys(` 的第四个实参是 `CRITIC_AGENT_IDS`、与 `assertTierFlags(` 同一个 `driver` 变量，且位于 `assertFlagValuesGiven('model'` 之前；行为面由既有 `assertCriticFlagKeys` 桩描述符用例覆盖（「已登记未启用」退 64），本题核一眼并在报告里列出用例名 |
| U6 | `test/integration/shared-root-start.test.ts`（新，桩、零配额） | `TRIVIUM_ENTRY_SCAN_HOME` 指向摆了同名入口的夹具：①缺省入选（含读共享根的家）`review --start --json` ⇒ `warnings` 末项前一项（`mustReadPruned` 之前）是 `{ name: '共享读取面同名入口', detail }`，`detail` 以「⚠️ 共享读取面」开头、以「（不影响本次运行）」结尾；退 0、运行照常拉起；②人读模式出现同一行；③`--critics` 只选不读共享根的家、Driver 也不读 ⇒ 无此项；④Driver 是读共享根的家、入选审核者都不读 ⇒ 有此项（守住「含 Driver」）；⑤指向空夹具 ⇒ `warnings` 与改前 `deepEqual`（即既有断言形态） |
| U7 | `test/unit/entry-collisions.test.ts` | `summarizeSharedRootProblems` 缺省参数输出与今天逐字相同（既有 `:294` 断言不改）；传「本次运行」时只有括号里的词不同 |
| U8′ | `test/unit/entry-scan-isolation.test.ts` | `IMPORTS_ENTRY` 加 `startRun`；spawn 判据把 `'--start'` 并进 `'doctor' / 'preflight'`；新命中的文件逐个核：走 `cli()` 的不算，自己 spawn 打包产物的登记理由 |

既有「`warnings` 为空」一类断言（如 `heartbeat-threshold-warning.test.ts:79`、`:123`）经 `cli()` 跑、扫描家目录是空夹具 ⇒ 不受影响；全量里任何一格因此变红都按回归处理，不改断言（焦点 3）。

---

## 3. 变异（`scripts/mutation-check.mjs`，规格用生成脚本从源码截锚点）

| # | 变异 | 期望变红 |
| :--- | :--- | :--- |
| M1 | Codex 段不经 `overridesFor`、改回内联合并 | U3 |
| M2 | `overridesFor` 不记消费 | U2「codex 消费 ⇒ 无提示」 |
| M3 | 提示推进 `blockers` | U2 / U4（退出码、blockers 不变） |
| M4 | `describeUnusedOverrides` 把 `--only` 滤掉的一律归到原因① | U1 ③ |
| M5 | 第五家无段归到原因① | U1 ④ |
| M6 | 删 `cmdDoctor` 的 `assertModelOverrideKeys` | U5 |
| M7 | `cmdDoctor` 判模型键的 `picked` 换成 `[]`（写错口径） | U4（`--model-gemini` 退 64） |
| M8 | `startRun` 不追加共享根项 | U6 ① |
| M9 | `relevant` 只传 `rc.sides` | U6 ④ |
| M10 | 共享根项挪到 `mustReadPruned` 之后 | U6 ①（位置） |
| M11 | `--start` 不传场合参数 | U6 ①（结尾） |
| M12 | 缺省场合参数改成「本次运行」 | U7 |

集成类变异（M8～M11、M3/M7 的集成格）预跑用 `--with-tests` 的变体（批次 1 的坑）。

---

## 4. 新旧对照验收（零真实调用，`git archive 7fc1f38a` 导出旧构建）

- **A-1 doctor**：HOME 与扫描家目录钉到夹具，`doctor --only env --no-model-calls` 四格（人读 / `--json` × 不带覆盖 / 带 `--model-gemini x --tier-glm high --effort-glm high`）。判据：不带覆盖两格新旧规范化后逐字节相同；带覆盖两格退出码新旧相同（0），`--json` 顶层键集合相同，新 `warnings` = 旧 `warnings` + 末尾一条提示，其余逐字节相同。
- **A-2 `--start`**：桩审查员（与 U6 同一套），干净扫描家目录 × 人读 / `--json` 两格，新旧规范化（run_id、pid、时间戳、路径、主题名）后逐字节相同（焦点 4）；摆了同名入口的扫描家目录两格，旧版无此项，新版恰多一项、其余相同。
- 新旧两份 bundle 记 sha256 并断言不同。脚本与读数放 `doc/05_testing/evidence/doctor-flags-start-shared-root-20261018/`。

---

## 5. 文档同步

- **主设计**：8.1 预检表「共享读取面同名入口」行「`review --start` 不做」改为在 `--start` 复查里同一函数、场合词不同；`--start` 返回 `warnings` 那段（1729 行附近）来源由三个改四个；doctor 的覆盖旗标说明处（1471 行「`doctor` 仍不判模型覆盖的键」与 7.1 档位旗标节）补判键与提示；16.1 M12 行残余 ②③ 标注已由本题修复；修订记录加 v1.3.169。
- **BACKLOG**：EV-245、EV-246 翻 done，写落点与报告。
- **使用手册** `doc/07_manuals/MANUAL_user.md`：覆盖旗标一节（512～522 行附近）补「doctor 只在 Codex、Claude Code 两段用这些值，写给其他家会给一条提示、不改退出码」；`--start` 开场告警的说明补共享读取面一项（若手册无此段则在预检告警处补一句）。
- **测试报告**：`doc/05_testing/REPORT_2026-10-18_doctor_flags_start_shared_root.md`，并登记 `doc/05_testing/README.md` 索引（`doc-archive-index` A2）。

---

## 6. 不做

- 已废弃配置键（EV-30 ①）不进 `--start`，维持「只在预检与 doctor 出」的用户决策。
- 同步 `review --stage` 不加共享根检查（与其他两项复查同口径）。
- doctor 不新增 `--critics` 或「本轮入选」概念；也不让 Antigravity / ZCode 段改为读覆盖值。
- 不改 `summarizeSharedRootProblems` / `describeSharedRootProblems` 的判定与计数，只加场合词。

## 7. 风险

- 提示放 `warnings` 后，若有外部脚本拿「doctor `warnings` 为空」当健康判据，带了无效覆盖的调用会多一条——这是本题要的可见性，退出码不变。
- `--start` 多一次目录扫描：只读几个目录，耗时毫秒级；扫描异常已在函数内吞成告警。
- U3 是按源码文本的护栏，能被改名绕过；兜底是 U2 的行为格。
