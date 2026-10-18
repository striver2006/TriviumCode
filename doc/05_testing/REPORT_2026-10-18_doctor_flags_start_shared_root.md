# doctor 覆盖旗标提示与 `--start` 共享根检查（EV-245 / EV-246）

- **日期**：2026-10-18
- **执笔**：Claude Code（当轮 Driver）
- **主题**：`doctor旗标提示与start共享根检查`（`/dual-run`，A 档）
- **上位**：BACKLOG EV-245、EV-246（M12 收口时登记，主设计 16.1 M12 行残余 ②③）；口径由用户 2026-10-18 定
- **起点**：`7fc1f38a`（工作树只有 BACKLOG EV-245 一行口径改动未提交，属本主题）
- **配额**：零真实模型调用（双审本身除外）。单测里 agy / codex 两段用只会报版本号的假入口，验收不碰任何厂商 CLI
- **证据**：[`evidence/doctor-flags-start-shared-root-20261018/`](./evidence/doctor-flags-start-shared-root-20261018/)。只存脚本与读数

---

## 1. 结论

| 项 | 结果 |
| :--- | :--- |
| EV-245 判键 | `doctor` 的 `--model-<id>` 补上与三类档位旗标同一份判键（`assertModelOverrideKeys(…, CRITIC_AGENT_IDS)`，与 `assertTierFlags` 同一个 `driver`、同一个 `picked`），先键后值。对现注册表全部放行，只在「登记了、未启用为审核者」的一家上退 64（桩注册表用例 U5） |
| EV-245 提示 | 写了却没用上的覆盖，doctor 末尾给一条提示，只进 `warnings`。「用上没有」按运行期记录判：`runDoctor` 的 `overridesFor` 是唯一读点，源码里不写家名。原因分三种：该段跑了但不读覆盖、被 `--only` 滤掉、doctor 尚无该家的探针（`--only` 优先）。退出码与 `--json` 既有字段不变（A-1） |
| EV-246 | `review --start` 派生前的告警复查追加「共享读取面同名入口」一项：与预检同一个函数、同一口径（当轮 Driver ∪ 入选审核者），只告警不阻断，结尾场合词「本次运行」；预检侧仍是「本次预检」 |
| 共享根干净时逐字节相同 | `--start` 人读与 `--json` 两格新旧规范化后逐字节相同；doctor 不带覆盖两格同样相同（A-1 / A-2，§6） |
| 变异 | 逐条预跑 14/14、正式装置 14/14 咬住（§5；M14 是代码双审 GLM-01 后补的） |
| 计划双审 | run `20261018T072932Z`：gemini `approve`，glm `approve-with-nits` 1 条 nit，接受，r2 定稿 |
| 代码双审 | run `20261018T081641Z`：gemini `approve`（无意见），glm `approve-with-nits` 1 条 nit（扫描出错分支的场合词没有用例），接受并补用例与变异（§3.2） |
| 全量 `npm run check` | 3749 / 3747 / 0 / 2（tests / pass / fail / skipped），比上一主题多 19 条，均为本主题新增用例（§4） |

---

## 2. 改动

### 2.1 EV-245（`cli.ts`、`doctor.ts`）

- `cmdDoctor`：`resolveDriver` 只解析一次，档位旗标与模型旗标共用；`collectModelOverrides` 之后补 `assertModelOverrideKeys(ctx.config, driver, keys, CRITIC_AGENT_IDS)`，再 `assertFlagValuesGiven`。删掉了「doctor 不判模型覆盖的键」那句注释。
- `runDoctor`：新增 `overridesFor(id)`，Codex、Claude 两段改经它取覆盖值（合并结果与原先的内联写法逐值相同），它顺手记下这一家的覆盖已读。全部段跑完后，用 `describeUnusedOverrides` 算出没用上的那些，非空则推进 `warnings`。「跑过的段」取 `probedSections ∪ fixtureFailed`。
- `describeUnusedOverrides`（导出的纯函数）：按注册表顺序遍历；每家列出写了的旗标名（`--model` / `--tier` / `--effort` / `--profile` / `--native` 的顺序），不列取值；同一原因归成一行。首行固定为「以下命令行覆盖本次没有用上（只是提示，退出码与探测结论不受影响）：」。
- 措辞用「各自固定的探测口径」，没有照抄「固定探测模型」：agy 段用的是固定的只读 Agent，zcode 段按**配置**里 plan 阶段的档位取探测模型（`zcodeProbeModel`），两者都不随命令行覆盖变，但 zcode 的模型并非写死（计划 r2 D-4）。

