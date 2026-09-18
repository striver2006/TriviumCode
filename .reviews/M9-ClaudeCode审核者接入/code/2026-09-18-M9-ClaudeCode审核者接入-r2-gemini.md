---
schema: trivium.review.v1
topic: M9-ClaudeCode审核者接入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.5
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260917T162023Z
rerun_index: 2
snapshot_hash: sha256:e1c25fdd0a3170b48b2ea4c62426c9d120434484fd6826044246a42c6fb627af
blind: true
started_at: 2026-09-17T16:20:24.364Z
finished_at: 2026-09-17T17:16:39.670Z
duration_s: 218
tool_calls:
  read: 27
  grep: 8
  glob: 0
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 748a4470-d5fe-4573-9dde-a7dd100b4eef
---

# 代码审查：M9-ClaudeCode审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260917T162023Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

1. 最严重问题：healthy() 夹具推导使用 ?? true 误将三态中的 null 转为 true，制造了 { tool_surface_checked: null, strict_mcp_config_applied: true } 的失真组合，形成新的掩盖面（AGY-01）。
2. 阻断的两层修法（产出侧纯函数推导 + 判定侧独立前置）各自独立成立，纵深测试用例完备，互为屏障。
3. EV-40 的 true 臂归因彻底收住，增加了退出码数字校验与同轮正对照前置，统一了事件解析口径，彻底消除了假阳性归因。
4. 设计升版至 v1.3.20 并准确回填所有事实与台账，仅代码注释中关于「同真同假」的断言存在缺少非 null 限定的小瑕疵（AGY-02）。
5. 整体实现与设计质量扎实，建议批准并处理夹具细节。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/claude-severity.test.ts:46` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：healthy() 夹具推导 strict_mcp_config_applied 时使用 over.tool_surface_checked ?? true，将合法的 null 状态误转为 true，制造了非法且失真的测试组合，形成新的夹具掩盖面。

**依据**：查阅 test/unit/claude-severity.test.ts:45-48，healthy() 中 strict_mcp_config_applied 依赖 judgeStrictMcpConfig(over.tool_surface_checked ?? true, ...)。在 JS/TS 中空值合并操作符 ?? 对 null 和 undefined 一视同仁。而 ClaudeProbe['tool_surface_checked'] 契约为 boolean | null（三态），在 judgeStrictMcpConfig 中 toolSurfaceChecked === null 严格产出 null（如 claude-events.test.ts:953 所断言）。当用例显式传入 healthy({ tool_surface_checked: null }) 时，推导函数收到的却是被隐式转为 true 的入参，算出 strict_mcp_config_applied 为 true，产出 { tool_surface_checked: null, strict_mcp_config_applied: true } 这一现实中不存在的自相矛盾组合，再次制造了夹具掩盖真实耦合的问题。

**建议**：夹具推导中的默认值判断应显式区分 undefined 与 null（例如 over.tool_surface_checked === undefined ? true : over.tool_surface_checked），避免用 ?? 抹平三态中的 null 状态。

### AGY-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/types.ts:813` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：注释断言「今天两者恰好同真同假」（指 strict_mcp_config_applied 与 readonly_flags.length > 0）缺少「核对完成（非 null）」的前提限定，在全域三态语义下失实。

**依据**：查阅 src/trivium/types.ts:813 与 src/trivium/probes/claude.ts:413 注释，均断言「今天两者恰好同真同假」。然而在探针未拿到 system/init（未登录/断网/超时）时，probe.tool_surface_checked 为 false，readonly_flags 初始为 []（length > 0 为 false），而 strict_mcp_config_applied 经 judgeStrictMcpConfig 赋为 null。在三态全等语义下，null 与 false 并不等价同真同假。这一性质仅在「工具面已核对完成（即非 null 确定状态）」下成立。注释缺少前置限定容易导致读者误以为任何时刻两者均等价。

**建议**：在类型与探针注释的「同真同假」前补充限定语「在工具面已核对完成（排除 null）时」，避免误导读者以为任何时候都可以用长度判断替代该字段。

## 认为正确的部分

- 阻断的两层修法（产出侧 judgeStrictMcpConfig 纯函数化 + 判定侧 claudeSeverity ②' 分支严格前置 tool_surface_checked === true 与 readonly_flags.length > 0）各自独立成立，产出侧杜绝空数组反算 false，判定侧杜绝未测到误判 blocker，且以 pinned() 纵深用例钉住判定侧单独防御能力，互为屏障。
- EV-40 的 true 臂归因彻底收住：负对照判据限定 typeof exitCode === 'number' 排除了 spawn 失败与信号致死的 null 码，引入同轮正对照 read.completed 排除了断网/未登录等环境问题导致的假阳性非零退出，且事件计数统一复用 parseClaudeEvents 的 eventCount 避免口径漂移，真机复验证明其严谨性。
- 设计升版回填与规范自洽：设计文档准确升版至 v1.3.20，完整回填了文档头现状断言、实测依据索引、§3.7 事实表（含三个新机读字段）、§3.7.1 表格（修正了此前关于 --verbose 消费方的歧义）、§11.1 判据分类、§16.1 里程碑及 §24.1 演进台账，全仓保持单一条规范链。
- coverage_complete 三态映射解耦：成功抽离出纯函数 judgeDenyCoverage 并补充单测，消除了上一轮 AGY-04 指出的内联 I/O 流程缺乏防退化守卫的问题。

## 未覆盖范围（本侧盲区）

- adapters/claude.ts 适配器具体实现（M9 第 3 步尚未开工，其实际参数装配与 availability() 校验在当前阶段尚未建立代码）。
- 在真实 stdin 管道载入形态下的 EV-40 负对照表现（目前探针与负对照均在 argv 形态下实测，stdin 形态下的等价性需待第 3 步复验）。
- 真实 claude 2.1.273 在大审查包尺度下的端到端配额消耗与耗时表现（依赖 M9 验收阶段的真实审查实跑）。
- 审查员作为只读角色，未在宿主机执行任何外部写命令或调用真实的 claude 子进程。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/REPORT_2026-09-14_m6_claude_probe.md`
- `doc/05_testing/REPORT_2026-09-17_m9_claude_entry_probe.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/agents/registry.ts`
- `src/trivium/config.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/types.ts`
- `test/unit/claude-events.test.ts`
- `test/unit/claude-severity.test.ts`
- `test/unit/registry-parity.test.ts`
- `.reviews/M9-ClaudeCode审核者接入/code/_meta/changes-20260917T162023Z.diff`
- `.reviews/M9-ClaudeCode审核者接入/code/2026-09-17-M9-ClaudeCode审核者接入-gemini.md`
- `.reviews/M9-ClaudeCode审核者接入/code/2026-09-17-M9-ClaudeCode审核者接入-response-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":27,"grep":8,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
