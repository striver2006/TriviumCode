# REPORT：清扫帮助主句失实（EV-166）实施报告

> - **日期**：2026-09-29
> - **主题**：`清扫帮助主句失实`（命令 A，`/dual-run`）
> - **起点**：`48a7e4d`；计划 `.reviews/清扫帮助主句失实/plan/2026-09-29-清扫帮助主句失实-r2-claude.md`（计划双审第 1 轮 run `20260929T061215Z`：codex / glm `approve-with-nits`、gemini `approve`，8 条全接受）
> - **证据目录**：`doc/05_testing/evidence/scrub-help-main-clause-20260929/`
> - **范围**：走向 ①，只改文字——`trivium scrub --help` 动机句改写，同义失实句改准；判据、行为、`trivium scrub` 其余人读输出、`--json`、退出码、会话启动提示逐字不变；不花配额

## 0. 基线对账

- 起点 `48a7e4d` 的全量读数按「总 / 过 / 败 / 跳」为 **2269 / 2267 / 0 / 2**。上一主题报告 `REPORT_2026-09-29_orphan_cli_admission.md` :101、:170 写作「2267 / 2269 / 0 / 2」，是总与过的位置写倒了（同报告 :97-100 是「总 / 过」序；计划双审 CODEX-07 核出）。本报告一律按「总 / 过 / 败 / 跳」。
- 帮助行数的两个口径：`--help` 的 stdout 按 `\n` 切成 159 段（计划 §2.1 的「159 行」，含末尾空段）；去掉末尾换行后是 157 行（验收 B1 的 `lineCount`，与上一主题报告的 157 同口径）。新旧两个口径下行数都不变。

## 1. 逐条落地（按 r2 章节）

