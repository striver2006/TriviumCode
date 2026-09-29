# REPORT：组长已退组员仍在的准入（EV-165）实施报告

> - **日期**：2026-09-29
> - **主题**：`组长已退组员仍在的准入`（命令 A，`/dual-run`）
> - **起点**：`eeceeaa`；计划 `.reviews/组长已退组员仍在的准入/plan/2026-09-29-组长已退组员仍在的准入-r2-claude.md`（计划双审第 1 轮
>   run `20260929T025220Z`，codex/gemini/glm 三侧 `request-changes`，15 条含 1 阻断、6 重要、6 次要、1 吹毛求疵，**全部接受**）
> - **证据目录**：`doc/05_testing/evidence/orphan-cli-admission-20260929/`
> - **范围**：只解决 BACKLOG EV-165；判据单一来源，只改 `judgeCliGroup` 与 `cliGroupsConfirmedGone`；`--cancel` 对孤儿组也按组
>   结束（撤回 EV-154 用户决策 4 的一半）；`--wait` 与会话启动清扫仍不结束任何进程；不新增归档字段形状；不花配额

## 1. 计划双审：15 条全接受

计划 r1 送审后三侧给出 15 条意见，**全部接受**，其中最关键的三类问题：

1. **AGY-01（阻断）≡ CODEX-05**：r1 的 `judgeCliGroup` 只在 `!alive` 分支接了成员计数判断，`processStartTime` 复检发现组长
   已死那条路径（`now===null` 分支）仍然照旧直接返回 `gone`，绕开了新判据。这是真实的功能性漏洞。修法：抽出 `leaderGone`
   闭包，两个来源共用同一判据。
2. **CODEX-01≡CODEX-02≡AGY-02≡GLM-03（重要/次要）**：r1 计划的集成测试前提（worker 存活时直接杀 CLI 组长）不成立——
   `run()` 的 `killTree` 跟踪面（`liveTrees`）只认自己派生的**直接子进程**是否退出，worker 存活期间组长一退出就会被
   `syncCliRecords` 把该侧记录清成 `null`，孤儿态根本留不下来。修法：先 `killWorker`、再单 pid SIGKILL 组长。
3. **CODEX-03≡AGY-04≡GLM-04（重要/次要/吹毛求疵）**：r1 §2.3 声称孤儿组终止失败时复用既有「组长已退出，组里还有 N 个
   成员，未对它们发信号」告警、且「语义完全贴合」——这个论证在新判据下不成立（该分支基本不可达，且「未对它们发信号」
   在已发过信号后是失实的）。修法：删除该错误论证，不新增文案（既有「未能确认退出」分支已经准确覆盖这一格）。

裁决件：`.reviews/组长已退组员仍在的准入/plan/2026-09-29-组长已退组员仍在的准入-revised-claude.md`；`gate --check` 通过。
修订稿 r2 落地了全部 15 条，另在 §4 新增两项超范围暂缓（见 §6）。

## 2. 判据设计（落地即 r2 §1～§2，未偏离）

- `CliGroupVerdict` 新增 `orphaned`（组长不在、组号下有非僵尸成员）/ `orphan_unverifiable`（组长不在、成员计数取不到）。
- `judgeCliGroup`（`status.ts`）新增可选 `o.memberCountOf` / `o.out` 参数；抽出 `leaderGone` 闭包，`!alive` 分支与
  `now===null` 复检确认组长已死的分支共用它。
- `cliGroupsConfirmedGone` 新增两个分支生成阻挡项（`orphan_unverifiable` 复用 `kind:'unverifiable'`）；**实施期新增**
  （计划未列，r2 送审后为补齐 GLM-04/CODEX-03 遗留的测试可达性缺口而加）：新增可选第二参数把 `memberCountOf` 穿透给
  `judgeCliGroup`，只为单测零配额构造 `orphan_unverifiable`，生产路径不传。
- `terminateRecordedCliGroups`（`run-protocol.ts`）对判 `alive` 或 `orphaned` 的组都发信号（同一条 `isGone`：只认
  `gone`/`reused`）；`settledCliSides`、`--wait` 的 `--cancel` 出口提示同步纳入 `orphaned`。
- 四处既有消费方（会话启动清扫、`trivium scrub`、到期整删、`--wait` 判失联的准入本身）**零改动**：全部经
  `scrubAdmission` / `cliGroupsConfirmedGone` 自动继承新判据，验收 B1/B2/B4 逐条证实。

## 3. 测试

### 3.1 单元（`test/unit/scrub-admission.test.ts`、`test/unit/cli-group-record.test.ts`）

