---
schema: trivium.disposition.v1
topic: EV-82-置首修法
stage: plan
role: claude
kind: revised
run_id: 20260924T084103Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - CODEX-08
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - AGY-05
  - AGY-06
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
  - GLM-07
  - GLM-08
  - GLM-09
  - GLM-10
---

# 裁决：EV-82 第三段（置首修法）· 计划双审第 1 轮

> 被审对象：`2026-09-24-EV-82-置首修法-claude.md`（r1）
> ｜ 运行：`20260924T084103Z`（8m46s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `request-changes` ｜ glm `request-changes`
> ｜ 共 24 条：重要 7 ｜ 次要 15 ｜ 吹毛求疵 2 ｜ 零阻断
> ｜ **全部接受**；修订稿 r2 另出

## 0. 本轮的形状

**三侧一致认可的**：
- (a′) 的方向：审查臂只判结果，「副本默认是否被采信」移到零配额的 doctor；
- 否决 (a)（每次跑两遍）；
- EV-110 并入清除清单的 fail-safe 方向；
- 挪不动照常拉起的处置；
- §1.3 的语义落点齐全（glm 逐处核过；codex 抽查未见漏项）；
- 单次单侧派发足以支撑结案（codex、glm 明说；gemini 要求补首位路径，见 AGY-04）。

**意见集中在三处，都是计划缺了决策，不是方向错了**：
1. **新事实判据表不互斥、不穷尽**：第三个模型值落不进任何一格；恒等一格写了两种处置；「配置层未判」没说指哪一支。
   CODEX-04 ≡ AGY-02 ≡ GLM-01，加 GLM-02、GLM-03。
2. **guard 拿不到置首结论**：置首结论只进 trace.json，guard 只吃 `CriticResult`。
   CODEX-02 ≡ AGY-01，GLM-09 同族。
3. **同形臂缺省改为置首的连带**：
   - `model_override_full_copy` 与 EV-94 ② 比对拿哪一支；
   - 内联置首与新选项并存会互相覆盖；
   - 缺省行为没被锁住。
   CODEX-01 ≡ AGY-03；CODEX-03 ≡ GLM-05；GLM-04。

**最大的一处改动取自 AGY-03**：同形臂**缺省维持原样**，不改为置首。doctor 显式拉起两支：
- 原样支：继续供 `model_override_full_copy` 与 EV-94 ② 的比对；
- 置首支：显式传 `variant: 'requested-first'`，作为审查臂的零配额替身。