| r2 | 落地 |
| :--- | :--- |
| §2.1 帮助动机句（D1） | `cli.ts` :328 由「不再回到那个仓库时，副本会一直躺到 retention.run_dir_days 整删（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删）。这条命令补那一格。」改为「到期整删也只在它的会话启动时跑（记录里的审查员 CLI 仍在、判不了或读不懂时到期也不删）；不再回到那个仓库就没有任何自动清理，这条命令只补抹凭据。」——写法乙，显示宽度 151 → **149**（口径：East Asian Width 的 W / F 记 2、其余含「…」记 1），仍一行，USAGE 最宽行仍为 151（preflight 行） |
| §2.2 F2 | `cli.ts` :183 注释改为 EV-164 限定、EV-166 改写主句的说明 |
| §2.2 F3 | `retention.ts` `scrubAllRunRoot` 文档块「为什么需要它」一段改准（到期整删也只在本项目会话启动时跑，不回去就没有任何自动清理；此前「躺到整删」失实，EV-166），末尾补「本函数只补抹凭据那一格，目录仍不删」 |
| §2.2 F4 / F5 | MANUAL :373-377、RUNBOOK :223-228 改准；两处都写明「回去了也要装了入口、会话启动 Hook 真的跑了」（r2 CODEX-05）；RUNBOOK 另补「桶名由绝对路径派生，仓库挪位置旧桶同样没人清」（D4）；MANUAL 给「要清掉目录，人工确认后自己删」，不给整桶删除命令 |
| §2.2 MANUAL :639 | 历史叙述句尾补指向 v1.0.19 的改写，原句不改 |
| §2.4 C6（r2 CODEX-06） | `orchestrator-logs-parity.test.ts` :45 失败文案「会随它们躺到整删」改为「会原样留在盘上、不会被脱敏」，上方加一行注释说明；:13 历史叙述不改 |
| §2.4 C1～C5 | 核后不改（理由见 r2 §2.4 表；三侧复核同意） |
| §4.1 单测 | `MOTIVE` 换新句、新增 `EV164_MOTIVE`；T5 期望更新并加「EV-164 版整句不再出现」；新增 **T8**（全文无同时含「躺到」「整删」的行；动机句三段事实要素；动机句宽度 ≤ 其余各行最大宽度，测试内 `displayWidth` 注明口径） |
| §4.2 源码变异 | 规格 11 条由 `gen-mutation-spec.mjs` 从源码截锚点（新动机句整行按行截取，不手抄）、逐条核唯一 |
| §4.3 零配额验收 | `acceptance.mjs` B0′、B0～B11，旧构建 `48a7e4d` |
| §9 S5a / S5b（r2 CODEX-04） | 先落 `cli.ts` 新句 + T5 / T8，单跑 8 / 8、帮助新旧对照与宽度复核后定稿，再做注释、文档、变异、验收、全量 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| 新单测单跑（S5a） | `scrub-output-text` **8 / 8**（T1～T8） |
| `scrub-output-text` + `orchestrator-logs-parity` 单跑（S5b，改完契约测试文案后） | **11 / 11** |
| 源码变异（`mutation-spec.json`，11 条） | **11 / 11** 咬住（`mutation-output.txt`，装置退 0）；fail 数 M1 2、M2 2、M3 2、M4 2、M5 1、M6 1、M7 1、M8 2、M9 1、M10 2、M11 1 |
| 失败用例名与文案（11 条全跑，`mutation-names-output.json`） | 全部红在目标断言上，没有前置失败：M1 / M3 → T5 逐字 + T8「不该再有同时含『躺到』与『整删』的行」；M2 → T5 + T8「动机句应含『仍在、判不了或读不懂时到期也不删』」；M4 → T5 + T8「动机句应含『到期整删也只在它的会话启动时跑』」（计划只列 T5，拆行后 T8 也红，更强）；M5 / M6 → T5；M7 → T8；M8 → T1、T2；M9 → T7；M10 → T5 + T8「动机句宽 209，不应超过…最大宽度 151」；M11 → 契约测试，首行文案正是新文案「…会原样留在盘上、不会被脱敏：」 |
| 零配额验收（旧构建 `48a7e4d`） | **13 / 13**，第一次即全过（`acceptance-output.txt`、`acceptance-readout.json`）；新 bundle sha256 `cd338d7795dc…`、旧 `ea75c5ee3a4b…`，桩相对基线无 diff。B0′ 8 份夹具的运行根都在 mkdtemp 之下（首次真跑前以 `--dry-run` 读出）；B1 四条帮助路由各自差恰为动机句一对、行数 157 / 157、最宽 151 / 151、动机句宽 149；B2～B5（`scrub` 真跑 / `--dry-run` / 判不了 / 读不懂）、B6（`--json`，15 个键）、B7（CLI 结束后）、B8（会话启动提示）、B9（空运行根）差全部为空；B10 12 格退出码新旧逐格相同 |
| `doctor --selftest` | **14 / 14**（验收 B11） |
| `npm run check`（第 1 次，文档同步之后） | **2270 / 2268 / 0 / 2**（`check-1.txt`，退 0，约 266 s；基线 2269 / 2267 / 0 / 2，新增 T8 一条；`orchestrator-logs-parity` 只改失败文案，条数不变） |
| 残留进程 | 无（变异、验收、全量之后各核一次；验收自报残留进程组 `[]`） |

## 3. 偏离与如实登记

- M4 的应红比计划多一条（T8），见上表；不是偏离判据，而是 T8 的语义要素断言对拆行同样敏感。
- 计划 §2.1 写「159 行」是按 `\n` 切段的口径，验收按去掉末尾换行的 157 行计，见 §0。
- T8 宽度断言的耦合面（代码双审 r1 CODEX-01）：上界取「帮助其余各行的最大宽度」，是用户约束的直译，不钉 151；别处写宽不会让它红，只在动机句变宽或现有最宽行（preflight 行）被改窄到 149 以下时红，后者与本句无关，所以失败文案带出最宽行原文。验收 B1 的「新旧最宽行相等」只在一次性证据脚本里，不进 CI。
- 变异装置、`mutation-names`、验收、全量都是依次跑的，互不并发，且都在代码双审发起之前（r1）或应答之后（修订后）跑，审查进行期间没有跑任何会改 `src/` 或 bundle 的脚本（代码双审 r1 CODEX-04 的驳回依据）。

