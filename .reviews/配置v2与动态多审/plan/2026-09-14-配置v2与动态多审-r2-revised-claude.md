---
schema: trivium.disposition.v1
topic: 配置v2与动态多审
stage: plan
role: claude
kind: revised
run_id: 20260913T223700Z
addresses:
  - 2026-09-14-配置v2与动态多审-r2-gemini.md
  - 2026-09-14-配置v2与动态多审-r2-glm.md
---

# 计划修订（r2）：配置 v2 与动态多审

## 0. 裁决总览

两侧均判 `request-changes`。gemini 7 条（1 blocker / 3 major / 3 minor），
glm 7 条（4 major / 3 minor），合计 14 条。

**逐条裁决：接受 14 条，驳回 0，暂缓 0。**

我对每一条都做了独立核实（见各条「核实」行），无一条经核实后不成立。

### 一处独立收敛：两侧同时命中同一个 blocker

| 问题 | gemini | glm |
| :--- | :--- | :--- |
| §3.4 读侧收严未保留 `verify` 阶段豁免，将锁死本仓库全部提交 | AGY-01（blocker） | GLM-01（major） |

背靠背状态下两侧各自查了归档、各自读到 `archive.ts:431` 那段注释、
各自得出同一结论。这是本轮最有价值的收敛。

**我实测核实**：归档中 `run-*.json` 共 26 份，其中

- `trivium.verify-run.v1` 4 份（`Agent注册表与多审泛化`、`S9-闸门与留痕加固`、
  `双审进度反馈`、`护栏判定范围收窄` 各一份的 `verify/_meta/`）；
- `verify/` 下标着 `trivium.run.v1` 的历史记录 1 份
  （`.reviews/M4-M5实现/verify/_meta/run-20260911T042526Z.json`）。

按我 r2 稿 §3.4 的字面规则，前 4 份落进「其余任何取值 → 不可读」，
第 5 份会被 v1 校验器判不合契约。`hooks.ts` 的 `checkRunManifests` 见到
unreadable 即 `EXIT.GATE_BLOCK`——**本仓库此后每次 `git commit` 都会被拦，
且无法通过修改代码之外的任何手段解除**。

讽刺的是 `archive.ts:431` 那段注释正是为防这件事写的，它记着
「本仓库归档里就有一份，拿 run.v1 去校验会把它误判成不可读、永久拦住提交」。
我在 r2 稿 §7 第 3 条把这列为「我最担心误伤的地方」，却没有去查归档就写下了规则。
**担心不等于核实。**

### 两侧互补的部分

gemini 独有：AGY-04（`agents` 键不该要求 `criticEnabled`）、AGY-07
（第 1 步在 schema 层不自洽）、AGY-03 的 `doctor.ts` / `agy.ts` / `topic-args.ts` 三处。

glm 独有：GLM-03（`brief.ts` 的 `Lenses` 是封闭两键 interface，零改动判据会打红自己）、
GLM-05（演进设计自称「不是实现依据」）、GLM-06（`profiles` 的 `{tier}` 形态）、
GLM-07（零改动验收的构造基线是同义反复）。

两条 §4 遗漏项（`review.ts:938`）两侧都查到了（AGY-03 第 1 点 / GLM-02），不冗余。

### r2 稿错在哪

r1 稿错在没读设计文档就自创规范。r2 稿改掉了那个，但犯了新的一类：
**把设计文档当成了唯一且完备的规范源**。

- §3.1 整节架在演进设计上，而那份文档自己头部就写着「**本文不是实现依据**」
  （GLM-05）；
- §3.4 逐项抄了设计 §6.2 的字段表，但设计没写 `verify` 豁免，我就也没写——
  而豁免是**代码里既有的**，不在设计里（AGY-01 / GLM-01）；
- §9 单方面把措施 b「另立」，而设计 §14 把它钉在 M7 完成判据里（AGY-02 / GLM-04）。

即：抄得对的地方抄对了，设计没覆盖的地方我就当它不存在。
**规范源不完备时，代码现状才是事实来源。**

---

## 0.1 裁决表

