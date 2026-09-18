---
schema: trivium.review.v1
topic: M9-Driver旗标全链路与选侧收口
stage: code
role: codex
vendor: openai
agent_cli: codex/0.155.0
model_requested: deepseek-flash
model_effective: deepseek-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260918T165302Z
rerun_index: 1
snapshot_hash: sha256:c972dd3b48f0656dc39272b34840ec2d76a49b4454b3bde17cdc5a19caadb79b
blind: true
started_at: 2026-09-18T16:53:03.054Z
finished_at: 2026-09-18T17:06:19.146Z
duration_s: 421
tool_calls:
  run_command: 103
  project_reads: 59
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 5
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0b56f-9239-75f1-bf5e-24843b2739c0
---

# 代码审查：M9-Driver旗标全链路与选侧收口

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260918T165302Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

三个焦点逐条核过：①闸门回落链在 --check / --await-approval 两条路径上已硬失败、不静默按缺省 Driver 继续，但 --check-artifacts 那一格仍是静默缺省（唯一真缺口，见 CODEX-01）；latestRunMeta 另有「最新留痕读不出来就悄悄换上一轮」一格（CODEX-02）。②两处同形分流我逐行比过，今天确实一致，但一致靠四份复制品维持、无对账（CODEX-04）。③T-11 缺口量级可控——所有已知错法都落回阻断而非静默放行——但它是计划写死的完成判据 C4，且替代判据只证「实参位在场」不证「取值来自留痕」，必须显式降级或补在第 6 步验收之前（CODEX-05）。真正该先修的是台账：代码与计划引用的 EV-63/EV-64 在 BACKLOG 里不存在，计划 §8 的「编号重排」没落盘（CODEX-03）。另有一条设计文档偏离（--driver 未按设计 §5.2/§9.2 记入 task.json.runs[] 与 state.json 闸门项，且 doc/ 本批零改动，CODEX-06）与一条谓词的静默退化风险（CODEX-07）。未发现会让这一轮审错对象或静默放行的功能性缺陷。

**结论**：`request-changes`

## 审查意见（共 7 条：重要 1 ｜ 次要 5 ｜ 吹毛求疵 1）

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/gate.ts:734、src/trivium/archive.ts:144（对照 doc/08_project/BACKLOG.md 全表）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：本步引用的台账编号在台账里不存在。gate.ts:734 写「删除登记为 EV-64」、archive.ts:144 写「残余风险（EV-63）」，计划 §2.2/§8 也把它们当已登记，并在 §11 明确要求审查员「本轮所有 BACKLOG 编号已重排：EV-58 关闭、EV-63 新增，请按 §8 核对而非沿用 r2 的清单」。但 doc/08_project/BACKLOG.md 的最高编号是 EV-57，doc/ 全目录搜不到 EV-58…EV-64 任何一个字符串。后果有三：①本步刻意留痕的两条（二值谓词的残余风险、inferLatestRunId 死代码待删）只活在代码注释与计划里，按台账复查的人看不到——而 EV-63 正是「下一次有人往选原稿路径加东西时最容易踩」的那一格；②本步已实现的 EV-53 / EV-54 两行仍是 todo，正文还在说「本步不修 / 第 4 步刻意不做」，读台账的人会以为它们仍开着；③§8 声称关闭的 EV-58 同样查无此项。这是本仓反复记过的形态（EV-14：同一份依据对同一议题存下两个相反答案），且这次是计划自己点名要核的地方。

**依据**：grep doc/08_project/BACKLOG.md 的 `EV-[0-9]+`（最大 EV-57）与全 doc/ 搜 EV-58…EV-64（零命中）；计划 .reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-…-r3-claude.md §2.2（line 74）、§8（line 445-464）、§11 末段；代码注释 src/trivium/gate.ts:734、src/trivium/archive.ts:144、src/trivium/critics.ts:65、src/trivium/review.ts:283。本批 changes 的 20 个文件里没有任何 doc/ 文件。

