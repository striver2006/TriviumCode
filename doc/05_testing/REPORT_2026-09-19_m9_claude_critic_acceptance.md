# M9 第 6 步 · Claude Code 审核者验收实跑报告（第 1 轮）

- **日期**：2026-09-19
- **验收对象**：M9 完成判据「真实审查一次，`consulted` 交叉核对通过」（设计 §16.1 M9 行）
- **判据版本**：`.reviews/M9-验收实跑/plan/2026-09-19-M9-验收实跑-revised-claude.md` §2.2（计划双审 13 条：接受 12、驳回 1）
- **执行者**：Claude Code 会话（名义 Driver 为 codex，见 §2）｜**发起者**：Chen Zhenbo（`/dual-approve … --reason 修改计划文档后，执行`）
- **证据目录**：`doc/05_testing/evidence/m9-acceptance-20260919/`（夹具是会话级 scratchpad，留痕已收进仓库）

---

## 0. 结论

**M9 完成判据本轮未达成。** 两次尝试：第 1 跑零 API 调用即被 CLI 拒绝；第 2 跑 525s 跑通、结构化输出与证据档全过，
但 J5（`consulted` 交叉核对）失败，且 `readonly_breach: true` 是一处误判。按计划 §六的刹车，不做第 3 次尝试。

本轮**拿到了三条准入面没测出的事实**，每条都有留痕与修法：

| # | 事实 | 性质 | 处置 |
| :--- | :--- | :--- | :--- |
| 1 | `review.v1.json` 的 `$schema: draft/2020-12` 头被 claude 2.1.277 拒绝 | 适配器缺陷；探针从未喂真实契约文件 | 适配器已剥该键（`stripMetaSchemaRef`，用例 A26～A28）；探针盲区登记 **EV-74** |
| 2 | `--json-schema` 下 CLI 注入的 `StructuredOutput` 被算成写事件，整轮 `readonly_breach: true` | 适配器缺陷；`gate --check` 未因它拦下 | 适配器已豁免该名字（`CLAUDE_OUTPUT_TOOLS`，用例 A29/A30）；登记 **EV-75** |
| 3 | 审查员自报 `consulted` 15 项，核对面只看得见 10 项（另 5 项只在目录级 Grep 结果里出现） | 判据口径与 BRIEF 措辞不一致，不是模型撒谎 | 不临场放宽（计划双审 AGY-02 驳回）；三条出路登记 **EV-76**，由设计裁定 |

零成本判据全部通过：EV-71 写事件翻转、J8 自审不变量、EV-66 真实会话面负例。EV-71 结案，残量转 EV-77。

---

## 1. 载体与被审对象

### 1.1 载体：① 名义 Driver（EV-71 拍板）

仍在本 Claude Code 会话里操作夹具，`--driver codex` 只作旗标声明。② 真载体需要 M10 范围栏的四家入口资产，今天一件都没有；
而 M10 的前置 ③ 正是 EV-71 自己，选 ② 是循环等待（计划双审三侧一致）。

代价如实：「codex 在执笔」是声明不是事实。因此独立性不从 `--driver` 推出，从被审代码的产生凭据来（§1.2）。

### 1.2 被审对象：历史提交 `3812f4c` 的 `src/` + `test/` 差异

| 项 | 值 |
| :--- | :--- |
| sha | `3812f4cf493a82d2a7c3386e6a721682f157ed49` |
| author / date | `BobChen <k_bo@163.com>` / `2026-09-16 00:22:24 +0800`（早于本会话 3 天） |
| parent | `a8c75954c38941c20259f6bc4c1127c0cffeed83` |
| subject | `fix(guard,preflight): 修掉代码双审查出的只读失守判定缺陷，并回填设计升 v1.3.10（M8 第 3 步复审修复）` |
| 取用范围 | `git diff a8c7595 3812f4c -- src test`：10 文件，+460 / −61（夹具 `git diff --stat HEAD` 同值） |

