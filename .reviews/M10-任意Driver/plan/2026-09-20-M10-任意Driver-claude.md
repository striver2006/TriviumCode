# M10 · 任意 Driver 实施计划

- **日期**：2026-09-20（**2026-09-21 刷新**：F-8 两个小主题 EV-81 / EV-82 均已提交，本稿据此更新起点、基线、F-3 / F-4 / F-8 / P-4 / R-b 与 §8.2 / §12 的 glm 口径；其余段落未动）
- **起点**：`17f88ac`（EV-82 结案，设计 v1.3.33；上一稿写的 `f4f3970` 之后合入了 `98b2fd3` EV-81 与 `17f88ac` EV-82 两次提交），`main` 干净、已推送
- **基线核实**：`npm run check` 刷新当日复跑 **1566 用例 / 1564 通过 / 2 跳过 / 0 失败，exit 0**（不是转述；上一稿 1495）
- **本计划审的跑法**：`--critics codex,gemini,glm --model-glm GLM-5.3-Flash`——三侧跑；`--model-glm` 必须给非首位模型，因为 EV-82 的守卫在请求 provider 首位模型（本机默认档 `GLM-5.3`）时分不出「读到了副本」与「回落到首位」。这次运行同时充当 EV-82 结案判据里最后一条「一次含 glm 的真实双审」：跑完核 `run.json` glm 段 `model_route: config_copy`、`model_override_applied: true`、`model_effective` 的 modelId 段 = `GLM-5.3-Flash`
- **依据**：主设计 §16.1 M10 行（含四条前置）、§7.1 `--driver` 段、§8.5 引言块（护栏分级表 + `--agent` 不得成为第二判据源）、
  §18.1 #16、§24.1 台账三行；演进设计 §5.2 / §7.5 / §9.3 / §9.4 / §10.2；PRD FR-28 / AC-21 / S6；
  BACKLOG **EV-55 / EV-72 / EV-77**（前置）、**EV-06 / EV-07 / EV-61 / EV-62 / EV-64**（范围内连带）、EV-74 / EV-79（触发条件写「M10 前」，见 §1.3）
- **实测依据**：[M6 入口承载面报告](../../../doc/05_testing/REPORT_2026-09-15_m6_driver_entry_probe.md)（§2 codex、§3 zcode、§4 agy、§8 结论表）；
  [M9 验收报告 r2](../../../doc/05_testing/REPORT_2026-09-20_m9_claude_critic_acceptance_r2.md)（名义 Driver 载体的四条达成边界）
- **明确不读**：演进设计 §7.2（已作废）；演进设计 §9.3 关于「`isForgedRoleFile` / `bashTargetsProtected` 字面集按 `--agent` 动态生成」那句——
  已被主设计 §8.5 注记取代，`--agent` 只能是安装目标与身份声明，**当轮 Driver 的判定来源只有留痕**

---

## 0. 开工核实结果

没有 M10 交底文档。下面是我按 §16.1 M10 行与 BACKLOG 逐条对源码核出来的现状，**每条带证据位置**。

### 0.1 §16.1 M10 行的四条前置——现状

| 前置 | 状态 | 证据 | 本计划落点 |
| :--- | :--- | :--- | :--- |
| ① agy skills 真实加载行为实测 | **未做**。M6 第 4 步只有静态证据（二进制内嵌迁移表 + `--disable-slash-commands` 旗标帮助），报告 §4.3 自己写着「M10 落地前必须补一次行为实测」 | 报告 §4.2 / §4.3；设计 §18.1 #16 仍「未拍板」 | 第 1 步 |
| ② EV-55 跨时间面重写 | **todo**。提交锚 `immutableChangeReason` 与 Bash 侧 `roleSuffixAnywhere()` 仍按 `criticRoleSuffixes(DEFAULT_DRIVER)`（全集减**缺省** Driver）取值 | `src/trivium/hooks.ts:487-508`、`:805-807`、`:852-854` | 第 3 步 |
| ③ EV-71 会话载体 | **已关闭**（名义 Driver，经 `gate hook-pre-write` 直喂实测）；**真载体残量转 EV-77，todo** | BACKLOG EV-71 / EV-77；设计 §16.1 M10 行前置 ③ 注记 | 第 7 步 |
| ④ EV-72 主题级 driver 落盘 | **todo**。`resolveRoundDriver` 第 2 级在该阶段零留痕时回落 `DEFAULT_DRIVER`；`task.json`（`trivium.task.v1`）没有 `driver` 字段 | `hooks.ts:354-375`；`meta.ts:59-66` `TaskMeta` | 第 2 步 |

### 0.2 §16.1 M10 行范围栏各项——现状

| 范围项 | 现状 | 证据 |
| :--- | :--- | :--- |
| 四家入口资产与单源渲染 | 7 份入口 `SKILL.md` 全是 claude 载体、手写、B/C/D 三份逐字同构；**没有** `skills-src/` 与渲染步骤 | `skills/dual-*/SKILL.md`；`scripts/build.mjs` 无渲染 |
| install 多目标 | `defaultTargets()` 只有两项：`~/.claude/skills`（skills）与 `~/.gemini/config/agents/trivium-critic/agent.md`（只读审查者 agent 定义）。**没有**按注册表派生的目标表 | `src/install.ts:24-36` |
| `hooks --agent` | CLI 无该子命令；`hooks.json` 四条命令串静态、不带任何身份参数（EV-68 关闭时三侧核实「Hook 命令不必带 driver」——当轮判定由 Hook 进程自行读留痕） | `skills/dual-critic/hooks/hooks.json`；`cli.ts` USAGE |
| `approve` 前置复核 | **未做**。`cmdApproval` 直接 `recordApproval`，没有 `checkAdjudication`；有复核的是 `gate --await-approval` 那条路（AGY-02 加的） | `cli.ts:1240-1300`（approve）vs `cli.ts:938-975`（await-approval） |
| 协议片段两段式 | `protocol/` 只有 `CLAUDE.md.snippet`（Driver 协议）与 `AGENTS.md.snippet`（审查员身份）两份**单段**文件；`init.ts` 写死两条落点路径、**不读** `instructionFiles`（EV-06 原文成立：全仓生产代码零消费方） | `init.ts:386-393`；`grep -rn instructionFiles src` 只命中注册表与注释 |
| 翻 `driverEnabled` | 三处 `false // M10 启用`；`resolveDriver` 放行 + 标注；`run.v2.driver_enabled` 如实落盘 | `registry.ts:204/218/232`；`critics.ts:142-148`；`preflight.ts:627-635`；`review.ts:520/885` |
| 「当轮 Driver 不得入选」对非缺省 Driver 有用例 | **已有**：`critics.test.ts:120` 传 `driver: asCritic`（`CRITICS[0]`，非缺省）；`resolveCriticSelection` 的判定不依赖 `criticEnabled` | `test/unit/critics.test.ts:113-131` |

