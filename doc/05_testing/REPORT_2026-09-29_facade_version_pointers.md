# 门面文档版本指针 · 实施报告（EV-167）

- **日期**：2026-09-29
- **主题**：`门面文档版本指针`；计划 `.reviews/门面文档版本指针/plan/`（用户决策送审前已定 → 计划双审 run `20260929T133946Z`：三侧 `approve-with-nits`，12 条接受 11、驳回 1 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`79d2ed4`（`main`，clean）；计划与本报告的行号取自该提交
- **状态**：实施与验证完成；代码双审 r1（run `20260929T141008Z`）已应答并按接受项修订（§5～§7）；未提交
- **evidence**：`doc/05_testing/evidence/facade-version-pointers-20260929/`
- **性质**：纯文档 + 一条只读契约测试；`src/`、`skills/`、`skills-src/`、schema、bundle 零改动，无需重装

---

## 1. 逐条落地（按 r2 §3）

### 1.1 当前版本指针（逐行清单 `POINTERS`，T1 / T2）

| r2 | 位置 | 改前（`79d2ed4`） | 改后 | 验证 |
| :--- | :--- | :--- | :--- | :--- |
| P1 | `doc/02_design/README.md` :24 | 主设计条目「（**v1.3.43**，状态：…）。依据 PRD v1.4.8 与 5 份参考答卷起草」 | 「（当前版本见其文档头，状态：…）。依据 [PRD](…)（当前版本见其文档头）与 5 份参考答卷起草」 | T1-P1；起点 forbidden + link_missing + marker_missing；DV-P1、DL-P1 |
| P2 | `doc/02_design/README.md` :33 | LLD 条目「（**v1.1.3**，状态：草稿）」 | 「（当前版本见其文档头，状态：草稿）」 | T1-P2；DV-P2、DL-P2、DD-P2 |
| P3 | `doc/07_manuals/README.md` :27 | MANUAL 条目「（v1.0.0，状态：草稿）」 | 「（当前版本见其文档头，状态：草稿）」 | T1-P3；DV-P3、DL-P3、DC-manuals |
| P4 | `doc/03_api/PROTOCOL_dual_critic_relay.md` :3 | 「依据 [设计 v1.3.43](…) 第 6、7、9 章与 [PRD v1.4.8](…)」 | 「依据 [设计](…) 第 6、7、9 章与 [PRD](…)（两者的当前版本见其文档头）」 | T1-P4；DV-P4、DL-P4、DA-P4 |
| P5 | `doc/07_manuals/QUICKSTART.md` :4 | 「依据 [设计 v1.3.43](…) 与 [PRD v1.4.8](…)」 | 「依据 [设计](…) 与 [PRD](…)（两者的当前版本见其文档头）」 | T1-P5；DV-P5、DL-P5、DF-P5 |
| P6 | `doc/07_manuals/MANUAL_user.md` :17 | 「（规范见[设计 v1.3.43](…) 16.1 与 §24 台账。」 | 「（规范见[设计](…) 16.1 与 §24 台账，当前版本见其文档头。」 | T1-P6；DV-P6、DL-P6、DK-P6 |
| P7 | `doc/01_requirements/PRD_driver_dual_critic.md` :176 | 「……见[设计 v1.3.43](…) 16.1 二期里程碑表与 §24 台账，」 | 「……见[设计](…) 16.1 二期里程碑表与 §24 台账（当前版本见其文档头），」 | T1-P7；DV-P7、DL-P7 |
| P8 | `.reviews/README.md` :5 | 「规范依据：[PRD v1.4.8](…) FR-08 / FR-09，[设计 v1.3.43](…) 第 6 章。」 | 「规范依据：[PRD](…) FR-08 / FR-09，[设计](…) 第 6 章（两者的当前版本见其文档头）。」 | T1-P8；DV-P8、DL-P8。**不进 code 阶段被审补丁**（§4） |
| P9 | 主设计 :49 | 「**需求依据**：[PRD_driver_dual_critic.md](…) v1.4.0」 | 「**需求依据**：[PRD_driver_dual_critic.md](…)（当前版本见其文档头）」 | T1-P9；DV-P9、DL-P9 |

