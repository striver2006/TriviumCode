# 工作树哈希跨主题并发 · 实施报告（EV-221）

> - **日期**：2026-10-06
> - **主题**：`工作树哈希并发收口`（M11 前小批第五批，1 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`1678225`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/worktree-hash-concurrency-20261006/`
> - **配额**：零配额（桩审查员，不调任何真实审查员 CLI）
> - **方案**：用户 2026-10-06 定，两条都做——① 工作树哈希排除归档根与 `.trivium/`（与 `diffExcludePrefixes` 同源、调用方传入，四个调用点都覆盖）；② `git add` 报「unable to stat … No such file or directory」时重试，至多 2 次

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. **算法**：`src/trivium/util/git.ts` `workTreeHash`（:106～131）在临时索引上 `read-tree HEAD` → `add -A -- .`（:117）→ `write-tree`；`add` 非零退出即抛 `git add to temp index failed: <stderr>`（:119），不区分成因、不重试。
2. **调用点**（`src/` 共 7 处）：送审冻结 `freeze.ts` :442（`--start` 前台、逐侧各一次）、跑后漂移复算 `review.ts` :1482（工作进程）、审批时工作树摘要 `worktree-summary.ts` :172（按剩余预算传 `timeoutMs`）、构建标识 `build-stamp.ts` :64（`computeInputsSha256`：构建时、收尾本仓模式、doctor）；另有三处在探针夹具仓库上（`probes/agy.ts` :242、`probes/zcode.ts` :336、`probes/fixture.ts` :106），夹具是 mkdtemp 里的临时仓库，没有归档根，不在本题范围。
3. **撞上的对象**：`util/fsx.ts` `writeAtomic`（:26～31）先写 `<目标>.tmp-<pid>-<时刻>` 再改名；锁文件同样先写 `<锁>.tmp-<pid>-<uuid>` 再改名（`lock.ts` :373）。另一主题的工作进程此刻正写这些文件时，`git add -A` 列目录时还在、`stat` 时已不在，报 `fatal: unable to stat '<路径>': No such file or directory`；工作进程按异常收尾（`run-protocol.ts` :1187「工作进程异常：…」），该轮判 failed。
4. **漂移判定本就不看这两处**：`freeze.ts` `judgeDrift` 的 `ownPrefixes` 是归档根与 `.trivium/`（:597～599），变更列表剔除 `isOwn`（:625）；`review.ts` 传入的就是这两处（:1585～1586）。审批摘要同样按 `diffExcludePrefixes` 剔除（`worktree-summary.ts` :141、:175～177）。`diffExcludePrefixes`（`code-stage.ts` :104～109）= `{.trivium, .git, 项目内的归档根}`。所以算哈希时排除这两处，漂移结论与摘要列出的文件都不变。
5. **构建标识的作用面不含这两处**：`INSTALL_INPUT_PATHS`（`build-stamp.ts` :13～20）是 `src`、`scripts`、`skills`、`package.json`、`package-lock.json`、`tsconfig.json`，`computeInputsSha256` 只取这几项的子对象 id（:61～69），排除作用面之外的路径不改其结果。
6. **真实项目里撞得上的面**：`init` 写的 `.gitignore` 忽略 `.trivium/lock/` 与 `.trivium/state.json`，但 `state.json.tmp-*` 与归档根下的 `*.tmp-*` 都不在忽略面内（本仓 `.gitignore` 的 `*.tmp` 匹配不到 `x.json.tmp-…`）；测试夹具没有 `.gitignore`，锁文件也在面内。
7. **复现（改前，零配额）**：装置照搬 EV-218 的 I2 加压办法——每份在一个夹具仓库里让两个主题对齐到一秒开头并发 `review --start`、等两轮到终态，读归档 run.json 的 status 与运行目录 status.json 的 message；每轮同时 4 份。结果见 §2 第一行：**第 7 轮（累计 28 份）撞上 2 份**，两份都是「工作进程异常：git add to temp index failed: fatal: unable to stat …: No such file or directory」，消失的文件分别是 `.trivium/lock/EV221乙.lock` 与 `.trivium/lock/.task-EV221乙.lock.tmp-…`（夹具没有 `.gitignore`）；EV-218 当时撞上的是归档根下 `_meta/` 里的 `review-gemini-….json.tmp-…`。
8. **一处边角**（实测）：用户环境带 `GIT_LITERAL_PATHSPECS=1` 时，`git add` 把 `:(exclude,…)` 当字面路径、报「pathspec … did not match any files」退 128（`pathspec-literal-env.txt`）。排除写法要在这一步钉 `GIT_LITERAL_PATHSPECS=0`，否则会在这类环境里把工作树哈希整个弄坏。

### 修法

1. `workTreeHash(cwd, opts)` 的 `opts` 加可选 `exclude: readonly string[]`（项目相对路径前缀）。给了就在 `add` 的 pathspec 后追加 `:(exclude,literal)<前缀>`——`literal` 让前缀按字面匹配（与 `isOwn` 的「等于或以 `前缀/` 开头」同义，不吃 glob 字符），`add` 这一步的环境钉 `GIT_LITERAL_PATHSPECS=0`。被排除的路径在临时索引里保持 `read-tree HEAD` 的版本，哈希仍只取决于工作树内容。不给 `exclude` 时 pathspec 与改前相同。
2. `add` 失败时，stderr 同时含 `unable to stat` 与 `No such file or directory`（文件在列目录与 stat 之间消失）就重跑 `add`，至多重试 2 次（共 3 次）；超时、其它报错照旧当场抛出，用尽时抛最后一次的原文（文案格式不变）。判据不写正则字面量（`registry-parity` 的剥注释器不认正则）。
3. 四个调用点传排除，取值与 `diffExcludePrefixes` 同源：
   - `freeze`：`diffExcludePrefixes(path.relative(projectRoot, archiveRoot))`，与同函数里 code 阶段补丁用的同一份；
   - 跑后复算：`diffExcludePrefixes(path.relative(ctx.projectRoot, ctx.archiveRoot) || cfg.archive_root)`，与同函数里 code 阶段重取补丁用的同一份（提到复算之前、两处共用）；
   - 审批摘要：已有的 `excluded`；
   - 构建标识：`diffExcludePrefixes(defaultConfig().archive_root)`。构建标识只在本仓重算（构建时、本仓模式），本仓 config 钉的归档根就是缺省值 `.reviews`；归档根改到别处时只是少排除一处，结果仍不变。单测守住「这组排除与作用面不相交」，所以传了不改结果。（**实施时偏离**：改为字面 `diffExcludePrefixes('.reviews')`——构建脚本用 esbuild 单独打包 `build-stamp.ts`，引 `config.ts` 会把 yaml / schema 一并拉进去；与缺省值的一致由单测 E6 守，见 §1。）
4. 用例：重试用真实 git 的 clean 过滤器在 `add` 期间删掉一个已被列入的未跟踪文件（实测稳定造出该报错，`vanish-probe.txt`），一次性的那种重试后成功、每次都删的那种用尽后抛；其它报错（假 git）不重试。排除：归档根 / `.trivium` 下的改、增、删不改哈希，业务文件的改动照常改变哈希，漂移判定结论与不排除时相同，`GIT_LITERAL_PATHSPECS=1` 下照常工作，前缀按字面匹配。接线：经真实 CLI 的一轮审查，送审快照与跑后复算的 tree 都等于 HEAD 的 tree（审查期间只有编排器在写归档与 `.trivium/`）；审批摘要的当前树等于基线；AST 源码护栏按文件登记 `workTreeHash` 调用点，四处必须传 `exclude` 且取值来自 `diffExcludePrefixes`，三处探针登记为豁免。EV-218 的 I2 恢复为「两轮都 success」。

### 不改的边界

- 漂移判定逻辑与结论、审批摘要的输出、`run.json` 的字段与形状、`writeAtomic` 的写法都不改。
- `snapshot.tree_hash` 照旧记录，语义改为「排除归档根与 `.trivium/` 之后的工作树」（被排除部分取 HEAD 的版本）；`snapshot.after_tree_hash` 与它同法。BRIEF「工作树快照」一行显示的就是这个值，格式不变。改前写下的留痕与改后的比对只会在被排除的路径上有差，而那些路径本就被 `isOwn` 剔除，结论不受影响。
- 三处探针调用点不传排除（夹具仓库里没有归档根）。
- 重试只认 git 的英文原文：本机 Apple Git 不带翻译；装了翻译的 git 在中文等语言环境下报错被翻译时不重试，退回改前的行为（照旧抛出），① 仍然有效。

## 1. 改了什么

1. `src/trivium/util/git.ts`：
   - 新增 `WorkTreeHashOptions`（继承 `GitCallOptions`，加可选 `exclude`），`workTreeHash` 的 `opts` 改用它，签名向后兼容。
   - 内部 `excludePathspecs`：前缀去开头 `./` 与末尾 `/`，丢空串、`.`、上溯路径（与 `judgeDrift` 的 `normPrefix` + 过滤同口径），其余写成 `:(exclude,literal)<前缀>` 追加在 `add -A -- .` 之后；有排除时 `add` 这一步的环境加 `GIT_LITERAL_PATHSPECS=0`，没有排除时参数与环境与改前相同（探针三处走这条）。
   - 新增导出 `ADD_VANISHED_RETRIES = 2` 与 `isVanishedFileError(stderr)`（同时含 `unable to stat` 与 `No such file or directory`，不写正则字面量）。`add` 非零退出、未超时且判据为真时重跑，至多 2 次；超时、其它报错照旧，抛出文案格式不变（用尽时是最后一次的原文）。
2. 四个调用点传 `diffExcludePrefixes` 同源的排除：
   - `freeze.ts`：`ownExcludes = diffExcludePrefixes(path.relative(projectRoot, archiveRoot))`，`workTreeHash` 与同函数 code 阶段的 `diffAgainst` 共用；
   - `review.ts` `executeRun`：`ownExcludes` 提到复算之前，`workTreeHash` 与 code 阶段重取补丁共用（原 code 分支里的 `excludes` 删去，取值不变）；
   - `worktree-summary.ts`：`workTreeHash` 加 `exclude: excluded`，其后的 `isOwn` 剔除保留（改前写下的基线没排除）；
   - `build-stamp.ts`：新增导出 `INPUT_HASH_EXCLUDES = diffExcludePrefixes('.reviews')`，`computeInputsSha256` 传它；文档块写明为何不经 `config.ts`、作用面与之不相交、自定义 `paths` 不得与之相交。
3. 注释同步：`gate.ts` 那段「`drift` 只能单向用」补「EV-221 起这两处在算哈希时就已排除」；`code-stage.ts` `diffExcludePrefixes` 文档块补「工作树哈希也传这一份」。
4. 用例：
   - 新文件 `test/unit/worktree-hash-exclude.test.ts` 13 格：E1 被排除处的改、增、删不改哈希（等于 HEAD 的 tree），不排除时同一批改动看得见；E2 业务文件的改、增、删照常改变哈希、被排除处干净时与不排除同值；E3 四种场景下 `judgeDrift` 的结论与不排除时逐字段相同；E4 `GIT_LITERAL_PATHSPECS=1` 下照常；E5 字面匹配（`rev[1]` 不吃 `rev1`、`rev*` 不吃 `revX`）与规范化；E6 `INPUT_HASH_EXCLUDES` 与缺省归档根、`diffExcludePrefixes` 对得上，与 `INSTALL_INPUT_PATHS` 不相交，作用面指纹不受这两处改动影响；R1 clean 过滤器在 `add` 期间删掉已列入的未跟踪文件一次 ⇒ 重跑一次成功、哈希等于 HEAD 的 tree、过滤器被调 2 次；R2 每次都删并预造下一个 ⇒ 3 次 `add` 后抛第 3 次的原文；R3 假 git（`FAKE_GIT_FAIL=index-add`，stderr 不是「文件中途消失」）⇒ 带不带排除都只调 1 次 `add`、抛原文；R4 判据只认英文原文（Permission denied、`Unable to create … index.lock`、过滤器失败、翻译过的报错都判否）；S1 审批摘要只动归档与 `.trivium` 后 `current_tree` 等于同法算的基线、改业务文件后列出该文件；G1 / G2 AST 源码护栏（扫 `src/` 全部 `workTreeHash(…)` 调用，按文件登记：四处必须传 `exclude` 且取值是 `diffExcludePrefixes(…)` 调用或本文件里初值为它的变量，三处探针登记为不传）。
   - 新文件 `test/integration/worktree-hash-concurrency.test.ts` W1：经真实 CLI（桩审查员）跑一轮 plan 审查，归档 run.json 的 `snapshot.tree_hash` 与 `after_tree_hash` 都等于 HEAD 的 tree、`drift.changed` 为 false（夹具建仓时全部提交，审查期间只有编排器在写归档与 `.trivium/`）。
   - `test/integration/run-dir-collision.test.ts` I2：两轮由「都收尾即可」收回到「都 success」，不是 success 时断言文案带运行目录 status.json 原文。**这是有意收紧断言**：EV-218 首版要求过 success，因 EV-221 放宽，本题修掉成因后收回；修后同一场景加压 80 份 0 失败（§2）。
   - `test/integration/gate-loop.test.ts` W5（基线被 git 清理 ⇒ 报「取不到」）：审查前放一个未跟踪的业务文件 `scratch-note.txt`，断言不变。原构造的前提是「收尾基线里含未跟踪的归档件，不等于 HEAD 的 tree，属不可达对象」；EV-221 起归档件不进 tree，这个夹具里基线就是 HEAD 的 tree（可达，`gc --prune=now` 清不掉），首轮全量两次都红在这里（§2）。补的文件在送审前就在，进送审快照与收尾基线两边，不算漂移。
5. 文档：主设计 v1.3.125（术语表、6.7.1 `snapshot.after_tree_hash` 一行、8.5 补偿 ③ 一句、9.2 两行与要点新增一条、变更记录）；LLD v1.1.47（3.3「`executeRun()` 的漂移复算」补一段、模块表 `util/git.ts` 一句）；PROTOCOL 第四章快照算法补两行；BACKLOG EV-221 结案、新登 EV-222；本报告登记索引。用户手册与 RUNBOOK 不描述工作树哈希的排除面，未改。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 复现（改前，起点 `1678225` 的构建） | 每轮同时 4 份、每份两主题对齐同秒：第 7 轮（累计 28 份）撞上 2 份，均为「工作进程异常：git add to temp index failed: fatal: unable to stat …: No such file or directory」，消失的是 `.trivium/lock/EV221乙.lock` 与 `.trivium/lock/.task-EV221乙.lock.tmp-…` | `repro-once.mjs`、`load.sh`、`base-load/`、`base-load-summary.txt` |
| 实验：排除 pathspec 的语义 | 被排除处的改、增、删后哈希仍等于 HEAD 的 tree；业务改动改变哈希；排除不存在的前缀不报错；字面前缀可排除单个文件 | `pathspec-probe.sh`、`pathspec-probe.txt` |
| 实验：`GIT_LITERAL_PATHSPECS` | `=1` 时 `add` 报「pathspec ':(exclude,literal).reviews' did not match any files」退 128；`=0` 与 ICASE / GLOB / NOGLOB 三个变量下照常 | `pathspec-literal-env.sh`、`pathspec-literal-env.txt` |
| 实验：「文件中途消失」的构造 | clean 过滤器在 `add` 期间删掉已列入的未跟踪文件：只删一次 ⇒ 第 1 次退 128（unable to stat）、第 2 次退 0；每次删并预造下一个 ⇒ 每次都退 128 | `vanish-probe.sh`、`vanish-probe.txt` |
| 类型检查 | 退 0 | 全量内含 |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 新单测文件 | 13/13，定稿后连跑 5 次全绿（首跑 R1 红一次，见本节末） | `unit-new-file-1.txt`～`-5.txt` |
| 相关套件（新增两文件、run-dir-collision、freeze-drift、worktree-summary、build-stamp、temp-index-cleanup、fixture-repo-init、code-stage、worktree-hash-cleanup、registry-parity、scratch-guard） | 181/181 | `suite-final.txt`（中途一轮另含 guard-capability、zcode-mcp-*、render、gate 共 258/258：`suite-1.txt`） |
| 修后加压（同一装置） | 两批各 10 轮 × 4 份，共 **80 份 0 失败**（两轮全 success） | `fixed-load/`、`fixed-load-summary.txt` |
| 变异逐条预跑（首轮） | 11/12：M11（去掉 `literal`）存活——`:(exclude)rev[1]` 作 glob 时也匹配不到 `rev1/f`，E5 的输入区分不了两种形态；补 `rev*` / `revX` 一格 | `first-prerun/` |
| 变异逐条预跑（补格后） | 12/12：M1 排除失效红 E1 / E2 / E4 / E5 / S1，亦跑集成红 W1；M2 冻结不传、M3 复算不传红 G2，亦跑红 W1；M4 摘要不传红 S1 / G2；M5 构建标识不传红 G2（结果按设计不变，只有护栏咬得住）；M6 不重试红 R1 / R2；M7 一律重试红 R3；M8 判据放宽红 R4；M9 次数改 1 红 R2；M10 不钉变量红 E4；M11 去 `literal` 红 E5；M12 不丢 `.` 红 E5 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 12/12 咬住（补格后跑一次；随后 freeze.ts 改了一句注释、code-stage.ts 补一句文档，定稿源码上重跑一次，仍 12/12） | `first-mutation/`、`mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 首轮全量（作废重跑） | 两次都是 2922 / 2919 / 1 / 2、退 1，红同一格 gate-loop W5「基线被 git 清理 ⇒ 报取不到」（实际输出为空）：本题引入的构造前提失效，见 §1 第 4 条；临时目录新建各 1 个（`trivium-index-`） | `first-round-red/` |
| W5 改构造后单跑 gate-loop 的 W 组 | 8/8，连跑 3 次 | `suite-gate-loop-w-1.txt`～`-3.txt` |
| 全量第 1 次 `npm run check` | 2922 / 2920 / 0 / 2，退 0（比起点 2908 多 14 格：新单测 13、W1） | `check-1.txt` |
| 全量第 2 次（串行） | 2922 / 2920 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 全量之后补填本表与索引描述，补跑读 `doc/` 的套件（`test/contract/` 全部与 8 个读文档的单测文件） | 463/463 | `doc-suites-after-report.txt` |
| 临时目录新建 | 两次全量期间各 1 个（均为 `trivium-index-`，已知残留 EV-204 残余五）、自检期间 0；整批自开工（10:18:54Z）起共 4 个、全是 `trivium-index-`（四次全量各 1）；除 `trivium-index-` 外为 0。未用 `TRIVIUM_KEEP_FIXTURES`，没有保留的夹具 | `count-new-check-1.txt`、`count-new-check-2.txt`、`count-new-doctor-selftest.txt`、`count-new-whole-batch.txt` |

