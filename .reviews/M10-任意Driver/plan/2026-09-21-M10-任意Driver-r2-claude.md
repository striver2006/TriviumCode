# M10 · 任意 Driver 实施计划（第 2 稿）

- **日期**：2026-09-21（r2）
- **本稿由来**：r1 三侧计划双审（run `20260921T145353Z`，codex / gemini / glm）产出 27 条具名意见，
  裁决件 [`2026-09-21-M10-任意Driver-revised-claude.md`](2026-09-21-M10-任意Driver-revised-claude.md)
  接受 24、驳回 2（AGY-01 / AGY-07）、暂缓 1（AGY-05）。本稿逐条落实 24 条接受意见，
  并载入 P-1 / P-2 两项拍板（2026-09-21）。**r1 原稿保留不动**，供对账。
- **起点**：`17f88ac`，`main` 干净、已推送
- **基线核实**：`npm run check` 2026-09-21 复跑 **1566 用例 / 1564 通过 / 2 跳过 / 0 失败，exit 0**
- **依据**：主设计 §16.1 M10 行（含四条前置）、§7.1 `--driver` 段、§8.5 引言块、§18.1 #16、§24.1 台账三行；
  演进设计 §5.2 / §7.5 / §9.3 / §9.4 / §10.2；
  PRD FR-28 / AC-21 / S6；
  BACKLOG **EV-55 / EV-72 / EV-77**（前置）、**EV-06 / EV-07 / EV-61 / EV-62 / EV-64**（范围内连带）
- **实测依据**：[M6 入口承载面报告](../../../doc/05_testing/REPORT_2026-09-15_m6_driver_entry_probe.md)；
  [M9 验收报告 r2](../../../doc/05_testing/REPORT_2026-09-20_m9_claude_critic_acceptance_r2.md)
- **明确不读**：演进设计 §7.2（已作废）；演进设计 §9.3 关于「字面集按 `--agent` 动态生成」那句——
  已被主设计 §8.5 注记取代，**当轮 Driver 的判定来源只有留痕**

> ### ⚠️ 本稿审的跑法与 r1 不同：EV-82 未结案
>
> r1 抬头写「本次运行同时充当 EV-82 结案判据里最后一条『一次含 glm 的真实双审』」，
> 并预期核出 `model_override_applied: true`。**r1 实测推翻了这条断言**（裁决件 §4）：
>
> | 侧 | model_requested | model_effective | model_route | model_override_applied |
> | :--- | :--- | :--- | :--- | :--- |
> | codex | `qwen3.8-flash` | `qwen3.8-flash` | `config_copy` | — |
> | gemini | `gemini-3.8-flash-high` | `gemini-3.8-flash-high` | `envelope` | — |
> | glm | `GLM-5.3-Flash` | **`bigmodel-coding-plan/GLM-5.3`**（首位模型） | `config_copy` | **`false`** |
>
> 守卫工作正常（如实落盘 + 收尾播报），**失效的是路线 L 的修复本身**：模型限定只作用于
> 探针臂 `probeModelOverride`，没覆盖真实审查臂（`invokeZcode` 的副本 HOME 构造）。
>
> **后果（本稿多处依赖）**：
> 1. **EV-82 重开**（见 §1.2 与第 8 步 BACKLOG 清单），不在 M10 范围内，但它是 **M10 第 7 步的前置**。
> 2. **在 EV-82 修复前，任何以 `--model-glm` 作鉴别条件的验收判据都不成立**——
>    §8.2 原 R-g ② 的那条判据本轮**失明**，已按此改写。
> 3. r1 与本稿的三侧模型分属 qwen / gemini / 智谱三家族，`heterogeneous: true` 成立，
>    **双审的异构性与 r1 结论有效性不受影响**，仅 FR-06 模型路由在 glm 侧失效。

---

## 0. 开工核实结果

没有 M10 交底文档。下面是我按 §16.1 M10 行与 BACKLOG 逐条对源码核出来的现状，**每条带证据位置**。
r1 双审对本节逐条复核，改动见各条末尾的「r1 修正」。

### 0.1 §16.1 M10 行的四条前置——现状

| 前置 | 状态 | 证据 | 本计划落点 |
| :--- | :--- | :--- | :--- |
| ① agy skills 真实加载行为实测 | **未做**。M6 第 4 步只有静态证据（二进制内嵌迁移表 + `--disable-slash-commands` 旗标帮助），报告 §4.3 自己写着「M10 落地前必须补一次行为实测」 | 报告 §4.2 / §4.3；设计 §18.1 #16 仍「未拍板」 | 第 1 步 |
| ② EV-55 跨时间面重写 | **todo**。提交锚 `immutableChangeReason` 与 Bash 侧 `roleSuffixAnywhere()` 仍按 `criticRoleSuffixes(DEFAULT_DRIVER)`（全集减**缺省** Driver）取值 | `src/trivium/hooks.ts:487-508`、`:805-807`、`:852-854` | 第 3 步 |
| ③ EV-71 会话载体 | **已关闭**（名义 Driver，经 `gate hook-pre-write` 直喂实测）；**真载体残量转 EV-77，todo** | BACKLOG EV-71 / EV-77；设计 §16.1 M10 行前置 ③ 注记 | 第 7 步 |
| ④ EV-72 主题级 driver 落盘 | **todo**。`resolveRoundDriver` 第 2 级在该阶段零留痕时回落 `DEFAULT_DRIVER`；`TaskMeta` 没有**主题级** `driver` 字段 | `hooks.ts:354-375`；`meta.ts:59-66` `TaskMeta` | 第 2 步 |

> **r1 修正（CODEX-04，major）**：④ 原写「`task.json`（`trivium.task.v1`）没有 `driver` 字段」**不确切**。
> 该文件**已经**有 driver 事实——`runs[].driver`（`meta.ts:91-97`，注释写明「设计 §5.2 把 `--driver`
> 的留痕面写成三处」；写入点 `meta.ts:454-455` 标「与 run.json.driver 同源」）。
> 缺的是**主题级** driver。这个区别不是措辞问题：加主题级字段后同一文件里会有两份 Driver 取值、
> 生命周期不同（`runs[]` 由编排器在 `review --start` 追加，主题级由 `claim` 写入），
> 而三级判定只规定了 `run.json` 优先，对二者不一致没有口径——正是纪律 7 / 纪律 12 反复消灭的
> 「第二事实源」形态。不变量补在 §3.2。

### 0.2 §16.1 M10 行范围栏各项——现状

| 范围项 | 现状 | 证据 |
| :--- | :--- | :--- |
| 四家入口资产与单源渲染 | 7 份入口 `SKILL.md` 全是 claude 载体、手写、B/C/D 三份逐字同构；**没有** `skills-src/` 与渲染步骤 | `skills/dual-*/SKILL.md`；`scripts/build.mjs` 无渲染 |
| install 多目标 | `defaultTargets()` 只有两项：`~/.claude/skills`（skills）与 `~/.gemini/config/agents/trivium-critic/agent.md`。**没有**按注册表派生的目标表 | `src/install.ts:24-36` |
| **运行时／资产根** | **绑死在 claude 根上**：`assetRootDefault()` 写死 `~/.claude/skills/dual-critic`，`resolveAssetRoot` 同一硬编码，wrapper 里写死该 bundle 的绝对路径 | `init.ts:45-46`、`:347-350`、`:377`；`review.ts:397-401` |
| `hooks --agent` | CLI 无该子命令；`hooks.json` 四条命令串静态、不带任何身份参数 | `skills/dual-critic/hooks/hooks.json`；`cli.ts` USAGE |
| `approve` 前置复核 | **未做**。`cmdApproval` 直接 `recordApproval`，没有 `checkAdjudication`；有复核的是 `gate --await-approval` 那条路 | `cli.ts:1240-1300` vs `cli.ts:938-975` |
| 协议片段两段式 | `protocol/` 只有 `CLAUDE.md.snippet` 与 `AGENTS.md.snippet` 两份**单段**文件；`init.ts` 写死两条落点路径、**不读** `instructionFiles`（EV-06 原文成立） | `init.ts:386-393` |
| 翻 `driverEnabled` | 三处 `false // M10 启用`；`resolveDriver` 放行 + 标注；`run.v2.driver_enabled` 如实落盘 | `registry.ts:204/218/232`；`critics.ts:142-148`；`preflight.ts:627-635` |
| 「当轮 Driver 不得入选」对非缺省 Driver 有用例 | **已有**：`critics.test.ts:120` 传 `driver: asCritic`（非缺省） | `test/unit/critics.test.ts:113-131` |

> **r1 新增行（CODEX-01，major）**：「运行时／资产根」原稿整行缺失。r1 指出它与 install 多目标是**两件事**，
> 而原 §6.2 只安排了前者。落点见 §6.2。

### 0.3 我核出来的、M10 行没写的**八**条事实

> r1 修正：原标题写「七条」但列了 F-1～F-8 共八条，本稿改准。

