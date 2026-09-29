# 取消与失联的凭据准入核CLI · 实施报告（EV-157）

- **日期**：2026-09-29
- **主题**：`取消与失联的凭据准入核CLI`；计划 `.reviews/取消与失联的凭据准入核CLI/plan/`（用户决策送审前已定 → 计划双审 run `20260928T231329Z`：gemini `approve`、codex / glm `approve-with-nits`，8 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`08396d2`（`main`，clean）；计划与本报告的行号取自该提交的源码
- **状态**：实施与验证完成；代码双审 r1（run `20260928T235013Z`）已应答并按接受项修订（§7）；verify 第 1 次因新用例夹具偶发红失败（§8），修夹具后第 2 次通过（§9）；未提交
- **evidence**：`doc/05_testing/evidence/cancel-wait-cli-admission-20260929/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §3.1 单一来源 | `status.ts`：`CliBlocker`；`cliGroupsConfirmedGone` 逐条判完、另返回 `blockers`（形状坏的在前，其余按记录顺序），`why` 由 `blockers` 按旧规则生成、逐字不变；`ScrubAdmission` / `scrubAdmission`（`workerConfirmedGone` 通过才问 CLI 一半）；`scrubHoldWhy` | U1、U2；M6、M7、M8、M9、M10、M11 |
| §3.2 `admitScrub` | `retention.ts`：改经 `scrubAdmission`，分档、`detail`（取 `why`）与次序不变；文档块改写 | U3、验收 A7；M12、M15、M16 |
| §3.3 到期整删 | `retention.ts` `pruneRunDirs`：到期分支先问 `cliGroupsConfirmedGone(status)`，挡住即落回未到期路径（`kept++` + 凭据准入 ⇒ `deferredCli`）；dry-run 不进 `removed` | U4、验收 A3 / A4；M3、M4 |
| §3.4 `--cancel` ③ | `run-protocol.ts` `cancelRun`：`scrubAdmission(readStatus, pid)`，`goneNow = adm.worker`（归档收尾只看工作进程一半）；未准入时 `warn(凭据副本未抹：${scrubHoldWhy(adm)}——留给会话启动清扫)` | U5、U5′、K3、K4、验收 A2 / A5；M1、M5、M13 |
| §3.5 `--wait` ② | `run-protocol.ts` `waitRun`：`scrubAdmission(meta0, fallbackPid)`，未准入时 `scrubNote` 用 `scrubHoldWhy`；`goneForArchive` 不动 | U6、U7、K1、K2、验收 A1 / A5；M2、M14 |
| §3.7 D3 | `cli.ts` :1924 那一行**逐字保留**，代码旁注明失实与 EV-164；`hooks.ts`、`run-protocol.ts` 两处注释改准 | 验收 A7（新旧输出逐字相同、那一行仍在） |
| §3.8 D6 | `CancelOptions.terminateCli`（缺省 `terminateRecordedCliGroups`），b / c 格两处调用经它 | U5 A 格 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 1 次（文档同步之前）**2253 / 2251 / 0 / 2**，一次全绿（起点 2241 → 新增 12 条：U1～U7 与 U5′ 共 8 条、K1～K4 共 4 条）；文档同步之后的读数见 §6 |
| 受影响套件单跑 | `scrub-admission` 8/8（约 1.2 s）；`gate-loop` 的 EV-157 K1～K4 共 4/4（K1 约 1.2 s、K2 约 0.9 s、K3 约 1.2 s、K4 约 0.9 s） |
| 源码侧变异（`mutation-spec.json`，16 条，锚点由 `gen-mutation-spec.mjs` 从源码截取并核对唯一） | **16 / 16**（`mutation-output.txt`，基线两个套件全绿）：M1 fail=2、M2 / M3 / M4 / M5 / M6 / M7 / M12 / M14 各 fail=1、M8 / M11 / M13 各 fail=2、M9 / M10 各 fail=7（`scrub-admission`）；M15 / M16 各 fail=1（既有 `retention` 的 EV-154 U14） |
| 失败用例名与文案（`mutation-names.mjs`，16 条全跑） | 全部红在目标用例的目标断言上（`mutation-names-output.json`）：M1「格 A：载体应在」；M5「格 A：run.json」；M11「worker 一半未过时逐字是 worker.why」；M12「detail 逐字是 why」；M13「格 A：告警要带侧、组号与成因」；M3「dry-run 与真跑同判据」；M15 / M16 红在 EV-154 U14「判不了…与记录读不懂…都不抹」。**没有「用例前提」一类的前置失败** |
| 零配额验收（`acceptance.mjs`，新旧两份构建，旧 = `08396d2`，不叠加任何文件） | **10 / 10**（`acceptance-readout.json`、`acceptance-output.txt`）；第 1 次 9 / 10，见 §3.1，读数留 `.r0` |
| `doctor --selftest`（新构建 + `TRIVIUM_ASSET_ROOT`，验收 A9） | **14 / 14** |
| 残留进程 | 每次跑完进程表里没有带 `trivium-ut-scrub-adm`、`trivium-stub-cli`、`review --worker` 的进程（验收读数 `leftover_groups: []`） |
| 环境 | Node v25.2.1，macOS |

验收各格读数：

| 格 | 读数 |
| :--- | :--- |
| 构建 | 新 bundle sha256 `ea555ddc19f1…`，旧 `bedcff8c449b…`，两者不同；桩相对 `08396d2` 无 diff |
| A1 `--wait` | 新：载体在、两组各 2 个成员（不结束进程）、status.json 两侧记录原样留存、正文按两侧带组号；旧：载体已抹。归一化后新有旧无 1 行（「凭据副本未抹：工作进程 〈N〉 已不存在，但审查员 CLI 未确认结束——…」），旧有新无 0 行 |
| A2 `--cancel`（判不了） | 新：载体在、两组各 2（不发信号）；旧：载体已抹；run.json 新旧都 `cancelled`；新有旧无 1 行、旧有新无 0 行 |
| A3 到期整删 | 新：会话启动 Hook 后目录在、载体在；旧：目录已删。新有旧无恰为第四格那一行，旧有新无恰为「已清理 1 个超过 30 天的运行目录」，其余 0 / 0 |
| A4 | 新：`--wait` 与 `--cancel` 之后第一次会话启动清扫仍挡住，结束两组后即抹；到期目录在两组结束后被删 |
| A5 | K4（`--cancel` 按记录结束之后）退出码 0/0、载体都已抹、差异 0 行；K2（`--wait` 之前两组已结束）退出码 1/1、载体都已抹、差异 0 行 |
| A6 | `hang` 与 `hang_cli` 常态 `--cancel` 退出码 0/0、差异 0 行；`hang_cli sleepS:1` 跑完退出码 75/75、差异 0 行 |
| A7 `trivium scrub` | CLI 仍活：退出码 0/0、载体都在、差异 0 行；CLI 结束后：退出码 0/0、载体都已抹、差异 0 行；D3 那一行逐字保留 |
| A8 | A1 `--wait` 退出码新旧都是 1；A2 `--cancel` 新旧都是 0 |
| A9 | `doctor --selftest` 退 0、14/14 |

## 3. 偏离与如实登记

### 3.1 验收第 1 次 9 / 10：A6 的判据写错

r0（`acceptance-output.r0.txt`）A6 那一格判失败：`hang_cli sleepS:1` 跑完的退出码新旧都是 **75**（`STRICT_ABORT`），我在判据里写成了「必须退 0」。75 是桩的既定形态——`hang_cli` 睡满之后两侧以「桩 CLI 挂起未被取消（code=0 signal=null）」收场、判失败（上上主题 B7 也只看记录、不看退出码）。改为「新旧退出码相同」后重跑 10 / 10；新旧差异在 r0 里就是 0 行。行为读数没有变化，只是构造错误。

### 3.2 与 r2 文字的出入

- **U5′ 另起**：r2 U1 写「两侧都挡住时 `blockers` 两条」，另补一条 `--cancel` 两侧都挡住（判不了 + 读不懂）的用例，钉住告警一行逐侧列出、形状坏在前。
- **B 格两种形态都跑**：`gone`（起、结束、确认组空之后用它的组号）与 `reused`（真实组 + 错配启动时刻），U1～U6 都含两者。
- **变异多两条**：M13 / M14（告警与说明退回 `worker.why`）直接钉「按事实告警」；M15 / M16 与 M9 / M10 同锚点、期望既有 `retention` 套件，证明 EV-154 U14 对同一判据也咬得住。
- **`run_dir_days: 0` 时不问 CLI**：r2 U4 列了这一格，实施时没有单独断言（整删分支在 `days > 0` 之内，没有可观测的差别）；由代码结构保证。

### 3.3 只按代码论证、没有用例直接钉住的格

- **a 格里处理器看门狗到点而 CLI 未结束**（`--cancel` 不经按记录结束、准入被挡住）：需要一个在 SIGKILL 之下不死的进程，零配额造不出；准入判据与 U5 A 格（注入「未确认退出」）同一处代码。
- **两次判定之间 CLI 恰好结束**（到期整删被挡下、凭据准入放行）：无害（这一轮抹副本、下一轮删目录），无用例。
- **真实厂商 CLI**：未实测（用户决策不花配额）；桩是 `sh` + `sleep`。

## 4. 文档同步

| 文件 | 落点 |
| :--- | :--- |
| 主设计 → v1.3.58 | 当前版本行；「审查员 CLI 进程组记录」段：三处准入经 `scrubAdmission` 同源、到期整删另问同一个 CLI 一半，「读不懂 ⇒ 或等整删」改准并注明 EV-164，如实保留清单更新（EV-157 已修、EV-163 暂缓）；10.5 凭据行的准入句；变更记录 v1.3.58 行 |
| LLD → v1.1.16 | 版本行与变更说明；`waitRun` 判失联一段的凭据准入；4.2 `cancelRun` 两处引述块；已知缺口表：原「`--cancel` / `--wait` 自己的凭据准入与到期整删不核审查员 CLI」一行改为已解决，新增 EV-163、EV-164 两行 |
| MANUAL → v1.0.16 | 版本行；场景 4 引述块：「读不懂」出口只有改回 null、`trivium scrub` 提示那半句不成立（EV-164），`--cancel` / `--wait` 在 CLI 仍在时不抹、告警长什么样、留给会话启动清扫 |
| PROTOCOL | `review --start / --wait / --status / --cancel` 行末补「凭据副本的准入」一句 |
| BACKLOG | EV-157 done；新登 EV-163（到期整删的工作进程一半，暂缓）、EV-164（`trivium scrub` 提示半句失实，待用户定）；EV-38 / EV-154 的去向注记补「已修」 |
| PRD | 核后不改：对凭据只有 NFR-04「归档与送审材料不得写入凭据」、对 `--cancel` 只有 FR-24「记 `cancelled`」，本主题不动需求面与判据 |
| RUNBOOK、`cli.ts` :327 帮助、MANUAL :374 | r1 时判「不改、仍成立」——**这个结论错了**，代码双审 r1 CODEX-04 指出后更正，见 §7 |
| run.v2 schema、skill 与入口资产、本仓根 `CLAUDE.md` | 不改 |

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `gen-mutation-spec.mjs` → `mutation-spec.json`、`mutation-output.txt` | 源码侧变异规格生成、锚点唯一性核对与结果 |
| `mutation-names.mjs`（拷自 `cli-pgroup-record-20260928/`）、`mutation-names-output.json` | 失败用例名与首行文案（16 条全跑） |
| `acceptance.mjs`、`acceptance-readout.json`、`acceptance-output.txt`（第 1 次 `.r0`） | 零配额验收 A1～A9 与新旧构建 |
| `check-1.txt` … | 各次全量检查的摘要 |

## 6. 文档同步之后的全量

第 2 次（文档同步与本报告初稿之后）：**2253 / 2251 / 0 / 2**，一次全绿（`check-2.txt`）。两次都没有出现 EV-149 / EV-153 那两条偶发红。

## 7. 代码双审 r1（run `20260928T235013Z`）与修订

三侧：gemini `approve`（零意见）；glm `approve`（零意见）；codex **解析回退**——原文是完整的结论件（自报 `approve-with-nits`，次要 4、吹毛求疵 3），编排器没能从嵌套围栏里取出，闸门按两个回退单元 CODEX-F01 / CODEX-F02 校验，七条意见的逐条裁决写在应答件表外 §2，全部接受（CODEX-01 取审查员的备选方案）。命令 A 不设人工闸门，应答后直接按接受项修订。应答件 `.reviews/取消与失联的凭据准入核CLI/code/2026-09-29-取消与失联的凭据准入核CLI-response-claude.md`，`gate --check` 通过。

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 准入只看组长，与同一次调用里的 `membersLeft` 口径分叉 | **不改判据**（改则违背「准入同源、`admitScrub` 行为不变」，且「组长已退、组员仍在」是 EV-154 决策 4 如实保留的格）；`settledCliSides` 与挂载点 ③ 的注释写明有意分叉；LLD `cancelRun` 引述块与已知缺口表；BACKLOG 新登 **EV-165**（待用户定） | 文档与注释 |
| CODEX-02 `--wait` 报「CLI 仍在」却不给出口 | `waitRun` 在阻挡项里有判「仍在」的组时另加一行「其中仍在的审查员 CLI 可用 trivium review --cancel 〈run_id〉 按记录结束（本命令不结束任何进程）；结束之后下一次会话启动清扫会重判，放行即抹副本」；判不了 / 读不懂时不加（`--cancel` 也不对它们发信号）；不新增结束进程的动作 | U6（A 格逐字、C / D 格没有）、K1、验收 A1（允许差异改为两行）；变异 M17（恒不出）/ M18（对判不了也出） |
| CODEX-03 不抹之后孤儿 CLI 继续用凭据烧配额，未登记 | BACKLOG EV-157 done 注记与 LLD 已知缺口表补「残余」；MANUAL 场景 4 补半句 | 文档 |
| CODEX-04 「副本会一直躺到整删」三处与新行为矛盾 | **更正 r1 的判断**（报告 §4 与计划 r2 §3.7 说它们「仍成立」是错的：句子的内容就是「副本最迟被整删」，被 CLI 挡住的目录正是副本在盘、到期也不删的目录）：MANUAL :374、RUNBOOK :224、`retention.ts` :284 注释加限定；`cli.ts` :327 属 `trivium scrub --help`（冻结的输出面）逐字保留、代码旁注明，EV-164 登记面扩到它 | 验收 A7（`scrub` 输出新旧仍逐字相同） |
| CODEX-05 RUNBOOK 分档表缺第四格 | 补「因审查员 CLI 未动」一行（含到期被挡下的目录） | 文档 |
| CODEX-06 形状坏的措辞两份 | `cliGroupsConfirmedGone` 文档块写明有意（`why` 冻结旧文字、`detail` 逐侧单句），二者由 U1 逐字钉住 | 注释 |
| CODEX-07 夹具复制 | 新增 `test/helpers/run-ctx.ts`（`fakeCtx`、`captureStderr`），`scrub-admission` 与 `run-protocol` 两个测试文件都改为从它导入；`seedDeadRun` / `seedRun` 语义不同、各留一份并注明 | `run-protocol` 48/48、`scrub-admission` 8/8 |

修订后读数（修订前的规格与读数留 `.r1`）：

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 3 次（代码与文档修订之后、本节写入之前）**2253 / 2251 / 0 / 2**（`check-3.txt`，用例条数不变：只加断言与抽夹具）；第 4 次见 §8 |
| 受影响套件单跑 | `scrub-admission` 8/8、`run-protocol` 48/48、`gate-loop` EV-157 K1～K4 4/4 |
| 源码变异（`mutation-spec.json`，18 条：原 16 条 + M17 / M18） | **18 / 18**（`mutation-output.txt`）；原 16 条的 fail 数与 r1 逐条相同；M17 / M18 各 fail=1 |
| 失败用例名与文案（18 条全跑） | 全部红在目标断言上：M17 红在 U6 A 格出口句的逐字断言，M18 红在「格 C：没有判「仍在」的组，不给 --cancel 出口」；没有前置失败 |
| 零配额验收 | **10 / 10**（新 bundle sha256 `614c0c80f138…`，旧仍为 `bedcff8c449b…`）；A1 归一化后新有旧无 2 行（「凭据副本未抹」与 `--cancel` 出口），其余各格读数与 r1 相同 |
| `doctor --selftest` | **14 / 14**（验收 A9） |
| 残留进程 | 无 |

## 8. verify（出口）：第 1 次**失败**，修夹具后重跑见 §9

`trivium verify`（run `20260929T001536Z`，即第 4 次全量：`npm run typecheck`、`npm run build`、`npm test`）**退 1**：typecheck 与 build 通过，`npm test` **2253 / 2250 / 1 / 2**。
留痕 `.reviews/取消与失联的凭据准入核CLI/verify/2026-09-29-取消与失联的凭据准入核CLI-verify.md`。

- **红的一条**：本主题新增的 `scrub-admission` U1，文案「组 38186 应已空（用例前提）」`1 !== 0`，出自夹具 `goneGroup`（造 B 格 `gone` 形态：起一个组、SIGKILL、等组空）。
- **成因（当时的判断，§9 修正）**：`goneGroup` 在 SIGKILL 之后只等 40 × 25 ms = 1 s；判「组空」用的测试助手 `groupMemberCount`（`test/helpers/proc.ts`）按 `ps -axo pgid=` 数成员、**不排除僵尸**——组长 `sh` 由本进程回收，而组员 `sleep` 过继给 launchd 后以僵尸留在组里，要等 launchd 回收；全量并发负载下超过了 1 s。生产侧的 `processGroupMemberCount` 排除僵尸；被测判据 `judgeCliGroup` 判 `gone` 只看组长 `kill(pgid, 0)`，与此无关。
- **复核**：同一构建单跑 `scrub-admission` 连续 5 次均 8 / 8；前三次全量（2253 / 2251 / 0 / 2）都没出现。属本主题新用例的**构造性偶发红**，不是被测行为的回归；但它是本主题引入的，不能归到 EV-149 / EV-153 一类既有偶发红。
- **当时未修**：按用户要求 verify 之后即停；用户随后指示「修」，见 §9。

## 9. 修 `goneGroup` 夹具（用户指示「修」）与重跑

**第一版修法没修住**：按 §8 的建议把 `goneGroup` 改为「等组长不在、且只数非僵尸成员，预算 5 s」，单跑第 1 次就红了一条。用 4 路并发复跑 5 轮（20 份）抓到 1 份：`组 291 应已没有非僵尸成员（用例前提）`，`1 !== 0`，用时约 7.5 s——**组长已不在，而组号下的那个成员不是僵尸，等满 5 s 仍在**。所以 §8 的「只是僵尸没回收」不是全部成因。

**探针**（`probe-fork-race.mjs`，零配额、只对自己派生的组发信号）：验证「派生后按组 SIGKILL 时 `sh` 正在 fork，`sleep` 漏掉信号活下来」这一猜测——立刻发信号 600 次、派生后随机等 0～60 ms 再发 800 次（并发 8 与串行各半），**0 个活下来**，未复现。291 这么小说明那一刻 pid 刚回绕；那个成员是谁没能确定，如实保留。

**第二版修法**：`goneGroup` 改为**单进程组**——`node -e 'setTimeout(…)' 〈标记〉` 以 detached 派生，组长就是全部成员、没有子进程，按组 SIGKILL 后等它的 `'exit'`（由本进程回收）即确定结束；前提收窄为「组长已由本进程回收、启动时刻已取到」，**不再断言组空**。理由：被测的 `judgeCliGroup` 只看组长——组长不在判 `gone`，组号恰被别的进程占用判 `reused`，两者都放行，B 格的断言本来就不依赖组空；启动时刻为 null 时组号若被复用会判 `unverifiable`，所以把它钉成前提。其余格（A / Br / C 的活组）夹具不变。

| 项 | 读数 |
| :--- | :--- |
| `scrub-admission` 4 路并发 × 10 轮 | **40 / 40 份全绿**（第一版修法下 20 份红 1 份） |
| 源码变异（同一份 18 条规格） | **18 / 18**，fail 数与修夹具前逐条相同（修夹具前的读数留 `mutation-output.r2.txt`） |
| 残留进程 | 无 |
| verify（第 2 次，run `20260929T003106Z`） | **通过**：typecheck、build、`npm test` **2253 / 2251 / 0 / 2**（留痕 `.reviews/取消与失联的凭据准入核CLI/verify/2026-09-29-取消与失联的凭据准入核CLI-r2-verify.md`）；第 1 次的失败留痕原样保留 |