| 意见编号 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- |
| AGY-01 | 接受 | 实测命中 5 份归档记录，会锁死本仓库全部提交；`archive.ts:437` 的 `stage !== 'verify'` 守卫是既有设计，我未继承 | §1 AGY-01：读侧分发改为按阶段定义合法集；§6 补两例 verify 用例 |
| AGY-02 | 接受 | 设计 §14 把措施 b 与 AC-N6 钉在 M7 完成判据，§9 单方面另立与 §3.1「无需修订」不能同时成立 | 新增第零步；措施 b 改指派独立演进项，`peer_leak_via_command` 声明可选 |
| AGY-03 | 接受 | 逐处 grep 核实属实，`cfg.critics.<id>` 属性访问共 9 处，`doctor.ts:129/148` 升 v2 后会运行时 TypeError | §4 清单补齐 9 处并加「v2 后是否 TypeError」栏；`agy.ts` 键路径改 `cfg.agents.gemini` |
| AGY-04 | 接受 | 设计 §11 示例含 `claude`（`critic_enabled: false`），我混淆了 Agent 命名空间与审核者集合 | §3.2 约束二改为 `isAgentId` 即可；`criticEnabled` 只约束 `default_critics` 与 `--critics` |
| AGY-05 | 接受 | `cli.ts:559` 确为 `stdout.write(JSON…)`，两侧均核实；我的推断成立但仍是对设计文字的修订 | 并入第零步：设计 §11 改 stderr；次数口径「每次 CLI 调用最多一次」 |
| AGY-06 | 接受 | 未执行的代码路径不产生 diff，仅凭 diff 全绿存在「用没跑到的路径证明兼容性」的虚假感 | §3.5 验收扩为五环节全链路；依赖复用根 `node_modules`，临时目录跑完即删 |
| AGY-07 | 接受 | 已查 `run.v1.json`，`review_mode` 枚举确为 `["dual","single"]`，第 1 步在数据契约层不自洽 | §5 第 1 步范围收窄到内存层；run.json 落盘推迟到第 3 步 |
| GLM-01 | 接受 | 同 AGY-01，并增量指出 `archive.test.ts:51` 只覆盖历史 `run.v1`、未覆盖 `verify-run.v1`，按字面实现会带病通过测试 | 并入 AGY-01 落点；§6 两例按 glm 分类写，并标注「针对会带病通过既有测试的缺陷」 |
| GLM-02 | 接受 | `review.ts:938` 属实；入选非 `{gemini,glm}` 时对 `null` 计算。典型的属性访问漏网，我按白名单自注索引列清单因而漏掉 | §4 清单补入；分歧度改按 `critics_selected` 两两计算，播报与 report 各一处；§6 补断言 |
| GLM-03 | 接受 | `brief.ts:20` 确是封闭两键 interface，放开 `CriticId` 后桩场景编译不过，而 `brief.ts` 不在六件套白名单——零改动判据会打红自己 | `Lenses` 类型泛化列入 §4 第 2 步，须在桩夹具之前完成；对账扩展时以 `brief.ts:20` 为守卫正例 |
| GLM-04 | 接受 | 三处偏离全部属实，(c) 的 run.v2 四字段是我只抄了设计 §6.2 前半句 | 第零步增「设计条款 → 里程碑」对照表（见 §2.2）；四字段 schema 可选、M11 接线 |
| GLM-05 | 接受 | 核实两处原文：README 归档为「不作为实现依据」，文档头部自称「本文不是实现依据」。§3.1 的前提不成立 | 第零步 §2.1，**标记为待项目负责人拍板**；我倾向 (ii) 但不替他定 |
| GLM-06 | 接受 | 设计 §11 的 profiles 全是 `{tier}` 形态，而 `config.v1.json:382` 只收裸 slug、`review.ts:441` 拿不到模型即退 69 | 采纳保守选项：M7b 的 config.v2 schema 暂不接受 `{tier}`，只收裸 slug；差异登记进 §2.2 |
| GLM-07 | 接受 | 「夹具树 diff 夹具树」按构造恒真，是同义反复；并回答了我 §7 第 4 问自己没答的问题 | §3.5 验收改为 overlay 实际触及路径集 ⊆ 白名单 + 五环节全链路；写明桩不触发真实适配器路径 |

