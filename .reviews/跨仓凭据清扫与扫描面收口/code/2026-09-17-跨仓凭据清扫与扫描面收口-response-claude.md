---
schema: trivium.disposition.v1
topic: 跨仓凭据清扫与扫描面收口
stage: code
role: claude
kind: response
run_id: 20260917T085105Z
addresses:
  - 2026-09-17-跨仓凭据清扫与扫描面收口-codex.md
  - 2026-09-17-跨仓凭据清扫与扫描面收口-gemini.md
  - 2026-09-17-跨仓凭据清扫与扫描面收口-glm.md
---

# 代码应答：新命令的**账目**没做到它自己要求的那种诚实

## 0. 总裁决：15 条全部接受，零驳回、零暂缓

| 侧 | 结论 | 意见数 |
| :--- | :--- | :--- |
| codex | `approve-with-nits` | 5 次要 + 1 吹毛求疵 |
| gemini | `approve-with-nits` | 1 次要 + 2 吹毛求疵 |
| glm | `approve-with-nits` | 5 次要 + 1 吹毛求疵 |

三侧均判可合入，零阻断、零重要。三份结论全部结构化成功，无降级、无 `parse_fallback`、
无漂移、无对端泄漏。三个焦点方向三侧独立给出同向结论：准入判据确实同源、
二进制删除的论域边界没有误伤回读面、`complete === true` 的旧哨兵自愈成立。

**但十五条意见里有七条指向同一件事，而那件事恰恰是我这一轮的立论。**

### 0.1 三侧独立收敛（一）：我给一个已删掉的函数留了指针

`CODEX-02 ≡ AGY-03 ≡ GLM-01`，三侧各自 grep 后命中同一行。

EV-36 的决议是「连带撤掉刚加的 codex 按名认 sqlite 那份判据」，我删了 `isVendorStateDb`
的定义，却把 `scrubCodexHome` 文档块里那句「见 `isVendorStateDb`」留在原地
（`codex-home.ts:117`）。更糟的是它与**同一文件上方 20 行**新写的注释块正面矛盾——
那段写的是「它们**不在这里按名处理**……按名再写一份判据就是同一件事的第二个实现」。

glm 点名这是 v1.3.13 登记过的「坏指针」形态：引用一个机制之前没核它的实现。
**这一次的版本更难看**：被引用的那个机制是我自己在同一轮里删掉的。

### 0.2 三侧独立收敛（二）：「真跑会跳过」这句话，真跑不成立

`CODEX-03 ≡ AGY-01 ≡ GLM-06`，三条从三个入口指向同一处语义缺口。

我这一轮修 `--dry-run` 时写下的理由是：**「一个会报出真跑不成立的数的预览，比没有预览更坏」**。
然后我自己留下了第二个这样的数。

`sideLayerPending` 只看侧层哨兵，而真跑在 `settled` 分支上**仍然无条件执行 `applyScrub`**
（运行目录那一层没有哨兵，每轮都要复查）。于是：

| 我写的话 | 实际行为 |
| :--- | :--- |
| 「侧层已收工 N 个（哨兵已记完成，**真跑会跳过**）」 | 侧层跳过，运行目录层照做，`request.json` 可能被就地脱敏 |
| 「本会抹 N 个」（dry-run） | 只预测了侧层那一半 |
| 「已抹除 N 个运行目录的**凭据副本**」 | 判据含 `r.runDir.redacted`，只脱敏了交接包、一份载体没碰的目录也计入 |

gemini 把它推到了最锋利的形态（AGY-01）：一个**没有任何侧子目录**的运行目录，
`sideLayerPending` 返回 false → 预演记 `settled`、终端显示「真跑会跳过」，
而真跑会脱敏它的 `request.json` 并把它计进 `scrubbed`。预演与真跑在同一个目录上
给出**两个相反的结论**。

我上一条修的是「预览多报」，这一条是「预览漏报」——同一个根因的两面，我只修了看得见的那面。

### 0.3 我刚修掉的缺口，在上一级原样存在（CODEX-01）

`scrubRunDir` 里「运行目录 `readdir` 失败静默 `return {}`」是我这一轮亲手修的，
并为此写了一段注释：「调用方的三个计数全不增长、该目录在待办里完全不出现」。

同一形状的 `catch { continue; }` 就在 `scrubAllRunRoot` 的**桶级**循环里，一行没改。
整个项目桶读不了 → 该桶不进论域 → 其中未抹的凭据副本不出现在任何一格 →
命令照常报 `ok: true` 与「没有需要抹的凭据副本」。

