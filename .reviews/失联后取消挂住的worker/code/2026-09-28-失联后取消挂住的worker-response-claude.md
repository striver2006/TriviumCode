---
schema: trivium.disposition.v1
topic: 失联后取消挂住的worker
stage: code
role: claude
kind: response
run_id: 20260928T054035Z
addresses:
  - 2026-09-28-失联后取消挂住的worker-codex.md
  - 2026-09-28-失联后取消挂住的worker-gemini.md
  - 2026-09-28-失联后取消挂住的worker-glm.md
---

# 应答：失联后取消挂住的worker · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260928T054035Z.diff`（相对 HEAD `50cb380` 的 30 个文件，952.5 KB——体积大头是 evidence 里三份全量输出）
> ｜ 运行：`20260928T054035Z`（约 13 分 6 秒）
> ｜ 结论：codex `approve-with-nits`（重要 1、次要 2、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）
> ｜ 共 7 条，**全部接受**；CODEX-03 只取文档那一半（不读 `message` 做提示，用户决策 2），CODEX-01 ≡ GLM-01 合并落地
> ｜ 命令 A 不设人工闸门：按接受项修订后重跑读数、写进报告 §7

## 0. 核实记录

- **CODEX-01**：成立。`terminateProcessGroup` 首检 `isGone()` 为真即返回 `{ gone: true, escalated: false, signals: [] }`（`util/exec.ts` :645），`cancelLostWorker` 的播报按 `gone && !escalated` 二分，这一支会说成「在宽限内响应 SIGTERM 退出（（无））——它的 SIGTERM 处理器已按自己的登记结束审查员 CLI」，三句都不成立；随后 `quietWhenEmpty = !escalated` 为真，「status.json 里没有在跑的审查员 CLI 记录」那句告警被静音——恰是 worker 被外部结束、CLI 可能成孤儿的那一格。
- **CODEX-02**：成立。`mismatch` 格之后的 EV-154 终态分支用 `workerConfirmedGone`，它对「活着而启动时刻不符」判「已不存在」，于是按记录结束一个可能还活着的 worker 名下的 CLI。在失联后取消这一族里，`--wait` 判 heartbeat_stale 那一刻身份是对得上的（否则会判 pid_gone），`--cancel` 时对不上，更可能的成因是本命令的环境与 `--start` 不同（EV-158），而不是 worker 死后 pid 被复用。EV-146 起 `--wait` 的报错会把 `--cancel` 作为出口推荐给人，这条错配路径的发生面被抬高了。
- **CODEX-03**：成立。`lost` 的唯一写者是 `--wait` 判失联那一次；status.json 一旦是终态，`interpretStatus` 情形 B 直接返回，不回填。升级前已被旧版判失联、worker 还挂着的运行，装上新版后仍判 `none`、打「无需取消」。意见建议的「`message` 以 `worker_lost（heartbeat_stale` 开头时改结论句」虽然只作提示，仍是读人读文案，与用户决策 2「不得解析人读文案」相违，不取；文档那一半取。
- **CODEX-04**：成立。7.5 的 `--start` 行写了返回上界与 Bash 缺省 120 s 的关系，本格的 `--cancel` 路径没写；J1 的计时断言上界 16 s 对实测 11.7 s，满载下余量不足，而注释自己说「计时只防挂死」。
- **CODEX-05**：成立。`cli.ts` :241-242 的 USAGE `--cancel` 行仍只写「回收主题锁与闸门；……标为 cancelled」，本格既不动闸门也不标 cancelled；`run-protocol.ts` 里 `path.join(ctx.triviumDir, 'lock', `${topic}.lock`)` 同款拼接有三处，而 `lock.ts` 的 `lockPath` 不导出。
- **GLM-01**：成立（≡ CODEX-01 的另一面）。`processAlive` 在 `ps` 取不到 lstart 时给 `sameProcess: false`（`util/exec.ts` :517-518），`workerGoneForCancel` 因而把「`ps` 瞬时失败」当成「已不在」；本格据 `t.gone` 直接补收 run.json、回收锁，没有独立复核——worker 若其实活着，就破坏了 EV-142「没有另一个写者」的前提。EV-154 代码双审 r1 GLM-01 对 CLI 那一侧修过同形缺陷（轮询中只认 gone 与 reused）。
- **GLM-02**：成立。设计 7.5 与 LLD 4.2 新段写「`mismatch` / `no_identity` 仍走 EV-154 的终态分支结束 CLI」，但那一支以 `workerConfirmedGone` 为前提：`no_identity` 的常见成因是 `worker_started_at` 为 null，`processAlive(pid, null)` 给 `sameProcess: true`，判「仍在」，CLI 一个也不会被结束。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核实成立：零信号的「已不在」被说成「响应 SIGTERM、处理器收拾过 CLI」，且无记录告警被静音 | `cancelLostWorker` 第 2 步按三态播报：一个信号都没发就已不在 ⇒「未及发信号，工作进程 N 已不在（在判格之后自己退出了）」，不说「响应 SIGTERM」「处理器已收拾」；该态 `quietWhenEmpty` 取 false（与升级态同值），无记录时仍打「请用 ps 核对」；stdout 结论句按三态分：「已结束仍挂着的工作进程」只在发过信号时说；新增用例 K10（注入零信号 gone 的桩）；变异 N17 |
| CODEX-02 | codex | minor | 接受 | 核实成立：身份判不上时，结束它名下的 CLI 可能打在一个活 worker 身上；本族里环境错配比 pid 复用更可能。取建议 ②（一个信号都不发），不取 ①（那是 EV-158 的局部修法，r2 D2 已论证不取） | 终态分支：`cell.kind === 'mismatch'` 时跳过 EV-154 的按记录结束 CLI，告警补「本次也未结束它名下的审查员 CLI」，stdout 结论句写「未对工作进程与它名下的审查员 CLI 发信号」；`none` / `gone` / `no_identity` 的 CLI 处理不变；K5 ④ 补记录后断言 CLI 组仍在（用真实 detached 组）；变异 N18；设计 7.5、LLD、MANUAL、BACKLOG EV-158 注记同步 |
| CODEX-03 | codex | minor | 接受 | 核实成立：升级前被旧版判失联、仍挂着的运行没有 `lost`，本格进不去。只取文档一半：读 `message` 做提示与用户决策 2 相违 | 设计 7.5 该段「如实保留」、MANUAL 对应段补「升级前被旧版判失联的运行没有 `lost`，`--cancel` 仍说无需取消，挂住的进程要在终端手工结束」；BACKLOG EV-159 并入这一形态（同为「run.json 停在 running 且没有补收入口」）；验收读数里注明 C8 只验新 → 旧 |
| CODEX-04 | codex | nit | 接受 | 核实成立：姊妹行有上界句而本格没有；J1 的硬上界与「只防挂死」的注释不符 | 设计 7.5 `--cancel` 行与 MANUAL 补本格返回上界（宽限 5 s + 确认 ≤5 s + CLI 宽限链 3 s + 若干次 `ps`，单次 `ps` 上限 10 s 另计；验收 C1 实测约 5.4 s，在 Bash 缺省 120 s 之内）；J1 计时上界改为 60 s，耗时记进报告读数 |
| CODEX-05 | codex | nit | 接受 | 核实成立：帮助文本单方面描述、锁路径拼接散在三处 | `cli.ts` USAGE `--cancel` 行补「`--wait` 判心跳失联后：结束仍挂着的工作进程、补收 failed，不动 status.json 与闸门」；`lock.ts` 导出 `lockPathFor(triviumDir, topic)`，`run-protocol.ts` 三处改用它 |
| GLM-01 | glm | minor | 接受 | 核实成立：`ps` 瞬时失败会让活 worker 被判「已不在」，本格随即补收与收锁，破坏 EV-142 前提 | 本格的退出判据改为严格形态 `lostWorkerGone`：进程不存在 ⇒ 已退出；存在且取到的启动时刻与记录不同 ⇒ 已退出（pid 被复用）；存在而启动时刻取不到 ⇒ **未退出**（继续轮询、宽限尽头照常升级）。用作 `isGone` 与 `terminateWorker` 抛错后的复判，零信号早退因而只在确证时发生；共享的 `workerGoneForCancel` 不动（改动面更大，另议）；新增单测 K11（注入「活着而启动时刻取不到」的判定函数 ⇒ 不判已退出）；变异 N19 |
| GLM-02 | glm | nit | 接受 | 核实成立：文档把两格并写成「结束 CLI」，与代码前提不符 | 设计 7.5 与 LLD 4.2 按格分写：`mismatch`（CODEX-02 之后）一个信号都不发；`no_identity` 沿用 EV-154 终态分支自己的判断——worker 确认已不在才按记录结束 CLI，否则不动、请人用 ps 核对 |

