# 测试报告索引补齐 · 实施报告（EV-172）

- **日期**：2026-10-01
- **主题**：`测试报告索引补齐`；计划 `.reviews/测试报告索引补齐/plan/`（用户决策送审前已定 → 计划双审 run `20260930T231629Z`：gemini `approve`、codex / glm `approve-with-nits`，8 条接受 6、驳回 1、暂缓 1 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`466bb59`（`main`，clean）；计划与本报告的行号取自该提交
- **状态**：实施与验证完成；代码双审 r1（run `20260930T235225Z`）9 条接受 8、驳回 1，已按接受项修订（§6）；§1、§2 是修订前的读数，修订后读数见 §6；未提交
- **evidence**：`doc/05_testing/evidence/doc-archive-index-20261001/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §2.1 19 条描述 | `doc/05_testing/README.md`「当前已归档文件」一节新增 19 条；每条逐份读报告头部与读数 / 结论 / 修订段后写，读数照报告原文 | 代码双审（测试不核描述，r2 §6 ②） |
| §2.2 重排 | 整节按「非报告文件在前、报告按（日期, 文件名）码点序」重排；`evidence/` 目录说明移到节末；既有 28 条逐字搬运（重排脚本断言每条原行仍在）；本报告同批进本节 | A3；`git diff` 只有 25 行新增、5 行挪位 |
| §3.0 IO 接口 | `test/helpers/doc-archive-index.ts`：`IndexIO`（`read` / `list` / `kind`），工作树实现 `fsIndexIO`（`statSync` 跟随软链）；git 实现在证据脚本 `lib.mjs` 的 `gitIO`（全部带 `-c core.quotePath=false`，不带 `-r` 的逐层 `ls-tree -z`） | B1、baseline-red 的读法分叉自检 |
| §3.1 论域 | `indexedReadmes`（`doc/` 下一级目录、含节标题的 README，按规则求）；`KNOWN_INDEXED_DIRS` 六个目录作下限，`checkDomain` 报 `not_in_domain` | A1、B8、D5 |
| §3.2 解析 | `parseSection`：围栏内的行一概不看；节止于下一个 `# ` / `## `；`###` 及更深分组；顶格 `- [` 的第一条链接是条目，其余是行内链接；`resolveTarget` 去片段 → 去尾斜杠 → 解码 → POSIX 求路径，带协议与纯锚点返回 null | B9、B10、B11、W6～W8 |
| §3.3 判据 | `checkIndex`：`dangling`（条目目标不是存在的文件，含目录与带协议）、`duplicate`、`missing`（顶层文件，含非 `.md`，排除 README 自身、目录、隐藏项、非常规文件）、`inline_dangling`；跨目录条目只判悬空、不计覆盖；失败文案点名 README 与文件 | A2、B2～B5、B7、D1～D3′、D6、D7、W1、W2、W5 |
| §3.4 顺序 | `checkOrder`：按组、只看本目录条目，逐条与本组上一条含日期条目比，每条至多报一条（GLM-01 的粒度）；无日期条目排在含日期之后也报 | A3、B6、D4、W3、W4 |
| §3.5 用例 | `test/contract/doc-archive-index.test.ts`：A1～A3 对活仓库（A2 / A3 逐 README 子用例），B1～B11 内存目录树反例 | §2 |
| §4.1 规范句 | 05_testing README 命名规范表下方一段（同批进本节、顺序口径、对账测试、示例不是条目） | 门面测试 26/26（新文字不命中 EV-167 全局规则） |
| §4.2 同步清单 | AGENTS.md「改动同步清单」加一行，只说「同批进索引、测试对账」 | — |
| §4.3 BACKLOG | EV-172 done；登记数字按 r2 S10 对账表更正（15 + 2 + 2 = 19）；残余写 CODEX-06；原登记保留 | — |
| §4.4 主设计 | 文档头 v1.3.69，§21 变更记录加一行；正文不改 | — |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| 目标测试 · 补齐前（起点文档 + 新测试，`target-before.txt`） | 26 条：pass 22、fail 4——红的是 A2、A3 与各自的 `doc/05_testing/README.md` 子用例；05_testing 报 19 条 `missing` 与 4 条 `order`（第 28、30、52、54 行），其余五个目录的子用例全绿；B1～B11 全绿 |
| 起点红、补齐后绿（`baseline-red.mjs` → `baseline-red.json`） | **18 / 18** 条期望满足：起点 `466bb59`（git 读法）论域恰六份、05_testing 恰 19 条 `missing`（与计划 S3 逐一相等）与 4 条 `order`、无其它种类、其余五份零问题；改后工作树六份全部零问题。读法分叉自检：五个未改目录的 git 读法与工作树读法逐名逐类型相等 |
| 目标测试 · 补齐后（`target-after.txt`） | **26 / 26** |
| 镜像反向验证（`reverse-check.mjs` → `reverse-check.json`） | **17 / 17** 符合期望（对照 1 + 文档形态 8 + 判定弱化 8），活工作树 `git status` 前后一致；每次镜像构建约 22 ms、目标测试约 130 ms。明细见下表 |
| 门面指针对账（`facade-version-pointers`，同一份 README 在其论域内） | 26 / 26 |
| `npm run check` | 第 1 次 **2442 / 2440 / 0 / 2**，退 0，约 269 s（`check-1.txt`；起点 2416 → 新增本主题 26 条）；第 2 次见 §2.1 |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | **14 / 14**（`doctor-selftest.txt`） |

