---
schema: trivium.review.v1
topic: worker启动时刻规范化
stage: code
role: codex
vendor: openai
agent_cli: codex/0.157.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260928T120630Z
rerun_index: 1
snapshot_hash: sha256:bdfa668b28e2d7dd9cae2da741ab9fa7d0250eb82e13782ab7a14e0b4092e8b0
blind: true
started_at: 2026-09-28T12:06:32.720Z
finished_at: 2026-09-28T12:15:52.915Z
duration_s: 560
tool_calls:
  run_command: 28
  project_reads: 14
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0e7e8-dd5d-7140-81dd-7097e287b000
---

# 代码审查：worker启动时刻规范化

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260928T120630Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

EV-158 的落地质量高：写者三处、读者八个消费方经 grep 全量核对确都收成 processMatchesRecord 一条读法，workerLockContent 的四键显式覆盖挡住了「worker 的 pid + --start 的规范化时刻」这一真实污染形态；退回分支逐字保持 v1.3.54 行为，升级窗口/回滚两格有 A2～A7 实测与 23 条锚点唯一的变异钉住，文档（主设计 v1.3.55 / LLD / PROTOCOL / MANUAL / BACKLOG）与代码一致。三条意见都不改判据方向、都是防未来误用的机制化建议：interpretStatus 情形 A 的 fallbackPidStartedAt 死参数与 hooks 扫描里被丢弃的启动时刻实参，各自留下一处「靠记性维持」的旧形态比较入口；本次改动恰好经过的两处锁改写仍是非原子 writeFile（非回归），是换 writeAtomic 的自然时机。均不阻塞合入。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 2 ｜ 吹毛求疵 1）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/status.ts:370-395（interpretStatus 情形 A 与 fallbackPidStartedAt 入参）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：EV-158 之后，情形 A（status.json 读不到）仍是 src 里唯一一处把「启动时刻字符串」直接交给 processAlive 按读者缺省环境比对的调用点，绕过「只有一個讀法 processMatchesRecord」这条本补丁自己立的契约。它今天无害——生产代码从不传该参数（waitRun 只传 fallbackPid，grep 全仓确认），但「没人传」是靠记性维持的事实：未来若有调用者把锁的 pid_started_at（缺省环境形态）传进来，异环境的 --wait 会在 status.json 尚未落盘时判 worker_lost/pid_gone 并把 run.json 写成 failed、抹凭据——正是 EV-158 的最坏方向在九号消费方身上复活。计划 r2 §4.4 明确写了「情形 A 不改」，本条不质疑该决策本身，建议的是把决策机制化：删掉这个恒为 undefined 的入参（等价于今天的 processAlive(pid, null)，行为逐字不变），或把「生产不传、传入必为规范化形态」写成类型/注释上的硬约束。

**依据**：读了 src/trivium/status.ts:362-415（情形 A 用 processAlive(pid, opts.fallbackPidStartedAt ?? null)，情形 C 已改 processMatchesRecord）；grep -rn fallbackPidStartedAt src/ 只命中 status.ts 自身，run-protocol.ts:1144-1146 的 interpretStatus 调用只传 fallbackPid；对照 .reviews/worker启动时刻规范化/plan/…-r2-claude.md :163/:179「情形 A 不变」「生产不传，不改」。

