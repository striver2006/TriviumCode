# doctor 探针走副本 HOME（EV-194）计划 r1

起点：`292fa79`（`main`，工作树干净）。下文源码行号均取自 `292fa79`。
任务目标见本主题任务文件（用户决策在任务目标里，下文按「决策 一～五」引用）；焦点未给（命令 A `--entry A`）。
验证 3 的配额用户已于 2026-10-03 开工时授权（上限四次真实调用，按写死的判据跑，不达标如实记下、不调措辞重跑）。

## 0. 范围与不做

**做**（决策一）：`probeZcode`（`src/trivium/probes/zcode.ts`）里两次真实模型调用——headless 读文件（:1412）与 `probePathDeny` 的否定对照（:1081）——改成与 `authProbe`（`src/trivium/adapters/zcode.ts:1041-1135`，EV-136）同一形态：`mkdtemp` 临时运行目录 → `prepareZcodeHome`（当前档位 plan 阶段的 glm 模型、请求置首）→ 副本 HOME + 副本支不注入个人配置 + 两支都设落点根；两次调用共用同一个临时目录与副本；回读日志与 rollout 改从落点根读；探完只删 `mkdtemp` 返回值。headless 一行详情说清探的是哪条路径与哪个模型，措辞与 `authProbe` 抽成同一个函数。

**不做**：

- 不改认证探活（`authProbe` 只把「算探活模型」与「说清探的是哪条路径」两段抽成共用函数，输出逐字节不变，现有 `zcode-auth-probe.test.ts` 10 条锁住）；
- 不改审查运行 `run()`、不改三条模型覆盖探针臂（白名单臂、同形臂原样支、同形臂置首支）、不改旗标探针 `probeReadonlyFlags`（它本就在 mkdtemp 的空 HOME 下）；
- 不改探针结论的缓存与 TTL、不改 doctor 的 blocker / warning 判据；
- **不改「headless 失败即提前返回」**（§1.2）：修完之后失败的含义变成「审查那条路径不通」，此时沿用旧结论、由已有的 `ZCODE_HEADLESS_NOT_OK_HINT` blocker 判据照旧处理，这正是想要的；
- 不改 `probeZcodeModels` / `probeTraceSource`（零配额、只读真实 `~/.zcode/cli` 的静态事实，见 §7 R5）；
- 不改 `scratch_paths`：它看的是夹具工作树，与 HOME 无关。

## 1. 现状（`292fa79`，已核）

### 1.1 两次真实调用走真实 HOME 与个人缺省模型

- headless（`probes/zcode.ts:1412-1421`）与 `probePathDeny`（:1081-1088）调 `invokeZcode` 时不给 `homeDir`、`omitPersonalProviderConfig`、`storageRedirectRoot`。`invokeZcode`（`adapters/zcode.ts:487-502`）于是按真实用户目录注入个人 provider 配置 `~/.zcode/v2/provider_config.json`，不设 `HOME`、不设落点键。0.16.9 见个人配置存在就直接用它的 `defaultModelSelection`（P-31），且此时**不从 `cli/config.json` 导入 provider**。
- 审查运行（`run()`，:1231-1252）自 EV-82 起走 `prepareZcodeHome` 的副本 HOME、不注入个人配置、设落点根；认证探活自 EV-136 起同形（:1065-1099）。doctor 这两次调用是仅剩的两处「探的不是审查那条路径」的真实调用。
- `ZcodeInvokeOptions.storageRedirectRoot` 的注释（:424-428）明写「旗标 / 模型探针不传——它们要测的是真实环境」，与 EV-115 的不修理由同源。

### 1.2 headless 失败即返回

`probes/zcode.ts:1423-1426`：`failureKind !== 'none'` 时只推一条 note 就 `return`，其后 `response_field`（:1430）、`model_id_form`（:1439 / :1456）、`path_deny`（:1467-1478）、`scratch_paths`（:1480）都不刷新，沿用 `existing` 的旧值。2026-10-02 实遇即此形态：个人缺省 `84044858-…/qwen3.8-max`（provider `enabled: false`），doctor 连报 `ZCode headless 失败（other）：Error: Model creation failed`；同一时刻认证探活（`bigmodel-coding-plan/GLM-5.3`）通过。

### 1.3 回读按真实目录读

