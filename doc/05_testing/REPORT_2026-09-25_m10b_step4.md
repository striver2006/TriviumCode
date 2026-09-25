# M10b 第 4 步 · 验收（AC-21 子句 ①、EV-77、EV-107、兼容）报告

> **状态**：进行中。
> **上位**：计划 r5 §7（剧本、每轮判据、兼容白名单、EV-107 端到端），r10 §4（glm 轮载体证据、参数保真、尽力拦截观测）替换 r9 §4。
> **日期**：2026-09-25 起　**起点**：`543e0ea`（`main`）；安装副本为 `da6476c` 构建（第 3 步结案后重装，之后只有文档提交）
> **轮次顺序**（用户 2026-09-25 定，照 r5 §7.1 表）：3-1 claude plan（夹具）→ 3-2 claude code（兼容 J3）→ 3-3 gemini plan（名义 Driver）→ 3-4 codex code（真载体 + EV-77）→ 3-5 glm plan（真载体，J4）
> **授权**：3-1～3-3 三轮夹具审查由 Claude 代办发起（用户 2026-09-25）；各轮的篡改核验与审批由用户在终端执行；3-4 / 3-5 由用户在各自载体执笔。

## 0. 开工核对（r5 §3.2）

| 编号 | 前提 | 读数 | 成立 |
| :-- | :--- | :--- | :-- |
| P-a | zcode 真载体在 preflight 层可用 | 第 1 步报告 `REPORT_2026-09-24_m10b_driver_entry_probe.md` §3.3「真载体（P-a）：true」 | ✓ |
| P-b | 第 2 步完成、第 3 步有结论 | 第 2 步 `246d831`（code 审批：`20260925T060626Z` 拒绝「修改后再次审核」→ `20260925T064650Z` 通过「修改后提交」）；第 3 步 `da6476c`（`20260925T134359Z` 通过，无附言） | ✓ |
| P-c | EV-82 的 T1 ∧ T2 | BACKLOG EV-82 = done（2026-09-24，验收 run `20260924T104357Z`；T1 / T2 口径见计划 r7 §3.4） | ✓ |
| — | M9 基线产物（§7.3.2.1，3-2 轮 Hook 退出码对照要用） | `/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/m10b-m9base-oaGPHw` 在场，登记于 `doc/05_testing/evidence/m10b-m9-baseline-20260925/`；半成品 `m10b-m9base-xaexcB` 已由用户在终端删除 | ✓ |

**第 3 步冒烟带来的操作卡约束**（第 3 步报告附录 A）：ZCode 工作区信任要在会话开始之前完成——3-5 glm 轮先打开夹具、点信任，再新建会话。

## 1. 各轮

（逐轮追加。每轮判据按 r5 §7.2：原稿后缀 = Driver；`run.json.driver` = 声明值且 `driver_enabled: true`；`driver_guard_level`；审核者集合不含 Driver；
裁决件 `role` = Driver 且 `gate --check` 通过；plan 轮另核 `task.json.drivers.plan.driver`；`approve` 复核触发（造缺件、造改工件各一次，均应退 2）；运行期实际命令行摘录。）

### 1.1 3-1 · claude · plan · 夹具（台账第 22 行）

- **夹具**：`/private/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/m10b-s4r1-OBOkNy`（`setup.mjs` 以 mkdtemp 建，含一个固定窗口限流器 `src/limiter.ts`）；主题 `限流器重构`。
- **run**：`20260925T153032Z`，`status: success`，耗时 12m31s（codex `qwen3.8-max` 12m29s；gemini `gemini-3.8-flash-high` 2m7s）；两侧 `request-changes`，均结构化、零回退。
- **evidence**：`doc/05_testing/evidence/m10b-step4-r1-claude-plan-20260925/`——`setup.mjs` / `01-setup-readout.json`（搭建）、`hook-probe.mjs` / `02-hook-probe-*.json`（§7.3.1）、
  `extract.mjs` / `03-readout.json`（判据读数）、`fixture-copy/`（原稿、两份审查文档、裁决件、run.json、task.json 原样副本）。

#### 判据（r5 §7.2）

