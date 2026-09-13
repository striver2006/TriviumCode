---
schema: trivium.disposition.v1
topic: Agent注册表与多审泛化
stage: plan
role: claude
kind: revised
run_id: 20260913T115435Z
addresses:
  - 2026-09-13-Agent注册表与多审泛化-gemini.md
  - 2026-09-13-Agent注册表与多审泛化-glm.md
---

# 计划修订：Agent注册表与多审泛化

## 0. 裁决总览

两侧均判 `request-changes`，gemini 5 条（含 1 blocker）、glm 7 条，共 12 条：
**接受 12 条、驳回 0 条、暂缓 0 条。**

十二条我逐条回仓核实，**没有一条虚报**，全部指向真实代码行。这次审查的价值远超我的原稿——我的 §2.2 自称「补全提案漏掉的 4 处」，两侧合计又补出 **8 处**，其中一处（`gate.ts:388`）比我找到的任何一处都严重。

**三组独立收敛**（两侧背靠背各自命中同一问题）：

| 问题 | gemini | glm |
| :--- | :--- | :--- |
| 硬编码盘点仍漏 `topic.ts:101`、`gate.ts:388` 等多处 | AGY-01、AGY-05 | GLM-01 |
| D-3 的事实来源（`task.json.runs[]` 有工件清单）不存在 + fail-closed 过宽 | AGY-02 | GLM-02 |
| M7a「工件逐字节同现状」与同里程碑内 deny 集合扩展自相矛盾 | AGY-03① | GLM-03、GLM-04 |

**我原稿最严重的错误**：§3.1 写「`task.json.runs[]` 已逐轮记录该轮的工件清单」——**这是我编的**。实际 `TaskMeta.runs[]` 只有 `run_id/stage/rerun_index/status/review_mode/started_at` 六个字段（`meta.ts:68-80`，实测 `task.json` 样本确认）。D-3 的方向两侧都确认正确，但我给它安的事实基础是错的。这正是「计划稿里一句想当然的断言」如何变成实施期事故的样本，记在这里。

