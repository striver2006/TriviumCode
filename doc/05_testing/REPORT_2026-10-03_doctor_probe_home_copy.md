# doctor 探针走副本 HOME · 实施报告（EV-194）

> - **日期**：2026-10-03
> - **主题**：`doctor探针走副本HOME`（命令 A `/dual-run`，Driver claude）
> - **起点**：`292fa79`（`main`，工作树干净）
> - **计划**：`.reviews/doctor探针走副本HOME/plan/` r2（计划双审第 1 轮 run `20261003T042353Z`，12 条全接受，其中 CODEX-02 只采纳三项建议中的两项）
> - **证据目录**：`doc/05_testing/evidence/doctor-probe-home-20261003/`
> - **代码双审**：run `20261003T050949Z`，codex `approve-with-nits`（次要 3、吹毛求疵 3）、gemini `approve`（零意见）、glm `approve-with-nits`（吹毛求疵 1），7 条全接受，按应答件改码见 §2 末
> - **配额**：单测与变异零配额；改前改后真实对照用户开工时授权（上限四次真实调用），实际 3 次（改前 headless 1 次、改后 headless + path_deny 2 次）

## 1. 问题

doctor 的 zcode headless 读文件探针与 path_deny 否定对照以真实 HOME 拉起、注入个人 provider 配置 `~/.zcode/v2/provider_config.json`，0.16.9 见它存在就用它的 `defaultModelSelection`（P-31），且不再从 `cli/config.json` 导入 provider——探的是个人缺省模型，不是审查运行那条选模路径（审查运行自 EV-82、认证探活自 EV-136 起都走副本 HOME、不注入个人配置）。2026-10-02 个人缺省指向已停用 provider 的 `qwen3.8-max`，doctor 连报 `Model creation failed`；headless 失败即返回，`response_field` / `model_id_form` / `path_deny` / `scratch_paths` 都不刷新。反过来个人缺省可用而 GLM 坏了时会误报正常。

## 2. 改了什么

- `adapters/zcode.ts`：新增导出 `zcodeProbeModel(cfg)`（档位 plan 阶段的 glm 模型）与 `describeZcodeProbedPath(prep)`（「探的是哪条路径」四档措辞）；`authProbe` 改用这两个函数，输出逐字节不变（`zcode-auth-probe.test.ts` 10 条照绿）。三处过时注释按实改（`storageRedirectRoot` 的使用方、`model_id_form` 的来源两处）。
- `probes/zcode.ts`：
  - headless 段：`mkdtemp`（前缀 `trivium-zcode-doctor-`）→ `prepareZcodeHome(runDir, launchModel, { srcConfig: cliConfigPath, requestedFirst: true })` → `launch = { homeDir, omitPersonalProviderConfig: homeDir !== null, storageRedirectRoot: zcodeHomeUnder(runDir) }`，headless 与 path_deny 两次都展开它；整段包在 `try/finally` 里只删 mkdtemp 的返回值；副本源坏了推一条 note、保留旧结论、不退回真实 HOME；
  - 「探的是哪条路径」一行进 note（副本支 / 退路支后缀不同），headless 失败 note 也带上；
  - 回读：日志目录直接取 `zcodeStorageRedirectEnv(landing).ZCODE_LOG_DIR`（递给 CLI 的那个值），rollout 走 `readRollout(sid, landing)`；
  - `readTrace(sessionId, logDir)`：`logDir` 改必填，读目录下全部 `.jsonl` 按名排序拼接（与审查运行同一文件集合口径，跨午夜不丢启动事件）；唯一调用方即 headless 段；
  - `probePathDeny` 加可选第五参 `{ launch, invoke }`；`probeZcode` 加 `launchModel` 与测试注入口 `invoke`；
  - **编码时补**：headless 失败时，在临时目录删除之前从落点日志取 `turn.failed` 的结构化根因（`error.cause.message`，脱敏、截 200 字）接在失败 note 末尾——日志改落临时目录、探完即删之后，RUNBOOK「先取结构化根因」那一步对 doctor 不再可行，不补就是诊断能力倒退；
  - beta 入口与落点宿主预置两条 note 的措辞按实改。
