---
schema: trivium.review.v1
topic: M8-Codex审核者接入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.3
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260915T115437Z
rerun_index: 6
snapshot_hash: sha256:0e563cd889cec7bc3e0d871953bfbf69b00651300dda5b65ceb739f6ec643ede
blind: true
started_at: 2026-09-15T11:54:37.672Z
finished_at: 2026-09-15T12:16:32.378Z
duration_s: 1315
tool_calls:
  read: 32
  grep: 18
  glob: 1
  run_command: 0
  project_reads: 23
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 3
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: fd6968d2-f8de-42f7-988f-7682f1ff34bc
---

# 代码审查：M8-Codex审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260915T115437Z` ｜ 第 6 轮
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本次变更成功完成了 TraceCapability 能力抽象引入、判定分档以及两档一律判失守的 blocker 修复，既有两家行为保持稳定。
但核心提取器与归因分流存在两项 major 缺陷：
1. extractPathTokens 对管道写动词（tee）、文件描述符重定向（2>）及同族脚本参数（awk/grep）存在反例漏排，虚增读取证据；
2. unattributedDriftFiles 将已确诊审查员失守的文件全盘归为无法归因，且不可用侧挂掉时归因反转为开发者手改。
此外，0 下限反向抬升、桩覆盖面与注释不符、波浪号路径畸变等问题需一并修正。

**结论**：`request-changes`

## 审查意见（共 7 条：重要 2 ｜ 次要 3 ｜ 吹毛求疵 2）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:299-328` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：extractPathTokens 写目标位排除规则存在反例，管道写动词、文件描述符重定向以及脚本与正则参数会被误当成读取路径虚增证据

**依据**：src/trivium/adapters/base.ts:283-347 中，写动词仅检查 rawTokens[0]，导致管道或复合命令（如 `cat a.ts | tee out.txt`、`cmd && cp a b`）和绝对路径动词（`/bin/cp`）的目标位完全不被排除；重定向仅匹配独立的 `>` / `>>`，漏掉如 `2> err.log` 与 `1> out.txt` 等带文件描述符的重定向目标；且引号直接粗暴替换为空格导致 `awk '/pattern/ {print}'` 或含 `/`、`.` 的 grep 模式被当成读取路径提取。真实样本 test/fixtures/codex-events/README.md:12 即含 `2>&1 1>/dev/null`。

**建议**：按管道符与分号等切分命令段后再分别判定写动词；支持提取命令 basename；重定向匹配包含文件描述符前缀（如 `^[0-9]*>>?`）；收紧路径识别规则或排除 awk/perl 等同族脚本参数。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/guard.ts:308-321` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：unattributedDriftFiles 归因分流过宽且存在状态失真：已确诊失守的文件被错误划入无法归因，且不可用侧失败/超时时归因反转为开发者手改

**依据**：src/trivium/guard.ts:308-320 中，anyReadonlyUnavailable 为 true 时无条件将所有 changed 文件划入 unattributedDriftFiles 并将 fingerprintChangedFiles 置空；即使此时已明确检测到写事件失守且 breachedFiles 中已记录该文件，仍被记为无法归因，并在 renderGuardWarnings 输出「无正向证据」的矛盾告警。此外，guard.ts:274-282 在某一侧为 timeout 或 failed 时跳过生成 SideVerdict，导致 anyReadonlyUnavailable 仅基于剩余成功侧计算，若不可用侧因写操作崩溃或超时，其引发的漂移反被误归因为开发者手改。

**建议**：计算 anyReadonlyUnavailable 应综合本轮全部参与侧的声明能力而非仅取成功侧；在划分 unattributedDriftFiles 前先扣除已进入 breachedFiles 的确凿失守文件。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:229-232` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：effectiveMinProjectReads 在 configured 为 0 时反向抬升下限为 1，破坏配置契约

**依据**：src/trivium/adapters/base.ts:229-232 定义 `Math.max(1, Math.ceil(configured / COMMAND_TRACE_READS_DIVISOR))`。当 configured 为 0 时（用户或测试显式不设项目读取下限），tool-trace 返回 0，而 command-trace 却被 Math.max 强制抬升至 1，导致本意为折减的逻辑在零值边界反向抬高门槛。schema run.v2.json:104 明确 evidence_threshold 最小值为 0。