反向验证各形态（施加在 mkdtemp 镜像上；镜像的 `doc/` 只拷顶层文件、子目录软链，`dist/test/test/` 拷贝、其余软链）：

| 形态 | 施加 | 结果 |
| :--- | :--- | :--- |
| C0 | 不施加 | fail 0 |
| D1 | 删 `lock_reclaim_enoent` 那条条目 | A2 红，`[missing]` 点名该文件 |
| D2 | 加一条指向不存在的 `REPORT_2026-10-02_nonexistent.md` | A2 红，`[dangling]` 点名目标 |
| D3 / D3′ | 目录里放一份不进索引的 `.md` / `.csv` | A2 红，`[missing]` 点名该文件 |
| D4 | 交换 09-27 `gate_block_no_skeleton` 与 `orphan_worker` 两条 | A3 红，`[order]` 点名两条 |
| D5 | 06_deployment 的节标题改一个字 | A1 红，`[not_in_domain]` 点名该 README |
| D6 | `CASE_manual_acceptance` 抄一行 | A2 红，`[duplicate]` |
| D7 | 行内链接改指不存在的证据目录 | A2 红，`[inline_dangling]` |
| W1 | 去掉覆盖检查 | B2、B4、B9 红 |
| W2 | 目标不存在或非文件也放过 | B3 红 |
| W3 | 去掉含日期条目的顺序检查 | B6 红 |
| W4 | 去掉「无日期排在含日期之后」检查 | B5、B6 红 |
| W5 | 不再排除隐藏项（镜像 05_testing 顶层放 `.DS_Store`） | A2 与 B1 等红，`.DS_Store 没有进` |
| W6 | 条目识别放宽到任意链接 | B1～B4 等红 |
| W7 | 去掉尾斜杠归一 | B1～B4 等红 |
| W8 | 不认围栏 | B1～B4 等红 |

W2、W7 只由 B 类咬住：活仓库里没有「条目指向目录」「行内链接因尾斜杠判不存在」的现成形态（真实文件系统对带尾斜杠的目录路径照样 `stat` 得到），这两格靠内存反例守。

### 2.1 第 2 次全量

文档（含本报告初稿与本主题索引条目的读数）定稿、重跑 `baseline-red`（18/18）与 `reverse-check`（17/17）之后：**2442 / 2440 / 0 / 2**，退 0，约 267 s（`check-2.txt`）。两次全量都没有出现 EV-149 / EV-153 / EV-173 同形的偶发红。

## 3. 偏离与如实登记