### 1.2 全局规则守的位置（`scanGlobalRules`，T5）

| r2 | 位置 | 改前 | 改后 | 验证 |
| :--- | :--- | :--- | :--- | :--- |
| P10 | PRD :433 | 「截至本版（v1.4.8）：AC-20 已达成……」 | 「截至 v1.4.8：AC-20 已达成……」（状态一字不改） | T5；T3 样本 H-prd-433；DG-self |
| S1 | `doc/02_design/README.md` :33 | 「50 个模块 / 16437 行代码的分层地图、六条执行流的调用链、三个核心状态机、五条贯穿全局的实现约束……七条现状缺口」 | 「各模块的分层地图、主要执行流的调用链、三个核心状态机、贯穿全局的五条实现约束……现状缺口（已解决的划线保留）」 | T5；DG-idx-modules、DG-idx-flows、DG-idx-gaps |
| S2 | `doc/07_manuals/README.md` :27 | 「七个日常场景……九条已知限制」 | 「日常场景……已知限制」（「七条命令」「五道护栏」保留） | T5；DG-midx-scenes、DG-midx-limits |
| S3 | LLD :51 | 「规模基准：**50 个模块 / 16437 行 TypeScript**（不含测试）」 | 「规模：模块数与行数随代码变，本文不写死（不含测试，以 `src/` 为准）」 | T5；DG-lld |

### 1.3 对账测试

- `test/helpers/facade-pointers.ts`：清单 `POINTERS`（P1～P9）、历史样本 `HISTORICAL_SAMPLES`（11 条）、论域规则 `isFacadeDoc` / `facadeCorpus`（按目录规则求，不手抄）、判定函数 `checkPointers` / `findUnlistedMarkers` / `scanGlobalRules` / `checkHistoricalSamples`。不依赖 `src/`，证据脚本导入其测试构建产物。
- `test/contract/facade-version-pointers.test.ts`：T1（9 个子用例）、T2、T3、T5 跑活仓库；T4 共 11 条跑内存文件。合计 24 条（9 个子用例 + 15 条顶层）。
- 改前工作树上（文档未改、测试已写）：T1 九个子用例全红、T5 红、T3 红（仅 H-prd-433 这条 P10 改后才有的样本找不到），T2 与 T4 全绿；改后 24/24。

### 1.4 版本号与变更记录

主设计 v1.3.62 → **v1.3.63**（文档头 + §21 一行）；PRD v1.4.16 → **v1.4.17**（「当前版本」「文档版本」两处 + 一条「变更说明」）；LLD v1.1.20 → **v1.1.21**（文档头 + 一条「变更说明」）；MANUAL v1.0.20 → **v1.0.21**（文档头；无独立变更记录，由主设计 §21 本版行登记）。变更记录行不逐字引用标记短语与锚点原文：生成脚本核过 9 条锚点在改后工作树各恰好一次（`doc-mutation-spec.json` 的 `anchors`）。

### 1.5 其余同步

`doc/README.md` 编写规范加第 5 条（代码双审后改写，§5）；`doc/05_testing/README.md` 报告索引加本报告；BACKLOG：EV-167 → done，新登 EV-171（r2 §6 ①，两档代价）与 EV-172（代码双审 r1，§3）。

## 2. 读数（代码双审之前；修订后的读数见 §7）

