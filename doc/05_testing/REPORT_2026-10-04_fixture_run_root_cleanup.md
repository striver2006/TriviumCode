# 夹具运行目录收尾 · 实施报告（EV-207）

> - **主题**：`夹具运行目录收尾`（命令 A `/dual-run`，Driver claude）
> - **起点**：`91136f7`（`main`）
> - **计划**：`.reviews/夹具运行目录收尾/plan/` r2。计划双审第 1 轮 run `20261004T090126Z`：codex 侧 kimi 返回 403「5-hour usage limit」、第 1 次尝试即失败，未带 `--allow-single`，整次判失败（退 75）；用户看过终态后定为用已归档的 gemini `approve-with-nits`、glm `approve-with-nits` 两份往下走，`gate --check` 按单侧降级认这两份，7 条全接受
> - **代码双审**：第 1 轮 run `20261004T102427Z`（codex 额度已恢复、三侧到齐）：codex（`k3`）`approve`、gemini `approve`、glm `approve-with-nits`，3 条吹毛求疵接受 2、驳回 1，详见 §7
> - **设计**：主设计 v1.3.85（§17.1 补「夹具目录约定」一段）
> - **证据**：`doc/05_testing/evidence/fixture-runs-cleanup-20261004/`
> - **配额**：零。只用本机 git、桩适配器（`TRIVIUM_STUB_CRITIC`）与打包后的 CLI；不跑真实 doctor

## 1. 问题

自检与集成测试夹具都把运行根设成夹具根的兄弟目录 `<夹具根>-runs`，收尾时没人删它：

- **自检**（`selftest.ts`，用户机器上可见的产品行为）：`finish` 只删夹具根，每跑一次 `doctor --selftest` 就在系统临时目录留一个 `trivium-selftest-XXXXXX-runs`（里面是 worker 日志、交接文件与 `status.json`；桩适配器不写凭据副本）。本题开工时 679 个。
- **集成测试夹具**（`test/helpers/fixture.ts` 的 `makeFixture`）同形，而且夹具根本身也从来不删：22 个测试文件、182 处调用，`trivium-fx-*` 共 58137 个（夹具根 33049、`-runs` 25088）。`stub-agent-kit` 自建夹具同形（`trivium-kit-*-runs` 240 个）。

兄弟目录是拼出来的路径、不是 `mkdtemp` 的返回值，按 2026-09-20 事故后的规矩（删除类调用只认 mkdtemp 返回值）不能直接拿它去删，修法要改目录结构。

## 2. 改了什么

- **自检**：`mkdtemp` 建父目录 `trivium-selftest-XXXXXX/`，其下夹具仓库 `repo/`、运行根 `runs/`（预建，保留提示给出的路径恒存在）；`finish` 与建夹具失败那一处仍只删 `made.dir`——它现在就是父目录。残留提示改为「自检临时目录删除失败（错误码）：… 仍在——自检只往里写了夹具仓库（含本次自检的审查留痕 .reviews/）与本次自检的运行目录（worker 日志、交接文件与状态文件），没有凭据，请手工删除」。`SelftestResult` 新增 `runRoot`；`--keep-fixture` 与失败时整个父目录保留，保留提示末尾补一行运行目录在哪，两者同父时才说「两者同在 … 下，排查完删这一个目录即可」（计划双审 AGY-03）。
- **`makeFixture`**：同样的父目录结构，`Fixture` 新增 `runRoot`、不预建。父目录在 mkdtemp 一返回就登记进模块级清单，首次调用时挂一次 `process.on('exit')`，进程退出时逐个：每层先 `chmodSync(自身, 0o700)` 再 `readdirSync`、每步吞错（AGY-01 / AGY-02），`rmSync({ recursive, force, maxRetries: 3 })`，删不掉经 `fs.writeSync(2, …)` 打一行（包 try/catch、永不抛，GLM-04）、继续下一个；`TRIVIUM_KEEP_FIXTURES=1` 时不删、打一行列出路径；清单里不像夹具目录的条目不删（防呆）。
- **挂点为什么是进程退出**（计划阶段实测，Node v25.2.1）：`node:test` 的 `after` 与 `process.on('exit')` 在用例通过、抛错、超时时都会触发；但这个 helper 还被 5 份验收脚本（`doc/05_testing/evidence/*/acceptance*.mjs`）import，普通脚本里调 `after` 会顺带起一个测试 harness、往 stdout 打 `ℹ tests 0 …` 汇总。
- **8 行拼 `-runs` 的测试代码**（5 个文件）改取 `fx.runRoot`：`mustread-deny`、`no-artifacts`、`scrub-output-text` 两处、`worktree-hash-cleanup` 两处（不再自己登记夹具）、`gate-loop` 的 `precreateRunDirs` / `statusJsonOf` 改收 `Fixture`（调用点 5 处 + 1 处）。
- **`stub-agent-kit`**：`mkTemp('proj')` 建父目录、夹具仓库与运行根在其下，`after` 删父目录一起带走。
- 产品语义不变：运行根与项目根的包含判断按 `/` 边界（`isUnder`），兄弟目录与父目录下的另一个子目录同样在项目根之外；`repoId` 的桶名由 `trivium-fx-XXXXXX-<哈希>` 变为 `repo-<哈希>`，测试里没有按字面断言桶名的地方。

