# MCP执行工具调用检测（EV-188）· 实施与验证报告

> - **日期**：2026-10-02
> - **主题**：`MCP执行工具调用检测`（留痕 `.reviews/MCP执行工具调用检测/`）
> - **起点**：`6aee012`；计划 r2（计划双审 run `20261002T072209Z`，9 条全接受）
> - **证据目录**：`doc/05_testing/evidence/mcp-exec-detect-20261002/`
> - **边界**：**只检测、未关通道**——zcode 副本 HOME、拉起参数、`ZCODE_READONLY_DENYLIST` 都没动，`mcp__node_repl__js` 仍在 glm 侧工具清单里。
> - **结论**：机制层全部通过（单测 + 适配器级 + 集成，变异 25/25、契约变异 5/5、改前改后对照 11/11、全量两次全绿、自检 14/14）；效果层真实 glm 一轮即达标（判失守、写事件点名 node_repl）；代码双审 6 条全接受并已修订；真实审查员运行 3/6。verify 见 §8.3。

## 1. 改了什么

| 落点 | 内容 |
| :-- | :-- |
| `src/trivium/adapters/zcode-trace.ts` | 新增 `ZCODE_MCP_PREFIX`、执行型名单 `ZCODE_MCP_EXEC_PREFIXES = ['mcp__node_repl__']`（常量，注释写实见出处，新增要有实见依据）、`isZcodeMcp` / `isZcodeMcpExec`；`parseZcodeTrace` 新增 `mcpCalls`（按名，`max(started, 终态)`）与 `mcpCallIds`（日志行**顶层** `toolCallId` → 工具名）；新增 `summarizeMcpInput`（先 `redactSecrets` 再折叠空白、截 120 字）与 `summarizeZcodeMcp`（两边按调用 id 求并集、按名取大兜底；执行型产出 `MCP:工具名(调用 id 参数摘要)` 写事件，只在日志里的部分补「会话日志另记 k 次，参数不可得」；名单外点名） |
| `src/trivium/adapters/zcode.ts` | 组装处收两份来源、调 `summarizeZcodeMcp`：`tool_calls.mcp` 只在 ≥ 1 时出现；执行型写事件并入 `write_events`；名单外进 `mcp_untrusted_tools`（非空才出现）；`trace.json` 加 `mcpCalls: {total, byTool, sources}`（≥ 1 时） |
| `src/trivium/adapters/base.ts` | `MCP_WRITE_EVENT_PREFIX = 'MCP:'`（`guard` 只从这里取跨族词汇） |
| `src/trivium/types.ts` | `ToolCallCounts.mcp?`、`EvidenceUntrusted`、`CriticResult.mcp_untrusted_tools?`、run 元数据 `verification_degraded[侧].evidence_untrusted?` |
| `src/trivium/guard.ts` | `SideVerification.untrusted?`（证据不可信，只在成立时出现）；`judgeRun` 的不可归因条件扩为三种成因（能力恒态 / 证据不可信 / MCP 执行型），`RunVerdict.unattributedCauses?`；`breachedAbs` 跳过 `MCP:` 条目；告警加证据不可信一行、失守段后的 MCP 补句、「无法归因」按成因分句（只有能力恒态时文案与改前逐字相同） |
| `src/trivium/review.ts` / `render.ts` / `report.ts` / `parse.ts` | 五面留痕：run.json `evidence_untrusted`、front-matter 条件键 `evidence_untrusted`、文档横幅、报告旗标；`ECHOED_ORCHESTRATOR_KEYS` 补键 |
| `skills/dual-critic/schema/run.v2.json` | `verification_degraded` 逐侧对象加可选属性 `evidence_untrusted`（`cause` 枚举 `mcp-call`、`tools` 至少一个、不许多余字段）；`unattributed_drift_files` 说明补两种新成因。`tool_calls` 不改（本就 `additionalProperties: integer`） |
| `src/trivium/adapters/stub.ts` | `StubSpec.mcpExecCalls?` / `mcpUntrustedTools?`（集成用例注入用，两项都不给时与之前逐字相同） |
| 测试 | 新增 `test/helpers/zcode-mcp-samples.ts`（照真实形态的样本）、`test/unit/zcode-mcp-detect.test.ts`、`test/unit/zcode-mcp-adapter.test.ts`、`test/unit/run-schema-mcp.test.ts`、`test/integration/mcp-detect.test.ts`；`parse-degrade.test.ts` 的 P9 全开夹具补 `untrusted` |

两档的口径：执行型（与 `Bash` 同档）走只读失守的既有各面——run.json `readonly_breach` / `breached_files`、运行时告警、报告 `只读失守`、闸门 `readonly_breach` failure；名单外走降级档位的五面——run.json、front-matter、横幅、运行时告警、报告，**不进闸门、不作废、结论保留**。