---

## 1. 逐条裁决

### AGY-01 · 阻断 —— 接受

**意见**：§3.4 读侧「非 v1 非 v2 即不可读」未排除 verify 阶段，
将把历史与既有 verify 记录全判 unreadable，直接触发 `hook-pre-commit` 锁死提交。

**核实**：属实，且比意见描述的更严重。实测归档 26 份 `run-*.json`，
命中 5 份（4× `verify-run.v1` + 1× verify 目录下的 `run.v1`）。
`archive.ts:437` 的 `stage !== 'verify'` 守卫是既有设计，我完全没有继承。

**落点**：§3.4 读侧分发规则改为**分阶段定义合法集**：

```
审查阶段（plan/code/bug）：
  trivium.run.v1  → v1 校验器，按设计 §6.2 映射为内存中的 v2 形状
  trivium.run.v2  → v2 校验器
  其余（含缺失）   → 不可读，进违例清单

verify 阶段：
  trivium.verify-run.v1 → 照常可读（现行形状）
  trivium.run.v1        → 照常可读，**不施加审查元数据契约校验**
                          （AGY-03 之前落盘的历史形状，见 archive.ts:431 注释）
  其余                   → 不可读
```

关键是「verify 阶段的 `run.v1` 不走审查校验器」这一条——它不是宽容，
是**按写入时的规范解读留痕**，与 §3.4 既有立场一致。

§6 测试表补两例：`verify-run.v1` 现行件照常可读；`verify/` 下的历史 `run.v1`
不被误判。这两例既有 `test/unit/archive.test.ts:51` 只覆盖了后者。

### GLM-01 · 重要 —— 接受

**意见**：同 AGY-01，并指出 `test/unit/archive.test.ts:51-66` 只覆盖
run.v1 标记的历史 verify 记录、未覆盖 `verify-run.v1`，按字面实现会**带病通过测试**。

**核实**：属实。这一点 gemini 没说，是 glm 独有的增量——
它解释了「为什么现有测试拦不住这个 blocker」。

**落点**：并入 AGY-01 的落点。测试补例按 glm 给的两类写，
并在 §6 标注「本例针对的是一个会带病通过既有测试的缺陷」。

### AGY-02 · 重要 —— 接受

**意见**：§9 裁掉措施 b 与设计 §14 的 M7 完成判据、AC-N6、run.v2 的
`peer_leak_via_command` 字段冲突，且未履行回溯修订纪律。

**核实**：属实。设计 §14 的 M7 行原文含「命令文本伪造命中作废（AC-N6）」，
§6.2 的 run.v2 行含 `peer_leak_via_command`。我在 §3.1 声称「无需修订设计文档」
的同时在 §9 单方面改了里程碑归属，两者不能同时成立。

**落点**：新增**第零步：设计修订**（见 §2）。措施 b 与 AC-N6 从 M7 移至
独立演进项，run.v2 的 `peer_leak_via_command` 声明为可选字段。

### GLM-04 · 重要 —— 接受

**意见**：「无需修订设计文档」不完整，至少三处偏离未登记：
(a) 措施 b 的里程碑漂移；(b) §11 的 stdout→stderr；
(c) run.v2 的 `effort_requested`/`effort_effective`/`tier_source`/`profile`
与 guard 逐审核者 map，§3.4 未像 config v2 的 tiers 那样声明分期取舍。

**核实**：三处全部属实。(c) 是我完全漏看的——我只抄了设计 §6.2 的前半句。

**落点**：第零步内增一张「设计条款 → M7b 落地 / 延后至哪个里程碑」清单，
三处显式登记。run.v2 的 effort/tier/profile 四字段按 config v2 的 tiers 同样处理：
**schema 定义为可选，M7b 不写入，M11 接线**。

### AGY-05 · 次要 —— 接受

**意见**：设计 §11 的「stdout 告警一次」会破坏 Hook 的 JSON 协议输出，
我 §3.2 的 stderr 判断正确，但那构成对设计文字的实质修订。