| # | 事实 | 证据 | 后果 / 处置 |
| :--- | :--- | :--- | :--- |
| **F-1** | **`guardLevel` 在注册表登记了四家，生产代码零消费方**——只在测试夹具里出现。与 EV-06 的 `instructionFiles` 同形：登记而未接线 | `grep -rn guardLevel src test`：仅 `registry.ts`、`registry-parity.test.ts:79`、`overlay.ts:239` | AC-21 要求「护栏差异对使用者明示」，明示的事实源就该是它。第 4 步给它接上消费方。**r1 三侧一致确认成立** |
| **F-2** | **glm 的 `guardLevel: 'L1'` 是未经实测的登记**。设计 §3.3 与 M0 报告对 zcode 都没有任何 Hook 记载 | 设计 §3.3 段零命中；`REPORT_2026-09-11_m0_probe.md:123` 只提 agy | 第 1 步实测；不通过就翻 L2 并如实写文档，**不伪装**。**r1 三侧一致确认成立** |
| **F-3** | **codex 的 `$ARGUMENTS` 展开同样只有静态证据**。本机四家版本都动了：agy **1.2.7**、codex **0.155.1**、claude **2.1.278**、zcode **0.16.9** | 报告 §2「参数展开」段；`--version` 与 `doctor --only zcode` | 第 1 步把三家的「skill 加载 + 参数展开」一并做**行为实测**，版本记进报告 |
| **F-4** | **`zcode` 不在 PATH**。编排器按 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` 定位；但「ZCode 当 Driver」的真载体是 ZCode 的交互会话，不是 `node zcode.cjs -p` | `probes/zcode.ts:31-32`；`which zcode` 无 | **按 P-2 拍板（卡住 M10）升级为关键路径阻塞点**，见 §1.1 J4 与 §11 R-h |
| **F-5** | **`--driver` 今天不进入口资产**，且命令 A 显式拒绝它。这是 M9 第 5 步计划双审 §2.14 的裁定，理由是「M10 之前四条命令的执笔者就是本会话的 Claude Code」——**M10 就是那个「之前」的终点** | 设计 §7.1 该段；`topic-args.ts:346-358` | 第 5 步推翻该限定（D7） |
| **F-6** | **EV-07 的「状态陈旧」判断成立，但本条对豁免现状的描述失实**。`disposition.v1.json` 的 `role` 已在 EV-66（v1.3.29）放宽为 `type: string`，`types.ts:1107` 的 `role` 已是 `AgentId`（无字面量），BACKLOG 条目仍 todo 且描述与现状不符 | `disposition.v1.json:13-14`；`types.ts:1095-1107`；`registry-parity.test.ts:267-275`；`BACKLOG.md:104` | 第 4 步按 §5.3 拆两件处理 |
| **F-7** | `CASE_manual_acceptance.md` **没有 S6 剧本**；`selftest.ts` 零处 `driver` | `grep S6` 仅命中标题引用行；`grep -c driver selftest.ts` = 0 | 第 7 步补 S6 剧本 |
| **F-8** | **ZCode 0.16.9 独立拉起时找不到内置 provider 配置**（EV-81）与**模型覆盖不生效**（EV-82）两条根因链 | 见下方专段 | EV-81 已结；**EV-82 经 r1 实测重开**，见抬头警示块 |

> **r1 修正（AGY-04 / GLM-06 / CODEX-09，三侧一致）**：F-6 原写「`registry-parity` 的 `LITERAL_ALLOWLIST`
> 第 270 行仍留着『Driver 任意化排在 M10』的豁免理由」——**失实**。
> `registry-parity.test.ts:267-275` 的沿革注释把该理由明确标为**第二版已作废**
> （原文：「EV-66 在 M9 第 6 步前就把 role 放开成 AgentId 了，那句预言本身失效，再留着就是一条失实的留痕」），
> 现行生效的 `why`（第 275 行）是**探针键**（`ClaudeProbe` 等按 Agent id 命名的可选键），与裁决件契约无关。
> **该豁免的腿没空，不得删**——条目注释末句正写着「下一个动这行的人请照样如实改写，别顺手删」。
> 原稿第 4 步写的「核实 `types.ts` 侧字面是否仍存在」不是待核事项而是**已核完的结论**，
> 照原写法会白跑一次核实、并可能「结案」一个本就已结的东西。处置见 §5.3。

#### F-8 详解（EV-81 已结 / EV-82 重开）

- **EV-81（已结，提交 `98b2fd3`）**：0.16.9 的 `zcode.cjs` 按入口文件目录推算 `zcode-builtin.json`，
  两条候选在应用包内都不存在；真实文件在 `Resources/config/provider/zcode-builtin.json`。
  修法走适配层：`invokeZcode` 存在性门控注入 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`
  （`FZi` 会在成对检查前合成缺失键，headless 路径只给内置那份即可），
  `failureKind` 增 `provider_config_unresolved`，探针增 `provider_config` 事实格与 `indeterminate` 第三态。
  连带挖出 P-29（定位先于参数解析）与 P-30（个人 provider 配置自带默认模型）。
- **EV-82（提交 `17f88ac`，但 r1 实测推翻，须重开）**：根因是 EV-81 注入的个人变量让 CLI 跳过 legacy 导入。
  路线 L 的修法（副本 HOME 下不注入个人键、模型限定按副本源 `cli/config.json` 的 provider 成员做、
  `probe.model_override` 改零配额探针臂实测、守卫在请求模型未生效时播报）**只覆盖了探针臂**。
  r1 的真实审查臂实测 `model_override_applied: false`、实跑首位模型 `GLM-5.3`。
  **这条是 M10 第 7 步的前置**（§8.2 需要 `--model-glm` 作鉴别条件），但**不在 M10 范围内**——
  另开小主题修，与 M10 第 2～6 步并行。
  残量：EV-87（探活/探针路径仍指真实个人文件）、EV-93（`model_id_form` 补前缀与目录异源）、EV-94（探针两条残量）。

### 0.4 项目负责人拍板结果（2026-09-21，计划审后）

- **P-1 EV-74 / EV-79 的处置 —— 已拍板：另开小主题，排在 M10 第 3 步之前。**
  两条触发条件都写「M10 前」，但都不在 §16.1 M10 行的范围栏里。并入会让 M10 的代码双审面同时含
  「护栏判据」与「入口渲染」两种性质完全不同的改动（同一逻辑见 GLM-09 对第 4 步的批评）。
  EV-79 是只读失守判定的两处**静默漏检**（`rm -r --force` 降档、`&>` 不识别）且标「待双审」，
  EV-74 是 claude 探针的 `json_schema_ok` 从未喂过真实契约。
  **落点**：§1.2 明确不在本轮范围；§1.3 依赖图标出它排在第 3 步之前。
- **P-2 F-4 的验收口径 —— 已拍板：卡住 M10 直到 zcode 真载体接通。**
  **不接受**「夹具级 + 达成边界登记」的降级。AC-21 的「zcode 真实一轮」必须真跑。
  **这是本稿相对 r1 最大的口径变化**（r1 原稿倾向接受降级），连带改动：
  §1.1 J4、§2.3 通过判据、§8.2 glm 行、§11 R-b 与新增 R-h、§12。
- **P-3 渲染产物的 Git 归属 —— 已定（D5）**：另三家的渲染产物提交进仓库。
  落点按 r1 AGY-06 修正，见 §6.1。
- **P-4 F-8 的先后 —— 已结项**：小主题 EV-81（`98b2fd3`）与 EV-82（`17f88ac`）均已合入。
  但 **EV-82 经 r1 实测重开**，见抬头警示块。

> **r1 修正（CODEX-10，nit）**：P-2 原括注「PRD AC-21 的原文是『claude/zcode 真实，codex/gemini 夹具级』」
> **出处错**。PRD AC-21 正文（`PRD_driver_dual_critic.md:469-473`）只有「指定某个已注册 Agent 为 Driver
> 走完命令 B……与现有 Driver 一致 + L2 差异明示 + 编排器无条件复核」，**不含真实/夹具级的分配**；
> 那句分配在**主设计 §24.1 的 AC-21 台账行**（`:2814`）与**演进设计 AC-N2**（`:668`）。
> 本稿既然拍板「不降级」，这三处的口径**一并维持不下调**；第 8 步回溯时按具名行号复核引用。

---

## 1. 范围与完成判据

### 1.1 完成判据（抄自 §16.1 M10 行与 PRD AC-21，不自行放宽）

| # | 判据 | 出处 |
| :--- | :--- | :--- |
| J1 | AC-21：指定任一已注册 Agent 为 Driver 走完命令 B，工件命名 / 闸门停点 / 逐条裁决语义与现有 Driver 一致 | PRD AC-21 |
| J2 | AC-21 后半：Driver 不具备事前写拦截时，差异在文档中对使用者明示，且**审批前的裁决完整性由编排器侧无条件复核** | PRD AC-21、FR-28 |
| J3 | 兼容验收：claude 为 Driver 时全部工件名、Hook 行为、`.reviews` 布局**逐字节不变** | 演进设计 §5.2「兼容」 |
| **J4** | **ZCode Driver 真实一轮跑通**（交互会话作载体），codex / gemini 夹具级。**按 P-2 拍板，zcode 一轮不接受降级为夹具级**——真载体接不通则 M10 不收口 | §16.1 M10 行；演进设计 AC-N2；**P-2 拍板（2026-09-21）** |
| J5 | 「当轮 Driver 不得入选」对非缺省 Driver 生效且有用例 | §16.1 M10 行 |
| J6 | 前置四条缺一不可：① agy skills 行为实测通过并拍板 §18.1 #16；② EV-55 落地；③ EV-77 真载体写事件实测一次；④ EV-72 落地 | §16.1 M10 行 |
| J7 | 纪律 6：本里程碑在 §24 台账登记的回溯条目已并入对应目标文档（含仓库根 `CLAUDE.md`、`skills/` 12 份资产**与演进设计**），落本文者升次版本 | §16.1 二期表引言；**r1 GLM-03** |

> **r1 修正（P-2 拍板）**：J4 原文是「ZCode / Codex Driver 夹具跑通（claude / zcode 真实，codex / gemini 夹具级）」，
> 对「zcode 真实做不到怎么办」留白，由 P-2 处置。拍板结果是**不留退路**：接不通即不收口。
> 相应地，§2.3 的 zcode 载体确认从「第 1 步的一项」升为 **M10 的关键路径阻塞点**（§11 R-h）。
>
> **r1 修正（GLM-03，medium）**：J7 括号内原未列演进设计。本计划对它的行为偏离最集中
> （安装目标表 §7.5、渲染产物落点 §10.2、hooks 命令串嵌 `--agent` §9.3、claude 侧审查员段 §7.5），
> 不改它，M10 收口时仓库里就是两套并行规范——正撞 J7 的口径。

### 1.2 明确不在本轮范围

