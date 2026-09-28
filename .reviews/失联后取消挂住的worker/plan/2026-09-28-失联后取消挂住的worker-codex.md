---
schema: trivium.review.v1
topic: 失联后取消挂住的worker
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.157.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260928T044009Z
rerun_index: 1
snapshot_hash: sha256:22f1530bd6db325cce58d03905b239103bfc8895a565b64fd771a4fae0356259
blind: true
started_at: 2026-09-28T04:40:11.391Z
finished_at: 2026-09-28T04:51:35.575Z
duration_s: 656
tool_calls:
  run_command: 38
  project_reads: 33
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 1
  minor: 5
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0e650-36c4-7033-8a6f-d1fbf7f07b94
---

# 计划审查：失联后取消挂住的worker

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260928T044009Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

计划整体扎实：现状 W1-W5 / C1-C5 逐条对得上源码（行号与判据我复核过 8 处，全中），覆盖矩阵、fail-safe 方向（读不懂就不发信号）、EV-142 前提的论证、零配额验证路径都成立，回滚面也真的便宜。我这一侧（环境假设 / 成本与配额 / 回滚成本）最该改的一条是 §4.2：新加的 --cancel 出口句把一次**由配置本身必然造成的误判**（heartbeat_stale_s 小于 30 s 心跳间隔）第一次导向破坏性动作，而那句里没有任何可分辨的事实——用户决策 5 的「输出要按事实说」恰好没落到这个时刻。其次是 §5.2 J1 的耗时上界少算了本格自己新增的 ORPHAN_KILL_CONFIRM_MS（§4.4 算的是 13 s，界是 12 s），这是一条会偶发红、只能重跑全量的断言。另有三条较小：no_identity 格有一处现成的第二身份来源未被论证；D1 的备选清单漏了「不加字段也能判格」这条更便宜的路；c″-已死暂缓后 MANUAL 仍在教的手工出口缺归档闭环。定位性小错两处（:1388 归属、U8 编号撞车）。没有 blocker。

**结论**：`approve-with-nits`

## 审查意见（共 7 条：重要 1 ｜ 次要 5 ｜ 吹毛求疵 1）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.2（heartbeat_stale 报错补出口句）与 §7.1 的误判代价论证` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：§4.2 在 `--wait` 判 heartbeat_stale 的报错正文里第一次向操作者推荐 `--cancel`，但那句话只说「确认它卡死后可……」，不带任何可分辨的事实；而在这一格里「没卡死」是有事实可查的、也是配置上必然发生的。于是计划把误判的代价从「什么都不发生」升级成「杀掉一个正在推进、正在烧配额的轮次 + 归档写 failed」，而 §7.1 用来正当化这一代价的前提（「用户敲 --cancel 就是要它停」）在这个时刻并不成立——操作者是第一次从工具的报错里得知「可以取消」。

**依据**：① 心跳间隔是不可配的常量：`src/trivium/run-protocol.ts` :47 `HEARTBEAT_MS = 30_000`；② 阈值没有下界：`skills/dual-critic/schema/config.v2.json` :167-170 `heartbeat_stale_s` 只有 `exclusiveMinimum: 0`（`src/trivium/config.ts` :290 缺省 120），所以阈值 <30 时 `interpretStatus`（`src/trivium/status.ts` :327-371 情形 C）对**完全健康**的 worker 必判 heartbeat_stale——计划自己的 P1 读数就是这一构造；③ 判格所依据的 `heartbeat_at` 由 `writeStatus` 每次写都刷新（`src/trivium/status.ts` :103-107），worker 的每次进展回写都刷它，故「`lost.at` 之后 `heartbeat_at` 有没有再前进」是一个既廉价又强的事实，而计划既不读它也不报它；④ 调用侧确实会把这句话转述出去并据此行动：`skills-src/partials/review/body.md` :143-149 规定每次 `--wait` 返回都要向用户播报、非 0/73 退出码「按原样转述并停止」，转述的就是这句带着 `--cancel` 推荐的报错。计划 §4.4 第 2 步的三句播报里已经有「可能只是心跳慢」，但那是在**已经发完信号之后**，误判已经落地。