### 2.2 EV-246（`entry-collisions.ts`、`preflight.ts`、`run-protocol.ts`）

- `summarizeSharedRootProblems(problems, home, occasion = '本次预检')`、`checkSharedReadRoots(relevant, inject?, occasion = '本次预检')`：只换结尾括号里的场合词，扫描出错那句同样取它。
- `startRun`：告警汇总在 `checkTierCombos` 之后、`mustReadPruned` 之前追加 `checkSharedReadRoots([rc.meta.driver, ...rc.sides], undefined, '本次运行')` 的结果，`null` 不追加。函数内部已把扫描异常吞成告警，走不到主 `catch`。`finished_inline` 分支不走这里；同步 `review --stage` 不加（与副本源、失联阈值两项复查同口径）。
- 文档块：`startRun` 复查注释、`StartOutcome.warnings`、`checkSharedReadRoots`（写明两个调用点）、`checkDeprecatedConfigKeys`（「复用的两项」改为「复用的几项」，已废弃配置键仍不进 `--start`）。

### 2.3 不做

- 已废弃配置键不进 `--start`（用户决策 二）；同步 `review --stage` 不加共享根检查；doctor 不新增「本轮入选」概念，Antigravity / ZCode 段不改为读覆盖值。

---

## 3. 双审

### 3.1 计划双审（run `20261018T072932Z`）

gemini `approve`（0 条）；glm `approve-with-nits`，1 条 nit：doctor `--json` 顶层还有条件出现的 `directoryEvidence`，r1 的「五个字段」在全量 doctor 下不成立。接受，r2 改准现状陈述，U4 / A-1 判据维持「顶层键集合与不带覆盖时相同」、不写死键数。另据 glm「未覆盖范围」写死了原因②优先于原因③。

### 3.2 代码双审

run `20261018T081641Z`，被审对象是相对 `7fc1f38a` 的工作树改动（24 个文件）。gemini `approve`，无意见。glm `approve-with-nits`，1 条 nit：

- **GLM-01**（nit，接受）：`checkSharedReadRoots` 的扫描出错分支也插值了场合词，但没有任何用例走到这一支（`preflight.test.ts` U6 只测正常路径，`doctor-shared-roots` 测的是 `runDoctor` 自己的内联 catch），变异 M11 / M13 也只改正常分支。裁决前核过：扫描对文件系统异常很宽容，造不出抛错；注入口的 `home` 传非字符串时，`sharedReadRootTargets` 在 `try` 之内抛 TypeError，可稳定走到 catch。改动：`preflight.test.ts` 加 U6c（缺省与「本次运行」两种场合词各一次，都是 `ok`、`warn`、无退出码），变异规格加 M14（catch 分支写死「本次预检」），预跑与正式装置重跑均 14/14。

运行告警：glm 在依据里引用了 `mutation-spec.json` 却没列进查阅清单（结构瑕疵，不影响意见成立）；模型族 unknown（本轮未声明 Driver 模型）；安装副本不是当前工作树构建（本题尚未提交、未重装，预期状态）。

---

## 4. 测试

新增与改动的用例：

