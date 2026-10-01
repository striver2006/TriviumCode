# 必读与禁读交集校验 · 实施报告（EV-02）

- **日期**：2026-10-02（主题 2026-10-01 夜间开工，跨零点）
- **主题**：`必读与禁读交集校验`；计划 `.reviews/必读与禁读交集校验/plan/`（计划双审 run `20261001T155413Z`：codex / glm `approve-with-nits`、gemini `request-changes`，9 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`a9e7cdc`（`main`；工作树另有上一主题 `.reviews/两个空配置项收口/task.json` 的未提交改动，不属本主题）；旧构建固定为 `git archive a9e7cdc`
- **状态**：实施与验证完成；代码双审见 §6；verify 见 §7；未提交
- **evidence**：`doc/05_testing/evidence/mustread-deny-intersection-20261002/`（计划 r2 写的是 `…-20261001`，实际开工已过零点，按实际日期命名）

---

## 1. 问题

送审任务书第 4 段（必读清单、建议核实、己方历史）与第 8 段（逐侧禁读集）各自生成、互不核对，同一路径可以同时出现在两边：任务书一面要求审查员读它，一面说读了即作废（或被记一笔告警）。必读清单从不被核验（`consulted` 与 `min_project_reads` 只核数量），所以 BACKLOG 原话「无论读不读都会被判违规」说过头了；真实后果是**照必读去读的那一侧被判作废**，或平白多一条告警。

现实触发面（计划 r2 §1.5，逐类核过）：`--context` 四类禁读都能撞上；公约文档与关键词匹配只会撞上凭据类（`sensitive_globs` 配到它们时；关键词只取两个目录的顶层文件，任务目标「现状五」说的「归档根配到 doc 下时的关键词匹配」实际撞不上，已在计划里改正）；建议核实在归档根落在 `src` / `doc` / `test` 等前缀下且主题名为 ASCII 时能撞上对端审查件；己方历史在非 claude 当轮 Driver 下会收进 claude 的旧裁决件（EV-186）。

## 2. 改动

| 文件 | 改动 |
| :-- | :-- |
| `src/trivium/brief.ts` | `buildMustReadList` 每条带来源（`MustReadSource` 五值 + 人读标签表）；新增 `denyContextFor`（第 8 段渲染改用它）、`findDenyConflicts`（两个方向、命中点取法、具名放行与己方运行材料两个方向都跳过、辅助函数喂展开归一后的绝对路径）、`renderContextConflicts`（64 文案，按条目分组、逐组点名禁读条目 / 类别 / 侧，每条目至多 10 行）、`renderPrunedWarnings`（按条目聚合，覆盖全部入选侧写「各侧」，否则点名剔了哪几侧、哪几侧照常列出）、`WARNING_MARK` / `plainWarningText` |
| `src/trivium/review.ts` | `prepareRun` 的逐侧循环拆成冻结 → `--context` 校验（判原始写法，撞上即 `usageError`，仍在零工件区）→ 渲染（自动条目逐侧剔除）三段；`RunContext.mustReadPruned`；写骨架时并进 `gate.warnings`（纯文档跳过轮不写）；`executeRun` 汇总告警时把它排在 guard 告警之前 |
| `src/trivium/run-protocol.ts` | `startRun` 的 `warnings` 追加 `rc.mustReadPruned`；worker 重建上下文给 `[]` |
| `src/trivium/cli.ts` | USAGE 的 `--context` 一行补「与本轮禁读集相交则拒跑（退 64）」 |
| 代码双审 r1 之后（§6） | `adapters/base.ts` 导出 `expandHomeSpellings`（`~` / `$HOME` / `${HOME}`），交集校验改用它；`brief.ts` 的 `denyContextFor` 改用 `config.ts` 的 `runRoot(cfg)`（值不变）（`freeze.ts` / `guard.ts` 两处原计划一并换，全量检查里 `config-consumers` 对账随即把 `run_root` 判成无消费方——它的判据是「定义处 `config.ts` 之外的属性访问」，helper 在定义处、不算；两处退回原样。统一配置访问器在该测试头注释里已登记待议）；跳过轮同样写 `gate.warnings`；播报通道封顶 5 条（`MUST_READ_PRUNED_DISPLAY_MAX`），run.json 存全量；命令契约 `skills-src/partials/review/body.md` 第 2 步补自动补 `--context` 的禁区与撞上 64 的分来源处置，`npm run render` 更新 12 份 SKILL.md；设计 7.4 同句 |
| 测试 | 新增 `test/unit/mustread-deny.test.ts`（21 条）、`test/integration/mustread-deny.test.ts`（11 条）；代码双审前分别是 19 / 9 条 |
| 文档 | 设计 v1.3.73（§9.4 第 4 条、7.4、10.1.1 末节、7.5.1「`--start` 的 warnings」一段、§21）、LLD v1.1.29、PROTOCOL、MANUAL v1.0.27（4.5 末段、`sensitive_globs` 一格）、BACKLOG（EV-02 结案并更正原文、新登 EV-185 / EV-186） |

