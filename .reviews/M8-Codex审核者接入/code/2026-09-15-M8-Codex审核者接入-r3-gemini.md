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
run_id: 20260915T032600Z
rerun_index: 3
snapshot_hash: sha256:8796144562820e53849a9a3e0355b1b5c64c4fa6040105f5ead53c91734dee1b
blind: true
started_at: 2026-09-15T03:26:01.077Z
finished_at: 2026-09-15T03:44:27.690Z
duration_s: 222
tool_calls:
  read: 23
  grep: 8
  glob: 0
  run_command: 0
  project_reads: 12
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 8490adf0-2c38-49c9-b0e6-06f06460176a
---

# 代码审查：M8-Codex审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260915T032600Z` ｜ 第 3 轮
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险的问题是 AGY-01：代码并未将 ~user/ 归入保守命中，而是因 UNRESOLVABLE 剥除 ~ 且未被 expandTilde 展开而静默漏检，击穿通道③；
对账测试使用章节锚点截取并配有下限与双向强对账，锚漂移时会明确报错，不会静默退化；
prefixIsOnlyDotHops 归一后解决了树内往返，但 hitsAt 的 before !== '.' 会导致 ..env 这类同前缀点文件误报（AGY-03）；
v1.3.8 的收口在 doc/02_design/README.md 的演进历程段落仍遗漏了变更摘要（AGY-02）。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:285-292` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：~user/ 未如设计预期归入保守命中，而是静默穿透判否（漏报）。开发者与注释均假定除 ~/ 外的 ~ 变体归入保守命中，但实现中 UNRESOLVABLE 已剥离 ~，导致 ~user/ 进入相对路径分支被全盘放行，击穿通道③（运行目录）的检测。

**依据**：在 src/trivium/adapters/base.ts:285 中 UNRESOLVABLE = /[$`*?]/ 不含 ~；expandTilde(token)（base.ts:288-292）对 ~user/ 原样返回 token；在 hitsAt（base.ts:615-648）中，~user/... 既不被 UNRESOLVABLE 拦截，又因为 nodePath.isAbsolute 为 false、resolvesIntoDeny 解析为项目相对路径判否、prefixIsOnlyDotHops 因前缀含有 ~user 段判否，最终 hitsAt 静默返回 false，导致如 cat ~username/.trivium/runs/<runId> 完全漏检。

**建议**：在 hitsAt 或 expandTilde 处理链路中明确将无法静态解析的 ~user/ 形态（以 ~ 开头但非 ~/ 或 ~）显式归入保守命中（返回 true），并在 peer-leak-command.test.ts 中添加针对 ~user/... 的正例断言。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/README.md:24-25` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：doc/02_design/README.md 演进历程摘要段落遗漏 v1.3.8 变更说明，再次出现「宣称补齐了变更条目，实则仅升级了标题版本号字面量」的收口不全。

**依据**：查看 doc/02_design/README.md:24-25，第 24 行链接已升为 v1.3.8，但第 25 行正文演进历程摘要依然截止到「**v1.3.7 按 M6 四步回填事实表**...」，未追加 v1.3.8 措施 b 落地与承诺面对账的摘要；与 .reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r2-response-claude.md:261 修复清单第 10 项所声称的「补变更条目」不符。

**建议**：在 doc/02_design/README.md:25 的演进历程段落末尾补充 v1.3.8 的演进摘要（M8 第 1 步措施 b 落地与 F/B 闭集对账）。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:403` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：hitsAt 中 before !== '.' 放行条件破坏了路径段边界，会将文件名自带句点（如 ..env、..reviews）误当成路径层级前缀放行给 prefixIsOnlyDotHops，引发非预期误报。

**依据**：src/trivium/adapters/base.ts:403（diff 行 603）写有 if (before !== '/' && before !== '.') return false;。对于形如 cat ..env 或 cat ..reviews/a.md 的命令，若 deny 包含 .env，cmd.indexOf('.env') 命中时 before 为前一个点 .，进入 F-6 逻辑得到 prefix 为 .，prefixIsOnlyDotHops 过滤点后返回 true，导致 ..env 被误判命中。在 Unix 中目录分隔符仅为 /，句点不是路径分隔符。

**建议**：收窄 F-6 的前置判断边界，仅允许真正的路径分隔符 / 进入回退层级回溯，避免将文件名中的句点当作路径回退。

## 认为正确的部分

- 措施 b（命令文本字面扫描）的闭集（F-1～F-8 与 B-1～B-4）通过 known-forms-parity 实现了设计文档、实现 docblock 与测试用例名的三方 grep 级强对账，杜绝了清单单侧漂移的漏洞。
- known-forms-parity 对设计侧章节截取增加了非空下限断言（>=5 和 >=4），有效防止了两个空集恒相等的构造性误绿。
- prefixIsOnlyDotHops 在判段前先做 nodePath.normalize，正确修正了 sub/../../<rel> 等树内往返路径被误识别为实体目录段的缺陷。
- zcode 侧的 bashStillDenied 增加了等号边界判断（=Bash），消除了长选项单测侥幸通过的隐患，并移除了孤立注释。
- run.v2 与 types.ts 中 peer_leak_via_command 按审核者逐侧记录（Partial<Record<CriticId, ...>>），结构与三态语义（缺失=旧留痕、某侧缺键=未扫、hit:false=扫过未命中）清晰自洽。

## 未覆盖范围（本侧盲区）

- 未在真实 macOS 临时目录中实际执行完整 trivium 全流程端到端运行（仅通过代码审查与现有单元测试对账逻辑核验）。
- 未覆盖除 codex/zcode/agy 外其他尚未规划的第三方 agent 环境变量展开特性。

## 实际查阅的项目文件

- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/README.md`
- `doc/08_project/BACKLOG.md`
- `package.json`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/guard.ts`
- `test/fixtures/stub-agent-kit/pieces/stub-agent.ts.txt`
- `test/unit/known-forms-parity.test.ts`
- `test/unit/peer-leak-command.test.ts`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r2-response-claude.md`
- `.reviews/M8-Codex审核者接入/code/_meta/changes-20260915T032600Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":23,"grep":8,"glob":0,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