**R1 首跑红**：过滤器实测被调 3 次而不是 2 次。在父进程上记命令行后看清，第 3 次来自成功之后的 `write-tree`：`src/x.ts` 刚写、与临时索引落在同一秒，`write-tree` 写索引时把它当「racily clean」重比内容，又跑了一次过滤器，次数随时机变。用例把 `src/x.ts` 的 mtime 拨到一小时前，过滤器只在每次 `add` 里跑一次；之后连跑 5 次全绿。被测代码没改。

## 3. 提交前自审

本批没有审查员，提交前逐项复核补丁：

1. **注释与文档失实**：I2 注释原写「失败时打出 status.json 的 message」，而 `waitDone` 会先在退出码上断言失败、走不到那一步——改为只等到终态、在 status 断言里带 status.json 原文；freeze 注释原只提归档根，补 `.trivium/`；`gate.ts` 那段「`judgeDrift` 是 git 树比对……`ownPrefixes` 还显式排除」仍成立，补一句 EV-221 起算哈希时就已排除；`diffExcludePrefixes` 文档块补新用途。主设计 9.2 code 行原写「②的 tree 反而包含前两者下的未跟踪文件」，改后不再成立，已改写。
2. **断言范围**：唯一收紧的是 I2（见 §1 第 4 条，有意、有加压读数支撑）；gate-loop W5 只改构造、断言不动；E3 断言的是「排除与不排除结论逐字段相同」，没有借机断言新的漂移语义；W1 只断言两棵 tree 等于 HEAD 的 tree 与 `drift.changed`，不涉及其它字段。
3. **调用点登记**：`src/` 里 `workTreeHash` 的 7 处调用都进了 G2 登记表；`driver-wiring`、`topic-arg-quoting`、`config-consumers` 等既有护栏不涉及本题改动的形态（没有新增 `locateSubject` 调用、建议命令、配置键访问）。
4. **审批摘要输出**：人读渲染只看 `total`，不看两棵 tree 是否相等，所以改前写下的旧基线（没排除）与改后算的当前树比时，走 diff 分支、被 `isOwn` 剔除，`total` / `files` 与改前相同；JSON 里的 `current_tree` 值按新口径算。
5. **build-stamp 的构建路径**：构建脚本用 esbuild 单独打包 `build-stamp.ts`，新引入的 `code-stage.ts` 只依赖 `util/fsx`、`util/git` 与类型，构建通过、构建标识照常打印。