**这条最值得记**：我在一处认出了缺口形态、写下了它为什么危险，然后没有回头看同一个
函数的上一层有没有同一个形态。修缺口和认缺口是两件事，我只做了后者。

### 0.4 账目不闭合（GLM-04）

`visited` 与各分档之和对不上。准入未过**且 status 可读**的三类目录哪一格都不进：
`phase=starting`（副本可能正在写下）、非终态但拿不到 pid、终态但进程现势仍活。
`workerStillAlive` 对这三类都返回 false（不计 `alive`），`status` 存在（不计 `unknown`），
`admitScrub` 直接 return false（不进 `eligible`/`settled`）。

不抹它们是 EV-20 的既定安全决策，**问题只在不可见**——而新命令的人读输出自称是全景
（「运行目录 N 个 ｜ 进行中跳过 M 个」）。其中 `starting` 类目录可能已经写下了凭据副本
（准备阶段崩溃），对所有入口都不可见地躺到 TTL。

### 0.5 设计断言过度推广（CODEX-05）

我在 v1.3.16 变更行里写了「`complete` 从此没有永不收工的成因」。这是全称断言，不成立：
`redactUnder` 面下的二进制仍记 `skipped`（那个分支是我刻意保留的，还写了用例断言
「仍未脱敏，仍不能据此收工」），超大文件两侧也仍跳过。

codex 指出这与本项目「凡写下『不会再有』必须指出对应排除面」的纪律同域。
**我在同一份改动里既保留了排除面、又写下了不含排除面的断言**——两者相隔不到二十行。

---

