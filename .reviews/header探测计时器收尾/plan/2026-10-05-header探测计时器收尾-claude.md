# header探测计时器收尾（EV-205）· 实施计划

> 起点 `b5f52ca`；命令 A；Driver claude。任务目标原文较长，审查员任务书末尾有「附录：任务目标原文」；
> 本计划把其中的现状与决策**完整复述**在 §1、§2，便于逐条对照。全程零配额。

## 1. 现状（已核，行号取 `b5f52ca` 源码）

1. `src/trivium/probes/codex.ts` 的 `probeCodexHeader`（411～477 行）调 `run(bin, ['exec', …, 'probe'], { timeoutMs: 30_000, killTree: true, onStderrLine, stopEarly })`。
   `stopEarly` 回调（453～462 行）里 `setInterval` 每 50 ms 检查一次：`sawDivider` 为真或五个标签凑齐才 `clearInterval` 并调 `stop()`；
   另挂 `setTimeout(() => clearInterval(timer), 31_000).unref()` 兜底。兜底计时器 `unref` 了，**轮询本身没有**。
2. `src/trivium/util/exec.ts` 的 `run`（168～349 行）：`stopEarly` 在 Promise 执行器里**同步**调用一次（328 行），只交出「停下」句柄
   （SIGTERM → `killGraceMs` 5 s → SIGKILL，标 `earlyStopped`）；子进程自然退出时走 `close` 或 `exit` 后 2 s 兜底进 `finish`，
   `finish` 只清 `run` 自己的三个计时器，**不通知调用方**。所以 codex 不打 header 就退出（版本变了、参数被拒、凭据坏了）时，
   `run` 已兑现、`probeCodexHeader` 已返回，轮询仍每 50 ms 空转，直到 31 s 兜底清掉它，期间事件循环不空。
3. `run` 必然兑现的上界：`timeoutMs` 30 s → SIGTERM → 5 s → SIGKILL → `close`（或 `exit` 后 2 s）。唯一不兑现的分支是
   `treeShutdown`（worker 收到 SIGTERM 后的终止冻结，进程随即退出；doctor 与前台 CLI 不进入该状态）——见 §3.4 边界。
   `run` 不会 reject：spawn 失败走 `child.on('error')` → `finish(null, null)`。
4. `src/trivium/cli.ts` 收尾（2016～2028 行）只设 `process.exitCode`、靠事件循环自然排空退出，所以漏清的轮询会把 `trivium doctor` 拖住至多 31 s。
5. `stopEarly` 全仓唯一调用方就是 `probeCodexHeader`（`grep -rn stopEarly src test` 只命中 `exec.ts` 定义与 `codex.ts:453`）；
   全仓另一个 `setInterval`（`run-protocol.ts:994` 心跳）已在收尾处清掉，不在本题。
6. `probeCodex` 里五处调用：基底（981 行）、逐个档位对照（992 行）、不存在的档位（1002 行）、思考档位覆盖（1034 行）、伪造的思考档位（1055 行）。
   后两类与「不存在的档位」设计上就可能走「不打 header 就退」的路径。本机 codex 0.160 实测两项都不拒
   （探针记录 `unknown_profile_rejected` 与 `effort_validated` 均为 false），眼下本机碰不到；codex 行为一变就会碰到，而那正是最需要 doctor 的时候。
7. EV-199 的假入口用例（`test/unit/probe-fixture-cleanup.test.ts` 241～242 行）起初因此单格多耗约 30 s，测试侧让假 codex 打出一段最小 header 规避，生产侧没改。
8. 全仓测试里没有直接测 `probeCodexHeader` 的用例（只经 EV-199 的 `probeCodex` 假入口间接走到）。

## 2. 决策（任务目标给出、用户已发起，逐条复述）

- **D1 修在调用方。** `probeCodexHeader` 把 `run` 的调用包进 `try/finally`，`run` 返回（子进程已收尾）或抛出后一律清掉轮询计时器；
  计时器句柄用对象持有（回调里赋值的 `let` 在 `finally` 里会被 TypeScript 收窄成初值类型）。31 s 兜底随之删去，注释写明
  「`run` 有 30 s 超时、必然收尾，`finally` 是唯一清理点」。
