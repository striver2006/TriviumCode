# M9 第 6 步 · Claude Code 审核者验收实跑报告（第 2 轮 · 第 3 次尝试）

- **日期**：2026-09-20（run 时间戳 `20260919T162144Z` 为 UTC）
- **验收对象**：M9 完成判据「真实审查一次，`consulted` 交叉核对通过」（设计 §16.1 M9 行）
- **判据版本**：与第 1 轮相同——`.reviews/M9-验收实跑/plan/2026-09-19-M9-验收实跑-revised-claude.md` §2.2；本轮不改判据、不改阈值
- **执行者**：Claude Code 会话（名义 Driver 为 codex）｜**发起者**：Chen Zhenbo（会话内明确指令「发起 M9 第 6 步第 2 轮验收（第 3 次尝试）」）
- **前置**：第 1 轮（`REPORT_2026-09-19_m9_claude_critic_acceptance.md`）挖出的三条事实已修并合入——`$schema` 剥离（EV-74 适配器侧）、`StructuredOutput` 豁免与闸门接线（EV-75 已做部分）、Grep `content` 命中计入读取面（EV-76 出路 ①，用户裁定）
- **证据目录**：`doc/05_testing/evidence/m9-acceptance-20260920/`

---

## 0. 结论

**M9 完成判据达成。** 单次尝试跑通：真实审查一次（429s / $1.25，`claude-sonnet-5`），`consulted` 9 项按轨迹核对 **9/9**，
front-matter 不含 `consulted_unverified`，`gate --check` 无 consulted 告警行。第 1 轮的两处适配器修复第一次在真实链路上成立：
`readonly_breach: false`（`StructuredOutput` 调用 2 次未被算成写），闸门接线在 `failures: []` 上可见。零成本判据（刻 A / 刻 B、J8、EV-66 负例）全部复现。

两条要如实说的边界：

1. **本轮样本按修前口径也会通过 J5**——9 项里 Read 覆盖 7、文件级 Grep 独占 2，`content` 命中没有独占贡献。出路 ① 的作用由第 1 轮第 2 跑的回放（10/15 → 15/15，`grep-hits.test.ts` T7）背书，不由本轮背书。
2. **审查结论 `request-changes`，2 条 blocker 在本仓 HEAD 上均复现**（§4）。被审对象 `3812f4c` 当初经三侧代码双审合入，两处都漏过。登记 **EV-79**，不在本步修；另一条告警噪声登记 **EV-80**。

---

## 1. 载体、被审对象与构建身份

| 项 | 值 | 与第 1 轮的关系 |
| :--- | :--- | :--- |
| 载体 | ① 名义 Driver（本会话操作夹具，`--driver codex` 只作声明） | 同 |
| 被审对象 | `git diff a8c7595 3812f4c -- src test`，10 文件 +460/−61；`subject_sha256 a3301d7d…` | 同值（第 1 轮第 2 跑同一哈希） |
| 夹具 | `build-fixture.sh` 重建，与入库脚本 `cmp` 相同；夹具 HEAD `654877b0` | 脚本同，夹具提交哈希因时间戳不同 |
| 编排器构建身份 | 全局 bundle sha256 `c50d787863bebd334e8d4cc0acd104e1957ed7a0953c95fa0149042d8cdc2f38`；由本仓 `a75ec43817c6116affa0ff7729b3a04e3119a303` **干净树**重建后逐字节相同 | 第 1 轮第 2 跑的 `198fc87…` 不对应任何提交；本轮对应一个提交 |
| 夹具侧准入 | `doctor --only claude` 无 blocker（探活 $0.0096）；`preflight --stage code --critics claude --driver codex` 7/7；`topic resolve` 输出 `driver: codex`、`critics: ["claude"]` | 同 |
| 焦点 | 「这是 M9 第 6 步验收：被审对象是历史提交 3812f4c 的 src 与 test 差异。重点看 adapters/base.ts 的只读失守判定改动是否仍有绕过形态，以及 preflight.ts 的泛化是否漏掉了某一侧」 | 逐字同 |

J4（独立性）：同第 1 轮，达成；「同 claude 家族」仍是达成边界。

---

## 2. 实跑

| | run `20260919T162144Z` |
| :--- | :--- |
| 结果 | `success`，第 1 次尝试即成，`duration_s` 429.183 |
| `usage.cost_usd` | **1.2452**（第 1 轮第 2 跑 1.5848） |
| `model_effective` / source | `claude-sonnet-5` / `envelope` |
| `tool_calls` | read 11 · grep 10 · glob 0 · `project_reads` 11 |
| `evidence_ok` / `parse_fallback` | **true** / **false** |
| `consulted_unverified` | **不在 front-matter 中**（J5 达成） |
| `readonly_breach` / `breached_files` | **false** / `[]` |
| `peer_deny_applied` / rules / skipped | true / 18 / 0；`peer_leak_via_path` / `via_command` 均 `hit: false` |
| `drift` | false |
| `heterogeneous` / `override_reason` | false / 「档位（缺省）的默认模型落在 Claude 系」（EV-62 语义边界不变） |
| `init.tools` | `Glob, Grep, Read, StructuredOutput` |
| `StructuredOutput` | 调用 2 次：第 1 次把整份 JSON 包进 `input` 键被 CLI schema 打回（`toolErrors` 1 条），第 2 次成功 |
| 审查结论 | `request-changes`，2 条（blocker 2），均有行号依据 |
| 编排器结构提示 | 「evidence 引用但未列入 consulted：src/a.ts, src/gone.ts, test/unit/codex-write-verbs.test.ts」（告警档，§4.2） |