### 0.3 我核出来的、M10 行没写的七条事实（本计划的主要增量）

| # | 事实 | 证据 | 后果 / 处置 |
| :--- | :--- | :--- | :--- |
| **F-1** | **`guardLevel` 在注册表登记了四家，生产代码零消费方**——只在测试夹具里出现。与 EV-06 的 `instructionFiles` 同形：登记而未接线 | `grep -rn guardLevel src test`：仅 `registry.ts`、`registry-parity.test.ts:79`、`overlay.ts:239` | AC-21 要求「护栏差异对使用者明示」，明示的事实源就该是它。第 4 步给它接上消费方（预检打印 + 留痕 + 文档），否则 M10 收口时 F-1 与 EV-06 一起成为「第三个 EV-06」 |
| **F-2** | **glm 的 `guardLevel: 'L1'` 是未经实测的登记**。设计 §3.3 与 M0 报告对 zcode 都没有任何 Hook 记载（M0 只记了 agy 的 plugin hook）；演进设计写的是「ZCode Hook 支持（形态探针定；通过则 L1，否则 L2）」 | `grep -in hook` 于设计 §3.3 段零命中；`REPORT_2026-09-11_m0_probe.md:123` 只提 agy | 第 1 步实测；不通过就把注册值翻 L2 并如实写文档，**不伪装** |
| **F-3** | **codex 的 `$ARGUMENTS` 展开同样只有静态证据**（M6 报告 §2 引的是 0.154.0 内嵌撰写规范原文，不是回显实测）。且本机四家版本都动了：agy **1.2.7**（报告 1.2.2）、codex **0.155.1**（报告 0.154.0）、claude 2.1.277、zcode **0.16.9**（探针记录已更新；连带撞出 F-8，现已结） | 报告 §2「参数展开」段；`--version` 与 `doctor --only zcode`（2026-09-21 复跑，`model_override=config_copy`） | 第 1 步把三家的「skill 加载 + 参数展开」一并做**行为实测**，版本记进报告 |
| **F-4** | **`zcode` 不在 PATH**。编排器按 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` 定位（本机存在，0.16.9），审核者链路不受影响；但「ZCode 当 Driver」的真载体是 ZCode 的交互会话，不是 `node zcode.cjs -p` | `probes/zcode.ts:31-32`；`which zcode` 无 | AC-21 要 zcode 真实一轮。第 1 步先确认 ZCode 交互会话（CLI 或桌面端）能否加载 user 级 skill 并执行 `.trivium/bin/trivium`；确认不了就把「zcode 真实」降为「夹具级」并**如实登记为达成边界**，不改验收口径本身 |
| **F-5** | **`--driver` 今天不进入口资产**，且命令 A 显式拒绝它（`topic-args.ts:352-358`）。这是 M9 第 5 步计划双审 §2.14 的裁定，理由是「M10 之前四条命令的执笔者就是本会话的 Claude Code」——**M10 就是那个「之前」的终点** | 设计 §7.1 该段；`topic-args.ts:346-358` | 第 5 步推翻该限定：每家渲染出的入口资产**自带** `--driver <id>`（入口资产自己知道身份，演进设计 §5.2），命令 A 同步放开。这是契约变更，列入不可逆决策 D7 |
| **F-6** | **EV-07 状态列陈旧**：`disposition.v1.json` 的 `role` 已在 EV-66（v1.3.29）放宽为 `type: string`，BACKLOG 仍 todo；`registry-parity` 的 `LITERAL_ALLOWLIST` 第 270 行仍留着「Driver 任意化排在 M10」的豁免理由 | `disposition.v1.json:13-14`；`registry-parity.test.ts:270` | 第 4 步核实 `types.ts` 侧字面是否仍存在、豁免是否仍被需要，然后**结案而不是顺手删豁免**（EV-39 的口径：豁免要有「仍被需要」的腿） |
| **F-7** | `CASE_manual_acceptance.md` **没有 S6 剧本**；`selftest.ts` 零处 `driver`——自检链路只会以缺省 Driver 跑 | `grep S6` 仅命中标题引用行；`grep -c driver selftest.ts` = 0 | 第 7 步补 S6 剧本；selftest 是否扩非缺省 Driver 场景在第 7 步按成本决定（不列为完成判据，因为 §16.1 没写） |
| **F-8** | **ZCode 0.16.9 独立拉起时找不到内置 provider 配置，本机 glm 侧探活当前失败**（`preflight` 退 69）。根因：0.16.9 的 `zcode.cjs` 按**入口文件目录**推算 `zcode-builtin.json`，两条候选（`<入口目录>/provider/…` 与 `<入口目录>/../../../../../config/provider/…`，后者是源码树布局）在应用包内都不存在；真实文件在 `Resources/config/provider/zcode-builtin.json`。桌面端启动 CLI 时通过环境变量 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` + `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`（后者指 `~/.zcode/v2/provider_config.json`；上一稿写「须同时给」已被 EV-88 推翻——`FZi` 会在成对检查前合成缺失键，headless 路径只给内置那份即可）传路径；我方 `invokeZcode` 只透传 `HOME`，不传这两个。**本会话带上两个变量复跑 `preflight --stage plan` 整份通过（exit 0）**，假设已验证 | `zcode.cjs` 内 `LZi` / `resolveNodeProviderRuntimePaths` 字面；`app.asar` 内 `DC()`（packaged 取 `resourcesPath/config/provider/…`）；`adapters/zcode.ts:121-127` `invokeZcode` 的 `env` 只有 `HOME`；最近一次 glm 成功留痕 `run-20260919T154710Z` 记 `cli_version 0.16.5` | **不在 M10 范围**，但它卡住两件事：本主题的计划审默认三侧含 glm；M10 第 1 步 2.3 的 zcode 实测要靸 headless 跑通。修法是**改适配层**（纪律 1）：`invokeZcode` 注入两个变量，内置路径按入口派生（`resolve(dirname(entry), '../config/provider/zcode-builtin.json')`）并由探针落盘存在性、个人路径取 `~/.zcode/v2/provider_config.json`；`homeDir` 隔离副本下两条绝对路径不受影响。建议**另开小主题先修**（见 P-4）。**2026-09-20 更新：已按 P-4 ① 在小主题 `zcode-provider配置注入`（EV-81）落地**——适配层存在性门控注入两个变量、`failureKind` 增 `provider_config_unresolved`、探针增 `provider_config` 事实格与 `indeterminate` 第三态；实测另挖出两条同根因事实（P-29：定位先于参数解析，2026-09-19 的 `readonly_flags` 结论被污染成七个全接受；P-30：个人 provider 配置自带默认模型，旗标探针只能注入内置那份）。事实登记 M0 报告 §7 P-28～P-30、设计 v1.3.31。该主题代码双审只能 codex + gemini 两侧。**2026-09-21 更正：上句「已落地」只对「glm 侧起不起得来」成立**——该主题 r2 代码双审的 CODEX-05 实测发现 glm 侧探活能过但静默跑在个人配置默认模型（本机是 `qwen3.8-max`，与 codex 同家族），另立 **EV-82**。**2026-09-21 收口：EV-81 提交 `98b2fd3`（五轮代码双审）、EV-82 提交 `17f88ac`（两轮计划双审 + 三轮代码双审）。** EV-82 的根因不是「0.16.9 删了 `model.main` 读取点」，而是 EV-81 自己注入的个人变量让 CLI 跳过 legacy 导入（个人文件存在就直接用）；修法（路线 L）：审查运行的副本 HOME 下**不注入**个人键，模型限定按副本源 `cli/config.json` 自己的 provider 成员做（与包内导入器同一组规则），`probe.model_override` 改为零配额探针臂实测，守卫 `model_override_applied` 在请求模型未生效时播报。真实 0.16.9 上探针臂写出的 `defaultModelSelection` = 请求的 `bigmodel-coding-plan/GLM-5.3-Flash`。**glm 的审核者禁用已解除，本计划审三侧跑**；含 glm 的运行要带 `--model-glm GLM-5.3-Flash`（见抬头「本计划审的跑法」）。残量：EV-87（探活/探针路径仍指真实个人文件，本日实证归因到桌面端）、EV-93（`model_id_form` 补前缀与目录异源）、EV-94（探针两条残量） |