- `--tier-<id>` / `--effort-<id>` / `--profile-codex`、`profiles` 的 `{tier}` 形态、`report` 按 Driver / 审核者双维聚合——**M11**。
- 第五家 Agent 接入；`PROSE_EXCEPTIONS` 颗粒度（EV-45）。
- 改 `gate` 的 Driver 事实来源——它**只读留痕**（§7.1 ④、§8.5 注记），本轮任何步骤都不给它加旗标。
- 给 ZCode 或 agy **伪造** L1：Hook 实测不通过的家一律 L2，只做文档与补偿，不做「建议态」以外的任何拦截假象（PRD FR-28）。
- **EV-74 / EV-79**（P-1 拍板）：另开小主题，排在 M10 第 3 步**之前**完成。
- **EV-82**（r1 实测重开）：另开小主题，与 M10 第 2～6 步**并行**，但必须在**第 7 步之前**完成——
  §8.2 的 glm 轮次需要 `--model-glm` 作鉴别条件，它失效则该轮判据失明。

### 1.3 步骤顺序与依赖

```text
[前置小主题 A] EV-74 / EV-79 ────────────────────┐（P-1：须早于第 3 步）
                                                  ↓
第 1 步 准入实测（零行为改动）──┬──→ 第 5 步 入口资产与安装（需 ① 拍板与 F-2/F-3/F-4 结论）
         │                       ├──→ 第 6 步 Hook 多目标（条件步：取决于 F-2）
         │                       └──→ 第 4 步的 D4 子项（取决于 zcode hooks_deny_ok 落哪一格）
         │
         └──【P-2 阻塞点】2.3 的 zcode 真载体确认 ──→ 第 7 步 J4（接不通则 M10 不收口）

第 2 步 EV-72 ──→ 第 3 步 EV-55 ──→ 第 4 步 翻 driverEnabled + approve 复核 ──→ 第 7 步 验收 ──→ 第 8 步 回溯
                                      （EV-62 / EV-64 / EV-07 清理已拆出，见 §5.5）

[并行小主题 B] EV-82 ────────────────────────────→（须早于第 7 步）
```

- 第 2～4 步是护栏与契约改动，**每步各一轮代码双审**；第 5～6 步是资产与安装器，合一轮或各一轮按 diff 体量定；
  第 7 步产出报告；第 8 步纯文档。
- **第 3 步必须先于第 7 步的任何真实换 Driver**（EV-55 触发条件原文）。
- **第 2～4 步的主体不依赖第 1 步**，可并行推进；**唯一的例外是第 4 步的 D4 子项**（见 §5.1 标注）。

> **r1 处置（AGY-07，驳回）**：gemini 建议把第 2～4 步整体串到第 1 步之后、并把第 3 步推到最末。
> **不采纳**：①依赖第 1 步的只是 D4 这一子项，而第 1 步是全计划唯一要发真实调用、墙钟最不可控的一步，
> 整体串行会无谓拉长关键路径；②「第 3 步先于第 5 步会引发脆弱过渡态」未给出具体失效形态，
> 而真正具体的窗口期问题（GLM-07 的 CLAUDE.md 文档滞后）已按 §4.2 接受并提前到第 3 步当步收尾；
> ③把安全收紧推到最后与「第 3 步必须先于任何真实换 Driver」（EV-55 触发条件原文）相悖。
> 改动只取其合理内核：**D4 对第 1 步的依赖在 §5.1 就地标注**，不上升为全局串行。

### 1.4 配额与墙钟量级（r1 CODEX-07，新增）

原稿全篇无量级估算，也无失败重跑成本核算。补如下，作为「2～3 天」估算是否成立的判据：

| 环节 | 真实调用次数 | 单次量级 | 备注 |
| :--- | :--- | :--- | :--- |
| 第 1 步 2.1 agy 加载面 | 3 臂（正 / 负 / 排除替代假说） | 各 1 次 print 调用 | agy 无枚举命令，只能发真实调用（M6 §4.3 原话） |
| 第 1 步 2.2 codex `$ARGUMENTS` | 2 臂 | 各 1 次 `codex exec` | |
| 第 1 步 2.3 zcode 加载面 + Hook + 载体 | 3～5 次 | 含交互会话确认 | **P-2 阻塞点，失败要反复试** |
| 第 2～4 步代码双审 | 3 轮 × 2～3 侧 | plan 档 900s / code 档更长；codex 单侧实测曾达 1038s | 任一轮中途挂掉即整轮重跑 |
| 第 7 步命令 B 验收 | 4 轮 × 2～3 侧 | 参考本轮 plan 三侧实耗 **14m23s** | 见下方缩减口径 |

- **缩减口径**：第 7 步中**不需要 glm 作证据的轮次显式不带 glm**（`--critics` 只写需要的侧），
  以缩小 R-g ① 的风险面与配额。
- **重跑口径**：单侧失败且用户未要求降级时整轮重跑；要保留部分结果时显式 `--allow-single` 并在报告登记。
- 若实测量级与 §16.1 的「2～3 天」估算不符，按纪律 1 **回补设计文档**，不留给执行时发现。

---

## 2. 第 1 步：准入实测（**不改任何对外行为**）

产出一份报告 `doc/05_testing/REPORT_<日期>_m10_driver_entry_probe.md`，四家各一节，
**每格三态**（true / false / null=没测到），带命令、原始输出摘录与负对照。版本号记进抬头（F-3）。

> **r1 修正（CODEX-05，major）**：2.1～2.3 的实测目标从「哪份被加载」**扩为「逐家完整读取面清单」**。
> 理由：M6 实测结论是各家读取面**跨根**——codex 的 skills 指令根跟着 `HOME` 走（`~/.agents/skills`，P-19），
> zcode 同时枚举 `~/.zcode/skills` 与 `~/.agents/skills` 两根且**不去重、不告警**（P-21），
> 而 `~/.agents/skills` 是 codex 与 zcode **共享**的用户级根（P-22）。
> M10 之后各家入口资产同名而内容不同（D7 注入自家 `--driver`），一家会话加载到别家渲染的那份
> ⇒ `claim` 与 `locateSubject` 用的是别人的 Driver id，症状是退 64 或「找不到原稿」，
> 排障方向还会被引向文件命名规则。原稿只把跨根重名当作 zcode 一家的安装选择问题。
> **每家都要产出**：会枚举哪些根（有序）、同名时的行为（先到先得 / 后盖前 / 都加载）、有无告警。
> 实测时按具名行号复核 M6 报告的 P-19 / P-21 / P-22 三条。

### 2.1 agy：skills 加载行为（拍板 §18.1 #16）

- 隔离 `HOME`（沿用 M6 第 4 步 codex 那套三条臂手法）：在 `<fakehome>/.gemini/config/skills/dualtest/SKILL.md`
  放哨兵 + `$ARGUMENTS` 回显指令；print 模式发一次含 `/dualtest 甲 乙` 的调用，看回显。
- 负对照：同一调用加 `--disable-slash-commands`，哨兵应消失。
- 第三臂（排除替代假说）：`HOME` 隔离但**不放**哨兵，确认不是别的什么东西在回显。
- **读取面清单**（r1 新增）：枚举 agy 会读哪些 skills 根、同名行为、有无 diagnostics。
- **通过判据**：正对照见哨兵且参数逐字回显、负对照不见。
  通过 ⇒ §18.1 #16 拍板「skills 优先」；不通过 ⇒ 退路是 `GEMINI.md` 契约 + 用户口述命令意图，
  gemini 侧入口资产在第 5 步降为「协议片段 + 手工 CLI」并如实登记。

### 2.2 codex：`$ARGUMENTS` 展开行为（F-3）

- 隔离 `CODEX_HOME` + `HOME`（M6 §1 结论：指令根随 `HOME`），`$CODEX_HOME/skills/dualtest/SKILL.md`
  放哨兵与回显指令，`codex exec` 一次带参数调用；对照 `debug prompt-input` 只证常驻不证展开。
- **读取面清单**（r1 新增）：确认 `~/.agents/skills` 是否在枚举面内、与 `$CODEX_HOME/skills` 的优先级。
- 通过判据同 2.1。

### 2.3 zcode：加载面、Hook 形态与**真载体**（F-2 / F-4）

- **加载面**：`~/.zcode/skills` 与 `~/.agents/skills` 同名 skill 各放不同哨兵，真实调用一次看模型加载了哪份；
  `$ARGUMENTS` 回显。**结论决定第 5 步 glm 侧安装到哪个根**；若两根都会被加载，
  则只装一个根并在安装器里查另一个根的重名（§6.2）。
- **Hook 形态**：先静态——`~/.zcode/cli/config.json` 只 `grep -n` 键名（该文件含 provider 凭据，
  **禁止整份打印**，仓库根 `CLAUDE.md` 那条纪律）、`zcode.cjs --help`、二进制字面量扫 `PreToolUse` / `hooks` / `deny`；
  有线索再做行为实测：注册一条会 `exit 2` 的 Hook，发一次写工具调用，看是否被拒。
- **【P-2 阻塞点】真载体**：ZCode **交互会话**能否在项目根执行 `.trivium/bin/trivium preflight --stage plan --json`。
  **按 P-2 拍板，这一格接不通则 M10 不收口**——不再有「降夹具级 + 登记」的退路。
  确认不了时的动作是：如实记录失败形态、在 §11 R-h 登记阻塞、**停下来向用户报告**，而不是继续往下推进第 7 步。
- **headless 拉起口径**：一律走 `doctor` / `preflight` / `review` 入口，不手搓脚本复刻
  `prepareZcodeHome` / `scrubZcodeHome`（2026-09-20 事故与仓库根 `CLAUDE.md` 的纪律）；凭据文件只 `grep` 键名。
  实测中若要看 CLI 自写的 `v2/provider_config.json`，看的是**副本 HOME** 下那份，不是 `~` 下的。
- 通过判据：Hook 能拒一次写 ⇒ glm 维持 L1，第 6 步开工；否则翻 L2，第 6 步只落文档。

#### 2.3.1 `hooks_deny_ok` 的取值路径（r1 GLM-05，medium，新增）