`--wait` 三次：3m13s（73）、6m19s（73）、7m11s（0）。`max_waits` 82 × 180s ≥ 7200s 核对通过。

---

## 3. J5 逐项溯源（`consulted-trace-r2.out.txt`）

| consulted | 匹配来源 |
| :--- | :--- |
| `AGENTS.md` | Read |
| `src/trivium/adapters/base.ts` | Read；文件级 Grep |
| `src/trivium/preflight.ts` | Read；文件级 Grep；Grep content 命中 |
| `src/trivium/agents/registry.ts` | Read |
| `src/trivium/types.ts` | 文件级 Grep；Grep content 命中 |
| `src/trivium/review.ts` | Read；Grep content 命中 |
| `src/trivium/adapters/zcode.ts` | Read |
| `src/trivium/guard.ts` | Read；文件级 Grep |
| `src/trivium/adapters/codex.ts` | 文件级 Grep |

9/9 = 100%（阈值 80%）。Read 独占 5、Read + 其它 2、文件级 Grep 独占 2（`types.ts` 同时被 content 命中）、**content 命中独占 0**。

Grep 调用面：10 次，9 次文件级、1 次目录级（`path=src`，content 模式，21 行 → 8 个文件进 `hits`）；1 次**未指定 `output_mode`**，CLI 缺省 `files_with_matches`，返回 `Found 1 file` + 路径行，解析器落 `listed`（EV-78 注记）。
`trace.json.grep`：hits 8、listed 1、resultLines 86。与第 1 轮第 2 跑（9 次全目录级）相比，本轮模型的搜索习惯明显不同——**目录级 Grep 少，是本轮 J5 按旧口径也能过的原因**；BRIEF 第 8 段新加的「把 path 限定在被审对象涉及的目录」引导句是否起了作用，单样本说不清。
本轮没有对端件可撞（单侧运行），「根递归 Grep 撞对端件 → 该侧作废」的风险未被触发、也未被证伪。

---

## 4. 审查结论与两条 blocker 在 HEAD 上的复现

### 4.1 两条 blocker（`review-rendered-claude.md`）

| 编号 | 主张 | HEAD `a75ec43` 复现（`verify-claude-findings-on-head.out.txt`） |
| :--- | :--- | :--- |
| CLAUDE-01 | `--force` 并入幂等判据后，`rm -r --force <已存在目录>` 从 writes 降进 suspected，不再驱动 `readonlyBreach` | `rm -r --force src/existing-dir` → `writes=[] suspected=["rm 的幂等形态…"]`；对照 `rm -r src/existing-dir` → writes。**复现。** 附注：`rm -rf`（短旗标）在修前已是同一形态，长旗标是 `3812f4c` 新纳入的 |
| CLAUDE-02 | `&>` / `&>>` 组合重定向：`SEGMENT_SPLIT_RE` 护住了 `&` 不作分隔符，但 `REDIRECT_RE = /^[0-9]*>>?/` 认不出它，`echo secret &> src/leak.txt` 既不进 writes 也不进 suspected | `echo secret &> src/leak.txt` → `writes=[] suspected=[]`；`&>>` 同；对照 `echo x > src/a.ts` → writes。**复现，彻底静默。** |

被审对象 `3812f4c` 是 M8 第 3 步复审修复，当初经 codex / gemini / glm 三侧代码双审合入，两处都没被指出。这是 claude 审核者第一次在真实链路上给出三家没给的结论——**单样本，不据此下「更强」的结论**。
修法方向与用例要求登记在 **EV-79**（待双审，不在本步修）。裁决件 `disposition-response-codex.md` 两条均接受，只作闭环用件。

### 4.2 结构提示的成因（EV-80）

「evidence 引用但未列入 consulted」三项：`src/a.ts`、`src/gone.ts` 是用例里的字面路径（`echo x > src/a.ts`、`rm --force src/gone.ts`，项目里不存在）；`test/unit/codex-write-verbs.test.ts` 在补丁内，审查员经 diff 读到而没打开原文件。三项都不是「引用了没查阅的文件」。只进告警档，不影响 `gate --check`。

---

## 5. 判据逐格

