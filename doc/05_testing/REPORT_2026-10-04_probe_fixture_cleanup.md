# 探针夹具删除收尾 · 实施报告（EV-199）

> - **日期**：2026-10-04
> - **主题**：`探针夹具删除收尾`（命令 A `/dual-run`，Driver claude）
> - **起点**：`02dcab2`（`main`，工作树干净）
> - **计划**：`.reviews/探针夹具删除收尾/plan/` r2（计划双审第 1 轮 run `20261004T025901Z`：codex `request-changes`（重要 1，另 5 条因缺 `layer` 字段逐条降级）、gemini `approve`（零意见）、glm `approve-with-nits`（吹毛求疵 1），7 条全接受；另登 EV-204）
> - **证据目录**：`doc/05_testing/evidence/probe-fixture-cleanup-20261004/`
> - **代码双审**：见 §5
> - **配额**：全程零配额（用户决策七）：夹具直测只用本机 git；四个探针函数经假入口（zcode 经 `invoke` 注入口）跑到外层 finally，不拉任何真实 CLI；不跑真实 doctor

## 1. 问题

两个夹具工厂（`probes/fixture.ts` 的 `createFixture` / `createMemoryFixture`）的 `cleanup` 与 codex 隔离探针（`probes/codex.ts` 的 `probeCodexIsolation`）的 finally 都是 `fs.rm(…, { recursive: true, force: true })`。`force` 只吞 ENOENT：ENOTEMPTY / EBUSY / EACCES 会从各侧探针函数的外层 finally 抛出、顶替探针返回值，穿过 `runDoctor`，本轮已探的结论在 checkpoint 前丢失，doctor 崩成「内部错误」。`cleanup` 的调用点五处（`probes/agy.ts`、`probes/claude.ts` 主夹具与记忆夹具、`probes/codex.ts`、`probes/zcode.ts`），四侧共用。

按登记口径（`src/trivium/probes`、`src/trivium/adapters` 两目录里带 `recursive: true`、不带 `maxRetries` 的 `fs.rm`）派生，改前恰三处；BACKLOG 原文「四处」数错，结案时已改准。

## 2. 改了什么

1. **夹具工厂**（决策一）：`Fixture.cleanup` 由 `() => Promise<void>` 改为 `() => Promise<string | null>`，两个工厂都经内部的 `removeFixtureRoot(kind, root)` 调 `tryRemoveTempDir(root, [])`：删成功 null，删不掉返回 `fixtureResidueText(kind, root, code)`。只删 `makeTempDir` 的返回值；没有凭据副本可查，不做现场查。
2. **五处调用点**：一律 `const fixtureResidue = await <夹具>.cleanup(); if (fixtureResidue) notes.push(fixtureResidue);`。`notes` 数组在 return 之前已被返回值引用，finally 里推的一条调用方拿得到（含 try 里提前 return 的分支）。删除成功时 notes 不多推任何东西，doctor 输出逐字不变。
3. **codex 隔离探针**（决策三）：原 try / catch 搬进判定本体 `judgeCodexIsolation`（catch 仍落 `'shared'`），`probeCodexIsolation` 只管建与删，返回 `{ isolation, tempDirResidue }`；`probeCodex` 取 `isolation` 落盘、提示推进 notes。`isolation` 只取判定本体的返回值，结论不因删不掉而改变；finally 里不 return，判定将来若会抛，异常照常上抛。
4. **措辞**（决策二；计划阶段按实收窄三处、三侧均认可，代码双审后再把「其中是 / 其中只有」改为上界「其中剩下的只会是」）：
   - 主夹具：「⚠️ 探针夹具删除失败（错误码）：路径 仍在，其中剩下的只会是探针写的夹具文件（哨兵、虚构的对方审查件与假 .env）与本次探测的临时文件，探针没有往里放真实凭据，请手工删除」；
   - 记忆夹具：括号里换成「哨兵与项目记忆 CLAUDE.md」——**记忆夹具里没有 `.env`**，决策二原话「哨兵与假 .env」对它不成立；
   - 两句都补「与本次探测的临时文件」：各侧 CLI 以夹具根为 cwd 运行、会往里落文件（§3.5 的 `scratch_paths` 正为此而设），原话「只有探针夹具文件」说过头；「没有真实凭据」改为「探针没有往里放真实凭据」——CLI 落的文件探针没有逐个看过，可核的是探针自己没放；
   - codex 隔离探针：「⚠️ codex 隔离探针临时目录删除失败（错误码）：路径 仍在，其中剩下的只会是探针写的 config.toml 与本次探测的临时文件，没有拷入凭据，请手工删除」——原话「本次 CLI 产物」改为「本次探测的临时文件」：基线不通时对照那次不跑，目录里只有 `config.toml`（同 EV-200 代码双审 CODEX-02 的关切）；
   - 「剩下的只会是」是上界（代码双审 r1 CODEX-03）：递归删除删到一半才失败时括号里点名的文件可能已不在，CLI 也可能没落任何文件，上界在这两种情形下都仍成立；
   - 路径一律家目录归一 `~`（决策二原话对 codex 那句没写，照夹具一句同样归一）。