**核实**：属实。`cli.ts:559` 确实 `process.stdout.write(JSON.stringify(...))`。
glm 侧另外核实了 `util/log.ts` 的铁律（`--json` 模式 stdout 只允许单个 JSON、
`warn` 恒走 stderr），佐证方向正确。

我 r2 稿把这条标为「推断，请核」，两侧都核了且都确认。**推断成立，但仍是修订。**

**落点**：并入第零步——设计 §11 的「stdout 告警一次」改为 stderr。

告警次数口径按 glm 的建议定为「**每次 CLI 调用最多一次**，
允许派生的 worker 各打一次」，不引入跨进程状态。

### AGY-03 · 重要 —— 接受

**意见**：§4 欠账清单遗漏 `review.ts:938`、`topic-args.ts:311`、`cli.ts:475`、
`doctor.ts:129/148`、`preflight.ts` 多处、`adapters/agy.ts:180/186/210`。

**核实**：逐处 grep 全部属实。完整的 `cfg.critics.<id>` 属性访问共 9 处：

```
doctor.ts:129/148、adapters/agy.ts:180/186/210、
preflight.ts:80/255/354、review.ts:478
```

`doctor.ts` 两处尤其关键：配置升 v2 迁到 `agents.*` 后会**运行时 TypeError**。

**落点**：§4 清单补齐全部 9 处，并新增一栏标注「v2 迁移后是否会 TypeError」。
`adapters/agy.ts` 的三处可留在白名单内（厂商专属适配器），
但**键路径要从 `cfg.critics.gemini` 改为 `cfg.agents.gemini`**——
豁免的是「出现 gemini 字面量」，不是「读一个已经不存在的配置段」。

### GLM-02 · 重要 —— 接受

**意见**：`review.ts:938` 的 `if (sides.length === 2)` 与
`measureDivergence(reviews.gemini ?? null, reviews.glm ?? null)`：
三审时整块静默跳过；入选两家非 `{gemini, glm}`（如 `--critics glm,codex`）时
`reviews.gemini` 取 `undefined → null`，**对错误对象计算**。

**核实**：属实。这是本轮最典型的「属性访问形态漏网」样本——
`report.ts:231` 我列进了清单，同一形态的 `review.ts:938` 却漏了，
因为我是按 parity 白名单的自注索引列的，而白名单本身没有 `review.ts` 的这一条。

**落点**：并入 §4 清单。分歧度改为按 `critics_selected` 集合**两两计算**
（设计 §7.4 要求逐对 Jaccard），终态播报（`review.ts`）与 report 聚合各一处。
§6 的三审用例补断言：运行末播报含全部两两组合。

### GLM-03 · 重要 —— 接受

**意见**：§3.5 称「`brief.ts:103` 已是动态键查表，无障碍」在类型层不成立：
`brief.ts:20-23` 的 `Lenses` 是封闭的 `gemini`/`glm` 两键 interface，
`lenses[critic]` 合法只因 `CriticId` 现为恰这两值。§4 放开 `CriticId` 后，
桩场景直接编译不过；而 `brief.ts` 不在六件套白名单内，**零改动验收会被自己的判据打红**。

**核实**：属实。`brief.ts:20` 确是 `interface Lenses { gemini: …; glm: … }`。
我 r2 稿那句「无障碍」是只看了 `:103` 的查表写法、没看类型声明。

这条很重要：它说明零改动判据**在当前代码状态下必然失败**，
而失败时最省事的做法就是扩白名单——那正是上一轮被两侧同时点名的反模式。

**落点**：`Lenses` 类型泛化（按注册表键控或索引签名）列入 §4 第 2 步，
必须在桩夹具之前完成。grep 对账扩到裸键/属性访问形态时，
以 `brief.ts:20` 为守卫正例（它是一个「不带引号因而漏网」的真实样本）。

### AGY-04 · 重要 —— 接受

**意见**：§3.2 约束二「`agents` 键必须 `criticEnabled: true`」混淆了
Agent 配置与 Critic 角色。设计 §11 的 v2 示例明确含 `claude`（`critic_enabled: false`）
与 `codex`；且 `claude` 是已启用的 Driver，强行禁止会让 Driver 自身配置无处容身。

