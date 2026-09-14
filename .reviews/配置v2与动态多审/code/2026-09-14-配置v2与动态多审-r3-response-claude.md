---
schema: trivium.disposition.v1
topic: 配置v2与动态多审
stage: code
role: claude
kind: response
run_id: 20260914T032508Z
addresses:
  - AGY-01
  - AGY-02
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
---

# 代码审查应答：配置v2与动态多审（M7b 第 3 步 · 第 3 轮）

> 两侧均判 `approve-with-nits`，零 blocker 零 major。共 6 条意见，**全部接受**。
> 其中 AGY-01 与 GLM-01 是同一个问题，两侧独立收敛。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | nit | 接受 | 属实，且是本步自己造成的语义矛盾：改了 `decideMode` 的完成度语义却漏改这条启动警告，两侧独立收敛于同一处 | `review.ts:339-341` 警告改中性陈述，删去「会被标为降级」 |
| AGY-02 | gemini | nit | 接受 | 设计 6.7.1 写明「`critics` 的键取自 `critics_selected`」，这条跨字段约束 schema 表达不了、代码层漏了，正是两段式校验该补的缺口 | `schemas.ts` `checkAgentIdentities()` 追加子集断言 + `run-meta.test.ts` 正负成对用例 |
| GLM-01 | glm | minor | 接受 | 与 AGY-01 同一处。glm 侧额外指出它与 `render.test.ts` 新用例直接矛盾，定性更准 | 同 AGY-01；另补一条用例锁住警告文案不再断言降级 |
| GLM-02 | glm | minor | 接受 | 击中要害：我在 schema 里写了大段「不枚举」的注释，但注释拦不住人，而 registry-parity 只扫 `src/`，纪律 7 的对账面在新 schema 上是空的 | `registry-parity.test.ts` 增 schema 枚举扫描，把「不枚举」从注释约定升为机器对账 |
| GLM-03 | glm | minor | 接受 | 本步扩大了 unreadable 的成因（新增「契约拒绝」），使 hooks 的旧文案从基本准确退化为文不对题——而这正是注释里反复警告会永久拦死提交的场景，误导排障方向的代价最高 | `RecordedRun` 增 `unreadableReason`，`listRecordedRuns` 透传，`TamperedArtifact` 与 `hooks.ts` 输出改用真实原因 |
| GLM-04 | glm | nit | 接受 | 已独立实测核实：`verify/` 下实为 6 份（5 × `verify-run.v1` + 1 × `run.v1`），非三处文档所写的 5 份。第 6 份正是第零步 verify 自己产生的——落笔之后又多了一份 | 三处计数刷新；代码注释改为不含数字的表述，设计方框保留实测值并标明会随 verify 增长 |

## 修改方案

### 一、AGY-01 ≡ GLM-01：启动警告与本步语义相反

`review.ts:340` 现文案：

> 只跑 X 一侧：这不是双审，结果会被标为降级。仅供调试使用。

后半句在本步之后是**假话**：单侧入选且成功时 `review_mode` 记 `full`、不写 `degraded_reason`、
渲染不打降级横幅。用户照这句话去找降级标记会找不到。

改为中性陈述：说明单侧结论无交叉验证、参与者事实记在哪里，**不再断言降级**。
真正的降级提示留给 `degraded` 路径的既有文案。

这是两侧独立收敛的一条，也是本步唯一一处「改了语义没改文案」的遗漏。
它提醒的事比它本身重要：**改语义时，凡断言该语义的文案都要一并过一遍**——
代码里的 `warn` 文案不像文档那样有对账清单看着。

### 二、AGY-02：`critics` 的键必须是 `critics_selected` 的子集

`checkAgentIdentities()` 现在只校验每个键是已登记 Agent、vendor 与注册表相符，
没校验它在不在入选集合里。设计 6.7.1 的原话是「`critics` 由『恰两键』改为动态键
（**键取自 `critics_selected`**）」——后半句是契约的一部分。

补子集断言。方向上要注意：**反向不成立**——入选却整侧失联时 `critics` 少一个键是正常的
（`critics ⊂ critics_selected`），所以只能断言子集，不能断言相等。

### 三、GLM-02：把「schema 不得枚举 Agent」升为机器对账

