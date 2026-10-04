# 建仓步骤失败显式化 · 实施报告（EV-209）

> - **日期**：2026-10-05
> - **主题**：`建仓步骤失败显式化`（命令 A `/dual-run`，Driver claude）
> - **起点**：`3b2626c`（`main`，工作树干净）
> - **计划**：`.reviews/建仓步骤失败显式化/plan/` r2（计划双审第 1 轮 run `20261004T160118Z`：codex `approve-with-nits`（次要 2、吹毛求疵 1）、gemini `request-changes`（重要 2、次要 2）、glm `approve-with-nits`（次要 1、吹毛求疵 1），9 条全接受）
> - **证据目录**：`doc/05_testing/evidence/fixture-repo-init-20261005/`
> - **代码双审**：见 §6
> - **配额**：全程零配额：只用本机 git、假 git（`test/helpers/fake-git.ts`）与四侧假入口；不跑任何真实 CLI、不跑真实 doctor

## 1. 问题

`src/trivium/util/git.ts` 的 `initFixtureRepo` 是六条裸 `await run('git', …)`（初始化、三条配置、暂存、基线提交），返回值一个都不看；`run` 在 git 启动失败时只 resolve、`code` 为 null，非零退出同样不抛。git 缺失或某一步失败时静默建出残缺的夹具：

- 探针夹具（`probes/fixture.ts` 的 `createFixture` / `createMemoryFixture`）随后在工作树哈希处抛出，已建的 `trivium-probe-*` 目录无人删（EV-199 残余 ①）；五个调用点都在各侧 try 之外，doctor 的四段探针调用也没有 try，于是崩成「内部错误」，后面的侧一个都不探；
- 自检建仓不抛，失败推迟到后面的步骤、以晦涩的方式出现。

另：三条 `config` 不设超时，git 卡住会让调用方永远等下去。

## 2. 甄别（计划 r2 §1.2）

任务目标「现状二」说 `hooks.test.ts` 的 `gitCtx` 对空目录建仓，**实测不成立**——`fakeCtx` 先写了 `.trivium/config.yaml`。用记录型 git 包装（只记基线提交的 cwd 与真实退出码、其余透传）`PATH` 前置跑一遍全部单测：2708 / 2706 / 0 / 2；基线提交共 535 次，534 次退 0，唯一退 1 的是 `hook-config.test.ts`「配置被 .gitignore 忽略时如实说…」的 `ignored=false` 一轮（空目录），它的断言只看 git 的忽略规则、与 HEAD 无关。生产侧三处建仓前都写了文件。由此取 `--allow-empty`（决策二主选）。

## 3. 改了什么

1. **`initFixtureRepo`**（决策一）：六步写成导出的步骤表 `FIXTURE_REPO_STEPS`，逐步跑、逐步判，第一步失败即抛、后面不再跑；每步 30 s 超时（`FIXTURE_GIT_TIMEOUT_MS`）；签名不变。文案由导出的纯函数 `fixtureRepoStepError(序, RunResult)` 成文：`建仓第 N/6 步「步骤名」失败：原因[：git 输出头三行]`，原因按 超时 → 启动失败 → 信号 → 非零退出 的顺序判（超时那次 `signal` 通常也非空，计划双审 AGY-03）；输出头三行取 stderr，stderr 为空时取 stdout（`git commit` 无内容可提交时那句在 stdout）。
2. **`--allow-empty`**（决策二）：基线提交恒带它，建出来的仓库恒有 HEAD。
3. **探针夹具**（决策三）：两个工厂共用骨架 `buildFixtureRoot`，建临时目录 → 写内容 → 建仓 → 基线哈希（显式带 30 s 预算，计划双审 CODEX-02）任一步抛出，就删掉已建目录（`removeFixtureRoot` → `tryRemoveTempDir`，只删 mkdtemp 的返回值）、抛 `ProbeFixtureError`（`kind`、`residue`、`cause`）；`message` 为「建探针夹具失败：原因」，删不掉时接「；探针夹具删除失败（错误码）：… 仍在…」整句。建临时目录本身失败也包成它。成功路径返回值不变。
4. **doctor**（决策四）：`guardFixture(cli, fn, onFail)` 只接 `ProbeFixtureError`——推一条 blocker、返回 null，该侧不赋值、不 checkpoint，落盘结论原样保留；别的异常原样重抛。blocker：「〈显示名〉（〈cli〉）本轮没有探测成：建探针夹具失败：…。该侧落盘的探针结论原样保留（从未探过则仍为空），修好后重跑 trivium doctor --only 〈cli〉」，不按是否启用为审核者分档。末尾「已登记但尚无探针实现」那一圈跳过夹具失败侧。四段正文只多一层缩进（以忽略空白看 diff）。
5. **claude 记忆夹具**（计划双审 AGY-01）：`probeClaude` 在 `createMemoryFixture()` 处接住 `ProbeFixtureError`，`project_memory_blocked` 保持原值、主夹具各格照常返回，返回值新增 `memoryFixtureFailure`；doctor 据此出一条 **warning**（「Claude Code（claude）项目记忆一格本轮没有探测成：…」），不拦——这一格不进 `availability()` 与预检，与 EV-196「单格本轮未刷新」同档。
6. **自检**（决策五）：不改代码，建仓失败经既有 catch 落成「创建夹具仓库」失败步骤，`detail` 是新文案，临时目录照旧删掉。
7. **测试注入口 `DoctorOptions.probeBins`**（**计划外**，见 §4 第 1 条）。
8. 文档：BACKLOG EV-209 结案、EV-199 残余 ① 补指向；设计 §3.5 补一段、v1.3.87；RUNBOOK §五 补一行。

