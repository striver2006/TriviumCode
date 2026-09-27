---
schema: trivium.review.v1
topic: 派生后失败的孤儿worker
stage: code
role: codex
vendor: openai
agent_cli: codex/0.157.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260927T151757Z
rerun_index: 1
snapshot_hash: sha256:fd2023d4e526ed3425c588ffe65868244d9ea7b84908fa0ae4763fe109463d62
blind: true
started_at: 2026-09-27T15:17:59.764Z
finished_at: 2026-09-27T15:30:30.801Z
duration_s: 611
tool_calls:
  run_command: 31
  project_reads: 11
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0e371-c864-76e2-b540-6da59defe274
---

# 代码审查：派生后失败的孤儿worker

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260927T151757Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

核心实现与计划 r2 一致：六步次序（终止→留给它→回收闸门→收尾 run.json→status.json 三分→双条件放锁）逐项属实；「终止先于回收闸门」有 U5① 按时序钉住。四道防串写守卫经重读代码逐一成立（release 只删自己、reclaim 复验、闸门与收尾都按 run_id）。terminateProcessGroup 每次发信号前都问判据，SIGTERM 与 SIGKILL 之前各自有一次 isGone 终判，且终判与发信号之间只有微任务、没有事件循环轮次——「未观察到退出⇒未回收⇒pid 不复用」在 Node/macOS 上成立（libuv 在回收子进程的同一 JS 回调里置 exitCode/signalCode）。取消路径除宽限期判据按 AGY-04 收紧外逐项等价。取值面四处一致、回滚配方有 A7 演练与 MC1 变异背书；验收首跑两条红确属构造问题（读数对账一致）。剩余四条均为播报与文案级小项，不阻断提交。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 2 ｜ 吹毛求疵 2）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts:585（settleOrphanedStart 第 1 步之后的无条件 warn）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：「已终止工作进程组 N（SIGTERM…）」无条件打印，在两种形态下过度宣称事实：①注入/默认的 terminate 首轮 hasExited 即为真（worker 在被处理前已自然跑完）时，terminateProcessGroup 一个信号都没发，播报仍说发过 SIGTERM；②t.gone 为假（未能确认退出）时，「已终止」与下一行「未能确认退出」自相矛盾。MANUAL v1.0.9 教用户按报错字样分辨三种结局，第一条播报的不实措辞会让人在②那格误以为进程已死、跳过 --cancel。

**依据**：读 src/trivium/run-protocol.ts:575-612：warn 在 try/catch 之后、!t.gone 分支之前无条件执行；读 src/trivium/util/exec.ts 的 terminateProcessGroup：进入即先 `if (await o.isGone()) return {gone:true, escalated:false}`，不发任何信号；测试 EV-150 U5④（worker 已跑完）只断言了后面的指路 warn，未核对第 585 行文案与事实的关系。

**建议**：按 t 的来源分句：首轮就 gone（未发信号）说「工作进程 N 已自行退出」；gone=false 说「已向工作进程组 N 发送 SIGTERM/SIGKILL，但未能确认退出」。方向是给 terminateProcessGroup 加一个「是否实际发过信号」的返回位，或在第 1 步前先问一次 hasExited。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts:628（settleOrphanedStart 第 4/5 步之间的 readRunMeta 吞错）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：`readRunMeta(...).catch(() => null)` 把「读不出/校验不过」压成与「读到且仍是 running」同一格：meta 为 null 时 workerWroteTerminal=false，第 5 步把 status.json 落成 failed——但 run.json 此刻可能是 worker 写下的 success（比如写完后被另一进程改坏、或读到半写状态），两个通道结论相反，而「以归档 run.json 为准」的指路 warn 恰恰只在 workerWroteTerminal 为真时才发。这是本函数各步吞错中唯一会影响后续读者（--wait / hook 提示）判定的一格。