**建议**：把可分辨的事实前移到 §4.2 那句推荐里（推荐动作与判断依据在同一屏），并按事实给值而不是给人读形容词：本次判定的心跳年龄、心跳间隔 30 s、当前生效阈值、以及 `heartbeat_at` 是否晚于 `lost.at`。方向即可，具体措辞由 Driver 定；若决定不做，请在 §7.1 里把「操作者是在工具的推荐下第一次得知可取消」这一层写进论证，而不是只论证「主动敲 --cancel」那一面。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §0 范围表 / §7.1 成因清单 / §6 文档同步表` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：「阈值配得比心跳间隔小 ⇒ 每一次运行都必然被判失联」这一最典型的误判成因，计划既没有在事前告警，也没有在范围表里明写不做，只在 §7.1 的成因清单里作为「已接受的代价」出现一次。本主题之前它的后果是人去手工处理（告警不承担误导成本），之后它是自动化的一条出口句，事前拦一句的成本极低而收益覆盖全部后续格。

**依据**：`grep -rn heartbeat_stale src/trivium/preflight.ts src/trivium/config.ts src/trivium/cli.ts` 显示这条配置目前没有任何合法性检查（`src/trivium/config.ts` :282-297 只有缺省值；`skills/dual-critic/schema/config.v2.json` :167-170 只约束 >0），而 `--start` 已经有一条现成的、随开场播报原样念给用户的外部告警通道：`src/trivium/preflight.ts` :63-77 `PreflightWarning` / `warnings` 恒存在，`src/trivium/run-protocol.ts` :13-14 引入 `collectWarnings`，:455 一带随 StartOutcome 返回。加一条 `heartbeat_stale_s * 1000 <= HEARTBEAT_MS` 的 warn 不需要新机制、不动契约面、不花配额。

**建议**：二选一并写进范围表：① 在本主题顺手加这一条预检告警（一条 warn，成本与 D9 同量级）；② 明确列为不做并登记 BACKLOG，在 §7.1 与 §8 里说清「本格把这一误判的后果从无害升级成破坏性，但告警留给另一条」。现在这样既不告警也不登记，属于未决策。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.2 J1 的计时上界 与 §4.4 的最长耗时算式` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：两处自相矛盾：§4.4 算「本格最长耗时 = 宽限 5 + 确认 ≤5 + CLI 宽限链 2 + 1 ≈ 13 s」，§5.2 J1 的断言上界却是 `WORKER_TERM_GRACE_MS + WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 4000` = 12 s，少了 SIGKILL 之后确认那一段（`ORPHAN_KILL_CONFIRM_MS` 本身 5 s > 4 s 富余）。而 J1 恰好走升级 SIGKILL 那一支，是这条链最长的用例。

**依据**：被引用的界公式与既有一致：`test/integration/gate-loop.test.ts` :2656 用的是 `+ 3000` 的同形界，但那条走的是 `--cancel` 主路径——那里 `killWaitMs: 0`（`src/trivium/run-protocol.ts` :1389-1390 及其注释「SIGKILL 之后刻意不等」），界里**本来就不需要**确认项；本格按 §4.4 明确改成 `killWaitMs: ORPHAN_KILL_CONFIRM_MS`（同文件 :64 该常量 = 5000），照抄公式就漏了这一段。另有环境敏感性：宽限与确认每 250 ms 轮询一次、每次轮询都要 spawn `/bin/ps` 且超时上限 10 s（`src/trivium/util/exec.ts` :531-535，:603-619 的 `waitGone` 循环），负载机上 1 s 的净富余不是「宽松」。计划自己也承认既有偶发红（§5.4 的 EV-149 / EV-153），这一条会成为第三个。

**建议**：界式里把 ORPHAN_KILL_CONFIRM_MS 写成显式一项而不是靠 4000 兜，并照 :2661 那条注释把「计时只防挂死」的意图写进 J1（避免实施或变异阶段把它当性能断言加固）；更稳的做法是 J1 只按事实断言（信号序列、`gone` 结论、组成员数、run.json 三格），耗时作为读数记录不设闸。

### CODEX-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.3「不回落 worker.pid」/ §3 的 c″-无身份行 / D1 备选清单` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：`no_identity` 格（status.json 缺 `worker_started_at`）被写成「判不了 ⇒ 不发信号 ⇒ 请用 ps 核对」，计划论证了为什么不回落 `worker.pid`（那里启动时刻为 null，等于「缺失 = 相符」），却没有论证**同一事实的第二份记录**：`--start` 在同一个时刻、同一个变量把 worker 的 pid 与启动时刻同时写进了主题锁文件，而锁文件在这一格里必然存在（这正是「挂住的 worker 仍持锁」那一格）。结果是一类运行永久落在 EV-146 的工具化出路之外，而计划没给出这一残留面的量级。