D4 的 `effectiveGuardLevel` 要消费 `probe.cli.zcode.hooks_deny_ok`，但原稿 §2.5 只定了「届时才加字段」的**时点**，
**没定值从哪来**。这一格的实测要「注册一条会 exit 2 的 Hook、发一次写工具调用、观察拒绝」——
比 EV-81 的读文件式探针臂重得多，`doctor` 当前没有这种能力。若落人工手填，报告与探针段就是两份事实源
（报告写 false、字段没填时降级照发，因为判据是 `!== true`），而这恰恰是 F-1 要接上的那条链上再开一个岔。

**本步必须在进入第 4 步前二选一定死**：

- **(a) 探针臂自动实测**：向隔离 HOME 注册 Hook 再触发写调用。须先估工程量——若超过第 4 步本身，改选 (b)。
- **(b) 人工填写 + 防漂**：值人工填进配置，同时加一条「第 1 步报告结论与探针段字段不一致时 `preflight` 提示」的校验。

这是**计划级决策**，不留给实施时临场决定。

### 2.4 claude：无需实测

现状即基线（`~/.claude/skills/dual-*/`、Hook 五件套）。版本记 2.1.278。

### 2.5 本步的落盘边界

**不进机读 `ProbeSection`**，除非某格在 M10 内有运行期消费方——`guardLevel` 若按 D4 改为
「登记上限 + 探针降级」，那 zcode Hook 那一格就有了消费方（预检的护栏等级标注），
届时才加字段 `probe.cli.zcode.hooks_deny_ok`（三态），并同批加 `doctor` 展示；
其余格只进报告（§24.1 的口径：塞没有消费方的字段就是第二个 EV-06）。

> r1 三侧一致认同本节判断（codex：「纪律 12 / EV-06 的正确应用，值得保留原文」）。**原文保留。**

---

## 3. 第 2 步：EV-72 主题级 Driver 落盘（schema 变更）

### 3.1 问题

plan / bug 原稿在 `review --start` 之前由 Driver 写出，那一刻该阶段零留痕，`resolveRoundDriver`
回落缺省 Driver，非缺省 Driver 的 `-<id>.md` 原稿被判伪造件退 2。
EV-68 刻意接受该边界（fail-closed 会锁死今天的 `/dual-review-plan`）。

### 3.2 方案

- **新子命令** `trivium topic claim --topic <主题> --driver <id> [--json]`：由**编排器**创建
  `.reviews/<主题>/task.json`（不存在则 `emptyTask`），写入主题级 `driver`、`driver_claimed_at`
  **与 `claimed_by`**；已存在且 `driver` 相同 ⇒ 幂等退 0；已存在且不同 ⇒ 退 64 并指明
  「同一主题换 Driver 请新开主题」。**不提供覆盖旗标**——覆盖会让该字段成为第二个「沿用前一条的值」的槽位
  （EV-68 关闭时否掉 `GateEntry.driver` 的理由逐字适用）。
- `TaskMeta` **additive** 加可选字段 `driver?: AgentId`、`driver_claimed_at?: string`、`claimed_by?: string`，
  schema 仍 `trivium.task.v1`：既有文件缺该字段 = 「未声明」，语义与 `run.v2.driver_enabled` 的
  「缺失即无从得知」同构。
- `resolveRoundDriver` 改三级：**该阶段最新 `run.json.driver`** > **主题级 `task.json.driver`** > `DEFAULT_DRIVER`；
  留痕损坏仍硬失败（第 1 级现有行为不动）。拦截文案分别注明来源。
- `topic resolve` **保持纯只读**（USAGE 明写「不创建任何目录」，不改这条承诺）。
- 入口资产（第 5 步渲染）在「解析主题」步之后、写原稿之前插一步 `TV topic claim --driver <自家 id>`；
  claude 载体也加——它是缺省 Driver，claim 的效果只是留痕，行为不变（J3）。

#### 3.2.1 交叉校验的**论域**（r1 GLM-02 / AGY-02，major）

r1 原稿写「`topic resolve` 与 `review --start` 都要交叉校验：给出的 `--driver` 与 `task.json.driver`
不一致 ⇒ 退 64」，**无阶段／留痕窗口限定**。两侧独立指出这会锁死合理场景：

- 演进设计**第 647 行**明写：「同主题跨运行切换 Driver（如 claude→zcode 续跑）｜ **允许**；
  每轮 `run.json.driver` 如实记录；禁读矩阵按当轮 Driver 重算」。
- plan 阶段跑过一次后（`run.json.driver` 已在场），code 阶段想换 Driver 会被挡死，
  唯一出路「新开主题」会丢掉 goal、runs 版本链与审批史。
- 与 `resolveRoundDriver` 第 1 级「按**阶段**取留痕」的既有语义冲突——模型本身支持同主题不同阶段不同 Driver。
- 且与 §3.3 自列的跨阶段测试用例**自相矛盾**：有交叉校验时该状态不可构造。

**修正**：交叉校验**限定在「主题级 driver 仍是权威来源的窗口」**，即该主题相关阶段**零留痕**时。
留痕在场后权威即留痕——此时 `--driver` 与**最新留痕**不符则报错，且错误信息**指向留痕**，
而不是比对主题级字段。「不提供覆盖旗标」的结论**维持不变**：问题只在校验的论域，不在覆盖与否。

#### 3.2.2 自声明边界与第二事实源（r1 CODEX-03 / CODEX-04，major）

- **自声明（CODEX-03）**：claim 之后，「当轮 Driver」这个值第一次由**被保护方自己声明**——
  它直接决定 Write/Edit 侧哪些角色后缀可写、哪些受保护（保护集 = 全集减当轮 Driver），
  却只落 `driver` + `driver_claimed_at`，不落声明来源。
  原稿用 EV-68 否掉 `GateEntry.driver` 的理由论证不给覆盖旗标，那是**可变性**论证，没有覆盖**自声明**这一面。
  本仓有直接先例：`ApprovalRecord.session_id`（`meta.ts:43-57`）就是为「谁解的闸」这个最该留痕的事件补的。
  **处置**：claim 落 `claimed_by` / session 来源，在 `--json` 与预检输出里可见；
  计划显式写明边界——**主题级 `driver` 是 Driver 自声明，其权威等级低于 run 留痕**，
  人工侧要能事后回答「这次 claim 是谁发的」。
- **第二事实源（CODEX-04）**：同一文件里将有主题级 `driver` 与 `runs[].driver` 两份取值、生命周期不同。
  **补一条不变量**：`runs[].driver` 由编排器在 `review --start` 追加、是**留痕**；
  主题级 `driver` 由 `claim` 写入、是**声明**。二者不一致时**以 `runs[]` 最新一条为准**并在
  `preflight` 提示（不报错——跨阶段换 Driver 是合法场景，见 3.2.1）。
  `run-files-parity` / `registry-parity` 增这两个键关系的盯防点。

### 3.3 测试

- `hooks.test.ts`：三级各一条 + 「主题级 driver 为 A、该阶段 run.json 为 B」时以 run.json 为准。
  **该用例用预置留痕构造**（直接写 run.json 夹具），**不经 `--start` 制造分歧**——
  交叉校验在留痕在场后就不比对主题级字段了（3.2.1），经 `--start` 构造不出这个状态。
- 变异：第 2 级退回忽略主题级字段 ⇒ 用例红（目标文件取 `-<非缺省>.md` 才有鉴别力，EV-68 的教训）。
- 集成：`topic claim` 幂等、冲突退 64、`--json` 形状、`claimed_by` 落盘。
- 交叉校验窗口：零留痕时 `--driver` 与主题级不符 ⇒ 退 64；**有留痕时不比对主题级、只比对留痕**（两条用例）。
- `run-files-parity` / `registry-parity` 对新字段名的字面对账。
  （主题元数据文件名字样进 Bash 命令文本会撞 `MENTIONS_OWNED`——**测试与文档里提到它时用 Write / Edit，不用 Bash 重定向**。）

---

## 4. 第 3 步：EV-55 跨时间面重写（安全关键面）

> **前置**：P-1 的小主题（EV-74 / EV-79）须在本步之前完成。

### 4.1 提交锚 `immutableChangeReason`

现判据：basename 带「全集减缺省 Driver」后缀 ⇒ 拦。换 Driver 后两个方向都错（EV-55 原文）。

**新判据（两条合取任一命中即拦，均 fail-closed）**：

1. 该路径出现在主题下**任一** `run.json.artifacts[]` 登记内（含被冻结的原稿 `subject` 与审查件）
   ⇒ 「已登记工件一经落盘即不可变」。`archive.ts:436-442` 已有按 `artifacts[]` 的 sha256 核对函数
   （`checkRecordedArtifacts`），复用其读取而不另写一份。
2. basename 带**全集**任一后缀（`ALL_SUFFIXES`，含 `claude`）且位于归档根内
   ⇒ 拦，**但显式排除裁决件变体**（见 4.1.1）。

`run-*.json` 与 `_meta` 的既有分支不动。

#### 4.1.1 第 2 条必须排除裁决件（r1 GLM-01 / AGY-03，major）

两侧独立命中。`hooks.ts:1211-1216` 的既有不变量原文写着：

> 仍然放过两类本就该可变的文件：编排器每次运行都要更新的 `task.json`，以及 **Driver 本就该修订的裁决件
> （「修订」正是它的用途）**。护栏一旦误伤正常工作，第一个被关掉的就是它自己。

而裁决件 `…-revised-claude.md` / `…-response-claude.md` 的 basename **都以 `-claude.md` 结尾**，
会命中 `hasRoleSuffixCrossTime` 的同一正则（`hooks.ts:488-505`，锚定 `-<suffix>\.md$`）。
按原稿字面实施会切断 PRD 承诺的「拒绝后 Driver 按开发者意见改写归档内的修订件」路径（`approval.ts:4-6`）。
且裁决件**不在** `run.json.artifacts` 登记内（`review.ts:1481-1494` 追加的是审查工件与 `_meta` 补丁），
故第 1 条对它不生效——**第 2 条是它唯一的拦截面**，排除即彻底放行，符合既有不变量。