**J4 口径**（计划双审 CODEX-01，三侧一致）：被审对象事实上不由本会话产生、凭据可核——**达成**。
**达成边界**：审核者与执笔者同属 claude 家族（本仓自 M0 起只有一个 Driver）；隔离靠上下文隔离
（`--restricted`、项目记忆阻断、独立子进程），与 glm 审 claude 代码在性质上同构。

### 1.3 夹具与构建凭据

- 夹具由 `evidence/…/build-fixture.sh` 重建：导出父树（不含 `.reviews/` 与 `.trivium/`）→ `git init` → `trivium init` →
  `review.timeout_s.code` 1200→7200 → `git apply` 差异到工作树。
- 编排器构建身份（全局 bundle `~/.claude/skills/dual-critic/scripts/trivium.cjs` 的 sha256）：
  - 第 1 跑：`e1682c6be0a347a45eccb784eb0ac41e034954d02025e4f3ee6f0ca6549d707e`，由 `3617077ee78c7a2f97347bc7f5256856d6a588c8` **干净树**构建；
  - 第 2 跑：`198fc87c96d0e3e4db2df0f4e0fb924af0f493c7dc0d692dcd2b87e5f5b647d1`，由 3617077 + **当时未提交**的 `$schema` 剥离改动构建——
    不对应任何提交；本轮改动合入后可由该 commit 重建（`npm run build`），但哈希不会与 198fc87 相同（后续又加了 `StructuredOutput` 豁免等）。
  - `trivium --version` 是常量 `0.1.0`，不作构建身份（代码双审 CODEX-06 / CODEX-07）。
- 夹具的 `.trivium/bin/trivium` 是 exec 上述全局文件的 wrapper。
- 夹具侧准入：`doctor --only claude` 无 blocker（探活 $0.0095）；`preflight --stage code --critics claude --driver codex` 7 项全过；
  `topic resolve` 输出 `driver: codex`、`critics: ["claude"]`。

---

## 2. 两次尝试

| | 第 1 跑 `20260919T120018Z` | 第 2 跑 `20260919T120643Z` |
| :--- | :--- | :--- |
| 结果 | `failed`，两次尝试（含编排器瞬时重试）同一错误，`duration_s` 1 | `success`，`duration_s` 524.974 |
| 错误 | `--json-schema is not a valid JSON Schema: no schema with key or ref "https://json-schema.org/draft/2020-12/schema"` | — |
| `usage.cost_usd` | 未回读到（零 API 调用） | **1.5848** |
| `model_effective` / source | 未回读到 / `unverified` | `claude-sonnet-5` / `envelope` |
| `tool_calls` | — | read 10 · grep 9 · glob 0 · `project_reads` 14 |
| `evidence_ok` | false | **true** |
| `parse_fallback` | — | **false** |
| `consulted_unverified` | — | **true**（J5 失败，§3.3） |
| `readonly_breach` | — | **true（误判，§3.2）** |
| `peer_deny_applied` / rules / skipped | — | **true** / 18 / 0 |
| `heterogeneous` / `override_reason` | — | `false` / `档位（缺省）的默认模型落在 Claude 系`（EV-62 已登记的语义边界：Driver 是 codex，实际异构） |
| 审查结论 | — | `request-changes`，2 条（major 1 · minor 1），均有行号依据 |

第 2 跑之间做的唯一改动是 §3.1 的 `$schema` 剥离（tests 1476 / pass 1474 / fail 0 / skip 2 后重建、`install:local`）。

---

## 3. 三条事实

### 3.1 `$schema` 头被拒（EV-74）

最小复现（haiku，`--max-budget-usd 0.05`，三次接受的调用各约 $0.078）：

