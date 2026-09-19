---
schema: trivium.disposition.v1
topic: M9-验收实跑
stage: plan
role: claude
kind: revised
run_id: 20260919T103751Z
addresses:
  - 2026-09-19-M9-验收实跑-codex.md
  - 2026-09-19-M9-验收实跑-gemini.md
  - 2026-09-19-M9-验收实跑-glm.md
---

# 裁决与修订计划：M9-验收实跑（第 6 步）

codex `request-changes`（7 条：重要 3 ｜ 次要 4），gemini `approve-with-nits`（2 条），glm `approve-with-nits`（4 条）。
共 13 条：**接受 12 ｜ 驳回 1 ｜ 暂缓 0**。

三个焦点的答案三侧一致：**载体取 ① 成立**（三侧独立核过循环等待那半句）；**独立性凭据可核**
（codex 用 `git cat-file` 逐项复核、glm 经 `.git/logs` 独立核实）；**只能靠单次样本的格**——三侧给的不完全相同，
合起来是：附-2 的 `model_effective_source`（codex）、J6（gemini）、J5 与附-1（glm）。修订后的判据表按 CODEX-03 补了「样本量 / 佐证来源」一列，把三侧的答案都装进去。

最要紧的一条是 **CODEX-02**：J5 是 M9 唯一的完成判据，而我给它的留痕指针指向 `run.json` 里不存在的字段，
又在表头叮嘱「按字段看 `run.json`」。已实核：`run.v2.json` 逐侧段没有任何 consulted 键；`consultedUnverified`
只在 [render.ts:148](src/trivium/render.ts#L148) 以条件展开写进侧级文档 front-matter（**失败时才出现**），
以及 [guard.ts:733](src/trivium/guard.ts#L733) 的 `gate --check` 告警行。照原计划复核会落成「找不到字段」。
本轮 codex 侧自己的审查文档 front-matter 就带着 `consulted_unverified: true`——正好是失败形态的实样。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 成立。修订稿 §2.2 的降格前提是「被审对象事实上不由本会话产生」这条**做不到**，而本步已做到且凭据可核；「同家族」不在 §2.2 与 §16.1 M9 行的判据里，我把它混进降格条件，等于给一个没有出路的裁定留了口子（降格 ⇒ 不进台账 ⇒ 真载体在 M10 ⇒ M10 前置 ③ 又是 EV-71）。取它的路 ①：**J4 判达成，「同 claude 家族」作为达成边界写进报告与 §16.1 M9 行**。gemini（「无需降格，报告须明注同家族」）与 glm（「§2.2 的判据不是不同厂商家族；隔离机制同构」）独立给出同一结论 | §2.1：重写原稿 §3.2 与 J4 行；§八 #2 关闭 |
| CODEX-02 | codex | major | 接受 | 已实核，见上文。J5 改写为两格：侧级审查文档 front-matter **不含** `consulted_unverified`；`gate --check` 输出**没有**「claude 侧 consulted 无法与工具轨迹交叉核对」那一行。表头改为逐格标明落点层（`run.json` 逐侧段 / 侧级文档 front-matter / `gate --check` 输出 / 退出码） | §2.2 判据表 |
| CODEX-06 | codex | major | 接受 | 已实核 §16.1 M10 行前置 ③ 逐字是「EV-71 会话载体拍板并实测一次写事件」。EV-71 一关而那格不注记，接手者会读成「前置已满足」，而真载体下 Hook 生效性本步明确未验。这正是本仓「同一事实两张表」的形状 | §2.3：回补清单加 M10 行前置 ③ 的注记；残量登记为新 BACKLOG 条目 |
| CODEX-03 | codex | minor | 接受 | 已实核 [claude.ts:504](src/trivium/adapters/claude.ts#L504)：`model_effective_source: trace.init?.model ? 'envelope' : 'unverified'`，`trace` 在该侧不可达；模型目录为空、slug 无旁证。附-2 的取值集收敛为 `envelope`；`unverified` 的读法预先写清：先看 trace 里有没有 `init` 事件——没有是采集缺失（环境类，允许 1 次重跑），有而模型不符才是判据类 | §2.2 判据表附-2 与新增列 |
| CODEX-04 | codex | minor | 接受 | `evidence_ok` 是证据档总闸（轨迹在场 ∧ 工具调用合计 ≥ `min_tool_calls` ∧ `project_reads` ≥ 下限），report / gate / front-matter 三处消费；只盯 `project_reads` 会出现「表内每格都过、留痕却 `evidence_ok: false`」 | §2.2 判据表附-1 拆三格 |
| CODEX-05 | codex | minor | 接受 | 已实核 [claude.ts:578](src/trivium/adapters/claude.ts#L578) 落 `usage.cost_usd`，[config.ts](src/trivium/config.ts) 档位注释逐字写着「真实审查尺度的耗时与成本至今未测（第 6 步验收才会有第一份数据）」。不记这一格，M10 的成本闸门还得再烧一次。补观察格「照录 `duration_s` 与 `usage.cost_usd`，超时/失败也照录」，并交代为何用 default 档而非 flash 档 | §2.2 判据表新增观察格；§2.5 成本段 |
| CODEX-07 | codex | minor | 接受 | 已实核 [cli.ts:45](src/trivium/cli.ts#L45) `VERSION = '0.1.0'` 是常量，`run.v2` 无编排器构建身份字段。「跑的是 3617077 的代码」在留痕层面确实不可核，与我花一整节论证的独立性可核性是同一类问题 | §2.4：报告补全局 bundle 的 sha256 与构建时的 `git rev-parse HEAD`；说明 `--version` 不作构建身份 |
| AGY-01 | gemini | minor | 接受 | 与修订稿 §2.7 同向：J6 主证据在第 1 步 P-b，本轮焦点不诱导写操作，模型极大概率不去调写工具。报告要写清「本轮未诱导、`denied_tool_in_trace` 为 null 不是防线失效、能力背书来自 P-b 样本」 | §2.2 判据表 J6 行的「佐证来源」列；报告口径 |
| AGY-02 | gemini | nit | 驳回 | 它要的是 J5 落在 70～80% 时「允许人工核查并合理解释、避免一票否决」。80% 是 §11.4 的阈值，也是 M9 完成判据本身；验收轮里临场放宽，与「重跑凑数」是同一族——原稿 §六「不改阈值、不重跑」正是为堵这个口子写的。**保留的一点**：报告附 trace 原始比对详情（哪些 consulted 路径匹配、哪些没有），那是给人读留痕用的，不改变判定；这一点不需要放宽阈值也会做。另：该侧「认为正确」段里的「单次超时 15m、tokens 50k、重跑上限 1 次」不是原稿的数字（原稿是 7200s、无 token 上限、尝试上限 2 次），依据失实，如实指出 | 无修改；报告附比对详情不算修订 |
| GLM-01 | glm | minor | 接受 | 已实核 [hooks.ts:20-26](src/trivium/hooks.ts#L20-L26)：「wrapper 缺失而 config 在场 → 退 2」由 `sh -c` 守卫层承担、契约由 `test/contract/hook-guard.test.ts` 守；`CLAUDE_PROJECT_DIR → $D` 的解析也在 shell 层。直喂覆盖不到这两层，「只差 matcher 一层」说过头。边界改写全 | §2.1：原稿 §二末段边界三层写全 |
| GLM-03 | glm | minor | 接受 | 已实核 [gate.ts:163-165](src/trivium/gate.ts#L163-L165) 按 `parsed.role === driver` 定位裁决件：负例必须改原件、且要复原并再 `--check` 一次照录，否则夹具终态是自相矛盾的件 | §2.4 剧本步骤 5 补善后 |
| GLM-04 | glm | minor | 接受 | 三个值在原稿是占位符。实况是它们由 `--start` 返回、`max_waits` 由 `computeMaxWaits(stage_timeout, wait_timeout, transient_max)` 按阶段预算派生（本轮 plan 阶段 1500s → 19 × 180s = 3420s），不需要手定；要补的是「开跑播报时核对 `max_waits × wait_timeout_s ≥ stage_timeout_s`」与「73 不计尝试次数，只有终态超时/失败触发 §六」 | §2.4 剧本步骤 3 |
| GLM-02 | glm | nit | 接受 | 已实核 §16.1 M10 行：前置 ① 是「agy skills 真实加载行为实测通过」，「四家入口资产」在范围栏。我引错了格；循环等待的关键半句「前置 ③ = EV-71」没错，结论不变 | §2.1：引用改为「M10 范围栏（四家入口资产）」+ EV-71 原文 |

**统计**：接受 12 ｜ 驳回 1 ｜ 暂缓 0。

---

## 二、修订内容

原稿保留在同目录 `2026-09-19-M9-验收实跑-claude.md`，本件只写改了什么。

### 2.1 §二 / §3.2 / §八：载体与独立性的口径收口（CODEX-01 ≡ AGY 总判断 ≡ GLM 总判断 ②；GLM-01；GLM-02）

**引用改正（GLM-02）**：原稿「② 真载体的前置是 M10 四家入口资产（§16.1 M10 行前置 ①）」改为
「② 真载体需要 M10 **范围栏**的四家入口资产先落地（EV-71 原文），今天一件都没有；而 M10 的**前置 ③** 正是 EV-71 自己」。

**独立性口径（CODEX-01）**：原稿 §3.2 的「若双审认为同家族不足 ⇒ J4 降格」**删除**。改为：

> J4 按修订稿 §2.2 的判据判定：被审对象事实上不由本会话产生（不同会话、早于本会话 3 天、sha / author / date / parent / diffstat 可核）——**达成**。
> 「审核者与执笔者同属 claude 家族」是**达成边界**，不是降格条件：本仓自 M0 起只有一个 Driver，这是既有限制、不是本步引入的；
> 隔离靠的是上下文隔离（`--restricted`、项目记忆阻断、独立子进程），与 glm 审 claude 代码在性质上同构。
> 边界写进报告 §达成边界与 §16.1 M9 行。

§八 #2 随之关闭；§八 #1、#3 三侧均答「成立」，也关闭。

**刻 B 触发方式的边界写全（GLM-01）**：原稿「不覆盖的只有 matcher 分发那一层」改为三层：

| 未覆盖层 | 谁在守 |
| :--- | :--- |
| Claude Code 的 matcher 分发 | 本仓日常运行（本件即经它放行写出） |
| `sh -c` 存在性守卫，尤其「wrapper 缺失而 `config.yaml` 在场 → 退 2」支 | `test/contract/hook-guard.test.ts` 实跑 |
| `CLAUDE_PROJECT_DIR → $D` 解析 | 同上守卫层，本仓日常运行 |

「无 `config.yaml` → 退 0」那支由二进制内 `runHook` 同样实现，直喂可覆盖，不列为缺口。

### 2.2 §五 判据表重写（CODEX-02 / 03 / 04 / 05；AGY-01；GLM 总判断）

表头改为：**每格标明落点层**。落点层的取值：`run.json` 逐侧段 ｜ 侧级文档 front-matter ｜ `gate --check` 输出 ｜ 退出码 ｜ `config.local.yaml`。

| 判据 | 落点层 | 通过线 | 样本量 / 佐证来源 |
| :--- | :--- | :--- | :--- |
| **J4** `_meta/review-claude-<run>.json` 通过 `trivium.review.v1`；`parse_fallback: false` | 侧级 front-matter `parse_fallback` + schema 校验 | 硬 | 单次；schema 合规面有 EV-10 / EV-56 前科（glm 侧 `parse_fallback` 两现），单样本敏感 |
| **J5**（M9 完成判据）侧级文档 front-matter **不含** `consulted_unverified`；且 `gate --check` 输出**没有**「claude 侧 consulted 无法与工具轨迹交叉核对」行 | 侧级 front-matter + `gate --check` 输出 | 硬；阈值 80% 不改（AGY-02 驳回） | 单次；完全由模型当轮行为决定。报告附 trace 比对详情供人读 |
| J6 `denied_tool_in_trace` | `run.json` 逐侧段 `guard` | 观察，不下结论、不重跑 | 本轮**不诱导**写操作，预期 `null`；能力背书来自第 1 步 P-b 的样本（AGY-01） |
| 附-1a 工具调用合计 ≥ 5（`min_tool_calls.code`） | `run.json` 逐侧段 `tool_calls` | 硬 | 单次；由模型当轮行为决定 |
| 附-1b `project_reads` ≥ 3（`min_project_reads.code`） | 同上 | 硬 | 同上 |
| 附-1c `evidence_ok === true`（总闸） | `run.json` 逐侧段 + 侧级 front-matter | 硬 | 由 1a / 1b 派生 |
| 附-2a `model_effective === claude-sonnet-5` | `run.json` 逐侧段 / front-matter | 硬 | 由 default 档钉死，非随机 |
| 附-2b `model_effective_source === envelope` | 同上 | 硬；**`unverified` 先看 trace 有无 `init` 事件**：无 = 采集缺失 → 环境类（允许 1 次重跑）；有而模型不符 → 判据类 | **单次**；该侧 `trace` 不可达、模型目录为空、无旁证（CODEX-03） |
| 附-3 `peer_deny_applied` 照录，对照 `probe.cli.claude.path_deny.file_shape_verified` | `run.json` 逐侧段 + `config.local.yaml` | 照录 | 读探针格，静态 |
| 附-4 `heterogeneous` 预期 `false` 且语义不准（EV-62） | `run.json` 逐侧段 | 照录 + 报告注明 | 确定性 |
| **附-5（新）** 照录 `duration_s` 与 `usage.cost_usd`；超时/失败也照录；不在场写「本次未回读到」 | `run.json` 逐侧段 | 观察 | 第一份真实尺度数据（CODEX-05） |
| EV-71 刻 B 两格翻转 | 退出码 + 拦截文案 | 硬 | 确定性 |
| J8 `preflight --critics claude`（driver 缺省）退 64 | 退出码 | 硬 | 确定性 |
| EV-66 真实会话面：`role: claude` 负例判 `bad_front_matter` | `gate --check` 输出 | 硬 | 确定性 |

「硬」不过 = 本次验收不达成，按 §六刹车处置，不重跑凑数。

### 2.3 §一.6 回补清单补一项（CODEX-06）

回补清单加第四项：**§16.1 M10 行前置 ③** 加注记——「载体已取 ①，实测经『夹具 + `gate hook-pre-write` 直喂』完成；
② 真载体下 Hook 的生效性**未验**，随 M10 四家入口资产一起验」。同一残量另登记为新 BACKLOG 条目（编号待分配），
让它有独立载体、不只活在验收报告正文里。EV-71 的关闭理由指向该新条目。

### 2.4 §四 剧本三处补正（GLM-03；GLM-04；CODEX-07）

- **步骤 3**：`wait_timeout_s` / `bash_timeout_ms` / `max_waits` 三值一律取 `--start` 返回值；开跑播报时核对
  `max_waits × wait_timeout_s ≥ stage_timeout_s`（`computeMaxWaits` 按阶段预算派生，本轮 plan 阶段 19 × 180 = 3420 ≥ 1500）；
  `--wait` 退 73 继续等、**不计入 §六的尝试次数**，只有终态超时/失败才触发重跑判定。
- **步骤 5**：负例必须改**被闸门定位的那份原件**（`gate` 按文件名后缀 `role === driver` 定位，副本定位不到）；
  照录 `bad_front_matter` 输出后**改回 `role: codex`，再跑一次 `--check` 照录复原确认**；两次输出都进报告。
- **步骤 8（报告）**：补两行构建凭据——全局 `~/.claude/skills/dual-critic/scripts/trivium.cjs` 的 sha256、
  构建时工作树 `git rev-parse HEAD`（3617077，干净树）；说明夹具 `.trivium/bin/trivium` 只是 exec 该文件的 wrapper，
  `trivium --version` 是常量、不作构建身份，本次以哈希为锚。

### 2.5 §六 成本段补「钱」的维度（CODEX-05）

- 预期量级：**未知**——准入报告 §4 只有探针尺度（sonnet-5 单次 $0.0102），真实审查尺度正是本次要拿的第一份数据；
- 止损口径：`review` 路径无 `--max-budget-usd`，运行中也读不到 usage，**超时 7200s 是唯一硬闸**；不在运行中人为中断；
- 为何用 default 档（sonnet-5）而非 flash 档（haiku）：附-2a 要求 `model_effective` 与验收档一致，M9 完成判据是「真实审查一次」，
  flash 档是省钱档不是验收档；且 haiku 在探针里已跑过多次，缺的正是 sonnet-5 的审查尺度数据。更便宜的等价路径已评估、不采。

### 2.6 不改的部分

- 尝试上限 2 次、判据类失败不重跑（三侧均认可）；
- 只取 `src/` + `test/`、排除归档与文档（三侧均认可）；
- J6 主证据在第 1 步（修订稿 §2.7，AGY-01 同向）。

---

## 三、修订后的步骤

| 步 | 内容 | 相对原稿的变化 |
| :--- | :--- | :--- |
| 1 | 载体拍板 ① | 引用改正（GLM-02）；边界三层写全（GLM-01） |
| 2 | 夹具（已建） | 报告补构建凭据（CODEX-07） |
| 3 | 实跑 | 等待值取返回、73 不计尝试（GLM-04）；负例改原件并复原（GLM-03） |
| 4 | 判据核对 | 表重写：落点层 + 样本量列；J5 改指真实落点；附-1 拆三格；附-2b 收敛 envelope；附-5 成本观察格 |
| 5 | 报告 | J4 达成 + 同家族边界；J6 溯源口径；trace 比对详情 |
| 6 | 最小回补 | 加 M10 行前置 ③ 注记 + 新 BACKLOG 条目（CODEX-06） |