**修正**：第 2 条判据显式排除带 `-revised-` / `-response-` 的文件名。
裁决件维持可变，防覆盖交给 `-r<N>` 抬升与 `archive` 的 `O_EXCL`。

#### 4.1.2 提交锚拦截后的用户出口（r1 CODEX-02，major）

原稿 §11 R-c 给的出口是「改用 Write / Edit + `git commit -F <文件>`」——那是 **Bash 侧**的出口，
**对提交锚完全不适用**：提交锚拦的就是提交本身，用哪个工具写文件都改变不了「tracked 且 modified」这个事实。
而第 2 条把 Driver **自己已提交原稿的原地刷新**一并锁死（本主题的 r1 原稿此刻正是该状态）。

**本稿选定的出口（三选一中的第三项）**：**第 2 条只覆盖 `_meta` 与审查件全集，Driver 自己的原稿
交由第 1 条 `artifacts[]` 登记判定。**

理由：①原稿一旦被冻结送审就会进 `artifacts[]`，第 1 条即可拦住对**已送审版本**的改动，
不可变性该覆盖的面已经覆盖到了；②未送审的原稿刷新（如本主题 2026-09-21 那次事实更新）是正常工作，
锁死它只有误伤成本；③避免「另起 `-r<N>`」那条出口——它会把「文档刷新」消费掉一个**审查轮次号**
（`computeRerunIndex` 明写「只看审查工件、不看 Driver 原稿」，`archive.ts:45-53`），两套轮次号从此脱钩。

同时如实登记一条边界：提交锚只挂在 Claude Code 的 Bash matcher 上，`.git/hooks` 里没有 pre-commit 脚本，
**在终端里直接提交就完全绕过**。这条强制力是单向的（对不守规矩者零成本、对诚实路径全额成本），
写进 §11 R-c，不假装它是机械边界。

### 4.2 Bash 侧 `roleSuffixAnywhere()` / `bashTargetsProtected`

Bash 侧拿不到 run 上下文（命令文本里没有主题），按 `artifacts[]` 登记判在这里无从实施（EV-55 补记）。
**决策 D3：改为全集字面保护**（四个后缀都拦）。

- 不影响 Driver 写自己的原稿与裁决件——那走 Write / Edit（当轮面 `hasProtectedRoleSuffix(fileName, driver)`，EV-68 已做）。
- 误拦面扩大（R22 已登记）：命令文本里提到 `-claude.md` **且该命令像写命令**时会被拦，
  出口不变（Write / Edit + `git commit -F <文件>`）。
- **不做收窄**（`hooks.ts:809-840` 那段撤回记录与 RV-B1 同构，不再试）。
- **CLAUDE.md 误拦段与 `hooks.ts:913` 拦截文案的枚举改动，提为本步当步收尾**（见 4.2.1）。

#### 4.2.1 文档窗口期（r1 GLM-07，minor）

原稿把「仓库根 `CLAUDE.md` 那段『已知误拦』同步改」排到第 8 步，而第 3～7 步跨多天、各含一轮代码双审。
窗口期内 `-claude.md` 字样进 Bash 写命令即拦（本仓 commit message 惯例正带工件名），
而 `CLAUDE.md`——Driver 每次会话都读的行为约束——仍描述旧集合与旧出口，
**双审 Driver 自己会撞拦截并按过时文档排障**。

**修正**：CLAUDE.md 误拦段的枚举改动（连同 `hooks.ts:913` 的拦截文案）**提为第 3 步当步收尾**，
不等第 8 步；第 8 步只做其余回溯。

#### 4.2.2 关于 AGY-01（blocker，已驳回）的存档

gemini 判定 D3 会让今天走得通的 `/dual-review-plan` 在第 3 步启动审查时被自身 Hook DENY 拦死。
**已驳回**，理由记此备查：该判断只读了 `bashTargetsProtected` 首行（`hooks.ts:854`），
漏了调用点 `hookPreBash`（`hooks.ts:903-904`）的前置门——

```ts
const writeLike = WRITE_LIKE.some((re) => re.test(cmd));
if (!writeLike) return ALLOW;
```

`bashTargetsProtected` **只在命令像写命令时才被评估**。
`TV review --start … --plan-file …-claude.md` 不含任何 `WRITE_LIKE` 字面，D3 之后仍不会被拦。
**r1 运行本身即实证**：其第 3 步实跑的 `--start` 命令行逐字包含 `-claude.md`，正常执行并产出三份审查文档。

D3 真实扩大的是「writeLike ∧ 提到 `-claude.md`」这一交集，已由 R22 登记、由 4.2.1 处置。
**本步实施时须复核这条读法**；若彼时实测推翻，按纪律 1 回补设计并重开该意见。

### 4.3 测试

- 保留 RV-B1 锁下的五类负例。
- 新增：
  - 换 Driver 后历史 `-claude.md` **审查件**原地改 ⇒ 提交锚拦；
  - 新 Driver `codex` 的 `-codex.md` 原稿经 Write 放行、经 Bash 重定向拦；
  - 已登记工件即使后缀不在全集里（假想第五家）也拦（第 1 条独立成立）；
  - **裁决件形态**（4.1.1）：`-revised-<driver>.md` 原地改**可**提交（正例）；`_meta` 与审查件**不可**（负例）；
  - **已提交原稿刷新形态**（4.1.2）：未进 `artifacts[]` 的原稿原地改**可**提交；已进 `artifacts[]` 的**不可**。
- 变异：去掉第 1 条 ⇒ 至少一条红；去掉第 2 条 ⇒ 至少一条红；去掉 4.1.1 的排除 ⇒ 裁决件正例红。

---

## 5. 第 4 步：翻 `driverEnabled` 与 `approve` 复核

> **r1 修正（GLM-09，minor）**：原稿第 4 步捆了五种性质不同的改动（翻开关+D8、approve 复核、
> `guardLevel` 接线+D4、EV-62 异构判据、EV-64/EV-07 清理），后两类与前三类零依赖。
> 计划自己在 P-1 用过同一逻辑（「并入会让代码双审面同时含两种性质完全不同的改动」）。
> **修正**：登记清理类（EV-62 / EV-64 / EV-07）**拆出为 §5.5 的独立小步**，随第 2 步一并做或单独成步；
> 第 4 步只保留「安全收紧 + 审批链路 + 护栏接线」三块，且双审要点写明按三块分别出结论。

### 5.1 翻开关与护栏接线

- `registry.ts` 三处 `driverEnabled: true`；注释改为记本步与实测报告。
- `resolveDriver`（`critics.ts:154-190`）：`driverEnabled === false` ⇒ **退 64**（D8）。
  四家全翻之后该分支对注册表现值不可达，但它是第五家登记而未启用时的守卫，
  **保留并有用例**（夹具 overlay 造一个 `driverEnabled: false` 的桩）。
- `preflight.ts:628-635` 那行标注改为**打印护栏等级**：
  `Driver：codex（护栏 L2——无事前写拦截，审批前由编排器复核裁决完整性）`。
  这是 `guardLevel` 的第一个生产消费方（F-1）；`run.v2` 加可选 `driver_guard_level`，report 读它。
- **D4**：`guardLevel` 语义改为「登记上限」，运行期 `effectiveGuardLevel(agent, probe, hookConfigPresent)`：
  登记 L1 且（探针 `hooks_deny_ok !== true` **或** 该家 Hook 配置当前不在场）⇒ 降 L2。

#### 5.1.1 D4 的输入面必须含「配置当前在场」（r1 CODEX-11，minor）

原稿 D4 只守「探针为 true/false/null」这一格，**不守「探针曾为 true、现在已失效」**：
探针新鲜度按 CLI 版本判，而 Hook 配置是项目级/用户级**可被删除**的
（本项目对 `bin/` 被删有专门护栏——`hooks.json` 的 `_comment` 写着「删掉或改坏 `bin/` 会让每条 Hook 的守卫永真放行」，
说明这类破坏在本项目按现实威胁对待）。
若用户在 ZCode 侧删掉合并进去的 Hook 配置而 CLI 版本未变，预检还会继续宣称 L1——
**PRD FR-28「不得伪装成同等级强制」的伪装面恰好从这里进来**。

**修正**：`effectiveGuardLevel` 的输入除探针外，增「该家 Hook 配置当前是否在场」的**廉价存在性检查**
（读文件即可、零配额），拿不到就按 L2 说话。

#### 5.1.2 D4 对第 1 步的依赖（就地标注）

**本子项依赖第 1 步 2.3 的结论**：若 zcode Hook 实测落 **false**（而非 null），
则按原计划**直接把注册值翻 L2、不留两段逻辑**——两段逻辑只为「null 待复测」这一格存在。
届时 D4 退化为静态登记，`effectiveGuardLevel` 不建。

**r1 AGY-05（暂缓）**：gemini 主张 D4 整体是过度设计、应直接静态定值；
codex（CODEX-11）与 glm（GLM-05）则认定 D4 有真实消费方、**不是**第二个 EV-06，缺的是输入面与取值路径。
两种主张的分野完全取决于上述实测落哪一格，故**暂缓至第 1 步出结论后定夺**。
第 1 步报告须显式回答「`hooks_deny_ok` 落 true / false / null 哪一格」并在该报告中重开该意见。
5.1.1 与 §2.3.1 的落点不受暂缓影响，照常执行。

### 5.2 `approve` 前置复核（演进设计 §9.4，J2）

`cmdApproval` 在 `decision === 'approved'` 时、`recordApproval` 之前，对每个待批阶段**无条件**执行
`loadRoundReviews` + `checkAdjudication` + **`checkRecordedArtifacts`**
（`driver` 取留痕、`runId` 取闸门项，与 `--await-approval` 那段同源——**抽成一个函数两处调用**，不复制），
不通过 ⇒ 退 2 并打印缺口。`rejected` / `abandoned` 不复核。**不加确认码**（v1.2.3 ② 撤销过）。