新增 U0（`judgeCliGroup` 三个新分支，含 `out` 出参与 `memberCountOf` 依赖注入）、U1′（`cliGroupsConfirmedGone` 的
`orphaned`/`orphan_unverifiable` 两格）、U3′（会话启动清扫/`trivium scrub`）、U4′（到期整删）、U5″（`--cancel` 结束
孤儿组之后照抹、记录清 null）、U6′（`--wait` 正文带精确成员数、出口对 `orphaned` 也给出）；既有 U1～U7 五格逐条重跑
未受影响。真实进程构造：`orphanedGroup`（`liveGroup` 起组、单 pid SIGKILL 组长、带上限轮询确认组员仍在）、
`orphanedThenEmptyGroup`（子进程短命、杀组长后等它自然退出到 0，不强行构造真实僵尸态）。

`cli-group-record.test.ts` 既有「EV-154 U15 变体」按新契约重写（AGY-03 核出的遗漏）：组长服从 SIGTERM、组员忽略 ⇒
旧契约「判 gone、停在 SIGTERM、如实数出遗留成员」不再成立，新契约是「判 orphaned、继续升级 SIGKILL、最终成员归零」。

### 3.2 集成（`test/integration/gate-loop.test.ts`，真实 bundle）

新增 K5（`--wait` 判失联）、K6（`--cancel`）：`startWithRecordedClis` 起两侧 `hang_cli` → `killWorker` → 对 `glm` 侧
单 pid SIGKILL 组长（`gemini` 侧保持存活作对照）→ 断言两侧分别的阻挡文案、出口提示、`--cancel` 按组结束组员之后照抹。
未新增桩选项（D4 采纳）：`hang_cli` 桩本来就是 `sh`（组长）+ `sleep`（子进程，同组）两层结构，单 pid SIGKILL 组长即可
构造孤儿组。

### 3.3 源码变异

`doc/05_testing/evidence/orphan-cli-admission-20260929/gen-mutation-spec.mjs` 从当前源码截 9 条锚点（`status.ts` 6 条、
`run-protocol.ts` 3 条），覆盖 `leaderGone` 的两个分支、`out` 赋值、`cliGroupsConfirmedGone` 的两个新分支、
`terminateRecordedCliGroups` 的入口条件、`settledCliSides` 的新析取项、`--wait` 出口条件；**9 / 9 全部咬住**。

**如实登记一处未纳入变异规格**（不夸大覆盖）：
- `judgeCliGroup` 的 `now===null` 复检分支里 `return leaderGone()`那一行——需要真实构造「`processStartTime` 瞬时失败、
  复检又确认组长已死」这个时序窗口，零配额下无法可靠构造（现有 `memberCountOf` 依赖注入只覆盖 `!alive` 分支）；此行为
  由 AGY-01（计划双审）的问题描述与代码审查确认正确，未被专门用例钉住。

**更正（代码双审 r1 GLM-02 核出，原文如下这段论证不成立）**：`reportRecordedCliGroups` 里 `orphan_unverifiable` 的 warn
文案原以为「该函数未导出，只能通过 `cancelRun` 的完整链路间接触发，而构造一个『真实孤儿组 + 真实 ps 失败』的组合超出
零配额可行范围」——这个论证是错的：不需要真实孤儿组也不需要真实 ps 失败，既有 `test/unit/scrub-admission.test.ts` 的
U5 A 格早就用 `CancelOptions.terminateCli` 注入一个伪造的 `RecordedCliOutcome` 走完整 `cancelRun` 链路触发过同一个
`reportRecordedCliGroups`。而这条文案已被 `MANUAL_user.md` v1.0.18 逐字引用、是用户可见的契约面。已按同样手法补
`test/unit/scrub-admission.test.ts` 的「EV-165 U5‴」用例，逐字钉住这条 warn 文案。

### 3.4 零配额验收（新旧构建对照，旧构建基线 `eeceeaa`）

`doc/05_testing/evidence/orphan-cli-admission-20260929/acceptance.mjs`，B1～B6，**7 / 7 通过**，两次独立运行读数一致，
残留进程组 `[]`：

| 项 | 新构建 | 旧构建 |
| :--- | :--- | :--- |
| B1 会话启动清扫 | 孤儿组挡住、不抹，`ctx1` 带「组长已退出，组里还有 1 个成员」；组结束后再清扫即抹 | 放行、照抹 |
| B2 到期整删（31 天） | 目录在（H 格挡住）；组结束后再整删即删 | 目录已删 |
| B3 `--cancel` | 按组结束孤儿组组员（成员数 0）之后照抹 | 组长已退直接判 `gone` 放行抹除，**组员遗留继续跑**（旧版问题现状） |
| B4 常态回归（两组都活 / 两组自然结束） | 退出码与输出逐字相同 | 同左 |
| B5 `--wait` 判失联 | 退出码 1、不抹、正文带精确成员数「组里还有 1 个成员」 | 退出码 1、两侧判 `gone` 照抹 |
| B6 doctor 自检 | 14 / 14 | — |