- **D2 不改 `run` 的 `stopEarly` 契约。** 全仓只有一个调用方，为它加「收尾钩子」是给单个调用点造抽象；在 `RunOptions.stopEarly` 文档块补一句
  「回调里挂的计时器由调用方在 `run` 返回后清理」。
- **D3 输出与判据逐字不变。** 探针结论、notes、doctor 输出都不动；EV-199 那份假 codex 的最小 header 保留不动（它测的是别的东西），只把那行注释里
  「不吐就要等它 31 秒的兜底（既有行为，本题不改）」改成现状的说法（见 §3.3）。
- **D4 测试零配额。** 假 codex 用脚本文件直接作为 `bin` 传入（不经 `PATH`，不可能拉起真实 CLI）。覆盖：不打 header 且非零退出、不打 header 且零退出两种，
  各在子进程里跑一次 `probeCodexHeader`，断言子进程从调用返回到自然退出的耗时远小于 31 s；打出 header 早退的路径结论不变。
  子进程不跑 `node --test`，但环境里照样去掉 `NODE_TEST_CONTEXT`。
- **D5 验证零配额。** 单测；变异（删掉 `finally` 里的清理、恢复只靠兜底）先逐条带超时预跑再跑装置；全量检查两次（串行）、doctor 自检；
  前后各数一次系统临时目录里 `trivium-` 开头的新建条目，除 `trivium-index` 外应为 0。
- **D6 文档。** EV-205 结案；设计版本记录加一行；新发现另登；测试报告同批登记进 `doc/05_testing/README.md`。

BACKLOG 登记时给的两条修法方向本计划都不取，理由：
- **轮询也 `unref`**：只是不再拖住进程退出，轮询照旧空转到 31 s——doctor 后面还有别的探针要跑、事件循环本来就不空，
  五次调用各漏一个 50 ms 轮询、各空转 30 s 才停，是把漏清藏起来而不是收掉；
- **给 `stopEarly` 加 settle 收尾钩子**：即 D2 否掉的契约层改法。BACKLOG 写「按这一族形态看」，但这一族全仓只有一个成员（§1 第 5 条）。

## 3. 改动设计

### 3.1 `probeCodexHeader`（`src/trivium/probes/codex.ts`）

```ts
  const want = HEADER_LABELS;
  const seen = new Map<string, string>();
  let sawDivider = false;
  /*
   * 轮询计时器用对象持有：在回调里赋值的 let，到 finally 里会被收窄成初值 null。
   * finally 是唯一清理点：run 有 30 s 超时、必然收尾（超时 → SIGTERM → 宽限 → SIGKILL），
   * 子进程不打 header 就自己退出时 run 照样兑现，而它不通知调用方——不在这里清，轮询会空转下去（EV-205）。
   */
  const poll: { timer: NodeJS.Timeout | null } = { timer: null };

  let r: RunResult;
  try {
    r = await run(bin, [...], {
      ...,                     // timeoutMs / cwd / stdin / killTree / onStderrLine 逐字不变
      stopEarly: (stop) => {
        poll.timer = setInterval(() => {
          if (sawDivider || want.every((k) => seen.has(k))) {
            if (poll.timer) clearInterval(poll.timer);
            stop();
          }
        }, 50);
      },
    });
  } finally {
    if (poll.timer) clearInterval(poll.timer);
  }
```

- 回调内那次 `clearInterval` 保留：见到 header 后不必等 `run` 兑现（还要过 SIGTERM 与 `close`）就停掉轮询，也免得 `stop()` 被重复调用
  （`stop` 本身幂等，这只是省掉无用的轮询）。删掉它是等价变异，不列入变异表（§4.3）。
- `RunResult` 需从 `../util/exec.js` 增加类型导入（若该文件已导入则复用）。
- 函数体开头那段注释「仍留一个兜底超时：CLI 可能根本不打 header（版本变了、参数被拒），那时没有早退信号，不能永远等下去」改为：
  兜底是 `run` 的 30 s `timeoutMs`（不再另挂计时器）；不打 header 就退出时 `run` 照常兑现、轮询由 `finally` 清掉。
- 返回值组装（466～476 行）逐字不变。

### 3.2 `RunOptions.stopEarly` 文档块（`src/trivium/util/exec.ts` 31～42 行）

末尾补一段：