---

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 四处全部核实属实：`topic.ts:101` 过滤 `role === 'claude'`、`naming.ts:93` 对 `kind !== null && role !== 'claude'` 抛错、`archive.ts:282-288` 写死三种后缀的必需件清单、`gate.ts:467` 反查 run_id 时跳过 `claude`。非 Claude Driver 会在原稿定位阶段即退 65，走不到后面 | §2.1 表 B-1～B-4；四处进 M7a 清单，配非 Claude Driver 夹具 |
| AGY-02 | gemini | major | 接受 | (a)(b) 属实且是我原稿的硬伤，见 §0；(c) 跨归档遍历的 I/O 关切合理（`freeze.ts` 现状 `walk(archiveRoot)` 遍历整个 `.reviews`） | §2.2 重写 D-3；§2.2 兜底规则改「v1 主题按 `driver=claude` 推断」；`freeze` 按主题目录剪枝进 M7a |
| AGY-03 | gemini | major | 接受 | ① 与 GLM-04 同一问题，属实：我把提案 §14 原有的「除 deny 集合的有意扩展」豁免措辞丢了；② 属实，`claude` 必须在 M7a 就进注册表，否则注册表不是单一来源；③ 方向正确但需精化时间窗，见落点 | §2.3 重写 M7a 判据；§2.1 注册表 M7a 即含四项；§2.4 精化 M7b 回退边界 |
| AGY-04 | gemini | minor | 接受 | 属实。现状 `findJointRejectedBlockers`（`gate.ts:321`）只收 blocker，而我 D-5 新增的豁免条款写的是「对应意见」未限等级——实现时按字面做，一条被接受的 nit 就能豁免两位审核者的共同 blocker | §2.5 豁免条款加「同为 blocker 等级」约束 + hard 模式保留显式 warning |
| AGY-05 | gemini | minor | 接受 | 属实，与 GLM-01① 同一处（`gate.ts:388` 字面循环 `['gemini','glm']`）。合并处置，不重复列 | 同 GLM-01 落点 |
| GLM-01 | glm | major | 接受 | 四处全部核实属实。①`gate.ts:388` 最严重：第三家的 `review-<c>-<runId>.json` 永不被读取，其意见对 gate 整体不可见——**静默漏裁**，比我的 A-1 误判更隐蔽；②`gate.ts:443` fallback 正则；③`topic.ts:101`（与 AGY-01① 同）；④`disposition.ts:202` 行过滤静默丢弃未登记前缀。「M7a 清单与 AC-N5a 八模块对不上」的指控同样成立 | §2.1 表 B-5～B-8；§2.1 末「grep 级对账固化为 registry-parity 负例输入」；M7a 清单与 AC-N5a 八模块对齐 |
| GLM-02 | glm | major | 接受 | 三点全部属实。(b) 尤其关键：原稿与裁决件**不在任何登记清单**里，我的「按归档索引反推每个文件的角色」对最需要判定的两类文件根本没有事实来源。(c) 的代价分析纠正了我的判断——我写「宁可少读一份原稿」，实际后果是「读了就 `peer_leak` 作废重跑」 | §2.2 重写 D-3 的角色反推优先级链，采纳 GLM 的链式结构 + AGY-02 的 front-matter 内生判据 |
| GLM-03 | glm | major | 接受 | 属实且是我路线设计的要害。`run_id` 是 UTC 时间戳、`started_at/finished_at/duration_s` 全时变、两侧 LLM 输出非确定——「逐字节同现状」按字面不可执行。我自己在 R29 里已经意识到这点却没改判据，是自相矛盾 | §2.3 判据改为「桩适配器 + 固定时钟 + 时变字段归一化后逐字段相等」；真实双审降为结构等价冒烟 |
| GLM-04 | glm | major | 接受 | 属实，与 AGY-03① 同源。deny 集合进 `run.json.deny_paths`（`types.ts:337`）又渲染进 brief 第 8 段，集合一变工件必变 | §2.3 采纳其「二选一」的第二项：M7a 判据显式豁免 `deny_paths` 与 brief 禁读段，并写明豁免理由 |
| GLM-05 | glm | minor | 接受 | 属实。「摘注册项」与「置 `critic_enabled:false`」是两种深度，我混在一格里。若真摘项，历史 `-codex.md` 与 `CODEX-` 前缀在 A-1 新纪律下变未注册值 → 历史主题 gate 重跑直接报错，回退反而破坏留痕 | §2.4 明确回退 = 保留注册项、仅置 `critic_enabled:false`（禁选不禁认） |
| GLM-06 | glm | minor | 接受 | 两点均属实。尤其后半：`review.v1.json:33` 的 pattern 仅 `^(AGY\|GLM)-`，且该 schema 经 `CriticRequest.schema_path` 交给 CLI 强制输出形状——桩侧的 `STUB-` 前缀过不了自己的 schema 校验，AC-N5a 夹具按现契约**跑不通** | §2.1 AC-N5a 写明 diff 范围 = 模块源码；§2.6 定义桩夹具前缀处理 |
| GLM-07 | glm | minor | 接受 | 属实。测试文件没有「某次 diff 来自接入新 Agent」这一事件的天然基线，`driver-onboarding-scope.test.ts` 按测试形态落地是无法实现的验收项。它正确地只否定了「git diff 对照」这一半，保留了 R30 可测的一半 | §2.1 AC-N5b 拆成两个机制并写明执行主体 |

---

## 2. 修订内容

以下是接受项在计划中的落点。**未提及的部分沿用原稿**（D-1、D-2 的拆分主张、D-6 的 M7a/M7b 拆分、D-7 的工作量下调、§4.3 每里程碑独立价值、§5 待拍板建议、§7 回溯清单均经两侧确认成立，不动）。

### 2.1 硬编码盘点补全（AGY-01、AGY-05、GLM-01）