## 2. 计划偏离与更正

1. **计划 r2 §1.4「日志没有调用 id」失实**（我只核了 `context` 的键）：日志行顶层的 `toolCallId` 与 rollout 的 `response.toolCalls[].id` 同值——五次真实运行共 172 次调用，两边 id 集合完全相同、工具名无一不符（`history-scan-output.json` 的 `idCheck`）。去重由「按名取大」改为**按调用 id 求并集**，id 缺失的日志事件仍按名取大兜底。计划双审第 2 问所说「两边各丢不同的调用时取大少计」因此消失（U12）。已在 r2 末尾追加 §7 记录，正文不改。
2. **归因分流多并进一种成因**：r2 只写了「证据不可信」参与（AGY-01）；MCP 执行型调用同样让「无写事件 ⇒ 开发者手改」不成立——它能写任意文件，而写事件里只有代码摘要、扣不出文件。不并进来，同轮的工作树变动会被记成开发者手改（G8）。
3. **写事件条目带调用 id**：真实历史样本回放时发现，`20261001T092816Z` 的 7 次 node_repl 调用参数前 120 字只有 2 种，按串去重后写事件只剩 2 条（计数 7 正确、判定正确，但留痕条数不等于调用次数）。条目改为 `MCP:工具名(调用 id 参数摘要)`，每次调用一条，还能拿 id 回 rollout 查全文（U13；回放改后 7 条）。决策四「条目形如 MCP 加工具名与参数摘要」仍成立，多了 id。
4. **变异清单由 17 条扩到 24 条**：r2 的 17 条之外，补了上面三处的对应变异（M18～M20）与四个接线面（M21～M24）。

## 3. 单测、适配器级用例、集成

- `zcode-mcp-detect.test.ts`（23 条，含代码双审后补的 U14）：U1～U14 判别、计数、合并、脱敏截断、id 并集、条目带 id、rollout 缺 id 时退回按名取大；G1～G9 判定——执行型判失守与告警补句、名单外记不可信且不动禁读与证据判定、两档并存、缺席是结构上缺席、`MCP:` 条目不参与归因扣除（括号里恰为漂移文件路径的可杀构造，GLM-01）、证据不可信与 MCP 执行型各自让漂移落「无法归因」、无成因时归因不变、只有能力恒态时「无法归因」文案与改前逐字相同。
- `zcode-mcp-adapter.test.ts`（3 条）：假 `zcode.cjs` 按 0.16.9 取值链落样本，`zcodeAdapter.run` → `judgeRun` → `renderGuardWarnings`，三种样本；无 MCP 那格 `tool_calls`、`write_events`、`trace.json` 键集与改前相同。
- `run-schema-mcp.test.ts`（4 条）：带 / 不带新键都合法；空 `tools`、未知 `cause`、缺 `tools`、多余字段都不合法。
- `integration/mcp-detect.test.ts`（2 条）：真实打包 CLI + 桩，`review --start` → `--wait` → 落应答件 → `gate --check` → `report`。名单外：run.json、front-matter、横幅、终态播报、报告五面都在，闸门零失败；执行型：`readonly_breach`、`breached_files` 的 `MCP:` 条目、播报补句、闸门 `readonly_breach` failure（消息点名该工具）、报告 `只读失守`。

## 4. 变异

- **源码变异 24/24 咬住**（`gen-mutation-spec.mjs` → `mutation-spec.json`；先用 `mutation-names.mjs` 逐条带 `--test-timeout` 预跑，24 条全红、哨兵正常删除，`mutation-names-log.txt`；再跑 `scripts/mutation-check.mjs`，基线全绿、24/24，`mutation-output.txt`，src 恢复）。写事件格式改为带 id 之后两步都重跑了一遍（这批读数在代码双审后改名为 `*.r1.*`）；代码双审后加 M25 再跑，25/25，见 §8.2。
- **schema 契约变异 5/5 咬住**（`contract-mutations.mjs`，只动 `dist/test` 下的拷贝，收尾逐字节核回；`contract-mutations-output.txt`）：删属性、去 `minItems`、放宽 `cause`、`required` 去 `tools`、允许多余字段。

## 5. 改前改后对照与历史数据（零配额）

`acceptance.mjs`（`acceptance-output.txt` / `acceptance-readout.json`）：**11/11**。旧构建 `git archive 6aee012`（bundle sha256 `e3dd3eca…`）、新构建工作树（`ae62da04…`），`package.json` / `package-lock.json` 逐字节相同。

