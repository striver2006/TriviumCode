# 临时索引与清扫删除收尾 · 实施报告（EV-204）

> - **主题**：`临时索引与清扫删除收尾`（命令 A `/dual-run`，Driver claude）
> - **起点**：`e00a1e2`（`main`）
> - **计划**：`.reviews/临时索引与清扫删除收尾/plan/` r2（计划双审第 1 轮 run `20261004T055413Z`，12 条：接受 10、驳回 1、暂缓 1）
> - **代码双审**：第 1 轮 run `20261004T063823Z`（命令 A 的 S6）因 codex 侧服务端 429 限流、未带 `--allow-single` 整次判失败（gemini `approve`、glm 一条吹毛求疵）；命令 C 重跑 run `20261004T071443Z`：codex（`k3`）`approve-with-nits`、gemini `approve`、glm `approve-with-nits`，2 条吹毛求疵全接受（CODEX-01：RUNBOOK 新行的 `~` 归一限定到前两种提示；GLM-01：自检 `finish` 去掉 `made.dir` 非空断言、为 null 时显式短路），用户审批后实施
> - **设计**：主设计 v1.3.84（§9.2 补一条要点、§10.5 补一句）
> - **证据**：`doc/05_testing/evidence/temp-index-cleanup-20261004/`
> - **配额**：零。只用本机 git、桩适配器（`TRIVIUM_STUB_CRITIC`）与打包后的 CLI；不跑真实 doctor

## 1. 问题

EV-199 把 `src/trivium/probes`、`src/trivium/adapters` 两目录里的递归删除清零之后，两目录之外仍有同族的「递归删除加 `force`、不带 `maxRetries`」：`force` 只吞 ENOENT，ENOTEMPTY / EBUSY / EACCES 照样从 finally 抛出、顶替原结果。

- **`workTreeHash`**（`util/git.ts`）最要紧：它是送审冻结、跑后漂移复算、审批时的工作树摘要、构建标识与探针的取值点。删不掉时哈希已经算出来却被删除异常顶替；git 某一步失败时，删除异常还会顶替真正的失败原因。漂移复算那一处没有兜底，异常穿出 `executeRun`，worker 把整次运行判 failed，各侧已花配额的结论作废。
- **自检**（`selftest.ts`）两处：建夹具失败那一处其实**走不到**——`root = await buildFixture()` 抛出时赋值不发生，`root` 恒为 `''`，catch 里的删除从不执行，建到一半的目录无人清理（登记与任务目标写的「会顶替建夹具失败的原因」与代码不符）；`finish` 那一处删不掉就抛，而调用处是不带 `await` 的 `return finish(…)`，拒绝不进同一个 try 的 catch，直接穿出 `runSelftest`，一次已经得出结论的自检崩成内部错误。
- **保留期到期整删**（`retention.ts`）：在逐目录循环里，一个目录删不掉就抛出整个 `pruneRunDirs`，会话启动 Hook 只记一条「清扫本身失败」；排在后面的目录既不整删也不抹凭据，只要它还在，每次开会话都卡在同一处。

## 2. 改了什么

1. `workTreeHash` 的 finally 改调 `tryRemoveTempDir(tmpDir, [])`（重试三次、失败不抛）：哈希已算出就照常返回，git 某一步失败或超时抛的仍是原始错误。签名与八处调用方不动。删不掉时 stderr 提示一行，同一进程只提示一次：

   ```text
   ⚠️  工作树哈希的临时目录删除失败（〈错误码〉）：〈~ 归一的路径〉 仍在——TriviumCode 只往里写了 git 临时索引、没有凭据，请手工删除（本进程之后的同类失败不再提示）
   ```

   措辞主语收到本程序、不断言目录全貌（计划双审 CODEX-04：用户仓库的 clean 过滤器之类也能往这个目录写东西，本题的摆锁法就是这么做的）。
2. 自检：`buildFixture` 在 `mkdtemp` 一返回就把目录记进 `made.dir`，建夹具失败时删它（只认 `mkdtemp` 的返回值），失败步骤仍报建夹具失败的原因；`finish` 删不掉不抛。两处删不掉时结果带 `cleanupResidue`（不进 `steps`、不改 `ok`），渲染时打这一句、不说「夹具已清理」：

   ```text
   自检夹具目录删除失败（〈错误码〉）：〈~ 归一的路径〉 仍在——自检只往里写了夹具文件与本次自检的审查留痕（.reviews/），没有凭据，请手工删除
   ```

   `runSelftest` 加第二个参数 `deps = { initFixtureRepo }`，只给单测换建夹具的最后一步（计划双审 GLM-01：注入点放在最后一步，生产里的 `made.dir` 赋值仍在执行路径上）。