原稿 §2.2 的 A-1～A-4 保留，增补两侧补出的 8 处。合并后的完整清单（B 系列为本次新增）：

| # | 位置 | 现状 | 泛化后的故障 | 处置 |
| :--- | :--- | :--- | :--- | :--- |
| B-1 | `topic.ts:101`（`locateSubject`）、`topic-args.ts:401` | 只认 `parsed.role === 'claude'` 的原稿 | 非 Claude Driver **找不到被审对象，退 65**，流程在第一步就断 | 过滤条件改为当轮 `driver.suffix` |
| B-2 | `naming.ts:93`（`buildArtifactName`） | `kind !== null && role !== 'claude'` 即抛错 | 非 Claude Driver 的裁决件**无法落盘** | 判据改为 `role !== <当轮 driver.suffix>` |
| B-3 | `archive.ts:282-288`（`checkRecordedArtifacts`） | 写死必需件 = `-claude.md` 原稿 + `-gemini.md` + `-glm.md` + `-claude` 裁决件 | Driver 或审核者集合一变，`gate --check-artifacts` **必报假缺件** | 必需件清单由 `driver` + `critics_selected` 生成 |
| B-4 | `gate.ts:467`（`inferLatestRunId`） | `if (i.parsed.role === 'claude') continue` | Claude 作为**审核者**时反查 run_id 返回 null | 跳过条件改为当轮 `driver.suffix` |
| B-5 | `gate.ts:388`（`loadRoundReviews`） | `for (const c of ['gemini','glm'] as CriticId[])` | **最严重**：第三家的 `review-<c>-<runId>.json` 永不被读取，其全部意见对 gate 不可见——**静默漏裁**，闸门放行一个从未被裁决的审核者 | 改由入参 `critics_selected` 驱动 |
| B-6 | `gate.ts:443`（`readFallbackIds`） | `/^-\s+((?:AGY\|GLM)-F\d+):/` | 新前缀的 fallback 编号读不回 | 前缀集由注册表生成 |
| B-7 | `disposition.ts:202`（`parseDisposition` 行过滤） | `/^(AGY\|GLM)-/` 不匹配即 `continue` | 未登记前缀的裁决行**静默丢弃**，下游 gate 报「缺裁决」而根因误导 | 前缀集由注册表生成；未匹配且形似编号的行按现有 `problems` 机制报出 |
| B-8 | `freeze.ts` 全归档遍历 | `walk(archiveRoot)` 遍历整个 `.reviews` | 角色反推若需解析历史 run.json，I/O 随归档规模线性增长 | 按当前主题目录剪枝（跨主题工件本就不该进本主题 deny 集） |

**盘点方法改进（采纳 GLM-01 建议）**：不再依赖人工清单维持完整性。M7a 增一道 **grep 级对账**——对全仓 `src/` 扫描字面量 `gemini|glm|AGY|GLM|claude|codex`，白名单外的命中即失败，对账结果固化为 `registry-parity.test.ts` 的负例输入。人工清单会漏（本次我漏了 8 处即是证明），机器对账不会。

**AC-N5a 口径修正（GLM-06）**：diff 范围 = **模块源码（含生成器代码）**，不含生成产物；产物与注册表的一致性由 `registry-parity` 对账承担。M7a 的模块清单与 AC-N5a 的八模块**必须逐项对齐**（原稿 §4.1 的 M7a 清单缺 `gate/topic/brief`，是 GLM-01 指出的对不上）。

**AC-N5b 机制拆分（GLM-07）**：拆成两个执行主体明确的机制：
- `registry-parity.test.ts` 断言**白名单常量 ↔ 文档一致**（可测，仓库内）；
- 「接入第五家只碰白名单内文件」由 **CI 对 PR diff 的检查**承担，触发时机 = 注册表文件被修改的 PR。AC-N5b 写明执行主体与触发时机，不再表述为单元测试。