这样 CODEX-01 的三处语义不动；也不用把既有用例改成显式 `as-is`，r1 §7.1 那条「会不会掩盖回归」的疑问随之消失；
GLM-04 的锁点从「缺省值」移到「doctor 第二支确实传了置首」。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 属实。doctor 现调用同形臂不传 `variant`，缺省一翻：`model_override_full_copy` 存的就是置首支的配置层结论（按构造失明），EV-94 ② 告警会把「置首改了顺序」说成「副本形态不同」，设计文档第 287 行的用途说明也随之失真 | 采 AGY-03 的做法：同形臂缺省维持 `as-is`。`model_override_full_copy` 与 EV-94 ② 都只取**原样支**，语义、文案、设计文档第 287 行的用途不变。r2 §3.3 调用方表改写，§4.2 写明两支各自供哪些事实 |
| AGY-03 | gemini | major | 接受 | 与 CODEX-01 同指，并给了更省的解法：缺省不动，doctor 显式拉起置首支。代价只是「同形臂」一词要改成「原样支 / 置首支」两种叫法 | r2 §3.3：同形臂缺省 `as-is` 不变；doctor 第二次调用显式传 `variant: 'requested-first'`，这一支是审查臂的零配额替身。r1 §7.1「既有用例改显式 `as-is`」一条删除 |
| GLM-04 | glm | major | 接受 | 属实。r1 里 doctor 主判据的供数行为没有任何用例或变异锁住，缺省悄悄翻回原样会把正常形态误判成 `reorder_ineffective`。按 AGY-03 改写后，锁点换成「doctor 第二支确实传了置首」 | r2 §7.1：doctor 接线用例用桩臂记录两次调用的 `opts`，断言一次缺省、一次 `variant: 'requested-first'`。r2 §7.2 加变异「doctor 置首支不传 variant ⇒ 红」 |
| CODEX-03 | codex | minor | 接受 | 属实。两处置首并存时，第二处必然走恒等分支，把第一处如实的 `applied:true` 覆盖成 `false`，新事实就静默恒为 `null` | r2 §3.3：删除同形臂 `transformCopy` 里的置首分支，置首统一走 `prepareZcodeHome({ requestedFirst })`，`variant` 的唯一来源是返回值 `reorder`。r2 §7.1 补断言「置首支 `variant.applied === true`」（流程用例、本机形态） |
| GLM-05 | glm | minor | 接受 | 与 CODEX-03 同指。glm 另点出：保留旧分支会把「同一构造函数、同一选项」退化成「两条代码路径行为一致」，C4 搬函数想换来的机制保证就被稀释了 | 并入 CODEX-03 的落点；r2 §3.1 写明搬函数的目的就是让两处共用一条路径 |
| CODEX-02 | codex | major | 接受 | 属实。guard 只读 `CriticResult`，不读 trace.json；r1 让 run.json 不加字段，新句的条件在 guard 侧就没有取值通道 | r2 §3.4 / §4.1：`CriticResult` 增可选字段 `model_override_reorder?: { applied: boolean; reason?: string }`，由适配器填，guard 经 `SideVerdict` 透传后判定。写明**加字段不等于进 run.json**：`review.ts` 不透传它，`run.v2` 不改；它只供 guard 当轮判定，留痕仍在 trace.json |
| AGY-01 | gemini | major | 接受 | 与 CODEX-02 同指 | 并入 CODEX-02 的落点 |
| GLM-09 | glm | minor | 接受 | 属实。挪不动且判 `false` 时仍走旧文案，RUNBOOK 会把人引向「ZCode 又改了导入流程」，真因（置首没做成）只躺在 trace 里 | r2 §4.1：guard 的 `false` 告警**一律**追加「先看 trace.json 的 `modelSelection.reorder`」，再按置首结论分三句：置首已生效仍回落（「CLI 回落规则可能变了」）；置首没做成（附 `reason`）；请求本在首位（恒等，不加推断）。RUNBOOK 排查段同步（见 CODEX-08） |
| CODEX-04 | codex | minor | 接受 | 属实，三处缺口：`honored` 只看一支，与另一支冲突时被静默收录；「首位」没定义算法，还漏了「既非请求也非首位」一格；恒等写了两种处置 | r2 §4.2 改为按序判定的决策表，只用两支运行期读数与请求比 modelId 段，**不再引入「首位」**。①前提：任一不满足即记 `null`、不覆盖旧值，包括任一支读数不是 `ok`、置首支 `applied:false`（**全部成因，含恒等**）、两支请求值不同；②两支都等于请求 ⇒ `honored`；③原样 ≠ 请求、置首 = 请求 ⇒ `reorder_needed`；④两支都 ≠ 请求 ⇒ `reorder_ineffective`；⑤原样 = 请求而置首 ≠ 请求 ⇒ `null`（冲突）。四种组合穷尽 |
| AGY-02 | gemini | major | 接受 | 与 CODEX-04 同指：漏网一格与恒等两说互相矛盾 | 并入 CODEX-04 的落点。「原样 ≠ 请求」泛化后，第三个模型值落进 ③ 或 ④，不再漏网 |
| GLM-01 | glm | major | 接受 | 与 CODEX-04 同指，另点出 `honored` 与 `reorder_ineffective` 字面可以并存、判序没定义 | 并入 CODEX-04 的落点：按序判定，冲突组合 ⑤ 显式记 `null` |
| GLM-02 | glm | minor | 接受 | 属实，恒等恰是最该记 `null` 的形态 | 并入 CODEX-04 落点 ①：`applied:false` 的全部成因都进 `null`，删去「（恒等除外）」 |
| GLM-03 | glm | minor | 接受 | 属实。置首支的配置层结论按构造失明却恒记 `config_copy`，这一条对它几乎不起作用；原样支判 `global` 时，运行期两支对照仍然有信息 | r2 §4.2 删去「配置层未判 `config_copy` ⇒ `null`」一条：新事实只用运行期读数判，配置层状态照旧由 `model_override_full_copy` 与 doctor note 播报 |
| GLM-06 | glm | minor | 接受 | 属实。写侧赋值在 strict 下要求 `ZcodeProbe` 有这个字段；§4.2 说「类型不涉及」与 §11「探针表新增一行」互相矛盾 | r2 §4.2 措辞改为「`run.v2` 与 `config.v2.json` 不涉及（`commonProbe` 为 `additionalProperties: true`）；`types.ts` 的 `ZcodeProbe` 加可选字段」。r2 §1.3 与 §11 同步清单补这一行，设计文档探针表新增该行 |
| CODEX-05 | codex | minor | 接受 | 属实，三处：旗标探针用的是临时空 HOME，r1 那句写错；`test/unit/zcode-provider-env.test.ts` 里断言 ⚠️ 文案的既有用例会红，没列；第二段变异规格有两处 find 引用被删的常量，闸 7 会拒跑 | r2 §5 按拉起路径逐条列 HOME 与行为变化（见 GLM-08 落点）。§5 / §7.1 点名那条既有用例改为断言信息级 note。第二段变异规格按**历史留痕**处置：不改写，在报告第 8 节补注「该规格对应 `c673ba3`，EV-110 并入后不可再跑」 |
| AGY-05 | gemini | minor | 接受 | 与 CODEX-05 ① 同指，另补出版本探针 `probeZcodeVersion` 也展开了这个清单 | 并入 GLM-08 的逐路径清单，版本探针单列一行 |
| GLM-08 | glm | minor | 接受 | 属实，并补出一条方向为正的变化：doctor 的 headless 臂用真实 HOME，宿主预置时日志落在预置目录，`readTrace` 读不到 `model_id_form`；并入后这条失联被修复 | r2 §5 影响面表，逐路径列出，核对过代码：旗标探针为临时空 HOME（随目录删除）；版本探针、path_deny 臂、headless 臂、探活为真实 HOME（宿主预置时日志改落 `~/.zcode/cli/log`，headless 臂的 `readTrace` 由此能读到）；两条模型探针臂与审查臂为副本 HOME。设计文档按这张表写 |
| CODEX-06 | codex | minor | 接受 | 属实。凭据替换与残余扫描都按键路径遍历、对键序不敏感，「置首放到 `transformCopy` 之后」这条变异会存活，括号里的理由也不构成可观测差异 | r2 §7.1 补用例：`transformCopy` 收到的对象里请求已在两级首位，并断言盘上副本的键序。r2 §7.2 改为两条能被咬住的变异：「置首挪到 `transformCopy` 之后 ⇒ 入参断言红」「置首在写盘之后才应用 ⇒ 盘上键序红」，并明说**锁的是实现顺序这条契约**（残余扫描面对最终落盘的副本），不再声称它守的是凭据安全 |
| GLM-10 | glm | nit | 接受 | 与 CODEX-06 同指 | 并入 CODEX-06 的落点 |
| CODEX-07 | codex | minor | 接受 | 属实。前置读数没进结案逻辑：读到 `honored` 时四条全绿也证明不了置首在起作用；读到 `null` 时记「不结案」，等于把「判不出」记成「修法无效」，与 §4.2 自己的口径相反 | r2 §7.3 结案逻辑按 doctor 读数分支：`reorder_needed` 且四条全满足 ⇒ 修法被验证，EV-82 结案；`honored` ⇒ 记「上游已修、置首已非必需」，EV-82 按「上游修复」结案，撤置首另登记；`reorder_ineffective` ⇒ 不结案，报告用户；`null` ⇒ 验收前提不成立，先补一次 doctor，不记作修法无效 |
| GLM-07 | glm | minor | 接受 | 属实。本机现势恰好让请求非首位；若验收前键序变了，恒等下按字面不结案，需要一次无谓的人工判断 | r2 §7.3 判据三改为：`reorder.applied: true`，或 `applied:false` 且原因为恒等（此时以其余三条加 doctor 读数为准） |
| AGY-04 | gemini | minor | 接受 | 恒等路径在审查臂上的全链路（留痕、守卫）确实没有验过。但 codex、glm 都指出：恒等下不发生置首，行为与改动前相同，再花一次配额验的是旧路径。所以用零配额的等价验证代替第二次真实派发 | r2 §7.1 补审查臂恒等路径的流程用例（假入口，请求首位）：`reorder` 为 `{ applied:false, reason: 恒等 }`、`model_override_applied: true`、不写「本次靠置首达成」、guard 不出告警。r2 §7.3 写明「是否另花一次配额验恒等路径由用户定，本计划不要求」 |
| CODEX-08 | codex | minor | 接受 | 属实。RUNBOOK 第 267 行写着「已修（EV-82，2026-09-21）……`model.main` 生效」，与第二段实测相反，值班的人会以为症状早已消失 | r2 §11 的 RUNBOOK 项列出第 266、267 两行。第 267 行改为「配置层已修；运行期回落由第三段置首修法消除；本段验收前的运行仍会回落」，验证说明同步。第 266 行的排查顺序补「先看 doctor 的 `zcode.runtime_selection` 与 trace 的 `modelSelection.reorder`」 |
| AGY-06 | gemini | nit | 接受 | 与 CODEX-08 同指 | 并入 CODEX-08 的落点 |

