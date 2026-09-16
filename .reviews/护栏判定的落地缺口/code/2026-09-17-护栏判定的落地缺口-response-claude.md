---
schema: trivium.disposition.v1
topic: 护栏判定的落地缺口
stage: code
role: claude
kind: response
run_id: 20260916T154758Z
addresses:
  - 2026-09-17-护栏判定的落地缺口-gemini.md
  - 2026-09-17-护栏判定的落地缺口-glm.md
  - 2026-09-17-护栏判定的落地缺口-codex.md
---

# 代码应答：护栏判定的落地缺口

## 0. 总裁决：14 条全部接受，零驳回

| 侧 | 结论 | 意见数 |
| :--- | :--- | :--- |
| gemini | `request-changes` | 2 阻断 + 3 重要 + 1 次要 |
| glm | `request-changes`（**证据不足**，见 §0.4） | 2 阻断 + 3 重要 + 2 次要 |
| codex | **`block`**（解析降级，不参与阻断判定） | 原文 2 阻断 + 4 重要 + 3 次要 + 1 吹毛求疵 |

**三侧独立收敛到同样两条阻断，而这两条合起来的意思是：本批的两项核心改造，
在生产路径上一行都没生效。**

### 0.1 阻断一：分类接在了错误的粒度上，误伤逐字保留

我实测复现了（用生产函数跑真实 deny 集里的条目形状）：

```
.trivium                → peer-artifact  作废=true   ← 禁读集里存的就是它
/home/me/.trivium/runs  → peer-artifact  作废=true   ← 同上
.trivium/state.json     → orchestrator-state  作废=false  ← 而我的测试测的是这个
```

`path.relative(triviumDir, triviumDir)` 返回**空串**，被我写的 `if (rel && …)`
判成 falsy 跳过，一路落到兜底 `peer-artifact`（最重档）。
而 `enumerateDenyPaths` 往集合里放的正是**整棵目录条目**。

于是：整棵编排器目录与整棵运行根进 `voidingPaths` → 前缀匹配 →
**读其中任何一个子文件都判作废**。四类分档、具名放行、②′ 豁免——
**三项一次都不会生效，本批要修的四次误伤逐字保留**。

更难看的是 BRIEF：§8.1 把整棵目录列进「读取即作废」，§8.2 的引导语却写着
「项目级配置与 wrapper 是允许读的」——**同一份任务书里自相矛盾**，
而审查员按引导语去读，就会被判作废。

**测试为什么全绿**：`deny-category.test.ts` 测的是纯函数、喂的是**叶子路径**；
`brief.test.ts` 构造的 `denyPaths` 也是 `.trivium/state.json` 这种文件级形状——
**而 `enumerateDenyPaths` 从不产出这种形状**。这是「测了个生产路径走不到的东西」，
与我在提交 1 里刚写过纪律的那个形态一模一样（守卫还在、守的东西不对）。

### 0.2 阻断二：作废侧排除与三态字段整段没接线

三侧都查到，我逐条核实：

| 事实 | 核实结果 |
| :--- | :--- |
| `voidedSides` 的生产调用方 | **零处**——`gate.ts` 之外全仓没有任何地方传它 |
| `guard.joint_check` 的写侧 | **零处**——只有 `types.ts` 的类型定义 |

于是：作废侧排除**从未在生产生效**，`joint_check_degraded` 告警从生产与测试
两侧都不可达，三态字段恒缺失。

而 codex 点出最刺眼的一处：**渲染出的作废横幅已经写着「本侧不计入共同阻断的
独立来源」——那句话现在是假的。** 设计 §6.7.1 也写着该字段「写侧恒写、已实现」。

**「判定层做对了事、消费层没接住」——这一批的立论，在这一批自己的交付里复发了。**

### 0.3 我在这一批里重复了自己刚立的两条纪律所禁止的事

- 提交 1 的教训是「守卫守错了东西」，我在这一批里**测了生产路径走不到的形状**；
- 本主题的立论是「声明了但没有代码让它成真」，我**在设计里写下「已实现」而写侧为空**。

两条都不是新错误，是**同一轮里刚写完纪律、下一个提交就犯**。

### 0.4 关于 glm 侧的证据计数

glm 的 `evidence_ok: false`（`read: 1`、`grep: 1`），按 §11.4 它「不得计为合格双审的一半」。
**但它的意见我逐条核实，全部成立且行号精确**——它的 `project_reads` 是 23，
说明读取确实发生了，只是没走那两类工具通道。