- **代码双审后（应答件 7 条全接受）**：临时目录删除改 `maxRetries: 3`、失败不抛、推一条 ⚠️ note 说清残留路径与「含凭据请手工删」（CODEX-01，D10）；`readTrace` 逐片兜底、单片读不了就跳过（CODEX-02，D9b）；「探的是」那行挪到 headless 通过之后才推（CODEX-06，D4 断言失败时不出）；退路括注按 `prep.cause` 分「档位未给模型」与「副本源在探测中途不见了」（GLM-01）；`readRuntimeSelectedModel` 注释与设计 §11.3 要点 5 按实改（CODEX-04）；认证探活调 `prepareZcodeHome` 处注明缺省源与 doctor 门控同一文件（CODEX-05，只加注释）。EV-196 论域扩到「副本源读取或解析失败」一支（CODEX-03）；认证探活的同形删除问题因决策一不改探活，另登 EV-197。
- `doctor.ts`：给 `probeZcode` 传 `launchModel: zcodeProbeModel(opts.config)`；`zcodeProbe` 注入口的 `Pick` 加 `invoke`。
- 不变：认证探活行为、审查运行、旗标探针、三条模型覆盖探针臂、探针结论的 schema / 缓存 / TTL、doctor 的 blocker 与 warning 判据、「headless 失败即返回」（其在有既有结论时不拦不警告的现状另登 EV-196）。

## 3. 读数

| 项 | 结果 | 留痕 |
| :--- | :--- | :--- |
| 单测 `zcode-doctor-probe-home.test.ts` D1～D10（D7 两条、D9b） | 代码双审后 12 条新增全绿；与 `zcode-auth-probe` / `zcode-provider-env` / `preflight` 合跑 119/119（双审前 117/117） | — |
| 变异预跑（逐条带超时） | 第一批 16/16、补根因后第二批 17/17、代码双审后第三批 19/19 咬住 | `mutation-names-log.r1.txt` / `.r2.txt` / `mutation-names-log.txt` 及同名 `output` |
| 变异装置（`scripts/mutation-check.mjs`） | 第一批 16/16、第二批 17/17、第三批 19/19 咬住，基线全绿 | `mutation-spec.r1.json` / `.r2.json` / `mutation-spec.json`、`mutation-output.r1.txt` / `.r2.txt` / `mutation-output.txt` |
| 变异残留 | 三批跑完后系统临时目录下 `trivium-zcode-doctor-*` 均为 0（用例把 `TMPDIR` 钉在私有目录、结束整删） | — |
| 改前改后真实对照 | 改后四条判据全达标；改前不可对照（失败形态不是写死的那一种），见 §3.2 | `acceptance.mjs`、`acceptance-output.txt`、`acceptance-readout.json`、`doctor-old.*`、`doctor-new.*` |
| 全量检查（串行） | 见 §3.1 | `check-1.txt`、`check-2.txt`、`check-3.txt` |
| doctor 自检 | 见 §3.1 | `doctor-selftest.txt` |

### 3.1 全量与自检

代码双审前：串行两次 `npm run check`，均 tests 2608 / pass 2606 / fail 0 / skipped 2，退 0（`check-1.txt`、`check-2.txt`）；`doctor --selftest` 14/14（`doctor-selftest.txt`）。代码双审后按应答件改码，再串行一次：tests 2610 / pass 2608 / fail 0 / skipped 2，退 0（`check-3.txt`，多出的 2 条是 D9b、D10）。真实对照不重跑：S9 未改两次真实调用的拉起形态与判据所看的输出，授权已用 3 次。

### 3.2 改前改后真实对照

前提（开跑前读出）：档位 `default`，glm.plan = `GLM-5.3`，按副本源限定为 `bigmodel-coding-plan/GLM-5.3`；个人配置 `defaultModelSelection` 仍是 `84044858-…/qwen3.8-max`（已停用 provider）。两份 bundle sha256 不同（改前 `df3161e8…`，改后 `c4cc238e…`）。两个临时项目各自 `git init` 并拷入仓库的 `.trivium` 配置，跑前把 zcode 段的 `response_field` / `model_id_form` / `path_deny.method` 改成哨兵；仓库里的探针结论文件没动。