## 3. 用例

| 组 | 格 | 断言要点 |
| :--- | :--- | :--- |
| ST 自检行为级（`selftest` 集成，打包 CLI，钉私有 `TMPDIR`） | ST1 | 通过：「夹具已清理」，私有 `TMPDIR` 下 `trivium-selftest-*` 为 0（此前会剩一个 `-runs`） |
| | ST2（由 EV-204 S3 改造） | git clean 过滤器在建夹具仓库的 `git add` 时往**父目录**摆只读锁：退 0、`N/N` 步；私有 `TMPDIR` 下只剩那一个父目录、没有兄弟 `-runs`；提示给出的就是父目录（家目录归一 `~`）、措辞含「夹具仓库…运行目录」；不说「夹具已清理」 |
| | ST3 | `--keep-fixture`：`夹具保留在 <父目录>/repo`、运行目录行给出 `<父目录>/runs` 与「两者同在 <父目录>」；`runs/` 下有本次运行的 `status.json`；私有 `TMPDIR` 下只有这一个条目；`payment.ts` 是故意留洞的夹具 |
| | 环境坏掉 | 资产根不存在：退 1、保留整个父目录（私有 `TMPDIR` 下恰一个）；收尾删本格私有目录，不再按输出路径删 |
| S 自检单测（`temp-index-cleanup`） | S1 | 建夹具失败且删不掉：`fixtureRoot` 是 mkdtemp 父目录本身（`dirname` 等于私有 `TMPDIR`）、`runRoot` 为空、提示逐字且以「自检临时目录删除失败」开头、含「夹具仓库…运行目录」 |
| | S2、S4 | 同 EV-204，S4 的合成对象补 `runRoot`（计划双审 GLM-03） |
| | S5 | `renderSelftest` 保留支：同父时整行逐字含「两者同在」；不同父只给运行目录；`runRoot` 为空不打这一行 |
| FC `makeFixture` 收尾（新文件 `fixture-cleanup`） | FC1 | 子进程 `node --test` 跑一个最小测试文件、`TMPDIR` 钉到本格：四个夹具（运行根与仓库里各摆只读子目录 / 父目录自身 `0o500` / 用例自己先删掉 / 无手脚）退出后全部不在，输出不含「没删掉」；子用例另断言运行根与仓库同父、配置里的 `run_root` 等于 `fx.runRoot` |
| | FC2 | `TRIVIUM_KEEP_FIXTURES=1`：两个父目录都在，输出含「保留本进程的 2 个夹具目录」与两个路径 |
| | FC3 | 子用例建两个夹具、结尾把 `TMPDIR` 改成 `0o555`：子进程仍退 0，两个父目录各有一行「夹具目录没删掉，请手工删除 〈父目录〉（EACCES/EPERM）」——一个删不掉不中断后面的（代码双审 GLM-03 补成两个） |
| | FC4 | `makeFixture({ topic: 'a\u0000b' })`：`stageDir` 写盘抛 `ERR_INVALID_ARG_VALUE`（前提断言），建到一半的父目录退出后不在（计划双审 GLM-01：PATH 里没有 git 时 `initFixtureRepo` 不抛，造不出「建到一半」） |