不改：`util/exec.ts` 的 `run`、各探针的判据与结论、自检代码、测试侧既有调用方。

## 4. 与计划的出入

1. **新增 `DoctorOptions.probeBins`**：计划 §3 写「codex / claude 放进 `PATH` 的 `bin/`」，做不到——`probeCodexBin(null)` 的候选表里 `/opt/homebrew/bin/codex` 排在家目录与 `which` 之前，本机那里就是真实 codex，经 `runDoctor` 跑 codex 段的用例（D3、D5）会拉起真实 CLI、花配额。照 `zcodeProbe` 的先例开一个只供测试的入口注入口（`{ codex?, claude? }`），生产路径不传、即原来写死的 null，行为不变。
2. **变异 M16 删去**：「夹具失败侧照样写回 `probe.cli[侧]`」——该侧在内存里仍是传入的旧结论，写回去与不写在落盘上没有可观察的差别（`checkpoint` 写的就是同一份），构造不出能区分的变异。
3. **预期红格的出入**（§5 变异表）：M1 计划写含 P4，实际不红——P4 的失败在工作树哈希那一步、不经建仓判定，是计划写错；M4 多红 P3（P3 逐字比对文案）与 U11；M7 多红 P5、M8 多红 P6（不删目录就没有残留提示，`residue` 为 null）；M10 / M11 多红 D8（D8 直测 `guardFixture`）。

## 5. 用例与读数

新文件 `test/unit/fixture-repo-init.test.ts`（28 格）、`test/integration/selftest.test.ts` 新增 S1 / S2、新助手 `test/helpers/fake-git.ts`。每格在 `scratchDir` 建私有根，钉 `HOME`、`TMPDIR`、`PATH`。

| 组 | 格 | 断言要点 |
| :--- | :--- | :--- |
| U 建仓直测 | U1 / U2 | 有内容：HEAD 与提交树；空目录：HEAD 有值、树为空树 |
| | U3 | `PATH` 无 git：第 1 步「git 启动失败（spawn git ENOENT）」逐字 |
| | U4～U9 | 假 git 让第 1～6 步各退 128：文案逐字（步骤名、退出码、stderr 头三行、第四行不在），调用日志恰为前 N 步 |
| | U10 | stderr 为空时原因取 stdout |
| | U11 | 合成 `RunResult` 直测：超时先于信号、信号、启动失败（有无 spawn 消息）、无输出的非零退出 |
| P 夹具工厂 | P1 / P2 | 两个工厂提交基线失败：`ProbeFixtureError`、`kind`、`residue` 为 null、文案逐字、无残留 |
| | P3 / P4 | `PATH` 无 git；工作树哈希那次暂存失败：无夹具、无 `trivium-index-` 残留 |
| | P5 / P6 | 失败且删不掉（假 git 失败前在夹具根摆只读锁）：`residue` 等于 `fixtureResidueText(kind, 路径, 'EACCES')`（家目录归一）、接在原因后面 |
| | P7 | `TMPDIR` 不存在：建临时目录失败也包成 `ProbeFixtureError` |
| D doctor 层 | D1～D4 | `only` 依次四侧、第 1 次提交失败：不抛、恰一条该侧 blocker（逐字）、内存与落盘的该侧结论都是预置旧值、无残留 |
| | D5 | 全段、第 1 次提交失败（agy）：agy 一条 blocker；zcode / codex / claude 都探过（`probed_at` 晚于用例开始、版本号刷新、已落盘） |
| | D6 | `only: claude`、第 2 次提交失败（记忆夹具）：一条 warning（逐字）、没有夹具 blocker；主夹具各格已刷新、`project_memory_blocked` 仍是预置值 |
| | D7 | 盘上从没有 agy 结论：一条 blocker、notes 里没有「尚无探针实现」 |
| | D8 | `guardFixture` 直测：普通异常原样重抛、不记失败；`ProbeFixtureError` 返回 null、blocker 逐字 |
| | D9 | `only: zcode` 且 `--no-model-calls`：zcode 仍建夹具，失败照样一条 blocker |
| | 措辞 | 记忆格 warning 逐字 |
| S 自检 | S1 / S2 | 打包 CLI：假 git 让提交基线失败 / `PATH` 无 git——退 `EXIT.FAIL`、「创建夹具仓库」失败、原因是具体那一步、私有 `TMPDIR` 无 `trivium-selftest-` |