| 判据（写死） | 结果 |
| :--- | :--- |
| 改前：headless 报 `Model creation failed` | **未复现 ⇒ 不可对照**。旧构建 headless 确实失败（退 69，blocker「ZCode headless 未跑通」，耗时 312s），但报的是 `ProviderBusinessError: litellm.InternalServerError … Connection error`；真实日志显示那次 CLI 启动时选定的模型是 `f8e3aa3d-…/llama-stack-thinking`（个人配置路径下 ZCode 自选，非 GLM），`turn.failed` 根因 `Model request was cancelled.`（重试耗尽）。形态与 10-02 不同，但同样是「探的不是审查那条路径」。按计划 r2 §6.3 不重跑、不追加调用 |
| 改后 ① headless 通过 | 达标（无失败 note，envelope note 在，哨兵命中，退 0，耗时 44s，blockers 为空） |
| 改后 ② 详情写档位模型 | 达标：「headless / path_deny 探的是：模型 bigmodel-coding-plan/GLM-5.3（与审查运行同一选模路径；CLI 产物落在临时目录、探完即删）」 |
| 改后 ③ `response_field` 与 `model_id_form` 刷新，后者 modelId 段 = 档位、前缀 = 副本源 provider 键 | 达标：`response_field` 哨兵 null → `response`；`model_id_form` 哨兵 → `bigmodel-coding-plan/GLM-5.3`（会话日志 `context.model` 回读）；`path_deny.method` 也刷新为「否定对照成立……（哨兵命中）」 |
| 改后 ④ 真实 `~/.zcode/cli` 的 log 与 rollout 文件数前后不变 | 达标（log 7 → 7，rollout 3 → 3） |

补充读数（不进判据）：改后那次跑前后，真实当日日志 `zcode-2026-10-03.jsonl` 大小 +1712 字节（04:56:13）。逐行核了事件名与模块：是 3 行 `bootstrap.zcode_protocol` 的 `heartbeat` 内存采样、不带 sessionId；同类行自 10-02 16:00 起每 10 分钟约 8 行、全天不断，来自后台的 ZCode 协议进程，与本次 doctor 无关。改前那次在真实目录新增 1 个 rollout、当日日志追加约 84 KB（旧行为，计划约定不进判据）；其 rollout 文件数也是 3 → 3，是因为同期最旧的一份（`…e32a8d3b…`，00:21）消失了——谁删的未核（推测是 CLI 自身的保留策略），本主题不追。

判伪性说明（计划 r2 §6.3）：档位模型 `GLM-5.3` 恰是副本源首位与 `model.main`，本对照区分不了「请求生效」与「回落首位」——那归 doctor 零配额的置首支（`runtime_selection`）。本对照要证的是「探的是副本路径而非个人配置」，回读到 `bigmodel-coding-plan/…` 只可能出自副本源。

## 4. 文档

- 主设计 v1.3.78：§11.3 第 7 条末尾补 doctor 两次真实调用同形；变更记录加一行。PROTOCOL 无 zcode 探针段，不改。
- RUNBOOK：`Model creation failed` 一行改写（原「该探活走 `homeDir: null`」自 EV-136 起已不符；补「先看详情括号里探的是哪条路径」与 doctor 失败 note 带根因）；`Select a model before continuing` 一行末尾补「这一行只管读个人配置的路径」。
- BACKLOG：EV-194 结案；EV-115 改「已消解」并按决策二改写不修理由；EV-136 末句补一句；EV-93 补事实；新登 EV-196（计划双审 AGY-01：有既有结论时 headless 失败不拦不警告）。

## 5. 残余

- **`model_id_form` 不记来源**（计划 r2 §2.6，CODEX-01）：副本支与退路支写同一字段，来源只在 note 里；唯一消费方只取前缀补短名、对来源不敏感。
- **不分阶段 / 不分覆盖**：与 EV-136 残余 ①② 相同，取 plan 阶段档位模型作代表。
- **凭据**：副本含真实 apiKey，`finally` 整删；进程被硬杀时会在系统临时目录留一份，与认证探活、同形臂同一残余。
- **可见性**：副本 HOME 下 doctor 看不到真实 `~/.zcode` 的插件 / MCP 等，与审查运行一致（决策二）。
- **`probeZcodeModels` / `probeTraceSource`** 仍读真实 `~/.zcode/cli` 的静态事实，不拉起 CLI；`trace_source` 记的模板路径与审查运行落点不同，无代码消费方。
- **headless 失败 / 副本源解析失败不拦**：见 EV-196。
- **认证探活的临时目录删除失败会抛**：见 EV-197（决策一不改探活）。
- 退路括注「副本源在探测中途不见了」一支只在门控与 `prepareZcodeHome` 两次存在性读之间副本源被挪走时可达，没有用例摆出这一竞态，靠代码审读。
