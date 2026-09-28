---
schema: trivium.review.v1
topic: 失联worker退出后补收
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.12
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260928T142320Z
rerun_index: 1
snapshot_hash: sha256:a34b837f32a723aa17574328616613326534c7c1f1394d1018e2dbc71a3958ad
blind: true
started_at: 2026-09-28T14:23:21.622Z
finished_at: 2026-09-28T14:32:40.040Z
duration_s: 399
tool_calls:
  read: 25
  grep: 12
  glob: 0
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 7426a523-2327-49b9-bafd-69ca4f7e32e5
---

# 计划审查：失联worker退出后补收

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260928T142320Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

总体架构方向清晰，边界把控良好，但存在一处导致编码返工的 Major 问题：§3.3 的 finalizeGoneWorker 结论输出写死「已按前提补收」，在可重入场景下会虚假报告事实，违背用户决策 6，且与 §5.1 N2 / §5.2 G2 的测试断言设计脱节；另有调用方注释遗漏与章节引用编号断裂。建议修订输出逻辑与断言设计后再行编码。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/失联worker退出后补收/plan/2026-09-28-失联worker退出后补收-claude.md:235-241 (plan §3.3 & §5.1 N2 & §9)` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：finalizeGoneWorker 结论输出写死为「已按前提补收」，与用户决策 6（按事实分流：补收了/按前提跳过/写失败）冲突，在可重入场景下向用户谎报补收事实，且导致 §5.1 N2 与 §5.2 G2 的测试断言设计脱节。

**依据**：对比被审文档 §3.3、§3.2、§9 用户决策 6 以及 test/integration/run-protocol.test.ts 的 K8 测试。§3.3 中 finalizeGoneWorker 代码写死输出「已按前提补收归档 run.json 与运行登记」，且 §3.2 共享函数 finalizeLostAndReclaimLock 返回 Promise<void> 吞掉了 fin 结果；而在 §5.1 N2 与 §5.2 G2 中却断言第二次执行输出为「已是终态（failed），不追溯改写」。实际执行时，重入场景下 run.json 跳过写入（skipped），stdout 却谎报「已按前提补收」，直接违背用户决策 6「输出按事实说（补收了/按前提跳过/写失败）」，且会导致 N2/G2 的 stdout 断言必然红灯返工。

**建议**：让 finalizeLostAndReclaimLock 返回 fin 结果，并在 finalizeGoneWorker 中按 fin.runMeta.kind（written / skipped / error）动态分流结论播报；或仿照 cancelLostWorker 将结论句写为「归档 run.json 与运行登记见上方输出」，并同步对齐 §5.1 N2 与 §5.2 G2 的测试断言位置（明确断言 stderr 还是 stdout）。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/失联worker退出后补收/plan/2026-09-28-失联worker退出后补收-claude.md:266-289 (plan §3.5)` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：文档与注释同步清单遗漏了 src/trivium/meta.ts 中 finalizeFailedRunMeta 的调用方清单更新。

**依据**：查阅 src/trivium/meta.ts:576-581，finalizeFailedRunMeta 的 JSDoc 中明确枚举了「七个调用方」，包含 EV-146 的 cancelLostWorker。本次 EV-159 抽出的共享函数让 finalizeGoneWorker 成为新的调用入口，但被审计划 §3.5（文案改准）和 §6（文档同步）均未规划 meta.ts 这一处文档注释的同步。

**建议**：在 §3.5 与 §6 中补充将 src/trivium/meta.ts:576 的调用方说明扩充至覆盖 gone 格（EV-159）。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/失联worker退出后补收/plan/2026-09-28-失联worker退出后补收-claude.md:168 (plan §3.1 & §4)` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：计划正文存在悬空小节引用（§4.1～§4.4 未定义）及俄文字符笔误。

**依据**：在被审文档中，§0、§1.1、§1.3、§1.5、§8 共 7 处交叉引用了 §4.1、§4.2、§4.4，但正文在 §3.5 后直接跳到 §4.5，存在小节编号断裂与悬空引用。此外 §3.1 中正文出现俄文字母拼写的「квирк」（应为 quirk）。

**建议**：理顺正文小节编号，补齐或修正悬空引用；将「квирк」修正为英文「quirk」。

## 认为正确的部分

- 范围收敛与边界清晰：严格遵守用户决策，只做 EV-159 第一形态，不并入 EV-157/160，mismatch 一律不补收，不新增 termination 取值，保持与 alive 格同口径（status.json 不改写、闸门不动、凭据不抹）。
- 第二形态暂缓论证扎实：§4.5 深入分析了升级前无 lost 字段的 heartbeat_stale 与本版 worker 异常收尾失败在结构化数据上的同构性，准确指出判据无法区分两者且误改写归档成因代价不可逆，暂缓决策成立。
- no_identity 格收窄方向正确：将「两种启动时刻缺失但 pid 上已无活进程」安全归入 gone 格补收，既消除了对死亡进程的过度连坐，又守住了有活进程时防范 PID 复用两写者冲突的安全红线。
- 验证规划全面：覆盖 N1～N7 单测、K4/K8/K9 既有测试断言更新、G1/G2 集成测试、M1～M8 变异咬住点以及 A1～A4 零配额双向验收，防护网设计周密。

## 未覆盖范围（本侧盲区）

- 未在真实多终端并发环境下执行长时间挂死的真实进程取消（只读审查，未拉起长时间子进程）。
- 未消耗厂商配额执行涉及外部 LLM CLI 的端到端真实调用（依用户决策采用零配额验收）。

## 实际查阅的项目文件

- `.reviews/失联worker退出后补收/plan/2026-09-28-失联worker退出后补收-claude.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/07_manuals/MANUAL_user.md`
- `src/trivium/run-protocol.ts`
- `src/trivium/meta.ts`
- `src/trivium/lock.ts`
- `src/trivium/status.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/util/log.ts`
- `test/integration/run-protocol.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":25,"grep":12,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