**这与 §0.1 的缺口是同一族**（计数通道与实际行为对不上），已记入修复清单：
证据阈值的计数口径本身需要单独核一遍。本裁决按 FR-14 逐条裁决它的意见，
不因证据档位而降权——**档位影响的是「能否计为一半」，不是「说得对不对」**。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | **实测复现，见 §0.1**。`path.relative` 对目录条目自身返回空串，被 `if (rel && …)` 跳过后落到兜底最重档。分档、放行、②′ 豁免三项全部失效，而单测因为喂的是叶子路径全绿 | 分类与放行**改在命中时按 hit 路径判**（设计 §10.1.1 原话就是「匹配时豁免」）；补一条用 `enumerateDenyPaths` **真实输出**喂 `judgeSide` 的用例 |
| GLM-01 | glm | blocker | 接受 | 与 AGY-01 ≡ CODEX-01 三侧独立收敛，且它把链路追得最全：从 `enumerateDenyPaths` 的条目形状、到 `classifyDenyPath` 的空串、到 `isOrchestratorReadable` 同样只对条目调用、到 `checkPeerLeak` 前缀命中、到 `peerArtifactRead` 置真，每一环带行号。它还点出**两处我没想到的自证**：①BRIEF §8.1 与 §8.2 自相矛盾；②`typedHits` 会记 `category: orchestrator-state` 而该侧正是被这些命中作废的——**留痕自己就能证明处置错了** | 同 AGY-01；BRIEF 两节的分档随判定一并改对 |
| AGY-02 | gemini | blocker | 接受 | **核实为真**：`joint_check` 全仓只有 `types.ts` 的类型定义，`review.ts` 的 `meta.guard` 构造里没有它。而设计 §6.7.1 写着「写侧恒写 · 已实现」、§12.1 承诺「run.json 与审查文档头部同时可见」——**两处都不成立** | `review.ts` 在 `meta.guard` 落 `jointCheckState` 三态；`render.ts` front-matter 补该字段；补一条「写侧恒写」的契约用例 |
| GLM-03 | glm | blocker | 接受 | 与 AGY-02 ≡ CODEX-02 收敛，且**比 AGY-02 多查一层**：`voidedSides` 的两个生产调用点（`--await-approval` 与 `--check`）都不传，我 grep 核实**全仓零处**。于是作废侧排除从未生效、`joint_check_degraded` 从生产与测试两侧都不可达。它指出的「纯函数单测守不住『参数没接上』这一形态」正中要害——我写的三态用例全是直接调纯函数 | `cli.ts` 两处从 run 元数据的 `peer_leak_via_*` 派生 `voidedSides` 传入；补**契约用例**守 cli 传参，不能只有纯函数单测 |
| AGY-03 | gemini | major | 接受 | **实测复现**：`<运行根>/<repoId>/<runId>/request.json` 的第三段是文件名而非侧名 → 判 `peer-run-output` → 作废。而设计 §10.1.1 的 ②′ 行**逐字点名** `request.json` 与 `worker.log` 属己方材料 | ②′ 判据扩为「该 runId 目录下的编排器运行时文件 + 己方侧子树」 |
| GLM-02 | glm | major | 接受 | 与 AGY-03 ≡ CODEX-06 收敛。它多说了一句关键的：**即使修好 AGY-01 的条目粒度，这两个文件的命中仍会独立造成误伤**——尤其经命令通道（命令里出现运行根前缀即命中）。所以这是两个独立缺陷，不是同一个的两种表现 | 同 AGY-03 |
| AGY-04 | gemini | major | 接受 | **这条最讽刺**：我为避免假阳性把搜索类排除出分母，而 `grep_search`（`SearchPath`）、`find_by_name`（`SearchDirectory`）、`list_dir`（`DirectoryPath`）**都是必带路径的**——EV-28 的历史根因正是 `grep_search` 提出 0 条路径。**我把唯一发生过的真实退化形态排除在探测器之外了** | `AGY_MUST_HAVE_PATH` 扩为四个必带路径的读工具；zcode 侧对称采集 |
| GLM-04 | glm | major | 接受 | 与 AGY-04 ≡ CODEX-05 收敛，且指出两处我没想到的：①`total === 0`（该轮没有 `view_file` 调用）时恒 `ok`——**纯 grep 轮次完全没有探测面**；②注释宣称「防得住参数改名」而实际只对一个工具成立，正是 v1.3.8 立的「凡写下『防得住』就指出断言在哪一行」要拦的形态 | 同 AGY-04；并按实际覆盖面**收窄注释与设计 §10.1.1 第②层的承诺**，不让留痕声称一个不存在的覆盖 |
| GLM-05 | glm | major | 接受 | 核实为真：`path_bearing_reads` 全仓只有 agy 适配器生产，zcode 不产 → `undefined` → 恒 `ok`。而我那行注释写的是「不知道就别说『有效』」——**注释与实现直接相反**，`return 'ok'` 恰恰是在拿 `ok` 填「不知道」。三态纪律的又一次换侧复发 | zcode-trace 补同构计数；接上之前该侧**如实记未知**，不得用 `ok` 顶替 |
| AGY-05 | gemini | major | 接受 | 核实为真：`notedPaths.push(...viaPath.hits)` 丢掉了 `viaCmd.hits`。而 command-trace 一族（codex）**只有命令通道**，于是该族的告警档命中恒无明细 | noted 收集同时追加命令通道的命中，与作废类的双通道分列对称 |
| GLM-06 | glm | minor | 接受 | 与 AGY-05 ≡ CODEX-03 收敛，且指出不对称的本质：作废类是双通道分列落盘，非作废类单通道——**同一份留痕里两套口径** | 同 AGY-05 |
| GLM-07 | glm | minor | 接受 | 核实为真：`peerLeakOf` 把 `category` 硬编码成 `'peer-artifact'`，命中第②类时 front-matter 报第①类。注释写「取最重档」而实现是布尔短路的字面量兜底——**注释描述的是一件没做的事** | `category` 从 `typedHits` 的实际类别里取最重档；多类并存时考虑改为类别数组 |
| AGY-06 | gemini | minor | 接受 | 核实为真：有效侧因 `parse_fallback` 而非作废不足两家时，告警文案仍写「排除作废侧后…」——**归因失实**。这条在本轮就能复现：codex 侧正是 `parse_fallback` | `jointCheckState` 的返回区分「因作废排除」与「因解析降级」，告警话术分别对应 |
| CODEX-F01 | codex | fallback | 接受 | 降级件（整份一个单元），原文含 CODEX-01～10，**逐条核后全部接受**。**CODEX-01 / 02** 与另两侧的两条阻断独立收敛，且它判 `verdict: block`（比另两侧更重）——我认为这个判法是对的：两项核心改造均未生效，不该只算「请修改」。它点出最刺眼的一处：**渲染出的作废横幅已写明「本侧不计入共同阻断的独立来源」，而那句话现在是假的**。**CODEX-03**：除丢弃命令通道明细外，多指出 `notedCategories`/`notedPaths` **没有任何运行期出口**——`renderGuardWarnings` 只播报 `peerArtifactRead`、`report.ts` 只认 `peer_artifact_read`，而 BRIEF 新文案向审查员承诺「编排器会记一条告警」；v1.3.9 定的「留痕五面」这里只有两面。**CODEX-04**：与 GLM-07 同构，多指出非作废侧取 `notedCategories[0]`（Map 插入序）同样失真，「取最重档」在两条路径上都没实现。**CODEX-05**：与 AGY-04/GLM-04 同构，把分母消失的**三种**形态列全（工具改名、本轮无该工具调用、该侧没报数），三种都落回 `ok`。**CODEX-06**：与 AGY-03/GLM-02 同构，并多给一条我完全没想到的——`classifyDenyPath` 用裸 `path.relative`，而 `checkPeerLeak` 用 `normalizeAbs`（剥 `/private`），**macOS 的 `/var` ↔ `/private/var` 双形态会让两者判在不同的根上**，匹配通道命中而分类通道判在根之外，又一次落回兜底最重档。**CODEX-07**：三处入口的**可观测形状不一致**——`--await-approval` 的 JSON 有 `state: 'unchanged'`，`--check` 两个分支只 `say()`（JSON 模式降级到 stderr），机读 payload 与正常推进后**完全同形**；且 `test/` 下没有任何一条用例经 `gate` 命令走到这三个分支。**CODEX-08**：`gate --check` 现在有第三种去向，而 PROTOCOL 契约文档原文仍写「两种去向都必须发生」，一字未改。**CODEX-09**：`humanDecidedThisRound` 命中就完全不碰本机状态——若本机状态已被别的路径推到非终态，`--check` 会打印「闸门状态保持不变」并退 0，而写锁按本机状态判，**用户仍然提交不了、却收到一句「一切正常」**；分叉没被消除，只是从「被推进」变成「被维持」。**CODEX-10**：我在测试注释里写「四条里最该优先处理的」而实际是七条（BACKLOG 写的是七条）——**改数量时漏了一处**，而这个仓库刚立过「记不清就不要写数字」的规矩 | CODEX-01/02→§2 的两条阻断；CODEX-03→并入 AGY-05 落点，并补运行期出口（`renderGuardWarnings` + 复盘标记）；CODEX-04→并入 GLM-07；CODEX-05→并入 AGY-04；CODEX-06→并入 AGY-03，**另加归一化口径统一**（两处都走 `normalizeAbs`）；CODEX-07→三处入口的机读形状统一，补经 `gate` 命令的端到端用例；CODEX-08→同步 PROTOCOL 与 SKILL.md；CODEX-09→`--check` 已表态时对账本机状态，不一致就如实报告而不是说「保持不变」；CODEX-10→改正数字 |

