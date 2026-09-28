---
schema: trivium.review.v1
topic: worker启动时刻规范化
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.9
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260928T120630Z
rerun_index: 1
snapshot_hash: sha256:bdfa668b28e2d7dd9cae2da741ab9fa7d0250eb82e13782ab7a14e0b4092e8b0
blind: true
started_at: 2026-09-28T12:06:32.720Z
finished_at: 2026-09-28T12:15:52.915Z
duration_s: 479
tool_calls:
  read: 19
  grep: 8
  glob: 0
  run_command: 0
  project_reads: 13
evidence_ok: true
verdict: approve
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_20d66098-8af8-444e-a650-f6a8f37a06af
---

# 代码审查：worker启动时刻规范化

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260928T120630Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

未发现问题。最高风险点是锁改写漏覆盖新字段会让活 worker 的锁被下一个 --start 当遗留锁回收（判 pid_reused、方向最坏），实现以纯函数 workerLockContent 在 startRun 与 settleOrphanedStart 两处收口并显式覆盖四键，被 U4 ①② 与变异 M2/M17 钉住。processMatchesRecord 的 canonical 分支与 processAlive 逐字同构（kill+EPERM、取不到判非同进程），legacy 分支逐字退回（U2 以 deepEqual 对账）；八个身份消费方经全仓 grep 对账无遗漏，processAlive 剩余三处均为只看 .alive 的调用，与设计口径一致。升级窗口与回滚退回 v1.3.54 行为由 A2～A7 六方向验收证实不改善也不恶化。mismatch 告警按 basis 分写、legacy 原句逐字保留（既有 K5 ④ 不改仍绿）。测试的 P0 前置断言防住了「环境巧合导致断言静默变真」。变异 23/23 咬住、失败用例全落在本主题目标用例、无前置失败。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- processMatchesRecord 作为跨进程身份比对唯一读法的收敛设计正确：canonicalStartOf 只认 trim 后非空字符串（U3 覆盖 7 种坏形状），有 canonical 只比 canonical、没有逐字退回 processAlive——src/trivium/util/exec.ts:604 与 U2 的 deepEqual 对账证实了「逐字」。
- workerLockContent 显式覆盖 run_id/pid/两种启动时刻（值 null 也写 null）是本补丁最关键的正确性点：acquireLock 写下的锁带着 --start 自己的 pid_started_at_canonical，spread 漏覆盖即成「worker 的 pid + --start 的时刻」；startRun 与 settleOrphanedStart 两处都经它，U4 ①② 与 M2/M17 钉住。
- processMatchesRecord 的 canonical 分支存活探测（kill(pid,0)+EPERM 算活）与 processAlive 前半段一致，「活着而取不到 ⇒ sameProcess:false 与今天期望非空而取不到同口径」的说法逐行核实成立；不读人读文案、basis 只来自结构化事实，判据与措辞解耦干净。
- classifyLostCancel 的 D7 放宽（两种形态有其一即可）与 rec 快照传递自洽：判格按 canonical 判 alive 后，cancelLostWorker 的 lostWorkerGone 用同一 rec，退出判据与判格同 basis，不会拿缺省形态配规范化记录（run-protocol.ts:1462 注释与实现相符，U8/U10 验证）。
- mismatch 告警按 basis 分写且 legacy 原句逐字保留、仅句末补成因——既兑现 EV-158 的告警更准，又不破坏既有 K5 ④ 钉住的输出契约（实施报告 §3.1 记录了第一版改整句被 K5 ④ 打红后回调，处理得当）。
- 测试三层互相咬合：单测 11 格覆盖纯判定面（含 k 格规范化值不符、h 格取不到、D7 只有 canonical）；gate-loop I1～I7 以真实子进程在 W 写 R 读的错开环境下验证 --wait/清扫/scrub/抢锁/--cancel/失联后取消/升级窗口回归；变异 23/23 且失败用例名全落在本主题目标用例（mutation-names-output.json），说明用例不是恒真。
- start-env.ts 的 P0 前置断言（W/R 缺省形态互异且都不等于 canonical）防住了「机器没装 fr_FR/de_DE 区域导致两环境同形、断言静默变真」的坑，宁可失败不静默通过，取舍正确。
- 验收用 git archive 基线构建旧 bundle、不叠加文件、sha256 对账、收尾核对无残留进程组（acceptance-readout.json leftover_groups 为空），A3/A6 两个方向如实验证了升级窗口与回滚「与旧版相同」，证据可信。
- hooks.ts sweepDeadRunningGates 的注释更正（「只看存活」）与实现相符（只取 .alive），且保守方向（复用者活着不回收、TTL 兜底）不受 EV-158 影响，无需迁移。

## 未覆盖范围（本侧盲区）

- 真实厂商 CLI 的实测未做（用户决策不烧配额）；Node 18/20 未测（报告 §3.4 如实保留，本机 v25.2.1）——本补丁无新 API，风险低。
- 证据文件只抽查了关键部分：acceptance.mjs 主体（180 行起）与 readout 全文、mutation-output 头部；check-1/check-2 全文、mutation-spec.json 逐条锚点、probe-lstart.out.* 逐字段未逐行核对，取的是报告与证据文件的自述一致性。
- D5 缓存（selfCanonicalStartTime 只缓存非 null）无用例——实施报告 §3.2 已自认，行为上无从区分缓存与否，正确性由 U5 ①④ 间接覆盖，我认可该判断、未再追。
- 作为只读审查未重跑任何测试与命令，全绿读数取自报告与证据文件；跨 macOS 大版本、或未安装 fr_FR/de_DE 区域的机器上 ps lstart 的行为未验证（P0 断言在那类机器会显式失败而非静默，风险已被测试设计控制）。
- acceptance.mjs 前 180 行的夹具构建段（fixture/startLive/formsOf 等辅助函数）未逐行读，只核对了其调用点的断言实质。

## 实际查阅的项目文件

- `.reviews/worker启动时刻规范化/code/_meta/changes-20260928T120630Z.diff`
- `src/trivium/util/exec.ts`
- `src/trivium/lock.ts`
- `src/trivium/status.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/hooks.ts`
- `src/trivium/retention.ts`
- `test/unit/start-canonical.test.ts`
- `test/helpers/start-env.ts`
- `doc/05_testing/REPORT_2026-09-28_worker_start_canonical.md`
- `doc/05_testing/evidence/worker-start-canonical-20260928/acceptance-readout.json`
- `doc/05_testing/evidence/worker-start-canonical-20260928/acceptance.mjs`
- `doc/05_testing/evidence/worker-start-canonical-20260928/mutation-output.txt`

> 编排器从工具轨迹中记录到的读取次数：{"read":19,"grep":8,"glob":0,"run_command":0,"project_reads":13}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
