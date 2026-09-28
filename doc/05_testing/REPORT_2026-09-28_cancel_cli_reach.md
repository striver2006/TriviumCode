# 取消够不到审查员 CLI · 实施报告（EV-152）

- **日期**：2026-09-28
- **主题**：`取消够不到审查员CLI`；计划 `.reviews/取消够不到审查员CLI/plan/`（D1～D7 送审前已定、全取建议项 → 计划双审 run `20260927T190138Z`：codex `approve-with-nits`、gemini / glm `request-changes`，16 条全接受 → 用户审批通过（无附言）→ r2 定稿，提交 `8267ffa`）
- **起点**：`8267ffa`（计划 r2 提交）；计划行号取自 `dbd1a8a`（两者之间只有计划留痕，源码未变）
- **状态**：代码双审 r1（run `20260927T230542Z`）9 条全接受、审批通过（无附言）；已按应答件修订（§7），未提交
- **evidence**：`doc/05_testing/evidence/cancel-cli-reach-20260928/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §4.1 登记 | `util/exec.ts`：模块级 `liveTrees`；`run()` 在 `killTree` 派生后同步 `set`，`'exit'` 时删（同一对象才删） | U7①⑤、M6、M8 |
| §4.1 冻结 | `util/exec.ts`：模块级 `treeShutdown`；`run()` 进门置位即返回永不兑现的 Promise；`finish()` 清计时器后不 resolve。文档块写明「对全部 `run()` 生效」的显式决定与「worker 侧新增 `run()` 调用者须知晓」（CODEX-04） | U7①③、M3、M4 |
| §4.1 终止 | `util/exec.ts` 新增 `shutdownTrackedTrees`：进门同步置冻结 → 对登记里尚未退出的子进程**并行**调 `terminateProcessGroup`（判据是父进程句柄的 `exitCode` / `signalCode`，`pollMs` 缺省 50）→ 返回 `{ groups, signals, remaining }` | U7①②④⑥、M2、M10 |
| §4.2 处理器 | `run-protocol.ts` 新增 `installWorkerSigtermForwarding()`（返回卸载函数）与常量 `WORKER_TREE_GRACE_MS` 2000、`WORKER_TREE_KILL_WAIT_MS` 1000：只处理第一次（`process.on` + `handling`）→ 3.5 s 看门狗 → `shutdownTrackedTrees` → `worker.log` 写一行 → `exitOnce`（`exiting` 防重入、清看门狗、移除监听、`process.kill(self,'SIGTERM')`、1 s 后才 `exit(143)`）。`workerMain` 第一行装、`finally` 首行卸 | U9①②、I1、I2、M1、M5、M9 |
| §4.3 常量与播报 | `WORKER_TERM_GRACE_MS` 5000，`cancelRun` 与 `settleOrphanedStart` 共用；`cancelRun` 注释改写；`onEscalate` 的 warn 与「工作进程已不存在」分支各补一句如实提示（指向 EV-154） | U8、M7；A3 |
| §5.2 桩 | `stub.ts` 新增 `hang_cli`（与可选 `ignoreTerm`）：以仓库 `run()` 按 `killTree` 派生 `sh -c '[trap '' TERM; ]sleep 600; : "$0"' trivium-stub-cli:<out_dir>` | I1、I2、A1～A4 |
| 注释改准 | `util/exec.ts` 的 `RunOptions.killTree`、`killProcessTree`、`terminateProcessGroup` 文档块；`worker-detach.test.ts`「杀整组」用例注释 | 反扫（§4） |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 1 次（文档同步之前）**2172 / 2170 / 0 / 2**，一次全绿（起点 2161 → 新增 11 条：U7①～⑥、U8、U9①②、I1、I2）；文档同步与本报告之后的读数见 §6 |
| 受影响套件单跑 | `worker-detach` / `run-protocol` 的 EV-152 各条全绿；`gate-loop` 的 I1（约 2.0 s）、I2（约 3.6 s）绿 |
| 源码侧变异（`mutation-spec.json`，`scripts/mutation-check.mjs`；规格由 `gen-mutation-spec.mjs` 从源码截锚点并逐条核对唯一） | **10 / 10**（`mutation-output.txt`，基线三个套件全绿）：M1 fail=2、M5 fail=2（`gate-loop.test`）；M2 fail=2、M3 fail=1、M4 fail=1、M6 fail=4、M8 fail=1、M10 fail=1（`worker-detach.test`）；M7 fail=2、M9 fail=2（`run-protocol.test`） |
| 失败用例名与文案（`mutation-names.mjs` 第 2 版，只跑 EV-152 用例） | M1：I1、I2 红，首行「两组都应已空」；M5：I1、I2 红，首行「worker 应在宽限内自己退出，不被升级 SIGKILL」与 `/未响应 SIGTERM/`（**断言在 stderr 上**，计划双审 GLM-02）；M6：U7①②⑤⑥；M7：U8「处理器超预算……」与 U9②「应在取消宽限内退出，实为 5058 ms」；M9：U9①「重新自杀的退出形态」与 U9②。**都没有「桩 CLI 没起来」一类的前置失败**（`mutation-names-output.json`） |
| 零配额验收（`acceptance.mjs`，新旧两份构建） | **8 / 8**（`acceptance-readout.json`、`acceptance-output.txt`）；第 1 次 7 / 8，A6 是验收脚本归一化的漏洞，见 §3.3 |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | **14 / 14** |
| 残留进程 | 每次跑完进程表里没有带 `trivium-stub-cli` / 探针标记 / `review --worker` 的进程 |
| 环境 | Node v25.2.1，macOS |

验收各格读数（第 2 次）：

| 格 | 读数 |
| :--- | :--- |
| 构建 | 新 bundle sha256 `19e8062a5b61…`，旧 `aada0dd4ba87…`（`dbd1a8a` + 只叠加 `stub.ts`），两者不同；叠加面的 diff 存进读数 |
| A1 | 两侧 `hang_cli`：`--cancel` 前两组各 2 个成员（sh + sleep），后各 0；`worker.log`「收到 SIGTERM：已按组终止审查员 CLI 73484（SIGTERM），73485（SIGTERM）」；status.json / run.json 都是 `cancelled`；`--cancel` 394 ms |
| A2 | 一侧 `ignoreTerm`：两组后各 0；那一组信号序列 `SIGTERM、SIGKILL`；`--cancel` 没有升级；2199 ms（上界 `WORKER_TERM_GRACE_MS - 500` = 4500） |
| A3 | 按组 SIGKILL worker（覆盖不到的格）：两组各 2 个成员仍在、组长 ppid = 1；随后 `--cancel` 的 stderr 含「拉起的审查员 CLI 可能仍在」 |
| A4 | 旧构建同 A1：`--cancel` 之后两组各 2 个成员仍在——今天的缺口 |
| A5 | 计划期两个探针重跑：K1 `killTree` 子进程活、普通子进程死；P1～P6 与计划期相同（P3 / P5 / P6 活），P7 / P8 不适用；H1 两组空、H2 两组各 2 |
| A6 | `hang` 桩（进程内挂起）新旧两份构建 `--cancel`：退出码同为 0；stdout 与 stderr 归一化（run_id、时间戳、mkdtemp 路径、主题名、三位以上数字）后逐行相同 |
| A7 | A1 之后会话启动 Hook 退 0，提示里没有该运行 |

## 3. 偏离与如实登记

### 3.1 与 r2 文字的出入

- **U7⑥ 的参数与上界**：r2 写 `graceMs: 1000`、`killWaitMs: 500`、上界 `graceMs + killWaitMs + 1000`（2.5 s）。实施时算了一下：串行时每组约 1.05 s（宽限 1 s + SIGKILL 后几十毫秒），两组约 2.1 s，**落在 2.5 s 之内，串行化咬不住**。改为 `graceMs: 1500`、`killWaitMs: 500`、上界 `graceMs + killWaitMs + 500`（2.5 s）：并行约 1.55 s，串行约 3.1 s。M10 实测咬住（fail=1）。
- **桩的标记走 `$0`**：r2 写的是 `sh -c 'sleep 600; : trivium-stub-cli 〈out_dir〉'`（标记在 `-c` 串里）。实施改为 `sh -c '…; : "$0"' trivium-stub-cli:〈out_dir〉`：路径作为 argv 进进程表，不经 shell 解析，免得路径里的特殊字符出问题。标记同样只在 sh 那一层，判据仍是按组号枚举。
- **worker.log 行带 `[worker]` 前缀**：便于验收脚本与用例从日志里截那一行。
- **警告直接引 EV-154**：r2 写「BACKLOG 〈新条目〉」。编号在实施时取定，`cancelRun` 两处警告与各处文档都引 EV-154。
- **卸载函数的条件**：`uninstall()` 只在处理器没在跑时才移除监听（`if (!handling)`）。处理器在跑时由 `exitOnce` 自己移除，避免 `finally` 在处理器执行期间把监听拿掉、让第二次 SIGTERM 走缺省动作。按 r2 §4.2 的论证，这一格实际走不到（有 CLI 时 `workerMain` 被冻结，没有 CLI 时进程在微任务里就结束了），这里只是保险。

### 3.2 只按代码论证、没有用例直接钉住的格

- **取消落在收尾段（r2 §4.4 a″）**：处理器执行之前至多一次事件循环迭代的推进窗口。零配额造不出确定时序，没有用例；A6 只证明「没有 CLI 时 `--cancel` 的输出与今天相同」，不覆盖这段窗口。
- **组长退出后同组遗留的后代（h 格）**、**CLI 自己 `setsid` 出去的后代（g 格）**：桩造不出，按代码论证、如实保留。h 格原写成「组长退出后同组残留**忽略 SIGTERM 的**后代」，说窄了：组长一退出该组就从登记里删掉、整组收不到信号，与后代是否忽略 SIGTERM 无关；这两格 `--cancel` 都不打提示（代码双审 r1 CODEX-01 ≡ GLM-02、GLM-01，§7）。
- **真实厂商 CLI 对 SIGTERM 的处置**：未实测（D3 不花配额）；桩与原型都是 `sh` + `sleep`。不响应时由 2 s 后的 SIGKILL 兜住（A2 / I2 就是这一形态）。
- **Node 18**：U9 依赖「移除最后一个监听即恢复缺省处置」与「`kill(self)` 在返回前结束进程」，只在 v25.2.1 / macOS 上量过（计划 r2 §2.5 的六次读数）。本机没有 Node 18，未测。

### 3.3 验证过程中的两处构造问题

- **变异 M4 时 U7③ 在仓库根留下一个空文件**：U7③ 原先让场景子进程在 `MARK + '-u7c-created'` 这个**相对路径**建文件，而场景子进程的 cwd 是测试进程的 cwd（仓库根）。未变异时冻结生效、文件不会建出来；M4 让 `run()` 照常派生，文件就落在了仓库根（`trivium-u7-trivium-detach-CuJ5ML-u7c-created`，0 字节，已删除）。改为 `new URL('./u7c-created', import.meta.url).pathname`，落在本格的 mkdtemp 里、随夹具一起清掉。M4 的结论不受影响（锚点在 `src/`，判据仍是「文件不存在、Promise 不兑现」）。
- **验收第 1 次 7 / 8**：A6 的 stdout 里有「已回收主题「A6-new」的锁」，新旧两份的主题名不同，而归一化只处理了带斜杠的路径形态，于是 A6 假红。两份的 stdout 除主题名外逐字相同。归一化改为处理裸主题名后重跑整套，8 / 8。第 1 次的读数留在 `acceptance-readout.r0.json`、`acceptance-output.r0.txt`。

### 3.4 其它

- **计划期探针的前两版**留下过 4 个探针自己的 node 进程（P7 / P8 走早退分支时没有结束 worker，且 worker 的 argv 不带标记）。已按进程组结束，第 3 版修好；evidence 里的 `probe-pipe-break.mjs` 是第 3 版，`probe-pipe-break.out.json` 是第 3 版的读数，`.r1` / `.r2` 是前两版的读数（P1～P6、H1 / H2 三次相同）。
- **PRD 不改**：核后没有需求面变化（r2 §6）。
- **LLD**：只改了 `startRun` 第 5 条、worker 主体一节与已知缺口表两行；worker 主体一节标题里的行号锚点（`run-protocol.ts:396`）仍是旧的，与上一主题记下的「其余章节锚点漂移」同属一类，未改。

## 4. 文档同步

| 文件 | 落点 |
| :--- | :--- |
| 主设计 → v1.3.52 | 当前版本行；7.5 `review --cancel` 行（单行）；7.5 表后新增「工作进程的信号语义」段；6.7 注记 ⑤ 里「按组发够不到」一句补「自 v1.3.52 起由 worker 的 SIGTERM 处理器转发」；变更记录 v1.3.52 行 |
| LLD → v1.1.10 | 版本行与变更说明；`startRun` 第 5 条末句；worker 主体一节补 SIGTERM 处理器；已知缺口表改写一行、新增「取消落在收尾段」一行 |
| MANUAL → v1.0.10 | 版本行；取消一节补「worker 先结束它拉起的 CLI」，「已知缺口」段改为两种情形并指向 EV-154 |
| PROTOCOL | :360 `--cancel` 段补一句 |
| BACKLOG | EV-152 done；EV-38 / EV-146 注记；新登 EV-154（修法 ② 余项）、EV-155（前台 Ctrl-C，推断）、EV-156（`pty: true` 跑不起来，实测） |
| PRD、run.v2 schema、skill 与入口资产、CLI 帮助、本仓根 `CLAUDE.md` | 不改 |

反扫（`-c core.quotepath=off`，`doc/`（排除 evidence 与历史报告、BACKLOG）、`skills-src/`、`skills/`、`src/`、`test/`）：「够不到」「自成一组」「EV-152」的剩余命中都是本次新写的说明，或者是正确的限定语（「按组发够不到，由处理器转发」「被 SIGKILL 时够不到」）；「含两侧厂商子进程」「连同 agy」「也在同一组里」零命中。`killProcessTree` 文档块里「够不到的」一段指向了余项条目，已改为 EV-154；`stub.ts` 的 `hang_cli` 文档块按实现改为走 `$0` 的写法。

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `probe-pipe-break.mjs`、`probe-pipe-break.out.json`（`.r1` / `.r2` 为前两版读数） | 计划 §2.2 / §2.4：P1～P8（管道断开之后假 CLI 的去留）、H1 / H2（修法 ① 原型在 SIGTERM / SIGKILL 下） |
| `dbg-pty.mjs` | 计划 §2.3：`pty: true` 在管道 stdin 下 `script` 退 1 |
| `gen-mutation-spec.mjs` → `mutation-spec.json`、`mutation-output.txt` | 源码侧变异规格生成、锚点唯一性核对与结果 |
| `mutation-names.mjs`（拷自上一主题第 2 版）、`mutation-names-output.json` | M1 / M5 / M6 / M7 / M9 的失败用例名与首行文案 |
| `acceptance.mjs`、`acceptance-readout.json`、`acceptance-output.txt`（第 1 次读数 `.r0`） | 零配额验收 A1～A7 与新旧构建 |

上一主题的 `evidence/orphan-worker-20260927/probe-kill-reach.mjs`（K1）在 A5 里原样重跑，没有另拷。

## 6. 待办

1. ~~文档同步与本报告之后再跑一次 `npm run check`~~——已跑，读数见下。
2. ~~用户在终端重装之后，用户敲 `/dual-review-code`~~——r1 已过，修订见 §7。
3. 提交等用户说；推送等用户确认。提交后从已提交状态重建、用户终端重装（`--targets claude,glm,codex,gemini`）、复核安装副本一致。

文档同步与本报告初稿之后的第 2 次全量：**2172 / 2170 / 0 / 2**，一次全绿；两次都没有出现 EV-149 / EV-153 那两条偶发红（`check-1.txt` / `check-2.txt` 为两次的摘要）。

## 7. 代码双审 r1（run `20260927T230542Z`）与修订

三侧：gemini `approve`（零意见）；codex `approve-with-nits`（次要 3、吹毛求疵 3）；glm `approve-with-nits`（次要 1、吹毛求疵 2）。9 条全接受，同指两组：CODEX-01 ≡ GLM-02、CODEX-05 ≡ GLM-03。用户审批通过（无附言）。应答件 `.reviews/取消够不到审查员CLI/code/2026-09-28-取消够不到审查员CLI-response-claude.md`。

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 ≡ GLM-02 | h 格改准：组长一退出（含处理器运行前已正常退出），该组就从 `liveTrees` 删掉、整组收不到信号，同组遗留的后代与是否忽略 SIGTERM 无关。`exec.ts` 文档块、设计 7.5、LLD worker 主体、BACKLOG EV-152 去向同步；EV-154 待论证清单补「CLI 退出时清空同样漏这一格」 | 反扫 |
| GLM-01 | MANUAL 已知缺口段：会打提示的是那两种情形；另有两种较窄的形态不会打提示（CLI 先于 worker 退出后遗留的子进程、CLI 自己脱离进程组的后代），想确信没有残留仍用 `ps` 查。PROTOCOL `--cancel` 段与设计 7.5 同步写明「这两格不打提示」 | 反扫 |
| CODEX-02 | `shutdownTrackedTrees` 文档块首句写契约：「调用即本进程进入终止中、不可撤销，调用方必须随后结束本进程」；`treeShutdown` 注释同步；不设测试复位口（理由见应答件）；EV-155 候选补这条契约 | — |
| CODEX-03 | EV-154 候选段补「与 `liveTrees` 的关系」：登记面唯一来源是 `liveTrees`，跨进程可见只需落它的条目；若仍走 `onSpawn` 要说明为什么不能由它派生 | — |
| CODEX-04 | 新增 `test/helpers/proc.ts`（`groupsWithMark` / `groupMemberCount` / `killGroup`），`gate-loop` / `run-protocol` / `worker-detach` 三个测试的外层判定与清理改用它；`worker-detach` 场景子进程脚本串里那份与 `acceptance.mjs` 保留自包含副本并注明同源 | 全量、变异 |
| CODEX-05 ≡ GLM-03 | I2 的计时上界放宽为 `WORKER_TERM_GRACE_MS + 2000`，注释写明主判据是 stderr 的因果断言（M5 靠它咬住）、计时只防挂住；U7⑥ 改为 `graceMs: 2000`、上界 `grace + killWait + 1000`（3.5 s），失败文案写明并行 / 串行的预期值；U9② 余量 2.4 s，不动 | M10 重跑：U7⑥ 红，实为 4555 ms；未变异时 2568 ms |
| CODEX-06 | `run-protocol.ts` 新增 `ORPHAN_KILL_CONFIRM_MS = 5000`（派生后失败收尾里 SIGKILL 之后的确认窗口），`settleOrphanedStart` 改用；`cancelRun` 的 `killWaitMs: 0` 旁补注释；设计 7.5 `--start` 行「约 20 s」对上两个常量名 | — |

修订后读数（修订前的规格与读数留 `.r1`，第 1 次验收留 `.r0`）：

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 修订后、本节写之前 **2172 / 2170 / 0 / 2**，一次全绿（`check-3.txt`）；本节写完之后的读数见下 |
| 源码侧变异（重生成的规格，find 锚点与 r1 逐条相同） | **10 / 10**：M1 fail=2、M2 fail=2、M3 fail=1、M4 fail=1、M5 fail=2、M6 fail=4、M7 fail=2、M8 fail=1、M9 fail=2、M10 fail=1；这次仓库根没有留下文件（U7③ 已改绝对路径） |
| 失败用例名与文案（M1 / M5 / M6 / M7 / M9 / M10） | 与 r1 相同，都是目标用例；M10 红 U7⑥，文案「实为 4555 ms（预期：并行约 2050 ms、串行约 4100 ms……）」；都没有前置失败 |
| 零配额验收 | **8 / 8**（新 bundle sha256 `5bf0eb0e1fa7…`，旧 `aada0dd4ba87…`）；A2 2476 ms |
| `doctor --selftest` | **14 / 14** |
| 残留进程 | 无 |

本节写完之后的第 4 次全量：**2172 / 2170 / 0 / 2**，一次全绿（`check-4.txt`）。四次全量都没有出现 EV-149 / EV-153 那两条偶发红。