**覆盖边界**：「六步与工厂里的 `workTreeHash` 真的带了 30 s」没有行为级用例（要等满 30 s）；U11 只测判定顺序与文案。假入口替身的是 CLI 的应答，真实 CLI 下的端到端未跑（零配额）。

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新用例 | 28/28；自检 S1 / S2 通过 | — |
| 相关回归（`probe-fixture-cleanup`、`temp-index-cleanup`、`hooks`、`zcode-doctor-probe-home`、`preflight`、`claude-structured-probe`、`zcode-provider-env`、`scratch-guard`、`claude-events`、`deny-matrix`） | 336/336 | — |
| `hook-config`（含唯一空目录建仓那格）+ `selftest` | 32/32 | — |
| 变异预跑（逐条带超时） | 16/16 咬住；源码逐字节恢复 | `mutation-spec.json` / `mutation-names-log.txt` / `mutation-names-output.json` |
| 变异装置（`scripts/mutation-check.mjs`） | 16/16 咬住，fail 数与预跑逐条一致；基线全绿（1 个套件） | `mutation-output.txt` |
| 全量 `npm run check`（双审前，串行两次） | 两次均 2738/2736/0/2，退 0（较改前 2708 多 30：新文件 28、S1 / S2） | `check-1.txt`、`check-2.txt` |
| `trivium doctor --selftest`（`npm run build` 后跑仓库 bundle） | 14/14、退 0 | `doctor-selftest.txt` |
| 系统临时目录新建 `trivium-` 条目（按 `birthtimeMs`） | 全量一 0 个；全量二 1 个（`trivium-index-`）；自检 0 个 | `count-new-*.txt` |

**变异逐条**（预跑与装置 fail 数一致）：

| 编号 | 变异 | fail | 红的格 |
| :--- | :--- | :--- | :--- |
| M1 | 步骤结果不看 | 21 | U3～U10、P1～P3、P5、P6、D1～D7、D9；亦红自检 S1、S2 |
| M2 | 启动失败不算失败 | 2 | U3、P3；亦红 S2 |
| M3 | 去掉 `--allow-empty` | 1 | U2；亦红 `hook-config` 那一格（计划双审 CODEX-01） |
| M4 | 文案丢步骤名 | 10 | U3～U11、P3 |
| M5 | stderr 为空不退回 stdout | 1 | U10 |
| M6 | 第一步失败后不停 | 5 | U4～U8 |
| M7 | main 失败不删目录 | 10 | P1、P3、P4、P5、D1～D5、D9 |
| M8 | memory 失败不删目录 | 3 | P2、P6、D6 |
| M9 | 不接残留提示 | 2 | P5、P6 |
| M10 | `guardFixture` 不接 | 8 | D1～D5、D7、D8、D9 |
| M11 | 接住不推 blocker | 8 | D1～D5、D7、D8、D9 |
| M12 | 连普通异常也吞 | 1 | D8 |
| M13 | 「尚无探针实现」不排除失败侧 | 1 | D7 |
| M14 | 记忆夹具不在探针内接住 | 1 | D6 |
| M15 | 不推记忆格 warning | 1 | D6 |
| M17 | 信号先于超时 | 1 | U11 |

## 6. 代码双审

run `20261004T165118Z`（三侧到齐，14m7s）：codex `approve`、gemini `approve`、glm `approve`，**三侧均零意见**，应答件裁决表为空、无代码改动，`gate --check` 通过。三侧都回到 `checkpoint` 实现核了「失败侧落盘不动」，逐侧核了建夹具在早退之后、模型调用之前，glm 核了 `probeBins` 的唯一生产调用点不传它；共同盲区与 §5 覆盖边界、§8 残余一致。

**一次取消的运行**：代码双审先起过 run `20261004T164957Z`，`--goal` 只传了任务目标第一段（201 字），发现后即 `--cancel`（留痕 cancelled），以全文重启为上面那一轮。被取消的那次把主题任务文件里的目标（计划阶段写入的 2410 字全文）改成了截断版，重启时**没有写回**——任务文件由编排器独占，会话里不改，待用户定是否恢复。两轮 BRIEF 的「任务目标：」行逐字相同（BRIEF 只展示开头 206 字），审查员看到的目标不受影响。

代码双审后无代码改动，§5 读数即最终读数；S10 `trivium verify` 的结果见 §7。

## 7. 出口验证

`trivium verify --topic 建仓步骤失败显式化`（run `20261004T170715Z`）：`npm run typecheck`、`npm run build`、`npm test` 三条全过，282 s；测试 2738 / 2736 / 0 / 2。verify 期间（2026-10-04T17:07:12Z 起）系统临时目录新建 `trivium-` 条目 0 个（`count-new-verify.txt`）。留痕 `.reviews/建仓步骤失败显式化/verify/`。

## 8. 残余

1. 进程在建夹具中途被杀时 catch 不跑，目录照旧遗留（同 EV-204 残余五）。
2. codex 隔离探针 `probeCodexIsolation` 自己的 `mkdtemp` 失败仍抛穿（EV-199 残余 ① 的另一半，不经夹具工厂）。
3. 超时接线无行为级用例（§5 覆盖边界）。
4. git 不可用时 doctor 会出 5 条 blocker（环境段一条、四侧各一条），同一根因多条，取舍见计划 r2 §2.4。