**注册表 M7a 即含四项（AGY-03②）**：M7a 的注册表登记 `claude/gemini/glm/codex` 四项（codex/claude 的 `critic_enabled: false`），而非只登记两家。`claude` 作为现行 Driver 必须在注册表内，否则「注册表是唯一来源」在 M7a 就不成立。

### 2.2 D-3 重写：角色反推的事实来源与兜底（AGY-02、GLM-02）

原稿 §3.1 的**方向不变**（两侧均确认「驳回按后缀差集」正确且必要，跨轮角色翻转的反例成立），但事实来源与兜底规则全部重写。

**角色反推优先级链**（综合 GLM-02 的链式结构与 AGY-02 的 front-matter 内生判据，主判据取后者）：

| 序 | 判据 | 结论 | 依据性质 |
| :--- | :--- | :--- | :--- |
| 1 | 文件 front-matter 的 `schema` 字段 = `trivium.review.v1` | **审查件**，产出方 = `role` 字段 | **内生**：文件自带，不依赖任何外部登记 |
| 2 | front-matter `schema` = `trivium.disposition.v1` | **裁决件**，产出方 = 该轮 Driver | 内生 |
| 3 | 命中某轮 `_meta/run-<id>.json` 的 `artifacts[]` | 按该轮 `critics_selected` 定角色 | 交叉校验（用于核对 1/2 的结论，不作主判据） |
| 4 | 无 front-matter `schema`、未登记、后缀 = 某轮 driver | **原稿** | 排除法 |
| 5 | 以上均无法判定（front-matter 不可解析） | **fail-closed 禁读** | 兜底 |

主判据改用 front-matter 是对我原稿的实质改进：审查件与裁决件**自身就携带角色证据**（`schema` + `role` 两字段），无需依赖 `run.json.artifacts` 这个「原稿与裁决件根本不在其中」的残缺登记（GLM-02(b) 的核心指控）。第 3 级降为交叉校验。

**兜底规则收窄（AGY-02(c)、GLM-02(c)）**：原稿写的「历史主题无 `driver` 字段 → fail-closed 禁该后缀全部文件」**撤销**。改为：

- `task.json` 为 `trivium.task.v1`（无 `driver` 字段）→ **按 `driver = claude` 推断**。这是由 schema 版本可判的确定事实（v1 时代 Driver 恒为 claude，且 claude 从不当审核者），不是不确定情形。
- fail-closed 只用于**连 schema 版本都无法判定**的情形（文件损坏、front-matter 不可解析）。

我原稿写「宁可少读一份 Driver 原稿，代价可控」是**误判代价**：`checkPeerLeak`（`adapters/base.ts:119-130`）以 deny 集合核验轨迹，命中即泄漏处置——审核者读被审对象原稿会直接触发 `peer_leak` **作废重跑并烧配额**。代价不是「少读一份」，是「读了就作废」。两侧独立指出同一点。

**M7b 契约增补**：把「原稿与裁决件纳入 `run.json.artifacts` 登记」列入 M7b 的契约变更（GLM-02 建议），使第 3 级交叉校验在新工件上完整可用。

**测试矩阵补负例**：`deny-matrix.test.ts` 除原稿的「跨轮角色翻转」正例外，增 **「审核者读当轮原稿不触发 `peer_leak`」负例**——这是防止兜底规则回归到过宽状态的锚点。

### 2.3 M7a 完成判据重写（AGY-03①、GLM-03、GLM-04）

原稿的「双侧真实跑一轮，工件逐字节同现状」**撤销**。两处不可执行：时变字段与 LLM 非确定性（GLM-03）、同里程碑内 deny 集合有意扩展（GLM-04/AGY-03①）。

**改为三项判据**：