- **19 条描述的起草方式**：分三个只读子代理各起草 6 条并要求附出处行号，EV-74 一条我自己写；草稿到手后我逐份回到报告原文核对。三组草稿都有与原文不符之处（例：把 gemini、glm 零意见、只有 codex 提了 3 条的一轮写成「三侧全接受」；写出报告里没有的内容，如「5 处调用方均改为应答件指定的播报」「探针 psfail+hold 注入 0 红」；张冠李戴，如把 `describeFinalizeStep` 的委托写成「`runReviewLocked` 内联回收改为委托」），19 条全部按原文重写，不直接采用草稿。描述是否与报告相符测试不核，请代码双审抽查。
- **`REPORT_2026-09-29_orphan_cli_admission.md` 的全量读数自身不自洽**：该报告 §4 与 §8、§9 写「2267 / 2269 / 0 / 2」，通过数大于总数。按「读数照原文、不改写报告」，索引描述不引这个数（改引变异 9/9、验收 7/7、selftest 14/14 与 verify 通过），报告本身不动。
- **三条既有描述里的「本索引只补了本主题这一行」**（09-30 两份、10-01 一份）：当时的事实陈述，按「记当时」口径逐字保留，本主题补齐后它们仍是真的（说的是各自那一轮）。
- **B5 的期望含 `order`**：用例把重复的 `CASE_a.md` 条目加在含日期条目之后，它同时是「无日期排在含日期之后」，所以期望 `['duplicate', 'order']`。W4（去掉该检查）因此也让 B5 红，属预期。
- **evidence 命名**：05_testing README 里 `evidence/` 目录说明写「按 `m<里程碑>-<用途>-<日期>/` 分目录」，已过期（计划双审 CODEX-06）；本主题证据目录沿用近期「主题-日期」实践，那句说明按用户决策「既有条目的描述文字不改」未改，写进 BACKLOG EV-172 残余。
- **GUIDE_env_setup §六 未加同步行**（r2 §4.2 / §6 ④）。
- **会话中的一次 Hook 误拦**：想在 Bash 里把计划原稿拷一份作 r2 底稿，命令文本含角色后缀、被拦；改用 Write 直接写 r2，没有换写法重试。

## 4. 文档同步

| 文档 | 改动 |
| :--- | :--- |
| `doc/05_testing/README.md` | 规范句一段；「当前已归档文件」一节补 19 条 + 本报告、整节重排 |
| `AGENTS.md` | 改动同步清单加一行 |
| `doc/08_project/BACKLOG.md` | EV-172 done（登记数字更正、残余、原登记） |
| 主设计 | v1.3.69：文档头与 §21 变更记录一行；正文不改 |
| LLD、PRD、PROTOCOL、MANUAL、QUICKSTART、`doc/README.md`、其余五份索引 README | 核后不改（r2 §4.4） |

## 5. 证据文件

| 文件 | 说明 |
| :--- | :--- |
| `lib.mjs` | 共用前提（起点提交在库、构建产物不旧于源文件）、git 读法 `gitIO`、`runAll` |
| `baseline-red.mjs` / `baseline-red.json` | 起点红、补齐后绿；读法分叉自检；`--after 〈提交〉` 供提交后复核提交点 |
| `reverse-check.mjs` / `reverse-check.json` | 镜像反向验证（C0、D1～D7、W1～W8），含每次耗时 |
| `target-before.txt` / `target-after.txt` | 目标测试补齐前后的原始输出 |
| `check-1.txt` / `check-2.txt` / `check-3.txt` | 修订前两次全量、修订后一次全量 |
| `doctor-selftest.txt` | doctor 自检 |

## 6. 代码双审 r1（run `20260930T235225Z`）与修订

三侧：gemini `approve`（零意见）、glm `approve`（零意见，独立复核了整节顺序、起点读数并抽查 8 条描述与原文相符，确认 orphan_cli_admission 报告那条不自洽读数确实存在、索引避开了它）；codex `approve-with-nits`（次要 2、吹毛求疵 7）。9 条接受 8、驳回 1，无降级、无回退。应答件 `.reviews/测试报告索引补齐/code/2026-10-01-测试报告索引补齐-response-claude.md`，`gate --check` 通过。命令 A 不设人工闸门，应答后直接按接受项修订。

