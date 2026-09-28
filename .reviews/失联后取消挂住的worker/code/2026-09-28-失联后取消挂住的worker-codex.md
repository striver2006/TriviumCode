---
schema: trivium.review.v1
topic: 失联后取消挂住的worker
stage: code
role: codex
vendor: openai
agent_cli: codex/0.157.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260928T054035Z
rerun_index: 1
snapshot_hash: sha256:d893c13ce33d4b0f2f8e70743765d3b62d47d3c828ae44af27f3431fce2f8022
blind: true
started_at: 2026-09-28T05:40:37.210Z
finished_at: 2026-09-28T05:53:41.036Z
duration_s: 784
tool_calls:
  run_command: 44
  project_reads: 24
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0e687-8a0a-7791-97b4-e5fef66173be
---

# 代码审查：失联后取消挂住的worker

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260928T054035Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

整体成立：判格只用结构化事实、fail-safe 方向一致（lostOf 读不懂当没有、pid>1 与启动时刻非空的类型守卫、不回落 worker.pid 文件）、status.json 逐字节不动与「不追溯改写」的不变量守得住，K1～K9＋J1～J3＋C8 交叉版本把主线钉住了。按我的镜头（环境与生命周期）有三条要处理：①`cancelLostWorker` 把三种事实合成一条播报，其中「一个信号都没发就发现进程已不在」那一支会说成「在宽限内响应 SIGTERM 退出／它的处理器已收拾好 CLI」，同时把「没有在跑的 CLI 记录」的告警静音——恰是 CLI 可能成孤儿烧配额那一格；②本格对 worker 用非规范化 `ps lstart` 锚点、对它名下的 CLI 用 `LC_ALL=C/TZ=UTC0` 锚点，同一格内两个方向相反，而 EV-146 第一次把 `--cancel` 变成向用户推荐的主动动作，环境错配时这个推荐会杀掉还活着的 worker 的 CLI；③`lost` 只在 `--wait` 判失联那一次写入、`interpretStatus` 情形 B 对终态短路不回填，旧版已判失联的挂住运行装上新版后仍无入口，这一格在设计「如实保留」与 MANUAL 分句里都没有。另有耗时上界未写入文档、J1 的硬计时断言、USAGE 与锁路径拼接散点三条小项。

**结论**：`approve-with-nits`

## 审查意见（共 5 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 2）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts:1461-1466（配合 1436 与 1477）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：`cancelLostWorker` 第 2 步的播报按 `gone && !t.escalated` 二分，但 `terminateProcessGroup` 有三个结局落在这同一支里：①发了 SIGTERM 并在宽限内退出；②**首检 `isGone()` 即为真、一个信号都没发**就返回 `{gone:true, escalated:false, signals:[]}`（判格与发信号之间 worker 自己死了／被外部结束）；③注入桩抛错后复判。第②支实际输出是「工作进程在宽限内响应 SIGTERM 退出（（无））——它的事件循环没有被堵住，失联判定可能只是心跳慢；它的 SIGTERM 处理器已按自己的登记结束审查员 CLI（见 worker.log）」，三句都不成立（没发过信号、不是慢、处理器没跑），结尾 `say` 还说「已结束仍挂着的工作进程 N」。更要紧的是第 3 步 `reportRecordedCliGroups(..., !(t?.escalated ?? false), ...)` 把 `quietWhenEmpty` 置真，于是「status.json 里没有在跑的审查员 CLI 记录」这条告警在这一格被静音——而 worker 被外部 SIGKILL 正是 CLI 成孤儿、配额照烧的那一格（EV-152/EV-154 的原始动因）。