## 2. 修订稿 r2 的改动清单（按节）

| 节 | 改动 | 来源 |
| :--- | :--- | :--- |
| §1.3 | 语义落点补 `types.ts` 的 `ZcodeProbe`；`CriticResult` / `SideVerdict` 新字段的落点 | GLM-06、CODEX-02 |
| §3.1 | 写明搬函数的目的：两处共用一条置首路径 | GLM-05 |
| §3.3 | 同形臂缺省维持 `as-is`；doctor 显式拉起置首支；删除 `transformCopy` 内的置首；`variant` 唯一来源是 `prep.reorder` | AGY-03、CODEX-01、CODEX-03、GLM-05 |
| §3.4 | `CriticResult.model_override_reorder`（只供 guard，不进 run.json） | CODEX-02、AGY-01 |
| §4.1 | guard 的 `false` 告警一律指向 `modelSelection.reorder`，按置首结论分三句 | CODEX-02、GLM-09 |
| §4.2 | 按序判定的决策表，只用两支运行期读数；冲突与 `applied:false` 全部成因记 `null`；去掉「首位」与配置层条件；类型措辞更正 | CODEX-04、AGY-02、GLM-01、GLM-02、GLM-03、GLM-06 |
| §5 | 逐拉起路径的 HOME 与行为变化表；既有 ⚠️ 用例改写；第二段变异规格按历史留痕补注 | CODEX-05、AGY-05、GLM-08 |
| §7.1 | doctor 两次调用 `opts` 断言；置首支 `applied:true`；`transformCopy` 入参键序；审查臂恒等路径流程用例；删「既有用例改显式 `as-is`」 | GLM-04、CODEX-03、CODEX-06、AGY-04、AGY-03 |
| §7.2 | 替换「置首放到 `transformCopy` 之后」为两条能咬住的变异；加「doctor 置首支不传 variant」 | CODEX-06、GLM-10、GLM-04 |
| §7.3 | 结案逻辑按 doctor 读数分支；恒等出口；恒等路径不另花配额 | CODEX-07、GLM-07、AGY-04 |
| §11 | RUNBOOK 第 266、267 行；`ZcodeProbe` 类型；设计文档探针表新增行 | CODEX-08、AGY-06、GLM-06 |
| §12 | 给审查员的重点按 r2 改写 | — |

## 3. 其它登记

- 本轮有 7 条重要级，全部是计划里缺的决策，没有一条要求改道。修订稿改动面集中在 §3.3、§4、§7，建议送第 2 轮计划双审，由用户定。
- 台账：本轮记第 10 行（plan r1，24 条）。
