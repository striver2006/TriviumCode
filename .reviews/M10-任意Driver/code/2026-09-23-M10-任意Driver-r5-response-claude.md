---
schema: trivium.disposition.v1
topic: M10-任意Driver
stage: code
role: claude
kind: response
run_id: 20260923T125723Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - GLM-01
  - GLM-02
---

# 应答：M10a 第 4 步（登记清理 EV-62 / EV-64 / EV-07）代码双审 第 5 轮

> 被审对象：相对 `21f189a` 的 18 个文件变更，补丁 111.0 KB ｜ 运行 `20260923T125723Z`
> ｜ 三侧均结构化产出 ｜ 结论：gemini `approve`，codex 与 glm `approve-with-nits`
> ｜ 共 5 条：次要 2 ｜ 吹毛求疵 3 ｜ 无阻断、无重要
> ｜ **全部接受**

## 总述

四个焦点，三侧的正面结论一致：

- **EV-62 的取值来源**：两个写点与 `overrideReasonFor` 函数体都取当轮 Driver；注释与文案都把启发式写成了启发式。
- **接线判据**：codex 把 `heterogeneousWiringViolations` 抽出来，在真实 `review.ts` 上实跑，结果为空（不假红）；六个退化变体全部报出。
- **闸 7 与哨兵拆分**：顺序在工作树任何写盘之前，两处兜底只拒不放。D3 / D4 的承重断言与条件性断言分工说准了。
- **报告与登记**：偏差、缺口、EV-07 结案段、`why` 改写，事实都核实属实。

5 条意见全部落在「说准」这一层，没有行为缺陷。分三类：

1. **一处前提指错了地方（CODEX-01）。** `overrideReasonFor` 的文档块说非空断言靠「入口经 `resolveDriver` 判定过」。核对属实：worker 分支在 `cmdReview` 里直接返回，根本不过 `resolveDriver`。
   真正托住断言的是 **run.v2 校验**：
   - 同步路径：`prepareRun` 里 `writeRunMeta` 落盘前调 `validateRunMeta`；
   - worker 路径：`rebuildContext` 里 `readRunMeta` 读回时调 `validateRunMeta`，读不过即返回 null 并抛错。
   
   两条路径的 `validateRunMeta` 都会调 `checkAgentIdentities`，它要求 `driver` 是已登记 id。写点都在 `executeRun` 里，排在两者之后。
   这又是一次「写下前提却没对着代码核」，形态与第 3 步 r4 的 GLM-02 同族：说对了结论，说错了依据。
2. **文案多说了半分（CODEX-02、CODEX-03）。**
   - 装置拒绝文案写「在任何写盘之前」，而临时备份目录的 `mkdtemp` 排在闸 6、闸 7 之前；
   - 渲染旗标的标题仍是确定性的「与主脑同源」，而这一格是检出，不是证明。
   
   后者正是本步把正文从「本侧使用了 Claude 系模型」改掉的理由，标题那一半没跟上。
3. **留痕数字与标题失实（GLM-01、GLM-02）。**
   - BACKLOG EV-62 结案段写「变异 7 条」，报告里 M62 系是 8 条；
   - 装置头注释标题写「五道闸」，而闸表已有 7 行，锁例文件也引用了「五道闸」。