**核实**：属实。设计 §11 示例里 `claude:` 条目带 `critic_enabled: false` 赫然在列。
我把「Agent 命名空间」和「审核者集合」当成了一回事。

**落点**：§3.2 约束二改为：

- `agents.*` 的键只要求 `isAgentId(k)`（是已登记 Agent 即可）；
- `agents[k].vendor` 必须等于 `agentById(k).vendor`（这条保留，它防的是路由错配）；
- **只有** `review.default_critics` 与 `--critics` 的每一项才强制
  `criticEnabled: true`。

### AGY-07 · 次要 —— 接受

**意见**：第 1 步声称「不改 schema 修复 §2.1」在数据契约层不可达：
`run.v1.json` 的 `review_mode` 是 `enum: ["dual","single"]`，
记 `single` 违反 AC-N3，记 `dual` 延续缺陷，记 `full` 通不过校验。

**核实**：属实，已查 `run.v1.json`，枚举确为 `["dual","single"]`，
描述还写着「single 即单审降级，必须同时有 degraded_reason（AC-06）」。

**落点**：第 1 步的范围收窄为**内存层解耦 + 不涉及 run.json 落盘的修复**：

- `decideMode` 增 `selected` 入参并改判定（纯函数，不落盘）；
- `GateCheckInput.degraded` 接上真实判定；
- §2.3 的四处二元三目。

`run.json` 真正记录 `review_mode: full` 与 `critics_selected`
**推迟到第 3 步**与 run.v2 一并交付。第 1 步的验收只到「函数返回值正确」，
不断言 run.json 内容——这一点写进 §5 的步骤定义，避免实现时越界。

### AGY-06 · 次要 —— 接受

**意见**：夹具重打包缺依赖闭环（`scripts/build.mjs` 依赖根目录 `node_modules`）
与临时文件清理；且若集成测试只跑 `review --start` 而不跑 `preflight` / `topic resolve`，
`git diff` 全绿只能证明「作者没改核心文件」，不能证明「新增 Agent 时系统零改动即可完整运行」。

**核实**：属实。后半句是要害——未执行的代码路径当然不会产生 diff，
这个判据存在「用没跑到的路径证明兼容性」的虚假感。

**落点**：§3.5 验收扩展为**全链路**：`preflight` → `topic resolve` →
`review --start/--wait` → `gate --check` → `gate --check-artifacts`，
每一步都必须在桩产物上真实通过。依赖解析明确为「复用仓库根 `node_modules`，
夹具只 overlay 源码、不复制依赖树」，临时目录跑完即删。

### GLM-07 · 次要 —— 接受

**意见**：零改动验收的构造基线未定义，存在同义反复：
若以手工搭好的夹具树为比对对象，diff 按构造就是白名单补丁，断言恒真。
并指出诚实的证明边界是「注册表追加 + 六件套补丁 ⇒ 三审全链路可跑」，
**不**证明真实适配器路径（vendor 旗标、轨迹解析、effort 透传）无需核心改动。

**核实**：属实，且这是对我 §7 第 4 问「它证明的到底是什么」的直接回答。
我自己提了这个问题却没给答案，glm 给了。

**落点**：§3.5 验收改写为：

```
夹具 = 未改动的生产检出 + 脚本化 overlay（仅白名单路径）
     → 经同一 scripts/build.mjs 重打包
断言① overlay 实际触及的路径集 ⊆ 六件套白名单
断言② 三审全链路在该产物上通过（AGY-06 的五个环节）
```

断言①比对的是 **overlay 脚本实际触及的路径**，不是夹具树与夹具树的 diff，
消除同义反复。

并在 §3.5 显式写明证明边界：**桩不触发真实适配器路径，M8/M9 才是对真检验**。

### GLM-06 · 次要 —— 接受

**意见**：§3.1 的范围切分成立，但「在场即告警」只覆盖 `agents.<id>.tiers`，
未覆盖 `profiles` 的 `{tier}` / `{model, effort}` 值形态——
而设计 §11 的 v2 示例里 profiles 默认就是 `{tier: high}` 形态。
用户按设计文档写出的合法配置会在 M7b 落到运行期退 69 或静默无模型。