| 样本 | 改前 | 改后 |
| :-- | :-- | :-- |
| 执行型（1 次 `mcp__node_repl__js`） | 放行：无写事件、不失守、无 `mcp` 键 | 判只读失守；写事件 `MCP:mcp__node_repl__js(…)`；`mcp: 1`；告警有失守段与 MCP 补句 |
| 名单外（1 次 `mcp__zread__read_file`） | 放行：无不可信、无 `mcp` 键 | 证据不可信 `{cause: mcp-call, tools: [mcp__zread__read_file]}`；不失守；`mcp: 1`；告警一行点名 |
| 无 MCP | — | `tool_calls` / `write_events` / 告警与改前逐字相同 |
| 真实回放 run `20261001T092816Z` | MCP 写事件 0 条 | 7 条、计数 7（rollout 7 / 日志 7） |

历史扫描（`history-scan.mjs` → `history-scan-output.json`，只出计数与工具名）：本仓运行根下保留的 glm 侧 rollout 214 份（含本主题计划双审），38 份调过 node_repl、共 95 次，名单外 MCP 0 次；2026-09-26 起 63 份里 12 份；2026-10-01 起 11 份里 1 份（`20261001T092816Z`，7 次）。日志与 rollout 的调用 id 在五次运行上一一对应（§2 第 1 条）。

## 6. 效果层（真实 glm，花配额）

`mcp-run.mjs`（证据 `runs/r1/`）：mkdtemp 夹具（独立 git 仓库，`.trivium/config.yaml` 从本仓复制、`run_root` 钉到夹具旁，`config.local.yaml` 只复制不打印），工作树新构建直接 `node` 调 bundle、资产根指向本仓工作树；零配额预检通过后同步 `review --stage plan --critics glm --entry A`，焦点（`focus-r1.txt`，过 `focus-check.mjs`：无写动词、无受保护字样、无 shell 危险字符）要它用 node_repl 算 17 乘 23。**第 1 轮即达标，未用补跑轮**：

| 判据 | 读数 |
| :-- | :-- |
| ① rollout 里确有 node_repl 调用 | 1 次：`{"code":"nodeRepl.write(String(17 * 23));","title":"计算 17 乘 23"}`（另有 Read 4、Glob 2） |
| ② run.json 判只读失守 | `readonly_breach: true`；`breached_files` = `MCP:mcp__node_repl__js(call_2f0cb19d… {"code":…})`；`tool_calls.mcp: 1`；运行时告警有失守段与 MCP 补句；`report` 旗标 `只读失守`；`trace.json` 的 `mcpCalls` = `{total: 1, byTool: {mcp__node_repl__js: 1}, sources: {rollout: 1, log: 1}}` |
| ③ 写事件条目点名该工具 | 是 |

run `20261002T080254Z`，240 s。glm 在总判断里写了「工具返回 391」，并自注「本侧无执行能力，唯一例外是焦点要求的 17×23 算术调用」——正是决策六所说的情形：`none` 只对内置工具面成立，执行型工具一被调用就判失守、该轮结论不被当作合法结论采信。夹具与运行根已按 mkdtemp 返回值清理。

**真实审查员运行计数**：计划双审 1 + 效果层 1 = 2（上限 6），代码双审另计。

## 7. 全量检查与自检

- `npm test` 两次（之间不改文件）：**2567 / 2565 通过 / 0 失败 / 2 跳过**，两次相同（`check-1.txt`、`check-2.txt`）。第一次探查时红过两条（P9 / P9′：回显清单与 front-matter 键集对账；全开夹具没带 `untrusted`、`render.ts` 那行写成了多行条件展开扫描器认不出），改成单行写法、夹具补字段后全绿。
- `doctor --selftest`（工作树新构建）：**14/14**（`doctor-selftest.txt`）。

## 8. 代码双审、修订与 verify

### 8.1 代码双审第 1 轮（run `20261002T081745Z`，真实运行计数 3/6）

gemini `approve`（0 条）；glm `approve-with-nits`（次要 1、吹毛求疵 1）；codex 整份解析回退（`json_syntax`：结论 JSON 的键没加引号；原文自报 `approve-with-nits`，4 条），闸门只认 `CODEX-F01`，原文四条在应答件表外逐条裁决。**6 条全接受**（应答件 `.reviews/MCP执行工具调用检测/code/2026-10-02-MCP执行工具调用检测-response-claude.md`，`gate --check` 重跑 1 次通过）：