## 2. 修复清单（审批后执行）

**分两批**：先修两条阻断（它们让本批的核心改造真正生效），再修其余。

### 2.1 第一批：让分类与排除真正生效

| # | 落点 | 改什么 |
| :--- | :--- | :--- |
| 1 | `guard.ts` + `freeze.ts` | 分类与放行**改在命中时按 hit 路径判**，不再按 deny 条目预分组；两条通道的命中各自过一遍分类与放行 |
| 2 | `freeze.ts` | `classifyDenyPath` 处理「路径等于根本身」（`rel === ''`）的情形；归一化改用与 `checkPeerLeak` **同一个** `normalizeAbs`，消掉 `/private` 双形态的分叉 |
| 3 | `freeze.ts` | ②′ 判据扩为「该 runId 目录下的编排器运行时文件（`request.json` / `worker.log` / `worker.pid` / `status.json`）+ 己方侧子树」 |
| 4 | `cli.ts` | 两处 `checkAdjudication` 从 run 元数据派生并传入 `voidedSides` |
| 5 | `review.ts` + `render.ts` | `meta.guard` 落 `joint_check` 三态；front-matter 补该字段 |
| 6 | 测试 | **用 `enumerateDenyPaths` 真实输出喂 `judgeSide`** 的端到端用例；守 `cli` 传参的契约用例；经 `gate` 命令走三处入口的用例 |