**核实**：属实。设计 §11 的 profiles 段确实全是 `{plan: {tier: high}, …}` 形态，
而 `config.v1.json:382` 现在只收裸 slug 字符串，`review.ts:441` 拿不到模型即退 69。

**落点**：采纳 glm 给的第二个选项（更保守）：
**M7b 的 config.v2 schema 先不接受 `{tier}` 形态**，只收裸 slug，
并在 §3.1 的条款对照表里写明「此处与设计 §11 示例有差异，M11 收口」。

理由：接受一个 schema 层合法、运行期必然失败的形态，正是本项目一贯反对的
「schema 允许但运行时不可用」。宁可 schema 暂时比设计窄，也不要留这个洞。
这一条同样进第零步的设计条款清单。

### GLM-05 · 次要 —— 接受

**意见**：「无需修订设计文档」的前提与文档中心登记矛盾——
`doc/02_design/README.md` 把演进设计归档为「**演进提案（待审，不作为实现依据）**」，
其头部与 §17 均要求实施前回溯修订主设计与 PRD；主设计当前 v1.2.7，
定位仍是固定双审流水线，未见 §17 所列的 v1.3.0 回溯。

**核实**：属实，而且是本轮**最根本**的一条。我核了两处原文：

- `doc/02_design/README.md`：「### 演进提案（待审，不作为实现依据）」，
  条目末尾「**实施前须按纪律 1 回溯修订主设计与 PRD**」；
- 演进设计头部：「**状态**：**提案（Proposal）**……**本文不是实现依据**；
  实施前须按主设计文档 16.2 纪律 1 回溯修订主设计与 PRD，**禁止两套规范并行**」。

我的 r2 稿 §3.1 整节把这份文档当作规范源，逐项对照后宣布「无需修订」。
而这份文档自己说它不是规范源。**这个前提不成立，§3.1 的结论也就不成立。**

顺带说明：M7a 也是按这份提案实施的，同样没有做回溯。这不是本轮引入的问题，
但本轮不该继续扩大它。

**落点**：第零步（§2）处理，并**标记为需项目负责人拍板的一项**——
按 glm 的建议二选一：

- (i) 完成演进设计定稿升版（v0.1.5 → v1.0.0）并更新 README 归档位置；
- (ii) 由项目负责人明确豁免全量回溯，只把 §17 中随 M7b 落地的条目
  摘出来修订主设计。

我倾向 (ii)：全量回溯 §17 清单涉及主设计十余章，工作量与 M7b 本身相当，
而 M7b 只落地其中一部分。但**这是规范纪律问题，不是技术问题，
应由项目负责人裁定**，我不替他定。

---

## 2. 新增第零步：设计修订

r2 稿没有这一步，是 AGY-02 / AGY-05 / GLM-04 / GLM-05 四条共同指向的缺口。

### 2.1 待拍板项（阻塞开工）

**演进设计的准入状态**（GLM-05）：(i) 定稿升版全量回溯，还是
(ii) 只摘 M7b 相关条目修订主设计。**需项目负责人裁定后才能开工。**

### 2.2 设计条款 → 里程碑对照表（GLM-04 要求的登记）

| 设计条款 | 出处 | M7b 落地 | 差异与去向 |
| :--- | :--- | :--- | :--- |
| `agents.*` 配置段 | §11 | 是 | — |
| 内存迁移全兼容 | §11 | 是 | — |
| `default_critics` / `max_critics` | §11 | 是 | — |
| `allow_single_flag → allow_partial_flag` | §11 | 是 | 别名兼容 |
| `critics_selected` / `review_mode: full\|partial` / `driver` | §6.2 | 是 | — |
| v1 读侧映射 | §6.2 | 是 | **须补 verify 阶段分支**（设计未覆盖，代码既有） |
| **「stdout 告警一次」** | §11 | 改为 stderr | **修订设计文字**（AGY-05） |
| **措施 b / AC-N6 / `peer_leak_via_command`** | §14 / §8.2 / §6.2 | 否 | **改指派到独立演进项**；run.v2 字段声明可选（AGY-02） |
| **run.v2 的 `effort_requested` / `effort_effective` / `tier_source` / `profile`** | §6.2 | 否 | schema 定义为可选，M11 接线（GLM-04c） |
| **guard 双侧字段改逐审核者 map** | §6.2 | 部分 | 随 `critics_selected` 泛化，`peer_leak_via_command` 除外 |
| `agents.<id>.tiers` / `models` / `default_tier` | §11 | schema 可选、不接线 | 在场即告警，M11 收口 |
| **`profiles` 的 `{tier}` / `{model,effort}` 形态** | §11 | **否** | **schema 暂不接受，只收裸 slug**，M11 收口（GLM-06） |