**建议**：把 §8 的记账真正落进 BACKLOG：新增 EV-63（二值谓词对「front-matter 被剥掉/改坏的审查件」判 false，含 §8 给的那条告警建议）、EV-64（inferLatestRunId 死代码待删），关闭 EV-53/EV-54（本步已实现），并把 §8 提到的 EV-58/59/60/61/62 与真实编号逐条对齐。若这些编号是刻意推后到第 7 步（EV-57 的纪律 6 回溯），请在计划 §2.2「不做」表里写明——否则代码里的编号是悬空引用，而注释是接手者唯一会读的东西。

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/cli.ts:770-778 与 :809（对照 :823-845、:919-923）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：cmdGate 三条子命令的「留痕读不出来」回落定义不对称。--check（:919-923）与 --await-approval（:823-845）在 latestRunMeta 返回 null 时硬失败并点名；--check-artifacts 这一格则**静默**用 gateDriver = DEFAULT_DRIVER（:771）继续：轮次退回按缺省 Driver 算（:777-778 的 resolveRerunIndex(driver=claude)），checkStageArtifacts 的 driver 位也拿缺省值（:809）。于是 plan/bug 阶段会把「原稿 …-claude.md」当缺件点名（archive.ts:356-362 的 label 与 hasAnyRound），而真实 Driver 的 …-<driver>.md 明明躺在目录里；人读与 --json 两条输出都没有任何「该阶段没有可读的运行元数据」的迹象，用户会被引去查文件名规则。

**依据**：读 src/trivium/cli.ts（:761-820 三个分支的取值链）、src/trivium/archive.ts:318-362（checkStageArtifacts 用 driver 拼原稿/裁决件 label）。narrow 影响面：该格下 recorded 集合来自 listRecordedRuns，通常已判缺件（fail-closed），所以后果是「误导性诊断」而非「静默放行」——但它是焦点一问的那一格，且另两条路径已按同一原则硬失败。

**建议**：二选一并在该段注释里写清判据：(a) 与另两条同构硬失败（「该阶段读不到任何运行元数据，无法确定当轮 Driver 与轮次」）；(b) 保留回落但让人读与 --json 两条路径都出一条可见提示（点名 driver 与轮次是按缺省算的）。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/meta.ts:369-388（latestRunMeta）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：「逐个往下试」在**最新那一轮**留痕读不出来（内容被改坏、schema 不识、文件被删）时会静默换一轮：latestRunMeta 返回上一条可读留痕，cmdGate 据此把 rerunIndex 与 runId 一并变旧。若上一轮本就裁决齐备，--check 会返回 ok、--await-approval 会把闸门钉在**上一轮**的 run_id 上，而最新一轮已落盘的审查件从未被裁决检查——这与同函数文档块写的「调用方据此硬失败并点名」不是一回事。缓解已核实：注册过的 run.json 缺失/不可读会在提交时被 hook-pre-commit 的 checkRunManifests 拦下（archive.ts:600-630，hooks.ts:991 调用），所以最坏是「多开一次人工审批 + 提交被拦」，不是静默放行；但闸门自身不留任何痕迹，人看到的只是「第 N-1 轮通过了」。

**依据**：src/trivium/meta.ts:369-388；test/unit/run-meta.test.ts 新增用例「latestRunMeta：读不出来的那条往下跳，不是整个返回 null」把该行为钉成期望；src/trivium/archive.ts:600-630 与 src/trivium/hooks.ts:985-995 的核对面；src/trivium/cli.ts:770-778 的消费方式。另实测归档 85 份 run-*.json 全部是定宽 YYYYMMDDTHHMMSSZ，排序依据本身成立。

**建议**：跳过时 warn() 点名被跳过的 run_id（与 run-protocol.ts:134-146 的 handoffDriver 同构），让人看见「有留痕被跳过了」；或把「跳过」限制在明确的历史形状上（如 v1 之外的未知 schema 也算损坏），对「文件名序最新那条读不出来」直接失败。

### CODEX-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/topic.ts:126-155 与 src/trivium/topic-args.ts:634-660` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：直接回答焦点二：我逐行比过，两处**今天确实一致**——候选过滤（role === driver && kind === null）、排序、剔除循环、显式路径硬拒、以及那段三段式错误文案逐字相同，分流（显式硬拒 / 自动过滤）也同构。但这份一致是四份复制品的巧合：候选过滤、排序、剔除循环、硬拒与文案各存在两份，isReviewArtifact 的调用方式也各写一遍；用例分处 topic.test.ts 与 topic-args.test.ts 两个文件，改一处另一处不会红。本仓对「同一事实两份实现」的既有对策是 grep 级对账（registry-parity、deny-matrix），这两处没有。

