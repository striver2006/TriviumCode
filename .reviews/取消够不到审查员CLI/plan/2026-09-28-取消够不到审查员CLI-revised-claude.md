---
schema: trivium.disposition.v1
topic: 取消够不到审查员CLI
stage: plan
role: claude
kind: revised
run_id: 20260927T190138Z
addresses:
  - 2026-09-28-取消够不到审查员CLI-codex.md
  - 2026-09-28-取消够不到审查员CLI-gemini.md
  - 2026-09-28-取消够不到审查员CLI-glm.md
---

# 裁决：取消够不到审查员CLI · 计划双审第 1 轮

> 被审对象：`plan/2026-09-28-取消够不到审查员CLI-claude.md`（r1，起点 `dbd1a8a`，D1～D7 送审前已定）
> ｜ 运行：`20260927T190138Z`（约 9 分 30 秒）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `request-changes` ｜ glm `request-changes`
> ｜ 共 16 条（重要 6、次要 8、吹毛求疵 2），**全部接受**；其中 AGY-04 接受问题、不取它建议的修法（理由见表）
> ｜ 同指三组：CODEX-01 ≡ AGY-01（旧构建对照做不出来）；CODEX-06 ≡ AGY-02（重新自杀的退出形态没有用例与变异守）；AGY-04 ≡ GLM-01（冻结只约束经 `run()` 的链路，处理器接管之前另有一段推进窗口）
> ｜ 不改 D1～D7；不改修法 ① 的结构

## 0. 核实记录

逐条对照 `dbd1a8a` 源码核过：

- **CODEX-01 ≡ AGY-01**：两处都成立。①`hang_cli` 是本主题新增的桩模式，`dbd1a8a` 的 `stub.ts` 只有 `hang`，旧构建跑 A1 拉不起子进程树，A4 读数没有意义（AGY-01）；②原稿没写旧构建从哪来、调哪个路径：`dist/` 与 `skills/dual-critic/scripts/trivium.cjs` 都不进 Git，`.trivium/bin/trivium` 指向已安装副本，脚本不钉死路径就可能新旧跑的是同一份（CODEX-01）。上一主题的 `evidence/orphan-worker-20260927/acceptance.mjs` :267-279 已有现成做法：`git archive` 固定提交（带 `.reviews/`）→ 叠加指定文件 → 软链工作树的 `node_modules`（不联网）→ `scripts/build.mjs --with-tests` → 直接调导出目录里的 bundle。本主题照搬，叠加面只放 `stub.ts` 的 `hang_cli`。
- **CODEX-02**：成立。§2.4 原型用的是 `sh` + `sleep`，真实厂商 CLI 对 SIGTERM 的处置（装监听做优雅收尾）没有任何实测。D3 定了不花配额，本主题跑完也不会有这项证据。原稿 §7.2「本修法不依赖它」只对「写错误的处置」成立，对「信号的处置」不成立：a 格的耗时依赖它，只是最坏由 2 s 后的 SIGKILL 兜住。
- **CODEX-03**：成立。桩的标记只在 `sh -c` 那一层的 argv 里，`sleep` 不带标记；按标记认进程只能证明「带标记的那层没了」，证明不了「组空了」。
- **CODEX-04**：成立。原稿的冻结对全部 `run()` 生效，但没把这写成显式决定，也没说代价：worker 里不带 `killTree` 的其它调用者，如 `status.ts` 的 `processAlive` → `processStartTime` → `run('/bin/ps')`、`util/git.ts`，也会悬空。
- **CODEX-05**：成立。`cancelRun` 的宽限轮询每次都经 `processAlive` 派生一个 `ps`，I2 的「耗时 < 5 s」与判红条件之间只有约 1 s 余量。
- **CODEX-06 ≡ AGY-02**：成立，全套用例与变异都不区分「以 SIGTERM 死」和「`exit(143)`」。实测（本会话，零配额）：v25.2.1 / macOS 上「移除最后一个 SIGTERM 监听 → `process.kill(self,'SIGTERM')` → 同步 `process.exit(143)`」连跑三次都是 `signal: SIGTERM`，kill 在返回之前就结束了进程。但 POSIX 只在「没有其它线程能接这个信号」时保证这一点，Node 18 也没测过，所以兜底不应写成同步。
- **AGY-03**：成立。原稿没写看门狗在正常路径上要清掉，也没写第 4 步要防重入。
- **AGY-04 ≡ GLM-01**：问题成立，范围要说准。
  - **有在跑的 CLI 时**：`runBothSides` 是 `Promise.allSettled`（`runner.ts` :204），任何一侧的 `run()` 悬着它就返回不了，`writeRunMeta`（`review.ts` :1687）走不到。这一格冻结守得住。
  - **没有在跑的 CLI 时**（两侧都已结束、worker 在解析与归档）：`shutdownTrackedTrees` 立即返回，处理器在同一串微任务里重新自杀，处理器开始执行之后不会再有 I/O 回调运行。但从信号到达到处理器执行，要等 libuv 在事件循环里读到信号，其间已就绪的 I/O 回调可以先跑。今天是内核立刻终止，这段窗口为零；改后这段窗口不超过一次事件循环迭代。
  - **最坏后果**：一次已在飞的终态写入走完最后一步。worker 若把 run.json 与 status.json 都写成终态，`--cancel` 终态早退（判据是 status.json 的 phase，`run-protocol.ts` :1142-1146），归档记 `success` / `failed`，而非 `cancelled`。若只写了 run.json，`finalizeCancelledRunMeta` 按前提 4 跳过，`patchStatus`（:1217）无条件写 `cancelled`，两边劈叉。
  - **修法**：AGY-04 建议在 `writeRunMeta` 之前查终止标志，但这关不住这段窗口——标志要等处理器执行才置位，而窗口恰恰就在处理器执行之前；处理器一旦执行，没有 CLI 时进程在同一串微任务里就结束了，不会再走到那次检查。所以接受问题、不加检查，改为把保证的范围写准，并列为「按代码论证、没有用例钉住」的一格。
  - GLM-01 另指出原稿 §4.1「cancelRun 随后按 run.json 已终态跳过（前提 4）」把两个判据混在一起，成立。
