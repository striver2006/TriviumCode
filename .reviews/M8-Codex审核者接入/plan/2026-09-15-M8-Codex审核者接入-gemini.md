---
schema: trivium.review.v1
topic: M8-Codex审核者接入
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.2
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260915T004805Z
rerun_index: 1
snapshot_hash: sha256:13a6257985ea786b9a6ba5a38c5ee116005d6320fa54a05bd305d33422ea89dc
blind: true
started_at: 2026-09-15T00:48:06.151Z
finished_at: 2026-09-15T00:58:39.741Z
duration_s: 207
tool_calls:
  read: 24
  grep: 8
  glob: 0
  run_command: 0
  project_reads: 18
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 3
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: ab794e97-a587-484d-b963-b08692207895
---

# 计划审查：M8-Codex审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260915T004805Z`
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险问题在于 §3.1 遗漏了 guard.ts:52 的 consulted 交叉核对（AC-11），非结构化轨迹下每次审查都将被判造假。
同时 checkEvidence 的工具数与 project_reads 统计完全未设计非结构化命令轨迹的计算算法。
审查焦点一：pathStructured 与 commandSemantics 确为同一范式的两面，属过度设计，应合并为单一读取机制枚举。
审查焦点二：只读降级留痕未规划 Schema 字段与 renderGuardWarnings 告警，必然重蹈 peer_deny_applied 覆辙。
审查焦点三：第 2 步先泛化可以成立，但断言必须基于 test/fixtures/codex-events/ 真实录制样本而非仅凭新设桩变体。
审查焦点四：AC-20 选用 qwen 与 deepseek 站得住脚，属真正的跨家族多厂商路由，换成同源模型确属偷偷放宽口径。
计划还遗漏了 preflight.ts 对 codex 只读能力、模型目录校验与探活的适配，第 3 步预检验收无法闭环。
总体判断为 request-changes，建议补齐上述契约与范围缺口后再行实施。

**结论**：`request-changes`

## 审查意见（共 6 条：阻断 1 ｜ 重要 3 ｜ 次要 2）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1 与 §8` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：契约泛化遗漏了 guard.ts:52 的 consulted 与工具轨迹交叉核对（AC-11），导致非结构化轨迹下每次审查都将被判伪造 consulted。

**依据**：阅读 src/trivium/guard.ts:52-65：judgeSide 使用 result.read_paths 构造 traceSet 并计算 matched / consulted.length < 0.8。计划 §3.1 梳理读路径消费方时仅列出 checkEvidence、checkPeerLeak、judgeSide.readonlyBreach 三项，遗漏了 consulted 核对。若 codex 侧 read_paths 为空，traceSet 为空，consultedUnverified 必为 true，导致 AC-11 恒判失守。

**建议**：将 consulted 交叉核对纳入适配契约泛化范围，明确由适配器从命令文本提取路径填入 read_paths，或调整核对逻辑支持命令文本子串匹配。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1 与 §4 第 2 步` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：未定义 checkEvidence 在命令读取机制下如何统计工具调用总数与项目文件读取下限，J4（AC-20 project_reads 达标）缺乏可执行的设计落地。

**依据**：阅读 src/trivium/adapters/base.ts:101-129：toolTotal 仅累加 read/grep/glob，完全排除了 run_command；projectReads 仅通过过滤 result.read_paths 计算。计划 §3.2 提出了 TraceCapability，但在 §4 第 2 步中未说明 checkEvidence 的具体改造，若不调整计数算法，codex 侧 toolTotal 与 projectReads 恒为 0，必然触发 insufficient_evidence 和 no_project_context 错误。

**建议**：在 §3 与第 2 步明确 checkEvidence 的分档逻辑：当属于命令读取机制时，toolTotal 需纳入合规的 run_command 调用，并定义 project_reads 是由适配器解析回填还是通过命令正则统计。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.3 与 §6 #2` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：只读保障降级方案缺少 Schema 契约定义与终端告警呈现，极易重蹈 peer_deny_applied 覆辙（字段存在但无人读取、用户在执行期无感知）。

**依据**：查阅 src/trivium/guard.ts:192-239（renderGuardWarnings 未输出 peer_deny_applied）、src/trivium/types.ts:775 与 skills/dual-critic/schema/run.v2.json:68（RunMeta.guard 未定义只读降级字段）。计划 §3.3 虽强调留痕，但未规划 schema 字段扩充与终端告警，将导致留痕沦为无消费方的死数据。

**建议**：在 types.ts 与 run.v2.json 的 guard 对象中明确增加机读降级字段（如 readonly_verification_degraded），并在 renderGuardWarnings 中追加显式终端告警。