| 判据 | 期望 | 读数 | 成立 |
| :--- | :--- | :--- | :-- |
| 原稿后缀 = Driver | `-claude` | `2026-09-25-限流器重构-claude.md` | ✓ |
| `run.json.driver` / `driver_enabled` | `claude` / `true` | `claude` / `true` | ✓ |
| `run.json.driver_guard_level` | `L1`（claude 登记 L1，夹具 `init` 装了四道 Hook） | `L1` | ✓ |
| 审核者集合不含 Driver | 不含 `claude` | `codex`、`gemini` | ✓ |
| 裁决件 `role` = Driver 且 `gate --check` 通过 | `claude`；退 0 | `2026-09-25-限流器重构-revised-claude.md`，`role: claude`；`gate --check` `ok: true`，16 个编号齐全、`warnings: []` | ✓ |
| `task.json.drivers.plan.driver` | `claude` | `claude`（`claimed_by: unknown-session`：认领由 `setup.mjs` 在会话外执行，无 `--session-id` / `CLAUDE_SESSION_ID`，如实记录） | ✓ |
| `run.json.artifacts[]` 原稿条目 | plan 轮、成功收尾、归档相对路径、列表末尾 | 第 7 条（末尾）`限流器重构/plan/2026-09-25-限流器重构-claude.md` | ✓ |
| `run.json.gate.warnings` | 原稿在归档根内 ⇒ 不写「本轮原稿不在保护集」（`review.ts:1598` 只在原稿位于归档外时写） | 无该字段 | ✓ |
| 停点话术 | L1 档，调用写法 `/dual-approve` | `通过：/dual-approve --topic 限流器重构 --stage plan …`；末句「Hook 会拦下；Hook 超时即放行……」 | ✓ |
| `approve` 复核：造缺件 | 退 2 | 用户在终端把裁决件移出后 `approve`：`[missing_disposition] 找不到第 1 轮的裁决件（应为 …-revised-claude.md）`，「通过前复核未过，本次不放行」，`exit=2`；随后移回 | ✓ |
| `approve` 复核：造改工件 | 退 2 | 用户在终端给 `_meta/review-codex-20260925T153032Z.json` 追加一个空格后 `approve`：「已被改动……记录 85ee155541d0，现为 2f1538002323」，`exit=2`；随后从备份复原（该段用户执行了两遍，两遍均 `exit=2`） | ✓ |
| 审批记录 | `task.json.approvals[]` 一条 | 复原后 `approve` 退 0（亦证复原与登记 sha256 一致）；`approvals[0]`：`at 2026-09-25T15:51:37.296Z`、`stage plan`、`run_id 20260925T153032Z`、`decision approved`、`reason null`、`session_id null`（终端执行，无会话来源）；读数 `03-readout-post-approve.json` | ✓ |

`critics.<id>.heterogeneous`：codex `true`、gemini `true`，`override_reason` 均为 null（Driver 为 claude，两侧厂商均非 Anthropic；EV-107 端到端比对不挂在本轮，按 §7.4 由 glm / codex / gemini 三轮承担）。

#### §7.3.1 两条 plan 阶段形态

探针把 PreToolUse 负载直接喂给夹具的 `gate hook-pre-write` / `hook-pre-commit`（与夹具 `.claude/settings.json` 同一入口，`CLAUDE_PROJECT_DIR` 指夹具）。

| 时点 | 原稿 Write | 原稿 Edit | 裁决件 Write | 业务文件 Write | `git commit` |
| :--- | :-- | :-- | :-- | :-- | :-- |
| a. 送审前（认领后、`--start` 前） | 0 | 0 | 0 | 0 | — |
| b. 审查中 | 0 | 0 | 0 | **2**（「双审进行中」） | — |
| c. 闸门期，原稿未改 | 0 | 0 | 0 | **2**（「闸门未审批」） | 0 |
| d. 闸门期，原稿被改（Edit 追加一行） | 0 | 0 | 0 | 2 | **2** |
| e. 闸门期，原稿复原 | 0 | 0 | 0 | 2 | 0 |

- **形态一「刷新未送审原稿」**：a 时点写原稿放行，随后实际用 Edit 刷新了一次原稿（补一条测试项）再送审。成立。
- **形态二「送审后改原稿被拦」**：成立，拦在**锚②**而非写 Hook——这是 M10 计划 r5 CODEX-01 起的设计口径（原稿成功收尾时登记进 `artifacts[]`，
  之后由 `hook-pre-commit` / `approve` 复核按 sha256 核对；写 Hook 本就不拦原稿）。d 时点拦截文案：
  「已被改动：限流器重构/plan/2026-09-25-限流器重构-claude.md（run 20260925T153032Z 记录 da14cc3927a1，现为 adb0defce32b）」；复原后 e 时点放行，
  记录值与审查文档 `snapshot_hash` 前缀一致。b 时点（收尾登记前）原稿改动不被任何一道拦下，属已知窗口（`hooks.ts` `runningRewriteViolation` 文档块「剩余边界」段）。