- **AGY-05**：成立。原稿写的是「并行调」，但没有用例钉住；若写成串行，两侧都忽略 SIGTERM 时处理器耗时翻倍，约 6 s，会击穿 5 s 宽限。
- **AGY-06**：成立。`installWorkerSigtermForwarding` 只在收到 SIGTERM 时才移除监听；`workerMain` 正常返回、或在测试进程里调用时，监听会一直留着。`test/` 里没有直接调 `workerMain` 的用例（grep 零命中），但卸载成本很低。
- **GLM-02**：成立，且影响最大。「未响应 SIGTERM」出自 `warn`，恒写 stderr（`util/log.ts` :24-26）；只有 `say` 在非 `--json` 模式下写 stdout。I1 与 M5 的断言原稿写的是 stdout，照字面实施会恒真，M5 假绿。
- **GLM-03**：成立。原稿的导出没有用例消费，由 CODEX-06 ≡ AGY-02 的新用例 U9 接住。
- **GLM-04**：成立。`cancelRun` 的过程播报多走 stderr、带每次不同的 pid；stdout 只有末尾两三行 `say`。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核实成立（≡ AGY-01 的另一半）：旧构建的来源、产出与调用路径都没定义，而 wrapper 指向已安装副本，对照可能静默失效 | §5.4 新增「旧构建」段：照搬上一主题 `acceptance.mjs` :267-279（`git archive` 固定提交 `dbd1a8a`，带 `.reviews/`、`node_modules` 软链工作树、不联网、`scripts/build.mjs --with-tests`）；新旧各调导出目录或工作树里的具体 bundle 路径，不经 `.trivium/bin/trivium`；各自的 `TRIVIUM_ASSET_ROOT` 指向本份源码树；evidence 记两份 bundle 的 sha256 与来源提交，并断言两者不同 |
| CODEX-02 | codex | minor | 接受 | 核实成立：「不依赖」只对写错误的处置成立；对 SIGTERM 的处置同样未实测，a 格耗时依赖它，由 SIGKILL 兜底 | §7.2 该条拆成两句（不依赖写错误处置 / 依赖信号语义、真实 CLI 未实测、不响应时 2 s 后 SIGKILL，`--cancel` 最多多等约 3 s）；§3.2 a 格加注；§8 新登条目把它列为待验证前提；§6 设计、LLD、MANUAL 三处措辞同口径，不写成无条件结论 |
| CODEX-03 | codex | minor | 接受 | 核实成立：只按标记认进程，证明不了「组空」 | §5.2 `hang_cli` 保留 `sh` + `sleep` 两层（组里有不带标记的成员，才测得到「按组」）；I1 / I2 / A1 / A2 的判据改为：先按标记找到组长、记下组号，再用 `ps -axo pid=,pgid=` 枚举该组，断言成员为零；`finally` 按组号清理并断言残留列表为空 |
| CODEX-04 | codex | minor | 接受 | 核实成立：进程级无差别冻结是对的，但必须是显式决定并写明代价 | §4.1 冻结段补一句显式决定：对全部 `run()` 生效，因为 worker 进入终止中之后不该再有任何外部落地；代价是收尾路径上的 `ps`、git 等辅助调用悬空，由重新自杀与看门狗兜底。§7.1 加一条：日后新增的 worker 侧 `run()` 调用者须知晓此语义。`exec.ts` 的冻结文档块同步写明 |
| CODEX-05 | codex | minor | 接受 | 核实成立：计时断言压在预算边界上，已有 EV-149 / EV-153 的前车之鉴 | I2 / A2 的主判据改为 stderr 不含「未响应 SIGTERM」（因果、不依赖计时，同 GLM-02 改指 stderr）；计时只作宽松上界，由常量推导：`WORKER_TERM_GRACE_MS - 500`，不写魔数 |
| CODEX-06 | codex | minor | 接受 | 核实成立（≡ AGY-02）：退出形态无人守；同步 `exit(143)` 兜底与「形态不变」的说法在病态分支上自相矛盾 | 新增 U9（见 AGY-02 落点），并断言「只处理第一次」；兜底改为延时（见 AGY-03）；§7.1「退出形态与今天相同」加限定「除走到兜底 `exit(143)` 的病态分支」；§7.2 实测范围写明「移除最后一个监听即恢复缺省处置」只在 v25.2.1 / macOS 上量过，并附本轮三次读数 |
| AGY-01 | gemini | major | 接受 | 核实成立：`hang_cli` 在 `dbd1a8a` 上不存在，旧构建跑不出进程树 | §5.4 A4 的旧构建 = `dbd1a8a` 源码只叠加 `stub.ts` 的 `hang_cli` 一处（实施时核对该文件相对 `dbd1a8a` 的 diff 只含这一处；不是这样就只叠加这一段补丁）；叠加面写进 evidence。这与上一主题 A7「叠上取值面」同一形态 |
| AGY-02 | gemini | major | 接受 | 核实成立（≡ CODEX-06） | §5.1 新增 **U9**（`run-protocol.test.ts`，子进程）：子进程 import 本仓构建并调用 `installWorkerSigtermForwarding()`。①无登记时收 SIGTERM，父进程断言 `code === null && signal === 'SIGTERM'`；②登记一个忽略 SIGTERM 的 `killTree` 子进程后连发两次 SIGTERM，断言该组空、worker 仍以 `signal: SIGTERM` 退出（钉住「只处理第一次」）。§5.3 新增 **M9**：重新自杀改成 `process.exit(143)`，期望 U9 红 |
| AGY-03 | gemini | major | 接受 | 核实成立：原稿没写清看门狗与退出步骤的次序与防重入。本轮实测同步 `exit(143)` 在 v25 上走不到，但不依赖这一点更稳 | §4.2 重写第 2～4 步。退出步骤收成一个函数 `exitOnce()`：进门查 `exiting` 标志，已置位即返回；置位后 `clearTimeout(看门狗)` → 移除监听 → `process.kill(self,'SIGTERM')` → 另起一个 1 s 的计时器，到期才 `process.exit(143)`。正常路径与看门狗都只调 `exitOnce()` |
| AGY-04 | gemini | major | 接受 | 问题成立（≡ GLM-01）：处理器接管之前有一段推进窗口。**不取建议的修法**：在 `writeRunMeta` 前查终止标志关不住这段窗口——标志由处理器置位，窗口在处理器执行之前；处理器一旦执行，无 CLI 时进程在同一串微任务里就结束了，检查不会被走到；有 CLI 时 `runBothSides` 本来就返回不了。加检查只会多一处与信号耦合的代码，而这一格照样无用例可钉 | 同 GLM-01 的落点：§4.1 把保证范围写准；§4.4 新增「取消落在收尾段」一行；§7.1 撤回「I1 守住」；§7.2 列入如实保留；报告的「按代码论证」清单预留这一格。并在 §4.1 写明为何不加标志检查 |
| AGY-05 | gemini | minor | 接受 | 核实成立：「并行」没有用例钉住，串行化会击穿宽限 | §5.1 U7 新增⑥：两个忽略 SIGTERM 的 `killTree` 子进程、`graceMs: 1000`、`killWaitMs: 500`，断言两组都空，且总耗时小于 `graceMs + killWaitMs + 1000`（串行约翻倍，会越界）。§5.3 新增 **M10**：并行改成逐个 await，期望 U7⑥ 红 |
| AGY-06 | gemini | minor | 接受 | 核实成立：成本很低，且能避免监听在进程里残留 | §4.2 `installWorkerSigtermForwarding()` 返回卸载函数，`workerMain` 的 `finally` 首行调用。收到 SIGTERM 且登记非空时，`workerMain` 被冻结，走不到 `finally`；登记为空时进程在微任务里就结束了。两种情形都不会让卸载抢在转发之前 |
| GLM-01 | glm | minor | 接受 | 核实成立（≡ AGY-04），且另指出「前提 4」判据的刻画有误 | §4.1 保证范围改写为：「自处理器首行起，经 `run()` 的链路不再推进；有在跑的 CLI 时 `executeRun` 的终态写入必然走不到。从信号到达到处理器执行，至多一次事件循环迭代，其间已就绪的回调可先行，这段窗口今天为零」。§4.1「按 run.json 已终态跳过（前提 4）」改为按 status.json 早退与前提 4 两种形态分述。§4.4 新增一行「取消落在收尾段（两侧 CLI 已结束）」：今天（信号即终止）与改后（至多多走一次迭代，最坏归档记非 `cancelled` 或 run.json 与 status.json 劈叉）对照，取舍为接受并如实记录。§7.1 撤回「I1 守住」，改为「有 CLI 那一格由 I1 与 M3 守，收尾段那一格按代码论证」。§7.2 如实保留加这一格 |
| GLM-02 | glm | major | 接受 | 核实成立：`warn` 恒写 stderr，原稿的 stdout 断言恒真，M5 假绿 | §5.2 I1 / I2 与 §5.3 M5 的期望全部改指 **stderr**；§5.4 A1 / A2 同改；实施时先在未变异的构建上确认该文案确实落在被断言的流里，再定变异规格 |
| GLM-03 | glm | nit | 接受 | 核实成立：导出没有用例消费 | 由 U9 消费（见 AGY-02）；导出保留，文档块写明「供 U9 在子进程里装」 |
| GLM-04 | glm | nit | 接受 | 核实成立：A6 没写比对哪条流、也没写 pid 归一化 | §5.4 A6 写明：stdout 逐行相同；stderr 把 pid、run_id、时间戳归一化为占位后逐行相同；两份原文与归一化结果都进 evidence |