| 判据 | 落点层 | 结果 | 样本量 / 佐证 |
| :--- | :--- | :--- | :--- |
| J4 schema 合规 | front-matter `parse_fallback: false`；`gate --check-artifacts` 通过 | ✅ | 单次 |
| **J5** `consulted` 核对 | front-matter 不含 `consulted_unverified`；`gate --check` 无告警行 | ✅ **达成**（9/9） | 单次；§3；按旧口径亦过 |
| J6 `denied_tool_in_trace` | `permissionDenials` 空、无被拒 `tool_use` | 观察：null，不下结论 | 本轮未诱导写操作 |
| 附-1a 工具调用合计 ≥ 5 | 21 | ✅ | 单次 |
| 附-1b `project_reads` ≥ 3 | 11 | ✅ | 单次 |
| 附-1c `evidence_ok` | true | ✅ | 派生 |
| 附-2a `model_effective` | `claude-sonnet-5` | ✅ | 档位钉死 |
| 附-2b `model_effective_source` | `envelope` | ✅ | 单次 |
| 附-3 `peer_deny_applied` | true；`file_shape_verified: true`、`coverage_complete: false` | 照录 | 静态 |
| 附-4 `heterogeneous` | false（语义不准，EV-62） | 照录 | 确定性 |
| 附-5 尺度 | 429s / $1.2452（+ 探活 $0.0096） | 照录 | 第二份真实尺度数据 |
| **EV-71 刻 B** | 留痕在场、driver=codex：`-claude.md` 退 2、`-response-codex.md` 退 0、`-gemini.md` 退 2；文案「取自该阶段最近一份运行留痕」 | ✅ | 确定性 |
| 刻 A（对照） | 无留痕：`-claude.md` 退 0、`-gemini.md` 退 2、`-response-codex.md` 退 2；文案「该阶段尚无运行留痕，按缺省 Driver 判定」 | ✅ | 确定性 |
| J8 自审不变量 | `preflight --stage code --critics claude`（driver 缺省）退 **64** | ✅ | 确定性 |
| EV-66 真实会话面 | `role: claude` → `bad_front_matter`；改回 → `ok: true`；三次输出见 `hook-and-gate-outputs.md` §4 | ✅ | 确定性 |
| **EV-75 真实链路** | `init.tools` 含 `StructuredOutput`、调用 2 次、`readonly_breach: false`、`gate --check` `failures: []` | ✅ 第一次上真实链路 | 单次 |

原始输出照录在 `evidence/m9-acceptance-20260920/hook-and-gate-outputs.md`。

---

## 6. 达成边界

1. **载体**：名义 Driver；刻 B 经 `gate hook-pre-write` 直喂完成，三层未覆盖同第 1 轮（EV-77）。
2. **独立性**：不同会话、早于本会话 4 天、凭据可核；同 claude 家族。
3. **J5 的口径**：本轮样本 content 命中无独占贡献；出路 ① 的效果只由回放用例背书。
4. **J6**：本轮未诱导写操作，`null` 不是防线失效。
5. **成本**：本轮 claude 侧合计约 $1.26（审查 1.2452 + 探活 0.0096），与 Driver 共用账号。
6. **单侧运行**：`joint_check` 跳过（有效侧 1 家），没有交叉验证；两条 blocker 的「三家漏过」是事后对照，不是同轮对照。
7. **对端件风险未触发**：本轮无对端件，「根递归 Grep 撞对端件即作废」的规则没有在真实链路上被触发。

---

## 7. 回补与登记

- 设计 §16.1 M9 行：状态位改「第 1～6 步已完成、第 7 步待开工」，末段增「第 6 步第 2 轮」。
- BACKLOG：EV-75、EV-78 加 2026-09-20 注记；新增 **EV-79**（`classifyWriteCommands` 两处缺口，待双审）、**EV-80**（`checkReviewIntegrity` 告警噪声）。
- 第 1 轮报告头部加指向本文的后续说明。
- 证据目录文件：`run-*.json`、`review-claude-*.json`、`brief-claude-*.md`、`review-rendered-claude.md`、`disposition-response-codex.md`、`trace-*.json`、`worker-*.log.txt`、`fixture-config.local.yaml`、`hook-and-gate-outputs.md`、`grep-tool-results-*.jsonl`（截取，根改写 `<ROOT>`）、`consulted-trace-r2.py` / `.out.txt`、`dump-grep-r2.py` / `.out.txt`、`verify-claude-findings-on-head.mjs` / `.out.txt`、`build-fixture.same-as-r1.txt`。
- 完整纪律 6 回溯（§21 版本台账、§24 台账、PRD AC 状态）仍留第 7 步（EV-57）。

## 8. 下一步（由用户定）

1. M9 第 7 步：纪律 6 回溯（EV-57）——M9 行的版本台账、§24 台账、PRD AC 状态、文档头「M9 第 5～7 步尚未开工」的失实句。
2. EV-79 走计划 / 代码双审后修。
3. EV-74 / EV-78 同批（下次动 `probes/claude.ts`）。
