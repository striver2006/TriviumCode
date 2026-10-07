# M11 第 3 步 · AC-25 三审形态的路径通道检测收口 · 测试报告

> - **日期**：2026-10-07
> - **起点**：`ac6d85ce`（`main`；主设计 v1.3.129、PRD v1.4.19）
> - **流程**：命令 A，主题 `M11-AC25三审检测收口`。计划双审 run `20261007T090748Z`（codex / gemini / glm 三侧 `approve-with-nits`，6 条接受 5、驳回 1，r2 定稿）；代码双审 run `20261007T104116Z`（codex `approve-with-nits`、gemini `approve`、glm `approve-with-nits`，2 条全接受：证据目录按约定改名、`_meta` 种子补 `.failed.json`）
> - **证据目录**：[`evidence/m11-ac25-three-critic-20261007/`](./evidence/m11-ac25-three-critic-20261007/)
> - **配额**：运行期零配额（全部走桩），只有双审本身花配额

## 1. 结论

**AC-25 达成**（设计 v1.3.130、PRD v1.4.20）。达成边界四条：①只覆盖**路径通道、三审形态**；②**桩级验收**——证明编排器的禁读枚举、命中分档、按侧留痕与闸门处置在三审下成立，不证明真实审查员 CLI 的轨迹采集覆盖这些读取；③不含作废侧自动重跑（BACKLOG EV-225）；④不含命令文本通道的三侧用例（随独立演进项）。

**严格策略下作废侧的整体处置**核实为「不整次中止」：判定作废不改该侧 `status`（仍为 `ok`），`decideMode` 只按 `ok/parse_fallback` 与 `failed/timeout/缺席` 分档，终态分支只认 `subject_drift`、`driftAction === 'fail'`、`mode.abort`，全仓无 `failed(peer_leak)` 写入点。与设计 10.1.1、12.1 不冲突——原设想的 strict 中止挂在重跑后的二次命中上，重跑另立 EV-225。现行行为由用例钉住（下表 FI-1～8 的严格策略断言）。

## 2. 用例

| 编号 | 文件 · 用例名（摘） | 断言要点 |
| :--- | :--- | :--- |
| M | `deny-matrix.test.ts`「三审 × 四种当轮 Driver：每个审核者的禁读集与期望逐元素相等（含两个方向的跨轮角色翻转）」 | 论域取注册表：Driver ∈ 四家、审核者 = 启用的审核者减 Driver，共 12 格。每格禁读集与按角色写出的期望**逐元素相等**：禁另两家的审查件正文（含重跑轮与代码阶段）、`_meta` 结构化意见、两种回退件与失败记录（`.failed.json`，代码双审 GLM-01 补种）、更早一轮它们当 Driver 时的原稿与裁决件（fail-closed 现行语义），禁当轮 Driver 上一轮当审核者的审查件与 `_meta` 四件（翻转 a），禁 `.trivium` 与运行根；不禁己方全部产出与当轮 Driver 的原稿、`revised`、`response` |
| FI-1～3 | `fault-injection.test.ts`「AC-25 三审 · 归档通道：〈侧〉侧读另两方的审查件正文与结构化意见 → …」 | 三侧入选（Driver claude），一侧 `peer_leak` 读归档内禁读条目：命中恰为另两家上一轮的审查件正文与 `_meta` 四件（10 条，全为第①类）；只有该侧作废、front-matter 带 `peer_leak` 与作废横幅，另两侧不受牵连，三侧命令通道不亮；`joint_check` 运行期为 `pending`、有效侧 2；配置前置核（strict、`joint_blocker_policy: warn`、无 `--allow-single`）之上断言退出 0、`success`、`review_mode: full`；漏裁作废侧两条时闸门恰报这两条 `missing_findings`，期望集覆盖三家前缀；三条同位 blocker 全驳回时 `joint_blocker_rejected` 只点另两家、`joint_checks` 记 `checked-found`／2 |
| FI-4～6 | 同文件「AC-25 三审 · 运行根通道：〈侧〉侧读另两方本轮的原始输出 → 只有它作废（第②类）」 | 桩点名另两家：命中恰为两家各自的 `out/result.json`，第②类；运行根在 `deny_paths` 里；另两侧不受牵连；严格策略同上 |
| FI-7 | 同文件「AC-25 三审 · 两侧作废：有效侧只剩一家，共同阻断记「未执行」并告警，严格策略下仍不中止」 | `joint_check` 运行期 `skipped-insufficient-sides`／1；闸门出 `joint_check_degraded`、无 `joint_blocker_rejected`，`joint_checks` 记 `skipped-insufficient-sides`／1／`voided`；仍退出 0、`success` |
| FI-8 | 同文件「AC-25 三审 · Driver 轮换：Driver=glm、claude 当审核者读另两方产出 → …」 | 命中恰为 codex、gemini 上一轮产物；当轮 Driver 原稿 `-glm.md` 不在任何一侧命中里；只有 claude 作废 |
| 改 | 同文件「读对端那一侧的运行输出 → 判作废（分档：② 对端输出）」 | 桩对端改点名 glm（见 §5 第 1 条） |

单跑：`deny-matrix` 15/15、`fault-injection` 45/45（合计 60/60）。