### AGY-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 第 3 步 与 §2.1` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：第 3 步遗漏了 preflight.ts 对 codex 的适配，导致 codex 无法通过预检、模型目录失去把关，且 EV-05 遗留的技术债未被清理。

**依据**：阅读 src/trivium/preflight.ts：第 379 行 checkReadonlyCapability 写死校验 zcode 与 gemini；第 349 行 checkModelAgainstCatalog 对 vendor openai 恒返回 unverifiable，丢失了 M6 报告 §3 要求的 preflight 自身拦截未知 profile 与非法 model 的防线；第 610 行探活硬编码 probeAgyAuth 和 probeZcodeAuth。计划第 3 步将预检通过作为验收判据，却未规划 preflight.ts 改造。

**建议**：在第 3 步实现清单中明确包含 preflight.ts：使 checkReadonlyCapability 覆盖 codex 只读旗标，使 checkModelAgainstCatalog 支持 openai 目录比对，并编排 codex 探活。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.2 与 §6 #1` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：TraceCapability 的 pathStructured 与 commandSemantics 实为同一范式的两面，存在概念冗余；且未定义该能力的载体归属。

**依据**：对比 src/trivium/probes/codex.ts:244（trace_path_structured 为 false 时读取经 shell）与 src/trivium/adapters/agy.ts:138、zcode.ts:45。专有读取工具（agy/zcode/claude）必然带结构化路径且 run_command 为写工具；shell 读取机制（codex）必然无结构化路径且命令即读取。在所有四家 Agent 中两者严格一一映射，不存在正交组合。此外，计划未指明 TraceCapability 挂载于何处（适配器、结果还是探针）。

**建议**：将两字段合并为单一枚举（如 readMechanism: 'structured-tool' | 'shell-command'），并明确挂载于 CriticAdapter 或 CriticResult 上。

### AGY-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §2.1 ⑥⑦ 与 §4 第 3 步` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：未定义 agents.codex 的 Schema 形状，且未明确厂商 profile（-p）在配置与命令行中的组装传递路径。

**依据**：查阅通用编排演进设计需求 R-6：Codex 厂商 profile（-p）是基座配置，通过 agents.codex.profile 或 --profile-codex 传递；而 profiles.<档位>.codex 仅配置阶段模型 slug（-m）。计划 §2.1 ⑥⑦ 与 §4 第 3 步混淆了两者的命名空间，未给出 agents.codex 的 Schema 定义，亦未说明 AC-20 如何注入不同家族的 -p 参数。

**建议**：补齐 CodexCriticConfig 接口定义与 config.v2.json oneOf 分支，并在 CriticRequest 中明确 vendor profile 的来源与组装逻辑。

## 认为正确的部分

- M8 将 EV-01（措施 b：命令文本字面扫描）升格为前置并作为第 1 步实施，严格落实了安全依赖先行原则。
- 坚持不在适配层硬编码 CLI 旗标，严格遵守原则 P7（命令行一律由探针结论构造）。
- 第 3 步落实 CODEX_HOME 与 HOME 双重隔离（J2），准确吸收了 M6 第 4 步探针关于指令面泄露的实测结论。
- AC-20 坚持使用真实的 qwen 与 deepseek 两个不同家族进行真实审查和沙箱负对照，拒绝使用同源模型或基座兜底进行口径放宽。
- 明确第 2.1 节显式不做第 ⑤ 件入口资产，避免在没有消费方的情况下制造伪覆盖（遵循 EV-06 教训）。

## 未覆盖范围（本侧盲区）

- 未覆盖真实调用 OpenAI/DeepSeek/Qwen 线上 API 消耗配额进行现场端到端测试（二次审查员严格遵循只读与禁止执行写命令约束）。
- 未覆盖本机 ~/.codex/ 目录下实际 API Key 凭据在各个提供商端点的连通性状态。
- 未覆盖非 macOS 平台下 CODEX_HOME 与 HOME 隔离机制的系统调用差异。
- 未覆盖 M9（Claude 审核者）与 M10（任意 Driver）相关后续演进的详细设计。

## 实际查阅的项目文件

- `.reviews/M8-Codex审核者接入/plan/2026-09-15-M8-Codex审核者接入-claude.md`
- `src/trivium/types.ts`
- `src/trivium/guard.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/zcode.ts`
- `skills/dual-critic/schema/run.v2.json`
- `skills/dual-critic/schema/config.v2.json`
- `doc/05_testing/REPORT_2026-09-14_m6_codex_probe.md`
- `doc/05_testing/REPORT_2026-09-15_m6_driver_entry_probe.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/config.ts`
- `src/trivium/preflight.ts`
- `src/trivium/report.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":24,"grep":8,"glob":0,"run_command":0,"project_reads":18}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