**建议**：优先直接删参数（当前等价 null、无行为变化、无调用方受影响）；若要保留扩展位，则在参数文档里写明「只接受规范化形态或 null，禁止传缺省环境取到的 lstart」。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts:441-449（startRun 改写锁）与 :651-661（settleOrphanedStart 改写锁）` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | medium |

**问题**：两处锁文件的改写仍是非原子的 fs.writeFile(path, JSON.stringify(workerLockContent(...)))：并发读者（另一个 --start 的 inspectLock/judgeStale）可能读到截断 JSON，judgeStale 判 unparsable 即视为遗留锁并被 reclaimStaleLock 回收，而此刻改写者（--start/worker）活着——同主题两运行并发的窗口。这是非回归：旧代码同样形态，补丁只是把序列化收成 workerLockContent、并给内容加了新键，窗口宽度不因本变更改变。提出它是因为这两行正被本补丁触碰，且仓库里现成有 writeAtomic（status.ts 的 patchStatus 就用它，rename 语义）——改它不需要动 judgeStale 的 unparsable 判据（该判据对「永久锁死」的 fail-open 仍然保留）。窗口亚毫秒、需要第二条 --start 恰好落在改写瞬间，实际触发概率很低。

**依据**：读了 src/trivium/run-protocol.ts:431-457 与 :648-665（两处 fs.writeFile(lock.path, JSON.stringify(workerLockContent…)) 原样保留旧写法）、src/trivium/lock.ts:113-127（judgeStale 对 unparsable 直接判遗留）、src/trivium/status.ts:19 与 patchStatus（writeAtomic 已在同仓库使用）；diff 中这两处的基线行（git show 形态的 -/+ 行）确认改写方式非本次引入。

**建议**：两处锁改写换用 util/fsx 的 writeAtomic；或在 lock.ts 文档块写明「锁改写非原子、unparsable 窗口已知且接受」，把该事实从「读代码才能发现」变成登记过的设计约束。

### CODEX-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:1748（sweepDeadRunningGates 的 processAlive 调用）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：本补丁把该函数的文档块更正为「判据只看存活，启动时刻不参与判定」，但调用行仍传 st.worker_started_at ?? null——值会被 processAlive 取 ps、比对、然后整体丢弃（只取 .alive）。注释与实参互相矛盾：后来者很容易「顺手修」成 && live.sameProcess，而这一改会引入两个新错——旧形态记录在异环境下把活 worker 判成已死而回收闸门（撤护栏），或换成 processMatchesRecord 后规范化 ps 取不到时同样误回收。计划 r2 §4.5 权衡过「改传 null 省不掉那次 ps」而选择只改注释，成本论断成立（exec.ts 的 processAlive 对活进程先取启动时刻再看期望值）；本条只针对残留的误导性实参。

**依据**：读了 src/trivium/hooks.ts:1715-1760（新注释与 :1748 调用行）、src/trivium/util/exec.ts:504-527（processAlive 在 alive 分支无条件 await processStartTime，再按 expectedStartedAt 决定是否比对）；计划 r2 §4.5 对该处「只改注释」的说明（.reviews/…/-r2-claude.md :177）。

**建议**：把实参改为 null，或抽一个只看 kill(pid,0)/EPERM 的 isPidAlive 小助手供这一处与 run-protocol.ts:1180 同用，让「只看存活」在代码形态上自明。

## 认为正确的部分

- workerLockContent 四键显式覆盖（run_id/pid/两种启动时刻）是对真实污染形态的正确拦截：漏覆盖时锁会成为「worker 的 pid + --start 的规范化时刻」，judgeStale 按规范化比即误判 pid_reused、活 worker 的锁被下一轮回收——D4 的论证与实现一致，且被 M2/M17/M22 与 I1/U4② 双向钉住。
- 「有规范化只比它、没有逐字退回 processAlive(legacy)」的读法收成一个函数，八个消费方经 grep 全量核对确无遗漏；其余三处 processAlive 直调（hooks 扫闸、waitRun 补收、情形 A）都只做存活判断，与设计中「不受影响」的声明相符。
- selfCanonicalStartTime 只缓存非 null、缺省形态不缓存——正确：规范化形态与环境无关而缺省形态随 process.env 变，缓存缺省形态才会改语义。
- canonical 分支「活着而取不到启动时刻 ⇒ sameProcess:false」保持今天口径，方向在发信号侧保守（不发）、在判定侧与 v1.3.54 等价；U10 专门钉了这一格与「取值抛错不 reject」。
- D6 的 mismatch 告警按 basis 分写、legacy 句逐字保留 + 句末补成因，既有 K5④ 不改动仍绿（报告 §3.1 的退让方式干净）；lostWorkerGone 严格判据与记录值同 basis，不会拿缺省形态配规范化记录。
- 测试架构是本主题最强的一面：start-env.ts 的 P0 前置断言（防机器缺 locale 时断言静默变真）、23 条变异逐锚点唯一性核对（gen-mutation-spec.mjs 的 n!==1 即抛）、验收 A1～A7 覆盖新写新读/旧写新读(同/异环境)/新写旧读/旧版读改写保留新字段四格矩阵，报告 §3.2/§3.4 对「D5 缓存无单独用例、Node 18/20 未测、秒级复用」如实保留。
- 文档同步完整且口径一致：主设计 v1.3.55、LLD v1.1.13（已知缺陷表改「已解决」并列残余）、PROTOCOL 的 --wait/--status JSON 加法声明、MANUAL 三种告警文案、BACKLOG EV-158 done + EV-159 注记四点全部与代码行为对得上；盘上契约「变更必须换新字段名、禁止就地改」写进了 processStartTime 文档块与设计两处。

## 未覆盖范围（本侧盲区）

- 未运行 npm run check / 测试（只读审查身份）；check-1/check-2 的 2221/2219/0/2 读数取自证据文件文本，未复跑核对。
- acceptance.mjs、mutation-names.mjs、probe-lstart 系列证据未逐脚本审读执行逻辑（抽查了 gen-mutation-spec.mjs 的锚点核对）。
- EV-154 的 CLI 进程组记录实现本体（judgeCliGroup/terminateRecordedCliGroups 的启动时刻取法）属上一主题，未复审。
- 锁 TTL、state.json 全局锁与 reclaimStaleLock 的删除竞态细节未展开。
- 计划 r2 定稿全文未逐条比对，仅核对了与本补丁结论相关的 §4.2/§4.4/§4.5/D4～D7 引述。
- Node 18/20 与 Linux ps 形态未验证（项目仅支持 macOS，报告 §3.4 已如实声明）。
- skills-src/ 渲染产物与 hooks 对锁路径的引用不在本次变更面内，未检查。

## 实际查阅的项目文件

- `.reviews/worker启动时刻规范化/code/_meta/changes-20260928T120630Z.diff`
- `src/trivium/util/exec.ts`
- `src/trivium/lock.ts`
- `src/trivium/status.ts`
- `src/trivium/retention.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/hooks.ts`
- `test/helpers/start-env.ts`
- `test/helpers/fixture.ts`
- `test/unit/start-canonical.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/integration/run-protocol.test.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/07_manuals/MANUAL_user.md`
- `doc/08_project/BACKLOG.md`
- `doc/05_testing/REPORT_2026-09-28_worker_start_canonical.md`
- `doc/05_testing/evidence/worker-start-canonical-20260928/acceptance-output.txt`
- `doc/05_testing/evidence/worker-start-canonical-20260928/gen-mutation-spec.mjs`
- `doc/05_testing/evidence/worker-start-canonical-20260928/check-1.txt`
- `doc/05_testing/evidence/worker-start-canonical-20260928/check-2.txt`
- `AGENTS.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":28,"project_reads":14}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
