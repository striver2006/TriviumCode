# 失联取消判不了不升级 SIGKILL · 实施报告（EV-177 ①）

> - **日期**：2026-10-06
> - **主题**：`失联取消判不了不升级`（M11 前待办批次第 7 题；**本批未走双审**，用户以 `/goal` 授权直接开发、定「只做 ①，② 改退出码不做」，提交前由执笔方自审补丁）
> - **起点**：`231cf8a`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/lost-cancel-unverifiable-20261006/`
> - **配额**：零配额

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/run-protocol.ts` `cancelLostWorker`（:1622 起）结束工作进程用 `terminateProcessGroup(p, { isGone: () => lostWorkerGone(p, r), graceMs: WORKER_TERM_GRACE_MS, killWaitMs: ORPHAN_KILL_CONFIRM_MS, … })`。`lostWorkerGone`（:1522）是布尔：进程在而启动时刻取不到 ⇒ `false`（「仍在」）。于是宽限期满时若最后一次判不了身份，`terminateProcessGroup` 照样升级 SIGKILL——与 EV-176 定下的主路径口径「不向身份判不了的进程发 SIGKILL」相反（BACKLOG EV-177 ①）。
2. `terminateProcessGroup`（`util/exec.ts`）的 `isGone` 早已是三态（`GoneJudgment = boolean | 'unverifiable'`，EV-176）：首检判不了 ⇒ 一个信号都不发；宽限期满判不了 ⇒ 不升级；SIGKILL 后判不了 ⇒ 继续等；结果带 `unverifiable: true`。主路径用的 `workerGoneForCancel`（:775）就是按 `identity === 'unverifiable'` 返回 `'unverifiable'`。
3. 本格未确认退出时：告警「已向工作进程组 … 发送 …，未能确认退出：归档 run.json、主题任务文件的运行登记与主题锁都不动」，照 D4 按记录结束 CLI，以 0 退出（EV-177 ②，本批不改）。
4. `lostWorkerGone` 另有一个消费方：`cancelLostWorker` 里 `terminateProcessGroup` 抛错后的复判（`await lostWorkerGone(pid, rec).catch(() => false)`），布尔口径在那里合适；EV-177 登记的候选也是「`lostWorkerGone` 本身不动」。

### 修法

1. `run-protocol.ts` 新增导出 `lostWorkerGoneJudgment(pid, rec, o?)`：同 `lostWorkerGone` 的判据，但 `identity === 'unverifiable'` 时返回 `'unverifiable'`；`cancelLostWorker` 的 `isGone` 改用它。`lostWorkerGone` 与抛错后的复判不动。
2. 本格的播报：宽限期满判不了（只发了 SIGTERM）时，未确认退出那条告警补「宽限期满时取不到它的启动时刻、判不了身份：不升级 SIGKILL」；首检即判不了（零信号，改用三态判据后才出现的形态——此前首检判不了按「仍在」照发 SIGTERM）时不套用「已向……发送」的句式，如实说「取不到启动时刻、判不了身份：未发信号」。其余句子与结论句不变；仍照 D4 按记录结束 CLI；退出码仍为 0。
3. 两处说「本格宽限期满判不了仍升级 SIGKILL」的注释（`lostWorkerGoneFrom` 文档块、`cancelLostWorker` 文档块）、LLD 已知缺口表那一行、主设计 7.5 那句同步改为「① 已收口、② 仍是口径差」。
4. 用例：判据单测（三态映射，`lostWorkerGone` 回归不变）；`cancel-grace-unverifiable.test.ts` 加两格失联取消真进程用例（忽略 SIGTERM 的工作进程 + `stubPsFailure`）：SIGTERM 之后判不了 ⇒ 只发 SIGTERM、工作进程仍在、退 0、归档与锁不动；入口之后首检即判不了 ⇒ 零信号。

### 不改的边界

- 退出码（② 不做）、`lostWorkerGone` / `lostWorkerGoneFrom`、主路径、`terminateProcessGroup` 都不改。
- 零信号那一格仍照 D4 按记录结束 CLI（与主路径零信号格「什么都不动」不同）——那是 ② 一类的口径差，不在 ①。

## 1. 改了什么