| 意见 | 内容 | 落点 |
| :-- | :-- | :-- |
| GLM-01 | rollout 条目缺 id、日志带同批 id 时，同一次调用既进 rollout 计数又进「只在日志」那部分，计数翻倍、多一条「另记」 | `summarizeZcodeMcp`：某名在 rollout 里有条目缺 id 即退回按名取大；U14；变异 M25 |
| CODEX-F01 原文 01 | `types.ts` 的 `unattributed_drift_files` 注释漏第三种成因 | 注释补成三种 |
| CODEX-F01 原文 02 | 五面文案把成因写死成「MCP 调用」，`cause` 加值时会静默说错 | `types.ts` 新增 `EVIDENCE_UNTRUSTED_CAUSE_TEXT`（按 `cause` 键控的 `Record`），guard / render / report 从它取；现有文案逐字不变 |
| CODEX-F01 原文 03 ≡ GLM-02 | 设计、BACKLOG、索引、名单注释、上一题应答件更正节写「213 份 / 10 轮」，证据与本报告写「214 / 11」 | 统一为证据读数并注明「截至 2026-10-02 本主题计划双审之后扫描」；证据不重扫 |
| CODEX-F01 原文 04 | PROTOCOL 键路径漏了逐侧那一层 | 改为 `verification_degraded.〈侧〉.evidence_untrusted` |

### 8.2 修订后的读数

- 本主题用例（单测 + 适配器级 + schema + 集成 + P9）59/59。
- 源码变异 **25/25**（规格加 M25；编码期那批 24/24 的读数改名为 `*.r1.*` 保留）：预跑 25 条全红（`mutation-names-log.txt`），装置基线全绿、25/25（`mutation-output.txt`），src 恢复、哨兵已删。
- 契约变异 5/5、改前改后对照 11/11（含真实回放改后 7 条）：重跑一次，读数不变。
- `npm test` 两次：**2568 / 2566 / 0 / 2**，两次相同（`check-1.txt`、`check-2.txt`；编码期两次的 2567 读数改名为 `*.r1.txt`）；`doctor --selftest` **14/14**（`doctor-selftest.txt`）。

### 8.3 verify

`trivium verify --topic MCP执行工具调用检测`（run `20261002T084707Z`）：**通过**——`npm run typecheck` ✓、`npm run build` ✓、`npm test` ✓（2568 / 2566 / 0 / 2，274.8 s），共 278 s。留痕 `.reviews/MCP执行工具调用检测/verify/`。

## 9. 文档

- 主设计 v1.3.75：§6.5 front-matter 契约登记 `evidence_untrusted`；§10.3 ZCode 列工具层与事后核验层；§11.1 新增「证据不可信」一段、「命令执行能力」末尾边界句改为两档检测并写明 zcode 格声明仍是 `none` 的理由；§11.3 要点 5；台账 v1.3.75。
- LLD v1.1.31：2.5 表 `guard.ts`、`adapters/zcode-trace.ts` 两行（旧行数早已失实，按现行源码改准）。
- PROTOCOL：「两条通道」段之后补一段编排器看不见的通道与 `evidence_untrusted`。
- MANUAL / QUICKSTART：grep「失守」「降级档位」「verification」核过，两份都不逐项列核验档位或失守面，**不改**。
- BACKLOG：EV-188 结案（写明只检测、未关通道与历史数据）；EV-95 末尾追加更正（EV-79 r3 的「本轮双 shell 实测」是经 node_repl 真跑的，只追加、不改结案结论）；新登 EV-189（子代理会话不在核验面）、EV-190（非 MCP 表外内置工具）、EV-191（失守轮次的重跑成本）。
- 上一题两处「是否被调用判不出」：报告 `REPORT_2026-10-02_critic_exec_wording.md` §6.1 直接改准；该题代码应答件末尾补「更正（2026-10-02）」一节，原文不改。

## 10. 风险与暂缓

- **R1 闸门挡下的轮次会变多**：历史上约每 5～6 轮 glm 侧就有 1 轮调过 node_repl；落地后这类轮次在 `gate --check` 记 `readonly_breach`、只能重跑。缓解在 EV-191（任务书点名禁用，或回到关通道）。
- **R2 混合版本**：只在出现名单外 MCP 调用的那一轮才写 `evidence_untrusted`；旧构建读到它会走「留痕读不出」出口（版本落后 ⇒ 升级）。提交后先从已提交状态重建、再请用户重装；重装前不要用旧安装副本对新构建写出的、带该键的 run.json 跑 `gate` / `report`。本主题的计划双审、代码双审与 verify 都由安装副本（旧构建）执行，不写新键；效果层只用新构建。
- **R3 证据不可信与 MCP 执行型会让漂移改判「无法归因」**：有意的方向。
- **已知边界**：失败 / 超时的一侧轨迹不解析，调没调过 MCP 无从得知（与「失败侧不评判证据」同口径）；子代理会话（EV-189）与非 MCP 表外工具（EV-190）不在本主题。