| 项 | 读数 |
| :--- | :--- |
| 盘点（`inventory.mjs` → `inventory-79d2ed4.txt`，全部读自 `git show 79d2ed4:`） | R1「文档名 + 版本号」197 行 / 48 个文件；R2 任意版本号 623 行 / 65 个文件；R3a「链接后跟版本号」17 行；R3b「依据 / 见 / 本版 / 截至 / 当前 + 版本号」70 行；门面论域 24 份，全局规则 9 处命中（4 行） |
| 起点全红（`baseline-red.mjs` → `baseline-red.json`） | **17 / 17** 条期望满足：P1～P9 在 `79d2ed4` 上各含 `forbidden`（P1 另有 `link_missing`，余者另有 `marker_missing`）；全局规则命中 PRD :433 `self_version`、设计索引 :33、MANUAL 索引 :27、LLD :51 `stat_count`；改后工作树清单、反向绑定、全局规则、历史样本全部零问题 |
| 文档与清单变异（`gen-doc-mutation-spec.mjs` → `doc-mutation-spec.json`，`doc-mutation.mjs` → `doc-mutation-output.json`） | **34 / 34** 符合期望：DV 9、DG 7、DL 9、DA / DD / DF / DK / DU / DC 各 1、DH 2 条红（fail 1～3）；负对照 DN 1 条（变更记录形态里写入标记短语、计数与自指）保持全绿。每条都还原并核 sha256 一致；变异前与全族结束重编后目标测试均 24 过 / 0 败 |
| 全量 `npm run check` | **2306 / 2304 / 0 / 2**，一次全绿（起点 2282 → 新增 24 条），265 s（`check-1.txt`）；未出现红，按 r2 §5.4 ④ 不跑第二次 |
| `doctor --selftest`（仓库构建，全量检查刚重建） | **14 / 14**（「自检：✅ 通过（14/14 步）」） |
| 零 src | `git -c core.quotePath=false diff --name-only -- src skills skills-src` 为空 |
| 环境 | Node v25.2.1，macOS |

复现：`node scripts/build.mjs --tests-only`，再依次跑本目录的 `inventory.mjs`、`baseline-red.mjs`、`gen-doc-mutation-spec.mjs`、`doc-mutation.mjs`。脚本起手自检两条前提（`79d2ed4` 在本地对象库、测试构建产物存在），缺则退 2 报「环境前提不满足」。变异会临时改 `doc/`、`.reviews/README.md` 与 `test/helpers/`，只在无审查运行时跑。

## 3. 偏离与如实登记

- **变异族多于 r2 列举**：r2 §5.4 ③ 列了 DV / DG / DL / DA / DD / DF / DK / DU / DH / DC；实施另加 **DN**（负对照，期望全绿）与第二条 **DH**。原因：第一轮 33 条全部符合期望，但 DH-lld157 报的是 `anchor_missing` 而非我写的 `forbidden`——那条样本的锚点本身含版本号，删版本号先让锚点失位。补 DH-design50（锚点不含版本号）后 T3 的 `forbidden` 分支也被实测到。第一轮 33 条的读数只在终端输出、没存文件；`doc-mutation-output.json` 是第二轮 34 条的读数。
- **历史样本多一条**：r2 §5.2 T3 列了 10 条代表行，实施加了 H-prd-433（P10 改后的时点记述），用来钉住「P10 保留 v1.4.8、不被全局规则误伤」。
- **判定函数细节**：全局规则对同一行报出每一处命中（r2 未写）；问题类型多一个 `sample_on_pointer`（历史样本与清单项同行），r2 里这一情形未命名。
- **盘点第三轮拆成两个正则**（R3a / R3b），读数分列；r2 §2 称「三轮」。
- **既有缺口，未修，已登记**：`doc/05_testing/README.md` 的报告索引停在 2026-09-26，盘上 09-27 起 16 份报告只有本报告进了索引。本主题只按计划加了自己这一条；补全索引不属 EV-167。初稿写的是「未登 BACKLOG，留代码双审与用户判断」，代码双审 r1 GLM-01 ≡ CODEX-08 指出与 EV-167 同形、写了不登等于丢了，已新登 **EV-172**（暂缓）。

## 4. 审计边界

`.reviews/README.md`（P8）在归档根，按 `diffExcludePrefixes`（`src/trivium/code-stage.ts` :104）**不进 code 阶段的被审补丁**——与 M10b 第 5 步 GLM-01 同一情形。请审查员直读工作树核对该文件第 5 行；T1-P8 与 DV-P8 / DL-P8 已覆盖它。（代码双审 r1 三侧都直读核过。）