`readTrace(sessionId, logDir?)`（:1035-1050）缺省读 `ZCODE_CLI_DIR/log`；`readRollout(sessionId, homeDir?)`（:307-317）缺省读 `ZCODE_CLI_DIR/rollout`。两者都已有目录参数。`ZCODE_CLI_DIR` 是模块加载时按 `os.homedir()` 算好的常量。

### 1.4 副本在探针侧可用

同一个 `probeZcode` 里的同形臂（`probeModelOverrideFullCopy`，:858-995）已经用 `prepareZcodeHome` 造副本并以副本 HOME 拉起，说明副本在探针侧可用。门控 `cliConfigured`（:1202-1203）判的是 `opts.cliConfigPath ?? ZCODE_CLI_CONFIG` 是否存在，headless 段（:1396）在它为假时整段跳过。

### 1.5 `model_id_form` 的来源

`model_id_form` 由 headless 成功后的日志 / rollout 回读写入（:1439 / :1456），唯一消费方是 `normalizeModelForCatalog`（`adapters/zcode.ts:1001-1003`，preflight 的 slug 目录比对补前缀）。现状它记的是个人缺省（`<providerUUID>/…` 形态），与目录的 `cli/config.json` provider 键异源——EV-93 登记过，以「目录同时收短名、比对恒能退到短名」为由不修。

### 1.6 文档

- 主设计 §11.3 第 7 条末尾记了 EV-136「认证探活与审查运行同形」，没提 doctor 探针；
- `doc/03_api/PROTOCOL_dual_critic_relay.md` 里**没有** zcode 探针段（grep `doctor` / `探活` / `探针` 与 zcode 同行均无命中）——决策四说「设计与 PROTOCOL 里 zcode 探针段按实补一句」，PROTOCOL 一侧无处可补，本计划不改 PROTOCOL（§5）；
- BACKLOG EV-115（「不修」）的不修理由写着 doctor 的 headless 与 path_deny「要在真实环境里测」，与本题方向直接冲突（决策二）。

## 2. 方案

### 2.1 探活模型与路径措辞抽成共用函数（`adapters/zcode.ts`）

新增两个导出函数，`authProbe` 改用它们，输出逐字节不变：

- `zcodeProbeModel(cfg: Config): string | null` = `routeModel(cfg, 'glm', 'plan').model`。认证探活与 doctor 探针用的是同一个「探活模型」定义，改一处两处同变；
- `describeZcodeProbedPath(prep: ZcodeHomePrep): string`：原样搬 `authProbe` 的 `probed` 三元式（:1109-1116），四档措辞——退路「真实 HOME 下 ZCode 自选的缺省模型（原因）」、限定失败「cli/config.json 原有的 model.main（原因）」、置首挪不动「模型 X（置首未生效：…；实际生效模型未核）」、正常「模型 X」；原因串照旧过 `tildeHome`。

### 2.2 `probeZcode` 新增两个选项

- `launchModel?: string | null`：本轮探针要请求的模型。doctor 传 `zcodeProbeModel(opts.config)`（`doctor.ts:552`）。不传等同 `null`，走退路（§2.4）——只有单测会不传；
- `invoke?: typeof invokeZcode`：**测试注入口**，与已有的 `modelOverrideProbe` / `modelOverrideFullCopyProbe` 同理；headless 与 path_deny 两次都用它。`DoctorOptions.zcodeProbe` 的 `Pick` 加上 `invoke`，让 doctor 层用例能咬住「doctor 把档位模型传进来了」。

### 2.3 headless 段改写（`probes/zcode.ts:1404-1481`）

在现有 `skipModelCalls || !cliConfigured` 早退之后：

