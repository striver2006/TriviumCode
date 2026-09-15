---
schema: trivium.review.v1
topic: M8-Codex审核者接入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.2
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260915T013027Z
rerun_index: 1
snapshot_hash: sha256:3887566cf10e5dfd208eb1dbdb965b907627e565b7d8c617a6e5bc6a2fee18d9
blind: true
started_at: 2026-09-15T01:30:28.567Z
finished_at: 2026-09-15T01:50:09.362Z
duration_s: 300
tool_calls:
  read: 47
  grep: 13
  glob: 1
  run_command: 0
  project_reads: 27
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 3
  minor: 1
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 005815a4-bdfb-40d6-9cb9-ecffe16dff1b
---

# 代码审查：M8-Codex审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260915T013027Z`
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

1. 变异验证残留的两份 .mutbak 文件误入补丁（581 行），污染代码库且包含过时代码，需剔除；
2. spellingsOf 对相对禁读项漏派生 /private/var/...，且运行目录漏派生 ~/.trivium/runs，存在常规命令逃逸；
3. CMD_BOUNDARY 遗漏大括号 '{' 与 '}'，Bash 大括号展开语法可穿透检测；
4. 明确判定：F-1～F-5 闭集划定合理，B-2 绝不应计入必检闭集；command_texts 与 write_events 分列完全必要。

**结论**：`request-changes`

## 审查意见（共 6 条：重要 3 ｜ 次要 1 ｜ 吹毛求疵 2）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts.mutbak:1` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：变异验证过程产生的两份备份文件（base.ts.mutbak 与 guard.ts.mutbak）被意外提交至代码树并纳入补丁，污染了代码库并留存了过时实现副本。

**依据**：查看 .reviews/M8-Codex审核者接入/code/_meta/changes-20260915T013027Z.diff 第 12、16、671-989 行，确认两份 .mutbak 文件以 new file mode 100644 包含在补丁中；读取工作区文件 src/trivium/adapters/base.ts.mutbak 与 src/trivium/guard.ts.mutbak，发现其为变异测试时创建的旧代码备份（base.ts.mutbak 中还保留了未修 /private 的旧实现），共计 581 行冗余代码。

**建议**：从 Git 暂存区及工作树中彻底删除这两份 .mutbak 文件，并在 .gitignore 中增加 *.mutbak 规则以防重蹈覆辙。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:286-301` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：spellingsOf 对项目相对路径未派生包含 macOS /private 前缀的绝对写法，当命令通过 realpath 或 pwd -P 的真实绝对路径引用时会导致字面匹配失效。

**依据**：查看 src/trivium/adapters/base.ts 第 286-301 行：对于项目相对路径的禁读项（如 .reviews/t/code/x-gemini.md），normalizeAbs 将其解析为 /var/... 开头的路径，因为 nodePath.isAbsolute(denyPath) 为 false，out 集合中仅存 /var/...、.reviews/...、./.reviews/...；当审查员执行 cat /private/var/... 时，cmd.indexOf(s) 命中 /var/...，但其左侧字符 before 为 'e'（来自 /private），因 'e' 不在 CMD_BOUNDARY 中导致 boundaryOk 判假，造成泄漏漏报。

**建议**：在 spellingsOf 中，若生成的 abs 路径以 /var/ 或 /tmp/ 开头，额外向候选集合 out 中补入 /private${abs} 变体。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:286-301` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：通道 ③（项目外运行目录）在 deny_paths 中仅有绝对路径，spellingsOf 未派生波浪号（~）写法，导致审查员以常见 ~ 路径访问对端运行目录时漏报。

**依据**：查看 src/trivium/freeze.ts 第 191 行：运行目录以 expandHome(cfg.runtime.run_root) 形式（展开为 /Users/...）加入 deny_paths；查看 src/trivium/adapters/base.ts 第 286-301 行：由于该目录不在 projectRoot 内部，spellingsOf 仅返回绝对路径 /Users/...，从未派生以 ~ 开头的写法；查看 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md §10.2 通道 ③，明确运行目录 ~/.trivium/runs/ 需由措施 b 覆盖。审查员使用常规的 ls ~/.trivium/runs 无法命中。