**覆盖边界**：

- 子进程里的 `node --test` 必须去掉继承来的 `NODE_TEST_CONTEXT`：首跑四格全红在「没写出报告」，子进程输出是 `node:test run() is being called recursively within a test file. skipping running files.`、退 0——不去掉的话用例会对着一个什么都没跑的子进程断言。
- FC2 / FC3 同时证明：测试文件进程退出时经 fd 2 打的那一行，在 `node --test` 的进程隔离下能透到运行器输出。
- 被信号杀掉的测试进程不跑退出钩子（残余①），未测。
- 涉及权限的格 root 下跳过；各格只删本格 mkdtemp 的返回值，删前逐层恢复权限。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新增与改动的用例单跑 | `fixture-cleanup` 4/4；`temp-index-cleanup` + `selftest` 集成 17/17；`mustread-deny` + `no-artifacts` + `scrub-output-text` + `worktree-hash-cleanup` + `stub-agent-kit` 41/41；`gate-loop` 104/104；`tsc --noEmit` 退 0 | — |
| 变异预跑（逐条带超时） | 14/14 咬住（`selftest.ts` M1～M7、`test/helpers/fixture.ts` H1～H7），源码逐字节恢复、哨兵已清 | `mutation-spec.r1.json` / `mutation-names-log.r1.txt` / `mutation-names-output.r1.json` |
| 变异装置（`scripts/mutation-check.mjs`，`targets` 含 `test/helpers/fixture.ts`） | 14/14 咬住；基线全绿（3 个套件） | `mutation-output.r1.txt` |
| 全量 `npm run check`（双审前，串行两次） | 两次均 2700/2698/0/2，退 0（较上一题 2694 多 6 格：FC1～FC4、S5，原「通过时清理 / 保留」一格拆成 ST1、ST3）；输出无「没删掉」 | `check-1.txt`、`check-2.txt` |
| `trivium doctor --selftest`（`npm run build` 后跑仓库 bundle） | 14/14、退 0，「夹具已清理」 | `doctor-selftest.r1.txt` |
| 代码双审后：改动用例单跑 | `fixture-cleanup` + `temp-index-cleanup` 14/14；`tsc --noEmit` 退 0 | — |
| 代码双审后：变异（规格按修订后源码重生成，补 H8） | 预跑与装置均 15/15 咬住，M1～M7、H1～H7 红格与双审前一致；基线全绿（3 个套件） | `mutation-spec.json` / `mutation-names-log.txt` / `mutation-names-output.json` / `mutation-output.txt` |
| 代码双审后：全量 `npm run check`（串行两次） | 两次均 2700/2698/0/2，退 0 | `check-3.txt`、`check-4.txt` |
| 代码双审后：`trivium doctor --selftest` | 14/14、退 0，「夹具已清理」 | `doctor-selftest.txt` |
| 系统临时目录三个前缀（验收读数，`count-prefixes.mjs`） | 双审前全量两次与自检前后：`trivium-fx-` 58137（`-runs` 25088）、`trivium-selftest-` 691（`-runs` 685）、`trivium-kit-` 240——**零增长** | `prefix-counts.jsonl` |

`trivium-selftest-` 由开工时的 679 变为 703：多出的 24 个全是本题两轮变异（双审前、双审后各一轮，每轮预跑加装置）留下的。`selftest` 集成文件的前三条用例用真实系统临时目录跑自检：M1 把运行根改回兄弟目录，每跑一次留一个 `-runs`；M2 只删夹具仓库，每跑一次留一个父目录。3 条 × 2 条变异 × 每轮 2 遍 = 12 个一轮，读数与之相符（每轮 `-runs` 加 6、父目录加 6）。均为桩产出、无凭据，与存量一并待用户定。`trivium-fx-` 在变异轮中没有增长（相关用例都钉了私有 `TMPDIR`）。**变异轮之外**（四次全量与两次自检），三个前缀都零增长。

## 5. 变异明细