加粗行即需要动设计文档的地方。

---

## 3. 修订后的关键设计变更汇总

供实施时直接对照，细节见各裁决条目的落点。

1. **§3.4 读侧分发按阶段分支**（AGY-01 / GLM-01）——最高优先级，
   写错会锁死仓库提交。
2. **§3.2 约束二改为 `isAgentId` 即可**，`criticEnabled` 只约束
   `default_critics` 与 `--critics`（AGY-04）。
3. **§3.2 告警走 stderr**，每次 CLI 调用最多一次（AGY-05）。
4. **§3.1 的 config.v2 schema 不接受 `{tier}` 形态的 profiles 值**（GLM-06）。
5. **§4 欠账清单补 11 处**：`review.ts:938`、`topic-args.ts:311`、`cli.ts:475`、
   `doctor.ts:129/148`、`preflight.ts:80/255/354`、`adapters/agy.ts:180/186/210`、
   `brief.ts:20` 的 `Lenses` 类型（AGY-03 / GLM-02 / GLM-03）。
6. **§5 第 1 步范围收窄**到内存层，run.json 落盘推迟到第 3 步（AGY-07）。
7. **§3.5 零改动验收改为 overlay 路径集比对 + 五环节全链路**，
   并写明证明边界（AGY-06 / GLM-07）。
8. **新增第零步：设计修订**，含一项待项目负责人拍板（AGY-02 / GLM-04 / GLM-05）。

---

## 4. 修订后仍然成立的部分

两侧共同确认、无需改动：

- §2 的四条既有缺陷判定逐行属实（两侧独立核实），
  「先修洞再泛化」的排序正确；
- §2.1 的定性准确——错在留痕不可判、不在允许单审；
  修法用机器可判的 `critics_selected` 而非降级横幅，与 AC-N3 口径一致；
- 迁移策略改回内存迁移，消除了 r1 稿的自举死锁与 Hook fail-open；
- 撤回 `TRIVIUM_TEST_AGENTS` 的两条理由成立；
- 六步分阶段可独立回滚的结构，以及第 3 步回滚风险按真实行为重写；
- §8 自查（禁读集与必读清单无交叉校验）值得另立任务——glm 明确同意。

## 5. 下一步

### 5.1 项目负责人裁定（2026-09-14，计划过闸后）

**§2.1 的待拍板项已裁定：选 (i) 先把演进设计定稿升版。**

即：`2026-09-13-通用Agent编排与动态多审设计.md` 由 v0.1.5 评审定稿为正式版，
移出 `doc/02_design/README.md` 的「演进提案（待审，不作为实现依据）」区，
并按其 §17 清单全量回溯修订主设计与 PRD。完成后它才成为实现依据，
M7b 方可开工。这同时补上 M7a 当时遗漏的回溯。

**实施节奏亦已裁定：本轮 `/dual-run` 到计划过闸为止收口，六步实施另开任务。**
理由：六步一次做完的补丁达 MB 量级（实测 258KB 需 1063s），
且 `failure_policy: strict` 下一侧超时整轮作废，返工成本远高于分轮。
每步自带代码双审。

### 5.2 开工顺序（据上述裁定更新）

1. **第零步**：演进设计定稿升版 + §17 全量回溯修订主设计与 PRD
   （含 §2.2 对照表里加粗的四处设计文字修订）；
2. 第 1 步起按 §5 六步推进，每步独立提交、独立代码双审。

本计划的技术结论不因上述裁定改变；仅第零步的范围由「只摘 M7b 条目」
扩为「全量回溯」。
