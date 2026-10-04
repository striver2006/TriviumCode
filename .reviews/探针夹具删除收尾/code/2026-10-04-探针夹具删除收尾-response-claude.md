---
schema: trivium.disposition.v1
topic: 探针夹具删除收尾
stage: code
role: claude
kind: response
run_id: 20261004T034428Z
addresses:
  - 2026-10-04-探针夹具删除收尾-codex.md
  - 2026-10-04-探针夹具删除收尾-gemini.md
  - 2026-10-04-探针夹具删除收尾-glm.md
---

# 应答：探针夹具删除收尾 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20261004T034428Z.diff`（相对 HEAD `02dcab2` 的 20 个文件，703.7 KB，大头是证据目录里两次全量的输出）
> ｜ 运行：`20261004T034428Z`（约 9 分 29 秒）
> ｜ 结论：codex **解析回退**（原文 JSON 语法错误；自报 `approve-with-nits`，5 条：次要 3、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 闸门按结构化的 GLM-01 与回退侧的一个待裁决单元 CODEX-F01（codex 的整段原文，内含 CODEX-01～05 五条意见的 JSON）校验；那五条的逐条裁决放在表外 §2
> ｜ 共 6 条：接受 6、驳回 0、暂缓 0（CODEX-01 的接受落点是新登 EV-205，不在本题改生产码）
> ｜ 命令 A 不设人工闸门：按接受项修改后重跑读数、写进报告

## 0. 核实记录

- **GLM-01 ≡ CODEX-04**：成立。W3 的 `countRecursiveRm` 只认 `fs.rm(` 字面与 `recursive: true` 显式写法；`fsp.rm(`（仓里 `cli.ts:9`、`adapters/stub.ts:25` 已有 `promises as fsp` 的别名导入）、`fs.rmSync(`、`fs.promises.rm(`、解构导入的 `rm(`、速记 `{ recursive }` 都漏；`tsFiles` 不递归，两目录将来有子目录也漏。今天两目录里没有这些写法（我放宽后 grep 过：命中的只有三处单文件 `force` 删除与两行注释），所以是守卫盲区、不是现行违规。
- **CODEX-01**：成立。`probeCodexHeader`（`probes/codex.ts`）在 `stopEarly` 里挂的 50 ms `setInterval` 只在见到 header 时清，CLI 不吐 header 就退出时要等 31 秒的兜底 `setTimeout`（它 `unref` 了，轮询本身没有）；`run()` 自然退出那条路径不回调调用方。这是既有行为、与 EV-199 无关，报告 §7 只记了观察没登记，读 BACKLOG 的人看不到。
- **CODEX-02**：成立。`test/unit/probe-verify.test.ts:16` 的 `mkTree` 用 `trivium-probe-` 前缀 mkdtemp、全文件 34 次调用、没有任何收尾；本机系统临时目录已累积 3961 个。前缀与主夹具相同，本题新加的提示恰恰让人去那里按路径找夹具。
- **CODEX-03**：成立。两句提示按现在时断言「其中是探针写的夹具文件（…）与本次探测的临时文件」：递归删除删到一半才失败时括号里点名的文件可能已不在；agy 侧 `scratch_paths=[]` 是常态，CLI 可能根本没落文件。决策二「不做现场查」不变，只需把话说成不依赖现场的上界形式。
- **CODEX-05**：部分成立。`inWorld` 的 finally 用裸 `fs.rm`（失败会抛、用例红，看得见）；`after` 兜底钩子对失败一律 `.catch(() => {})`，静默——与报告「私有根之外无本题残留」的口径不配。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex | — | 接受 | 回退单元是 codex 的整段原文：一句「评审完成」加一份完整的 `trivium.review.v1` JSON（解析回退是 JSON 语法错误，编排器没能取出它），自报 `approve-with-nits`，内含 CODEX-01～05 五条意见（次要 3、吹毛求疵 2），无 blocker / major。逐条核实均成立（CODEX-05 部分成立），全部接受，逐条裁决见 §2 | 见 §2 五条各自的落点 |
| GLM-01 | glm | nit | 接受 | 核实成立（与 codex 原文 CODEX-04 同指）：W3 只认 `fs.rm(` 一种拼写、目录扫描不递归，换个拼写的裸递归删除会让「两目录清零」的锁保持绿。取放宽匹配面，不只在消息里注明：调用点改认 `\brm(?:dir)?(?:Sync)?\(`（任意接收者、解构导入、同步形态都算），递归判据同时认 `recursive: true` 与速记 `recursive` 后跟 `,` 或 `}`；目录扫描改为递归。W3 自测补四格：别名 `fsp.rm`、`rmSync`、速记 `{ recursive }`、解构 `rm(` 均计 1，注释里的单文件示意串计 0 | `test/unit/probe-fixture-cleanup.test.ts` 的 `countRecursiveRm`、`tsFiles`（W1 一并递归）、W3 自测；报告 §3 W 组行与 §5 |