**依据**：读 src/trivium/util/exec.ts:624-653（第 645 行 `if (await o.isGone()) return { gone: true, escalated: false, signals }` 的早退返回空 signals）；读 src/trivium/run-protocol.ts:727-729（`workerGoneForCancel` = 不存活或不是同一进程，故 worker 已死或 PID 被复用时首检即真）、1441-1482（第 2/3 步与 `sent = t?.signals.join('、') || '（无）'`）、806-818（`quietWhenEmpty` 的语义就是「无记录时不出声」）；读 run-protocol.ts:1391-1405 确认 `classifyLostCancel` 在发信号之前刚判过 alive，两者之间就是这段窗口。报告 §3.2 只登记了「pid 被复用」与「补收前被中断」两格没有用例，未登记这一支的播报；K/J 用例走的都是真发了 SIGTERM 的路径（test/integration/run-protocol.test.ts 的 K3、gate-loop.test.ts 的 J1/J2 断言 `工作进程在宽限内响应 SIGTERM 退出（SIGTERM）`）。

**建议**：第 2 步按 `t.signals.length` 与 `t.escalated` 分三态播报，把「本次取消之前它已不在／已不是同一进程（未发任何信号）」单列一句，措辞不出现「响应 SIGTERM」「处理器已收拾 CLI」「仍挂着」；该态的 `quietWhenEmpty` 与升级态取同值（false），让无记录时仍出「请用 ps 核对 CLI」那句。补一条用例：注入 `terminateWorker` 返回 `{gone:true, escalated:false, signals:[]}`，断言既不出现「响应 SIGTERM」也不出现「已按自己的登记结束」，并断言无记录时告警仍在。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts:1391-1405（classifyLostCancel）与 1545-1575（终态分支）` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | medium |

**问题**：同一个 `--cancel` 进程里两套身份锚点方向相反：判格用 `processAlive(worker_pid, worker_started_at)`，而 `worker_started_at` 由 `--start` 按**缺省环境**取（`ps -o lstart=` 随 TZ／区域设置变）；结束 CLI 用的 `sides[c].cli.started_at` 是 `canonical` 形态（`LC_ALL=C`、`TZ=UTC0`）。环境错配时判格落 `mismatch`（不发信号，正确），但紧接的 EV-154 分支里 `workerConfirmedGone` 同样按 `!sameProcess` 判「已不存在」为真，于是**照样按记录结束一个还活着的 worker 名下的 CLI**——worker 随后看到 CLI 退出可能重试、再烧一轮配额，而归档 run.json 与主题锁都没动。EV-146 之前这条路是被动无作为，现在 `--wait` 的报错第一次把 `--cancel` 作为出口向用户推荐，这条错配路径从「不发生作用」变成「有破坏性的推荐动作」，而 EV-158 仍排在 BACKLOG todo。

**依据**：读 src/trivium/run-protocol.ts:436（`workerStartedAt = await processStartTime(spawned.pid)`，无 `{canonical:true}`）与 status.ts:184-196（`workerConfirmedGone` 对 alive&&!sameProcess 返回 `gone:true, why:'工作进程 N 已不存在'`）；读 util/exec.ts:500-539（`processStartTime` 的 `canonical` 只在 CLI 记录一侧用，注释明写「worker 这一面没改」）；读 run-protocol.ts:1552-1575 确认 mismatch 格的执行顺序是先按记录结束 CLI、再打告警与结论。LLD v1.1.12 的已知缺口表 EV-158 行与 BACKLOG EV-158 注记都登记了这个后果（GLM-02），即 Driver 是知情的——本条不是漏，而是风险面因 EV-146 的推荐动线被抬高了。

**建议**：二选一即可，不必两条都做：①把 EV-158 的规范化提到本格前置——判格的存活比对两种形态都试（旧记录缺省形态＋规范化形态），命中任一即算同一进程，这样 `mismatch` 只剩真的 PID 复用；②在 `cell.kind === 'mismatch'` 时不进入按记录结束 CLI 的分支（把「环境可疑」当作「worker 可能还活着」的一致结论），输出里说明「因身份判不上，本轮也未结束它名下的 CLI」，让人先核对环境。若都暂缓，请在设计 7.5「失联后取消挂住的工作进程」段的「如实保留」里把「本推荐动线在环境错配下会杀掉活着 worker 的 CLI」这一句从 LLD 缺口表提到正文，让下一个读 MANUAL 的人看见。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/status.ts:379（interpretStatus 情形 B 终态短路）＋ run-protocol.ts:1180-1182（唯一写者）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：升级／混装窗口那一格没有入口：`lost` 只在 `--wait` 判失联那一次 `patchStatus` 里写；一旦 status.json 已是 `failed`，之后再跑 `--wait` 走情形 B 直接返回终态、**不会回填 `lost`**，`classifyLostCancel` 恒判 `none`，新 `--cancel` 仍只说「已处于终态（failed），无需取消」。也就是说，最需要这条新出口的正是「装新版之前已经被旧版判失联、worker 还挂着」的运行（EV-146 立项时描述的那个现场），而它们在新版下依然是死路——只能手工 kill，之后 run.json 停在 running（EV-159 的形态）。C8 只验了新→旧（旧版读不懂 `lost` 不报错），没验旧→新。

**依据**：读 src/trivium/status.ts:357-400（情形 B `if (isTerminal(raw.phase)) return { kind: 'terminal', status: raw }` 在失联判定之前）；grep 全仓 `lost` 的写者只有 run-protocol.ts:1182 一处；读被审 diff 的 status.ts 文档块（自述「缺席（旧版 --wait 写的…）与 null 读者一律当没有」，只说明行为、未说明这一格无入口）；读 doc/05_testing/REPORT_2026-09-28_lost_worker_cancel.md §5.4 表头 C1～C8 与 acceptance.mjs 头部注释（C8 只有「新 → 旧」方向）；读被审 diff 的 MANUAL v1.0.12 一段——它按失联原因分两种结局，未按「status.json 由哪一版写的」分，用户照手册跑会撞上「无需取消」而无解释。

**建议**：不必改判据（用户决策 2「只取结构化事实」我认同，不该为兼容去读 `message`）。建议做最便宜的一半：`classifyLostCancel` 判 `none` 且 status.json 是 `failed` 时，若 `message` 以 `worker_lost（heartbeat_stale` 开头（**只作提示、不作发信号依据**），把结论句改成「该失联判定由更早版本写入、没有结构化的 `lost`，本次不会结束工作进程——请在终端核对」，而不是现在的「无需取消」；同时在设计该段的「如实保留」清单与 MANUAL 对应段落各补一句升级窗口的说法，并登 BACKLOG（可与 EV-159 并条：两者都是「run.json 停在 running 且没有补收入口」）。

### CODEX-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 7.5 `review --cancel` 行 ＋ test/integration/gate-loop.test.ts J1 的 `assert.ok(ms < bound)`` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：两件事凑在一起：①本格把 `--cancel` 从「SIGKILL 后刻意不等」变成「宽限 5 s ＋ SIGKILL 后再等至多 5 s ＋按记录并行结束 CLI（2 s＋1 s）」，而 7.5 的 `--cancel` 行、PROTOCOL 与 MANUAL 都没写这条路径的返回上界——对照 `--start` 那一行专门写了「约 20 s …仍在 Bash 缺省 120 s 工具超时之内」，同一主题的姊妹改动缺同一句；②`processStartTime` 的单次 `ps` 超时是 10 s，`terminateProcessGroup` 的 `waitGone` 每 250 ms 轮询一次且每轮 `await isGone()`，`ps` 慢时上界不再是常量之和。J1 用 `WORKER_TERM_GRACE_MS + ORPHAN_KILL_CONFIRM_MS + WORKER_TREE_GRACE_MS + WORKER_TREE_KILL_WAIT_MS + 3000` 做**硬断言**，实测 11.7 s 对 16 s，余量只有 4.3 s，而注释自己说「计时只防挂死…超界先存读数、别当实现回归」——意图与断言形态不符，将来满载跑全量会多出 EV-149／EV-153 一类的偶发红。

