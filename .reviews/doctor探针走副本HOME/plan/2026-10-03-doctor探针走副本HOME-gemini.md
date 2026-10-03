---
schema: trivium.review.v1
topic: doctor探针走副本HOME
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.15
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20261003T042353Z
rerun_index: 1
snapshot_hash: sha256:ba0474d11da298e0858bc2a71413008ef0c1219f4b542c16602b08155f8ffe8b
blind: true
started_at: 2026-10-03T04:23:55.593Z
finished_at: 2026-10-03T04:31:36.369Z
duration_s: 240
tool_calls:
  read: 29
  grep: 14
  glob: 0
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 7b6b340e-bb4b-4ab8-9019-b33adfddad0c
---

# 计划审查：doctor探针走副本HOME

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261003T042353Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

1. §0「不做」项关于「headless 失败由已有的 ZCODE_HEADLESS_NOT_OK_HINT blocker 判据照旧处理」的前提假设与现有代码事实相悖：在已有结论（existing）的回归场景下，失败提前返回导致 response_field 保留旧值，根本不会触发 response_field === null 的 blocker 判定，全量 doctor 仍会退 0 且无 blocker。
2. §5 文档清单遗漏了新增测试报告时同步更新 doc/05_testing/README.md 的「当前已归档文件」一节，会导致契约测试 doc-archive-index.test.ts 失败。
3. 方案主体将 doctor 的 headless 与 path_deny 两次调用改走副本 HOME、防个人配置污染、落点根重定向与清理、回读对齐落点根、测试及变异设计均非常清晰完备，仅需澄清 blocker 预期与补齐文档契约登记即可实施。

**结论**：`request-changes`

## 审查意见（共 2 条：重要 1 ｜ 次要 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/doctor探针走副本HOME/plan/2026-10-03-doctor探针走副本HOME-claude.md:16` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §0 宣称「不改 headless 失败即提前返回，修完之后失败的含义变成审查那条路径不通，此时沿用旧结论、由已有的 ZCODE_HEADLESS_NOT_OK_HINT blocker 判据照旧处理，这正是想要的」，该前提与现有实现矛盾。在已有探测结论（existing）的回归场景下，headless 失败提前返回会使 probe.response_field 保留旧值（如 'response'）而非 null，导致 doctor.ts:598 的 r.probe.response_field === null 永远不可达，doctor 将退 0 且无 blocker 拦截。若计划预期审查路径不通时能被 doctor 拦截，现有逻辑无法达成；若本期刻意不改拦截行为，则 §0 的预期前提成立不实。

**依据**：src/trivium/doctor.ts:563-568 历史注释已指出「原先只有一支 response_field === null && !skipModelCalls，它在最该出现的两条路径上不可达：① 回归形态下探针 failureKind !== 'none' 时只 push note 就 return，response_field 保留旧值，全量 doctor 退 0、blockers 为空」；src/trivium/probes/zcode.ts:1140-1156 以 structuredClone(opts.existing) 初始化 probe；src/trivium/doctor.ts:598 仅在 r.probe.response_field === null 时报 blocker；计划 §3 用例 D4 亦明确断言失败时 response_field 保留 existing。

**建议**：在计划中澄清决策：若本题（EV-194）范围不包含改变 blocker 判定，应修正 §0 的陈述，如实说明「在有既有结论时 headless 失败只推 note、沿用旧 response_field，不会触发 blocker，此项行为与现状一致，本主题不作展开」；若要求审查路径不通时必须被 doctor 拦下，则需在 headless 失败时显式置 probe.response_field = null 或在 doctor 侧根据 failureKind 处理。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/doctor探针走副本HOME/plan/2026-10-03-doctor探针走副本HOME-claude.md:137` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §5 规划新增测试报告 doc/05_testing/REPORT_2026-10-03_doctor_probe_home_copy.md，但未列出将该报告同步登记至 doc/05_testing/README.md 的「当前已归档文件」一节。根据项目规范，缺少此项登记会导致契约测试 test/contract/doc-archive-index.test.ts 失败报错。

**依据**：doc/05_testing/README.md:16 规定「新文档与文档本身同批进下方『当前已归档文件』一节...由 test/contract/doc-archive-index.test.ts 对账」；AGENTS.md 改动同步清单要求「新增测试报告...同批进该目录 README 的『当前已归档文件』一节」；计划 §5 仅提及创建报告文件和证据目录，遗漏了 README 索引的更新项。

**建议**：在计划 §5 文档清单中显式追加：将 REPORT_2026-10-03_doctor_probe_home_copy.md 同步登记进 doc/05_testing/README.md 的「当前已归档文件」一节（按日期及规范格式排序），确保符合契约测试对账要求。

## 认为正确的部分

- 将 probeZcode 内两次真实模型调用改与 authProbe / run() 同形，共用临时目录 runDir，设 landingRoot，探完在 finally 中严格按返回值整删临时目录，收敛了 CLI 产物对真实 HOME 的污染。
- 抽象 zcodeProbeModel 与 describeZcodeProbedPath 两个导出函数供 authProbe 与 probeZcode 复用，保证探活模型与路径描述口径单源维护。
- prepareZcodeHome 支持 srcConfig 隔离，测试注入口 invoke 设计合理，变异测试表（M1-M14）与单测（D1-D8）的对应关系严密。

## 未覆盖范围（本侧盲区）

- 未实际拉起 ZCode CLI 子进程或执行真实模型调用进行改前改后对照（审查员受限无命令执行能力，依赖静态代码分析与逻辑推演）。
- 未验证 ZCode 0.16.9+ 新版本在本地安装的真实行为是否有其他未记录的 stderr 形态。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/README.md`
- `src/trivium/probes/zcode.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/doctor.ts`
- `test/unit/zcode-auth-probe.test.ts`
- `test/unit/zcode-provider-env.test.ts`
- `.reviews/doctor探针走副本HOME/plan/2026-10-03-doctor探针走副本HOME-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":29,"grep":14,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