## 2. codex 原文五条的逐条裁决（表外，闸门不按这些编号校验）

- **CODEX-01（minor）接受，落点为新登 BACKLOG EV-205，本题不改生产码**。理由：轮询计时器漏清是 `probeCodexHeader` 与 `run()` 的 `stopEarly` 契约之间的既有缺口，与夹具删除无关；本题决策四定了不改各探针的判据与流程，在命令 A 的 S9 里改生产码又不再经双审，不合适。登记写清形态（`run()` 自然退出不回调调用方，`stopEarly` 里挂的计时器要调用方自己清）、修法二选一（轮询 `unref`，或给 `stopEarly` 契约加 settle 后的收尾钩子）、后果（doctor 收尾若靠事件循环自然退出，codex 不吐 header 时多挂至多 31 秒）与触发条件。按决策六「双审核出新缺口才新登」登记。落点：BACKLOG EV-205；报告 §7 第一条改指 EV-205；设计版本记录 v1.3.83 一行补「另登 EV-205」。
- **CODEX-02（minor）接受，就在本题改（只动测试侧）**。理由：前缀冲突直接削弱本题新提示的可用性（人按提示去系统临时目录时分不清），修法在测试侧、成本低。`mkTree` 的前缀改成 `trivium-pverify-`（不以 `trivium-probe-` 开头——`trivium-probe-verify-` 仍会与主夹具前缀撞），并在该文件加 `after` 钩子整删本轮建的根（带 `maxRetries`，失败打 `console.warn` 不吞）。已堆在系统临时目录里的 3961 个不在本题删，收尾时交用户定（含「按 `trivium-probe-` 前缀、且内容不是夹具」的甄别口径）。落点：`test/unit/probe-verify.test.ts`；RUNBOOK 那一行「不要通配删除」的理由改为「系统临时目录里可能还有早先测试借用 `trivium-probe-` 前缀留下的目录」；报告 §7 第二条改写为已处置。
- **CODEX-03（nit）接受**。理由：措辞应是不依赖现场的上界。三句都把「其中是…」/「其中只有…」改为「其中剩下的只会是…」：主夹具「其中剩下的只会是探针写的夹具文件（哨兵、虚构的对方审查件与假 .env）与本次探测的临时文件，探针没有往里放真实凭据，请手工删除」，记忆夹具同形，codex 隔离探针「其中剩下的只会是探针写的 config.toml 与本次探测的临时文件，没有拷入凭据，请手工删除」。「只会是」是上界：删掉一部分、CLI 没落文件时都仍成立；判据、现场查与其余措辞不变。**这又是对决策二原话的一处改动**，收尾时与计划阶段那三处一并向用户说明。落点：`fixtureResidueText`、`codexIsolationResidueText` 与两处文档块；F2 / F3 / I2 / I3 的字面正则；RUNBOOK 那一行的两句引文；设计 §3.5 段与 `doc/05_testing/README.md` 条目里的转述；报告 §2。
- **CODEX-04（minor）接受**。与 GLM-01 同指，处置合并，落点见表。
- **CODEX-05（nit）接受（部分）**。理由：兜底钩子静默吞掉失败与「私有根之外无残留」的口径不配。改为：`inWorld` 与 `after` 两处收尾都带 `maxRetries: 3`，`after` 钩子失败时 `console.warn` 打出那条根路径、不吞。不改调 `tryRemoveTempDir`：测试侧需要的是「看得见」，`inWorld` 的失败本来就会让用例红。落点：`test/unit/probe-fixture-cleanup.test.ts` 的 `after` 与 `inWorld`。

## 3. 修改方案（命令 A：应答后直接执行）

1. **代码**：`probes/fixture.ts`、`probes/codex.ts` 两个措辞函数与文档块（CODEX-03）。
2. **用例**：`probe-fixture-cleanup.test.ts`——W3 匹配面与递归扫描、W3 自测四格（GLM-01 ≡ CODEX-04），F2 / F3 / I2 / I3 正则（CODEX-03），收尾（CODEX-05）；`probe-verify.test.ts`——前缀与收尾（CODEX-02）。
3. **文档**：BACKLOG 新登 EV-205（CODEX-01）；RUNBOOK 那一行（CODEX-02、CODEX-03）；设计 §3.5 段与 v1.3.83 行（CODEX-01、CODEX-03）；`doc/05_testing/README.md` 条目（CODEX-03）；报告 §2、§3、§4、§5、§7。
4. **读数**：重建后单跑新文件与 `probe-verify`、相关回归；变异按修订后代码重生成规格重跑预跑与装置（双审前读数留 `.r1`）；全量两次（串行）；`doctor --selftest` 一次；写进报告。
5. **不改**：`probeCodexHeader` 与 `run()`（CODEX-01 另登 EV-205）；系统临时目录里已累积的 3961 个目录（交用户定）。