### 0.4 需要项目负责人拍板的三件（计划审前）

- **P-1 EV-74 / EV-79 的处置**。两条的触发条件都写「M10 前」。EV-79 是只读失守判定的两处**静默漏检**（`rm -r --force` 降档、`&>` 不识别），且标「待双审」；EV-74 是 claude 探针的 `json_schema_ok` 从未喂过真实契约。**它们都不在 §16.1 M10 行的范围栏里。** 我的建议：**另开小主题、排在 M10 第 3 步之前**，不并入本主题——并入会让 M10 的代码双审面同时含「护栏判据」与「入口渲染」两种性质完全不同的改动。若你决定并入，本计划第 3 步加一节。
- **P-2 F-4 的验收口径**：zcode 真载体验收若本机确认不了，接受「zcode 夹具级 + 达成边界登记」还是**卡住 M10 直到接通**？我倾向前者（PRD AC-21 的原文是「claude/zcode 真实，codex/gemini 夹具级」，降级要在留痕与 PRD 上写明，不静默）。
- **P-3 渲染产物的 Git 归属**（决策 D5）：另三家的渲染产物是否提交进仓库。我倾向提交（可 diff 对账、审查员读得到），代价是每次改契约源多三份 diff。
- **P-4 F-8 的先后**：①先另开小主题修 zcode 适配层（代码双审只能用 codex + gemini 两侧，因为 glm 正是坏着的那侧），修完再以三侧跑本计划审；②本计划审先以 `--critics codex,gemini` 两侧跑，zcode 修复与 M10 第 2～4 步并行。我倾向 ①：M10 第 1 步 2.3 本来就要 zcode headless 跑通，且 glm 在 M9 多轮双审里给过别家没给的结论，计划审少它一侧是真实损失。**已拍板 ①（2026-09-20）。执行结果（2026-09-21）：小主题 `zcode-provider配置注入`（EV-81，`98b2fd3`）只解了「起不起得来」，模型覆盖失效另立 EV-82、再开小主题 `zcode-模型覆盖落点`（`17f88ac`）解掉。两者都已合入，本计划审按 ① 三侧跑，P-4 结项。**

---

## 1. 范围与完成判据

### 1.1 完成判据（抄自 §16.1 M10 行与 PRD AC-21，不自行放宽）