## 4. `npm run check` 读数（多次，逐次递增新增用例数）

| 阶段 | 读数 |
| :--- | :--- |
| 生产代码改动 + `cli-group-record` U15 变体重写（未加 H/Hz 新用例前） | 2260 / 2258 / 0 / 2 |
| 加完 U0/U1′/U3′/U4′/U5″（未加 K5/K6、U6′ 前） | 2265 / 2263 / 0 / 2 |
| 加完 K5/K6（未加 U6′、未做变异前） | 2267 / 2265 / 0 / 2 |
| 加完 U6′、`cliGroupsConfirmedGone` 测试用 DI 参数、源码变异与文档同步之后（代码双审前） | 2268 / 2266 / 0 / 2 |
| 代码双审修订后（最终，见 §8） | **2267 / 2269 / 0 / 2** |

`dist/test` 每次改动 `src/*.ts` 或 `test/*.ts` 后均用 `node scripts/build.mjs --tests-only` 重编（教训：`npm run build`
只重建 bundle，不重建 `dist/test`，首次诊断脚本因此拿到过旧代码，已按坑清单核对更正）。

## 5. 与用户决策的对照

- 只做 EV-165；EV-163/161/162/166/167/EV-159 第二形态均未并入。
- 组员全僵尸视同已结束：`Hz` 格（真实构造，短命子进程自然退出到 0）验证。
- 成员计数取不到视同判不了、按挡住处理：`orphan_unverifiable`，U0/U1′ 用 `memberCountOf` 依赖注入验证。
- `--cancel` 对孤儿组按组结束：U5″/K6/验收 B3 验证；宽限链与既有 `alive` 来源共用同一条 `terminateProcessGroup` 调用与
  `isGone` 判据（未新增常量）。
- `--wait` 与会话启动清扫仍不结束任何进程：K5/U6′/验收 B1/B5 逐条断言组员在检查前后成员数不变。
- status.json 形状、哨兵语义、`scrub` 子命令 JSON 字段均未改；新增告警与新成因之外的输出逐字不变（既有 U1～U7 五格、
  K1～K4、`cli-group-record.test.ts` 除 U15 变体外的用例全部重跑确认）。
- 不花配额做真实 CLI 实测：全部构造用 `sh`/`sleep`/`node -e` 等本地进程，`hang_cli` 桩。

## 6. 如实登记：两项超范围、暂缓（已登 BACKLOG）

- **EV-168**：worker 存活期间的自身子进程退出盲区。`liveTrees` 只跟踪直接子进程，对孙辈毫无感知——worker 活着时 CLI
  组长一退出，记录就被清成 `null`，`orphaned` 判据够不到「worker 仍在场」这一段。**不影响凭据安全**（五处准入都先判
  `workerConfirmedGone`，worker 活着时压根不会碰 CLI 一半），但意味着 worker 之后若也死了，这些孙辈会成为「记录里从未
  存在过」的进程，后续清扫意识不到它们。修法要改 `liveTrees` 的跟踪粒度（单 pid → 进程组），超出本轮范围。
- **EV-169**：`processGroupMemberCount` 的僵尸排除逻辑（`STAT` 列 `Z` 前缀过滤）没有专门测试——EV-154 遗留、非本轮
  引入。真实僵尸态在 macOS 上窗口短且不确定，本轮 `Hz` 格改用依赖注入覆盖「成员数=0」这个契约点在 `judgeCliGroup` 里
  的处理，绕开了这个函数本身。

## 7. 文档同步

- 主设计 v1.3.59 → **v1.3.60**：§7.5「审查员 CLI 进程组记录」复用判据段改写（三态 → 五态）、两个消费方段落更新、
  「已收口」替换「有意分叉」；`--cancel` 命令表行、10.5 凭据行同步；新增 v1.3.60 变更记录条目；新增「worker 存活期间
  自身子进程退出盲区」如实保留句。
- LLD v1.1.17 → **v1.1.18**：275/287/487 行引述块同步；已知缺口表两行改为已解决（含残余登记）。
- PROTOCOL：`--cancel` 段与 `--wait` 出口段同步纳入 `orphaned`。
- MANUAL v1.0.17 → **v1.0.18**：「只有记录对得上才发信号」改为「或组长已退出但组员仍在」；补新告警文案；凭据准入段
  落三处同步（不抹的条件、结束后照抹的条件、`--cancel` 出口条件）。
- RUNBOOK：分档表「因审查员 CLI 未动」一行补 `orphaned` 成因与出口提示。
- BACKLOG：EV-165 改 `done`（正文按最终实现改写）；EV-157/EV-154 两处交叉引用同步；新登 EV-168、EV-169。
- PRD：核对后无字面涉及，不改（与近期同类主题一致）。

## 8. 代码双审：7 条全接受（含 codex 解析回退，逐条裁决见 §2）