**依据**：`src/trivium/run-protocol.ts` :432 `workerStartedAt = await processStartTime(spawned.pid)`，紧接 :433-441 把它写进锁内容（`pid: spawned.pid, pid_started_at: workerStartedAt`），:443-447 才写进 status.json；`processStartTime` 在 `ps` 非零退出或 10 s 超时时返回 null（`src/trivium/util/exec.ts` :531-539），而 `status.ts` :59 的字段类型是 `string | null`。锁的判旧也按同一份 `pid_started_at` 比（`src/trivium/lock.ts` :68-89 `judgeStale`）。所以「`worker_started_at` 为 null 但锁里有」是一个可构造的形态，此时 `classifyLostWorker` 判 `no_identity`，而 `run_id` + `pid` + 锁里的启动时刻这三项证据并不比 status.json 的两项弱（同一个来源、同一个时刻、同样的非规范化形态，EV-158 的敏感度也一样）。

**建议**：在 §3 的 c″-无身份行与 §7.5 如实保留清单里补上这一形态的成因（`--start` 那次 `ps` 失败/超时）与量级，并明确论证「为什么不用锁里同批写下的 pid_started_at」——不用是可以的，但要给出理由（例如判据不得跨文件拼装、避免与 run_id 复核互相作证），否则裁决时看不到这条更完整的出路。

### CODEX-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan D1 的备选论证 与 §5.4 C8 / §6 PROTOCOL 行` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：D1 只把「只记一个布尔」列为备选，漏了一条**不加字段也能判格**的等价判据，因而新字段的对外契约成本在计划里没被算出来：`lost` 一旦进 status.json，就同时进了 `--wait --json` / `--status --json` 的对外形状（整份透出）、PROTOCOL、MANUAL、schema 说明文字，还得为它专门造一格新旧双向兼容验收（C8）。

**依据**：`src/trivium/cli.ts` :473-481 的 `--status --json` 里 `status: out.status` 是整份 JSON 透出（`progressFields` :414-426 另加进度字段），`readStatus` 不做键过滤（`src/trivium/status.ts` :109-116 直接 `JSON.parse` 后断言），所以新键必然进对外面。而判格所需的事实今天是齐的：`--wait` 判 heartbeat_stale 时**恰恰不写 run.json**（`src/trivium/run-protocol.ts` :1150-1172，`workerGone` 为假时 `finalizeFailedRunMeta` 第一步即跳过，见 `src/trivium/meta.ts` :657-662 前提 1），worker 自己写 failed 的每一条路（异常分支 :1008 一带、正常收尾 :967-983）与 `pid_gone` 分支都先写 run.json 终态、`settleOrphanedStart` 在归档读不出时刻意不改 phase（:692-701）。「status.json 为 failed + run.json 仍为 running + worker 仍是同一活进程」这三项都是已有结构化事实，组合起来同样只指向这一格。