- **顺带核出**：b 时点拦截文案「……双审进行中，此时不得修改业务文件，此时不得修改业务文件。」重复一遍——`state.ts:329` 的 `reason` 已以该句结尾，
  `hooks.ts:693` 又拼一次；只在「审查中」一支出现，c 时点「闸门未审批」一支不重复。只影响措辞，已登记 BACKLOG EV-129。

#### 运行期实际命令行（J1）

均在夹具根执行，`TV` = `./.trivium/bin/trivium`（夹具内 wrapper，指向已安装副本 `da6476c` 构建）：

```text
TV topic claim --topic 限流器重构 --stage plan --driver claude --json          # setup.mjs 内
TV preflight --stage plan --driver claude --json
TV topic resolve --stage plan --json -- '重点看滑动窗口日志的正确性（时钟回拨的处理、空队列删除与 sweep 的回收时机），以及 sweep 全表遍历这一取舍是否站得住' --topic 限流器重构 --critics codex,gemini --context src/limiter.ts --driver claude
TV review --start --entry B --stage plan --topic 限流器重构 --driver claude --focus '<同上>' --plan-file <夹具>/.reviews/限流器重构/plan/2026-09-25-限流器重构-claude.md --context src/limiter.ts --critics codex,gemini --json
TV review --wait 20260925T153032Z --timeout 180 --json                          # ×5（4 次退 73，第 5 次退 0）
TV gate --stage plan --topic 限流器重构 --check --json
TV gate --stage plan --topic 限流器重构 --await-approval
```

与渲染产物 `dual-review-plan` 的步骤序一致（认领 → 预检 → 解析 → `--start` → `--wait` 循环 → 裁决 → `--check` → `--await-approval`）；
`--critics` 按契约由 resolve 输出的 `critics` 无条件传入，`subject_path` 传给 `--plan-file`，`task_goal` / `profile` / `models` 为空未传。焦点由 Driver 代拟（用户授权代办发起）。

### 1.2 3-2 · claude · code · 夹具 · 兼容回归 J3（台账第 23、24 行）

- **夹具**：沿用 3-1 夹具（plan 已审批）。`setup.mjs` 把 init 产物与 3-1 归档逐个路径 `git add` 后提交为 `a0da103`，使补丁只含本轮业务改动；
  随后按 3-1 裁决方向改写 `src/limiter.ts`（滑动窗口日志 + 环形缓冲 + 删后重插与队头均摊回收 + 回拨两档 + 只读 `size` + `@deprecated` 别名）并新增 `test/limiter.test.ts`（8 例，`node --test` 全过）。
- **第 1 轮** `20260925T155608Z`：codex `qwen3.8-max` 跑满 1200s 被脚本级超时终止，gemini 4m7s 完成；未带 `--allow-single`，整次 `failed`（`--wait` 退 75），无闸门，
  `task.json.degradations[]` 记一条。**重试前置**（r5 §7.2）：`trivium status` 读数「无未关闭闸门」，槽位已清，无需 `/dual-abandon`；gemini 审查文档与 codex `.failed.json` 留在归档，重跑按 `-r2` 抬升、不覆盖。
  **重跑处置**由用户定：换快档 codex 模型（`--model-codex qwen3.8-flash`，取自配置 `flash` 档；gemini 两档同为 `gemini-3.8-flash-high`，不变）。
- **第 2 轮** `20260925T163113Z`：`success`，3m30s（codex 203s、gemini 208s）；两侧 `request-changes`，结构化、零回退。11 条：9 接受、CODEX-02 驳回（热 key 每次被重插到队尾、坐不上队头，早停只造成有界回收延迟）、CODEX-07 暂缓。
  最重一条 AGY-01 核实成立：钳位分支改写的 `now` 大于真实时间，被传进 `reclaim` 抬高全局 cutoff、误删他 key 并令其重获满额。