| # | 判据 | 出处 |
| :--- | :--- | :--- |
| J1 | AC-21：指定任一已注册 Agent 为 Driver 走完命令 B，工件命名 / 闸门停点 / 逐条裁决语义与现有 Driver 一致 | PRD AC-21 |
| J2 | AC-21 后半：Driver 不具备事前写拦截时，差异在文档中对使用者明示，且**审批前的裁决完整性由编排器侧无条件复核** | PRD AC-21、FR-28 |
| J3 | 兼容验收：claude 为 Driver 时全部工件名、Hook 行为、`.reviews` 布局**逐字节不变** | 演进设计 §5.2「兼容」 |
| J4 | ZCode / Codex Driver 夹具跑通（claude / zcode 真实，codex / gemini 夹具级） | §16.1 M10 行；演进设计 AC-N2 |
| J5 | 「当轮 Driver 不得入选」对非缺省 Driver 生效且有用例 | §16.1 M10 行 |
| J6 | 前置四条缺一不可：① agy skills 行为实测通过并拍板 §18.1 #16；② EV-55 落地；③ EV-77 真载体写事件实测一次；④ EV-72 落地 | §16.1 M10 行 |
| J7 | 纪律 6：本里程碑在 §24 台账登记的回溯条目已并入对应目标文档（含仓库根 `CLAUDE.md` 与 `skills/` 12 份资产），落本文者升次版本 | §16.1 二期表引言 |

### 1.2 明确不在本轮范围

- `--tier-<id>` / `--effort-<id>` / `--profile-codex`、`profiles` 的 `{tier}` 形态、`report` 按 Driver / 审核者双维聚合——**M11**（设计 §7.1 待实施块、§16.1 M11 行）。
- 第五家 Agent 接入；`PROSE_EXCEPTIONS` 颗粒度（EV-45，触发条件是「加条目时或接第五家时」，本轮不加条目）。
- 改 `gate` 的 Driver 事实来源——它**只读留痕**（§7.1 ④、§8.5 注记），本轮任何步骤都不给它加旗标。
- 给 ZCode 或 agy **伪造** L1：Hook 实测不通过的家一律 L2，只做文档与补偿，不做「建议态」以外的任何拦截假象（PRD FR-28「不得伪装成同等级强制」）。
- EV-74 / EV-79（见 P-1）。

### 1.3 步骤顺序与依赖

```text
第 1 步 准入实测（零行为改动）──┬──→ 第 5 步 入口资产与安装（需 ① 的拍板与 F-2/F-3/F-4 结论）
                                └──→ 第 6 步 Hook 多目标（条件步：取决于 F-2）
第 2 步 EV-72 ──→ 第 3 步 EV-55 ──→ 第 4 步 翻 driverEnabled + approve 复核 + 连带 ──→ 第 7 步 验收 ──→ 第 8 步 回溯
```

第 2～4 步是护栏与契约改动，**每步各一轮代码双审**；第 5～6 步是资产与安装器，合一轮或各一轮按 diff 体量定；第 7 步产出报告；第 8 步纯文档。
**第 3 步必须先于第 7 步的任何真实换 Driver**（EV-55 触发条件原文）。

---

## 2. 第 1 步：准入实测（**不改任何对外行为**）

产出一份报告 `doc/05_testing/REPORT_<日期>_m10_driver_entry_probe.md`，四家各一节，**每格三态**（true / false / null=没测到），带命令、原始输出摘录与负对照。版本号记进抬头（F-3）。

### 2.1 agy：skills 加载行为（拍板 §18.1 #16）

- 隔离 `HOME`（沿用 M6 第 4 步 codex 那套三条臂手法）：在 `<fakehome>/.gemini/config/skills/dualtest/SKILL.md` 放哨兵 + `$ARGUMENTS` 回显指令；print 模式发一次含 `/dualtest 甲 乙` 的调用，看回显。
- 负对照：同一调用加 `--disable-slash-commands`，哨兵应消失。
- 第三臂（排除替代假说）：`HOME` 隔离但**不放**哨兵，确认不是别的什么东西在回显。
- **通过判据**：正对照见哨兵且参数逐字回显、负对照不见。通过 ⇒ §18.1 #16 拍板「skills 优先」；不通过 ⇒ 退路是 `GEMINI.md` 契约 + 用户口述命令意图（演进设计 §7.5 第四行），gemini 侧入口资产在第 5 步降为「协议片段 + 手工 CLI」并如实登记。

### 2.2 codex：`$ARGUMENTS` 展开行为（F-3）

- 隔离 `CODEX_HOME` + `HOME`（M6 §1 结论：指令根随 `HOME`），`$CODEX_HOME/skills/dualtest/SKILL.md` 放哨兵与回显指令，`codex exec` 一次带参数调用；对照 `debug prompt-input` 只证常驻不证展开（报告 §2 边界）。
- 通过判据同 2.1。

### 2.3 zcode：加载面与 Hook 形态（F-2 / F-4）

- **加载面**（补 M6 §3.5 留下的空白）：`~/.zcode/skills` 与 `~/.agents/skills` 同名 skill 各放不同哨兵，真实调用一次看模型加载了哪份；`$ARGUMENTS` 回显。结论决定第 5 步 glm 侧安装到哪个根（若两份都可能被加载，则**只装一个根并在安装器里查另一个根的重名**）。
- **Hook 形态**：先静态——`~/.zcode/cli/config.json` 只 `grep -n` 键名（该文件含 provider 凭据，**禁止整份打印**，仓库根 `CLAUDE.md` 那条纪律）、`zcode.cjs --help`、二进制字面量扫 `PreToolUse` / `hooks` / `deny`；有线索再做行为实测：注册一条会 `exit 2` 的 Hook，发一次写工具调用，看是否被拒。
- **载体**（F-4）：ZCode 交互会话能否在项目根执行 `.trivium/bin/trivium preflight --stage plan --json`。
- **本步的 headless 拉起口径**（2026-09-21 补）：一律走 `doctor` / `preflight` / `review` 入口，不手搓脚本复刻 `prepareZcodeHome` / `scrubZcodeHome`（2026-09-20 事故与仓库根 `CLAUDE.md` 的纪律）；凭据文件只 `grep` 键名。实测中若要看 CLI 自写的 `v2/provider_config.json`，看的是**副本 HOME** 下那份（探针臂已落盘 `defaultModelSelection`），不是 `~` 下的。
- 通过判据：Hook 能拒一次写 ⇒ glm 维持 L1，第 6 步开工；否则翻 L2，第 6 步只落文档。