| 文件 | 用例 | 守的是 |
| :--- | :--- | :--- |
| `test/unit/doctor-unused-overrides.test.ts`（新） | U1 ①～⑤（6 格） | 纯函数：全部消费为 null；三种原因各自成行、`--only` 优先、组内注册表顺序；不回显取值；第五家用桩描述符 |
| | U2（2 格） | 经 `runDoctor`：`--only env` 下提示在 `warnings` 末项、blockers 不变、不写覆盖时逐项相同；agy 段跑了（假入口）⇒ 原因①；codex 段读了（假入口）⇒ 不提示；`--only codex` 时写给 agy 的 ⇒ 原因② |
| | U3 | 源码护栏：`doctor.ts` 里 `opts.tierFlags` / `opts.modelOverrides` 只出现在 `overridesFor` 与交给提示的入参里 |
| | U5（2 格） | `cmdDoctor` 判键接线（同一 `driver`、`CRITIC_AGENT_IDS`、先键后值、`resolveDriver` 只一次）；行为面：桩注册表里未启用为审核者的一家退 64 |
| `test/integration/tier-flags-cli.test.ts` | T9 | 打包产物：退 0、`--json` 顶层键集合不变、`warnings` 恰多末尾一条提示、人读模式同样出现 |
| `test/integration/shared-root-start.test.ts`（新） | S1～S6 | 打包产物 + 桩：脏扫描家目录下缺省入选恰一项、结尾「本次运行」、worker 照常拉起；人读同一行；Driver 与审核者都不读共享根 ⇒ 无此项；只有 Driver 读 ⇒ 有此项；空家目录 ⇒ `[]`；与失联阈值、必读清单剔除同时出现时排在中间 |
| `test/unit/entry-collisions.test.ts` | U4（补一句） | 传「本次运行」时只有结尾括号里的词不同 |
| `test/unit/preflight.test.ts` | U6（补一句） | 预检侧不传场合词，结尾仍是「本次预检」 |
| | U6c（代码双审 GLM-01 后补） | 扫描出错分支：缺省与传「本次运行」两种场合词，都只是一条告警 |
| `test/unit/entry-scan-isolation.test.ts` | U8（扩论域） | 直调判据加 `startRun`；spawn 判据把 `'--start'` 并进来，新命中的 4 个文件逐个核过、登记理由（都不在自己 spawn 的那几处跑 `--start`，或已钉 `HOME`） |

既有「`warnings` 为空」一类断言（如 `heartbeat-threshold-warning.test.ts` I2、`mustread-deny.test.ts` C5）经 `cli()` 跑、扫描家目录是空夹具，全部照旧通过，断言一条没改。

全量 `npm run check`（前台单条，开跑前无残留 `node --test` 进程）：代码双审前两遍 3748 / 3746 / 0 / 2，各约 6 分钟；补 U6c 后由出口 `trivium verify`（`verify-20261018T083021Z`，typecheck、build、`npm test` 三条全部退 0，共 350 秒）跑出 3749 / 3747 / 0 / 2。

---

## 5. 变异

规格 `mutation-spec.json` 由 `gen-spec.mjs` 生成（逐条核 find 唯一、replace 不含特殊替换模式），14 条、5 个目标文件、5 个套件。逐条预跑用 `mutation-names-bundle.mjs`（`--with-tests` 重打 bundle，集成类变异才进得了被测产物），读数 `mutation-names-output.json` / `mutation-names-log.txt`；正式装置 `scripts/mutation-check.mjs`，读数 `mutation-output.txt`。两者都是 14/14 咬住，跑完 `src/` 逐字节复原（下表为补 M14 后重跑的读数）。

| # | 变异 | 预跑变红 | 装置 fail |
| :--- | :--- | :--- | :--- |
| M1 | Codex 段绕过 `overridesFor` | U2 段跑了、U3 | 2 |
| M2 | `overridesFor` 不记消费 | U2 段跑了 | 1 |
| M3 | 提示推进 blockers | U2 两格 | 2 |
| M4 | `--only` 滤掉的不归原因② | U1 ③ ④′、U2 两格 | 4 |
| M5 | 没有段的家归到原因① | U1 ④ ④′ ⑤ | 3 |
| M6 | `cmdDoctor` 不判模型键 | U5 接线 | 1 |
| M7 | 判模型键的 `picked` 写成空集 | T8、T9 | 2 |
| M8 | `startRun` 不追加共享根项 | S1、S2、S4、S6 | 4 |
| M9 | `relevant` 只传入选审核者 | S4 | 1 |
| M10 | 共享根项挪到必读剔除之后 | S6 | 1 |
| M11 | `--start` 不传场合词 | S1、S2 | 2 |
| M12 | `summarize` 缺省场合词漂移 | U4 | 1 |
| M13 | `checkSharedReadRoots` 缺省场合词漂移 | preflight U6、U6c | 2 |
| M14 | 扫描出错分支的场合词写死成「本次预检」（GLM-01 后补） | preflight U6c | 1 |