#### 5.2.1 抽取时必须带上「推断不出 runId 即拒绝」（r1 CODEX-08，minor）

原稿只写「`runId` 取闸门项」。照字面实现会**丢掉目标代码最关键的一条约束**：
`cli.ts:946-957` 为此显式抛错，注释原文——

> 推断不出 runId 就**拒绝**，而不是跳过检查（审查意见 AGY-05 ≡ GLM-03）。
> `if (runId)` 那种写法等于留了个后门：只要让 runId 推断失败，整段裁决完整性校验就被绕过。

照字面抽取就是在新代码里重建一条**历史上已被双审打穿过两次**的通道；
而 J2 要保的恰恰是 L2 Driver 场景（无 Hook 拦删除）——那条场景里 run_id 缺失最可能发生。

**修正**：该分支列为抽取函数的**验收项之一**，并规定 approve 侧同样的「推断不出即退非零」用例，
含 L2 Driver 手工删件后闸门项字段缺失的形态。

#### 5.2.2 复核范围要含 sha256 抽核（r1 GLM-04，medium）

演进设计 §9.4 对 approve 复核的原文是「无条件重跑一次 `checkAdjudication`
（**含 `run.json.artifacts` 的 sha256 抽核**）」，原稿只落了前半。
`checkAdjudication`（`gate.ts:164-190`）只做意见编号与裁决件逐条比对，**不含工件哈希核对**；
审查工件被删/改时 `_meta` 结构化原文还在，裁决齐备性照常通过。
这正是 L2 Driver 场景下复核要兜的形态之一（没有 Hook 拦那次删除），
而原稿用例只造「裁决件缺一条」，覆盖不到它。

**修正**：抽出的复核函数并入 `checkRecordedArtifacts`（`archive.ts:440`，`hooks.ts:1274` 已在提交锚侧调用，
成本一行）对当轮 run 的核对。
**注意**：`--await-approval` 现状同样不含抽核（`cli.ts:957-977`），
原稿声明与它「同源抽成一个函数」会把这个缩窄**原样继承**——本步两处一起补齐。

### 5.3 用例

- 裁决件缺一条时 `approve` 退 2；
- `--await-approval` 通过后手工**删裁决件**再 `approve` 仍退 2（L2 Driver 场景：没有 Hook 拦那次删除）；
- `--await-approval` 通过后手工**改审查工件**再 `approve` 退 2（5.2.2 的抽核）；
- 推断不出 `runId` 时 approve 退非零（5.2.1）；
- `effectiveGuardLevel` 在「探针 true 但配置不在场」时降 L2（5.1.1）。

### 5.4 J5 复核

`critics.test.ts:120` 已覆盖非缺省 Driver。本步只加一条：
**四家逐一**作为 driver 时 `selectableCritics` 恒不含自己（穷举，防第五家登记时漏）。

### 5.5 【已拆出】登记清理小步（EV-62 / EV-64 / EV-07）

与 §5.1～5.4 零依赖，单独成步或并入第 2 步，**不与安全收紧同轮双审**（GLM-09）。

- **EV-62** `isHeterogeneous`（`adapters/base.ts`）改为按**当轮 Driver 的厂商**与审核者模型族比对；
  `overrideReasonFor` 文案同步。写点两处（`review.ts`），`driver-wiring` 第 420 行那条对账用例要跟着改判据。
- **EV-64** 删 `inferLatestRunId`（`driver-wiring.test.ts:381` 已断言无调用，删定义后该断言仍成立）。
- **EV-07 / F-6**（按 r1 三侧一致意见**拆成两件**）：
  1. **BACKLOG 条目改写后结案**——条目「状态陈旧」属实，其描述里那句「两处理由一致，M10 要一起改」
     与豁免现状不符，按 EV-39 口径如实重写后结案；
  2. **`types.ts` 的 `LITERAL_ALLOWLIST` 豁免保留**——它的现行理由是**探针键**
     （`ClaudeProbe` 等按 Agent id 命名的可选键），**腿没空**，删了会让 `registry-parity` 的探针键守卫失守。
  
  原稿写的「删豁免必须伴随证明它已不被需要的那条用例变绿」这条纪律**仍然成立**，
  但**本轮用不上**（没有要删的豁免）；若将来要删，那条用例须针对**探针键**构造，
  不得沿用已作废的 `Disposition.role` 旧理由。
- **EV-61** USAGE 的 `--model-gemini / --model-glm`、`--only gemini|glm` 与三处 `argument-hint`
  改按注册表插值——**随第 5 步渲染一起做**（那时 `argument-hint` 本身就是渲染产物），不在本小步。

---

## 6. 第 5 步：四家入口资产单源渲染、install 多目标、协议片段两段式

### 6.1 单源渲染（演进设计 §10.2）

- 新增 `skills-src/commands/{run,review-plan,review-code,review-bug,approve,abandon,status}.contract.md`：
  命令契约正文（参数表、七步序列、等待义务三条款），**从现有 7 份 SKILL.md 抽出**，
  抽出过程用 diff 证明「渲染回 claude 载体 = 现文件」（J3 的机器证据）。
- 四家载体适配层 `skills-src/carriers/<agent>.yaml`：frontmatter 字段映射、`TV` 调用前缀、
  **`--driver <自家 id>`** 注入点（`topic claim` / `topic resolve` / `preflight` / `review --start` 四处）。
- `scripts/build.mjs` 增渲染步。
- 契约测试 `entry-render-parity`：①渲染产物与源在 CI 上零 diff（改源不重渲当场红）；
  ②`skill-flag-parity` 扩为四家 × CLI 旗标对账；③每家产物含且仅含自家 `--driver`。
- **`--driver` 进 skill、命令 A 放开**（D7）：`topic-args.ts:352-358` 那段拒绝改为接受；
  设计 §7.1「不进 skill、不进 `argument-hint`」那句随第 8 步改为「自 M10 起由渲染注入」。

#### 6.1.1 渲染产物落点必须避开 `skills/` 顶层扫描（r1 AGY-06，minor）

原稿定「另三家落 `skills/entry/<agent>/dual-*/SKILL.md`」。**这会破坏 claude 侧的字节兼容承诺**：
`install.ts:88-93` 的 `skillNames()` 扫描 `skills/` 下**所有直接子目录**并逐个同步到 `skillsTarget`
（`install.ts:108-112`），故新增的 `skills/entry/` 会被整体当作一个 skill 装进 `~/.claude/skills/entry`，
污染用户的 Claude skills 目录——与 D5「claude 产物路径不变、wrapper 与 install 不动」直接冲突。

**本稿选定**：另三家产物落 **`skills/dual-critic/entry/<agent>/dual-*/SKILL.md`**（不新增顶层目录）。
`dual-critic` 本就是资产目录、已在同步面内，其子目录随之搬运，不改 `skillNames()` 的语义。
备选（若 `dual-critic` 体积不宜再膨胀）：维持 `skills/entry/` 但在 `skillNames()` 增显式过滤
**并加一条对账用例**锁住「claude 目标的同步面逐字节不变」。两者取其一，**不得默认原稿写法**。

> r1 glm 侧（GLM-F08）确认 D7 与「skills/ 是资产根、wrapper 不动」的兼容承诺在**契约层**不冲突；
> 本条修的是**实现层**的落点选择，两者不矛盾。

### 6.2 install 多目标与**运行时根**（演进设计 §7.5 表）

#### 6.2.1 运行时／资产根是必装目标（r1 CODEX-01，major）

原稿只安排了「四家入口 SKILL.md 装到哪」，**没安排「编排器运行时与机读资产装到哪」**
（`dual-critic` 的 `scripts/trivium.cjs`、`schema/`、`prompts/`、`hooks/`、`lenses.yaml`）。
这条链子今天完全绑在 claude 的根上：`assetRootDefault()`（`init.ts:45-46`）与 `resolveAssetRoot`
（`review.ts:397-401`）硬编码 `~/.claude/skills/dual-critic`，wrapper 里写死该 bundle 的绝对路径。
配合本步拟定的「目标家的 CLI 根目录不存在 ⇒ 跳过不失败」，
**只用 ZCode / Codex / agy 的机器上 claude 目标被跳过 ⇒ 运行时根本没落盘 ⇒
`trivium init` 生成的 wrapper 指向不存在的文件，四条命令一家都跑不了**，第 7 步在起点就失败。

**修正**：
- 在本节明确「**运行时／资产根是必装目标**，不随注册表派生、不参与『根不存在即跳过』」；
- `writeWrapper` / `assetRootDefault` / `resolveAssetRoot` 三处改**同源派生**；
- 「装了入口资产却没有运行时」判为**安装失败**（响亮报错，符合纪律 1 的取向）；
- §12 的验证回路要真跑一台「只有另一家」的机器形态。

#### 6.2.2 目标表与查重名

- `InstallTargets` 改为 `installTargets[]`，**按注册表派生**（纪律 7）：
  claude `~/.claude/skills`；codex `~/.codex/skills`；
  glm `~/.zcode/skills` 或 `~/.agents/skills`（**第 1 步 2.3 的读取面清单定**）；
  gemini `~/.gemini/config/skills`（第 1 步 2.1 通过时；不通过则该目标不装、报告里明示）。
  只读审查者 `agentTarget` 保持。
- **一律 user 级**（M6 §3.4：zcode 的 user 级命令会静默盖掉项目级）。
- **查重名按「读取面」而非「安装根」判定**（r1 CODEX-05）：因为各家读取面跨根且
  `~/.agents/skills` 是 codex 与 zcode 共享根。**装前查每家完整读取面内的同名资产，撞名报错不覆盖**；
  并在本节明确「**哪个根禁止作为安装目标**」——若 `~/.agents/skills` 确为两家共享，就不该往里装同名入口资产。
- 目标家的 CLI 根目录不存在 ⇒ 跳过并在报告里列出，不失败（**运行时根除外**，见 6.2.1）。
  卸载对称、裁剪孤儿。