**与计划 r2 的一处出入**：r2 §2.5 拟的告警文案末尾有「若确实需要审查员看到其中内容，请把它写进被审对象本身」，编码时删掉——对凭据类文件，这句等于建议把凭据抄进送审材料。现为「这一条由编排器自动生成，无需处理。」，单测断言不含那半句。另：`--start` 的 `detail` 按惯例带 `⚠️` 前缀，同步路径与 run.json 两个字符串通道去掉（前者经 `warn()` 打印时已自带一个，后者的既有条目都不带）——计划没写到这一层，编码时核出。

## 3. 单测与集成

- `test/unit/mustread-deny.test.ts`：交集判定矩阵（写法：相对、`./`、`..`、绝对、`/private` 前缀、`~`；方向：落在其中 / 罩住；类别：四类；反例：具名放行（含 `~` 写法）、己方子树与运行时文件（含 `~` 写法）、同前缀兄弟、无关路径；宽 glob 让具名放行文件成为独立禁读条目）、己方历史（非 claude Driver 下 claude 旧裁决件进禁读集、交集判得出；claude Driver 下不进）、来源标注、64 文案、告警措辞（部分侧 / 全部侧 / 单审核者 / 多侧多类 / 来源标签五值 / 同名不同源不合并）、字符串通道去前缀。
- `test/integration/mustread-deny.test.ts`（打包 CLI 子进程 + 桩）：C1 对端审查件、C4 三种写法、C2 凭据文件（`--start` 与同步路径）、C3 项目根、C5 具名放行照常；A1 建议核实（按侧剔除、warnings、run.json、`gate --check` 的 `run_warning`）、A2 公约、A3 关键词、A4 同步路径人读与 `--json`。

读数：单测 + 相关既有套件（brief、deny-matrix、deny-category、no-artifacts、override-source-start、heartbeat-threshold-warning、skill-warnings-relay、usage-registry-parity）103 / 103；集成 9 / 9。代码双审修订后：本主题单测 + 集成 32 / 32（21 + 11）。

## 4. 变异

规格 `gen-mutation-spec.mjs` → `mutation-spec.json`（锚点从现行源码截取、逐条核唯一，每条一个期望套件）。两轮：