不改：各探针的判据与结论、`ProbeIsolation` 的取值、doctor 的 checkpoint 与退出码、`tryRemoveTempDir`、夹具内容与建法（决策四）。

## 3. 用例

新文件 `test/unit/probe-fixture-cleanup.test.ts`，22 格。每格 mkdtemp 一个私有根，钉 `HOME=<根>/home`、`TMPDIR=<根>/home/tmp`（家目录归一测得出 `~/tmp/…`）；收尾在 finally 里重新列 `TMPDIR` 恢复 `locked/` 权限再整删私有根。涉及权限的格 root 下跳过。

**摆锁法**：在目标目录下建 `locked/`、先放文件 `f`、再改 0o500。E / I 组的假入口被调到时扫钉住的 `TMPDIR`，给名字以所列前缀开头的目录上锁，不靠 cwd 找夹具——claude 的主夹具与记忆夹具先后存在，各自活着时各自上锁；开了锁却一个也没锁到就退 3。

| 组 | 格 | 断言要点 |
| :--- | :--- | :--- |
| F 夹具直测 | F1 / F4 | 主夹具、记忆夹具删成功：`cleanup()` 返回 null、根目录不在 |
| | F2 / F3 | 删不掉：不抛、返回值按字面正则匹配整句（家目录归一 `~`、内容说明分主夹具与记忆夹具、记忆夹具一句不含 `.env`），且等于 `fixtureResidueText` 的输出 |
| | F5 | 删不掉后恢复权限再 `cleanup()`：返回 null、收干净 |
| I 隔离探针直测 | I1 | 基线通、对照翻转、删成功：`{ home_copy, null }`、无残留、两次调用依次是基线与对照 |
| | I2 / I3 | 删不掉：不抛、结论分别仍是 `home_copy` / `shared`，提示按字面正则匹配整句、等于 `codexIsolationResidueText` 的输出 |
| | I4 / I5 | 基线不通、入口不存在：`{ shared, null }`、对照没跑、目录已删 |
| E 探针端到端 | E1 / E1b | `probeClaude`：两个夹具都删不掉时 notes 里恰有主夹具、记忆夹具各一条提示；删成功时没有「删除失败」字样、无残留 |
| | E2 / E2b | `probeAgy`：恰一条主夹具提示；对照无提示、无残留 |
| | E3 / E3b | `probeZcode`（`invoke` 注入口的桩在夹具活着时上锁、答失败，探针在夹具 try 里当场返回）：恰一条主夹具提示；对照无提示、无残留 |
| | E4 / E4b | `probeCodex`：隔离探针提示与夹具提示各一（隔离探针在 try 里先推、夹具在 finally 里后推），`isolation` 仍 `home_copy`；对照无提示、无残留、`isolation` 照常 `home_copy` |
| W 源码结构 | W1 | `src/trivium/probes/` 全部 `.ts` 里每一处 `.cleanup()` 都接住提示并推进 notes；总数大于 0；每个文件收的夹具数不少于建的（论域从目录派生，计划双审 CODEX-03） |
| | W2 | `probeCodex` 里隔离探针调用恰一处，结论落盘与推 notes 紧随其后 |
| | W3 自测 / W3 | 括号配平截取实参（计划双审 GLM-01）；匹配面认形态不认名字（代码双审 GLM-01 ≡ CODEX-04）：`rm` / `rmdir` 及其 `Sync` 形态、任意接收者（`fs.` / `fsp.` / `fs.promises.`）或解构导入，递归判据认 `recursive: true` 与速记 `{ recursive }`；自测 8 条（嵌套括号、别名、同步、速记、解构计 1，单文件 `force` 与注释示意串计 0）；`probes` 与 `adapters` 两目录（递归扫描）里的递归删除为 0 |

**五处接线全部有行为级用例**（E1 覆盖 claude 两处、E2～E4 各一处），没有一侧需要按计划 §2.4 的兜底规则退回结构断言。r1 曾以为「要拉真实 CLI 才走得到 finally」，计划双审 CODEX-01 指出与仓库事实相反（`claude-structured-probe`、`zcode-doctor-probe-home` 已有假入口装置），r2 据此改。

**覆盖边界**：