## 5. 代码双审 r1

run `20260929T141008Z`（约 13 分钟）：gemini `approve` 零意见；glm `approve-with-nits`（GLM-01 次要、GLM-02 吹毛求疵）；codex **解析回退**，闸门按 CODEX-F01（自我申报）/ CODEX-F02（内含原文 CODEX-01～09）两个单元核对，原文逐条裁决放在应答件表外 §2。闸门 4 个单元全接受；原文 9 条全接受，其中 CODEX-02 的「工作树必须干净」一半换做法（理由：装置的用途就是提交前给双审看读数）。应答件 `.reviews/门面文档版本指针/code/…-response-claude.md`，`gate --check` 通过。

| 意见 | 修订落点 |
| :--- | :--- |
| CODEX-01（新规范与 LLD :158、ADR_002 :7 各说各话） | 两行定性不变、不改；`doc/README.md` 第 5 条改为「指向现在 / 记当时」判别，历史形态补「ADR 关联行、叙述某次改动时所依据的设计版本、冻结文档的版本」；助手文档块写明历史样本锚点含版本号时删版本号先报 `anchor_missing` 是有意的 |
| CODEX-02（变异装置直接改活工作树） | `doc-mutation.mjs`：有闸门处于 `running` / `awaiting_approval` 即拒跑（经仓库构建的 `trivium status --json`）；逐条备份原文到 `mkdtemp` 目录并写日志；SIGINT / SIGTERM 时还原退 130；日志残留即拒跑，`--recover` 按备份还原；读数逐条落盘；记录启动时 `git status` 快照。新增 `interrupt-drill.mjs` 实测（§7） |
| CODEX-03（还原核验排在重编之后；规格失配作废整族） | 写回后立即核 sha256；重编放独立 try，失败记 `build_failed` 并退 2；`find` 失配记该条 `spec_mismatch` 后继续 |
| CODEX-04（TAP 解析失败混进判据） | 汇总行不是整数即按「环境前提不满足」退 2，打印原始输出前 40 行 |
| CODEX-05（候选路径两份实现） | 助手新增 `facadeCandidates(io)`，测试与 `lib.mjs` 都改用它 |
| CODEX-06（叙述句引述标记短语会误报） | 反向绑定只认「标记短语与指向会升版文档（`VERSIONED_DOCS`：主设计 / PRD / LLD / MANUAL）的链接同行」；T4 补两格；变异补负对照 DN-narrative |
| CODEX-07（计数机检只认列举形态，没交代） | 助手文档块与 `doc/README.md` 第 5 条都写明「机器盯住的形态」与「其余靠自觉（EV-171）」 |
| CODEX-08 ≡ GLM-01（报告索引缺口写了不登） | 新登 BACKLOG EV-172；§3 改写 |
| CODEX-09（整行禁版本号的取舍未写明） | `checkPointers` 文档块写明：清单行只放指针，红了该拆行 |
| GLM-02（`CLAUDE.md` 不在论域） | `ROOT_FACADE_FILES` 加 `CLAUDE.md`（只读不改，EV-138）；T4 论域用例补该文件；论域 24 → 25 份 |

## 6. 其他登记

- **CODEX-F01（codex 自我申报）**：codex 为找标记短语在仓库根跑过一次 `grep -rl`，输出列出过禁读清单里的文件名（只列名、未取内容）。编排器本轮 `peer_deny: false`，未判越界；照实记在这里。
- **中断演练第一次没过**：修订版 `doc-mutation.mjs` 最初在信号处理器里直接还原，但整个循环全靠 `spawnSync`，事件循环从不空转，处理器跑不到——D1（SIGTERM）照常跑完、退 0（工作树仍原样，因为每条本来就写回）。改为处理器只置标记、循环在文件处于变异态时让出一次事件循环再检查，第二次 D1 / D2 都过。

