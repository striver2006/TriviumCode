# M12 批次 4：模型覆盖旗标空值退 64（EV-228）与档位表 Agent 级 effort 废弃（EV-227）

- **日期**：2026-10-18
- **执笔**：Claude Code（当轮 Driver）
- **主题**：`M12-参数与配置小修`，命令 A（`/dual-run`，用户发起），A 档
- **上位**：[`doc/08_project/M11后续-开发计划-草案.md`](../08_project/M11后续-开发计划-草案.md) §5；主题计划定稿 `.reviews/M12-参数与配置小修/plan/` r2；用户 D-8：两项都选 A、合成一个主题
- **厂商配额**：只有本主题双审（每轮 gemini、glm 各 1 次，另预检认证探活各 1 次）；其余零厂商调用

## 1. 审查经过

| 阶段 | run | 结论 | 处置 |
| :--- | :--- | :--- | :--- |
| 计划双审 | `20261017T164003Z`（7m47s） | gemini `approve`、零意见；glm `approve-with-nits`（1 nit） | 接受 GLM-01：文档同步清单按 `AGENTS.md`「改动同步清单」逐项列出核对面（r2 §5.1，结论见本报告 §5） |
| 代码双审 | `20261017T170929Z`（13m23s） | gemini `approve`、零意见；glm `approve-with-nits`（1 nit） | 接受 GLM-01：设计文档已引用的本报告与 `README.md` 索引条目补落盘（即本文件与同批索引行） |
| verify | `20261017T173644Z` | typecheck、build、`npm test` 全通过（312s） | verify 前 `npm run install:local`；提交后需从已提交状态重建，再请用户重装 |

两侧计划审都支持把 `cli.ts` 的 `--model-<id>=` 一格纳入（见 §2.2）。**这一格超出 D-8 的字面改动面**（上位计划只写了 `topic-args.ts`），请用户追认。

## 2. 改动

### 2.1 EV-228：`topic resolve` 按键存在判定（行为变化）

- `src/trivium/topic-args.ts`：`--model-<id>` 由按真假过滤改为按键存在收集；先 `assertModelOverrideKeys`（键）、再 `assertFlagValuesGiven('model', …)`（空值），次序与档位旗标一致。
- `src/trivium/tier-flags.ts`：抽出 `assertFlagValuesGiven(prefix, raw)`，`assertTierFlags` 的空值循环改为调它——模型旗标与三类档位旗标共用一份，文案逐字同源：`--〈前缀〉-〈id〉 需要一个值，但没有给出。`
- 原先被静默丢弃的三种形态（`=` 空、紧跟已知旗标、位于末尾）改为退 64、零工件；正常写法与不写逐值不变；`critics` 解析未动，两轮共用同一组的语义不变。

### 2.2 关联一格：`cli.ts` 的 `--model-<id>=`

- `collectModelOverrides` 对 `=` 空记空串（此前 `flagString` 返回 null、被 `if (v)` 跳过）；`review`（`--start` 同函数）、`preflight` 在键判定之后、`doctor` 在收集之后调同一个 `assertFlagValuesGiven`。
- 另两种形态早已由 `flagString` 退 64，文案不变。`doctor` 不判模型覆盖的键是现状，本批不扩大（残余不对称：`doctor --model-codex X` 不判键）。
- `USAGE` 的 `--model-*` 一行补「写了不给值同样退 64」。

### 2.3 EV-227：档位表 Agent 级 `effort` 废弃

- `src/trivium/config.ts`：`DEPRECATED_CONFIG_KEYS` 补 `['profiles', '*', '*', 'effort']`。两层通配依次匹配表名与 Agent id；走查按段数精确匹配，阶段格子 `{model, effort}` 的 `effort` 在下一层、不会命中。文件头对 `'*'` 的说明改准。
- `src/trivium/types.ts`：`ProfileEntry` 删该字段。删后 `tsc` 通过，印证没有读取点。
- `skills/dual-critic/schema/config.v2.json`：该属性加 `deprecated: true` 与描述，枚举不放宽；`profiles` 描述末句改为指向它；`$defs/stageModel` 不动。
- 提示走既有通道：doctor（`warnings`）与 preflight（「已废弃配置键」只警告项）各一条，正文 `deprecatedConfigNotice` 未改。

## 3. 用例

| 文件 | 新增 | 盯什么 |
| :--- | :--- | :--- |
| `test/unit/topic-args.test.ts` | EV-228 四格 | 三形态 × 两侧退 64、与同形态 `--tier-` 前缀替换后逐字相等；正常写法与不写逐字段 deepEqual；先键后值；紧跟未知 `--xxx` 照旧当值 |
| `test/unit/tier-flags.test.ts` | K8 | `assertFlagValuesGiven` 四前缀逐字同构、与 `assertTierFlags` 实际出口一致、多侧报第一个 |
| `test/integration/tier-flags-cli.test.ts` | T6～T8 | 经 bundle：resolve 三形态；`preflight --model-glm=` 与 `--tier-glm=` 同文案、紧跟旗标仍是 `flagString` 文案；`doctor` 与 `review --start` 的 `=` 空退 64、不留运行记录 |
| `test/unit/config-consumers.test.ts` | U14 | Agent 级出现即报、两表 × 多侧排序、阶段格子不报、与既有废弃键同在时排在最后 |
| `test/unit/config-schema.test.ts` | V9 | `deprecated`、枚举不变、`max` 被拒、`loadCtx` 原样保留、`stageModel` 不废弃 |
| `test/unit/preflight.test.ts` | U5″、U6′ | 预检照常通过、警告点名；doctor 恰一条、只点名 Agent 级、阻断不变 |
| `test/unit/tier-resolve.test.ts` | R12 | 写了 Agent 级 `effort` 解析逐值不变；阶段格子的思考等级照常给出 |