> `run` 只在早退时用到这个句柄，**不会**在子进程自然退出、超时或启动失败时通知回调方。回调里挂的计时器（轮询之类）
> 由调用方在 `run` 返回后自行清理——`await run(…)` 包进 `try/finally` 即可：`run` 必然兑现（超时链路兜底），且不会 reject。

`run` 的实现一行不改。

### 3.3 EV-199 假 codex 的注释（`test/unit/probe-fixture-cleanup.test.ts` 241 行）

最小 header 的写出保留不动；注释改为说明它现在的作用（让 exec 调用走「见到 header 早退」这条与真实 codex 同形的路径、
各项判据有值可比），并注明 EV-205 起不打 header 也不会再多等 31 s。只改注释，用例行为不变。

### 3.4 边界（如实写明，不在本题改）

- **终止冻结**：worker 收到 SIGTERM 后 `treeShutdown` 置位，此后 `run` 的 Promise 永不兑现，`finally` 不跑、轮询不清。该状态下进程随即退出
  （`shutdownTrackedTrees` 之后 worker 收尾），且 doctor 与前台 CLI 不会进入；`probeCodexHeader` 只在 doctor / 探针路径上调用。不处理。
- **超时链路**：codex 挂住不打 header 也不退出时，`run` 要到 30 s 超时 + 至多 5 s 宽限才兑现，这段时间轮询照常空转——这是「探测本身还没结束」，
  不是漏清；本题只保证 `run` 兑现之后不再有轮询。用例不覆盖这条（要等 30 s），由代码结构保证（`finally` 与兑现路径无关）。
- 其余调用 `run` 的地方不挂计时器，不受影响。

## 4. 测试（零配额）

### 4.1 新文件 `test/unit/codex-header-drain.test.ts`

**装置**：每格 `scratchDir('trivium-hdrdrain-')` 建私有目录，内放：
- 假 codex 脚本（`#!${process.execPath}` 首行、`0o755`），行为由环境变量 `FAKE_MODE` 选；启动即把自己的 pid 写进私有目录下 `fake.pid`，
  argv 带不到标记时以文件为准；任何模式下最长自睡 40 s 后自行退出（防遗留）；
- 子进程脚本 `drain.mjs`：动态 `import` 构建产物 `dist/test/src/trivium/probes/codex.js`（路径由用例按 `import.meta.url` 解析后经环境变量传入），
  `await probeCodexHeader(fakeBin, extraArgs, dir)`，返回后立即用 `fs.writeSync(1, …)` 打一行 `RETURNED <JSON 结果>`，然后什么都不做、让事件循环自然排空。

**父侧计时**：`spawn(process.execPath, [drain.mjs], { env: { ...process.env, NODE_TEST_CONTEXT: undefined 删除, … } })`。
- 等到 `RETURNED` 行：上限 **10 s**（从拉起算）。超时即判红（文案说明「调用没有在 10 s 内返回」）。
- 记下收到 `RETURNED` 的时刻 t1，等子进程 `exit`：上限 **10 s**。记 t2，`drain = t2 - t1`。超时即判红（文案「调用返回后 10 s 子进程仍未退出：轮询计时器漏清（EV-205）」）。
- 阈值取 **10 s** 的依据：修好后 `drain` 实为毫秒级（Node 退出开销；读数报告给出 P 值）；漏清时 `drain` 约等于 31 s 减去调用耗时，
  不打 header 的格调用耗时在 1 s 内 ⇒ `drain` ≥ 约 29 s。两侧余量都在 2 倍以上，机器负载约 10 时（K 格偶发红那种）也不至于越线。
- 收尾（`finally`）：子进程仍活就 SIGKILL；读 `fake.pid`，在则 `process.kill(pid, 'SIGKILL')`（假 codex 是 `killTree` 拉起的组长，它的组号即 pid，
  一并 `process.kill(-pid, 'SIGKILL')`，吞掉 ESRCH）。私有目录由 `scratchDir` 在进程退出时删。

**用例**（每格断言结果对象与计时两部分）：