| 喂的 schema | 结果 |
| :--- | :--- |
| `review.v1.json` 原样（`$schema: …draft/2020-12/schema`） | 拒：`no schema with key or ref …` |
| 去 `$schema`（保留 `$id`） | 接受 |
| 去 `$schema` 与 `$id` | 接受 |
| `$schema` 改 draft-07 | 接受（**只是 CLI 侧**；对契约文件不可用：本仓 `parse.ts` / `schemas.ts` 的 Ajv2020 对 draft-07 头当场抛 `no schema with key or ref`，已实跑，代码双审 CODEX-04） |

探针的 `json_schema_ok` 用的是不带 `$schema` 的迷你 schema，所以准入三步的 `true` 都是真的，
但答的是「旗标收内联 JSON」，不是「收本仓的契约文件」。修法在适配器层只剥 `$schema` 一键；契约文件不改（agy 侧传路径且接受 2020-12）。

### 3.2 `StructuredOutput` 被算成写事件（EV-75）

第 2 跑 `system/init.tools` = `Glob, Grep, Read, StructuredOutput`。模型调 `StructuredOutput` 5 次交付 JSON
（前 4 次形态不对被 CLI 打回，第 5 次成功），全部落进 `write_events`，`guard.readonly_breach: true`、`breached_files` 五条全是 `StructuredOutput(...)`。
它不在 `--tools` 白名单里、也不落盘。修法：`CLAUDE_OUTPUT_TOOLS = {StructuredOutput}` 在写事件判据里豁免，只豁免这一个名字（用例 A30 守住「真写工具照旧算」）。

两处连带：`readonly_breach` 落盘于 run.json 的 guard 段，并在 `summarizeRun`、`report.ts` 的 guardFlags、console 告警三处渲染，**但当时没有任何失败面或作废判定消费它**——`gate --check` 照样 `ok: true`（代码双审 GLM-04 改准措辞；CODEX-02 ≡ AGY-02 ≡ GLM-02 指出真失守同样不拦，本轮改动已把它接进 `gate --check` 失败面）；探针的 schema 臂与工具面臂分开跑、从未见过这个工具名，且探针的 `judgeToolSurface` 当时不认输出通道（同批已改为从适配器取同一份常量）。

**该修复连同代码双审第 1 轮的 14 条接受项已在工作树（tests 1483 / pass 1481 / fail 0 / skip 2），并已重建、装到全局副本；claude 侧未再实跑（第 3 次尝试待用户决定）。**

### 3.3 `consulted` 交叉核对 60%（EV-76）

审查员自报 15 项。按 `effectiveReadPaths` 口径（`tool_use` 入参里的路径）：`Read` 打开 9 项、文件级 `Grep` 1 项（`registry.ts`），
另 5 项——`test/unit/preflight.test.ts`、`test/unit/codex-write-verbs.test.ts`、`doc/03_api/PROTOCOL_dual_critic_relay.md`、
`doc/05_testing/CASE_manual_acceptance.md`、`doc/02_design/LLD_orchestrator.md`——只在目录级 `Grep(path=test)` / `Grep(path=doc)` 的结果里出现。
模型确实据此写了有据的意见（CLAUDE-01 引了 `doc/03_api/…:249`、`doc/05_testing/…:273` 的行号），但轨迹里只有目录级的 `tool_use`，
编排器提不出它命中了哪些文件。BRIEF 的「实际读过」与判据的「入参里出现过」两个口径不一致。

按计划 §五与 AGY-02 的驳回，**不放宽阈值、不重跑**。出路见 EV-76：解析 Grep 的 `tool_result` / 收窄 BRIEF 定义 / 维持现状如实登记。

---

## 4. 判据逐格

