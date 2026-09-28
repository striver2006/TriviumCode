# 失联后取消挂住的worker · 实施报告（EV-146）

- **日期**：2026-09-28
- **主题**：`失联后取消挂住的worker`；计划 `.reviews/失联后取消挂住的worker/plan/`（用户决策 1～8 送审前已定 → 计划双审 run `20260928T044009Z`：codex / glm `approve-with-nits`、gemini `request-changes`，15 条接受 13、驳回 1、暂缓 1 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`50cb380`（`main`，clean）；计划与本报告的行号取自该提交的源码
- **状态**：实施与验证完成；代码双审 r1（run `20260928T054035Z`）已应答并按接受项修订（§7）；未提交
- **evidence**：`doc/05_testing/evidence/lost-worker-cancel-20260928/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §4.1 `lost` 字段 | `status.ts`：`RunStatus.lost?: WorkerLostRecord \| null`、`WorkerLostRecord { reason, at }`、`lostOf`（`reason` ∈ `WORKER_LOST_REASONS` 且 `at` 为非空字符串才返回，否则 null） | K1、N2 |
| §4.1 写者 | `run-protocol.ts` `waitRun` 失联分支：写 `failed` 的同一次 `patchStatus` 里加 `s.lost = { reason, at }` | K2、K3、N1 |
| §4.2 报错的事实行与出口行 | 同处：`heartbeat_stale` 且改写前判「未确认退出」时，报错正文追加「判定依据：工作进程 N 仍在，status.json 已 X s 未更新（失联阈值 heartbeat_stale_s = T s；工作进程的心跳间隔是 30 s）」，阈值不大于间隔时接「——阈值不大于心跳间隔：健康的工作进程也会被判失联」，再给 `trivium review --cancel <run>` 出口句 | K2、J1、N15 |
| §4.3 判格 | 新增导出 `classifyLostCancel`：`none` / `no_identity` / `gone` / `mismatch` / `alive`；类型守卫（`worker_pid` 为 > 1 的整数、`worker_started_at` 为非空字符串）；只认 status.json 的两项 | K5、N3～N6 |
| §4.3 终态分支 | `cancelRun` 终态分支先判格：`alive` 交给 `cancelLostWorker`；其余照原 EV-154 D3 结束 CLI；`mismatch` / `no_identity` 两格之后打如实结论（不再说「无需取消」）；`none` / `gone` 输出逐字不变 | K5、K8、N16a、N16b、C5、C7 |
| §4.4 动作链 | 新增 `cancelLostWorker`：开场事实句（判定之后又写过即 warn「可能只是心跳慢」）→ `terminateProcessGroup`（宽限 `WORKER_TERM_GRACE_MS`、SIGKILL 后等 `ORPHAN_KILL_CONFIRM_MS`）三种播报 → `terminateRecordedCliGroups`（没确认退出也照做）→ 确认退出后 `finalizeFailedRunMeta`（`worker_lost` / `heartbeat_stale`）→ `run_id` 与 `pid` 都相符才 `reclaimStaleLock` → stdout 结论。`cancelRun` 第三参数 `CancelOptions.terminateWorker` 只给单测 | K3、K4、K6、K7、J1、J2、N7～N13 |
| §4.4 播报后半句 | `reportFinalizeStep` 加可选第四参数（缺省即主路径原句） | K9、既有 E6 |
| §4.4 常量 | `ORPHAN_KILL_CONFIRM_MS` 文档块改为两个使用方 | — |
| §4.5 契约说明 | run.v2 schema `status` / `termination` 两处 description、`types.ts` 两处注释、`meta.ts` `FinalizeInput.workerGone` 与 `finalizeFailedRunMeta`（七个调用方）的文档块；枚举不变 | `run-meta-strict` S2 / S3 照绿 |
| §4.4 第 6 步 不做 | status.json 不写、闸门不动、凭据副本不抹 | K3（status.json 逐字节、闸门项相同）、J3、C6、N13、N14 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 1 次（文档同步之前）**2200 / 2198 / 0 / 2**，一次全绿（起点 2188 → 新增 12 条：K1～K9、J1～J3）；文档同步之后的读数见 §6 |
| 新增用例耗时（第 1 次全量） | J1 11.7 s、J2 4.2 s、J3 9.2 s；K1～K9 每条 < 0.4 s |
| 源码侧变异（`mutation-spec.json`，17 条，锚点由 `gen-mutation-spec.mjs` 从源码截取并核对唯一） | **17 / 17**（`mutation-output.txt`，基线三个套件全绿）：N1 fail=6、N10 fail=4、N13 fail=3、N7 / N8 fail=2、其余各 fail=1 |
| 失败用例名与文案（`mutation-names.mjs`，17 条全跑，只跑 EV-146 用例） | 全部红在目标用例的目标断言上（`mutation-names-output.json`、`mutation-names-output-gateloop.json`）：N2「reason 不在枚举里」；N3 / N4 / N6「不入本格就不对 worker 发信号」；N5「run.json 不动」；N9「未确认退出时 run.json 必须逐字节不变」；N11 锁文件已被删（ENOENT）；N13「status.json 一个字节都不写」；N15 事实行正则不匹配；N16a 告警正则不匹配、N16b「R-K5-5a」；N7 / N8 在 J1 的 `--cancel` stderr 断言上红；N14 在 J3 的「载体仍在」上红（ENOENT）。**没有「用例前提」一类的前置失败** |
| 零配额验收（`acceptance.mjs`，新旧两份构建，旧 = `50cb380`、不叠加任何文件） | **9 / 9**，第 1 次即全过（`acceptance-readout.json`、`acceptance-output.txt`） |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | **14 / 14** |
| 残留进程 | 验收结束时 `leftover_groups` 为空；探针、用例、变异跑完进程表里没有带本次标记或 `review --worker` 的进程 |
| 环境 | Node v25.2.1，macOS |

验收各格读数：

| 格 | 读数 |
| :--- | :--- |
| 构建 | 新 bundle sha256 `f6bfc4105625…`，旧 `418d7a1d2c5b…`，两者不同；`stub.ts` 相对 `50cb380` 无 diff，旧构建不叠加任何文件 |
| C1 | 新：`--wait` 退 1、判 heartbeat_stale、报错含出口句、status.json 记 `lost.reason = heartbeat_stale`，worker 与两组（各 2 个成员）仍在；此时同阶段 `--start` 退 70；`--cancel` 退 0、升级 SIGKILL、「按记录结束」2 行、**5402 ms**；worker 不在、两组各 0；run.json `failed` + `termination { worker_lost, heartbeat_stale }`、登记 `failed`、锁不在、status.json sha256 不变；之后同阶段 `--start` 退 0 |
| C2 | 旧：`--wait` 退 1、status.json 没有 `lost` 键；`--cancel` 终态早退；worker 仍在、两组各 2；run.json `running`、锁在；之后 `--start` 退 70（EV-146 原文，与计划 §2 P2 读数一致） |
| C3 | 新（不堵）：不升级、stderr 说「在宽限内响应 SIGTERM」、worker.log 有处理器那一行、worker 不在、两组各 0、run.json `failed`；旧：终态早退、worker 仍在、两组各 2、run.json `running`（与计划 §2 P1 一致） |
| C4 | C1 之后再 `--cancel`：终态早退原样两行，status.json 与 run.json sha256 不变 |
| C5 | 上一主题 B3（b 格）与 B6（c′ 格）按原判据在新旧构建上各跑一遍，四份都过（本主题不改这两格） |
| C6 | `--wait` 后、本格 `--cancel` 后载体都仍在；`trivium scrub` 后被抹 |
| C7 | 常态格 a（`hang` 与 `hang_cli` 各走 `--start` / `--cancel`）：退出码新旧同为 0，stdout 与归一化后的 stderr 逐行相同 |
| C8 | 回滚方向：新构建写下 `lost`，旧构建 `--status --json` 退 1（新构建同为 1）、`lost` 原样透出；旧 `--cancel` 退 0、终态早退 |

## 3. 偏离与如实登记

### 3.1 与 r2 文字的出入

- **变异 N9 / N10**：r2 §5.3 的 N9「未确认退出也补收 run.json」与 N10「未确认退出也回收锁」在实现里是同一处早退（`if (!gone) { …; return }`），拆不成两条独立的变异。实施时把 N9 定为「未确认退出也往下走（补收 run.json 与回收锁一起）」，N10 改为「确认退出后也不补收（`workerGone` 传 false）」，两条都咬住（N9 → K4，N10 → K3 / K6 / K7）。r2 的 N16 拆成 N16a（`mismatch`）与 N16b（`no_identity`），共 17 条。
- **`LostCancelCell` 的 `alive` 分支多带一个 `lost`**：r2 §4.3 的类型只写了 `pid` 与 `startedAt`；实现把判格时读到的 `lost` 一并带给 `cancelLostWorker`，免得它再读一次。
- **`mismatch` 告警的位置**：r2 §4.3 的代码段把告警写在 EV-154 D3 之后，实现照做（告警与结论都在按记录结束 CLI 的播报之后）。
- **K2 并入 L1 / L2 的断言**：r2 写「L1 / L2 加断言」，实现另起了 K2（覆盖 heartbeat_stale 的两种阈值与 pid_gone 三格），L1 / L2 原样未动。

### 3.2 只按代码论证、没有用例直接钉住的格

- 本格在确认退出之后、补收之前被中断（EV-159 的一种形态）：毫秒级窗口，造不出来。
- 判定与发信号之间 pid 被复用：与主路径同一口径，毫秒级。
- `terminateWorker` 抛错那一支（`t = null` 后复判一次；代码双审修订后用严格判据 `lostWorkerGone`，§7）：只有注入桩能造，未单列用例。
- 「判定之后工作进程又写过 status.json」那句 warn：没有用例断言它（J2 里 `--wait` 与 `--cancel` 间隔很短，worker 的心跳 30 s 一次，这句出不出现取决于时序）；它只影响措辞，不影响动作。

### 3.3 过程中的一处 Hook 误拦（如实记录）

- `topic resolve` 之后我想只取输出里的非目标字段，写了一条含 `=>` 的 `node -e` 管道，被 Bash Hook 按已知误拦形态拦下；没有换写法绕，改为重跑同一条已放行的原命令、只取输出末尾。
- 往 `run-protocol.test.ts` 追加 K 组时用 heredoc 被拦（正文有 `_meta` 等字样），改用 Edit 追加。

## 4. 文档同步

| 文件 | 改动 |
| :--- | :--- |
| 主设计 → v1.3.54 | 7.5 `review --cancel` 行追加本格（单行）；7.5 新增「失联后取消挂住的工作进程」段（`lost` 字段、判格、五步、不做、误判代价、如实保留）；6.7 注记补 ②′；6.7.1 `termination` 行补写者；故障表 `worker_lost` 行、验收表加一行；变更记录 v1.3.54 |
| LLD → v1.1.12 | 变更说明；「仍会停在 `running` 的」改准；4.2 新增「`cancelRun` 结束失联后仍挂着的 worker」引述块；已知缺口表 EV-158 行后果栏补本格，新增 EV-159、EV-160 两行 |
| MANUAL → v1.0.12 | 取消一节「`--wait` 报失联之后再跑 `--cancel`」按失联原因分两种；「只能手工结束」改为判定依据怎么读、`--cancel` 的几种结局怎么读（MANUAL 没有变更说明行，版本随正文内联标注） |
| PROTOCOL | `termination` 段补写者；`review --start / --wait / --status / --cancel` 行补本格与 `lost` 键（对外 JSON 形状的加法） |
| BACKLOG | EV-146 → done；EV-157、EV-158 注记；新登 EV-159、EV-160 |
| PRD → v1.4.16 | **核后改**：FR-24 原写「失联时进程还在则不写、仍为 running」，本主题之后这类运行被 `--cancel` 结束后会记 `failed`，按 v1.4.11～v1.4.15 的口径补一句边界，不新增需求、不改判据 |
| run.v2 schema、`types.ts`、`meta.ts` | 只改说明文字（§1） |
| skill 与入口资产 | 不改：`skills-src/` 无「失联」「worker_lost」；skill 对非 0 / 73 的 `--wait` 退出码原样转述报错，事实行与出口行随之到达用户 |

反扫「EV-146」「手工结束」「无需取消」：剩余命中都是本主题新写的，或上一主题 v1.3.53 行等历史说明。

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `probe-lost.mjs`、`probe-lost-50cb380.json` | 计划期探针 P1 / P2 与读数（`50cb380` 构建） |
| `gen-mutation-spec.mjs`、`mutation-spec.json`、`mutation-output.txt` | 源码变异规格生成、规格、装置输出 |
| `mutation-names.mjs`、`mutation-names-output.json`、`mutation-names-output-gateloop.json`、`mutation-names-stderr.txt` | 失败用例名与首行文案核对（前者照搬上一主题同名脚本，缺省 id 改为 N1） |
| `acceptance.mjs`、`acceptance-output.txt`、`acceptance-readout.json` | 零配额验收 |
| `check-1.txt`～`check-5.txt` | 全量第 1～5 次输出（第 4、5 次在代码双审修订之后，§7） |
| `*.r1.*` | 代码双审修订之前的变异规格、变异与名字核对读数、验收读数 |

## 6. 文档同步之后的全量

文档同步（§4）之后第 2 次 `npm run check`：**2200 / 2198 / 0 / 2**，一次全绿（`check-2.txt`）。本报告落盘之后第 3 次：**2200 / 2198 / 0 / 2**（`check-3.txt`）。三次全量都没有撞上 EV-149 / EV-153 的偶发红。

## 7. 代码双审 r1（run `20260928T054035Z`）与修订

- **结论**：codex `approve-with-nits`（重要 1、次要 2、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）。7 条全部接受（应答件在 `.reviews/失联后取消挂住的worker/code/`），`gate --check` 通过。
- **按接受项的修订**：
  - CODEX-01 ≡ GLM-01：`cancelLostWorker` 的退出判据改为严格形态 `lostWorkerGone`（纯函数核 `lostWorkerGoneFrom`：进程不存在，或取到的启动时刻与记录不同才算已退出；`ps` 取不到不算），`terminateProcessGroup` 的 `isGone` 与抛错后的复判都用它；第 2 步播报按「零信号已不在 / 宽限内响应 / 升级」三态分，零信号那一格不说「响应 SIGTERM」「处理器已收拾」，无记录告警照常打，stdout 结论改说「在发信号之前已不在，未对它发信号」。共享的 `workerGoneForCancel` 不改。
  - CODEX-02：终态分支在 `mismatch` 格跳过 EV-154 的按记录结束 CLI——一个信号都不发，告警与结论写明「本次也未结束它名下的审查员 CLI」。
  - CODEX-03：只取文档一半（设计 7.5「如实保留」、MANUAL、BACKLOG EV-159 并入升级窗口那一形态）；不读 `message` 做提示（用户决策「只取结构化事实」）。验收 C8 只验了新 → 旧，这一点如实保留。
  - CODEX-04：设计 7.5 `--cancel` 行与 MANUAL 写明本格的返回上界；J1 的计时上界改为 60 s（只防挂死）。
  - CODEX-05：`cli.ts` 的 USAGE `--cancel` 行补本格；`lock.ts` 导出 `lockPathFor`，`run-protocol.ts` 三处锁路径改用它。
  - GLM-02：设计 7.5 与 LLD 4.2 按格分写——`mismatch` 一个信号都不发；`no_identity` 沿用 EV-154 终态分支自己的判断（worker 确认已不在才结束 CLI）。
- **新增用例**：K5′（`mismatch` 格记录里的活 CLI 组不被结束；`no_identity` 而 worker 已不在时照旧按记录结束）、K10（零信号已不在的播报、无记录告警与结论）、K11（严格判据四格）。

| 项 | 修订后读数 |
| :--- | :--- |
| `npm run check` | 第 4、5 次（修订与文档都改完之后）**2203 / 2201 / 0 / 2**，两次都一次全绿（`check-4.txt`、`check-5.txt`；起点 2200 → 新增 K5′、K10、K11） |
| 源码侧变异 | **20 / 20**（`mutation-output.txt`；按修订后代码重生成规格，N8 / N13 / N14 的锚点随代码改了取法，新增 N17～N19；r1 的规格与读数留 `mutation-spec.r1.json`、`mutation-output.r1.txt`，r1 为 17 / 17） |
| 失败用例名与文案 | 20 条全部红在目标用例上（`mutation-names-output.json`、`mutation-names-output-gateloop.json`）：N17 红在 K10（stderr 不含「未及发信号」）、N18 红在 K5′（stderr 出现「按记录结束审查员 CLI：gemini 侧进程组」）、N19 红在 K11「ps 取不到启动时刻：判不了，不算已退出」；其余与 r1 同一用例。没有前置失败 |
| 零配额验收 | **9 / 9**，第 1 次即全过（`acceptance-output.txt`；r1 读数留 `.r1`）；C1 `--cancel` 5447 ms；无残留进程 |
| `doctor --selftest` | **14 / 14** |
| J1 耗时 | 第 4、5 次全量各约 11.7 s（防挂死上界 60 s） |