M10 与计划 r2 的写法不同：r2 写「挪到 `mustReadPruned` 之后」由 U6 ① 守，但 U6 ① 的夹具里没有剔除条目、守不住位置。实现时补了 S6：照 `mustread-deny` A1 的夹具造出「必读清单剔除」一项，再配 2 秒失联阈值，三项同时出现时核顺序；M13 是实现时补的（预检侧缺省场合词原先没有断言钉住，补了 `preflight.test.ts` U6 的一句）。

---

## 6. 新旧对照验收（零真实调用）

旧构建是把 `git archive 7fc1f38a` 导出到会话 scratchpad、软链 `node_modules` 后构建的；新构建是当前工作树。bundle sha256：旧 `29011967…`、新 `b53ad048…`，脚本断言两者不同。所有子进程共用一份隔离环境：`HOME` 指向夹具里单独的 `home-cli/`，`TRIVIUM_ASSET_ROOT`、`TRIVIUM_STUB_CRITIC`、`CODEX_HOME`、`ZCODE_HOME`、`XDG_*` 一律删掉、按格再设；共享根扫描另经 `TRIVIUM_ENTRY_SCAN_HOME` 指向各格的夹具家目录。脚本 `a-readings.mjs`，读数 `a-readings-output.json`，读数里没有真实家目录与系统临时目录路径。规范化覆盖夹具路径、run_id、pid、ISO 时间戳、构建标识，以及运行根下按项目根路径取哈希的目录名（新旧各用一个夹具，`repo-〈哈希〉` 必然不同；首跑时这是唯一的差异，补进规范化后重跑）。

8 格全部符合预期（`all_as_expected: true`）：

| 格 | 旧 ⇒ 新 |
| :--- | :--- |
| doctor `--json`，不带覆盖 | 逐字节相同 |
| doctor `--json`，带 `--model-gemini x --tier-glm high --effort-glm high` | 都退 0；顶层键集合相同；`warnings` 0 条 ⇒ 1 条（「…`--model-gemini`、`--tier-glm`、`--effort-glm`：本次 --only env，没有探测 Antigravity、ZCode」），其余逐字节相同 |
| doctor 人读，不带覆盖 | 逐字节相同 |
| doctor 人读，带覆盖 | 都退 0；新版只多出提示两行，旧版行一条不少 |
| `--start --json`，扫描家目录干净 | 规范化后逐字节相同（焦点 4） |
| `--start --json`，扫描家目录有别家同名入口 | 旧 `warnings: []` ⇒ 新恰一项「共享读取面同名入口」（「…本轮的 ZCode 会读到；跑 doctor 看完整清单与出口（不影响本次运行）」），其余相同 |
| `--start` 人读，干净 | 规范化后逐字节相同 |
| `--start` 人读，有同名入口 | 新版恰多一行告警，其余行相同 |

带覆盖的 doctor 格用的是 `--only env`，三个旗标都归原因②；原因①（段跑了但不读覆盖）由单测 U2 用假 agy 入口覆盖，验收不碰真实 CLI。

---

## 7. 发现与提醒

- 主设计「`--start` 返回 `warnings`」一段原先只列了三个来源，漏了 M11 第 4 步加进来的档位组合告警；本次顺带补上（v1.3.169）。
- 本机安装副本仍是此前的构建；提交推送之后需要重建、再由用户重装，`/dual-*` 的真实流水线才会用上本次改动。