| 意见 | 裁决与修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 条目行同行的行内链接被 `links.shift()` 丢弃 | **驳回**：`shift()` 只去掉条目链接本身，同行其余链接照常进行内链接；用编译产物对活仓库实测，点名的五处全部被解析；D7 改的正是条目行（05_testing :47）且已红出 `[inline_dangling]`；B11 也钉住这一形态 | 应答件 §0 |
| CODEX-02 断链软链与非常规文件对覆盖不可见 | 接受断链那一半：列得出名字而 `kind` 为 null 的项计入覆盖，没进索引报 `missing`；进了索引只报一条 `dangling`（悬空条目若指向本目录仍算已登记，不连带报 `missing`）。fifo、套接字这类 `other` 维持排除，头注释写明理由 | 新增 B12；新增弱化 W9 |
| CODEX-03 `dateOf` 不锚定、不校验月日 | 日期段锚定文件名起头（可带一个大写前缀加下划线），其后须跟 `_` 或 `-`，月 01～12、日 01～31；不合格按无日期处理 | B10 补正反例（`REPORT_2026-99-99_x.md`、`v1.2026-01-01.md`、`ADR_001_…` 等为无日期，主设计那种无前缀形态有日期） |
| CODEX-04 镜像依赖构建产物形状 | `reverse-check.mjs` 前提检查 `dist/test`、`dist/test/test` 是真目录，否则退 2 | — |
| CODEX-05 证据脚本写仓库内读数；`forks` 写死 0 | 采纳 `forks` 取实际计数；读数照旧写证据目录（证据 JSON 就是交付物，重跑即刷新是有意用法；审查期间没有重跑任何脚本） | `baseline-red.json` 的 `read_fork_check.forks` |
| CODEX-06 新鲜度只靠 mtime | 两个证据脚本开头自己跑 `node scripts/build.mjs --tests-only`，失败退 2；去掉 mtime 判据 | — |
| CODEX-07 子进程无超时 | git 60 s、重编 120 s、目标测试 180 s；超时按退 2 报，git 读回调不再把超时吞成「不存在」；环境问题在 `run()` 里抛出，镜像在 `finally` 删除后再退 2（此前 `process.exit` 会跳过 `finally`，镜像会留在 tmpdir） | — |
| CODEX-08 AGENTS.md 那一行口径比规范句窄 | 改为只指向出处：条目形态与顺序见 05_testing README 规范句、判定以 `test/helpers/doc-archive-index.ts` 为准；仍只有这一行 | — |
| CODEX-09 报告器形状与浅克隆是隐含前提 | 两个脚本文首写明：按本机 Node 的 spec 报告器解析（本次 v25.2.1），解析不出即退 2；起点提交不在本地对象库（浅克隆、部分克隆）即退 2 | — |

修订后读数（证据目录里的 `baseline-red.json`、`reverse-check.json`、`target-after.txt`、`doctor-selftest.txt` 已被修订后的重跑覆盖，修订前读数只留在本报告 §2；`check-1.txt`、`check-2.txt` 是修订前的两次全量）：

| 项 | 读数 |
| :--- | :--- |
| 目标测试 | **27 / 27**（新增 B12） |
| 起点红、补齐后绿 | **18 / 18** 条期望满足，读法分叉自检 `forks: 0`（取实际值） |
| 镜像反向验证 | **18 / 18**（对照 1 + 文档形态 8 + 判定弱化 9），W9 被 B12 咬住；活工作树 `git status` 前后一致 |
| 门面指针对账 | 26 / 26 |
| `npm run check` | **2443 / 2441 / 0 / 2**，退 0，约 278 s（`check-3.txt`；比修订前多 B12 一条） |
| `doctor --selftest` | **14 / 14** |

**verify（S10）**：`trivium verify --topic 测试报告索引补齐`（run `20261001T001340Z`）**通过，退 0**：typecheck ✓、build ✓、`npm test` ✓（约 280 s），留痕在 `.reviews/测试报告索引补齐/verify/`。本段是 verify 之后补记的，只改本报告文字，未再跑全量。