| 判据 | 落点层 | 结果 | 样本量 / 佐证 |
| :--- | :--- | :--- | :--- |
| J4 schema 合规 | front-matter `parse_fallback: false`；`gate --check-artifacts` 通过 | ✅ | 单次 |
| **J5** `consulted` 核对 | front-matter `consulted_unverified: true` | ❌ **未达成** | 单次；§3.3 |
| J6 `denied_tool_in_trace` | 本轮未诱导写操作，`permissionDenials: []`、无被拒 `tool_use` | 观察：null，不下结论 | 能力背书在第 1 步 P-b |
| 附-1a 工具调用合计 ≥ 5 | `tool_calls` 19 | ✅ | 单次 |
| 附-1b `project_reads` ≥ 3 | 14 | ✅ | 单次 |
| 附-1c `evidence_ok` | true | ✅ | 派生 |
| 附-2a `model_effective` | `claude-sonnet-5` | ✅ | 档位钉死 |
| 附-2b `model_effective_source` | `envelope`（trace 有 `init.model`） | ✅ | 单次 |
| 附-3 `peer_deny_applied` | true；探针格 `file_shape_verified: true`、`coverage_complete: false` | 照录 | 静态 |
| 附-4 `heterogeneous` | false（语义不准，EV-62） | 照录 | 确定性 |
| 附-5 尺度 | 525s / $1.5848（第 1 跑 1s / 未回读） | 照录 | **第一份真实尺度数据** |
| **EV-71 刻 B** | 留痕在场、driver=codex：`-claude.md` 退 2、`-response-codex.md` 退 0、`-gemini.md` 退 2；拦截文案「本轮 Driver 判定为「codex」（取自该阶段最近一份运行留痕）」 | ✅ | 确定性 |
| 刻 A（对照） | 无留痕：`-claude.md` 退 0、`-gemini.md` 退 2、`-response-codex.md` 退 2；文案「该阶段尚无运行留痕，按缺省 Driver 判定」 | ✅ 与 EV-72 记载一致 | 确定性 |
| J8 自审不变量 | `preflight --stage code --critics claude`（driver 缺省）退 **64**，文案「当前可用：codex \| gemini \| glm」 | ✅ | 确定性 |
| EV-66 真实会话面 | 裁决件 `role` 改 claude → `gate --check` 判 `bad_front_matter`（「当轮 Driver 是 codex」）；改回 codex → `ok: true`；三次 `--check` 输出见 `evidence/…/hook-and-gate-outputs.md` §4 | ✅ | 确定性 |
| 额外 | `readonly_breach: true` 为误判（§3.2） | ⚠️ | — |

裁决件 `disposition-response-codex.md`（名义 Driver 代笔）对 CLAUDE-01/02 均接受，只作闭环用件，不指向本仓现状。

刻 A / 刻 B / J8 / EV-66 四项的原始输出（喂入的 JSON、退出码、拦截文案、三次 `gate --check` 输出）照录在
`evidence/m9-acceptance-20260919/hook-and-gate-outputs.md`（代码双审 CODEX-06 ≡ GLM-05：此前只有本表的转述）。
两份 worker 日志已改名 `.log.txt` 入库——原 `.log` 后缀被 `.gitignore` 命中，「留痕已收进仓库」对它们当时不成立。

---

## 5. 达成边界

1. **载体**：名义 Driver。刻 B 经 `gate hook-pre-write` 直喂 `PreToolUse` JSON 完成，与 matcher `exec` 的是同一二进制、同一子命令；
   未覆盖 Claude Code 的 matcher 分发、`sh -c` 存在性守卫（尤其「wrapper 缺失而 config 在场 → 退 2」支）、`CLAUDE_PROJECT_DIR` 解析三层
   ——前者由本仓日常运行、后两者由 `test/contract/hook-guard.test.ts` 守。真载体下 Hook 生效性未验（EV-77）。