### 2.4 claude：无需实测

现状即基线（`~/.claude/skills/dual-*/`、Hook 五件套）。

### 2.5 本步的落盘边界

**不进机读 `ProbeSection`**，除非某格在 M10 内有运行期消费方——`guardLevel` 若按 D4 改为「登记上限 + 探针降级」，那 zcode Hook 那一格就有了消费方（预检的护栏等级标注），届时才加字段 `probe.cli.zcode.hooks_deny_ok`（三态），并同批加 `doctor` 展示；其余格只进报告（§24.1「Driver 入口承载面」行的口径：塞没有消费方的字段就是第二个 EV-06）。

---

## 3. 第 2 步：EV-72 主题级 Driver 落盘（schema 变更）

### 3.1 问题

plan / bug 原稿在 `review --start` 之前由 Driver 写出，那一刻该阶段零留痕，`resolveRoundDriver` 回落缺省 Driver，非缺省 Driver 的 `-<id>.md` 原稿被判伪造件退 2。EV-68 刻意接受该边界（fail-closed 会锁死今天的 `/dual-review-plan`）。

### 3.2 方案

- **新子命令** `trivium topic claim --topic <主题> --driver <id> [--json]`：由**编排器**创建 `.reviews/<主题>/task.json`（不存在则 `emptyTask`），写入 `driver` 与 `driver_claimed_at`；已存在且 `driver` 相同 ⇒ 幂等退 0；已存在且不同 ⇒ **退 64 并指明**「同一主题换 Driver 请新开主题」（不提供覆盖旗标——覆盖会让 task.json 成为第二个「沿用前一条的值」的槽位，EV-68 关闭时否掉 `GateEntry.driver` 的理由逐字适用）。
- `TaskMeta` **additive** 加可选字段 `driver?: AgentId`、`driver_claimed_at?: string`，schema 仍 `trivium.task.v1`：既有文件缺该字段 = 「未声明」，语义与 `run.v2.driver_enabled` 的「缺失即无从得知」同构。
- `resolveRoundDriver` 改三级：**该阶段最新 `run.json.driver`** > **`task.json.driver`** > `DEFAULT_DRIVER`；留痕损坏仍硬失败（第 1 级现有行为不动）。拦截文案分别注明来源。
- `topic resolve` **保持纯只读**（USAGE 明写「不创建任何目录」，不改这条承诺）；但它与 `review --start` 都要**交叉校验**：给出的 `--driver` 与 `task.json.driver` 不一致 ⇒ 退 64。
- 入口资产（第 5 步渲染）在「解析主题」步之后、写原稿之前插一步 `TV topic claim --driver <自家 id>`；claude 载体也加——它是缺省 Driver，claim 的效果只是留痕，行为不变（J3）。

### 3.3 测试

- `hooks.test.ts`：三级各一条 + 「task.json 有 driver、run.json 更新为别的 driver（同主题跨阶段）」时以 run.json 为准。
- 变异：第 2 级退回忽略 task.json ⇒ 用例红（目标文件取 `-<非缺省>.md` 才有鉴别力，EV-68 的教训）。
- 集成：`topic claim` 幂等、冲突退 64、`--json` 形状。
- `run-files-parity` / `registry-parity` 对新字段名的字面对账（`task.json` 字样进 Bash 命令文本会撞 `MENTIONS_OWNED`——**测试与文档里提到它时用 Write / Edit，不用 Bash 重定向**）。

---

## 4. 第 3 步：EV-55 跨时间面重写（安全关键面）

### 4.1 提交锚 `immutableChangeReason`

现判据：basename 带「全集减缺省 Driver」后缀 ⇒ 拦。换 Driver 后两个方向都错（EV-55 原文）。

**新判据（两条合取任一命中即拦，均 fail-closed）**：

1. 该路径出现在主题下**任一** `run.json.artifacts[]` 登记内（含被冻结的原稿 `subject` 与裁决件）⇒ 「已登记工件一经落盘即不可变」。`archive.ts:436-442` 已有按 `artifacts[]` 的 sha256 核对函数，复用其读取而不另写一份。
2. basename 带**全集**任一后缀（`ALL_SUFFIXES`，含 `claude`）且位于归档根内 ⇒ 拦。这是**收紧**：今天已提交的 `-claude.md` 原稿原地改不拦，改后拦。理由：FR-25「只追加不覆盖」对 Driver 自己的已提交原稿同样成立；`archive` 早以 `O_EXCL` 拒绝覆盖，提交锚只是把同一条原则从「编排器落盘」延伸到「Git 提交」。

`run-*.json` 与 `_meta` 的既有分支不动。

### 4.2 Bash 侧 `roleSuffixAnywhere()` / `bashTargetsProtected`

Bash 侧拿不到 run 上下文（命令文本里没有主题），按 artifacts 登记判在这里无从实施（EV-55 补记）。**决策 D3：改为全集字面保护**（四个后缀都拦）。

- 不影响 Driver 写自己的原稿与裁决件——那走 Write / Edit（当轮面 `hasProtectedRoleSuffix(fileName, driver)`，EV-68 已做）。
- 误拦面扩大（R22 已登记）：命令文本里提到 `-claude.md` 也会被拦，出口不变（Write / Edit + `git commit -F <文件>`）。仓库根 `CLAUDE.md` 那段「已知误拦」要同步改（第 8 步）。
- **不做收窄**（`hooks.ts:809-840` 那段撤回记录与 RV-B1 同构，不再试）。

### 4.3 测试

- 保留 RV-B1 锁下的五类负例。
- 新增：换 Driver 后历史 `-claude.md` 审查件原地改 ⇒ 提交锚拦；新 Driver `codex` 的 `-codex.md` 原稿经 Write 放行、经 Bash 重定向拦；已登记工件即使后缀不在全集里（假想第五家）也拦（第 1 条独立成立）。
- 变异：去掉第 1 条 ⇒ 至少一条红；去掉第 2 条 ⇒ 至少一条红。