**建议**：不需要改结论，需要补论证：在 D1 的备选里加这一条并写明不取的理由（我预期是「要跨读归档、`resolveTopic` / schema 判别可能抛错，且记不下失联原因、EV-159 与复盘没有依据」）。同时在 §6 明确 `lost` 是对外 JSON 面的**加法**，按 AGENTS.md 的同步清单把 schema/PROTOCOL/本文件契约面三项一起钉住——现在这三项分散在 §4.5 与 §6，看不出「对外契约新增了一个键」这个级别。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1.4 用例归属行、§1.3 的「（U8 守）」、§5.1 U4` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：三处定位/编号问题会在实施时把人引到错的用例上：① §1.4 把「`--cancel` 已终态的运行：不改写历史」归给 `run-protocol.test.ts` :1388，该文件只有 771 行；② §1.3 的「（U8 守）」指的是既有的 EV-152 U8，而 §5.1 新排的 U8 是同文件另一条用例（「再跑一次」），同一编号两义，恰好落在 §5.3 变异表「失败用例名」的对照面上；③ D6/§4.4 把「未确认退出」的唯一补救押在「再跑一次 --cancel 仍会入本格」，但 §5.1 的 U4 只断言了这一次什么都不动，没有断言第二次调用仍能入格——那是退出码同为 0（D6）时用户唯一的自救路径。

**依据**：`test/integration/run-protocol.test.ts` 实测 771 行（`wc -l`），:1388 不存在；该用例在 `test/integration/gate-loop.test.ts` :1388（`grep -rn '已终态的运行' test/`）。既有 U8 是 `test/integration/run-protocol.test.ts` :697「EV-152 U8：worker 处理器的预算落在取消宽限之内」。第二次调用能入格的前提我核过源码是成立的：§4.4 第 6 步不写 status.json（连 CLI 记录都不清，D7），`lost` 与 `phase: failed` 原样留着，`classifyLostCancel` 只读 status.json 与进程事实，所以判格可重入——但没有任何用例钉住这个不变量，变异表里也没有对应的一条（N10/N13 只覆盖「写了会怎样」）。

**建议**：①②改归属与编号（新用例换不与既有 EV-152 U8 撞号的名字即可）；③给 U4 补一句「紧接着第二次 `--cancel` 仍入本格并再次尝试结束它」的断言，并可考虑补一条变异（判格读的是会被本格改写的事实 ⇒ 第二次不入格 ⇒ 应红），让 D6 的「两种结局都退 0」有机制支撑而不只靠文案。

### CODEX-07 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §8 的 EV-159 暂缓 与 §6 MANUAL 行 / §4.4 第 4 步播报` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：D8 把「`--wait` 判 heartbeat_stale 之后 worker 已不在」暂缓是尊重用户决策 4 的，但计划没有交代它与仍在被 MANUAL 大力宣传的**手工出口**之间的衔接：用户照 MANUAL 手工结束那个挂住的进程之后，再跑 `--cancel` 会落进 `gone` 格（只按记录结束 CLI），run.json 永远停在 running，而本主题的 §4.4 播报第一次把「这一步不会再有第二次机会」这句话念给用户，却没有给这一格任何出路。

**依据**：`doc/07_manuals/MANUAL_user.md` :625-644 一带现在写的仍是「心跳过期而进程一直挂着时，目前只能在终端手工结束那个进程（BACKLOG EV-146）」并逐条列举「请用 ps 核对」的四种残留形态；`src/trivium/run-protocol.ts` :1354-1368 的终态分支在 worker 已不在时确实只结束 CLI、不写归档（EV-154 D3）；`src/trivium/meta.ts` :657-662 的「仍为 running 才写」使 EV-159 候选天然幂等，与 `judgeStale`（`src/trivium/lock.ts` :68-89）对已死 pid 判 `pid_gone` 的口径一致——也就是说这一格的补收**没有新的前提风险**，唯一障碍是 §8 自己列的 EV-158 方向一假阳性（`--wait` 与 `--start` 环境不同 ⇒ 活 worker 被判不在 ⇒ 在它活着时写 run.json）。

**建议**：不必并入实现：在 §8 的 EV-159 里把「它同时是手工结束之后唯一的归档闭环缺口、因此排在 EV-158 之后而不是任意时刻」写清，并在 §6 的 MANUAL 改动里明确手工结束之后归档怎么补（哪怕只是「人工把 run-<id>.json 的 status 改 failed 并同步登记，或等 EV-159」），否则本主题会让用户更容易走进一条明确宣告「没有第二次机会」的死路。

## 认为正确的部分