1. `const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-zcode-doctor-'))`，其后整段包在 `try { … } finally { await fs.rm(runDir, { recursive: true, force: true }) }` 里。删除只认这个返回值，不拼路径、不经别的变量（2026-09-20 事故后的规矩）；
2. `prepareZcodeHome(runDir, launchModel, { srcConfig: cliConfigPath, requestedFirst: true })`。`srcConfig` 传 `cliConfigPath`，与门控判的是同一个文件（§1.4），也让用例不必碰真实 `~/.zcode/cli/config.json`。抛错（副本源损坏或读不了）时推一条 note「副本源读取或解析失败：…（家目录归一 `~`）——response_field / path_deny / scratch_paths / model_id_form 保留上一次的结论」并 `return`，与 headless 失败同样处理；不退回真实 HOME（审查运行在同一情形下也起不来，退回去探的就又不是那条路径了）；
3. `const launch = { homeDir: prep.homeDir, omitPersonalProviderConfig: prep.homeDir !== null, storageRedirectRoot: zcodeHomeUnder(runDir) }`，headless 与 path_deny 两次都展开它——与 `authProbe` :1087-1089 同一组三个键、同一个式子；
4. 推一条 note：`headless / path_deny 探的是：${describeZcodeProbedPath(prep)}（与审查运行同一选模路径；CLI 产物落在临时目录、探完即删）`——退路支后半句换成「（副本源缺失或档位未给模型，退回真实 HOME 与个人配置，与审查运行在同一情形下的退路相同；CLI 产物仍落在临时目录）」；
5. headless 失败 note 改为 `ZCode headless 失败（${failureKind}，${probed}）：${stderr 脱敏前 200 字}`，其后照旧 `return`；
6. 回读：`readTrace(sid, path.join(zcodeHomeUnder(runDir), '.zcode/cli/log'))`、`readRollout(sid, zcodeHomeUnder(runDir))`——落点根下的布局与 `zcodeStorageRedirectEnv` 设的 `ZCODE_LOG_DIR` 逐字同形（:376-393），`run()` 的回读（:1300 `cliDir`）同此拼法。两条拼法都从同一个 `zcodeHomeUnder(runDir)` 出发，不另起变量；
7. `probePathDeny(entry, node, fx, readonly, { launch, invoke })`：新增可选第五参，把 `launch` 展开进它那次 `invokeZcode`。不传时行为与现状相同（只有用例会不传）；
8. `scratch_paths` 不变。

`ZCODE_CLI_SUBDIR`（`'.zcode/cli'`）现为 `adapters/zcode.ts` 的模块私有常量，导出它供探针模块拼路径，不在探针侧再写一份字面。

### 2.4 退路

副本源缺失：`cliConfigured` 门控先拦（整段跳过、note 照旧），走不到 `prepareZcodeHome`；剩下的退路只有「档位未给模型」（`prep.homeDir === null`，`cause: 'no_model'`）。此时与 `authProbe` / `run()` 同一退路：真实 HOME、注入个人配置、**落点根照设**（EV-136 代码双审 r1 CODEX-02 ≡ GLM-02），产物仍落临时目录。

任务目标验证 1 写的「退路一格（副本源缺失）」因此在 doctor 侧不可达，单测改用「档位无模型」这一格覆盖退路；「副本源缺失」那一格断言的是现有门控行为（整段跳过、`invoke` 零调用），一并锁住。

### 2.5 过时文字随改

- `ZcodeInvokeOptions.storageRedirectRoot` 注释（:426-427）：「旗标 / 模型探针不传——它们要测的是真实环境」改为：doctor 的 headless 与 path_deny 自 EV-194 起两支都传；旗标探针与模型覆盖探针臂不传（各自在 mkdtemp 的 HOME 下）；
- `probeZcode` 里落点宿主预置 note（:1376-1379）末句「探活与 doctor 自身的探针在真实 HOME 下跑」改为按实：探活与 doctor 的 headless / path_deny 落点同审查运行，旗标探针与模型覆盖探针臂在各自的临时 HOME 下；
- beta 入口 note（:1179-1181）「探针与探活的存储根会被 CLI 改写」：设了存储根的探活与 doctor 两次真实调用不再受影响，只剩不设存储根的旗标探针与模型覆盖探针臂；
- `qualifyZcodeModel` 文档块（:58-63）与 `qualifyAgainstCliConfig` 附近（:657）说 `model_id_form`「记的是上一次真实 HOME 运行回读的生效模型——即个人配置的默认」：改为自 EV-194 起记的是副本路径回读的生效模型（副本支下与副本源 provider 键同源），退路支下才是个人缺省。

## 3. 用例（零配额，验证 1）

新文件 `test/unit/zcode-doctor-probe-home.test.ts`。假入口复用 `zcode-provider-env.test.ts` 的思路（旗标探针要它答 `version` 与旗标候选）；`invoke` 用桩：记下每次入参，在 `storageRedirectRoot` 下按 `ZCODE_LOG_DIR` 布局写一份日志与 rollout（模型写成 `stub-provider/STUB-MODEL`），返回 `sessionId` 对得上的 envelope。每条用例把 `HOME` 钉到 mkdtemp 的临时目录并在里面摆一份个人配置（照 `zcode-auth-probe.test.ts` 的理由：不摆则注入与否观测相同，退回旧写法的变异杀不死），`cliConfigPath` 指临时目录里的合成 `cli/config.json`，三条模型覆盖臂用桩。