**依据**：读 src/trivium/run-protocol.ts:624-660 的 workerWroteTerminal 计算与第 5 步三分；对照 meta.ts `finalizeUnfinishedRunMeta` 文档块「读不出走 skippedFromError」的处置——收尾步自己区分了「已终态跳过」与「读失败」，而这里的回读不区分。概率极低（worker 已确认退出、盘上文件不会在两步之间被合法改写），故 minor。

**建议**：把「读不出」当第三态：meta 读取抛错时不改 status.json 的 phase（只补 pid）并 warn 一句「归档 run.json 读不出，phase 不替它下结论」，与本主题「确认不了就不替它写结论」的口径一致。

### CODEX-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/util/exec.ts terminateProcessGroup 默认参数（run-protocol.ts:577-579 graceMs 5000 / killWaitMs 5000）与设计 7.5 `review --start` 行` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：EV-150 之后 `--start` 的失败路径最坏可阻塞约 10.5 秒以上（宽限 5 s + SIGKILL 确认 5 s，再叠 finalize 在任务锁上的等待），而 7.5 行仍写「立即返回」、入口契约（skills-src/commands/run.contract.md:102）只给 `--wait` 规定了 bash 工具超时。宿主 Bash 若在 settle 中途按缺省超时掐掉 --start，会落回一个本主题想关掉的残余形态：worker 已收到 SIGTERM 但闸门停在 running 等回收、锁未处理，只能靠会话启动清扫兜底。

**依据**：读 src/trivium/run-protocol.ts:577-579 的默认宽限与确认参数；grep skills-src/commands/run.contract.md 确认超时口径只覆盖 --wait；读设计 v1.3.51 变更段（changes.diff 中 7.5 行）确认「立即返回」措辞未随失败路径的阻塞时长补充说明。实际触发需要 worker 扛住 SIGTERM，概率低，故只作 nit。

**建议**：在 7.5 `--start` 行或入口契约注明「失败路径最长约 10 秒的收尾窗口」，让载体把 --start 的调用超时调到该值以上；或在报告 §3.2 的实测范围里补一句该阻塞上界的论证。不改行为参数。

### CODEX-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/REPORT_2026-09-27_orphan_worker.md §3.4（A4 的「真实失败里两者都不存在」）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：A4 两条红判为构造问题我认可（预建目录与 EISDIR 夹具的成因与读数吻合），但「真实失败里两者都不存在」对第二条说得过满：派生后失败的真实触发面恰恰是本地写失败（权限、磁盘满），EV-150 之后那次运行会以「终态 + 记了 worker_pid」进会话启动清扫的准入，清扫读 worker.pid 时同样可能撞上 EACCES 一类的读失败，报同一族「抹除失败」告警——只是成因不再是夹具自设。告警本身无害（下次会话重试），但这句结论会让后来人以为「真实场景下 A4 这类告警绝迹」。

**依据**：读 acceptance-readout.r0.json A4 条（「worker.pid 脱敏失败：EISDIR…哨兵在…」）与 acceptance-readout.json 同条改后读数；读 cancelRun 中 scrubRunDir 的准入注释（workerConfirmedGone 同源，run-protocol.ts:1160 附近）；BACKLOG EV-38 注记确认清扫按「终态 + pid 不在」处理该运行。

**建议**：把该句改成「真实失败里不会出现『59 个读不到的预建目录』；抹除失败类告警在权限/磁盘类成因下仍可能出现，属预期且可重试，不是本主题的回归」。

## 认为正确的部分