- **r1（代码双审之前）**：17 条（计划 r2 §3.3 的 16 条加「字符串通道不去前缀」）。逐条预跑（`--test-timeout=60000` + 哨兵）17 / 17 全红、无超时、无取消；正式装置基线 2 个套件全绿，**17 / 17 咬住**。读数存为 `*.r1.*`。
- **r2（按代码双审接受项修订之后，现行）**：r1 的 17 条锚点随源码更新，追加 M18～M22 五条，共 22 条。第一次预跑在 M20 中断：替换串里写了 `$'`，`String.replace` 把它当特殊替换模式，变异后的源码语法坏了、构建失败，脚本抛出、哨兵留下（日志 `mutation-names-log.aborted-m20.txt`）；三份目标文件按哨兵哈希核对一致后删哨兵，M20 改成不含 `$` 的写法，并用脚本核过全部替换串无特殊模式（r1 那批同样没有）。整批重跑：预跑 **22 / 22 全红、无超时、无取消**（`mutation-names-log.txt` / `mutation-names-output.json`）；正式装置基线 2 个套件全绿，**22 / 22 咬住**、退 0（`mutation-output.txt`）。

| 编号 | 变异 | 期望套件 | fail（r2 预跑） |
| :-- | :-- | :-- | :-- |
| M1 | 去掉 contains 方向 | 单测 | 3 |
| M2 | under 方向不跳具名放行 | 单测 | 1 |
| M3 | 不跳己方运行材料 | 单测 | 3 |
| M4 | 条目不展开家目录 | 单测 | 4 |
| M5 | 条目不归一（裸字符串比较） | 单测 | 5 |
| M6 | `--context` 撞上不拒跑 | 集成 | 4 |
| M7 | 渲染段不剔除 | 集成 | 6 |
| M8 | 剔除不按侧 | 集成 | 3 |
| M9 | `startRun` 不追加 | 集成 | 4 |
| M10 | `executeRun` 不并入 | 集成 | 1 |
| M11 | 64 文案只写第一侧 | 单测 | 2 |
| M12 | 判必读清单产物而非原始写法 | 集成 | 1 |
| M13 | 辅助函数喂原始写法 | 单测 | 3 |
| M14 | contains 方向不跳具名放行 | 单测 | 1 |
| M15 | 骨架不写 `gate.warnings` | 集成 | 3 |
| M16 | 全部侧仍写「照常列出」 | 单测 | 1 |
| M17 | 字符串通道不去 `⚠️` 前缀 | 单测 | 1 |
| M18 | 跳过轮不写 `gate.warnings`（CODEX-03 之前的口径） | 集成 | 1 |
| M19 | `finished_inline` 分支播报剔除告警 | 集成 | 1 |
| M20 | `$HOME` / `${HOME}` 写法不展开 | 单测 | 1 |
| M21 | 播报不封顶 | 单测 | 1 |
| M22 | run.json 写封顶版而不是全量 | 集成 | 1 |

## 5. 改前 / 改后零配额验收

`acceptance.mjs`（代码双审前后各跑一次，两次都是 4 / 4；现行读数是修订后那次，修订前的存为 `*.r1.*`）：两个场景 × 旧（`git archive a9e7cdc`）/ 新两份构建，每格独立 mkdtemp 夹具与独立 `HOME`，旧构建跑成功的格子 `--wait` 到终态后整树丢弃（计划双审 r1 CODEX-02）；两份 bundle 哈希不同（`acceptance-readout.json`）。**4 / 4**（`acceptance-output.txt`）：

| 格 | 结果 |
| :-- | :-- |
| X × 旧（`--context` 指向对端审查件） | 退 0；gemini 侧任务书里同一路径**同时**出现在第 4 段必读与 8.1——复现矛盾 |
| X × 新 | 退 64；点名路径与 gemini 侧；归档、运行根、`.trivium/`（除锁）前后逐字节一致；锁不残留 |
| Y × 旧（建议核实撞上对端审查件） | 退 0；同一路径同时出现在 gemini 侧第 4 段「建议核实」与 8.1 |
| Y × 新 | 退 0；gemini 侧第 4 段不含、8.1 含，glm 侧第 4 段照常含；`warnings` 恰一条「必读清单剔除」 |

## 6. 代码双审