### 2.2 第二批：留痕与承诺对齐

| # | 落点 | 改什么 |
| :--- | :--- | :--- |
| 7 | `agy-events.ts` + `zcode-trace.ts` | `AGY_MUST_HAVE_PATH` 扩为四个必带路径的读工具；zcode 侧对称采集计数 |
| 8 | `guard.ts` | 分母为空/该侧没报数时**如实记未知**，不得返回 `ok`；注释与设计 §10.1.1 第②层的承诺按实际覆盖面收窄 |
| 9 | `guard.ts` + `review.ts` | noted 收集补命令通道明细；非作废命中补运行期出口（告警 + 复盘标记） |
| 10 | `review.ts` | `peerLeakOf` 的 `category` 从实际命中取最重档 |
| 11 | `gate.ts` | `jointCheckState` 区分「因作废排除」与「因解析降级」，话术分别对应 |
| 12 | `cli.ts` | 三处入口机读形状统一；已表态时对账本机状态，不一致如实报告 |
| 13 | 文档 | PROTOCOL 与 SKILL.md 同步第三种去向；设计 §6.7.1 的「已实现」在接线后才成立；测试注释的数字改正 |
| 14 | 待议 | 证据阈值的计数口径（§0.4）——glm 侧 `project_reads: 23` 而 `read: 1`，两个通道对不上，需单独核 |

## 3. 方法教训

**教训一：我测的形状，生产路径走不到。**
`classifyDenyPath` 的九条用例全绿，而它们喂的是叶子路径；生产喂进去的是目录条目。
纯函数测对了，接线处错了——**而纯函数测试天然看不见接线**。

> **新增一条**：凡新增一个「判定 + 接线」的组合，**至少一条用例要从生产的入口喂数据**
> （这里是 `enumerateDenyPaths` 的真实输出），不能全用手工构造的输入。
> 手工构造的输入反映的是我以为的形状，而缺陷恰恰住在「我以为」和「实际」的差里。

**教训二：`voidedSides` 这个参数我加了、测了、没接。**
纯函数单测三条全绿，而生产零调用。glm 说得准：「纯函数单测守不住『参数没接上』这一形态」。

> **新增一条**：给既有函数**加一个可选参数**时，同一个提交里必须有一条用例
> 断言「生产调用方确实传了它」——可选参数的默认值会让漏传**静默成功**，
> 这正是本项目反复修的那一族缺陷的形状。

**教训三：这一批的立论，在这一批自己的交付里复发了两次。**
「声明了但没有代码让它成真」——我在设计里写下 `joint_check`「写侧恒写 · 已实现」而写侧为空；
在横幅里写下「本侧不计入共同阻断的独立来源」而排除从未生效。

> 上一个提交刚写完「守卫守错了东西」的纪律，下一个提交就犯。
> **纪律写进文档不等于纪律生效**——这句话本身就是这一批要修的那个病的元层表述。