- 六步次序与计划 r2 §3.4/§3.5、设计 v1.3.51 注记⑤逐项一致；「回收闸门排在终止之后」在代码与 U5①（gateAtTerminate 断言）两处都得到证实；workerWroteTerminal 时 releaseRunningGateEntry 因 expect running+runId 而无操作，闸门留在待裁决——U5④ 与 P4b 钉住了该形态。
- 四道防串写守卫复核成立：release() 只删本进程内容的锁；第 6 步要求 run_id+pid 双条件；reclaimStaleLock 的 rename→复验→不符放回是真的会放回（EV-149 相关注释在场）；闸门与收尾都按 run_id 键。U5③ 钉住锁不被新一轮删、其余三道按代码论证成立。
- 「每次发信号前先问判据」属实：terminateProcessGroup 在 SIGTERM 前、升级 SIGKILL 前各有一次 isGone 终判，且终判与 send 之间无事件循环轮次；--cancel 改用后除宽限期判据收紧（AGY-04）外与旧代码逐项等价（同信号、同 5 s 宽限、同 250 ms 轮询、SIGKILL 后同样不等），前置 alive&&sameProcess 判断与「已不存在」step 未动。
- 「句柄未观察到退出⇒未回收⇒pid 与同号进程组不复用」在 Node/macOS 上成立：libuv 的 waitpid 与置 exitCode/signalCode、发 'exit' 在同一 JS 回调内完成，'exit' 监听在拿到 pid 后同步挂上不会漏；报告 §3.2 对 Node 18 未测的如实登记恰当。
- status.json 三分（已终态不动／本进程收尾落 failed／worker 已写 run.json 终态只补 pid）实现与设计⑤逐字对应，注入用例 U5②④ 各自钉住一格。
- 取值面四处一致（run.v2.json 枚举、EXCEPTION_TERMINATION_BY、report unlistedLabel、S1″/S3/V9），MC1 契约变异咬住 schema↔常量单一来源；A7 三格读数支持「保留取值面、只回退行为代码」的回滚配方。
- EV-152 的文档改准与代码一致：四个适配器都以 killTree:true 拉起厂商 CLI（grep 证实），probe-kill-reach 与验收 A5 读数支持「按 worker 组发信号够不到自成组的 CLI」，killProcessTree/terminateProcessGroup/cancelRun/LLD/MANUAL 五处措辞同口径。

## 未覆盖范围（本侧盲区）

- 没有复跑 npm run check、零配额验收、15+1 条变异——报告读数按引用采信；我只跑过 tsc --noEmit（通过）与只读检查命令。
- worker 主体（executeRun、runner finally 的锁释放）与 --wait 判失联一侧未逐行审读，只沿调用链走到与本主题相交的格子。
- Node 18（engines 下限）上的 reaping→'exit' 时序与 setTimeout 轮询行为没有实测，该缺口报告 §3.2 已自曝，我未追加验证。
- scrub/凭据清扫的完整行为面只为核对 A4 与 EV-38/152 的关联而读；不评价其自身正确性。
- 入口渲染产物（skills/dual-*）、hooks、registry-parity 未过目（r2 声明本主题不改这些面，我未逐一反核其声明）。
- 另一位审查员的镜头与结论完全未接触。

## 实际查阅的项目文件

- `.reviews/派生后失败的孤儿worker/code/_meta/changes-20260927T151757Z.diff`
- `.reviews/派生后失败的孤儿worker/plan/2026-09-27-派生后失败的孤儿worker-r2-claude.md`
- `src/trivium/run-protocol.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/lock.ts`
- `src/trivium/state.ts`
- `src/trivium/meta.ts`
- `src/trivium/types.ts`
- `src/trivium/status.ts`
- `skills/dual-critic/schema/run.v2.json`
- `doc/05_testing/REPORT_2026-09-27_orphan_worker.md`
- `doc/05_testing/evidence/orphan-worker-20260927/acceptance-readout.json`
- `doc/05_testing/evidence/orphan-worker-20260927/acceptance-readout.r0.json`
- `doc/05_testing/evidence/orphan-worker-20260927/contract-mutation.mjs`
- `doc/05_testing/evidence/orphan-worker-20260927/mutation-spec.json`
- `doc/08_project/BACKLOG.md`
- `doc/02_design/LLD_orchestrator.md`
- `skills-src/commands/run.contract.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":31,"project_reads":11}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
