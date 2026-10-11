---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: code
role: claude
vendor: anthropic
agent_cli: claude/2.1.296
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: envelope
effort_requested: null
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: legacy
run_id: 20261011T101510Z
rerun_index: 8
snapshot_hash: sha256:3e4168f17cafea576be0e26c5b4679b8a4b859c5d8049858b969fa651faa2b60
blind: true
started_at: 2026-10-11T10:15:18.113Z
finished_at: 2026-10-11T10:27:10.356Z
duration_s: 712
tool_calls:
  read: 19
  grep: 16
  glob: 0
  run_command: 0
  project_reads: 18
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 1
degraded: false
parse_fallback: false
peer_deny: true
drift: false
heterogeneous: unknown
access:
  requested_mode: profile
  profile: qwen
  launcher_requested: /Users/chenzhenbo/.local/bin/cld
  launcher_effective: /Users/chenzhenbo/.local/bin/cld
  wrapper_sha256: e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5
  configuration_sha256: 9a3bfaa3acc006b11a8c5c6422da69841ccc121de244ee7eff9574e4146cb8e5
  provider_declared: qwen
  provider_declared_source: profile
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: claude
    status: unknown
    left_model: null
    right_model: qwen3.8-flash
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: claude
    right: gemini
    status: different-family
    left_model: qwen3.8-flash
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：qwen / gemini
  - left: claude
    right: glm
    status: different-family
    left_model: qwen3.8-flash
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：qwen / glm
override_reason: 左侧模型信息缺失
session_id: cce52bc5-c735-45ec-9ff2-20898734a281
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T101510Z` ｜ 第 8 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

焦点「授权轮次可以按需增加，不必询问授权」的实现与说明书整体同口径：委托被落成 v8 授权 + hash 绑定权威指针 + launch-v12 有界枚举 16B/17C，round-guard-v2 仍机械拒绝第 18 轮与缺权威/错参数，设计/协议/报告/README 对「轮数委托≠判据变化≠普通审批」的边界逐字一致，测试谱系覆盖 v2-v8 正负例。最可疑的一条仅是 17C 静态审计漏掉了 16B 审计有的委托来源断言（audit 链不对称），不构成放行漏洞。未发现该委托被越界使用或实现自相矛盾。

**结论**：`approve-with-nits`

## 审查意见（共 1 条：吹毛求疵 1）

### CLAUDE-01 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/agent-access-20261011-closeout-r8/static-audit-before17.mjs:16` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：审查焦点的委托来源在本批审计链中断言不对称：16B 前的审计（static-audit-before16.mjs）在权威 demand 中显式断言 auth.delegated_round_extensions === true，而 17C 前的审计只断言 task/runs===16 与 new_limit===17，不再要求该委托标志；delegation_exact_reply 仅被记录、缺失时（undefined）也会照常落盘。守卫 round-guard-v2 的 wellFormed 同样不校这两个字段，于是审计链对「本轮追加是否有委托出处」的核验在批间会静默减弱。

**依据**：读了 static-audit-before16.mjs（diff 第 66990 行：demand 含 auth.delegated_round_extensions===true）与工作树 static-audit-before17.mjs:16（demand 不含该字段，仅 new_limit===17）；round-guard-v2.mjs:22-29 的 wellFormed 仅校 topic/driver/critics/new_limit/historical_run_ids/new_rounds 形状；formal-round-authorization-v8.json:51-52 定义 delegated_round_extensions 与 delegation_exact_reply；plan r20 §1 与 REPORT 第 378-380 行说明该委托是本轮追加的唯一依据。

**建议**：下一批的 prepare/static-audit 保持断言对称：要么与 before16 一样 demand delegated_round_extensions===true（或至少 delegation_exact_reply 为非空字符串），要么在授权 verification JSON 中显式记录该字段缺省即失败，避免委托来源核验随批转静默。

## 认为正确的部分

- 委托落地形态自洽：用户回复逐字进入 v8 授权与指针 basis，hash 冻结枚举仅 16B/17C，launch-v12 由 prepare-round16 以单串替换从 v11 派生（唯一性有 split 长度守卫），第 18 轮仍被 new_limit/ordinal 双检机械拒绝——「按需增加」落成「按需发布有界冻结批次」，不是无限放行。
- round-guard-v2 的纯核验强制第五参显式权威、读取壳核指针文件名正则+完整 hash+主题一致，防 ../ 载体、防把 superseded 旧授权当当轮；恢复测试对缺权威/null/{}形状无效、历史集合删改/孤儿/重复/unreadable、五旗标错值/重复/缺失、--allow-single 均有负例。
- 文档口径一致：设计 v1.3.149-152、PROTOCOL、ADR003、QUICKSTART、RUNBOOK、恢复报告与 doc/05_testing/README.md 索引都把「轮数追加委托」与「普通审批委托、自动 CLI 扩容、准入判据变化」分列，criteria_change_authorized:false 在授权与文档双侧口径相同。
- 防历史篡改机制有效：historical_run_ids 必须是真实 archive 的子集且 task.runs 与 archive 全等，supersedes 文件字节 hash 被测试与审计双重回读，v2-v8 授权谱系与旧 guard 逐字节保留。

## 未覆盖范围（本侧盲区）

- 无法执行命令，未跑 npm run check、守卫用例或 git；「测试覆盖正负例」等结论来自静态读 diff 与工作树，非实测。
- 被审补丁含 dirty 工作树内容（static-audit-before17 记录 head=f63e339f、dirty=true），未能区分哪些行属于 f63e339f 提交、哪些是提交后未入库的工作树改动；个别证据的时间自洽性未逐文件核实。
- 产品侧本轮变更（adapters/claude.ts、probes、freeze.ts 目录事实、codexCommandEvidence、recipes/closeout 的取证三节 §3.1-3.3）未逐条核对其自身说明书，焦点为轮数授权。
- budget-preload/976 份台账、四目标安装与 28 入口一致性只核到 hash 引用记录，未逐文件验证。
- 16B/17C 之外的未来批次（v9+）流程只能依 prepare-round16 的派生模式推断，无现行代码可核。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r20-codex.md`
- `.reviews/Agent双模式接入真实准入收口/code/_meta/changes-20261011T101510Z.diff`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v8.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v8.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/prepare-round16.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/formal-round17.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r8/static-audit-before17.mjs`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/05_testing/README.md`
- `src/trivium/archive.ts`
- `src/trivium/build-stamp.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":19,"grep":16,"glob":0,"run_command":0,"project_reads":18}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