## 2. 修改方案（审批后执行，产出 r2）

1. **§4.1 冻结**：保证范围按 GLM-01 写准；写明对全部 `run()` 生效是显式决定及其代价（CODEX-04）；写明为什么不在 `writeRunMeta` 之前查标志（AGY-04）；「前提 4」一句改准。
2. **§4.2 处理器**：第 2～4 步按 AGY-03 重写（`exitOnce` 防重入、清掉看门狗、兜底延时 1 s）；返回卸载函数，`workerMain` 的 `finally` 调用（AGY-06）；导出由 U9 消费（GLM-03）。
3. **§3.2 / §4.4 / §7.1 / §7.2**：a 格加注（CODEX-02）；新增「取消落在收尾段」一行；撤回「I1 守住」；如实保留加两格（收尾段窗口、真实 CLI 信号处置未实测）；「退出形态相同」加限定；实测范围附本轮三次读数（CODEX-06）。
4. **§5 验证**：
   - U7 新增⑥（AGY-05）；新增 U9①②（AGY-02 / CODEX-06 / GLM-03）；
   - I1 / I2 判据改为按组号枚举成员（CODEX-03），「未响应 SIGTERM」改指 stderr（GLM-02），计时只作由常量推导的宽松上界（CODEX-05）；
   - 变异新增 M9（`exit(143)` 替代重新自杀）、M10（串行化），M5 期望改指 stderr；
   - §5.4 新增「旧构建」段（CODEX-01 ≡ AGY-01）；A4 叠加 `hang_cli`；A1 / A2 判据同 I1 / I2；A6 写明比对流与归一化（GLM-04）。
5. **§6 文档同步**：设计、LLD、MANUAL 里凡写 a 格「够得到」的地方，都带上「真实 CLI 的信号处置未实测，不响应时 2 s 后 SIGKILL」这一限定（CODEX-02）。
6. **§8 BACKLOG**：新登的修法 ② 余项条目，把「真实 CLI 的 SIGTERM 处置」列为待验证前提（CODEX-02）。
7. **不改**：D1～D7；修法 ① 的结构；时间预算的数值（2 s / 1 s / 看门狗 3.5 s / 取消宽限 5 s）。
8. r2 另存为 `…-r2-claude.md`，原稿不动；定稿后照惯例先提交计划，再实施。