---

## 5. 第 4 步：翻 `driverEnabled`、`approve` 复核与连带项

### 5.1 翻开关与收紧

- `registry.ts` 三处 `driverEnabled: true`；注释改为记本步与实测报告。
- `resolveDriver`（`critics.ts:154-190`）：`driverEnabled === false` ⇒ **退 64**（M9 的「放行但标注」是为第 6 步验收留的口子，`critics.ts:148` 自己写着「M10 收口时收紧」）。四家全翻之后该分支对注册表现值不可达，但它是第五家登记而未启用时的守卫，**保留并有用例**（夹具 overlay 造一个 `driverEnabled: false` 的桩）。
- `preflight.ts:628-635` 那行标注改为**打印护栏等级**：`Driver：codex（护栏 L2——无事前写拦截，审批前由编排器复核裁决完整性）`。这是 `guardLevel` 的第一个生产消费方（F-1）；`run.v2` 加可选 `driver_guard_level`，report 读它。
- **D4**：`guardLevel` 语义改为「登记上限」，运行期 `effectiveGuardLevel(agent, probe)`：登记 L1 且探针 `hooks_deny_ok !== true` ⇒ 降 L2。消费方即上面两处。若第 1 步 zcode 结论为 false 而不是 null，则直接把注册值翻 L2、不留两段逻辑（两段只为「null 待复测」这一格存在）。

### 5.2 `approve` 前置复核（演进设计 §9.4，J2）

`cmdApproval` 在 `decision === 'approved'` 时、`recordApproval` 之前，对每个待批阶段**无条件**执行 `loadRoundReviews` + `checkAdjudication`（`driver` 取留痕、`runId` 取闸门项，与 `--await-approval` 那段同源——**抽成一个函数两处调用**，不复制），不通过 ⇒ 退 2 并打印缺口。`rejected` / `abandoned` 不复核（拒绝与放弃不解除「裁决要齐备」之外的任何义务）。**不加确认码**（v1.2.3 ② 撤销过）。

用例：裁决件缺一条时 `approve` 退 2；`--await-approval` 通过后手工删裁决件再 `approve` 仍退 2（这正是 L2 Driver 场景：没有 Hook 拦那次删除）。

### 5.3 连带四条

- **EV-62** `isHeterogeneous`（`adapters/base.ts`）改为按**当轮 Driver 的厂商**与审核者模型族比对；`overrideReasonFor` 文案同步。写点两处（`review.ts`），`driver-wiring` 第 420 行那条对账用例要跟着改判据。
- **EV-64** 删 `inferLatestRunId`（`driver-wiring.test.ts:381` 已断言无调用，删定义后该断言仍成立）。
- **EV-07 / F-6**：核实 `types.ts` 是否仍有 `Disposition.role` 字面；若 `LITERAL_ALLOWLIST` 该条的「仍被需要」腿已空，按 EV-39 口径处理——**删豁免必须伴随证明它已不被需要的那条用例变绿**，不是直接删。
- **EV-61** USAGE 的 `--model-gemini / --model-glm`、`--only gemini|glm` 与三处 `argument-hint` 改按注册表插值——随第 5 步渲染一起做（那时 `argument-hint` 本身就是渲染产物）。

### 5.4 J5 复核

`critics.test.ts:120` 已覆盖非缺省 Driver。本步只加一条：**四家逐一**作为 driver 时 `selectableCritics` 恒不含自己（穷举，防第五家登记时漏）。

---

## 6. 第 5 步：四家入口资产单源渲染、install 多目标、协议片段两段式

### 6.1 单源渲染（演进设计 §10.2）

- 新增 `skills-src/commands/{run,review-plan,review-code,review-bug,approve,abandon,status}.contract.md`：命令契约正文（参数表、七步序列、等待义务三条款），**从现有 7 份 SKILL.md 抽出**，抽出过程用 diff 证明「渲染回 claude 载体 = 现文件」（J3 的机器证据）。
- 四家载体适配层 `skills-src/carriers/<agent>.yaml`：frontmatter 字段映射（M6 报告：codex 的 frontmatter 与 claude 几乎同形，含 `disable-model-invocation`；agy / zcode 按第 1 步实测）、`TV` 调用前缀、**`--driver <自家 id>`** 注入点（`topic claim` / `topic resolve` / `preflight` / `review --start` 四处）。
- `scripts/build.mjs` 增渲染步：claude 产物仍落 `skills/dual-*/SKILL.md`（路径不变，wrapper 与 install 不动）；另三家落 `skills/entry/<agent>/dual-*/SKILL.md`（D5：提交进 Git）。
- 契约测试 `entry-render-parity`：①渲染产物与源在 CI 上零 diff（改源不重渲当场红）；②`skill-flag-parity` 扩为四家 × CLI 旗标对账；③每家产物含且仅含自家 `--driver`。
- **`--driver` 进 skill、命令 A 放开**（D7）：`topic-args.ts:352-358` 那段拒绝改为接受；设计 §7.1「不进 skill、不进 `argument-hint`」那句随第 8 步改为「自 M10 起由渲染注入」。

### 6.2 install 多目标（演进设计 §7.5 表）

- `InstallTargets` 改为 `installTargets[]`，**按注册表派生**（纪律 7）：claude `~/.claude/skills`；codex `~/.codex/skills`（M6 §2 实测的常驻承载面）；glm `~/.zcode/skills` 或 `~/.agents/skills`（第 1 步 2.3 定）；gemini `~/.gemini/config/skills`（第 1 步 2.1 通过时；不通过则该目标不装、报告里明示）。只读审查者 `agentTarget` 保持。
- **一律 user 级**（M6 §3.4：zcode 的 user 级命令会静默盖掉项目级），**装前查重名、撞名报错不覆盖**。
- 目标家的 CLI 根目录不存在 ⇒ 跳过并在报告里列出，不失败（协作者机器不一定四家都装）。卸载对称、裁剪孤儿。
- `install.test.ts` 扩四目标；`npm run install:local` 行为对 claude 目标逐字节不变（J3）。