3. 保留期：到期整删改调 `tryRemoveTempDir`，删不掉记进 `PruneResult.removeFailed`（目录与错误码），落回未到期那条路照走凭据准入与抹除（递归删除删到一半才失败，载体可能正好在没删掉的那部分里），循环继续。会话启动待办单列一行（`removeFailedLine`，最多列三个目录、超出写「等 N 个」），纳入早退条件；不承诺「下次会话会再试」——删掉一部分会刷新目录 mtime，下次会话判为未到期，要再过一个保留期才重试（计划双审 CODEX-01）。
4. `tryRemoveTempDir` 只补文档块一句（它也删临时索引目录、自检夹具根与到期运行目录）。
5. 安装器三处与 `lock.ts` 的 `resetStopBlockCount` 不改（甄别结论见 BACKLOG EV-204），后者另登 EV-206；自检与集成夹具的 `${root}-runs` 遗留另登 EV-207。

## 3. 用例

**摆锁法**：git clean 过滤器。`workTreeHash` 的 `add -A` 对每个文件跑过滤器（临时索引由 `read-tree HEAD` 填充、没有 stat 信息），过滤器子进程继承 git 的环境——包括 `GIT_INDEX_FILE`。脚本在目标目录里建 `locked/`、放文件、改 0o500，最后 `cat` 原样输出（哈希不变）；第一次被调就写标记文件，用例先断言标记在。不改任何生产代码。

| 组 | 格 | 断言要点 |
| :--- | :--- | :--- |
| G `workTreeHash` 直测（`temp-index-cleanup`） | G1 | 删成功：40 位十六进制、私有 `TMPDIR` 下不留 `trivium-index-*` |
| | G2 | 删不掉：不抛、返回值与不挂过滤器时逐字相同、恰好留下一个带锁目录 |
| | G3 | 过滤器锁完退 1 且 `required`：抛的是 `git add to temp index failed`、不含删除错误码，目录带锁留下 |
| | G3b | 过滤器锁完睡 5 秒、`timeoutMs: 300`：抛的是 `GitTimeoutError`（`what === 'add'`） |
| | G4 | 子进程连调两次都删不掉：stderr 恰好一行、逐字等于 `⚠️  ` + `indexResidueText`，路径 `~/tmp/trivium-index-` 开头，两个目录都留下 |
| D 漂移复算行为级（`worktree-hash-cleanup`） | D1 | 打包 CLI + 桩（gemini、glm）跑 `review --start` → `--wait`；过滤器沿祖先进程找命令行含 `review --worker` 的那一个、只在 worker 里上锁（计划双审 AGY-01：`--start` 逐侧冻结，按次数计会错位）：`--start` 退 0 且 stderr 无提示、`--wait` 退 0、`run.json` 为 `success` 且无漂移、`status.json` 为 `success`、`worker.log` 含提示、恰好一个带锁目录 |
| S 自检 | S1 | 注入的 `initFixtureRepo` 在夹具里摆锁后抛错：`steps` 只有「创建夹具仓库」且 `detail` 是原始消息、`cleanupResidue` 逐字、`fixtureRoot` 是那个目录且仍在 |
| | S2 | 同上不摆锁：`cleanupResidue` 为 null、`fixtureRoot` 为 `''`、目录已删 |
| | S3（`selftest` 集成，打包 CLI） | `GIT_CONFIG_GLOBAL` 挂过滤器、只在 `initFixtureRepo` 的普通 `git add` 时往夹具 `.git/trvlock/` 摆锁：退 0、`N/N` 步通过、输出含残留提示、不含「夹具已清理」 |
| | S4 | `renderSelftest`：有 `cleanupResidue` 打这一句不说已清理，没有时原样 |
| R 保留期（`retention`、`hooks`） | R1 | 四个到期 + 一个未到期，构造性地锁住 `readdir` 排第一的到期目录（计划双审 GLM-04）：其余三个照常整删、`removeFailed` 恰为被锁的那个、它出现在 `scrubFailed`（落回了抹除）、未到期目录照常抹 |
| | R2 | `dryRun`：照列 `removed`、`removeFailed` 为空、盘上不动 |
| | R3 | 会话启动：单列一行含目录与错误码、「再过一个保留期」，不再有「清扫本身失败」 |
| | R3b | 锁在载体之外（落回的抹除无事可做）：「删不掉」是唯一一项待办时也要注入——变异预跑 M9 存活后补的格 |
| | R4 | `removeFailedLine` 四个只列三个、写「等 4 个」 |
| W 全树守卫（`temp-index-cleanup`） | W | `src/` 全树递归删除的分布逐文件等于豁免表（`install.ts`×3、`lock.ts`×1、`util/fsx.ts`×1）；扫到的文件数大于 50 |

**覆盖边界**：