#### 6.2.3 测试必须注入临时 home（r1 CODEX-06，minor）

本步落地后，§12 要求的每步验证前 `npm run install:local` 会开始写开发者真实的
`~/.codex`、`~/.zcode`、`~/.gemini`，与 AGENTS.md **纪律 9**（不动用户全局配置，需要独立配置走临时副本）
正面冲突；且「根不存在即跳过」意味着**开发者的机器形态决定测试走到哪条分支**——
一台只装了两家的机器上，四目标里两目标是跳过臂，J3 的「对 claude 目标逐字节不变」也变成不可复现断言。

**修正**：
- `install.test.ts` 扩四目标时**一律注入临时 home**（`defaultTargets(home)` 已可注入，逐目标覆盖）；
- 「撞名报错」的判定**只看我们自己的 skill 目录**，不对用户的其它 skill 发言；
- 明确 `syncDir` **孤儿裁剪在共享根上的作用域**（只裁剪我们装的那些名字，不得删别人的）；
- §12 区分「测试用的沙箱安装」与「开发机真实安装」两步，**不把后者写成每步前置**。

### 6.3 协议片段两段式（演进设计 §7.5；EV-06 接线）

- `protocol/<file>.snippet` 改为两段：【Driver 协议】（现 `CLAUDE.md.snippet` 内容泛化：
  「**当轮 Driver** 是唯一有权改业务代码的角色」、命令入口、逐条裁决、审批发起权、
  Bash 误拦出口——含第 3 步扩大后的全集后缀）+【审查员身份】（现 `AGENTS.md.snippet` 内容），首段按身份分流。
- `init.ts` 按注册表 `instructionFiles` 分发（**EV-06 结案的「接上」分支**），新增 `GEMINI.md`；
  标记内多段升级幂等（已有 `MARKER_BEGIN/END` 机制，需支持「旧单段 → 新两段」替换而非追加第二块）。
- **claude 侧不生成审查员段**：EV-44 已实测 `--restricted` 阻断项目记忆，审查员段对 claude 是死件；
  `CLAUDE.md` 只装 Driver 段，`init` 的报告里写明理由。
- 仓库根 `CLAUDE.md` / `AGENTS.md` 随之更新（回溯清单第 17 项）。

> **未覆盖项登记**（r1 codex `not_covered`）：`init.ts` 的 `appendSnippet` 标记替换实现未被任一侧审查，
> 因此「旧单段 → 新两段」升级在**用户手工改过标记内内容**的机器上会怎样（丢什么、成本多少）**尚未核算**。
> 本步实施前先读该实现并补一条用例。

---

## 7. 第 6 步：Hook 多目标（**条件步**，取决于第 1 步 2.3）

- **通过时**：`mergeHooks` 增 ZCode 配置目标（键名与形态按实测），`trivium init` 同时合并两家；
  新增 `trivium hooks --agent <id>`（只做「渲染 / 安装该家 Hook 配置」，**不参与任何判定**——§8.5 注记原文；
  命令串仍不带 driver，EV-68 结论）。glm 维持 L1。
- **不通过时**：本步只落文档：注册值翻 L2、RUNBOOK 增「L2 Driver 人工兜底」节、QUICKSTART 明示（R18）。
  `hooks --agent` 不做（没有第二个目标就没有这个旗标的消费方）。
- 两种结果都要写进第 1 步报告与设计 §8.5 引言块（第 8 步）。

> r1 glm 侧确认本步「只渲染/安装、不参与判定」的定位与主设计 §8.5 注记（`:1495`「`--agent` 不得成为第二条判据源」）
> 一致，「明确不读」演进 §9.3 那句的取舍有据。**原文保留。**

---

## 8. 第 7 步：验收（AC-21、EV-77、兼容）

> **前置**：EV-82 小主题须在本步之前完成（否则 8.2 的 glm 鉴别条件失明）。
> **阻塞**：J4 按 P-2 不接受降级——§2.3 的 zcode 真载体接不通则本步不启动，M10 不收口。

### 8.1 为什么不在本仓库跑

同 M9 第 6 步：本仓库的执笔者是本会话；且换 Driver 会在本仓归档里留下非缺省 Driver 的原稿，
污染后续 `gate` 读取面。在临时夹具仓库跑，留痕收进 `doc/05_testing/evidence/m10-acceptance-<日期>/`（不进 `.reviews/`）。

### 8.2 剧本（四 Driver 各一轮命令 B）

| Driver | 载体 | 审核者 | 性质 |
| :--- | :--- | :--- | :--- |
| claude | 本会话（现状） | codex / gemini（**不带 glm**，本轮无需 glm 作证据） | **兼容回归**：与 M9 留痕逐字段比对工件名、run.json 形状、Hook 退出码 |
| **glm** | **ZCode 交互会话** | claude / codex / gemini 中任两家 | **真实，不可降级**（P-2）。载体接不通 ⇒ 本步停下、M10 不收口 |
| codex | codex 交互会话 | claude / gemini 中任两家（**不带 glm**） | **夹具级 + EV-77 真载体写事件**：闸门期在 codex 会话里改一个业务文件，预期**无拦截**，随后 `approve` 复核与漂移复算暴露 |
| gemini | agy（第 1 步 2.1 通过时） | 任两家 | 夹具级；不通过则按退路（协议片段 + 手工 CLI）跑一轮，登记 |

**每轮判据**：原稿后缀 = Driver；`run.json.driver` = 声明值且 `driver_enabled: true`；
审核者集合不含 Driver；裁决件 `role` = Driver 且 `gate --check` 通过；
`approve` 前复核触发（造一次缺件确认退 2，造一次改工件确认退 2）。

**glm 作审核者的轮次**加一条：`--model-glm <非首位模型>`，核 `run.json` glm 段
`model_route: config_copy` 且 **`model_override_applied: true`**。
> ⚠️ **这条判据在 EV-82 修复前失明**（r1 实测 `model_override_applied: false`，见抬头警示块）。
> 故 §1.2 把 EV-82 列为本步的前置；在它修复前，凡带 glm 的轮次都不能拿模型路由作证据。

> **r1 修正（CODEX-07）**：不需要 glm 作证据的轮次已在上表显式不带 glm，
> 以缩小 R-g ① 的风险面与配额。

### 8.3 兼容验收（J3）

claude 轮的 `.reviews/` 布局、文件名、`_meta` 形状与 `settings.json` Hook 段与 M9 留痕 diff
只允许出现新增可选字段（`driver_guard_level`、主题级 `driver` / `driver_claimed_at` / `claimed_by`）。

**取值口径也要列**（r1 CODEX-11）：原稿只列了允许新增哪些**字段名**，没列它们的**取值**。
补：claude 轮的 `driver_guard_level` 必须为 `L1`（claude 有事前写拦截），
主题级 `driver` 必须为 `claude`——取值不符同样判为兼容性回归失败。

**并补一条形态**（r1 CODEX-02）：claude 兼容回归要把「**刷新已提交原稿**」这一形态跑一遍，
验证 4.1.2 选定的出口确实可走。

---

## 9. 第 8 步：纪律 6 回溯与留痕

### 9.1 目标文档（初表，第 8 步以 `grep` 生成落点清单并做差集自检）

| 文档 | 改什么 |
| :--- | :--- |
| 主设计 | §16.1 M10 行状态与达成边界；§8.5 引言块由指针占位翻为已实现（含 L1/L2 实测结果）；§7.1 `--driver` 段与 7.4；§18.1 #16 拍板；§24.1 三行转绿；R18 / R22 现状；§21 变更记录升次版本 |
| **演进设计**（r1 GLM-03 新增） | **§5.2**（Driver 运行属性与兼容承诺现状）、**§7.5**（安装目标表：codex 改 skills 形态、gemini 形态、两段式片段、claude 侧不生成审查员段）、**§9.3**（删去「字面集按 `--agent` 动态生成」——已被主设计 §8.5 注记取代）、**§10.2**（渲染产物落点由「构建时渲染」改为 D5 的提交进 Git）；**AC-N2** 按 P-2 维持不下调 |
| PRD | FR-28 / AC-21 / S6 状态；抬头「AC-21 未达成」句；追溯矩阵 |
| `.reviews/README.md` | 「换一家 Agent 主攻仍为待实施」句；提交锚与 Bash 侧口径 |
| 仓库根 `CLAUDE.md` / `AGENTS.md`、`protocol/*.snippet` | 两段式；「当轮 Driver」措辞；**误拦后缀全集已在第 3 步当步改过**（4.2.1），此处只做其余回溯 |
| `skills/` 12 份资产 | 渲染产物；`dual-critic/SKILL.md` 与 `templates/README.md` 现状句 |
| QUICKSTART / MANUAL / PROTOCOL / RUNBOOK | 四家安装与 Driver 切换；L2 明示；RUNBOOK「多审失败处置、L2 Driver 人工兜底」**含 9.2 的自触发边界** |
| CASE_manual_acceptance | 补 S6 剧本 |
| BACKLOG | EV-06 / EV-55 / EV-61 / EV-62 / EV-64 / EV-72 / EV-77 结案；**EV-07 按 §5.5 改写后结案**；**EV-82 重开并记 r1 实测证据**；新挖的登记 |

### 9.2 L2 Driver 的自触发审批边界必须写进文档（r1 GLM-08，minor）

M10 把「approve 可由 Driver 自触发」这条既有边界，从**单一 Driver 的已知取舍**
变成**两家 L2 Agent 的常规能力面**：入口资产预批准了 `Bash(.trivium/bin/trivium:*)`，
L2 Driver 可以自己写裁决件（本就是它的后缀）再自己跑 `approve`，
而复核只保「裁决齐备」、不保「审批来自人」。
原稿 §11 R-e 与本节 RUNBOOK 行均未点名这条；不写明的话，**L2 的三层补偿读起来比实际强**，
与 FR-28「不得伪装成同等级强制」的精神相抵。