## 2. 修改方案（命令 A：应答后直接执行）

1. **代码**：`run-protocol.ts`（`lostWorkerGone` 严格判据与可注入入口；第 2 步三态播报与结论句；`quietWhenEmpty`；`mismatch` 跳过按记录结束 CLI；三处锁路径改用 `lockPathFor`）；`lock.ts`（导出 `lockPathFor`）；`cli.ts`（USAGE）。
2. **用例**：K10（零信号 gone）、K11（`ps` 取不到启动时刻不算退出）；K5 ④ 断言 CLI 组不被结束；J1 计时上界 60 s。
3. **文档**：设计 7.5（`--cancel` 行上界、`mismatch` / `no_identity` 分写、升级窗口）、LLD 4.2、MANUAL、PROTOCOL（`mismatch` 不结束 CLI）、BACKLOG（EV-158 注记、EV-159 并入升级窗口形态）。
4. **读数**：修订后重跑全量（文档改前、改后各一次）、源码变异（按修订后代码重生成规格，新增 N17～N19；原规格与读数留 `.r1`）、失败用例名核对、零配额验收、`doctor --selftest`；写进报告 §7。
5. **不改**：不读 `message` 做任何提示（CODEX-03 那一半，用户决策 2）；共享判据 `workerGoneForCancel` 不改（GLM-01 的更彻底做法，另议）。