**建议**：在 spellingsOf 中判断若路径以当前用户主目录（os.homedir()）开头，自动派生 ~${abs.slice(homedir.length)} 追加至候选拼写集合中。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:260-264` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：CMD_BOUNDARY 遗漏大括号字符 '{' 与 '}'，导致 Bash 常见的大括号展开（brace expansion）语法能够直接穿透字面扫描。

**依据**：查看 src/trivium/adapters/base.ts 第 260-264 行：CMD_BOUNDARY 包含逗号 ',' 但缺少大括号 '{' 和 '}'；在 test/unit/peer-leak-command.test.ts 中未包含大括号测试；当执行 diff {.reviews/t/code/x-peer.md,x-self.md} 或 cat {other,.reviews/t/code/x-peer.md} 时，紧邻前置或后置边界为 '{' 或 '}'，导致 boundaryOk 返回 false。

**建议**：将 '{' 与 '}' 加入 CMD_BOUNDARY 集合，并可一并补入 '@'（支持 curl -d @<file> 等直接附加参数的工具形态）。

### AGY-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:272` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：boundaryOk 右边界检查强绑定主机操作系统路径分隔符 nodePath.sep，未兼容 Git/Bash 固定的正斜杠 '/'，降低了可移植性。

**依据**：查看 src/trivium/adapters/base.ts 第 272 行：if (after !== '' && after !== nodePath.sep && !CMD_BOUNDARY.has(after)) return false; 检查仅豁免 nodePath.sep；在 Windows 环境下 nodePath.sep 为 '\'，而 Git 对象语法与 shell 命令路径分隔符恒为 '/'，导致目录条目命中（如 ls .trivium/ 或 cat .trivium/state.json）在 Windows 下因 after === '/' 判定失败。

**建议**：将边界条件调整为 after !== '/' && after !== nodePath.sep && !CMD_BOUNDARY.has(after)。

### AGY-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:1615` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：F-5 承诺面表述为「引号/转义包裹」不准确，字面扫描无法捕获反斜杠转义，实际覆盖的仅为引号与命令替换（反引号）。

**依据**：查看 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 第 1615 行与 src/trivium/adapters/base.ts 第 189 行：清单将 F-5 标为「引号/转义包裹」；查看 test/unit/peer-leak-command.test.ts 第 52-56 行，用例仅覆盖双引号、单引号与反引号；反斜杠转义（如 cat \.reviews/...）无法被字面匹配识别，属于 B-4 编码/间接盲区。

**建议**：将文档与注释中 F-5 的名称修订为「引号/命令替换包裹（双引号、单引号、反引号）」，并在盲区列表中注明反斜杠字符转义归入 B-4。

## 认为正确的部分

- 措施 b 判据、执行核验、告警渲染以及 run.v2 留痕的完整调用链闭环严密，变异验证中发现的 judgeSide 缺失断言问题已被故障注入测试（fault-injection.test.ts）妥善守住。
- CriticResult.command_texts 独立字段设计切中要害，在所有相关模块（types/runner/base/agy/zcode/stub/kit）中实现了一致的统一契约扩展。
- run.v2.json schema 中的 guard.peer_leak_via_command 字段在写侧实现恒写（hit: false 明确表达已检测且无命中），彻底消除了字段缺失与未命中之间的语义歧义。
- 将 B-1～B-4 盲区明确写成带断言的单元测试，有效将检测承诺的边界锁死，防止后续无意识放宽带来不可控的误报。

## 未覆盖范围（本侧盲区）

- 未执行真实的端到端 npm test 与 trivium doctor 命令（受限于审查员只读与无命令执行权限，纯靠静态走查与测试代码核验）。
- 未验证未来 Codex CLI 真实录制样本中高阶嵌套命令对 command_texts 的参数提取准确度（待 M8 第 3 步真机实测覆盖）。
- 未覆盖利用零宽字符、Unicode 字符归一化混淆等对抗性命令文本绕过（根据 ADR-002 与设计 §10.1 定调，非蓄意对抗形态不在本期承诺面内）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/01_requirements/PRD_driver_dual_critic.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `.reviews/M8-Codex审核者接入/plan/2026-09-15-M8-Codex审核者接入-revised-claude.md`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/base.ts.mutbak`
- `src/trivium/guard.ts`
- `src/trivium/guard.ts.mutbak`
- `src/trivium/types.ts`
- `src/trivium/review.ts`
- `src/trivium/runner.ts`
- `src/trivium/freeze.ts`
- `src/trivium/render.ts`
- `src/trivium/report.ts`
- `src/trivium/schemas.ts`
- `src/trivium/gate.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/stub.ts`
- `test/unit/peer-leak-command.test.ts`
- `test/integration/fault-injection.test.ts`
- `test/fixtures/stub-agent-kit/pieces/stub-agent.ts.txt`
- `skills/dual-critic/schema/run.v2.json`
- `.reviews/M8-Codex审核者接入/code/_meta/changes-20260915T013027Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":47,"grep":13,"glob":1,"run_command":0,"project_reads":27}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