这条我接受得最干脆。两段式校验的**决策**两侧都认可，但我为它留的保障只是 schema 里的
一段注释——而 `registry-parity.test.ts` 只扫 `src/trivium/` 的代码字面量，不看 schema 文件。
将来有人往 `critics_selected.items` 或 `critic.vendor` 加回 `enum`，现有测试全绿，
直到 M8 接入第三家才在运行期炸——正是 `schemas.ts` 注释里自己描述的那个症状。

**注释约定守不住的东西，就得让机器守**，这是第 2 步刚学过的一课（白名单「过期条目」守卫）。
落点：在 parity 测试里增一组 schema 扫描，结构上断言那三处不含 `enum`。

### 四、GLM-03：不可读的真实原因不能丢

`runManifestProblem()` 返回的原因串（「不认识的 schema」「不符合 trivium.run.v2」）
被 `listRecordedRuns` 的 catch 整段吞掉，`hooks.ts` 对 `manifest_unreadable` 硬编码
「run.json 存在但解析失败」。

本步之前 unreadable 基本只有「JSON 坏了」一种成因，那句话是准的；本步把「契约拒绝」
也纳入 unreadable 之后，一份**解析完全成功、只是 schema 不被接受**的文件也会报「解析失败」,
排障者会被引去查 JSON 损坏。而这条链路正是「写错会永久拦死每一次提交」的那条——
在最需要准确诊断的地方给出错误方向，代价最高。

按 glm 的第一方案做（透传真实原因），不取降级方案。

### 五、GLM-04：计数过期

实测结果（全量扫 `verify/` 下的运行留痕）：

```text
trivium.verify-run.v1  Agent注册表与多审泛化/…/run-20260913T123426Z.json
trivium.run.v1         M4-M5实现/…/run-20260911T042526Z.json
trivium.verify-run.v1  S9-闸门与留痕加固/…/run-20260911T090948Z.json
trivium.verify-run.v1  双审进度反馈/…/run-20260912T152839Z.json
trivium.verify-run.v1  护栏判定范围收窄/…/run-20260913T170020Z.json
trivium.verify-run.v1  演进设计定稿与回溯/…/run-20260914T002016Z.json
```

**6 份**，不是 5 份。多出来的第 6 份是「演进设计定稿与回溯」——第零步自己跑 verify 产生的，
时间戳晚于那句「5 份」落笔的时刻。行为不受影响（分支按形状分发，与数量无关），
但这正是本项目自己立的规矩：**现状断言以实测为准，不照抄更早的文档**（v1.3.0 GLM-01 的教训）。

处理上分两种：

- **代码注释**（`archive.ts`、`meta.ts`）改为不含数字的表述。注释最容易过期且没有对账清单看着，
  而这个数字**每跑一次 verify 就加一**，写死多少都会再错。
- **设计 6.7.1 的方框**保留实测值并标注「截至 2026-09-14 实测 6 份，此后随每次 verify 运行增长」。
  那里需要具体数字撑起「verify 分支为什么必须存在」的论据，但要写明它是会变的。

## 两条证据核验提示的处置

编排器在收口时报了两条，一并说明：

1. **`gemini` 侧 consulted 无法与工具轨迹交叉核对**（front-matter `consulted_unverified: true`）。
   这是该侧轨迹解析的已知限制，先于本轮存在，不影响结论采信。
2. **`glm` 侧 evidence 引用了未列入 consulted 的三个文件**（`runner.ts`、`render.test.ts`、
   `runner.test.ts`）。核实：这三个文件的改动**都在本轮补丁内**，而 glm 的 consulted 里
   有那份 `.diff`——它是从补丁里读到的，不是凭空断言。且 GLM-01 的结论已由我独立核实属实，
   gemini 侧也独立提了同一条。**不因这条提示打折采信，但记此备查。**

## 不做的事

无驳回、无暂缓。六条全部接受并在本轮落地。

**范围边界**：全部修改仍限于 M7b 第 3 步范围。两侧都独立核实了「config v2 一行未碰」
（glm 侧的核实方式最实：schema 目录恰为五份、`config.ts` 不在补丁 31 文件内、
`--critics` 只存在于注释），本轮修改不改变这一点。