| 编号 | 变异 | 期望套件 | 红格 |
| :--- | :--- | :--- | :--- |
| M1 | 自检运行根改回夹具仓库的兄弟目录 | selftest 集成 | ST1、ST2、ST3、环境坏掉（4） |
| M2 | `finish` 删夹具仓库而非父目录 | selftest 集成 | ST1、ST2 |
| M3 | 残留提示不提运行目录 | temp-index-cleanup | S1 |
| M4 | 保留时不给运行目录那一行 | temp-index-cleanup | S5 |
| M5 | 失败时不保留（`keep` 去掉 `!ok`） | selftest 集成 | 环境坏掉 |
| M6 | `made.dir` 记成夹具仓库而非 mkdtemp 父目录 | temp-index-cleanup | S1、S2 |
| M7 | 保留提示「两者同在」不判同父 | temp-index-cleanup | S5 |
| H1 | `makeFixture` 不登记父目录 | fixture-cleanup | FC1～FC4 |
| H2 | 权限恢复不先 chmod 自身 | fixture-cleanup | FC1 |
| H3 | 忽略保留变量 | fixture-cleanup | FC2 |
| H4 | 删不掉不打提示 | fixture-cleanup | FC3 |
| H5 | 登记挪到建夹具写盘之后 | fixture-cleanup | FC4 |
| H6 | 配置 `run_root` 改回兄弟目录（返回字段不变） | fixture-cleanup | FC1、FC2、FC3（子用例的配置断言） |
| H7 | 权限恢复遍历读目录失败不吞 | fixture-cleanup | FC1（已被用例删掉的那个误报「没删掉（ENOENT）」） |
| H8（代码双审后补） | 一个父目录删不掉就中断后面的（`break`） | fixture-cleanup | FC3（只剩一行提示） |

## 6. 残余

见 BACKLOG EV-207 结案语：①测试进程被信号杀掉时退出钩子不跑；②存量 `trivium-fx-*` 58137、`trivium-selftest-*` 703（含本题两轮变异留下的 24 个）、`trivium-kit-*` 240 未删、待用户定；③单测自建临时目录的别的前缀另登 EV-208；④`initFixtureRepo` 不查 git 退出码另登 EV-209。另：计划双审是降级轮次（codex 缺席），盲区见计划 r2 §6。

## 7. 代码双审

run `20261004T102427Z`（约 13 分 34 秒，补丁 27 个文件、724.5 KB）。计划阶段缺席的 codex 本轮到场，独立核了登记时点、退出挂点、`writeSync(2)` 永不抛、`/var` 软链下删除用 mkdtemp 原返回值、8 处 `-runs` 改净与桶名无字面断言、5 份验收脚本 import helper 的形态，以及报告读数与证据文件一致。

| 意见 | 严重度 | 裁决 | 落点 |
| :--- | :--- | :--- | :--- |
| GLM-01 `fixtureRoot` 三态无注释 | nit | 接受 | `SelftestResult.fixtureRoot` 补注释：成功后是 `repo/`、建夹具失败且删不掉时是父目录、否则为空串；只作显示，删除只认 `made.dir` |
| GLM-02 三份「恢复权限再整删」重复 | nit | 驳回 | `fixture.ts` 那份是 `fixture-cleanup` 的被测对象，用例自己的收尾若复用它，变异 H2 / H7 会让用例私有目录也删不掉（EV-200 同形）；`selftest.test.ts` 那份还须是异步 |
| GLM-03 「一个删不掉继续删下一个」无覆盖 | nit | 接受 | FC3 子用例建两个夹具，断言两行提示各对应一个父目录；变异补 H8 |

双审后读数：

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 全量 `npm run check`（串行两次） | 两次均 2700/2698/0/2，退 0；输出无「没删掉」 | `check-3.txt`、`check-4.txt` |
| `trivium doctor --selftest`（`npm run build` 后跑仓库 bundle） | 14/14、退 0，「夹具已清理」 | `doctor-selftest.txt` |
| 三个前缀 | 两次全量与自检前后：`trivium-fx-` 58137、`trivium-selftest-` 703、`trivium-kit-` 240——零增长 | `prefix-counts.jsonl` |