### 6.3 协议片段两段式（演进设计 §7.5；EV-06 接线）

- `protocol/<file>.snippet` 改为两段：【Driver 协议】（现 `CLAUDE.md.snippet` 内容泛化：「**当轮 Driver** 是唯一有权改业务代码的角色」、命令入口、逐条裁决、审批发起权、Bash 误拦出口——含第 3 步扩大后的全集后缀）+【审查员身份】（现 `AGENTS.md.snippet` 内容），首段按身份分流。
- `init.ts` 按注册表 `instructionFiles` 分发（**EV-06 结案的「接上」分支**），新增 `GEMINI.md`；标记内多段升级幂等（已有 `MARKER_BEGIN/END` 机制，需支持「旧单段 → 新两段」替换而非追加第二块）。
- **claude 侧不生成审查员段**：EV-44 已实测 `--restricted` 阻断项目记忆，审查员段对 claude 是死件；`CLAUDE.md` 只装 Driver 段，`init` 的报告里写明理由。
- 仓库根 `CLAUDE.md` / `AGENTS.md` 随之更新（回溯清单第 17 项；「M10 前刻意不改」的限定至此解除）。

---

## 7. 第 6 步：Hook 多目标（**条件步**，取决于第 1 步 2.3）

- **通过时**：`mergeHooks` 增 ZCode 配置目标（键名与形态按实测），`trivium init` 同时合并两家；新增 `trivium hooks --agent <id>`（只做「渲染 / 安装该家 Hook 配置」，**不参与任何判定**——§8.5 注记原文；命令串仍不带 driver，EV-68 结论）。glm 维持 L1。
- **不通过时**：本步只落文档：注册值翻 L2、RUNBOOK 增「L2 Driver 人工兜底」节、QUICKSTART 明示（R18）。`hooks --agent` 不做（没有第二个目标就没有这个旗标的消费方）。
- 两种结果都要写进第 1 步报告与设计 §8.5 引言块（第 8 步）。

---

## 8. 第 7 步：验收（AC-21、EV-77、兼容）

### 8.1 为什么不在本仓库跑

同 M9 第 6 步：本仓库的执笔者是本会话；且换 Driver 会在本仓归档里留下非缺省 Driver 的原稿，污染后续 `gate` 读取面。在临时夹具仓库跑，留痕收进 `doc/05_testing/evidence/m10-acceptance-<日期>/`（不进 `.reviews/`）。

### 8.2 剧本（四 Driver 各一轮命令 B）

| Driver | 载体 | 审核者 | 性质 |
| :--- | :--- | :--- | :--- |
| claude | 本会话（现状） | codex / gemini / glm | **兼容回归**：与 M9 留痕逐字段比对工件名、run.json 形状、Hook 退出码 |
| glm | ZCode 交互会话（第 1 步 2.3 确认可用时） | claude / codex / gemini 中任两家 | **真实**；不可用则降夹具级并登记（P-2） |
| codex | codex 交互会话 | claude / gemini / glm 中任两家 | **夹具级 + EV-77 真载体写事件**：闸门期在 codex 会话里改一个业务文件，预期**无拦截**，随后 `approve` 复核与漂移复算暴露；记录 L2 边界的真实形态 |
| gemini | agy（第 1 步 2.1 通过时） | 任两家 | 夹具级；不通过则按退路（协议片段 + 手工 CLI）跑一轮，登记 |

每轮判据：原稿后缀 = Driver；`run.json.driver` = 声明值且 `driver_enabled: true`；审核者集合不含 Driver；裁决件 `role` = Driver 且 `gate --check` 通过；`approve` 前复核触发（造一次缺件确认退 2）。**glm 作审核者的轮次**加一条：`--model-glm GLM-5.3-Flash`，`run.json` glm 段 `model_route: config_copy` 且 `model_override_applied: true`（R-g ②）。

### 8.3 兼容验收（J3）

claude 轮的 `.reviews/` 布局、文件名、`_meta` 形状与 `settings.json` Hook 段与 M9 留痕 diff 只允许出现新增可选字段（`driver_guard_level`、`task.json.driver`）。

---

## 9. 第 8 步：纪律 6 回溯与留痕

### 9.1 目标文档（初表，第 8 步以 `grep` 生成落点清单并做差集自检——M9 附录那条方法论）

| 文档 | 改什么 |
| :--- | :--- |
| 主设计 | §16.1 M10 行状态与达成边界；§8.5 引言块由指针占位翻为已实现（含 L1/L2 实测结果）；§7.1 `--driver` 段（进 skill、命令 A 放开）与 7.4；§18.1 #16 拍板；§24.1 三行转绿；R18 / R22 现状；§21 变更记录升次版本 |
| PRD | FR-28 / AC-21 / S6 状态；抬头「AC-21 未达成」句；追溯矩阵 |
| `.reviews/README.md` | 「换一家 Agent 主攻仍为待实施」句；提交锚与 Bash 侧口径 |
| 仓库根 `CLAUDE.md` / `AGENTS.md`、`protocol/*.snippet` | 两段式；「当轮 Driver」措辞；误拦后缀全集 |
| `skills/` 12 份资产 | 渲染产物；`dual-critic/SKILL.md` 与 `templates/README.md` 现状句 |
| QUICKSTART / MANUAL / PROTOCOL / RUNBOOK | 四家安装与 Driver 切换；L2 明示；RUNBOOK「多审失败处置、L2 Driver 人工兜底」 |
| CASE_manual_acceptance | 补 S6 剧本 |
| BACKLOG | EV-06 / EV-07 / EV-55 / EV-61 / EV-62 / EV-64 / EV-72 / EV-77 结案；新挖的登记 |

---

## 10. 不可逆决策