| # | 格 | 断言 |
| :--- | :--- | :--- |
| D1 | 副本支，headless 与 path_deny 都成功 | `invoke` 恰两次；两次 `homeDir` 相同、非 null、在 os.tmpdir 下且不等于钉住的 HOME；`omitPersonalProviderConfig === true`；`storageRedirectRoot` 相同且等于 `homeDir`；副本里 `model.main` 是档位模型的限定形态；`model_id_form === 'stub-provider/STUB-MODEL'`（只有从落点根回读才拿得到）；rollout 回读那条 note 在；`response_field === 'response'`；`path_deny.method` 是本轮的（不是 existing 的旧值）；探完 `runDir` 不在 |
| D2 | 退路（`launchModel: null`） | `homeDir` 为 null/undefined、`omitPersonalProviderConfig` 为 false、`storageRedirectRoot` 仍设且不在钉住的 HOME 下；note 含「真实 HOME 下 ZCode 自选的缺省模型」且不含家目录绝对路径；探完 `runDir` 不在 |
| D3 | 副本源缺失 | `invoke` 零调用、跳过 note 照旧（现有门控，§2.4） |
| D4 | headless 失败（桩返回 `failureKind: 'other'`） | `invoke` 恰一次；失败 note 带 `probed` 措辞与脱敏后的 stderr；`response_field` / `model_id_form` / `path_deny` / `scratch_paths` 保留 existing；`runDir` 不在 |
| D5 | `invoke` 抛错 | `probeZcode` 拒绝且错误原样上抛；`runDir` 不在 |
| D6 | 副本源不是合法 JSON | `invoke` 零调用；note 写明副本源读取或解析失败、保留旧结论；`runDir` 不在 |
| D7 | 置首挪不动 / 限定失败 | 合成两份副本源（档位模型不在里面；请求 provider 挪不动），note 分别是「cli/config.json 原有的 model.main」「置首未生效…实际生效模型未核」；同时对 `describeZcodeProbedPath` 四档各断言一次 |
| D8 | doctor 层接线 | 经 `runDoctor`（`--only zcode` 等价参数、`zcodeProbe` 注入 `cliConfigPath` / 三臂桩 / `invoke` 桩），档位 glm.plan 改成副本源里的非首位模型，断言副本 `model.main` 是它——咬住 `doctor.ts` 传 `zcodeProbeModel(opts.config)` |

「`runDir` 不在」的判法：从桩记下的 `storageRedirectRoot` 取 `path.dirname`；D5 / D6 拿不到入参时，在用例开始前后各列一次 `os.tmpdir()` 下 `trivium-zcode-doctor-*` 的条目，断言没有新增。

`zcode-auth-probe.test.ts` 不改，用来锁 `authProbe` 抽函数后逐字节不变。

## 4. 变异（验证 2）

照坑清单：find 锚点用生成脚本从源码截并核对唯一，替换串扫 `$` 特殊模式；先用带 `--test-timeout` 的逐条预跑脚本过一遍，再跑 `scripts/mutation-check.mjs`。拟定（实施时按实增删）：

| # | 变异 | 预期咬住 |
| :--- | :--- | :--- |
| M1 | headless 去掉 `...launch` | D1 |
| M2 | `omitPersonalProviderConfig` 恒 false | D1 |
| M3 | `storageRedirectRoot` 不设 | D1、D2 |
| M4 | path_deny 不传 `launch` | D1 |
| M5 | `readTrace` 回到缺省目录 | D1（`model_id_form`） |
| M6 | `readRollout` 回到缺省目录 | D1（rollout note / `model_id_form` 第二来源） |
| M7 | 不删 `runDir` | D1、D2 |
| M8 | 删除挪出 `finally`（只在成功路径删） | D4、D5 |
| M9 | `srcConfig` 不传 | D1、D6（读到别的文件） |
| M10 | `requestedFirst` 不传 | D7（置首挪不动那格） |
| M11 | doctor 不传 `launchModel` | D8 |
| M12 | `describeZcodeProbedPath` 退路措辞改字 | D2、`zcode-auth-probe` 退路用例 |
| M13 | 副本源解析失败改成退回真实 HOME 继续拉起 | D6 |
| M14 | 失败 note 去掉 `probed` | D4 |

## 5. 文档（决策四）