**闸门期不改代码。** 以下落点在 `/dual-approve` 之后实施。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实属实：`cmdReview` 遇 `--worker` 直接进 `workerMain`，不经 `resolveDriver`。真正生效的是 run.v2 校验：同步路径 `writeRunMeta` 落盘前，worker 路径 `readRunMeta` 读回时，都调 `validateRunMeta` → `checkAgentIdentities`，要求 driver 已登记。今天没有可达崩溃，但注释给的保证不是真正生效的那一条，读的人会低估「写点必须排在 run.v2 校验之后」这条跨模块顺序。codex 给的两个选项取「改注释」：U7 按字面钉着 `const desc = agentById(driver)!;`，而结构性改法（就地传已校验的 descriptor）会改动判据锚点，超出一处文案修正的范围 | `src/trivium/review.ts` `overrideReasonFor` 文档块「M10a 第 4 步的变化」一节：把「入口已经拦过」改成真正生效的那一句——`meta` 在两条路径上都过了 run.v2 校验（同步路径 `writeRunMeta` 落盘前、worker 路径 `readRunMeta` 读回时），`checkAgentIdentities` 要求 driver 为已登记 id；写点在 `executeRun` 内，排在两者之后。并写明「入口的 `resolveDriver` 对 worker 路径不成立」。测试报告 §2 补一行偏差：r3 §2.3 的这句前提写错了，代码双审 r5 纠正 |
| CODEX-02 | codex | nit | 接受 | 属实：`mkdtemp(bak)` 在闸 6、闸 7 之前，「任何写盘」不严格；两条拒绝路径都删 `bak`，工作树确实没被碰过。装置头注释记过 GLM-07「装置在自己的告警上说过头话，会训练操作者无视它的告警」，这是同一形状 | `scripts/mutation-check.mjs`：闸 6、闸 7 的注释标题与拒绝文案共 4 处，「任何写盘之前」改为「任何工作树写盘之前」（临时备份目录已建、拒绝时即删）。早先轮次叙事里的两处（头注释 r2 / r3 小节）是历史原文，不改 |
| CODEX-03 | codex | nit | 接受 | 属实：`heterogeneous: false` 是「模型名命中 Driver 厂商名义族」的**检出**，不是同源的证明；EV-107 ① 的可达形态（driver=codex，审核者跑 `gpt-oss-120b-medium`）正是检出同族而 Driver 实际多半跑 qwen。渲染件进归档、被长期引用，粗体标题会被当成事实 | `src/trivium/render.ts` 旗标标题改为「**疑似与主脑同源**」。`render.test.ts` 的两条断言用 `includes('与主脑同源')`，仍成立；U6 另补一条断言：标题含「疑似」。变异 M62e 的 find 串在正文，不受影响 |
| GLM-01 | glm | minor | 接受 | 属实：报告 §1.1 的 M62 系是 8 条（M62a、b、b′、c、f、d、d′、e），8 + 3 = 11 才与 README 的「11 条」一致。M62e 验的正是 EV-62 自己的落点（渲染旗标），没有排除它的理由；写成 7 是我数错了。本仓纪律是留痕里的失实断言先改再提交 | `doc/08_project/BACKLOG.md` EV-62 结案段「变异 7 条」改为「变异 8 条」；与 EV-64 的 3 条、README 的 11 条复核一致 |
| GLM-02 | glm | nit | 接受 | 属实：闸表现有 7 行（备份、构建、前置、产物变了、恢复比对、cases ⊆ targets、find 唯一），标题仍写「五道闸」，闸 6 与本步的闸 7 补入时都没跟着改。锁例文件第 12 行又引用「五道闸」表。本步恰在这张表里加了一行，却没改标题 | `scripts/mutation-check.mjs` 头注释标题改为「七道闸，缺一不可」，并注明原题「五道闸」是闸 6、闸 7 补入前的数。`test/unit/mutation-device.test.ts` 第 12 行「那张『五道闸』表」改为「那张闸表」 |

## 实施后的核对口径

- `npm run typecheck && npm run build && node scripts/build.mjs --tests-only && npm test` 全绿，核对 U6 仍在输出里。
- 本轮 5 条都是注释、文案与留痕数字的修正，没有判据变化，**不重跑变异装置**。U6 新增的「疑似」断言是文案锁，不单独设变异。
- 装置文件改了注释与拒绝文案，所以重跑 `mutation-device.test`，确认 D1～D4 仍绿（D2 / D3 断言的文案片段不含被改的字样）。
- 改后重新 `diff -rq` 并执行本地安装，`doctor --selftest` 复跑一次。
- 测试报告补登本轮修订；台账追加本轮一行。
- 是否再跑一轮代码双审，由用户决定。
