# 类型与注释失实收口 · 实施报告（EV-59、EV-70）

> - **日期**：2026-10-05
> - **主题**：`类型与注释失实收口`（命令 A `/dual-run`，Driver claude）
> - **起点**：`98f3f06`（`main`；工作树另有用户自己改的 `.trivium/config.yaml`——codex 三阶段模型 `k3` → `kimi-for-coding`，不属本主题、不随本主题提交）
> - **入选审核者**：codex、gemini、glm；codex 一侧（kimi）5 小时用量用尽，用户选 `--allow-single`
> - **计划**：`.reviews/类型与注释失实收口/plan/` r2（计划双审第 1 轮 run `20261005T134028Z`，降级：codex 未产出；gemini `approve`，glm `approve-with-nits`，2 条全接受）。首发的 run `20261005T133412Z` 未带降级许可，codex 失败后经用户选择取消、加 `--allow-single` 重发
> - **代码双审**：run `20261005T141009Z`（5m46s，降级：codex 一侧仍是 kimi 用量用尽未产出；本报告随被审 diff 一起送审）：gemini `approve`（零意见），glm `approve-with-nits`（吹毛求疵 1），接受——BACKLOG EV-59 结案记录的归档份数补注时点（起草计划时 242、落证据时 244，见 §4），只改文档，代码与用例不动
> - **证据目录**：`doc/05_testing/evidence/type-comment-truth-20261005/`
> - **配额**：全程零配额（只有单测、变异、全量与自检，不跑任何真实 CLI）

## 1. 问题

1. **EV-59**：`test/unit/registry-parity.test.ts` 的「run.v2 校验：每一个已登记 Agent 出现在入选集合里」跳过缺省 Driver 那一格，理由写的是「`critics_selected` 含当轮 Driver 会触发身份补校的互斥规则」。`schemas.ts` 的 `checkAgentIdentities` 只有三条规则（driver 已登记、入选元素已登记、`critics` 键的 vendor 与注册表一致且属入选集合），没有这条。跳过本身无害（那一格本来就通过），但注释让人以为落盘层还有第二道防线。
2. **EV-70**：`types.ts` 的 `Disposition`（`role: AgentId`）全仓零消费方，与裁决件真实解析形状 `disposition.ts` 的 `DispositionFrontMatter`（`role: string`）并存且取值类型不同；没人校验，写错了 `tsc` 也不会报。

## 2. 改了什么

1. **`test/unit/registry-parity.test.ts`**
   - 夹具抽成本地构造函数 `minimalRunV2(driver, selected, criticIds)`，字段与原用例逐个相同；
   - 原用例去掉 `continue`，遍历真正覆盖全部 4 个已登记 id；
   - 原用例上方注释末段改写：落盘层（run.v2 校验）不判 Driver 是否入选，由 `resolveCriticSelection` 与 `prepareRun` 对 `sides` 的兜底两处拦，`critics_selected` 唯一产出点在兜底之后；不补的理由指向 BACKLOG EV-59；
   - 新用例「run.v2 校验：落盘层不拦 Driver 入选（EV-59 钉住现状，补规则时要同步改注释）」：每个 id 作 driver，两种形态（Driver 入选且有结果 / Driver 只在入选集合里）断言校验通过；
   - 白名单沿革注释「第二版：`Disposition.role` 的字面 'claude'」补半句「该接口无消费方，已于 EV-70 删除」。
2. **`src/trivium/types.ts`**：删 `Disposition` 接口连同文档块（`DispositionRow`、`Disposal` 保留）；文件头契约对照改为「`trivium.disposition.v1` → `disposition.ts` 的 `DispositionFrontMatter`（front-matter）/ 本文件的 `DispositionRow`（表格行）」。纯类型，编译后不产出任何 JS。
3. **文档**：主设计 v1.3.94；BACKLOG EV-59、EV-70 结案（含不补规则、不做派生的理由，订正 EV-59 原登记「只有一道上游拦截」），另登 EV-217。

不改的：`schemas.ts`、`review.ts`、`critics.ts`、`disposition.ts`、全部 schema 与 skills 资产。

## 3. 与计划的出入