**依据**：读 run-protocol.ts:56-62（`ORPHAN_KILL_CONFIRM_MS` 文档块，本次改为两个使用方）与 1448-1455（宽限链参数）；读 util/exec.ts:531-539（`ps` 的 `timeoutMs: 10_000`）、624-653（`waitGone` 轮询里每轮都 `await o.isGone()`，没有并发或时长上限）；读 gate-loop.test.ts 新增的 J1（bound 表达式与注释）；读被审 diff 的设计 7.5 `--start` 行与 `--cancel` 行——前者有上界句、后者只写信号序列；读被审 diff 的 PROTOCOL `review --start/--wait/--status/--cancel` 行同样只写「宽限 5 s → SIGKILL → 至多再等 5 s 确认」，无返回上界与工具超时提示。

**建议**：①在 7.5 的 `--cancel` 行补一句与 `--start` 同形的返回上界（用常量之和给出，并注明 `ps` 慢时按单次 `ps` 超时另计），MANUAL 的对应段落顺带提一句「这条命令可能要等十几秒」，免得短窗口载体把它当无输出挂住；②J1 的计时断言改成「防挂死」本意的形态：阈值取远大于常量之和（例如 60 s）或直接只把耗时记进读数不断言，主判据仍用已有的信号序列／组成员数／run.json 三格。