**建议**：在 configured <= 0 时直接返回 configured，仅在 configured > 0 时应用折减与 Math.max(1, ...)。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/stub.ts:268-288` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：桩适配器的 command_trace 模式未实现注释承诺的写目标位与逃逸形态覆盖，且全仓缺乏端到端集成调用断言

**依据**：src/trivium/adapters/stub.ts:268-280 的注释宣称覆盖了「子 shell 封装、裸相对、绝对路径、HEAD:<path>、写目标位、逃逸相对」，但实际给出的 6 条命令全部为合法只读命令，完全缺少写目标位（无 >、无 cp/mv/tee、无 sed -i）与逃逸相对（无 ../）。并且全仓测试中除单元测试内直接 mock 外，没有任何端到端测试起用 mode: 'command_trace' 的桩。

**建议**：在桩的六条命令中补齐带写目标位与逃逸相对的样本；在 runner.test.ts 等集成测试中增加对 command_trace 桩模式的端到端串联验证。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:373-379` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：extractPathTokens 提取出包含 ~ 的家目录路径未展开即进行 normalizeAbs，导致路径解析畸变并引发 consulted 误报

**依据**：src/trivium/adapters/base.ts:377 直接调用 normalizeAbs(tok, projectRoot)，而 normalizeAbs 使用 path.resolve。若审核者命令中包含类似 `cat ~/Work/proj/src/a.ts` 或 `cat ~/.trivium/...`，Node 的 path.resolve 会将以 ~ 开头的路径视为裸相对路径解析为 `<projectRoot>/~/...`。随后在 guard.ts:143 进行 consulted 交叉核对时，剥离 projectRoot 后残留下 `~/...`，与 consulted 中标准的相对路径完全对不上，造成 consultedUnverified 误报。

**建议**：在 normalizeAbs 或 effectiveReadPaths 前比照措施 b 的 expandHome 逻辑将前导 `~` 解析展开为 os.homedir()。

### AGY-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/report.ts:268` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：report.ts 中只读核验不可用文案将「降至两重」误写为「只剩一重」，与 guard 及 render 出现口径分叉

**依据**：src/trivium/report.ts:268 写「只读核验不可用（被拒的写不留痕，只剩指纹一重）」，而 src/trivium/guard.ts:405 与 src/trivium/render.ts:177 以及主设计 §11.1 均明确沙箱第一重仍旧生效，是从「三重降到两重（指纹比对仍有效）」。report.ts 出现口径分叉。

**建议**：对齐三处留痕文案，统一为「只读核验不可用（被拒的写不留痕，只读保障从三重降到两重，指纹比对仍有效）」。

### AGY-07 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/README.md:24` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：设计文档索引 doc/02_design/README.md 的版本号与演进记录未同步升级至 v1.3.9

**依据**：doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:49 已升级版本为 v1.3.9，但在 doc/02_design/README.md:24 仍记录为 v1.3.8 且缺少本次演进摘要，与 BACKLOG EV-14 记录的问题同形状复发。

**建议**：将 doc/02_design/README.md:24 同步更新至 v1.3.9 并补齐 M8 第 2 步的演进记录。

## 认为正确的部分

- TraceCapability 能力声明抽象设计清晰，将固有能力挂载在 CriticAdapter 上，六个判定点只针对能力分档而非按 Agent id 分叉，严格遵循架构纪律 7
- readonlyBreach 两档一律由写事件判定的 blocker 修正已切实落地，成功执行命令的真阳性不会因 rejectionRecorded=false 被掩盖
- effectiveReadPaths 仅向 checkEvidence 和 consulted 交叉核对供给，明确隔离于 checkPeerLeak，未污染 CriticResult 真实留痕，传递链条完整闭合
- 五面降级留痕（run.v2、front-matter、正文横幅、guardFlags、CLI 运行时告警）结构严密，三态设计健全

## 未覆盖范围（本侧盲区）

- 未覆盖真实 codex CLI 进程在各 OS 平台上的实时子进程执行（因本步尚未接入 codex 真实二进制）
- 未覆盖多审核者动态调度（3 侧同时执行）的大规模压力与并发时序场景

## 实际查阅的项目文件

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/README.md`
- `doc/08_project/BACKLOG.md`
- `doc/README.md`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/freeze.ts`
- `src/trivium/guard.ts`
- `src/trivium/render.ts`
- `src/trivium/report.ts`
- `src/trivium/review.ts`
- `src/trivium/types.ts`
- `test/fixtures/codex-events/README.md`
- `test/fixtures/codex-events/read-sentinel.jsonl`
- `test/fixtures/stub-agent-kit/pieces/stub-agent.ts.txt`
- `test/unit/adapter-base.test.ts`
- `test/unit/guard-capability.test.ts`
- `test/unit/render.test.ts`
- `test/unit/runner.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":32,"grep":18,"glob":1,"run_command":0,"project_reads":23}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