- **顺带**：gemini 审查文档与应答件文件名日期为 `2026-09-26`，run_id 为 `20260925T…`——运行途中本地时间跨过零点，文件名取落盘时的本地日期。与 M9 同一口径，不是差异。
- **evidence**：`doc/05_testing/evidence/m10b-step4-r2-claude-code-20260925/`——`setup.mjs` / `01-setup-readout.json`、`hook-parity.mjs` / `02-hook-parity-{a-idle,b-in-review,c-at-gate}.json`、
  `extract.mjs` / `03-readout.json`、`j3-compare.mjs` / `04-j3-compare.json`、`fixture-copy/`。

#### 3-2 判据（r5 §7.2）

| 判据 | 期望 | 读数 | 成立 |
| :--- | :--- | :--- | :-- |
| 原稿后缀 = Driver | code 轮无原稿（命令 C 不认领，被审对象是补丁） | — | 不适用 |
| `run.json.driver` / `driver_enabled` | `claude` / `true` | `claude` / `true`（两轮相同） | ✓ |
| `run.json.driver_guard_level` | `L1` | `L1` | ✓ |
| 审核者集合不含 Driver | 不含 `claude` | `codex`、`gemini` | ✓ |
| 应答件 `role` = Driver 且 `gate --check` 通过 | `claude`；退 0 | `2026-09-26-限流器重构-r2-response-claude.md`，`role: claude`；`gate --check` `ok: true`，11 个编号齐全、`warnings: []` | ✓ |
| 停点话术 | L1 档，`/dual-approve` | `通过：/dual-approve --topic 限流器重构 --stage code …`，末句同 3-1 | ✓ |
| `approve` 复核：造缺件 / 造改工件 / 审批记录 | 退 2 / 退 2 / 一条 | ⏳ 待用户在终端执行 | — |

`critics.<id>.heterogeneous`：codex `true`、gemini `true`，`override_reason` 均为 null。

#### J3：与 M9 留痕逐字段比对（r5 §7.3）

**对照源**：M9 收口前最后一个 claude code 轮 `M9-Grep命中计入读取面` r2（run `20260919T154710Z`，2026-09-19）；M9 的 settings Hook 段由 M9 基线 CLI（`f4f3970` 导出物，sha256 与登记一致）在 mkdtemp 目录里跑 `init` 生成，与当前 `init` 同口径。

| 比对项 | 结果 | 白名单 / 判断 |
| :--- | :--- | :--- |
| `.reviews/` 布局与文件名（本轮顶层 `.md` 与本 run 的 `_meta/` 文件名，日期 / 主题 / run_id / 审核者 id / `-rN-` 归一后） | 无差异 | — |
| `_meta/review-*.json` 键路径 | 无差异 | — |
| settings.json Hook 段（五个事件的 matcher、命令、超时） | 无差异 | — |
| `run.json` 仅本轮有：`driver_guard_level` | `L1` | 白名单第 1 行 ✓ |
| `run.json` 仅本轮有：`snapshot.build.{repo_root_commit, git_head, dirty, inputs_sha256, built_at}` | `build.git_head = da6476c`、`dirty: false`；`snapshot.git_head = a0da103`（夹具提交） | 白名单末行（r5 新增）：键形状 ✓；**取值「与 `snapshot.git_head` 一致」在夹具里不成立、也不可能成立**——`snapshot.git_head` 是被审项目（夹具）的 HEAD，构建标识是编排器仓库的提交。该取值判据只在本仓内跑的 claude 轮才有意义，见下「缺口」 |
| `run.json` 仅 M9 有：`critics.<id>.usage.{inputTokens, …, webSearchRequests}`（驼峰）、`guard.*.glm` | — | **输入差异**：两者都是 glm 侧专有形状（zcode 的 usage 用驼峰键，gemini 用蛇形键且两边一致），本轮审核者不含 glm |
| `task.json` 仅本轮有：`drivers.plan.*` | `driver: claude`，`claimed_by: unknown-session` | 白名单第 2 行：来自 3-1 的 plan 认领；**`drivers.code` 未出现** ✓ |
| `task.json` 仅本轮有：`degradations[].*` | 第 1 轮超时一条 | **输入差异**：M9 该主题 `degradations` 为空数组，元素键路径因而为空 |
| `run.json.artifacts[]` 原稿条目 | 无（7 条均为审查工件与审计材料） | 白名单第 3 行：code 轮无此条目 ✓ |
| `run.json.gate.warnings` | 无该字段 | 白名单第 4 行：code 轮无原稿，不应出现 ✓ |
| `_meta/verify-*.json` 锚层数 | 两边都无 verify 工件 | 白名单第 5 行：本轮不涉及 |