## 4. 文档同步

| 文档 | 处置 |
| :--- | :--- |
| 主设计 | v1.3.61；§10.5「清扫有两个入口」补「到期整删同样只在这里跑——不再回到某个仓库，它的桶就不会有任何自动清理」；§13.1 `run_dir_days` 行内注释补同一事实；:1477 「帮助里的动机句同样加了限定（EV-164）」后补主句改写的指向；变更记录新增 v1.3.61 行 |
| LLD | v1.1.19；已知缺口表 EV-164 那一行补「主句已改（EV-166，v1.1.19）」；变更说明 |
| MANUAL | v1.0.19；F4 与 :639 补指向（§1） |
| PROTOCOL | `scrub` 行那句帮助引文改为「帮助动机句带同样的限定（v1.3.59，EV-164），且自 v1.3.61 起写明到期整删与凭据抹除都只在该仓库自己的会话启动时跑、不再回到那个仓库就没有任何自动清理（EV-166）」 |
| RUNBOOK | F5（§1） |
| BACKLOG | EV-166 → done；EV-33 行首加「2026-09-29 注」指向 EV-166，原文不改写；EV-164 范围句补「EV-166 已改写主句」；EV-167 加读数注记（主设计 v1.3.61 / LLD v1.1.19 / MANUAL v1.0.19，设计 README 仍写旧值，仍暂缓） |
| PRD | 核：不含 `trivium scrub`、`run_dir_days`、`retention`，**不改** |

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `gen-mutation-spec.mjs` / `mutation-spec.json` | 变异规格生成脚本与规格（11 条） |
| `mutation-output.txt` | 变异装置读数 |
| `mutation-names.mjs` / `mutation-names-output.json` | 逐条失败用例名与首行文案（照搬上一主题脚本，正文未改） |
| `acceptance.mjs` / `acceptance-output.txt` / `acceptance-readout.json` | 零配额验收脚本、输出与读数 |
| `check-1.txt` / `check-2.txt` | 全量检查输出（代码双审前 / 修订后） |
| `u15-recheck.txt` / `probe-u15-dead-group.mjs` / `probe-u15-dead-group-output.json` / `probe-u15-dead-group-output-with-live.json` | verify 失败那条（EV-154 U15 不发信号的格）的单跑复核与零配额探针，见 §7 |
| `u15-fix-recheck.txt` / `ev170-mutation-spec.json` / `ev170-mutation-output.txt` / `ev170-mutation-*.e1-equivalent.*` | EV-170 修后的压力复核与变异（E1 等价变异原样保留），见 §8 |
| `mutation-spec.r1.json` / `mutation-output.r1.txt` / `mutation-names-output.r1.json` / `acceptance-output.r1.txt` / `acceptance-readout.r1.json` | 代码双审之前（r1）的规格与读数，原样保留 |

## 6. 代码双审 r1（run `20260929T064042Z`）与修订

三侧：gemini `approve`（零意见）；glm `approve-with-nits`（吹毛求疵 1）；codex `approve-with-nits`（重要 1、次要 4、吹毛求疵 1）。7 条：接受 5、驳回 2、暂缓 0。
应答件 `.reviews/清扫帮助主句失实/code/2026-09-29-清扫帮助主句失实-response-claude.md`，`gate --check` 通过。命令 A 不设人工闸门，应答后直接按接受项修订。

