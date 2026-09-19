---
schema: trivium.review.v1
topic: M9-Hook当轮Driver保护集
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260919T060422Z
rerun_index: 1
snapshot_hash: sha256:81b711b100d7d111266dd7051766eb7a1f292ad705bfe0bc0314898e70f6d041
blind: true
started_at: 2026-09-19T06:04:23.645Z
finished_at: 2026-09-19T06:14:28.990Z
duration_s: 605
tool_calls:
  read: 41
  grep: 18
  glob: 0
  run_command: 0
  project_reads: 26
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: b30b3b28-f6fb-417c-a0d7-06e434a2a436
---

# 计划审查：M9-Hook当轮Driver保护集

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260919T060422Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本计划核心方向明确，函数拆分与必填参数设计合理，能有效解决 M9 第 6 步验收的双向阻碍。但存在一处阻断性遗漏与一处设计隐患需修订：
1. 【最关键】src/trivium/review.ts 在 prepareRun 与 executeRun 从未向 setGateChecked 传递 driver，导致计划第一级来源 GateEntry.driver 在真实运行期必然落空，必须将 review.ts 纳入影响面；
2. 计划假定归档路径必为三段式，缺少对 task.json、README、verify 的解构守卫与常规写操作的短路；
3. 需补齐第二级来源用例，并对 run 元数据损坏场景保持 fail-closed；
4. 双审裁定：Q1 接受 scan=0 回落；Q2 支持拆为两个具名函数；Q3 支持暂不拦本步；Q4 惰性求值不属蔓延。
建议按意见修订计划后再行实施。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 2 ｜ 次要 2）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.2 与 §六` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划将 GateEntry.driver 列为第一级 driver 来源，却遗漏了真实流水线中 review.ts 从未向 setGateChecked 写入 driver 的现状，导致正常运行期第一级来源必定落空。

**依据**：实核 src/trivium/review.ts：第 938 行 prepareRun 置 state: 'running' 与第 1512 行 executeRun 置 state: 'review_done_awaiting_disposition' 时调用 setGateChecked，均未传入 driver 参数；全仓仅 cli.ts:1005, 1181 在校验/审批后补记了 driver。若不将 src/trivium/review.ts 纳入改动范围，双审结束 Driver 准备撰写裁决件时，state.json 中的 GateEntry.driver 恒为 undefined，计划 §3.2 的第一级来源在主路径上直接失效并全量回落至第二级。

**建议**：将 src/trivium/review.ts 补入计划 §六影响面与 §九执行步骤，在 prepareRun 与 executeRun 调用 setGateChecked 时传入当轮 driver（opts.driver ?? DEFAULT_DRIVER 与 meta.driver），使当轮闸门在 running 与 review_done_awaiting_disposition 阶段真实持有 driver。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.2` |
| 类别 | performance ｜ 层次 plan |
| 置信度 | high |

**问题**：计划假定「归档内路径必然是 <archiveRoot>/<主题>/<阶段>/<文件名>」，既缺少非三段式归档路径的安全校验，也缺少针对工作区常规写操作的前置短路，存在运行时异常与写拦截性能退化风险。