### CODEX-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/cli.ts:241-242（USAGE）与 src/trivium/run-protocol.ts:1502（锁路径）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：两处小面：①USAGE 的 `--cancel` 行仍写「取消运行、回收主题锁与闸门；工作进程确认退出后，把仍为 running 的归档 run.json 标为 cancelled」——本格既不回收闸门也不标 cancelled，PROTOCOL／设计／LLD 都同步了，`--help` 这一面没跟上，读帮助的人会对「`--cancel` 一定回收闸门」形成预期；②`run-protocol.ts:1502` 又手写了 `path.join(ctx.triviumDir, 'lock', `${s.topic}.lock`)`，同一拼写在 1041／1680 已有两处，而 lock.ts 的 `lockDir`／`lockPath` 是模块私有的——「主题名可直接做文件名」这条前提写在 lock.ts 的注释里，散到第三个模块后一改锁名规则就得同时找齐。

**依据**：读 src/trivium/cli.ts:230-245 的 USAGE 全文（`--cancel` 行未随本主题变化，且被审 diff 未包含 cli.ts）；读 src/trivium/lock.ts:42-45（`lockDir`／`lockPath` 均未导出，注释「主题名允许中文与 `.`，但不允许路径分隔符（topic 校验已保证）」）；grep 全仓 `lock`, `` `${...}.lock` `` 命中 run-protocol.ts:1041／1502／1680 三处同款拼接；读被审 diff 的 PROTOCOL 行确认对外契约面已写明「闸门不动、status.json 不写」。

**建议**：①USAGE 的 `--cancel` 行按「两种来路」各给半句（正常取消：标 cancelled、回收锁与闸门；`--wait` 判心跳失联后取消：结束工作进程、补收 failed、不动 status.json 与闸门），或与既有做法对齐——只写「见 trivium review --help 之外的 PROTOCOL 7.5」并删掉细节，别让帮助文本单方面描述；②从 lock.ts 导出 `lockPathFor(triviumDir, topic)`，run-protocol 三处改用它，把锁名规则收回单一来源（与纪律 10 的「差异唯一登记处」同一取向）。

## 认为正确的部分