| 意见 | 裁决与修订 |
| :--- | :--- |
| GLM-01 PROTOCOL 把「凭据抹除」也写成「只在会话启动时跑」，丢了「遗留副本」论域 | 接受：PROTOCOL :369 改为「写明到期整删只在该仓库自己的会话启动时跑、不再回到那个仓库就没有任何自动清理」；`cli.ts` :183 注释同形的说法收窄为「遗留副本的凭据抹除与到期整删…」 |
| CODEX-01 T8 / B1 把帮助全局最宽行当上界 | 接受（部分）：核实「别处写宽会让 T8 红」不成立（上界只会变大）；耦合面是「最宽行被改窄」且失败文案不报是哪一行——T8 失败文案带出最宽行原文，上方注释写明取舍；不改成绝对常量（用户约束本身是相对的） |
| CODEX-02 帮助与手册没带 `run_dir_days <= 0` 关闭整删那一档 | 接受：MANUAL :374、RUNBOOK :223 补一句；`cli.ts` :183 注释登记「帮助只讲自动入口」的有意省略 |
| CODEX-03 `displayWidth` 的区段表未写前提 | 接受：单测与验收两份注释写明只覆盖当前帮助用到的码位、新增 emoji / 变体选择符前先补表；不提到 `test/helpers/` 共用（证据脚本要能脱离测试构建单独跑） |
| CODEX-04 证据脚本改业务源码无互斥 | 驳回：脚本是上一主题逐字拷贝，用法行已写明前置；本轮依次跑、与审查无并发（§3）；加锁是改跨主题装置，超出只改文字的主题 |
| CODEX-05 验收 `pidGone` 用 `kill(pid,0)`、中断不收尾、成员数不排除僵尸 | 驳回：三处出错方向都是 fail-closed（PID 复用 ⇒ `pidGone` 假 ⇒ B2 红；僵尸 ⇒ 成员数不归零 ⇒ B7 红）；「残留进程：无」只描述完整跑完的那一趟 |
| CODEX-06 M4 规格描述只写 T5 | 接受：`desc` 改为「⇒ T5、T8」，重新生成 `mutation-spec.json`（与 r1 规格只差这一处描述） |

修订后读数（修订前留 `.r1`）：

| 项 | 读数 |
| :--- | :--- |
| 单跑 `scrub-output-text` + `orchestrator-logs-parity` | **11 / 11** |
| 源码变异（11 条） | **11 / 11**（`mutation-output.txt`，装置退 0）；fail 数与 r1 逐条相同 |
| 失败用例名与文案（11 条全跑） | 全部红在目标断言上；M10 的失败文案现在带出最宽行原文（「…最大宽度 151（最宽行：  trivium preflight --stage …）」）；M11 仍为新失败文案 |
| 零配额验收 | **13 / 13**（`acceptance-output.txt`），各格读数与 r1 相同；新 bundle sha256 `fffea87b90c3…`（r1 为 `cd338d7795dc…`，修订改了 `cli.ts` 注释，差异来源未逐字节核），旧仍为 `ea75c5ee3a4b…` |
| `doctor --selftest` | **14 / 14**（验收 B11） |
| `npm run check`（第 2 次，修订之后） | **2270 / 2268 / 0 / 2**（`check-2.txt`，退 0，约 288 s；与第 1 次相同） |
| 残留进程 | 无（变异、验收、全量之后各核一次） |

## 7. verify（出口）

`trivium verify`（run `20260929T070000Z`）**失败（退 1）**：`npm run typecheck`、`npm run build` 退 0；`npm test` 退 1，**2270 / 2267 / 1 / 2**，用时约 267 s。
留痕 `.reviews/清扫帮助主句失实/verify/2026-09-29-清扫帮助主句失实-verify.md`。

红的是 `test/unit/cli-group-record.test.ts` 的「EV-154 U15（不发信号的格）：reused、unverifiable、形状坏、已退出的记录一个信号都不发」，
失败文案「不该发任何信号：[[37629,"SIGTERM"],[37629,"SIGKILL"]]」。与本主题无关的依据：