- 摆锁拿到的都是 EACCES，而 `fs.rm` 的 `maxRetries` 只对 EBUSY / EMFILE / ENFILE / ENOTEMPTY / EPERM 重试——这些用例测到的是「不抛 + 提示带错误码」，**没有测到「重试三次」**（计划双审 CODEX-06）；后者是 `tryRemoveTempDir` 的既有行为，本题不改。
- E 组的期望提示用措辞函数算出（路径要从私有根重新列），所以只守「提示在不在、是不是那一句」；整句字面由 F2 / F3 / I2 / I3 的正则守。变异 M3 / M12（去掉家目录归一）因此只红 F / I 组，见 §4。
- E 组替身的是 CLI 的应答，跑的是同一段探针代码；真实 CLI 下的端到端仍未跑（零配额）。
- doctor 自检用自己的 `trivium-selftest-` 夹具与桩适配器、不经 `probes/fixture.ts`，在本题只作「流水线未被改坏」的冒烟，不作 EV-199 删除收尾路径的证据（计划双审 CODEX-04）。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新用例 | 22/22，约 8 秒 | — |
| 相关回归（`claude-events` 含 EV-44 源序断言、`claude-structured-probe`、`codex-auth-probe`、`zcode-doctor-probe-home`、`zcode-provider-env`、夹具消费方 `deny-matrix`） | 140/140；私有根之外无本题残留 | — |
| 变异预跑（逐条带超时） | 14/14 咬住；源码逐字节恢复 | `mutation-spec.json` / `mutation-names-log.txt` / `mutation-names-output.json` |
| 变异装置（`scripts/mutation-check.mjs`） | 14/14 咬住，fail 数与预跑一致；基线全绿（1 个套件） | `mutation-output.txt` |
| 全量 `npm run check`（双审前，串行两次） | 两次均 2678/2676/0/2（较上一题多出的 22 即本题新文件），退 0 | `check-1.txt`、`check-2.txt` |
| `trivium doctor --selftest`（`npm run build` 后跑仓库 bundle `skills/dual-critic/scripts/trivium.cjs`） | 双审前 14/14、退 0（冒烟，见 §3 覆盖边界） | `doctor-selftest.r1.txt` |
| 代码双审后：新用例 + `probe-verify` 单跑 | 50/50（22 + 28）；系统临时目录无 `trivium-pverify-` 残留 | — |
| 代码双审后：变异（规格按修订后源码重生成） | 预跑与装置均 14/14，红格逐条与双审前一致；双审前读数留 `.r1` | `mutation-spec.json` / `mutation-names-log.txt` / `mutation-names-output.json` / `mutation-output.txt`（双审前为同名 `.r1`） |
| 代码双审后：全量 `npm run check`（串行两次） | 两次均 2678/2676/0/2，退 0；这两次全量期间系统临时目录未再新增 `trivium-probe-*`（双审前两次各添 36 个，见 §7） | `check-3.txt`、`check-4.txt` |
| 代码双审后：`trivium doctor --selftest`（`npm run build` 后跑仓库 bundle） | 14/14、退 0 | `doctor-selftest.txt` |

**变异逐条**（规格 `gen-mutation-spec.mjs` 生成，find 串逐条核唯一、替换串无特殊替换模式）：

| 编号 | 变异 | 红的格 |
| :--- | :--- | :--- |
| M1 | 主夹具 `cleanup` 退回裸递归删除 | F2、F5、E1、E2、E3、E4、W3（7） |
| M2 | 记忆夹具同上 | F3、E1、W3（3） |
| M3 | `fixtureResidueText` 去掉家目录归一 | F2、F3（2） |
| M4 | 删成功也返回提示 | F1、F4、F5、E1b、E2b、E3b、E4b（7） |
| M5 | 记忆夹具取主夹具那句 | F3、E1（2） |
| M6 | 隔离探针 finally 退回裸递归删除 | I2、I3、E4、W3（4） |
| M7 | 删不掉时把结论改成 `shared` | I2、E4（2） |
| M8 | `probeCodex` 不推隔离探针提示 | E4、W2（2） |
| M9 | agy 调用点不推夹具提示 | E2、W1（2） |
| M10 | claude 记忆夹具调用点不推提示 | E1、W1（2） |
| M11 | zcode 调用点不推夹具提示 | E3、W1（2） |
| M12 | `codexIsolationResidueText` 去掉家目录归一 | I2、I3（2） |
| M13 | codex 夹具调用点不推提示 | E4、W1（2） |
| M14 | claude 主夹具调用点不推提示 | E1、W1（2） |