- W1-W5 / C1-C5 的现状描述我逐条回源码核过，全部成立（`status.ts` :327-371、`run-protocol.ts` :1135-1213 / :1354-1406、`lock.ts` :68-89、`meta.ts` :579-583 / :657-730、`exec.ts` :624-653），行号与判据没有一处编造；「终态分支在 worker 仍是同一活进程时什么都不做」这一 EV-146 死路的因果（锁的 `judgeStale` 只在 run.json 终态时回收 ⇒ 新 `--start` 退 70 ⇒ 报错指向 `--cancel`）与 :495 / :1467 一带的实现一致。
- D1 的 fail-safe 方向（形状坏的 `lost` 当没有、读不懂就不发信号）与既有口径同源：`cliRecordsOf` / `judgeCliGroup` 对 `unverifiable` 与 malformed 一律不发信号（`status.ts` :215-300），`workerConfirmedGone` 对「没有 pid 就是没有证据」的处理（:168-191）也是同一姿态。这条一致性值得保留。
- §4.4 第 4 步的次序论证成立：`finalizeFailedRunMeta` 取的是 `taskLockName(topic)` 那把锁，与 worker 长持的运行锁不同名（`meta.ts` :649-651 的注释），所以「先补收归档、后回收锁」不会自锁、也不会与死掉的 worker 争写；第 5 步按 run_id + pid 复核（D10）比主路径 :1467-1468 的只比 run_id 更严，方向正确。
- D2「不为本格另立规范化锚点、以告警换一致」我认同：同一条 `--cancel` 里两套判据互相矛盾（本格说同一进程、随后 `workerConfirmedGone` 说已不在）确实是最坏的形态，§7.3 两个方向的代价核算是我在这次审查里看到的最扎实的一段。
- 验证的零配额口径是真的零配额，且夹具隔离到位：`test/helpers/proc.ts` 三个助手、`hang_cli` 的 `blockAfterMs`（`adapters/stub.ts` :158-166 / :312 起）、`gate-loop.test.ts` :2567 的 `startWithRecordedClis` 都是现成的；§5.4 把 `run_root` 固定在 mkdtemp、夹具不叠加文件、新旧构建断言 sha256 不同，这几条是防「验收跑脏真实运行根 / 跑陈旧产物」的正确做法。C8 我核过确实成立：`--status --json` 整份透出 status（`cli.ts` :473-481），`readStatus` 不过滤键。
- 回滚面确实便宜，§7.6 的说法我复核成立：`lost` 是加法、旧读者忽略；run.json 没有新取值（D5 沿用 `worker_lost / heartbeat_stale`，与 `WORKER_LOST_REASONS` 和 run.v2 schema 的既有枚举一致，不动 `run-meta-strict` 的 S2/S3）。
- D7（status.json 一个字节都不写，含不清 CLI 记录）与 EV-154 D3 同口径，且顺带让本格的判据可重入（见 CODEX-06 第 3 点），我认为这是这次设计里最划算的一次克制。

## 未覆盖范围（本侧盲区）

- 没有运行任何测试或验收命令（沙箱为只读，`npm run check` 与 §2 的 P1/P2 探针无法复跑），计划里的全部读数（P1 / P2、上一主题 B3 / B6、基线 2188/2186/0/2）我只与 `doc/05_testing/REPORT_2026-09-28_cli_pgroup_record.md` 的记载对了一次，未独立实测。
- 镜头外的两个角度我刻意没展开：并发/时序的正确性证明（两个 `--cancel` 并发、判格与发信号之间的 PID 复用窗口、EV-142 前提的完整论证）与归档契约/Schema 两段式的合规性，交给另一侧与闸门。
- 没有逐条审 §6 文档同步表里主设计 / LLD 的落点是否与 v1.3.53 / v1.1.11 现文一致（只核了 MANUAL 的 :625-644 与 PRD 的 FR 面无关性）。
- 真实厂商 CLI 的 SIGTERM 反应仍未实测（用户决策 6 排除），因此「worker 的处理器在宽限内收拾完 CLI」那一支在真实载体上的耗时余量我没有依据可评。
- EV-157 / EV-158 自身修法、以及 §8 声明不做的「`--wait` 判失联时不写终态」那条路，我只审了交互论证，未审其方案本身。
- 没有读 `.reviews/` 下任何审查件（含本主题另一位审查员的产出），背靠背独立性保持。

## 实际查阅的项目文件

- `src/trivium/status.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/lock.ts`
- `src/trivium/meta.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/preflight.ts`
- `src/trivium/config.ts`
- `src/trivium/cli.ts`
- `src/trivium/adapters/stub.ts`
- `test/integration/run-protocol.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/helpers/proc.ts`
- `skills-src/partials/review/body.md`
- `skills/dual-critic/schema/config.v2.json`
- `doc/07_manuals/MANUAL_user.md`
- `doc/08_project/BACKLOG.md`
- `doc/05_testing/REPORT_2026-09-28_cli_pgroup_record.md`
- `scripts/mutation-check.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":38,"project_reads":33}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