**修正**：RUNBOOK / QUICKSTART 的 L2 明示内容搬入 `approval.ts:16-33` 的现成表述
（该注释已诚实记录信任边界：确认码已撤、不假装有机械边界），作为 L2 残余风险与 R18 **并列**登记；
§11 R-e 同步补这一句。

---

## 10. 不可逆决策

| # | 决定 | 为什么 | 错了怎么退 |
| :--- | :--- | :--- | :--- |
| D1 | 主题元数据 additive 加 `driver` / `driver_claimed_at` / **`claimed_by`**，不升 v2；换 Driver 不允许覆盖；**交叉校验限定在零留痕窗口**；与 `runs[].driver` 冲突时以后者为准 | 缺失 = 未声明，与 `driver_enabled` 同构；覆盖会造出「沿用前一条」槽位；跨阶段换 Driver 是演进设计 §647 明确允许的场景 | 字段可选，读侧忽略即回到今天 |
| D2 | 提交锚判据改为「artifacts 登记 ∪ 全集后缀」，**第 2 条排除 `-revised-` / `-response-` 裁决件，且不覆盖未登记的 Driver 原稿** | FR-25 只追加不覆盖；纯后缀区分不了历史与当轮；但裁决件与未送审原稿本就该可变（`hooks.ts:1211-1216`） | 第 2 条可单独回退为「全集减缺省」，第 1 条独立成立 |
| D3 | Bash 侧后缀字面保护改全集 | Bash 拿不到 run 上下文；fail-closed 方向；出口零成本 | 回退为旧集合一行改动；不做收窄 |
| D4 | `guardLevel` = 登记上限，运行期按**探针 ∧ 配置在场**降级；zcode 实测 false 则直接翻 L2 不留两段 | 不伪装；两段只为 null 那一格；配置可被删除是现实威胁 | 删 `effectiveGuardLevel`，回到静态登记 |
| D5 | 另三家渲染产物提交进 Git，**落 `skills/dual-critic/entry/<agent>/`（不新增顶层目录）**，claude 产物路径不变 | 可 diff 对账、审查员读得到；避开 `skillNames()` 的顶层扫描，保住 claude 侧字节兼容 | 改为构建期产物 + `.gitignore`，对账测试改读 dist |
| D6 | 入口资产一律 user 级安装，**按读取面**查重名，撞名报错不覆盖 | M6 §3.4 实测 user 盖 project 且静默；P-19/P-21/P-22 读取面跨根 | 加 `--force` 旗标（本轮不加） |
| D7 | `--driver` 由渲染注入各家入口资产；命令 A 放开 `--driver` | 入口资产自己知道身份（演进设计 §5.2）；M9 §2.14 的限定以 M10 为终点 | 命令 A 恢复拒绝一处改动；渲染层删注入点 |
| D8 | `driverEnabled: false` 由「放行 + 标注」收紧为退 64 | M9 的口子只为第 6 步验收；第五家登记未启用时要有守卫 | 恢复标注分支（保留其用例） |
| **D9** | **运行时／资产根是必装目标，不参与「根不存在即跳过」；装了入口资产却无运行时判为安装失败** | 运行时今天绑死在 claude 根上；跳过它会装出「有入口、无运行时」的残缺态 | 恢复为随 claude 目标一起装（回到今天） |
| **D10** | **J4 不接受 zcode 降夹具级：真载体接不通则 M10 不收口**（P-2 拍板） | AC-21 的「zcode 真实一轮」是达成判据本身，降级会让 M10 的完成判据名存实亡 | 改回「夹具级 + 达成边界登记」，同时改主设计 §24.1 行与演进设计 AC-N2 |

---

## 11. 已知风险与边界

- **R-a 第 1 步的结论决定第 5～7 步的形态**，且 agy / zcode 两家的行为实测都要发真实调用（配额与墙钟，量级见 §1.4）。
  第 1 步先跑、结论出来再进第 5 步；第 2～4 步的**主体**不依赖它，可并行推进
  （唯一例外是 D4 子项，见 §5.1.2）。
- **R-b【已升级】zcode 真载体不可用**（F-4）：**按 P-2 拍板，这是 M10 的硬阻塞，不是可登记的降级**。
  F-8 已结（EV-81），headless 通了；剩下的是「交互会话当 Driver」这一层。
- **R-h【新增】P-2 阻塞点的形态风险**：第 1 步 2.3 的真载体确认是 M10 关键路径上唯一「可能根本做不到」的一格
  （`zcode` 不在 PATH，编排器走应用包内 `zcode.cjs`，而真载体是 ZCode 的交互会话）。
  它**在第 1 步就会暴露**，不会拖到第 7 步——这是把它排在第 1 步的价值。
  接不通时的动作已在 §2.3 写死：如实记录、登记阻塞、停下来报告，**不自行降级口径**。
- **R-g glm 侧的两条环境风险**：① 桌面端会改写 `~/.zcode/v2/provider_config.json`
  （切 provider 家族时抹掉 `defaultModelSelection`、把自定义 provider `enabled` 翻 false，CLI 随即 `Model creation failed`）——
  撞上时先看 RUNBOOK「Select a model before continuing」那行，**不是**编排器的锅（EV-87）；
  ② **守卫的失明边界已实证**：r1 带 `--model-glm GLM-5.3-Flash` 跑出 `model_override_applied: false`，
  **EV-82 未结案**。在它修复前，`--model-glm` 不能作为任何判据的鉴别条件（§8.2 已据此改写）。
- **R-c 误拦面扩大**（D3，R22）：本仓库日常会更频繁撞 Bash 侧拦截。出口已有且写在 `CLAUDE.md`
  （第 3 步当步同步，见 §4.2.1）；不为此开任何豁免（RV-B1）。
  **并如实登记**：提交锚只挂在 Claude Code 的 Bash matcher 上，`.git/hooks` 无 pre-commit 脚本，
  终端直接提交完全绕过——这条强制力是单向的，不假装它是机械边界（§4.1.2）。
- **R-d 渲染层引入第二事实源的风险**：契约源与四份产物若靠人记得重渲，就会漂。
  靠 `entry-render-parity` 在 CI 上判红，不靠记性。
- **R-e L2 Driver 的残余风险**（R18）：闸门期可改业务文件，事后暴露。
  本轮把「审批前裁决完整 + 工件哈希一致」守死（§5.2），把「写拦截」如实降为事后可审计，文档明示。
  **并补一条**：L2 Driver 可自写裁决件再自跑 `approve`，复核只保「裁决齐备」不保「审批来自人」（§9.2）——
  **不用祈使句伪装机制**。
- **R-f selftest 不覆盖非缺省 Driver**（F-7）：自检链路对 M10 的证明力只到 claude 侧；
  是否扩展在第 7 步按成本决定并登记。
- **R-i【新增】联合校验在解析回退时不生效**：r1 三份审查件的 `joint_check` 均为
  `skipped-insufficient-sides`（`effective_sides: 1`，因 codex 与 glm 两侧 `parse_fallback`），
  故「两家同时提出的 blocker 被驳回即报」这层保护**本轮没生效**——而 r1 唯一的 blocker（AGY-01）恰被驳回。
  后续各轮双审若再遇两侧以上解析回退，**驳回 blocker 时须按具名行号写实理由**（r1 已照此办理，见 §4.2.2）。

---

## 12. 验证方式

- 每步：`npm run typecheck && npm run build && npm test` 全绿。
- **安装验证分两层**（r1 CODEX-06）：
  - **沙箱安装**（每步前置）：测试注入临时 home，四目标逐一覆盖，不碰开发者真实的 `~/.codex` / `~/.zcode` / `~/.gemini`；
  - **开发机真实安装**（`npm run install:local`）：只在需要用 wrapper 验证全局副本时做，**不是每步前置**。
    （wrapper 指向全局副本，改完 skill 资产不装就验的是旧代码——这条仍然成立，但它只约束第二层。）
- **多目标验证要真跑一台「只有另一家」的机器形态**（r1 CODEX-01 / D9），确认运行时根仍被装上。
- 变异验证：第 2 步（忽略主题级字段）、第 3 步（去掉任一条判据 / 去掉裁决件排除）、
  第 4 步（approve 跳过复核 / 跳过 sha256 抽核 / `if (runId)` 写法）各至少一条红，记入应答件。
- `trivium doctor --selftest` 全绿（缺省 Driver 路径不退化）。
- 第 7 步报告含每轮命令、退出码、留痕路径与 sha256。
- **变异验证前先确认 `dist/test` 真被重编**（`node scripts/build.mjs --tests-only`；`npm run build` 不含测试树）——
  EV-82 r3 前两轮变异循环因此空跑过，五条「全逃逸」其实跑在旧产物上。

---

## 13. 给下一轮审查员的提醒

- 本稿是 r1 三侧双审（27 条，接受 24）之后的修订稿。**请重点看接受意见的落点是否真落到位**，
  尤其：§3.2.1 交叉校验的窗口限定、§4.1.1 裁决件排除、§4.1.2 提交锚出口的三选一、
  §6.1.1 渲染落点、§6.2.1 运行时必装。
- **P-2 拍板（卡住 M10、不接受 zcode 降级）是本稿相对 r1 最大的口径变化**，
  连带改了 J4、§2.3、§8.2、R-b 与新增 R-h / D10。请核这组改动是否自洽、有没有遗漏的降级出口。
- **AGY-01 被驳回**（D3 不会锁死 `/dual-review-plan`），理由与实证存档在 §4.2.2。
  若你不同意这个读法，请直接指出 `hookPreBash` 的 `writeLike` 前置门在哪种形态下不成立。
- **AGY-05 暂缓**（D4 是否过度设计），条件写在 §5.1.2——它等第 1 步实测，不在本轮定夺。
- **EV-82 已重开**（抬头警示块）。§8.2 的 glm 鉴别条件在它修复前失明，请核 §1.2 的前置关系是否够。
- 第 4 步已按 GLM-09 拆出 §5.5，请看拆分线是否切在正确的位置。