1. `src/trivium/run-protocol.ts`：
   - 新增导出 `lostWorkerGoneJudgment(pid, rec, o?)`（返回 `GoneJudgment`）；
   - `cancelLostWorker`：`t` 的类型改为 `TerminateResult | null`（带 `unverifiable`），`isGone` 改用 `lostWorkerGoneJudgment`；未确认退出那条告警的首句按三种情形取（零信号判不了 / 宽限期满判不了 / 其余原句），后半句「归档 run.json、主题任务文件的运行登记与主题锁都不动……」与之后的出口句逐字不变；
   - 注释：`lostWorkerGoneFrom`、`lostWorkerGone`、`cancelLostWorker` 三处文档块里「本格宽限期满判不了仍升级 SIGKILL」「`isGone` 与抛错后的复判都用它」改为现状。
2. `test/integration/cancel-grace-unverifiable.test.ts`：`kCell` 增可选 `lost`（把 status.json 摆成 `--wait` 判过失联的样子：`phase: failed`、`lost: heartbeat_stale`），新增 W2、L1、L2 三格（见 §0 修法 4）与断言助手 `assertLostUntouched`（退 0、归档 / 登记 / 锁 / 闸门 / 载体不动、结论句「未能确认……归档与主题锁未动」）。W2 按文件头约定动态导入新导出。
3. 文档：主设计 7.5 那句与 v1.3.101；LLD v1.1.39（已知缺口表那一行）并补记 v1.1.38（EV-147 改 LLD 正文时漏记的变更说明）；用户手册 v1.0.32（「未能确认退出」那条补两种判不了的说法）；BACKLOG EV-177 ① 结案、② 维持暂缓；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| `cancel-grace-unverifiable` 单跑（先 `build.mjs --with-tests`） | 20/20（原 17，新增 W2、L1、L2）；L1 5.2 s（等满宽限） | `suite-1.txt` |
| 变异逐条预跑 | M1（`isGone` 退回布尔判据）红 2：L1、L2；M2（新判据不报判不了）红 3：W2、L1、L2；M3（零信号不单独播报）红 1：L2；M4（宽限期满判不了不说明）红 1：L1 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 4/4 咬住 | `mutation-output.txt`、`mutation-spec.json` |
| 全量第 1 次 `npm run check`（重跑） | 2856 / 2854 / 0 / 2，退 0（较起点 2853 多新增的 3 格） | `check-1.txt` |
| 全量第 2 次（串行） | 2856 / 2854 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建（重跑的两次全量与自检） | 全量 1 期间 2、全量 2 期间 1（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0。中止那次的遗留另见 §3 末条 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：自审时发现两处新写的注释说错了对象——「本函数只剩抛错后的复判在用」写在 `lostWorkerGoneFrom` 上（它同时被新判据复用），`lostWorkerGone` 文档块仍说「`isGone` 与抛错后的复判都用它」——均已订正；`grep` 核过 `lostWorkerGone(` 在 `src/` 只剩抛错后复判一处调用。另发现 EV-147 那一题改了 LLD 正文却没记 LLD 的变更说明，本题补记为 v1.1.38。
- 断言范围：既有 K / T / W1 / R1 格一条未改；`kCell` 只多一个可选参数，不传时行为与前相同。L1 / L2 只断言失联那一格；退出码断言为 0，是钉住 ② 的现状，不是新规格。
- 输出：未确认告警的首句在两种判不了的形态下变了（宽限期满判不了此前会升级 SIGKILL；首检判不了此前照发 SIGTERM，零信号是新形态，套旧句式会说成「发送 （无）」），其余文案逐字不变；这是 ① 的必然结果，不涉及退出码与 stdout 结论句。
- 护栏：L1 / L2 的夹具进程走 `spawnMarked`（argv 带 `trivium-ev176-test` 标记），收尾 `killAll` 按组 SIGKILL 并等退出；预跑与装置跑完核过无残留。
- 过程：第一次全量刚开跑时自审发现「零信号此前会说成『发送 （无）』」失实（改前首检判不了按「仍在」照发 SIGTERM，零信号是改后才有的形态），为不在全量运行中改文档，先停掉那次全量（`check-aborted.txt`）、订正报告 / BACKLOG / 设计三处措辞后重跑。被中途杀掉的测试进程留下了一个 G2 格夹具进程（argv 带 `trivium-ev176-test` 标记，核过后按组结束）与 27 个系统临时目录条目（22 个 `trivium-fx-`、4 个 `trivium-xproc-`、1 个 `trivium-ev176-G2-`）——它们不是本会话 `mkdtemp` 的返回值，按清扫规则只列不删，名单见 `aborted-run-leftovers.txt`，留给用户处理。下表全量读数是重跑的两次。