- **错误码**：断言取实际码，属于 `{EACCES, EPERM}` 即可（计划双审 CODEX-02）；摆锁拿到的是 EACCES，`maxRetries` 只对 EBUSY / EMFILE / ENFILE / ENOTEMPTY / EPERM 重试，用例测到的是「不抛 + 提示带错误码」，不是「重试三次」。
- **git 机制前提**（计划双审 CODEX-03）：clean 过滤器子进程继承 git 的环境（含 `GIT_INDEX_FILE`）；`filter.<名>.required`（G3）；`GIT_CONFIG_GLOBAL`（S3，约 git 2.32 起）。本机 git 2.54.0。过滤器没被调到时用例先红在「标记不在」，与改动错分开。
- 涉及权限的格 root 下跳过；各格钉 `TMPDIR` / `HOME` 到私有根，收尾在 finally 里重新列目录恢复权限再整删。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新增与改动的用例单跑 | `temp-index-cleanup` 9/9；`retention` + `hooks` + `probe-fixture-cleanup` 164/164（含新增 R1、R2、R3、R4），R3b 补后单跑 1/1；`worktree-hash-cleanup` 1/1；`selftest` S3 1/1；私有根之外无本题残留 | — |
| 变异预跑（逐条带超时） | 17 条里 16 条咬住，M9（会话启动早退条件不含 `removeFailed`）存活——R3 里被锁目录同时落进「抹除失败」那一行，不会早退；补 R3b 后 M9 单独复跑咬住；源码逐字节恢复 | `mutation-spec.json` / `mutation-names-log.txt` / `mutation-names-output.json`；M9 复跑 `*.m9-rerun.*` |
| 变异装置（`scripts/mutation-check.mjs`） | 17/17 咬住；基线全绿（5 个套件） | `mutation-output.txt` |
| 全量 `npm run check`（双审前，串行两次） | 两次均 2694/2692/0/2，退 0（较上一题的 2678 多出 16 格，即本题新增：G / S / W 9、D1、S3、R1、R2、会话启动 3） | `check-1.txt`、`check-2.txt` |
| `trivium doctor --selftest`（`npm run build` 后跑仓库 bundle `skills/dual-critic/scripts/trivium.cjs`） | 双审前 14/14、退 0，「夹具已清理」 | `doctor-selftest.r1.txt` |
| 代码双审后：自检相关单跑（`temp-index-cleanup` + `selftest` 集成） | 15/15 | — |
| 代码双审后：变异（规格按修订后源码重生成，只改了 M12 的 find 锚点） | 预跑与装置均 17/17，红格逐条与双审前一致；基线全绿（5 个套件）；双审前读数留 `.r1` | `mutation-spec.json` / `mutation-names-log.txt` / `mutation-names-output.json` / `mutation-output.txt`（双审前为同名 `.r1`） |
| 代码双审后：全量 `npm run check`（串行两次） | 两次均 2694/2692/0/2，退 0 | `check-3.txt`、`check-4.txt` |
| 代码双审后：`trivium doctor --selftest`（`npm run build` 后跑仓库 bundle） | 14/14、退 0，「夹具已清理」 | `doctor-selftest.txt` |
| 系统临时目录 `trivium-index-*` | 双审后两次全量后为 114 个，仍没有一个带 `locked/`；双审前两次全量前后由 110 增至 113；新增三个逐个看过：两个只有 `index`、一个空目录，都不带 `locked/`——不是本题用例漏的，是既有用例在 `workTreeHash` 中途结束进程留下的（§6 被杀进程那一形） | — |

## 5. 变异明细

| 编号 | 变异 | 期望套件 | 结果 |
| :--- | :--- | :--- | :--- |
| M1 | `workTreeHash` 的 finally 退回裸递归删除（动态导入 `fs`，保持「删不掉才抛」的原形态） | temp-index-cleanup | G2、G3、G3b、G4、W（5） |
| M2 | 去掉「同一进程只提示一次」 | temp-index-cleanup | G4 |
| M3 | 删不掉时不提示 | temp-index-cleanup | G4 |
| M4 | 提示不做家目录归一 | temp-index-cleanup | G4 |
| M5 | 删不掉就抛 | worktree-hash-cleanup | D1 |
| M6 | 到期目录删不掉后 `break` | retention | R1 |
| M7 | 删不掉后直接 `continue`（不落回抹除） | retention | R1 |
| M8 | 不记 `removeFailed` | retention | R1 |
| M9 | 会话启动早退条件不含 `removeFailed` | hooks | 预跑存活 → 补 R3b 后 R3b |
| M10 | 待办不截断到三个 | hooks | R4 |
| M11 | `buildFixture` 不记 `made.dir` | temp-index-cleanup | S1、S2 |
| M12 | `finish` 退回裸递归删除 | selftest 集成 | S3 |
| M13 | 有残留提示也说「夹具已清理」 | temp-index-cleanup | S4 |
| M14 | 建夹具失败时用删除错误码顶替 `detail` | temp-index-cleanup | S1 |
| M15 | 建夹具失败时不删 `made.dir` | temp-index-cleanup | S1、S2 |
| M16 | 会话启动不出删不掉那一行 | hooks | R3、R3b |
| M17 | `dryRun` 也真删 | retention | R2，另带红既有「没有 status.json 的残留目录按 mtime 处理…」 |

## 6. 残余

见 BACKLOG EV-204 结案语：worker 路径的提示只进 `worker.log`；同一进程第二个删不掉的目录不再提示；`maxRetries` 重试路径未覆盖；到期目录删掉一部分后要再过一个保留期才重试（`status.json` 也被删掉时期间按 unknown 处置）；进程被杀时 finally 不跑（系统临时目录现有 110 个 `trivium-index-*`，逐个看过都是此形态：57 个只有 `index`、53 个空目录，没有一个带只读子目录）。`-runs` 遗留另登 EV-207，`lock.ts` 另登 EV-206。
