---
schema: trivium.review.v1
topic: 失联worker退出后补收
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.9
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260928T151256Z
rerun_index: 1
snapshot_hash: sha256:eea99145b4e9d1426c51e8eca15a53b01dd30ff174cc25071f36a5e5dee01e4e
blind: true
started_at: 2026-09-28T15:12:57.893Z
finished_at: 2026-09-28T15:24:20.540Z
duration_s: 682
tool_calls:
  read: 14
  grep: 11
  glob: 0
  run_command: 0
  project_reads: 12
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_0efd58a7-3e27-4ca4-94f2-063360410ec8
---

# 代码审查：失联worker退出后补收

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260928T151256Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

核心链路逐一核实成立：两条进 gone 格的路径都要求 kill(pid,0) 判进程不在（死进程不会复活，pid 复用只会落 no_identity/mismatch 的安全侧），EV-142 两写者前提在新分支不破；.alive 只依赖 kill(pid,0)，不受 ps 瞬时失败与 TZ/区域设置影响，收窄选的判据与环境敏感性正交；共用收尾函数对 alive 格原第 4、5 步逐字迁移、锁保留 run_id+pid 双复核；可重入与回滚安全有 A2/A3/N2/G2 实证。唯一发现：finalizeGoneWorker 的文档注释对 alive 格 CLI 结束路径的表述与代码不符（注释级，无运行期影响），建议顺手修正。

**结论**：`approve-with-nits`

## 审查意见（共 1 条：次要 1）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts:1529-1530` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：finalizeGoneWorker 的文档注释说「CLI 记录的结束在调用方已经做过（cancelRun 里 gone 格与 alive 格共用同一段 workerConfirmedGone 判定），本函数不重复」——后半句对 alive 格不成立：alive 格在 cancelRun:1666 就 return 进 cancelLostWorker，根本到不了 1679-1684 那段 workerConfirmedGone 守卫的 CLI 结束块；alive 格的 CLI 结束是 cancelLostWorker 第 3 步（run-protocol.ts:1616）无条件做的，不经 workerConfirmedGone。这段注释位于并发敏感区，照它理解去重构（以为共用块已覆盖 alive 格、删掉 cancelLostWorker 第 3 步）会让堵住的 worker 名下 CLI 失去结束入口，恰好复刻 EV-154 要修的孤儿 CLI 形态。

**依据**：实读 src/trivium/run-protocol.ts：1666（alive 早退）、1679-1684（workerConfirmedGone 守卫的共享块，只对非 alive 非 mismatch 的格可达）、1614-1616（cancelLostWorker 第 3 步无条件 terminateRecordedCliGroups，「没确认退出也照做」）；对照 diff 中 LLD_orchestrator.md v1.1.14 引述块的措辞「CLI 结束在调用方已做过（workerConfirmedGone 判据覆盖 gone 格）」——LLD 只提 gone 格，是对的，run-protocol.ts 这条注释多说了 alive 格。

**建议**：把括号里的表述收窄为只陈述 gone 格的事实：CLI 结束已由调用方 cancelRun 终态分支里 workerConfirmedGone 守卫的那段做过（gone 格各形态下该判据必为真），不提 alive 格；或照抄 LLD 的措辞。纯注释改动，无行为影响。

## 认为正确的部分