**依据**：逐行对照 src/trivium/topic.ts:88-155 与 src/trivium/topic-args.ts:594-660；两者的候选过滤与剔除循环结构、错误文案完全一致（我按行比过，未发现语义差异）。

**建议**：把「候选过滤 + 剔审查件 + 取最新」抽成 archive.ts 的一个导出函数（显式路径那条也收进同一个 assertNotReviewArtifact），或至少加一条 parity 用例（同一夹具分别过两个入口，断同一结果）。抽函数的收益不只是去重：它让「谁算原稿」只有一个答案，与 critics.ts 里 selectableCritics 的单点派生同构。

### CODEX-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/driver-wiring.test.ts:210-247（计划 §4.4 的 T-11 定在 test/integration/gate-loop.test.ts）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：判这个缺口有多大：①计划把 T-11 写成完成判据 C4（非缺省 Driver 下 gate --check 定位 -revised-<真Driver>.md，且覆盖「审查件已落盘、裁决件未写出」那一格），本步换成源码扫描，C4 只剩「实参位在场」这个弱代理；②那条扫描判据只要求 checkAdjudication 的实参块里出现标识符 driver，把它写成 driver: DEFAULT_DRIVER（形对值错）**照样绿**，而计划 §10 变异表里正是「把 checkAdjudication 的 driver 改回缺省 → T-11 必须红」；③非缺省 Driver 下 --check-artifacts 的 gateDriver、--await-approval 的闸门落点、轮次取值，整条链路没有任何运行期覆盖（现有 gate-loop.test.ts 夹具与断言全是缺省 Driver）。量级判定：可控。所有已知错法都落回阻断——driver 错 → missing_disposition 或工件缺件，轮次错 → 裁决件 front-matter 的 run_id 比对不上 → bad_front_matter（gate.ts:190-210）——没有一条会静默放行，所以它不推翻本步；但第 6 步验收（--driver <非 claude> --critics claude）恰恰是第一次真跑这条链，届时它同时充当一次没人设计过的集成用例。

**依据**：changes.diff 的文件表里没有 test/integration/gate-loop.test.ts；test/unit/driver-wiring.test.ts:175-247 的锚点与断言形态；计划 §2.3 C4、§4.4 T-11、§10 变异表；test/integration/gate-loop.test.ts:27 的桩配置与 :78-104 的裁决件写死 -revised-claude.md；src/trivium/gate.ts:190-210 的 run_id 一致性比对。