## 7. 修订后读数

| 项 | 读数 |
| :--- | :--- |
| 目标测试 | **26 / 26**（T4 新增「叙述句不报、带会升版文档链接就报」「候选路径求法」两条） |
| 起点全红（`baseline-red.json`，已被本轮覆盖） | **17 / 17**；门面论域改后 25 份（加 `CLAUDE.md`），起点仍 24 份（`79d2ed4` 的候选同样经 `facadeCorpus` 求） |
| 文档与清单变异（`doc-mutation-spec.json`、`doc-mutation-output.json`，已被本轮覆盖） | **35 / 35**：DV 9、DG 7、DL 9、DA / DD / DF / DK / DU / DC 各 1、DH 2 条红；负对照 DN-changelog、DN-narrative 两条全绿。DU-deploy 改为链接 MANUAL（原先链接 RUNBOOK，按 CODEX-06 的新判据属叙述句、不再红，于是那一形态改作负对照 DN-narrative）。变异前与全族结束重编后目标测试均 26 过 / 0 败 |
| 中断演练（`interrupt-drill.mjs` → `interrupt-drill.json`） | **2 / 2**：D1 SIGTERM 于 DV-P3 中途 ⇒ 退 130、「收到 SIGTERM，已还原并退出（中断于 DV-P3）」、日志不留、工作树指纹与演练前一致；D2 SIGKILL ⇒ 日志留存、工作树处于变异态、再跑拒跑退 2、`--recover` 退 0「已按备份还原 doc/07_manuals/README.md（中断于 DV-P3）」、指纹一致（第一次 D1 未过，见 §6） |
| 全量 `npm run check` | **2308 / 2306 / 0 / 2**，一次全绿，268 s（`check-2.txt`）；未出现红，不跑第二次 |
| `doctor --selftest`（全量刚重建的仓库构建） | **14 / 14** |
| 零 src | `git diff --name-only -- src skills skills-src` 仍为空 |

§2 的首轮读数（17/17、34/34）只剩终端输出与本报告的记录：`baseline-red.json`、`doc-mutation-spec.json`、`doc-mutation-output.json` 都被本轮修订后的重跑覆盖。

## 8. verify（S10）

`trivium verify --topic 门面文档版本指针`（run `20260929T143617Z`）：**失败，退 1**。typecheck ✓、build ✓、`npm test` ✗（2308 / 2304 / **2** / 2，271 s）。留痕 `.reviews/门面文档版本指针/verify/2026-09-29-门面文档版本指针-verify.md`。

两条红都在 `test/integration/lock-cross-process.test.ts`：

- 「跨进程：多个进程同时回收同一把遗留锁，仍只有一个拿到」：「回收遗留锁的竞争也只应有一个赢家，实际 2 个」，其中一个进程的 stderr 是「回收主题「跨进程抢锁」的遗留锁（原因 unpa…」（被截断，即 `unparsable`）——与 BACKLOG **EV-149** 登记的形态相同；
- 「EV-161 X1：跨进程——亚秒阈值下慢临界区（withTopicLock）不被并发者回收、不丢更新」：「活着的慢临界区不得被回收：⚠️ 回收主题「跨进程抢锁」的遗留锁（原因 unparsable，原持有者 pid ?）」。

归因（已核、未深挖）：本主题 `src/` 与 `test/integration/` 零改动；两条都走锁文件被判 `unparsable` 的回收路径，是满载下的跨进程时序问题，不是本主题引入的。修订前后两次全量（`check-1.txt`、`check-2.txt`）都是全绿；verify 之后单跑该文件 **8 次全绿**（每次 6 / 6）。**如实登记**：EV-149 原文只点名第一条用例；第二条（EV-161 X1，临界区锁超时下限那一轮新增）此前没有偶发红记录，这是首见，红因同样是 `unparsable` 回收。是否并进 EV-149 或另登、是否要修，留给用户定；本主题未改任何东西去让它变绿，也没有重跑 verify。