- EV-142 两写者前提在新分支成立：classifyLostCancel 两条进 gone 格的路径（两时刻缺失时 processAlive(pid).alive 为假、有时刻时 processMatchesRecord 的 live.alive 为假）都要求 kill(pid,0) 判进程不存在（exec.ts:504-525，EPERM 仍算存活），补收不会踩到活 worker；worker 死后 pid 被复用只会把格判成 no_identity（两时刻缺失）或 mismatch（有时刻），都在不发信号、不补收的安全侧。
- 收窄用的 .alive 只依赖 kill(pid,0)，不跑 ps——不受 ps 瞬时失败影响，也不受 TZ/区域设置影响（那是 lstart 字符串的问题，只作用于 sameProcess）；EV-158 的环境敏感性残余与这个新判据正交，方向选得对。
- finalizeLostAndReclaimLock 是忠实抽取：与 diff 删掉的 cancelLostWorker 原第 4、5 步逐字相同（含 noSecondChance 文案从否定句改肯定句），锁回收保留 run_id+pid 双复核；N3 与既有 K6 两侧（run_id 同 pid 异 / run_id 异）都钉住了不相符不动、归档照常补收。
- gone 格接线位置（CLI 结束块之后、mismatch/no_identity 之前）与 alive 格「先报 worker 结束、再报 CLI 结束、再报补收」的输出顺序呼应，G1 有显式的 cliIdx<archiveIdx 顺序断言，M8 变异确认它咬得住。
- 结论句一律「见上方输出」不按写入结果分流：可重入（已是终态 skip）与归档缺失（无 run.json skip）两种非错误跳过由 reportFinalizeStep 如实播报（meta.ts:678/692 的 skipped 语义），从根上排除了结论句说假话——比 r1 草案的动态分流稳。
- 可重入与回滚安全有实证：acceptance A2 用旧构建（fc42d30）读新补收过的归档退 0、run.json 逐字节不变；A3/N2/G2 三件逐字节不变；K5′ 新增「归档里没有 run-….json」的跳过断言钉住了归档缺失不报错。
- 测试覆盖有效：矩阵四格（pid 不合法/两时刻缺失+活/两时刻缺失+死/有时刻+死）与 M1/M2 变异对应；K5′ 把改判（deepEqual classifyLostCancel 结果）与 CLI 照旧结束、补收尝试分开断言；N5 不新增用例的论证成立——notThisCell 对每个 mismatch 场景断言 run.json 不动（run-protocol.test.ts:938），而 gone 分支插在 mismatch 拦截之后，mismatch 场景触不到新代码。
- 变异规格 8 条 find 串与现行源码逐字核对一致且语义上唯一（M1/M2↔1439、M3↔1690、M4↔1537、M5↔1502、M6/M7↔1512-1521、M8↔1666；主路径 1822 的锁回收分支缺 pid 比对、不与 M7 冲突），生成脚本断言锚点恰好出现一次，变异结论可信。
- 文档四面同步与代码一致：设计 v1.3.56 台账行、LLD v1.1.14 引述块与「仍会停在 running 的」改准、MANUAL v1.0.14 两处、BACKLOG EV-159 拆「第一形态 done / 第二形态暂缓」；第二形态暂缓的论证（结构化特征逐位相同、误写 termination 成因不可逆、风险不对称）在我核对的 classifyLostCancel 判据下成立。

## 未覆盖范围（本侧盲区）

- 未实际执行测试/变异/验收与 typecheck（审查员只读，npm test 与构建会写 dist 产物）——全量 2225/2227、变异 8/8、验收 6/6 的读数取自 REPORT 与 evidence 文件，未独立复跑，2 个 skip 的归属也未核。
- waitRun 自身与 retention.ts、lock.ts 的内部实现（inspectLock/reclaimStaleLock 的并发防护细节）只读到调用面，沿用 EV-146 既有面未重审。
- gate-loop.test.ts 的 startWithRecordedClis/assertRecorded 夹具内部未逐行读（G1/G2 复用 EV-146 J 系夹具，只核了 lostHungRun:2758 与断言面）。
- REPORT §4 声称 PROTOCOL_dual_critic_relay.md 与 PRD「无锚点、不改」的 grep 论断未独立复核。
- 主设计文档 §7.5/§24 只核了 diff 内变更段落（含 v1.3.54 段的追加改准），未整节重读未变更部分。
- mutation-check.mjs 脚本本体（scripts/ 下）未读，其对「咬住」的判定口径取自输出文件与既有主题先例。

## 实际查阅的项目文件

- `.reviews/失联worker退出后补收/code/_meta/changes-20260928T151256Z.diff`
- `src/trivium/run-protocol.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/status.ts`
- `src/trivium/meta.ts`
- `test/integration/run-protocol.test.ts`
- `test/integration/gate-loop.test.ts`
- `skills/dual-critic/schema/review.v1.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":14,"grep":11,"glob":0,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