| # | 判据 | 说明 |
| :--- | :--- | :--- |
| 1 | **桩适配器 + 固定时钟下逐字段相等** | `TRIVIUM_STUB_CRITIC` 跨进程生效且指纹可断言；新旧代码对同一录入输入产出比对，`run_id`/时间戳/`duration_s` 等时变字段归一化后**逐字段相等** |
| 2 | **显式豁免两项有意扩展** | `run.json.deny_paths` 与 brief 第 8 段禁读清单。豁免理由：deny 集合的扩展是 M7a 的**交付内容本身**（修补现存 `_meta` 隔离缺口），不是重构的副作用；且它不构成对外契约变更——`deny_paths` 是运行留痕字段，其取值扩大不改变任何消费方的解析形状。此豁免沿用提案 §14 M7 的原有措辞（我原稿把它丢了） |
| 3 | **真实双审：结构等价冒烟 + 既有主题 `gate --check` 通过** | 真实运行不承担逐字节职责，只验「跑得通、结构对、历史工件仍可过闸」 |

R29 相应改写：录制回放不再是「初判」而是**主判据**，真实运行是冒烟。

### 2.4 M7b / M8 / M9 回退边界精化（AGY-03③、GLM-05）

**M7b 回退边界（AGY-03③，精化后接受）**：AGY 指出「含多审与新 Driver 的 v2 工件无法无损降级回 v1」——成立，但需界定时间窗。M7b 阶段 codex/claude 仅注册而无适配器（M8/M9 才有），物理上选不到第三家，Driver 任意化在 M10，因此 **M7b～M8 之前产生的 v2 工件仍是双审 + claude Driver 形态，降级脚本可无损覆盖**。M8 起产生的多审工件**不可逆向降级**。

据此明确：
- 降级脚本的适用窗口 = M7b 合入至 M8 合入之间；
- M8 及之后的回退单元**改为前滚**（修正后重新发布），不再声称可降级回 v1。这一条写进路线表的「回退动作」列，不留给实施期临场解释。

**M8/M9 回退动作消歧（GLM-05）**：回退 = **保留注册项、仅置 `critic_enabled: false`**（禁选不禁认）。理由正是 GLM 指出的：摘除注册项会让历史 `-codex.md` 与 `CODEX-` 前缀在 A-1 新纪律（查表无匹配即报错）下变成未注册值，历史主题 gate 重跑直接报错——回退破坏既有留痕，与「回退单元」的卖点自相矛盾。

### 2.5 D-5 豁免条款收紧（AGY-04）

原稿判据的豁免条款「且无任何入选审核者在该 location 提出并被接受的**对应意见**」未限定等级。收紧为：

- 背书意见必须**同为 blocker 等级**才能冲抵 joint blocker 争议。一条被接受的 minor/nit 不构成对 blocker 的背书。
- `joint_blocker_policy: hard` 模式下的「2 驳 1 接受」：不按完全对抗处理（保留原稿裁定，理由不变——三审不应比双审更严苛），但**保留显式 warning 与审计标记**，`partial_dispute` 在数据层固化并纳入校验。落点为 `task.json.disputes[]`（`meta.ts:88` 已有该结构，无需新增字段）。

n=2 逐字节兼容的论断不变（两侧均核实成立）。

### 2.6 桩夹具前缀处理（GLM-06 后半）

`review.v1.json:33` 的 pattern 仅 `^(AGY|GLM)-`，且该 schema 经 `CriticRequest.schema_path`（`types.ts:370`）交给 CLI 强制输出形状——桩 Agent 的 `STUB-` 前缀**过不了自己的 schema 校验**，AC-N5a 夹具按现契约跑不通。

处置：**pattern 由注册表在构建期渲染**，桩夹具通过内联注册项参与渲染。这同时解决 GLM-06 前半的「生成产物必然变化」问题——产物变化是预期的，一致性由 `registry-parity` 对账保证，不由「逐字节无 diff」保证。

---

## 3. 修订后的路线表（替换原稿 §4.2）

变更处以 **粗体** 标出。