**装置自身的两次更正**（第一次运行的读数已被覆盖，原因写进装置注释）：
① 对照源起初取了 `M9-Driver旗标全链路与选侧收口` r3（`20260918T231928Z`），它审的正是引入 `driver_enabled` 与 `critics.<id>.override_reason` 的 `3686058` 本身、运行时这两个字段尚不存在，于是把它们误报成「M9 之后新增」；task.json 的 `runs[].driver` 同理。改取 M9 code 轮按 `started_at` 排序的最后一行后，这三项差异消失。
② M9 `init` 起初被传了空串 `TRIVIUM_ASSET_ROOT`，把空串当资产根、找不到 Hook 模板，静默没写 `.claude/settings.json`，于是 Hook 段整段报「M9 为 null」；改为不传该变量后 `settings_found: true`、Hook 段无差异。首次的 mkdtemp 目录 `m10b-s4r2-m9init-EwYAxQ` 登记在输出里，未删除。

#### Hook 退出码对照（r5 §7.3.2）

同一组 24 个 PreToolUse / Stop 输入分别喂给 M9 基线 CLI 与当前安装副本（同一夹具、同一 `CLAUDE_PROJECT_DIR`），三个时点：

| 时点 | 一致 | 差异 | 差异是否在白名单 |
| :--- | :-- | :-- | :--- |
| a. 空闲（plan 已批、code 未起跑，业务改动在工作区） | 22 | 2：B1 重定向写 `-response-claude.md`、B10 `mv` 到 `-revised-claude.md`，M9 退 0 → 当前退 2 | 是：白名单第 6 行（D3，Bash 侧角色后缀全集字面保护） |
| b. 审查中 | 24 | 0（B1 / B10 此时两侧都被业务写锁拦下） | — |
| c. 闸门期（等待审批） | 24 | 0 | — |

只读提及（B2 `cat`）与 `git add`（B3）两侧都放行，与白名单第 6 行「只读提及与 `git add` 不受影响」一致。

#### 缺口（如实登记）

- **构建标识取值判据不可在夹具里验证**：见上表。r5 §7.1 首行把 claude code 兼容轮的载体写作「本会话」，并未要求夹具；本轮按用户「三轮夹具审查」的安排在夹具里做，J3 的形状比对不受影响，
  但「`snapshot.build.git_head` 与 `snapshot.git_head` 一致」这一格要在本仓内跑一次 claude code 轮才能核。是否补、何时补由用户定（可并入 M10b 之后第一次本仓代码双审，届时只读 run.json 两个字段）。

#### 3-2 运行期实际命令行（J1）

均在夹具根执行，`TV` 同 §1.1：

```text
TV preflight --stage code --driver claude --json
TV topic resolve --stage code --json -- '重点看环形缓冲的下标运算与「删后重插 + 队头均摊回收」的正确性，以及时钟回拨两档的阈值边界是否与计划裁决一致' --topic 限流器重构 --critics codex,gemini --context src/limiter.ts,test/limiter.test.ts --driver claude
TV review --start --entry C --stage code --topic 限流器重构 --driver claude --focus '<同上>' --base HEAD --context src/limiter.ts,test/limiter.test.ts --critics codex,gemini --json
TV review --wait 20260925T155608Z --timeout 180 --json                          # ×7（6 次退 73，第 7 次退 75：codex 超时）
TV status
TV topic resolve --stage code --json -- '<同上>' --topic 限流器重构 --critics codex,gemini --model-codex qwen3.8-flash --context src/limiter.ts,test/limiter.test.ts --driver claude
TV review --start --entry C --stage code --topic 限流器重构 --driver claude --focus '<同上>' --base HEAD --model-codex qwen3.8-flash --context src/limiter.ts,test/limiter.test.ts --critics codex,gemini --json
TV review --wait 20260925T163113Z --timeout 180 --json                          # ×2（第 1 次退 73，第 2 次退 0）
TV gate --stage code --topic 限流器重构 --check --json
TV gate --stage code --topic 限流器重构 --await-approval
```

与渲染产物 `dual-review-code` 的步骤序一致（预检 → 解析 → `--start` → `--wait` 循环 → 应答 → `--check` → `--await-approval`，code 轮无认领步）；
`base` 按契约无条件传（resolve 输出 `HEAD`），`critics` 无条件传，重跑时 resolve 输出的 `models.codex` 原样传给 `--model-codex`。