1. **排序快照第 7 序没有标完成**（计划 r2 §6 第 1 项写了要标）：快照段自己写明「一次性快照，记当时的判断，不随后续主题回改；条目状态以各行状态列为准」，前 6 序结案时也都没动它。按快照自身规则不改，状态以 EV-59、EV-70 两行为准。
2. **全量第 1 次红 1 格，不属本主题**：`cancel-grace-unverifiable` 的 K-K3（失败那格 500 ms 就结束、只发出 `SIGTERM`；正常约 5.7 s、`SIGTERM` 与 `SIGKILL` 都发）。本主题只改了 `registry-parity` 与一个纯类型，不碰该套件与被测代码；单跑 3 次全绿，当时负载约 15。形态与「夹具进程还没装上 SIGTERM 处理器就收到信号」吻合（`spawnMarked` 只固定等 150 ms），按推断另登 **EV-217**，未实测复现。S9 后的全量第 1 次又撞上一次（同一形态），第 2 次全绿——三次全量红两次，已不算「偶尔」，EV-217 的优先级请用户定。
3. 其余照 r2 执行。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 归档实扫（只读，计划 §1.1 第 6 条） | 起草计划时 run.v2 242 份、run.v1 28 份；落证据时 run.v2 244 份（多出本主题两轮计划运行）。两次 `critics_selected` 或 `critics` 键含 driver 的均 0 份 | `scan-driver-selected.mjs`、`scan-driver-selected-output.json` |
| T3 类型删除 | `tsc --noEmit` 退 0；`grep -rnw Disposition src test scripts skills-src` 只剩 284 行沿革注释 | 全量内含 |
| registry-parity 单跑 | 38/38（改前 37，新增 1） | `unit-registry-parity.txt` |
| 改前变异对照（`98f3f06` 的测试） | M1、M2 均**存活**（fail 0） | `mutation-names-before-log.txt`、`mutation-names-before.json` |
| 改后变异逐条预跑（带 `--test-timeout`） | M1、M2 各红 2 条：T1「每一个已登记 Agent…」与 T2「落盘层不拦 Driver 入选…」 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 `scripts/mutation-check.mjs` | 2/2 咬住（fail 2 / 2），`src/` 逐字节恢复 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| bundle 佐证比对（不设验收门） | 改前改后全文只差构建标识一行（`dirty`、`inputs_sha256`、`built_at`），去掉该行后逐字相同 | `bundle-compare.txt` |
| 代码双审前全量 `npm run check` | 2832 / 2829 / **1** / 2，退 1：红的是 `cancel-grace-unverifiable` 的 K-K3（已知偶发红，见 §3 第 2 条）；较起点多出新增的 1 格 | `check-1-pre-s6.txt` |
| K-K3 所在套件单跑复核 | 3 次均 16/16 全绿（K-K3 每次约 5.7 s） | `flaky-kk3-rerun.txt` |
| S9 后全量 `npm run check` 第 1 次 | 2832 / 2829 / **1** / 2，退 1：又是 K-K3，同一形态（720 ms、只发出 `SIGTERM`），负载约 11～16 | `check-1.txt` |
| S9 后全量 `npm run check` 第 2 次（串行） | 2832 / 2830 / 0 / 2，退 0 | `check-2.txt` |
| S9 后 `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| S9 后系统临时目录新建条目 | 全量 1 期间 2、全量 2 期间 1（均为 `trivium-index-`），自检期间 0；除 `trivium-index-` 外为 0 | `count-new-check-1.txt`、`count-new-check-2.txt`、`count-new-selftest.txt` |
| S10 `trivium verify` | 通过（run `20261005T143028Z`：typecheck、build、test 三条，323 s）；期间临时目录新建见 `count-new-verify.txt`，除 `trivium-index-` 外为 0 | `.reviews/类型与注释失实收口/verify/`、`count-new-verify.txt` |
| 代码双审前系统临时目录新建条目（自基线 13:55:44Z 起，含改前对照、变异、全量） | 4，全为 `trivium-index-`（产品代码进程被杀时的已知残留，EV-204 残余五）；除它外为 0 | `count-new-check-1-pre-s6.txt` |

变异表：

| 编号 | 变异（在 `checkAgentIdentities` 里补一条 Driver 互斥） | 改前 | 改后 |
| :--- | :--- | :--- | :--- |
| M1 | `critics_selected` 循环之后：入选集合含 driver ⇒ 报问题 | 存活 | 红 2：T1 缺省 Driver 格、T2 |
| M2 | `critics` 循环里：键等于 driver ⇒ 报问题 | 存活 | 红 2：T1 缺省 Driver 格、T2 形态 ① |

## 5. 边界

1. T2 钉的是**现状**不是规格：将来若有理由在落盘层补 Driver 互斥规则，它会红，那是设计好的提醒——同步改注释、BACKLOG EV-59 结论，并改写或删除该用例。
2. 「上游两道覆盖全部写入入口」的论域是编排器自己的写入；人为篡改交接文件或 run.json 与其他字段的篡改同类，由提交锚与 Hook 管，不在本主题论域。
3. 删除导出类型若被仓外代码引用会编译失败——本仓是应用不是库，`types.ts` 不对外发布类型。