## 3. 变异验证

规格由 `gen-mutation-spec.mjs` 从源码截锚点并核唯一（19 条，同一变异需两个套件咬住的拆 a / b）。先用逐条预跑脚本（`mutation-names.mjs`，带 `--test-timeout`）记下每条的失败用例名，再正式跑装置。

| 编号 | 变异 | 套件 | fail | 红的是谁 |
| :--- | :--- | :--- | :--- | :--- |
| A1a / A1b | `_meta` 结构化意见与回退件不入禁读集 | 矩阵 / 集成 | 2 / 4 | 矩阵、既有 `_meta` 正例；FI-1～3、FI-8 |
| A2a / A2b | 对端 `.md` 审查件不入禁读集 | 矩阵 / 集成 | 5 / 5 | 矩阵与四条既有；FI-1～3、FI-8、既有「读到对端审查产出」 |
| A3a / A3b | 运行根不入禁读集 | 矩阵 / 集成 | 1 / 5 | **只有矩阵**（既有 deny-matrix 用例没有一格断言运行根）；FI-4～6 与两条既有 |
| A4aa / A4ab | 只跳过 codex 的 `.md` 审查件 | 矩阵 / 集成 | 1 / 3 | **只有新用例**：矩阵；FI-2、FI-3、FI-8 |
| A4ba / A4bb | `_meta` 判据只放过 codex | 矩阵 / 集成 | 1 / 3 | **只有新用例**：矩阵；FI-2、FI-3、FI-8 |
| A4c | 运行根下第三段为 codex 也判己方 | 集成 | 2 | **只有新用例**：FI-5、FI-6 |
| N1 | 己方历史产出不再跳过 | 矩阵 | 2 | 矩阵、既有「己方历史审查产出不禁」 |
| N2a / N2b | 无 schema 一律判不出（Driver 原稿也禁） | 矩阵 / 集成 | 6 / 4 | 矩阵与五条既有；FI-1～3、FI-8 |
| B1 | 逐侧 `peerArtifactRead` 恒 false | 集成 | 11 | FI-1～8 全部与三条既有 |
| B2 | 闸门不再收集作废侧 | 集成 | 4 | FI-1～3、FI-7 |
| B3 | 闸门只看入选集合前两侧 | 集成 | 1 | **只有新用例**：FI-3（glm 是入选顺序里的第三侧） |
| B4 | 作废类只剩第①类 | 集成 | 5 | FI-4～6 与两条既有 |
| B5 | 全局作废位为真即每侧都作废（牵连） | 集成 | 4 | FI-1～3、FI-7 |

A4 三组与 B3 是只漏第三方、只看前两侧的变异：既有两侧用例在它们下面**全绿**，只有新用例红——这回答了「新用例是不是同义反复」。正式装置（`scripts/mutation-check.mjs`）：基线两个套件全绿，**19/19 咬住**，各条失败数与逐条预跑一致（`mutation-output.txt`；逐条红名单见 `mutation-names-output.json`）。代码双审 GLM-01 给两处种子补了 `.failed.json` 之后，逐条预跑与正式装置**各重跑一遍**（规格逐字节不变），读数与修改前完全相同，上表与证据文件均为重跑后的读数。

## 4. 全量检查与自检

- `npm run check` **两次串行：2948 / 2946 / 0 / 2**（总数 / 通过 / 失败 / 跳过），两次相同、退出码均为 0（`check-1.txt`、`check-2.txt`）。EV-224 为 2939，本步净增 9 例（矩阵 1、集成 8），跳过数不变。
- 两次全量期间系统临时目录新建 `trivium-` 条目 2 个，都是 `trivium-index-`（EV-204 残余五，产品代码进程被杀时的残留；代码双审前那两次全量是 1 个）；`trivium-deny-` 为 0——`deny-matrix` 改走 `scratchDir` 后不泄漏（`evidence/test-scratch-cleanup-20261004/count-new.mjs` 只读统计）。
- `doctor --selftest`（工作树构建）：**14/14**（`doctor-selftest.txt`）。
- 以上读数取自代码双审裁决落地后的那两次全量（`check-1.txt`、`check-2.txt` 已覆盖为这一轮）；代码双审前的两次读数相同。本段文字是全量跑完后填入的，索引条目与文件集未动。

## 5. 附带发现

1. 桩 `run_material_leak` 的裸 `'peer'` 取注册表首个非己方审核者。M9 第 4 步启用 claude 当审核者后，它恒指向**未入选**的 claude 目录：两侧用例「读对端那一侧的运行输出」照样判作废（第三段不是己方），一直是绿的，却从未读到真正参审的对端。本步改为点名（`peer:〈id〉[,〈id〉…]`，逐段校验非空、已登记、非本侧），删去裸 `'peer'`，该用例改点名 glm。
2. 变异 A3a 只红新矩阵一格：既有 `deny-matrix` 用例没有任何一格断言运行根在禁读集里。
3. `fault-injection` 里种下对端上一轮审查件会把本轮抬成第 2 轮（`resolveRerunIndex`），新用例按 `run.json` 取轮次与文件名；既有「读到对端审查产出」那格同样是第 2 轮，只是不走闸门、没暴露。