2. **独立性**：不同会话、早于本会话、凭据可核；同 claude 家族。
3. **J6**：本轮未诱导写操作，`null` 不是防线失效。
4. **成本**：本轮 claude 侧合计约 $1.83（第 2 跑 1.58 + 复现 0.24 + 探活 0.01），与 Driver 共用账号。`review` 路径无 `--max-budget-usd`，超时 7200s 是唯一硬闸。
5. **第 2 跑的 `readonly_breach` 是误判**，同一跑的其它判据不受它影响。**时限声明**：§4 的 EV-66 三格与证据文件 §4 的三次 `gate --check` 输出取自**接线前**的构建（bundle `198fc87…`）；本轮代码双审后 `readonly_breach` 已进 `gate --check` 失败面，同一份夹具留痕（`guard.readonly_breach: true`）在新构建上会判 `ok: false`——那三格要复现，需用干净留痕或修复后的适配器重跑（第 2 轮 CODEX-F01-⑥）。
6. **本轮修复未经 claude 侧实跑**：`StructuredOutput` 豁免、探针工具面同源、闸门接线都只有用例背书；第 3 次尝试是它们第一次上真实链路。
7. **EV-76 未裁定前，第 3 次尝试大概率同样在 J5 失败**：模型用目录级 Grep 是正常行为，不是本轮偶然。

---

## 6. 回补与登记

- 设计 §16.1 M9 行状态位与「第 6 步」段；M10 行前置 ③ 注记；§3.7 `json_schema_ok` 行口径。
- BACKLOG：EV-71 关闭；EV-62 触发条件命中注记；新增 EV-74 / EV-75 / EV-76 / EV-77。
- 代码（验收当场）：`adapters/claude.ts` `stripMetaSchemaRef`、`adapters/claude-trace.ts` `CLAUDE_OUTPUT_TOOLS`、用例 A26～A30。
- 代码（代码双审第 1 轮，15 条：接受 14、驳回 1，留痕 `.reviews/M9-验收实跑/code/`）：
  `buildClaudeArgs` 成为送 CLI 的 schema 唯一出口、探针结构化输出臂经同一变换（CODEX-03）；
  `judgeToolSurface` 从 `CLAUDE_OUTPUT_TOOLS` 取输出通道、单列 `outputChannel`（CODEX-01 ≡ AGY-01 ≡ GLM-01，用例 A6c/A6d）；
  `readonly_breach` 经 `loadRoundReviews` 带出、`checkAdjudication` 判 failure（CODEX-02 ≡ AGY-02 ≡ GLM-02，`gate.test` 正反例）；
  契约金丝雀 A31 + `review.v1.json` description（CODEX-04 ≡ GLM-03）；A28b；测试路径改 `ASSET_ROOT`（CODEX-05）；
  证据目录补 `hook-and-gate-outputs.md`、日志改名入库（CODEX-06 ≡ GLM-05）；本报告与 BACKLOG 措辞改准（GLM-04、CODEX-07）。
- 代码（代码双审第 2 轮，11 条全部接受；codex 侧解析降级为 1 个单元，EV-56 第 3 次复现）：
  A31 补正向锚点并在真实产物上注入自证、数组位自证（CODEX-F01-③ ≡ AGY-01；GLM-03）；
  A6e 源码字面腿 + A29 遍历常量（CODEX-F01-④ ≡ AGY-02 ≡ GLM-01）；
  fault-injection 的 write_breach 续到真实 `gate --check`（GLM-02）；`readonly_breach` 文案与判据对齐、「旧留痕无字段」不可达的注释与用例改准（CODEX-F01-①②）；
  A31 论域单向的边界写进 description 与注释（CODEX-F01-⑤）；本报告 §5.5 与证据文件加时限声明（CODEX-F01-⑥）。
  全量 1484 tests / 1482 pass / 0 fail / 2 skip。
- 完整纪律 6 回溯（§21 版本台账、§24 台账、PRD AC 状态）仍留第 7 步（EV-57）。

## 7. 下一步（由用户定）

1. 代码双审本轮改动（两处适配器修复 + 用例 + 文档回补），审批后提交；
2. 裁定 EV-76 的出路；
3. 决定是否发起第 6 步第 2 轮（第 3 次尝试）：重建安装后按同一剧本跑，预计 9 分钟 / $1.6。