与计划 §2.6 的预期出入：M3 / M12 计划写了 E 组也红，实际只红 F / I 组（原因见 §3 覆盖边界第二条）；M1 / M4 另多红 F5（删不掉后恢复权限的那一格同样依赖 `cleanup` 不抛、删成功返回 null）。

## 5. 代码双审

run `20261004T034428Z`（约 9 分 29 秒）：codex **解析回退**（原文 JSON 语法错误；自报 `approve-with-nits`，5 条：次要 3、吹毛求疵 2）、gemini `approve`（零意见）、glm `approve-with-nits`（吹毛求疵 1）。闸门按 GLM-01 与回退单元 CODEX-F01 校验，codex 原文五条在应答件（`.reviews/探针夹具删除收尾/code/` 的 `response` 件）表外逐条裁决，6 条全接受：

- **CODEX-03**：三句提示由「其中是 / 其中只有」改为上界「其中剩下的只会是」（§2 第 4 条）。**这是对决策二原话的又一处改动**，与计划阶段那三处一并在收尾时向用户说明。
- **GLM-01 ≡ CODEX-04**：W3 的匹配面放宽、目录扫描改递归，自测补五条（§3）。
- **CODEX-02**：`test/unit/probe-verify.test.ts` 的临时树前缀由 `trivium-probe-` 改为 `trivium-pverify-`（`trivium-probe-verify-` 照样与夹具前缀撞），并补 `after` 收尾；RUNBOOK「不要通配删除」的理由改写。系统临时目录里已累积的那批不在本题删（§7）。
- **CODEX-05**（部分）：本题测试的两处收尾带 `maxRetries`，兜底钩子删不掉时打出路径、不吞。
- **CODEX-01**：`probeCodexHeader` 的轮询计时器漏清另登 **EV-205**，本题不改生产码（§7）。

改后读数见 §4。

## 6. 残余

1. **建夹具到一半抛出**（如 `git init` 失败）或隔离探针 `mkdtemp` 本身失败：已建目录随异常遗留、异常照旧抛穿（计划 §0 不做第三条，同 EV-197 残余 ①）。
2. **提示只在当次 doctor 的 notes 里可见**（同 EV-86 / EV-198 形态）。
3. **两目录之外的同族裸递归删除**（另登 EV-204，计划双审 CODEX-02）：本题的清零与 W3 只管 `src/trivium/probes`、`src/trivium/adapters`。之外的 `util/git.ts:121`（`workTreeHash`）在探针路径上——建夹具、agy / zcode 的 scratch_paths 比对都调它——删不掉同样会崩 doctor；它同时是送审冻结、漂移复算、工作树摘要与构建标识的取值点，该不该吞要逐个调用方定，不在本题口径内。`selftest.ts` 两处同登；`retention` / `install` / `lock` 三处只列名待甄别。

## 7. 实施中的观察

1. **`probeCodexHeader` 的轮询计时器**（代码双审后登记为 EV-205）：`stopEarly` 里 50 ms 的 `setInterval` 只在见到 header 时清掉，CLI 不吐 header 就退出时，它要等 31 秒的兜底 `setTimeout` 才清（兜底那个 `unref` 了，轮询本身没有），期间事件循环不空。E4 起初因此单格多耗约 30 秒，测试侧让假 codex 在 exec 调用时吐一段最小 header 规避。生产上 doctor 收尾若依赖事件循环自然退出，codex 不吐 header 时会多挂至多 31 秒——与本题无关，本题不改；代码双审 CODEX-01 建议登记，已登 EV-205。
2. **测试借用夹具前缀、且不收尾**：`test/unit/probe-verify.test.ts:16` 用 `trivium-probe-` 前缀在系统临时目录建目录、从不删除，本机系统临时目录里本题开工时已累积 3961 个，双审前两次全量又各添 36 个、现为 4033 个（双审后改掉前缀，后两次全量未再新增；除下文那 1 个之外，内容都是 `pyproject.toml`、`uv.lock` 之类的构建配置树，不是探针夹具、没有凭据）。前缀与主夹具相同，人按提示去系统临时目录看时容易混淆。代码双审 CODEX-02 后已处置：该文件改用 `trivium-pverify-` 前缀并补收尾，不再新增；**已累积的那批未删**，交由用户定（甄别口径：真夹具根下的 `README.md` 含开放哨兵 `SENTINEL_OPEN_7f3a2b`；不能按有没有 `.git/` 判——`probe-verify` 的树里也建 `.git/modules/…`。按哨兵查，本机 4033 个里恰有 1 个是真夹具残留：`trivium-probe-5BkVBW`，2026-09-30 18:00，`.env` 里只有哨兵，成因未查——可能正是本题修的这类删除失败，也可能是当时的进程被中断）。
