---
schema: trivium.review.v1
topic: 失联后取消挂住的worker
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.9
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260928T054035Z
rerun_index: 1
snapshot_hash: sha256:d893c13ce33d4b0f2f8e70743765d3b62d47d3c828ae44af27f3431fce2f8022
blind: true
started_at: 2026-09-28T05:40:37.210Z
finished_at: 2026-09-28T05:53:41.036Z
duration_s: 480
tool_calls:
  read: 14
  grep: 4
  glob: 0
  run_command: 0
  project_reads: 7
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_e93ec9fd-3f2a-40c7-b3be-99017d0736af
---

# 代码审查：失联后取消挂住的worker

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260928T054035Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险的一条：cancelLostWorker 把 terminateProcessGroup「进门即 gone」的零信号早退当作已确认退出，无二次复核即补收 run.json 并回收主题锁——该早退既可能真是 worker 判定后自行退出，也可能是 isGone 里 ps 瞬时失败造成的假 gone（processAlive 把「取不到 lstart」并入「不是同一进程」），后者会在 worker 仍活着时写归档、收锁，且播报失实（详见 GLM-01，minor）。其余核心面扎实：判格类型守卫与「不回落 worker.pid 文件」堵住了脆弱判据；补收复用 finalizeFailedRunMeta，run.json 读判写仍在主题任务锁内；status.json 逐字节不写、闸门不动、凭据留给 admitScrub 均被真实 worker 用例端到端钉住；测试矩阵（J1~J3、K2~K9、17/17 变异、9/9 新旧构建验收、三次全量 2198 过 0 红）本人抽查证据属实。GLM-02 是设计/LLD 一句措辞与代码分支前提不符的文档小瑕。建议按意见修两处后合入。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 1 ｜ 吹毛求疵 1）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts:1459-1467（连带 src/trivium/util/exec.ts:645、src/trivium/util/exec.ts:514-520）` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | medium |

**问题**：cancelLostWorker 对 terminateProcessGroup 的返回值直接采信：`const gone = t ? t.gone : …` 之后，gone=true 即进入补收 run.json 与回收主题锁，没有主路径那样的第二次独立复核（主路径在 terminate 之后另有 `workerConfirmedGone` 复判，run-protocol.ts:1624）。而 terminateProcessGroup 的第一个分支（exec.ts:645）是「进门 isGone() 为真 ⇒ 不发任何信号即返回 { gone: true, escalated: false, signals: [] }」。这一格有两个成因：①worker 恰在判格（classifyLostCancel 的 processAlive）与发信号之间的毫秒窗口里自行退出；②workerGoneForCancel 底层的 processAlive 在 ps 瞬时取不到 lstart 时给 sameProcess=false（exec.ts:517-518 把「取不到」与「启动时刻不符」合并成同一结论），于是活着的 worker 被判 gone。成因②会让本格在 worker 仍活着时就补收 run.json、回收主题锁——EV-142 要防的「可能还有写者」前提被破坏（worker 若之后醒来，其收尾会覆盖已写为 failed 的 run.json）；成因①则播报失实：该形态下输出「工作进程在宽限内响应 SIGTERM 退出（（无））——…它的 SIGTERM 处理器已按自己的登记结束审查员 CLI（见 worker.log）」，事实是一个信号都没发、处理器是否跑过未知。项目自己在 EV-154 的代码双审 r1 GLM-01 里已把「ps 瞬时失败当作已不在」认定为缺陷并修过一轮（轮询中只认 gone 与 reused），本格的 isGone 没有同等待遇。窗口是毫秒级、后果有限，故 minor。

**依据**：读 src/trivium/run-protocol.ts（cancelLostWorker 1446-1482 行：t 采信、gone 分流、`signals.join('、') || '（无）'` 的播报；主路径 1624 行的 workerConfirmedGone 复核对照）、src/trivium/util/exec.ts（terminateProcessGroup 645 行的零信号早退；processAlive 514-520 行 sameProcess 对 startedAt=null 的取值）、src/trivium/status.ts:183-206（workerConfirmedGone 同样以 processAlive 为源）。K3/K4 断言的都是「发了信号」的形态（SIGTERM 或 SIGTERM、SIGKILL），零信号 gone 变体无用例；实施报告 §3.2 也如实承认毫秒级窗口造不出来。

**建议**：方向：对 `gone && t && !t.escalated && t.signals.length === 0` 的形态单独处理——播报改说「未及发信号，工作进程已不在（可能是它自己退出）」，并在进入补收与收锁之前按主路径模式补一次独立复核（同源 workerConfirmedGone，两次调用在时间上分离即可挡住瞬时 ps 失败），复核不过则按「未能确认退出」那一支收场。更彻底的做法是让 workerGoneForCancel 三态区分「ps 取不到」与「启动时刻不符」，前者不算 gone；那是共享判据，改动面更大，可另议。不需要补丁，落在措辞分句与复核次序上即可。

### GLM-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 7.5「失联后取消挂住的工作进程」段、doc/02_design/LLD_orchestrator.md 4.2「cancelRun 结束失联后仍挂着的 worker」块（两处均为本 diff 新增段；行为面见 src/trivium/run-protocol.ts:1554-1575、src/trivium/util/exec.ts:515）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：两份设计文档的新段落都写「身份判不上（mismatch）…或身份缺失 / 形状不对（no_identity）时不发信号，仍走 EV-154 的终态分支结束 CLI」。但 EV-154 终态分支结束 CLI 的前提是 `workerConfirmedGone(s, pidFromFile).gone`（run-protocol.ts:1555）：no_identity 的常见成因正是 `--start` 取启动时刻的 ps 失败（worker_started_at 为 null）而 worker 活着——此时 processAlive(pid, null) 按缺省走 `sameProcess: true`（exec.ts:515），workerConfirmedGone 判「仍在」⇒ CLI 一个也不会被结束，只剩「请用 ps 核对」的告警。mismatch 那一格倒是真会结束 CLI（启动时刻不符 ⇒ 判「已不存在」），代码内注释（run-protocol.ts:1550-1553）也只对 mismatch 说「这里照旧结束 CLI」。行为本身 fail-safe 且合理，但文档把两格并写成「结束 CLI」，后来的人（或照文档写运维手册的人）会以为 no_identity+活 worker 时 CLI 会被工具收拾，实际它们还在烧配额。MANUAL_user 的措辞反而准确（只承诺「不发信号，请用 ps 核对」）。

**依据**：读被审 diff 中设计 7.5 新段与 LLD 4.2 新块的原句；对照工作树 src/trivium/run-protocol.ts:1554-1575（workerConfirmedGone 门控与 mismatch/no_identity 的输出分流）、src/trivium/status.ts:191-195（pid 回落与 processAlive 判「仍在」）、src/trivium/util/exec.ts:515（expectedStartedAt 为 null 时 sameProcess 恒真）。K5 只断言 no_identity「不对 worker 发信号、什么都不写」，没有断言 CLI 是否被结束，测试面对这条文档措辞是沉默的。

**建议**：改两处文档措辞：把「仍走 EV-154 的终态分支结束 CLI」按代码事实分格——mismatch：按记录结束 CLI（workerConfirmedGone 判「已不存在」）；no_identity：仅当 worker 确认已不在时才结束 CLI，worker 仍活着时不动 CLI、请人用 ps 核对。顺带可在 LLD 那句后补一句「该分支以 workerConfirmedGone 为前提」，与代码注释的谨慎口径对齐。

## 认为正确的部分

- classifyLostCancel 的判据设计正确：只取结构化字段不读 message；pid 须为 >1 的整数、启动时刻须为非空字符串的类型守卫堵住了「缺失 = 相符」（processAlive 对假值启动时刻给 sameProcess:true）与 pid=1 的组信号风险；不回落 worker.pid 文件、不取锁里的同源值，避免把同一份证据当两份（run-protocol.ts:1391-1406）。
- lostOf 的形状校验方向正确：reason 须在 WORKER_LOST_REASONS、at 须为非空字符串，读不懂当没有，fail-safe 方向是「不杀」，与 cliRecordsOf 对形状坏记录不发信号同口径（status.ts:679-686，K1 逐形状覆盖）。
- 补收复用 finalizeFailedRunMeta：run.json 的读→判→写仍在主题任务锁（withTopicLock）内，「每份 run.json 至多一次终态写入、--cancel 与 --wait 同时收尾谁先到记谁」的不变量自然延伸到新写者；task.json 第二步独立于第一步、可重入（meta.ts:635-733）。
- 本格「不做」的三件事都被钉住：status.json 逐字节不写（J1/K3 前后全文比对）、闸门不动（--wait 判失联时已回收，J1/K3 比对）、凭据副本不抹且会话启动清扫在 worker 与 CLI 都结束后确实放行（J3 用 hook-session-start 端到端验证）。
- 锁回收按 run_id + pid 双复核，锁已被新一轮接管或改写时不动并如实说明（K6 两格）；补收只改 status/finished_at/gate.state/termination、artifacts[] 原样（K3 deepEqual）；run.json 已是终态不追溯改写（K7）。
- 未确认退出的一支处置得当：run.json、登记、锁逐字节不动、退出码仍 0、可重入再跑（K4 两次调用都入格），并如实把「手工结束后再跑 --cancel 不会补收」指向 EV-159。
- --wait 的 heartbeat_stale 报错先列判定依据（心跳年龄、生效阈值、30 s 心跳间隔），阈值不大于间隔时当场点明「健康的工作进程也会被判失联」，且只在 heartbeat_stale 且未确认退出时给 --cancel 出口、pid_gone 不给（K2 三格）。
- 测试面扎实：J1（堵住、升级 SIGKILL）/J2（只是慢、宽限内退出）用真实 worker 走两支，K2～K9 覆盖判格矩阵含四种坏形状（K5-5a~d）、归档写失败时本格自己的「没有第二次机会」半句（K9）；17/17 源码变异全灭、失败用例名逐一核对过目标断言；9/9 新旧构建零配额验收含 C8 回滚方向；三次全量 2200/2198/0/2（check-2.txt 尾部本人亲自复核）。
- 文档同步完整且口径一致：PRD v1.4.16、主设计 v1.3.54、LLD v1.1.12、PROTOCOL、MANUAL v1.0.12、BACKLOG（EV-146 结案 + EV-159/EV-160 另登）、run.v2 schema 与 types.ts/meta.ts 文档块；schema 只改说明文字、未新增身份枚举，符合机读契约纪律。

## 未覆盖范围（本侧盲区）

- 未独立重跑构建、全量测试与零配额验收（本审查只读）；全量读数采信 check-2.txt 尾部（2200/2198/0/2、exit=0，已亲核）与实施报告，未逐行复核 check-1/check-3、acceptance.mjs 九格的断言逻辑与 gen-mutation-spec.mjs 的锚点唯一性核对。
- 真实厂商 CLI 对 SIGTERM/SIGKILL 的处置未实测（沿项目不烧配额惯例，本主题全部行为结论基于 stub 形态，报告也如实注明）。
- EV-158（worker_started_at 对 TZ / 区域设置敏感）只按代码与文档论证；未实测切换 TZ/LC_ALL 下 classifyLostCancel 与 workerConfirmedGone 的实际表现，K5-4 以假启动时刻模拟 mismatch。
- --wait --json / --status --json 透出 lost 键的对外 JSON 形状只核了 K2 的 status.json 落盘与 PROTOCOL 的加法说明，未逐字段验证运行时 JSON 输出。
- GLM-01 所指的毫秒级窗口形态（零信号早退、ps 瞬时失败）无法在审查中复现验证，结论基于代码路径推演，故置信度标 medium。

## 实际查阅的项目文件

- `.reviews/失联后取消挂住的worker/code/_meta/changes-20260928T054035Z.diff`
- `src/trivium/run-protocol.ts`
- `src/trivium/status.ts`
- `src/trivium/meta.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/cli.ts`
- `doc/05_testing/evidence/lost-worker-cancel-20260928/check-2.txt`

> 编排器从工具轨迹中记录到的读取次数：{"read":14,"grep":4,"glob":0,"run_command":0,"project_reads":7}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
