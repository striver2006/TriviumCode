---
schema: trivium.review.v1
topic: M9-Hook当轮Driver保护集
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260919T085742Z
rerun_index: 2
snapshot_hash: sha256:65ad39c237a326ff84448824dfeeffc5f76664bdc3c9c65036a9fbd870f59c41
blind: true
started_at: 2026-09-19T08:57:42.868Z
finished_at: 2026-09-19T09:09:46.465Z
duration_s: 219
tool_calls:
  read: 25
  grep: 8
  glob: 0
  run_command: 0
  project_reads: 13
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 0ddb20e3-48c7-4aaf-ac77-66354b79fd08
---

# 代码审查：M9-Hook当轮Driver保护集

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260919T085742Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

结论：approve-with-nits。三大审查焦点均已核实：新判据在正常流程中零误拦，与闸门分叉理由充分且防御对等，但「两种解析顺序行为等价」的实测判断存在盲区。
最关键分析（软链顺序）：realpath优先不仅是「表达性修正」，在通用跨阶段/跨主题软链场景下是实打实的安全缺陷修复，此前「行为等价」实测因夹具使用非Stage名（mirror）使词法恒为null而产生假象。
留痕判红安全性：正常流程经 writeRunMeta 写前校验与原子落盘保证留痕绝对合规，且普通业务/非角色写入前置严格短路，不读留痕，绝不会在正常流程中误拦。
闸门侧分叉合理性：Hook 是静默且不可逆的在线拦截，判错当场造成权限反向且模型不可见；而 gate 另有 commit 提交锚与完整性核对跑后兜底，两者容忍度分叉完全站得住，EV-73 推后评估节奏适宜。
代码质量：上一轮指出的三处路径规范化与注释滞后已完全吸收且变异验证充分，实现稳固，准予合并。

**结论**：`approve-with-nits`

## 审查意见（共 1 条：吹毛求疵 1）

### AGY-01 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:385-396` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：判定「两种解析顺序行为等价、属表达性修正而非缺陷修复」存在由测试夹具构造不全带来的实测盲区；未能识别出合法跨阶段软链在两种顺序下的真实安全行为差异。

**依据**：在 src/trivium/hooks.ts:385-396 与 test/unit/hooks.test.ts:930-940 中，声称「调换 locateArchiveTarget 的两个分支顺序用例仍绿，证明两种顺序行为等价、属表达性修正」。但查阅 test/unit/hooks.test.ts:944，用例构造的软链名为 t/mirror -> t/code，而 hooks.ts:203（stageSegmentsUnder）有白名单守卫 !STAGES.includes(stage)，mirror 使得词法分支必然返回 null，因此在当前测试夹具中调换顺序两臂均走 realpath 分支，用例必绿。若存在合法跨阶段软链（例如文件软链 t/plan/2026-09-19-t-claude.md -> t/code/2026-09-19-t-claude.md，且 plan 阶段 Driver 为 claude、code 阶段 Driver 为 codex）：词法优先时，词法命中合法阶段 plan，判定 Driver 为 claude，判定 -claude.md 为 Driver 产出并放行，写入穿透至 code 阶段覆写受保护的审核者文件；realpath 优先时，准确解析实际落点 code 阶段，判定 Driver 为 codex，准确将 -claude.md 识别为受保护审核者文件并拦截。两者在行为与安全性上绝不等价。当前代码采用 realpath 优先是正确的，但将其表述为无行为差异的「表达性修正」会误导后人。

**建议**：在 src/trivium/hooks.ts、doc/08_project/BACKLOG.md 中修正此表述，明确 realpath 优先防御了跨阶段/跨主题软链下的 Driver 身份混淆漏洞；并在 test/unit/hooks.test.ts 补充跨合法阶段软链且 Driver 不同的鉴别性回归用例。

## 认为正确的部分

- 较新留痕损坏判红逻辑严密：resolveRoundDriver 敏锐捕捉 r.unreadable.length > 0，防止降级采信旧轮次留痕导致 Driver 身份颠倒，且正常流程中 writeRunMeta 的写前校验与原子落盘保证了绝对零误拦。
- 前置短路保证无害写入零损耗：looksLikeRoleArtifact && isInsideArchiveResolved 词法与路径前置，普通业务文件与非角色工件完全不触发 resolveRoundDriver 与留痕 I/O，损坏留痕夹具下的不变性断言充分。
- 闸门有意分叉论据扎实：深刻阐明了在线静默 Hook 与离线 cmdGate 的兜底不对称性，未盲目拉齐，而是通过 EV-73 显式登记并推迟评估，工程节奏把控清晰。
- 响应迅速且吸收彻底：上一轮指出的重复路径规范化（AGY-01）与测试注释滞后（AGY-03）已精准收口，同时驳回 AGY-02 正则缓存的依据（独立子进程+消灭模块级固化）充分合理。

## 未覆盖范围（本侧盲区）

- 未在真实 Claude Code 交互会话中触发真实 PreToolUse Hook 事件（依赖真子进程命令与测试环境模拟）。
- 未测试包含循环软链或跨设备挂载点的非标准文件系统路径。
- 未执行多 Agent 真实厂商 CLI 的在线并发配额审查。

## 实际查阅的项目文件

- `CLAUDE.md`
- `src/trivium/hooks.ts`
- `src/trivium/meta.ts`
- `src/trivium/cli.ts`
- `src/trivium/archive.ts`
- `src/trivium/util/fsx.ts`
- `src/trivium/naming.ts`
- `src/trivium/schemas.ts`
- `src/trivium/review.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `test/unit/hooks.test.ts`
- `test/integration/gate-loop.test.ts`
- `.reviews/M9-Hook当轮Driver保护集/code/2026-09-19-M9-Hook当轮Driver保护集-gemini.md`
- `.reviews/M9-Hook当轮Driver保护集/code/2026-09-19-M9-Hook当轮Driver保护集-response-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":25,"grep":8,"glob":0,"run_command":0,"project_reads":13}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