- 判格只取 status.json 的结构化字段与进程事实、不读 `message`（用户决策 2）在代码里落实得干净：`lostOf` 的 `WORKER_LOST_REASONS` 复用 status.ts:324 那份唯一来源，没有新开枚举；K5 的①（没有 `lost` 而 `message` 恰好是失联文案 ⇒ 不入本格）把「不读文案」钉成了可回归的判据。
- 类型守卫的三处都到位且理由正确：`worker_pid` 必须是 > 1 的整数（避开 init／launchd 与字符串形态）、`worker_started_at` 必须是 trim 后非空的字符串（`processAlive` 对假值 `expectedStartedAt` 返回 `sameProcess: true`，空串否则会被读成「有身份且相符」）；不回落 `worker.pid` 文件也不取锁里的 `pid_started_at` 的论证成立——那两处与 status.json 同源同一次 `ps`，不构成第二份证据。
- 「一个字节都不写 status.json」的不变量守得很好，也让判格可重入：K3/K4 用逐字节比对钉住，N13 变异咬住；CLI 记录不清而留给 `admitScrub` 的取舍与 EV-157 的范围一致。
- `termination` 沿用 `worker_lost` / `heartbeat_stale`、不新增 schema 取值，符合 6.7.1 的「只增不减」与回滚面纪律；run.v2.json 只改两处 description，`run-meta-strict` S2/S3 照绿，无需保留额外取值面。
- `finalizeFailedRunMeta` 的 `workerGone: true` 依据是「按 pid + 启动时刻观察到的退出」而非推断，与 EV-150 的口径同源；未确认退出时整段跳过（run.json／登记／锁都不动）方向正确——它没有把 EV-142 的「两写者」防线改成乐观写入。
- 回收锁要求 `run_id` 与 `pid` 双双相符再 `reclaimStaleLock`，比主路径只比 `run_id` 更严，正合「本格可能发生在 `--start` 之后很久」的处境；K6 两格（同 run_id 不同 pid／不同 run_id）钉住了不动。
- 报告 §3.1／§3.2／§3.3 的偏离与未钉格写得诚实（N9/N10 拆不开、判定后又写过 status.json 的 warn 无用例、Hook 误拦未绕），变异 17/17 的失败用例名逐一核对到目标断言，这一面的证据质量高于「跑绿」本身。

## 未覆盖范围（本侧盲区）

- 没有跑 `npm run check`／`npm test`（只读审查，且沙箱禁写），三次全量读数 2200/2198/0/2 与变异 17/17、验收 9/9 全部按报告与 evidence 读数采信，未复算。
- 真实厂商 CLI（agy／zcode／codex／claude）在失联格里的行为未验：全部结论建立在 `TRIVIUM_STUB_CRITIC` 桩与 `hang_cli`／`blockAfterMs` 形态上；真实 CLI 对 SIGTERM 的处置沿用上一主题「未实测、不花配额」的口径。
- 四家载体的护栏差异（L1/L2）与 `--cancel` 在 Codex／ZCode 短工具窗口下的实际表现未审，只按「缺省 Bash 120 s」论证，CODEX-04 因此只提文档面。
- `--wait` 判失联与会话启动清扫／`trivium scrub` 的凭据准入叠加面（EV-157）未审，本主题声明范围不动；`pruneRunDirs` 到期整删与 `run_dir_days` 在同现场的交互也没看。
- 闸门（gate.ts）、Hook、`report` 时间线在本格下的读后表现未审——只确认了「闸门不动」这一事实与 K3 的 gateBefore 比对，未看 `report` 如何呈现这条 failed（设计上明说归档看不出是谁结束的，属用户决策 5 的取舍，我没有再翻一次）。
- `skills-src/` 与入口 SKILL.md 的渲染面只做了反查（grep 无「失联／worker_lost／cancel 的失联语义」），未逐条读四家产物确认没有需要改措辞的地方。
- Windows/Linux 未考虑（项目仅 macOS）；`ps -o lstart=` 在非 macOS 的形态只在 exec.ts 注释层面读过，未展开论证。

## 实际查阅的项目文件

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/LLD_orchestrator.md`
- `src/trivium/run-protocol.ts`
- `src/trivium/status.ts`
- `src/trivium/meta.ts`
- `src/trivium/lock.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/cli.ts`
- `test/integration/run-protocol.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/unit/status.test.ts`
- `doc/05_testing/REPORT_2026-09-28_lost_worker_cancel.md`
- `doc/05_testing/evidence/lost-worker-cancel-20260928/acceptance.mjs`
- `doc/05_testing/evidence/lost-worker-cancel-20260928/probe-lost-50cb380.json`
- `.reviews/失联后取消挂住的worker/code/_meta/changes-20260928T054035Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":44,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