**依据**：实核 src/trivium/hooks.ts:339，hookPreWrite 拦截全工作区所有 Edit/Write 操作（包括 src/、test/）。若每次写操作均先执行 §3.2 的 driver 解析逻辑：①常规业务文件（如 src/a.ts）在归档外，无 topic/stage，无谓执行降级回落与状态读操作；②归档内存在 README.md（1段）、<topic>/task.json（2段）、<topic>/verify/*（非标准 Stage）等路径，若直接以三段式解构，task.json 会被误当成 stage 传给 latestRunMeta，触发 ENOTDIR 异常。

**建议**：在 §3.2 增加短路守卫与安全解构规范：①仅当文件名为已知角色工件形态（looksLikeRoleArtifact(basename)）且路径判定在归档内时，才触发 driver 解析；②解析归档相对路径时校验段数（segments.length >= 3）且第 2 段属于合法 Stage（'plan' | 'code' | 'bug'），否则安全回退。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.5` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：新增用例矩阵仅覆盖了第一级来源（gate 带 driver）与第三级来源（无 gate、无 run 元数据），遗漏了第二级来源（gate 无 driver，从 run 留痕解析）的断言。

**依据**：查阅计划 §3.2 与 §3.5 表格，三级来源中第二级为「取不到，回落该主题 run 元数据里最近一条的 driver」。但在 §3.5 列出的四条新增用例中，仅有「gate 记 driver」与「gate 无 driver 且无 run 元数据」两种构造，缺少「gate 无 driver、但存在 _meta/run-*.json 且记有 driver」的用例，无法防止第二级回落机制在编码或重构时发生退化。

**建议**：在 §3.5 补齐第二级回落的用例设计：构造无 gate（或 gate 缺 driver）、但归档 _meta/ 下有合规 run-*.json 记录非缺省 driver 的场景，断言 hookPreWrite 能正确解析出该 driver。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.2` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：第二级回落未区分「无运行元数据」与「运行元数据损坏」，将留痕损坏场景静默降级为缺省 Driver，与 cmdGate 的 fail-closed 口径不一致。

**依据**：实核 src/trivium/cli.ts:823-853，cmdGate 明确区分了 scanned === 0 与 scanned > 0 && !latest：扫到文件但全损坏时硬失败，禁止按缺省 Driver 继续。而计划 §3.2 描述为「两处都取不到 → 回落 DEFAULT_DRIVER」，若 latestRunMeta 扫出损坏 run 文件，Hook 将静默按 claude 判定，背离了 cli.ts 注释强调的『留痕坏了不能判成按 claude 判』原则。

**建议**：澄清 §3.2 第三级回落的前提为 scan.scanned === 0（从未跑过）；当 scan.scanned > 0 && !scan.meta（元数据损坏）时，应按故障告警或阻断拦截，保持与 cmdGate 统一口径。

## 认为正确的部分

- 核心问题定位精准：准确定位了 hasCriticRoleSuffix 无参调用与 ROLE_SUFFIX_ANYWHERE 模块级固化导致的方向①（非缺省 Driver 无法交卷）与方向②（审核者 claude 审查件失守）双向缺陷。
- 架构决策果断清晰：将无参函数拆分为具名的当轮面 hasProtectedRoleSuffix(fileName, driver)（driver 必填无默认值）与跨时间面 hasRoleSuffixCrossTime(fileName)，在编译期消除默认参数导致的静默漏传隐患。
- 边界切分克制审慎：明确将原稿时序问题（plan 前置写稿）隔离并登记为 M10 前置，既不扩大 M9 第 6 步验收的范围，又如实记录机器判据与文档落点。
- 变异验证意识扎实：在 §3.4 明确指出既有用例避免从 criticRoleSuffixes 反推重言式，并在 §3.5 明确要求新用例在改动前必须跑红。

## 未覆盖范围（本侧盲区）

- 跨时间面判据重构（EV-55）及 Bash 侧文本扫描收窄（不属本步范围，未深入推演）。
- M10 阶段主题级 driver 在 task.json 顶层的 schema 扩展与迁移逻辑。
- 非 Claude CLI 会话形态（如 Codex CLI 原生交互）下 Hook 能否被调用的宿主环境兼容性。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `src/trivium/hooks.ts`
- `src/trivium/state.ts`
- `src/trivium/cli.ts`
- `test/unit/hooks.test.ts`
- `src/trivium/naming.ts`
- `doc/08_project/BACKLOG.md`
- `src/trivium/init.ts`
- `src/trivium/meta.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `test/integration/gate-loop.test.ts`
- `test/unit/registry-parity.test.ts`
- `skills/dual-critic/hooks/hooks.json`
- `skills/dual-review-plan/SKILL.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":41,"grep":18,"glob":0,"run_command":0,"project_reads":26}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