| 里程碑 | 内容 | 完成判据 | 回退动作 | 预估 |
| :--- | :--- | :--- | :--- | :--- |
| **M6** 探针扩展 | 同原稿 | `doctor --only codex/claude` 有确定结论；待拍板 #3 收敛 | 独立（只加文件） | 1～2 天 |
| **M7a** 注册表重构（行为等价） | `agents/registry.ts`（**四项注册，codex/claude 的 `critic_enabled:false`**）；types 三表迁入；**A-1～A-4 + B-1～B-8 共 12 处**字面量改读注册表；§2.2 deny 矩阵重做（**front-matter 主判据**）；**grep 级对账**；`registry-parity` + `deny-matrix`（含**读原稿负例**）测试 | **§2.3 三项判据**（桩+固定时钟逐字段相等 / 显式豁免 deny_paths 与 brief 禁读段 / 真实双审冒烟 + 既有主题 gate 通过） | `git revert` | **2.5 天**（+0.5，B 系列 8 处） |
| **M7b** 契约升版与 CLI | config v2 + run v2 + schema 扩展；v1 双读与内存迁移；`--driver`/`--critics`/`--tier-*` 旗标；**原稿与裁决件纳入 `run.json.artifacts` 登记** | v1 配置不改也能跑；v1 工件可读；三侧桩跑通；命令文本伪造命中作废（AC-N6） | revert + 降级脚本（**适用窗口：M7b～M8 之前**） | 1.5 天 |
| **M8** Codex 审核者 | 同原稿 | 两家族各真实审查一次（AC-N1）；沙箱负对照通过 | **置 `critic_enabled:false`（保留注册项）**；此后回退单元改为前滚 | 1～2 天 |
| **M9** Claude 审核者 | 同原稿 | 真实审查一次；`consulted` 交叉核对 | 同 M8 | 1 天 |
| **M10** 任意 Driver | 四家入口资产与单源渲染；install 多目标；`hooks --agent`；`approve` 复核；协议片段两段式；**AC-N5b 的 CI diff 检查落地** | AC-N2；ZCode/Codex Driver 夹具跑通；**§2.2 跨轮角色翻转用例通过（R27 准入条件）** | `--driver` 缺省 claude 使旧路径不受影响 | 2～3 天 |
| **M11** 档位全链路与文档收口 | 同原稿 | AC-N4；文档对账零冲突 | 文档单独 revert | 1～2 天 |

依赖不变：`M6 →（M7a → M7b → M8/M9 → M10）→ M11`，M7a 可与 M6 并行，M8/M9 可并行。

---

## 4. 回溯修订清单增补（在原稿 §7 之上）

| 文档 | 增补 |
| :--- | :--- |
| 主设计 | §10 隔离章的实现纪律增「角色反推以工件 front-matter 的 `schema`/`role` 为主判据，`run.json.artifacts` 为交叉校验」（§2.2）；§8.6 增 joint blocker 背书须同为 blocker 等级（§2.5） |
| PRD | AC-N5a 写明 diff 范围 = 模块源码；AC-N5b 写明执行主体为 CI 而非单元测试（§2.1） |
| `AGENTS.md` | 增「禁止人工维护 Agent 字面量清单，以 grep 级对账 + registry-parity 负例保证完整性」（§2.1） |

---

## 5. 两侧盲区的处置

两侧各自申明的未覆盖范围，我逐条确认**无需本阶段补审**：

- **厂商侧外部事实**（Codex CLI 旗标与事件流、Claude headless 信任行为、Antigravity 入口承载）：两侧均无法本机核实。这正是 M6 探针先行的理由，纪律 1「先探路后编码」已覆盖，不靠计划审兜底。
- **大型归档 deny 枚举的性能基准**（gemini 侧盲区）：已由 AGY-02③ 转为 B-8 的剪枝处置，性能基准移交 M7a 实施期实测。
- **N 侧超时与 `max_waits` 预算的交互**（glm 侧盲区）：原稿 §3.3 已自标 M7 补测，保留。
- **lenses.yaml 四镜头内容质量**：提案 §7.4 已给出内容提案，属 M11 范畴，两侧未审不构成缺口。