## 1. 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | 次要 | 接受 | 已核实：`retention.ts` 桶级 `catch { continue; }` 不向 `out` 记任何东西，整桶失联而命令报 ok。与我本轮在 `scrubRunDir` 修掉的缺口同形，只是高一层 | `SweepResult` 增 `unreadableBuckets: string[]`，桶级 catch 记账；`cmdScrub` 渲染一行；补桶读失败仍上报的用例 |
| CODEX-02 | codex | 次要 | 接受 | 已核实：全仓 grep 仅命中 `codex-home.ts:117` 的注释本身，无定义无测试；且与同文件上方注释块正面矛盾。三侧独立收敛 | `codex-home.ts:117` 把「见 `isVendorStateDb`」改指 `scanAndRemoveSecrets` 的论域内二进制整删规则 |
| CODEX-03 | codex | 次要 | 接受 | 已核实：`settled` 分支之后无条件 `applyScrub`，运行目录层每轮复查。「真跑会跳过」只对侧层成立 | `cmdScrub` 的 settled 行限定为「侧层真跑会跳过，运行目录层仍复查」；USAGE 与 `SweepResult.eligible` 文档写明 dry-run 只预测侧层 |
| CODEX-04 | codex | 次要 | 接受 | 已核实：`applyScrub` 因 `r.runDir.skipped > 0` 也记 incomplete，而该层刻意不写哨兵，「详见该侧的 scrub.json」对这条成因是死指针 | 与 GLM-03 合并修：`incomplete` 改记 `{ dir, detail? }`，`cli.ts` 与 `hooks.ts` 按成因分流文案 |
| CODEX-05 | codex | 次要 | 接受 | 已核实：`redactUnder` 下的二进制与超大文件仍能让 `complete` 为 false，我自己的用例就在断言这一点。全称断言不成立 | 设计 v1.3.16 第六条与 §10.5 收窄为「论域内（非回读面、非上限内）的二进制不再有收工成因」；BACKLOG 补登 `redactUnder` 二进制这一残留成因 |
| CODEX-06 | codex | 吹毛求疵 | 接受 | 方向成立且未实测，reviewer 自陈低置信度并明言「不必本轮实施」。`workerConfirmedGone` 确实只核 worker 本身，`killTree` 只在超时/取消链路执行；跨仓清扫把触发面扩大，窗口确实变大。按「登记边界」处置，不本轮加固 | BACKLOG 新增一条 EV 登记该限制；`scrubAllRunRoot` 文档块的「边界」小节补一句证据强度说明 |
| AGY-01 | gemini | 次要 | 接受 | 已核实：零侧目录 `sideLayerPending` 返回 false → 记 `settled`，而真跑仍 `applyScrub` 并可能脱敏 `request.json` 计入 `scrubbed`。预演与真跑在同一目录上结论相反，是 CODEX-03 的最锋利形态 | 与 CODEX-03 / GLM-06 合并修：`scrubbed` 拆为「抹了凭据载体/命中删除/侧层脱敏」与「仅运行目录层脱敏」两格，文案随之分开；eligible/settled 明确标注只论侧层 |
| AGY-02 | gemini | 吹毛求疵 | 接受 | 与 CODEX-04 同指，`request.json` 超 `sizeCap` 时各侧哨兵的 `complete` 均为 true，用户按指引翻侧层 scrub.json 一无所获 | 同 CODEX-04 / GLM-03 的合并修 |
| AGY-03 | gemini | 吹毛求疵 | 接受 | 与 CODEX-02 / GLM-01 同指同一行悬空引用 | 同 CODEX-02 |
| GLM-01 | glm | 次要 | 接受 | 与 CODEX-02 / AGY-03 同指；glm 额外点明这是 v1.3.13 登记过的「坏指针」形态复发 | 同 CODEX-02 |
| GLM-02 | glm | 次要 | 接受 | 已核实：`PROTOCOL` §九命令表逐条枚举了全部子命令而无 `scrub`；AGENTS.md 同步清单明文要求 CLI 变更同步 PROTOCOL。退出码恒 0 是刻意契约，两处都无记载。另核实 `MANUAL §4.9 直接调 CLI 的命令` 与 RUNBOOK 的运维命令面都是 `scrub` 该在的位置 | `PROTOCOL` §九补 `scrub [--dry-run] [--json]` 行（含「只抹凭据不删目录、退出码恒 0、判据与会话启动清扫同源」摘要）；§五退出码契约补一句；`MANUAL §4.9` 与 `RUNBOOK` 各补一处 |
| GLM-03 | glm | 次要 | 接受 | 已核实：`RunDirLayerScrub.warnings` 构造了但全仓零消费方——`applyScrub` 只读 `errors[0]`/`skipped`/`redacted`，`cli.ts` 与 `hooks.ts` 只渲染长度。我这一轮把「计数」接通了，「细节」仍断在半路。这是我本轮反对的那个形态本身 | 与 CODEX-04 / AGY-02 合并修：`ScrubTally.incomplete` 改记 `{ dir, detail? }`，运行目录层成因把 `runDir.warnings[0]`（含文件名）带进人读行 |
| GLM-04 | glm | 次要 | 接受 | 已核实：`admitScrub` 对 `gone:false` 且 status 非空的目录直接 return false 不记任何计数，三类（starting / 判不了 / 终态但进程仍活）哪一格都不进，`visited` 与各档之和对不上。starting 类可能已写下副本却对所有入口不可见 | `SweepResult` 增 `deferred: string[]`，`admitScrub` 在 status 非空时计数；`cmdScrub` 输出一行「N 个目录准入未过（starting／状态判不了／进程仍在），未动」；补用例 |
| GLM-05 | glm | 次要 | 接受 | 已核实：`sizeCap`（`scrub.ts:253`）先于二进制判定（`:260`），顺序正确但无用例锁住；现有超大夹具是纯文本、二进制夹具都远小于上限。两段判定对调则一份超大二进制会从「跳过」变「整删」而全部既有测试照旧全绿 | `credential-scrub.test.ts` 补用例：一份超过 `sizeCap` 且前 8 KB 含 NUL 的文件，断言 kept、warnings 命中「超大文件」、不进 `unscannableRemoved` |
| GLM-06 | glm | 吹毛求疵 | 接受 | 已核实：`scrubbed` 判据含 `Object.keys(r.runDir.redacted).length > 0`，而 `cli.ts` 与 `hooks.ts` 文案都是「凭据副本」——话比事实强。与 CODEX-03 / AGY-01 同根 | 同 AGY-01：`scrubbed` 拆两格，文案分开；`retention.test.ts` 的「预览=真跑」断言补上运行目录层不干净的形态 |

---

## 2. 修改方案（审批后执行）

九条意见合并为**六个修改批次**，按依赖顺序排列。

### 批次 1 · 悬空引用（CODEX-02 ≡ AGY-03 ≡ GLM-01）

`codex-home.ts:117` 的「见 `isVendorStateDb`」改指 `scanAndRemoveSecrets`。一行。

### 批次 2 · 三格语义闭合（CODEX-03 ≡ AGY-01 ≡ GLM-06）