| 格 | 假 codex 行为 | 结果断言 | 计时断言 |
| --- | --- | --- | --- |
| H1 | 不打 header，stderr 打一行 `error: unknown profile`，退 2 | `gotHeader=false`、`exitCode=2`、五个字段全 null、`stderr` 含那一行 | 返回 ≤ 10 s；drain ≤ 10 s |
| H2 | 不打 header、无输出，退 0 | `gotHeader=false`、`exitCode=0`、五字段 null | 同上 |
| H3 | `bin` 指向私有目录里不存在的文件（spawn ENOENT） | `gotHeader=false`、`exitCode=null`、`stderr` 含 `[spawn error]` | 同上 |
| H4 | stderr 打齐五个标签（无分隔线）后自睡 | 五字段逐一等于写出的值、`gotHeader=true`、`exitCode=null`（被 SIGTERM 结束） | 返回 ≤ 10 s（早退，不等 30 s 超时）；drain ≤ 10 s |
| H5 | stderr 只打 `model: x` 与 `--------` 后自睡 | `model='x'`、其余四字段 null、`gotHeader=true`、`exitCode=null` | 同 H4 |

H4 / H5 钉住「打出 header 早退的路径结论不变」：字段抽取、`gotHeader`、`exitCode` 与改动前逐字相同（改前构建上同样跑一遍作对照，见 §4.2）。
H1 / H2 即任务目标点名的两种；H3 是 `run` 走 `error` 分支兑现的那一路，同样要清。

### 4.2 改前对照

在 `b5f52ca` 的构建上跑同一组用例（`git archive` 导出到 scratchpad、`node_modules` 软链、`build.mjs --with-tests` 后只跑本文件；新测试文件叠加进去）：
预期 H1～H3 红在「返回后 10 s 仍未退出」，H4 / H5 绿。读数进报告，证明用例确实咬得住旧行为。

### 4.3 变异（先逐条带 `--test-timeout` 预跑，再跑 `scripts/mutation-check.mjs`）

| 编号 | 变异 | 预期 |
| --- | --- | --- |
| M1 | 删掉 `finally` 里的 `clearInterval`，并恢复 31 s 兜底（即「恢复只靠兜底」） | H1～H3 红 |
| M2 | 删掉 `finally` 里的 `clearInterval`、不恢复兜底 | H1～H5 中 H1～H3 红（H4 / H5 由回调内清理兜住，绿） |
| M3 | 回调里去掉 `stop()` 调用 | H4 / H5 红（返回要等 30 s 超时） |
| M4 | 早退判据去掉 `sawDivider ||` | H5 红 |

find 锚点由生成脚本从源码截取并核对唯一；替换串扫一遍特殊替换模式。expect 只收一个套件（本文件），记 fail 数。

### 4.4 全量与自检

- `npm run check` 两次，串行、一次只发一条、输出直接写文件、`echo exit=$?` 取真实退出码；发之前 `pgrep -fl 'node --test'` 确认无残留。
- 本机 doctor 自检（`trivium selftest`，零配额）。
- 前后各数一次系统临时目录的新建条目（按 `birthtimeMs` 分组的只读脚本 `evidence/test-scratch-cleanup-20261004/count-new.mjs`），除 `trivium-index-` 外应为 0。
- EV-199 的 `probe-fixture-cleanup` 用例全绿、耗时不变。

## 5. 文档

- `doc/08_project/BACKLOG.md`：EV-205 改 done，写明修法（调用方 `finally`、删 31 s 兜底、契约只补文档）、两条原修法方向不取的理由、读数出处、残余（§3.4 两条）。
- 设计版本记录加 **v1.3.93** 一行（计划 / 双审 run / 读数出处）。设计正文无 `probeCodexHeader` 计时细节，不改正文。
- 测试报告 `doc/05_testing/REPORT_2026-10-05_codex_header_poll_cleanup.md`（用例、改前对照、变异、全量、自检、临时目录读数；代码双审一栏审后回填），
  证据目录 `doc/05_testing/evidence/codex-header-poll-20261005/`，在 `doc/05_testing/README.md` 按文件名升序登记。**报告随被审补丁一起送审。**
- 新发现另登 BACKLOG。

## 6. 不做

- 不改 `run` 的实现与 `stopEarly` 的签名（D2）。
- 不改探针判据、notes、doctor 输出（D3）。
- 不动 EV-199 假 codex 的最小 header 写出（只改注释）。
- 不跑真实 codex。