代码双审第 1 轮（run `20260929T041949Z`，相对 HEAD `eeceeaa` 的 23 个文件、263.4 KB）：gemini `approve-with-nits`（2 条）、
glm `approve-with-nits`（2 条）、codex **解析回退**（原文自报 `request-changes`，3 条：重要 1、次要 1、吹毛求疵 1，闸门按
`CODEX-F01～F03` 三个回退单元校验，原文逐条裁决在应答件表外 §2）。**共 7 条，全部接受**，无驳回、无暂缓。

关键发现（详见应答件 `.reviews/组长已退组员仍在的准入/code/2026-09-29-组长已退组员仍在的准入-response-claude.md`）：

- **CODEX-01（major）**：本轮我自己在主设计 v1.3.60 §7.5 与 `status.ts` `judgeCliGroup` 文档块里新写的「复用判据」描述
  是错的——把「启动时刻不符」与「取不到且复检后组长仍在」两种语义相反的结果（`reused` 放行、`unverifiable` 阻挡）合并
  成了一句话。代码本身正确（复用 r1 既有逻辑），只是文档表述有误，已改为准确的三分法。
- **AGY-01（minor）**：K5/K6 集成测试在 `killLeaderOnly` 之前没有像 `scrub-admission.test.ts` 的 `orphanedGroup` 那样
  先等组员派生完成，存在「组长还没 fork 子进程就被杀、导致组被整个端掉」的竞态风险——与我自己在单测里已经修过的同一
  形态不一致。已补 `untilTwoMembers` 前置等待，并去掉杀组长后的无效重试循环。
- **AGY-02≡GLM-01（nit/minor）**：`run-protocol.ts:799` 与 `util/exec.ts` 的 `terminateProcessGroup` 文档块残留 EV-154
  旧语义（「组长退、组员忽略时不升级」），与本轮新 `isGone` 行为（继续升级到 SIGKILL）矛盾或失实。已改准两处注释。
- **GLM-02（minor）**：报告 §3.3 声称 `orphan_unverifiable` 的 warn 文案「超出零配额可行范围、无法测试」——这个论证
  是错的，既有 U5 A 格的 `terminateCli` 注入手法可以直接覆盖。已补测试（U5‴）并更正报告论证（见 §3.3）。
- **CODEX-02（minor）**：探针与验收脚本补记 macOS 产品版本与内核版本（前提是 XNU 行为，与 Node 版本无关）。
- **CODEX-03（nit）**：性能量级（孤儿组终止轮询每组约 12+ 次全表 `ps`）按 r2 计划已定的处置——如实记录，不改设计。

### 修订后读数

| 项 | 读数 |
| :--- | :--- |
| `npm run typecheck` / `npm run build` | 均通过 |
| `test/unit/scrub-admission.test.ts`（新增 U5‴，共 15 条） | **15 / 15** |
| `test/integration/gate-loop.test.ts`（K5/K6，连续 3 次） | **2 / 2** × 3，无偶发红 |
| `test/integration/gate-loop.test.ts`（既有 EV-157/158 回归） | **7 / 7**，未受影响 |
| `npm test`（全量） | **2267 / 2269 / 0 / 2**（较修订前 +1 条新用例） |
| 源码变异（同一份 9 条规格，锚点重新核对仍唯一） | **9 / 9**，fail 数与修订前逐条相同（4/2/7/7/5/1/1/1/1） |
| 零配额验收（旧构建 `eeceeaa`，`acceptance-readout.r1.json`） | **7 / 7**，`readout` 新增 `macosProductVersion: "27.0"`、`kernelRelease: "27.0.0"` |
| `doctor --selftest`（验收 B6） | **14 / 14** |
| 探针第三次读数（`probe-pgid-reuse.out3.json`，补系统版本） | 与前两次一致：回绕一整圈，零个新进程拿到仍有成员的组号 |
| 残留进程 | 无 |

## 9. verify（出口）

`trivium verify`（`npm run typecheck` && `npm run build` && `npm test`）：**通过**。typecheck 干净；build 产出新构建标识
（工作树未提交，作用面内有改动，符合预期）；`npm test` **2267 / 2269 / 0 / 2**（2 条 skipped 与既有基线一致，非本主题
引入；较代码双审前的 2268/2266 多 1 条，即新增的 U5‴）。留痕：`.reviews/组长已退组员仍在的准入/verify/`（含代码双审
修订后重跑的记录，文件名带时间戳区分两次 verify）。

## 10. 结论

计划双审 15 条全接受、代码双审 7 条全接受（其中 1 条是我自己在文档里写错的判据描述，已订正）、代码实现完成、单元+
集成+变异+零配额验收+doctor 自检全部通过、全量测试无回归、文档六处同步完毕。**未提交、未推送、未审批**，等待用户指示。