根因是**预览与真跑覆盖的层不同**，而我的文案按「同一件事」写。不打算让预览去读运行目录层
内容来对齐（那要读三份文件的正文，成本与「预览不动盘」的承诺都不划算），改为**让账目
如实反映两层**：

- `SweepResult.eligible` / `settled` 文档与人读文案明确限定「侧层」；
- `ScrubTally.scrubbed` 拆为 `scrubbed`（载体删除／命中删除／侧层脱敏）与
  `runDirRedacted`（仅运行目录层脱敏）两格；
- `cli.ts` 与 `hooks.ts` 的「已抹除 N 个运行目录的凭据副本」按两格分行。

AGY-01 的零侧目录在此口径下自洽：侧层无活记 `settled`，真跑脱敏 `request.json` 计入
`runDirRedacted` 而非 `scrubbed`，两处不再打架。

### 批次 3 · 可见性（CODEX-04 ≡ AGY-02 ≡ GLM-03）

`ScrubTally.incomplete` 由 `string[]` 改为 `{ dir: string; detail?: string }[]`：
侧层成因 detail 留空（沿用「详见该侧的 scrub.json」），运行目录层成因带上
`runDir.warnings[0]`。`cli.ts` 与 `hooks.ts` 按 detail 有无分流文案。

### 批次 4 · 账目闭合与桶级静默（GLM-04 + CODEX-01）

两条都是「某一类对象不进任何一格」，合并处理：

- `SweepResult` 增 `deferred: string[]`（准入未过且 status 可读）与
  `unreadableBuckets: string[]`（桶 stat/readdir 失败）；
- `admitScrub` 在 status 非空时把目录记进 `deferred`；桶级 catch 记 `unreadableBuckets`；
- `cmdScrub` 各补一行；补两条用例。

### 批次 5 · 测试补齐（GLM-05）

超大二进制用例：断言 kept、命中「超大文件」告警、不进 `unscannableRemoved`。
这条锁的是 `sizeCap` 与二进制两段判定的**顺序**，而顺序目前只由代码约定保证。

### 批次 6 · 文档同步与断言收窄（GLM-02 + CODEX-05 + CODEX-06）

- `PROTOCOL` §九补 `scrub` 行、§五补退出码恒 0 的契约说明；`MANUAL §4.9`、`RUNBOOK` 各补一处；
- 设计 v1.3.16 第六条与 §10.5 把「`complete` 从此没有永不收工的成因」收窄为
  「**论域内（非回读面、非上限内）**的二进制不再有收工成因」；
- BACKLOG 补登两条：`redactUnder` 下二进制的残留收工成因（CODEX-05）、
  跨仓清扫同样信任 `workerConfirmedGone`／孤儿子进程未复核（CODEX-06）。

全部批次完成后重跑 `npm run check`，并 `install:local` 后真跑一次 `trivium scrub --dry-run`
与 `trivium scrub`，核对新增的四行人读输出与实际盘上状态一致。

---

## 3. 本轮方法教训

**三条，都不是技术判断失误，是同一种工作方式的失误。**

**一、我为一个缺口写下了它为什么危险，然后没有在同一个函数的上一层找它。**
`scrubRunDir` 的 `readdir` 静默返回是我这一轮亲手修的，注释里还写清了后果；
`scrubAllRunRoot` 的桶级 `catch { continue; }` 隔着三十行，一行没动（CODEX-01）。
**认出一种缺陷形态之后，下一步应该是把这种形态当查询条件扫一遍本轮的改动面**，
而不是修完手上这一处就往下走。

**二、我把「预览多报」当成了完整的问题，而它只是一半。**
修 `--dry-run` 时我的理由是「一个会报出真跑不成立的数的预览，比没有预览更坏」——
这句话对漏报同样成立，而我留下了漏报（AGY-01）。
**写下一条判据时，要对它的两个方向各问一次**，不能只问逼着我修的那一个方向。

**三、断言与它的排除面写在同一份改动里，却相隔二十行没有互相核对。**
我保留了 `redactUnder` 二进制的跳过分支、还为它写了「仍不能据此收工」的断言，
然后在设计文档里写下「`complete` 从此没有永不收工的成因」（CODEX-05）。
**凡写「从此不会再有」，落笔前要把本轮亲手保留的例外数一遍。**

另记一条与技术无关的：本轮十五条里有七条是**留痕失实**（悬空引用、文案与行为矛盾、
死指针、过度推广），而不是代码错误。三侧一致判 `approve-with-nits` 说明代码是对的——
**错在我对「这件事我做完了」的描述，比我实际做完的多。**