- 主设计 §11.3 第 7 条末尾补一句：doctor 的 headless 与 path_deny 否定对照自 EV-194 起与审查运行、认证探活同形（同一临时目录与副本、副本支不注入个人配置、两支设落点根、回读从落点根读、用完即删），`model_id_form` 因此记副本路径的回读；文档头版本 v1.3.78、版本台账加一行；
- PROTOCOL：无 zcode 探针段（§1.6），不改；
- BACKLOG：EV-194 改 **done**、写读数与证据目录；EV-115 改写——状态改为「已消解（EV-194）」，原不修理由「doctor 的 headless 与 path_deny 要在真实环境里测」按决策二改写为以审查运行为准，并写明真实 HOME 不再留 doctor 探针产物（旗标探针与模型覆盖探针臂本就在临时 HOME 下）；EV-93 末尾补一句「EV-194 起 `model_id_form` 取自副本路径回读，副本支下与目录同源」（只补事实，不改状态）；不新登条目；
- 测试报告 `doc/05_testing/REPORT_2026-10-03_doctor_probe_home_copy.md`，证据目录 `doc/05_testing/evidence/doctor-probe-home-20261003/`。

## 6. 验证

1. 单测：`node scripts/build.mjs --with-tests` 后点名跑新文件与 `zcode-auth-probe` / `zcode-provider-env` / `preflight`，核用例总数含新增几条；
2. 变异：§4；
3. 改前改后真实对照（已授权，上限四次真实调用）：
   - 改前：`git archive 292fa79` 导出到 scratchpad 下的临时项目、`node_modules` 软链、构建，把仓库的配置与探针结论文件拷进去；改后：当前工作树构建出的 bundle，同样在一份独立的临时项目里跑。两侧都直接 `node <bundle> doctor --only zcode --json`，记两份 bundle 的 sha256 并断言不同；仓库里的探针结论文件不动；
   - 每次跑之前与之后各对真实 `~/.zcode/cli/log`、`~/.zcode/cli/rollout` 列一次（文件名、大小、mtime）；
   - **判据（写死）**：改前 headless 报 `Model creation failed`；改后 headless 通过、headless 那行详情写的是档位模型（`bigmodel-coding-plan/GLM-5.3`）、结论文件里 `response_field` 与 `model_id_form` 被刷新（`model_id_form` 是副本路径回读的值）、真实 `~/.zcode/cli` 下 log 与 rollout 的**文件数**前后不变。大小与 mtime 只作补充读数：日志按日期合并成一个文件，「文件数不变」挡不住往当天日志里追加，若大小或 mtime 变了如实记下、不改判据；
   - 不达标不调措辞重跑，如实记下停下；
4. 全量 `npm run check` 两次（串行、一次只发一条、重定向到文件取真实退出码）、`doctor --selftest`。

## 7. 风险与残余

- **R1 可见性取舍（决策二）**：副本 HOME 下 `~/.zcode` 只有 `cli/config.json` 一份，插件、MCP 等真实 HOME 里的东西 doctor 不再看得见——这与审查运行一致，正是想要的；代价是「真实环境里能不能跑」不再由 doctor 回答，而那条路径审查流水线本来就不走。
- **R2 凭据**：副本里 `cli/config.json` 含真实 apiKey，探完在 `finally` 整删；进程被硬杀时会在系统临时目录留一份——与 `authProbe`、同形臂同一残余，不新增形态。
- **R3 `model_id_form` 换形态**：下一次 doctor 起它从 `<providerUUID>/…` 变成 `bigmodel-coding-plan/…`。唯一消费方 `normalizeModelForCatalog` 拿它补前缀，新形态与目录同源，只会更准；退路支下仍是个人缺省，与现状同。
- **R4 不分阶段 / 不分覆盖**：与 EV-136 残余 ①② 相同，doctor 同样取 plan 阶段档位模型作代表，不看 `--model-glm` 与主题级覆盖。
- **R5 仍读真实 HOME 的零配额项**：`probeZcodeModels` 与 `probeTraceSource` 读真实 `~/.zcode/cli` 的静态事实（模型目录、轨迹文件模板），不拉起 CLI、不写东西，本题不动。`trace_source` 记的模板路径是真实 HOME 下的，与审查运行的落点不同；它只进 note 与结论文件、没有代码消费方（grep 已核），留作说明不改。
- **R6 时延**：多一次 `prepareZcodeHome`（读写一份 JSON），可忽略。