**改了一条既有断言的锚点**：`test/unit/driver-wiring.test.ts`「两个入口的 `--model-<id>` 收集面都必须是 `ALL_AGENT_IDS`」把 `topic-args.ts` 的定位锚点由 `/const written = /` 改为 `/const modelRaw: /`。第一遍全量在这里红（锚点随改名失效，断言自己的提示就是「锚点该跟着改了」）；两条判据（`ALL_AGENT_IDS` 在、`CRITICS` 不在）原样，不算放宽。其余测试改动都是新增。

## 4. 变异

证据：[`evidence/m12-batch4-20261018/`](./evidence/m12-batch4-20261018/)。

- 逐条预跑（`mutation-names-bundle.mjs`，重打 bundle，照搬批次 3 的脚本）：**14 / 14 咬住**（M1～M12 源码、S1～S2 schema），每条的红用例名见 `mutation-names-log.txt`。
- 正式装置 `scripts/mutation-check.mjs`（只收 `.ts` 目标，`mutation-spec-ts.json`）：**12 / 12 咬住**，`mutation-output.txt`。
- schema 两条走预跑脚本：变异装置只认 `.ts` 目标；`config-schema` V9 读的是仓库里的 schema 原件。

## 5. 文档同步（计划 r2 §5.1 逐项判定）

| 清单行 | 核对面 | 结论 |
| :--- | :--- | :--- |
| JSON Schema | `parse` / `gate` / `meta` 校验 | 核过、不改：config schema 不经它们 |
| JSON Schema | PROTOCOL | **同步**：「已废弃键」一段补登本条，并补登 v1.3.136 的四键（此前漏登） |
| JSON Schema | `skills/dual-critic/SKILL.md` 契约面 | 核过、不改：不列 `profiles` 格子字段 |
| JSON Schema | `AGENTS.md` 契约面描述 | 核过、不改：不描述 `profiles` 格子 |
| JSON Schema | `registry-parity` schema 扫描 | 核过、不改：只加 `deprecated` / `description`，不涉 Agent 身份枚举；全量通过 |
| CLI 参数或退出码 | `USAGE` | **同步**：`--model-*` 一行补空值退 64 |
| CLI 参数或退出码 | PROTOCOL | **同步**：`topic resolve` 与 `review` 两行补 `--model-<id>` 空值退 64 |
| CLI 参数或退出码 | `skills-src/commands/` | 核过、不改：命令契约不描述「写了不给值」，不触发 `npm run render` |
| —— | PRD、LLD | 核过、不改：无相关断言 |

另：主设计 v1.3.165（7.1、13.1.1、16.1 M12 行、17.2 两行、§24「13.1 → config.v2」、变更记录）；用户手册 v1.0.46（§5.6 已废弃键一行、`--model-<审核者 id>` 空值说明）；BACKLOG EV-227 / EV-228 结案。上位计划只给批次 0 标过状态，批次 1～4 以主设计 16.1 M12 行为准，不改。本仓 `.trivium/config.yaml` 没有 Agent 级 `effort`，不改。

## 6. 桩级验收

脚本 [`evidence/m12-batch4-20261018/acceptance.mjs`](./evidence/m12-batch4-20261018/acceptance.mjs)，读数 `acceptance-output.json`：旧构建取 `git archive 79d2dd57` 导出后构建，新构建取工作树，两份 bundle sha256 不同；临时夹具，不调任何审查员 CLI。**8 / 8 判据成立**：

- `topic resolve --stage all`：不写、`--model-glm GLM-5.3`、`--model-glm=GLM-5.3` 三种，新旧 stdout 逐字节相同；三种空值形态旧构建退 0、`models: {}`，新构建退 64、文案 `--model-glm 需要一个值，但没有给出。`
- `doctor --only env --no-model-calls --model-glm=`：旧退 0，新退 64、同一文案。
- `doctor` 环境段：配置带 `profiles.default.gemini.effort` 与阶段格子 `glm.plan: {model, effort}` 时，旧构建没有提示，新构建恰一条、只点名 `profiles.default.gemini.effort`；不带时两边都没有；退出码新旧一致。

**与计划 §6 的偏离**：`cli.ts` 侧 `=` 空的新旧对照用 `doctor` 而没用 `preflight`——旧构建的 `preflight` 不在这里退出，会往下执行本机审查员 CLI 的可调用检查（本主题 S0.6 的预检读数里就有「Antigravity 可调用 agy 1.4.0」一格），不想在验收里拉起真实 CLI。`preflight` 的新行为由集成 T7 覆盖。首跑时 resolve 用了 `--stage plan`，夹具没放原稿、新旧都退 65、判据 A1 / A2 不成立；属于脚本构造错误，改为 `--stage all` 后重跑通过（读数是重跑的）。

## 7. 全量检查与 verify

- 第一遍（代码双审前）：3687 例，**1 红**——即 §3 所说 `driver-wiring` 的锚点失效；改锚点后单跑该文件 28 / 28。
- 第二、三遍（代码双审与文档收口之后，一次一条、互不重叠）：均为 **3687 例 / 3685 通过 / 0 失败 / 2 跳过**。
- `doctor --selftest`：14 / 14。
- 本节读数是在两遍全量之后补记的；补记只改了本报告这一节，之后的 verify 又完整跑了一遍测试。
- verify `20261017T173644Z`：typecheck、build、`npm test` 全通过，见 `.reviews/M12-参数与配置小修/verify/`。