run `20261001T163431Z`（约 12 分 48 秒，补丁 25 个文件、727.7 KB）：codex `approve-with-nits`（重要 1、次要 4、吹毛求疵 2）、gemini `approve`（零意见）、glm `approve-with-nits`（吹毛求疵 1）。**8 条全接受**，应答件 `.reviews/必读与禁读交集校验/code/2026-10-02-必读与禁读交集校验-response-claude.md`，`gate --check` 首次通过。

| 编号 | 一句话 | 落点 |
| :-- | :-- | :-- |
| CODEX-01 | 命令契约要求 Driver 自动补 `--context`，本版起这份清单撞上禁读集会整轮退 64，契约没跟着改 | `skills-src/partials/review/body.md` 第 2 步补禁区与处置；重新渲染 12 份；设计 7.4 |
| CODEX-02 | 交集校验只展开 `~`，机器判定认 `~` / `$HOME` / `${HOME}` 三种 | 导出 `base.ts` 那份为 `expandHomeSpellings` 并改用；单测补两种写法；EV-185 补登 |
| CODEX-03 | 跳过轮落盘了剔除后的任务书却无记录 | 跳过轮同样写 `gate.warnings`；设计 / LLD 改口径 |
| CODEX-04 | 拒跑发生在逐侧冻结之后，白付 git 成本 | 按审查员给的第二种处置：不改次序，设计末节与 LLD 写明代价与不改的理由 |
| CODEX-05 | `expandHome(cfg.runtime.run_root)` 第四次手写 | 本主题新增的那处改用 `runRoot(cfg)`；另两处见 §2 的注记 |
| CODEX-06 | 剔除告警没有封顶 | 播报封顶 5 条（末条汇总点名），run.json 存全量；`listOwnHistory` 上限并入 EV-186 |
| CODEX-07 | Driver 去掉 `--context` 条目再重跑会被静默执行 | 契约：用户写的原样转述并停止，自动补的去掉后重跑并在开场播报写明 |
| GLM-01 | 跳过轮的口径没有用例锁定 | 集成 A5；变异 M18 / M19 |

修订后补的用例：单测 2 条（`$HOME` 写法、封顶）、集成 2 条（A5 跳过轮、A6 封顶全链：`--start` 的 `warnings` 5 条、run.json 6 条）。

## 7. 全量、自检与 verify

- 代码双审之前：`npm run check` 两次 **2516 / 2514 通过 / 0 失败 / 2 跳过**，两次一致（`check-1.r1.txt` / `check-2.r1.txt`）；`doctor --selftest` **14 / 14**（`doctor-selftest.r1.txt`）；
- 按接受项修订之后的第一次全量：**2520 / 2517 / 1 失败 / 2**——红在 `config-consumers`「每个配置键都要有消费方」：CODEX-05 把 `freeze.ts` / `guard.ts` 的 `expandHome(cfg.runtime.run_root)` 也换成 `runRoot(cfg)` 之后，`run_root` 只剩定义处的 helper 在读，被判成死配置。本次修订引入的真红，不是偶发；两处退回原样后消失（`check-1.fail-c05.txt`，见 §2 注记）；
- 退回之后：`npm run check` 两次 **2520 / 2518 通过 / 0 失败 / 2 跳过**，两次一致，未出现已知偶发红（`check-1.txt` / `check-2.txt`）；`doctor --selftest`（本地构建）**14 / 14**（`doctor-selftest.txt`）；改前 / 改后验收重跑 4 / 4；
- verify：**通过**（run `20261001T172543Z`：`npm run typecheck` / `npm run build` / `npm test` 三条，280 s），留痕在 `.reviews/必读与禁读交集校验/verify/`。

## 8. 暂缓与遗留

- **EV-185**：`--context` 的绝对路径与 `~/…` 写法在必读清单里被静默丢掉（`path.join` 拼接后判不存在）。本主题的校验按原始写法判，撞上禁读集照样拒跑；没撞上的那部分仍被丢掉。
- **EV-186**：`listOwnHistory` 写死收 claude 的裁决件后缀。本主题的剔除兜住了「同时出现在两段」那一半。