## 4. 残余与新发现

- **另登 EV-222**（要不要修待用户定）：用户环境带 `GIT_LITERAL_PATHSPECS=1` 时，code 阶段补丁 `diffAgainst` 的 `:(exclude)…` 与 `:(exclude,glob)…` 被当成字面路径，`git diff` 不报错照常退 0，已跟踪的归档根改动与敏感文件会进被审补丁（实测 `diff-literal-env.sh`、`diff-literal-env.txt`）。候选与建议见 BACKLOG。
- 带翻译的 git 报错被翻译时不重试（退回改前行为）；排除面之外的原子写三次都撞上时仍失败。
- 构建标识取缺省归档根 `.reviews`；本仓归档根改到别处时只是少排除一处，`inputs_sha256` 不变。
- 改前写下的 `snapshot.tree_hash` / `after_tree_hash` 与改后算的值在被排除处有差，漂移与摘要都会剔除，结论不变。
- 附带效果（W5 暴露）：工作树在归档根与 `.trivium/` 之外与 HEAD 相同时（例如改动都已提交、只审计划），`tree_hash` / `after_tree_hash` 就是 HEAD 的 tree，是可达对象，`git gc --prune=now` 一类立即清理不再把它们清掉——漂移复算「送审快照的 tree 已不在对象库」（EV-139 `object_gone`）与审批摘要「基线对象已不在对象库」两格出现得比改前少。判定口径没变。