- 改动面不相交：本主题只改 `cli.ts` 一行帮助字符串与两行注释、`retention.ts` 文档块、两个测试文件（`scrub-output-text`、`orchestrator-logs-parity` 的失败文案）与文档；`status.ts`、`util/exec.ts`、`cli-group-record.test.ts` 均未改（`git diff --stat`）。
- 本主题之前的两次全量（`check-1.txt`、`check-2.txt`）都是 2270 / 2268 / 0 / 2，这条都过了。
- 单跑复核（`u15-recheck.txt`）：串行 20 次红 1、8 路并发 40 份红 1——单跑也会红，是偶发。
- 零配额探针（`probe-u15-dead-group.mjs`，输出 `probe-u15-dead-group-output.json` / `-with-live.json`）：复现用例「已退出」那一格的时序（`sh -c 'sleep 600; : "$0"'` 按组 SIGKILL、只等 sh 退出即判），孤立 300 次全判 `gone`；带一个同时存在的活组 1000 次，**1 次判 `orphaned`**（「组长已退出，组里还有 1 个成员」）。EV-165（`48a7e4d`）起这种状态由 `gone` 改判 `orphaned`，`terminateRecordedCliGroups` 于是发信号——用例的前提「这一组已结束」偶尔不成立。成因未定（疑为按组 SIGKILL 的瞬间 sh 正在派生子进程），未逐字节核实。

处置：按用户「跑完 verify 就停」，**没有重跑 verify、没有改这条用例**（改它超出只做 EV-166 的范围）；BACKLOG 新登 **EV-170**（暂缓，待用户定）。
它不在记忆里的已知偶发红清单（lock-cross-process、state.test 并发 setGate）之内，是新的一条。之后核对：无残留进程。

未做（按用户要求停在 verify）：提交、推送、审批、重装。本仓安装副本仍是 `48a7e4d` 的构建（代码双审运行时编排器已提示「安装副本不是当前工作树构建的」），重装由用户在终端执行。

## 8. EV-170 修复（用户 2026-09-29 指示「先修 EV-170 那条用例」）

**改法**（只改测试，生产代码不动）：`test/unit/cli-group-record.test.ts` 新增辅助 `endGroup(g)`——`killGroup` 按组 SIGKILL、等组长 exit，
再用与生产判据同源的 `processGroupMemberCount`（排除僵尸；满载下孤儿僵尸回收慢，不能拿含僵尸的计数当前提）轮询到组号下没有成员，
漏网的成员补一次 SIGKILL，最后断言「组已清空」为用例前提（5 s 内不清空就红在前提上，而不是红在被测断言上）。
「EV-154 U15（不发信号的格）」的「已退出」一格与同构造的「EV-154 U13」（杀组后断言 `judgeCliGroup` 为 `gone`）都改用它；
`scrub-output-text` 的 `stop()` 也是「杀组、等 exit」，但它只做收尾、不当作判据前提，不改。

**这次修复没有走代码双审**：本主题的代码双审（run `20260929T064042Z`）在修复之前已经结束；要不要为这一处测试改动补一轮，由用户定。

| 项 | 读数 |
| :--- | :--- |
| 整文件单跑 `cli-group-record` | 9 / 9 |
| 压力复核（`u15-fix-recheck.txt`） | U13 + U15 不发信号格：串行 **200 / 200**、8 路并发 × 10 轮 **80 / 80**（修前单条约 1/20、1/40 红，280 次零红的概率不到千分之一） |
| 变异（`ev170-mutation-spec.json`，装置退 0） | **E3**（`terminateRecordedCliGroups` 对 `unverifiable` 也走发信号路径）咬住 fail=1；**E2**（组长不在时成员数 0 也判 `orphaned`）咬住 fail=4。首版的 **E1**（对 `gone` 也走发信号路径）没红——是等价变异：`terminateProcessGroup` 发信号前先问 `isGone()`，已不在的组一个信号都不会发；读数原样留在 `ev170-mutation-output.e1-equivalent.txt` |
| 残留进程 | 无 |
| verify（第 2 次，run `20260929T073425Z`） | **通过**：typecheck、build、`npm test` 三条都退 0，**2270 / 2268 / 0 / 2**，用时约 288 s；留痕 `.reviews/清扫帮助主句失实/verify/2026-09-29-清扫帮助主句失实-r2-verify.md`。之后核对：无残留进程 |