**建议**：二选一并落字：(a) 把 T-11 排在**第 6 步验收之前**（最小形态：桩点名 claude，--start --driver <X> --critics claude → 落盘 → gate --check 先断 missing_disposition 且点名 -revised-<X>.md → 补齐裁决件后断 ok）；(b) 本轮显式降级 C4，在计划 §2.2「不做」表里登记理由与补做时点。若维持源码扫描，请把 checkAdjudication 那条从「出现 driver」收紧到「取值来自 gateDriver」，与 checkStageArtifacts 那条同款。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/review.ts:874-882（newRunMeta 实参）+ src/trivium/meta.ts:413-440（registerRun）与 src/trivium/state.ts:47-68（GateEntry）` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | medium |

**问题**：设计文档把 --driver 的留痕面写成三处，本步只落了第一处。doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md:231「`review --start` 记入 `run.json.driver`、`task.json.runs[]` 与 `state.json` 闸门项」，§10.1（:531）的旗标表同口径，§9.2 还专门写「`state.json` 闸门项增记 `driver`」。实现侧：run.json.driver ✓（+driver_enabled）；task.json.runs[] 只写 run_id/stage/rerun_index/status/review_mode/started_at，无 driver；state.json 的 GateEntry 无 driver（state.ts 本批未改）。本批 20 个文件里没有任何 doc/ 改动，即这条偏离也没有按「与设计不一致 → 先回补修订设计文档」处置。我承认另一种解读：state.json 的消费方（Hook 的 driver 感知）在计划 §2.2 里被排除，记录本身可能被排在第 7 步的纪律 6 回溯里——但计划 §2.2 的「不做」表只列了 report/naming/hooks 的**消费面**，没列这两处**记录面**，所以至少缺一行显式说明。

**依据**：读 doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md:231 / :505 / :531；src/trivium/meta.ts:413-440（registerRun 写入的字段集）与 :91（TaskMeta.runs 的元素形状，无 driver）；src/trivium/state.ts:47-68（GateEntry 无 driver）；计划 §2.2「不做」表全表；实测 .reviews/M9-Driver旗标全链路与选侧收口/task.json 的 runs 元素只有六个字段。

**建议**：二选一：(a) 补上两处记录（registerRun 多写一个 driver、setGateChecked/GateEntry 增可选 driver），成本很小且与 run.json 同源；(b) 在计划 §2.2「不做」表里补一行「task.json.runs[] / state.json 闸门项的 driver 记录推后到第 7 步」，并在设计 §5.2/§9.2 就地标注「本步未落」，别让唯一实现依据与实现对同一件事各说一套。

### CODEX-07 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/archive.ts:148-157（isReviewArtifact）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：谓词的 catch 面比它文档块声称的宽。`const { parseFrontMatter } = await import('./render.js')` 与 readFile/parse 落在同一个 try 里，任何异常一律 `return false`。文档块把 catch 的语义写死为「front-matter 缺失/损坏/非 UTF-8/空文件四类坍缩为不是审查件」，但**模块加载失败不属于那四类**：它会让谓词恒返回 false，把显式路径的硬拒与自动候选的过滤同时变成空操作——正是这个谓词要防的「拿审查意见当原稿」原样回来，而且没有任何用例能发现（用例调的是同一个函数）。这里没有需要回避的循环依赖：render.ts 只静态 import types.js 与 agents/registry.js，不 import archive.ts；打包产物里 esbuild 已把它内联成 Promise.resolve().then(() => init_render())（skills/dual-critic/scripts/trivium.cjs:23754-23761）。

**依据**：src/trivium/archive.ts:148-157；src/trivium/render.ts:1-13 的 import 表；skills/dual-critic/scripts/trivium.cjs 里该函数的产物形态；src/trivium/render.ts:393-403 的 parseFrontMatter（只对 YAML 解析失败返回 null）。

**建议**：把 await import 提到 try 之外（或改成模块顶层静态 import），让加载失败按错误冒出来；try 只保留 readFile + parseFrontMatter 这两步——那两步的失败才是你文档块里写明要吞的那四类。

## 认为正确的部分

- 「不问后缀、直读留痕」这个方向对，且改对了地方：--run-id 读不出来时硬失败（cli.ts:763-769）终结了原先「推断失败就退化成没有 critics 信息继续判」的静默路径；rerunIndex 优先取留痕的 rerun_index 也与 firstFreeRerunIndex 的抬升回写（review.ts:1164-1167）自洽。
- latestRunMeta 的排序依据站得住，我按计划 §11 第 1 条实核过：newRunId()（meta.ts:34-36）是定宽 UTC YYYYMMDDTHHMMSSZ，归档内 85 份 run-*.json 全部符合该形态、无一例外；又按「最新留痕的 rerun_index」与各主题各阶段目录的实际轮次逐格对了一遍，没有发现取错轮次的主题（唯一差异是本轮正在跑的 code 阶段，属预期）。
- 焦点二的分流今天确实一致（见 CODEX-04 的实测），而且「显式硬拒 / 自动过滤」这个不对称本身就是对的：显式路径没有「下一个候选」可退，静默换成别的文件正是「解析成功、随后被悄悄替换」那一族。
- 焦点三里替代判据的设计是全批质量最高的部分：先整块剥注释再按词边界找属性位、给三条约束各配自测、并保留 driverEnabled/gateDriver 不被误命中的断言——我复核过 `\bdriver\b` 对 driverEnabled/gateDriver 确实不成立，那条自测是有效的。
- 计划 §11 第 2 问（显式指定裁决件会被放行）我判为可接受：显式路径本就能指向任意文件（含无关文档），只对 trivium.review.v1 设线是因为那一格会让「审的是对意见的意见」且留痕上看不出来；裁决件是 Driver 自己的产出、带 trivium.disposition.v1，点名它属明确意图。与其加一条拒，不如把「裁决件放行是有意的」写进计划 §6.9 的边界，别留给下一个审查员重新推一遍。
- override_reason 的写入方（EV-54）我核过两处会拿到同一个值：requests[c] 只在 review.ts:803 赋值一次，两个写点读的是同一表达式，且 isHeterogeneous(null) 返回 true（base.ts:1670-1673），模型未知时不会写出假的成因。
- driver 只校验「已登记」、放行但如实标注（预检一行 + notes 一条 + run.json 的 driver_enabled）这个取舍是显式的，并且三处留痕对得上；driver_enabled 可选、不加 if/then、不加 required 的理由（历史留痕要读得回）成立，run-meta.test.ts 的删除字段用例把它锁住了。

## 未覆盖范围（本侧盲区）

- 未实跑任何命令（沙箱只读）：npm run check、npm run typecheck、driver-wiring.test.ts 的锚点条数（我只按源码静态数了 = newRunMeta({ 等锚点）、gate-loop.test.ts 的现状都未经执行验证。
- 非缺省 Driver 下的闸门闭环未实测，与 CODEX-05 同源：我没有真起子进程跑「--driver <X> --critics claude → 落盘 → gate --check」。
- 编码/换行面我实测了 parseFrontMatter 的三种形态（用仓库自带 yaml 复现该函数）：LF 正常、CRLF 仍能读出 schema、带 BOM 返回 null。BOM 那格会让谓词 fail-open（不硬拒、不剔除），也同时会让 gate 的裁决件解析判 bad_front_matter——即同一份文件在别处会先响亮失败，且本仓工具链只写 LF 无 BOM 的 UTF-8（esbuild charset: 'utf8'），故未列为发现，只在此备案。
- 候选排序的后备键 b.fileName.localeCompare(a.fileName)（topic.ts:129 / topic-args.ts:637）依赖宿主 locale，理论上跨机器可能选中不同的同轮原稿；本批未改动该行，我也给不出可利用场景（文件名前缀是定宽日期），未列为发现。
- 未核 skills/ 侧 8 份 SKILL.md 的七步契约是否会因 --driver / latestRunMeta 的行为变化需要同步文案；只在三部 dual-review SKILL 的 gate 调用处 grep 过 --run-id（它们都不传，所以 pin 路径不是主路径、unpinned 的 latestRunMeta 才是）。
- report.ts / verify.ts / hooks.ts 的 driver 消费面按计划 §2.2 不在本步范围，我未展开评审（只在 CODEX-02 的缓解分析里读了 hooks.ts 的 checkArchiveIntegrity 与 checkRunManifests）。
- 未读另一位审查员的任何产出、plan/_meta/review-*.json 原文与归档内其它主题的审查件正文（背靠背要求）；也未读 .env.example 与 .trivium/。

## 实际查阅的项目文件

- `.reviews/M9-Driver旗标全链路与选侧收口/code/_meta/changes-20260918T165302Z.diff`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r3-claude.md`
- `.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-revised-claude.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/task.json`
- `.reviews/M9-Driver旗标全链路与选侧收口/code/_meta/run-20260918T165302Z.json`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-codex.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r2-codex.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r3-claude.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-revised-claude.md`
- `CLAUDE.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/cli.ts`
- `src/trivium/meta.ts`
- `src/trivium/critics.ts`
- `src/trivium/topic.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/archive.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/gate.ts`
- `src/trivium/preflight.ts`
- `src/trivium/types.ts`
- `src/trivium/state.ts`
- `src/trivium/approval.ts`
- `src/trivium/hooks.ts`
- `src/trivium/schemas.ts`
- `src/trivium/render.ts`
- `src/trivium/config.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/agents/registry.ts`
- `test/integration/driver-flag.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/unit/driver-wiring.test.ts`
- `test/unit/run-meta.test.ts`
- `skills/dual-critic/schema/run.v2.json`
- `skills/dual-critic/scripts/trivium.cjs`
- `/Users/chenzhenbo/.claude/skills/dual-critic/schema/review.v1.json`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":103,"project_reads":59}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