| # | 决定 | 为什么 | 错了怎么退 |
| :--- | :--- | :--- | :--- |
| D1 | `task.json` additive 加 `driver` / `driver_claimed_at`，不升 v2；换 Driver 不允许覆盖 | 缺失 = 未声明，与 `driver_enabled` 同构；覆盖会造出「沿用前一条」槽位 | 字段可选，读侧忽略即回到今天 |
| D2 | 提交锚判据改为「artifacts 登记 ∪ 全集后缀」，收紧到含 Driver 自己的已提交原稿 | FR-25 只追加不覆盖；纯后缀区分不了历史与当轮 | 第 2 条可单独回退为「全集减缺省」，第 1 条独立成立 |
| D3 | Bash 侧后缀字面保护改全集 | Bash 拿不到 run 上下文；fail-closed 方向；出口零成本 | 回退为旧集合一行改动；不做收窄 |
| D4 | `guardLevel` = 登记上限，运行期按探针降级；zcode 实测 false 则直接翻 L2 不留两段 | 不伪装；两段只为 null 那一格 | 删 `effectiveGuardLevel`，回到静态登记 |
| D5 | 另三家渲染产物提交进 Git（`skills/entry/<agent>/`），claude 产物路径不变 | 可 diff 对账、审查员读得到；claude 侧字节兼容 | 改为构建期产物 + `.gitignore`，对账测试改读 dist |
| D6 | 入口资产一律 user 级安装，撞名报错不覆盖 | M6 §3.4 实测 user 盖 project 且静默 | 加 `--force` 旗标（本轮不加） |
| D7 | `--driver` 由渲染注入各家入口资产；命令 A 放开 `--driver` | 入口资产自己知道身份（演进设计 §5.2）；M9 §2.14 的限定以 M10 为终点 | 命令 A 恢复拒绝一处改动；渲染层删注入点 |
| D8 | `driverEnabled: false` 由「放行 + 标注」收紧为退 64 | M9 的口子只为第 6 步验收；第五家登记未启用时要有守卫 | 恢复标注分支（保留其用例） |

---

## 11. 已知风险与边界

- **R-a 第 1 步的结论决定第 5～7 步的形态**，且 agy / zcode 两家的行为实测都要发真实调用（配额与墙钟）。第 1 步先跑、结论出来再进第 5 步；第 2～4 步不依赖它，可并行推进。
- **R-b zcode 真载体不可用**（F-4）：不静默降级，走 P-2 拍板。~~且 F-8 未修前 zcode headless 本身不通~~ F-8 已结（EV-81 / EV-82），headless 与含 glm 的双审都通了；剩下的只是「交互会话当 Driver」这一层。
- **R-g glm 侧的两条环境风险**（2026-09-21 新增）：① 桌面端会改写 `~/.zcode/v2/provider_config.json`（本日实证：切 provider 家族时抹掉 `defaultModelSelection`、把自定义 provider `enabled` 翻 false，CLI 随即 `Model creation failed`）——第 1 步 2.3 与任何含 glm 的运行若撞上，先看 RUNBOOK「Select a model before continuing」那行，**不是**编排器的锅（区分实验已做，EV-87）；② 守卫的失明边界：含 glm 的运行一律 `--model-glm GLM-5.3-Flash`，否则 `model_override_applied: true` 没有鉴别力。
- **R-c 误拦面扩大**（D3，R22）：本仓库日常会更频繁撞 Bash 侧拦截。出口已有且写在 `CLAUDE.md`；不为此开任何豁免（RV-B1）。
- **R-d 渲染层引入第二事实源的风险**：契约源与四份产物若靠人记得重渲，就会漂。靠 `entry-render-parity` 在 CI 上判红，不靠记性。
- **R-e L2 Driver 的残余风险**（R18）：闸门期可改业务文件，事后暴露。本轮把「审批前裁决完整」守死（5.2），把「写拦截」如实降为事后可审计，文档明示——**不用祈使句伪装机制**。
- **R-f selftest 不覆盖非缺省 Driver**（F-7）：自检链路对 M10 的证明力只到 claude 侧；是否扩展在第 7 步按成本决定并登记。

---

## 12. 验证方式

- 每步：`npm run typecheck && npm run build && npm test` 全绿；**验证前 `npm run install:local`**（wrapper 指向全局副本）。
- 变异验证：第 2 步（忽略 task.json）、第 3 步（去掉任一条判据）、第 4 步（approve 跳过复核）各至少一条红，记入应答件。
- `trivium doctor --selftest` 全绿（缺省 Driver 路径不退化）。
- 第 7 步报告含每轮命令、退出码、留痕路径与 sha256。
- 变异验证前先确认 `dist/test` 真被重编（`node scripts/build.mjs --tests-only`；`npm run build` 不含测试树）——EV-82 r3 前两轮变异循环因此空跑过，五条「全逃逸」其实跑在旧产物上。

---

## 13. 给审查员的提醒

- **§0.3 七条事实请回源码逐条核**，尤其 F-1（`guardLevel` 零消费方）与 F-2（glm L1 未经实测）——若哪条不成立，对应步骤要重排。
- 不可逆决策里 **D2 / D3 的方向是收紧**，请重点看有没有让今天走得通的 `/dual-review-plan` 走不通的形态（第 2 步 claim 与第 3 步全集保护的交互）。
- 第 2 步 `topic claim` 的命名与「`topic resolve` 纯只读」承诺的边界；EV-72 原文写的是「`topic resolve --driver` 时落盘」，本计划**刻意不这么做**，理由在 3.2。
- D4 的两段逻辑是否又是一个 EV-06：只在 zcode 实测落 null 时才存在，请判断这个条件是否站得住。
- 第 5 步渲染产物进 Git（D5）与「`skills/` 是资产根、wrapper 不动」的兼容承诺是否冲突。
- **给 glm 侧**：这是路线 L 合入后 glm 第一次以审核者身份跑真实双审。你的意见照常逐条裁决；你跑在哪个模型上由 `run.json` 回读决定，与意见内容无关。
