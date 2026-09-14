---
schema: trivium.disposition.v1
topic: 配置v2与动态多审
stage: code
role: claude
kind: response
run_id: 20260914T010621Z
addresses:
  - 2026-09-14-配置v2与动态多审-gemini.md
  - 2026-09-14-配置v2与动态多审-glm.md
---

# 代码应答：M7b 第 1 步（修四条既有缺陷）

## 0. 裁决总览

两侧均判 `approve-with-nits`。gemini 2 条（2 minor），glm 4 条（1 minor / 3 nit），合计 6 条。

**逐条裁决：接受 6 条，驳回 0，暂缓 0。**
每条都独立核实（见各条「核实」行），无一条经核实后不成立。

### 一处收敛：两侧同时命中判定的输入不对称

| 问题 | gemini | glm |
| :--- | :--- | :--- |
| `ran = Object.keys(results)` 未与 `selectedSides` 求交，未入选侧会污染判定 | AGY-02（minor） | GLM-02（nit） |

**我实测核实**：`runner.ts:257` 的 `ran` 确实直接取自 `results` 的键集，未与 `selected` 求交。
于是 `missingSides` 防住了 `selected ∖ ran`（入选却没跑），
而 `ran ∖ selected`（没入选却有结果）一侧不设防——**一个方向设防、另一个方向不设防**。

若 `results` 混入未入选侧的失败结果，`failedSides` 会把它计入，
`mode` 判成 `single`、`degraded` 置 `true`，strict 下还会触发 `abort`。

**两侧对严重度的判断不同，而 glm 给出了更完整的定性**：当前唯一生产调用点
`review.ts` 受 `runBothSides` 契约保护（`requests` 只装入选侧、`settled` 的两种结局都写 `results`），
故 `ran == selected` 恒成立、此路径不可达。但 `decideMode` 是**导出的纯函数**、测试直接调用，
且第 3 步起调用方会增多——「`results` 键集 ⊆ `selected`」这个前置条件目前**只活在装配事实里**，
函数自身既不设防也未声明。

我按 gemini 的建议**做设防**（而不是 glm 给的另一选项「只写进 JSDoc」）：
本步刚刚因为「判定少看了一个输入」踩了 §2.1 那个坑，
再留一个「靠调用方自觉」的前置条件是同类错误的另一种形态。设防的成本是一行 filter。

### 我这次的错在哪

6 条里有 2 条是**我自己新引入**的，不是存量问题：

- **GLM-01（JSDoc 错位）**：我把 `effortFor` 插在了 `resolveAssetRoot` 的 JSDoc 与函数体之间，
  于是「skill 资产根」那行注释悬在 `effortFor` 头上，而 `resolveAssetRoot` 失去了自己的文档。
  纯粹是插入位置没看清上下文——用 Edit 工具按锚点插入时只匹配了函数签名行，没看它上一行是什么。
- **GLM-04（LLD 表落后）**：我给 `GateWarning` 扩了枚举，没同步 LLD 里那张 warning code 表。

另外 **AGY-01（测试盲区）** 也算我的欠账：我给 `decideMode` 补了 3 例，
却没给同一笔改动的 `gate` 侧补任何一例——`degraded` 的两头接通是这次的重点之一，
结果**新增的行为一行测试都没有**。21 个既有 `checkAdjudication` 用例全部硬编码 `degraded: false`，
把 `degraded_round` 整段删掉，测试依然全绿。

---

## 0.1 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | minor | 接受 | 实测 `test/unit/gate.test.ts` 有 21 处 `degraded: false`、**0 处 `true`**；`degraded_round` 警告与 `loadRoundReviews` 的 `degraded` 提取零覆盖，整段删掉测试仍全绿 | `test/unit/gate.test.ts` 补两例：①`degraded: true` 时 warnings 含 `degraded_round` 且 `ok` 仍为 true；②`loadRoundReviews` 在 `degraded_reason` 有值/为 null 时分别返回 true/false |
| AGY-02 | gemini | minor | 接受 | 与 GLM-02 同一问题，见 §0 收敛段。`ran` 未与 `selected` 求交，`ran ∖ selected` 方向不设防，与 `missingSides` 的设防方向不对称 | `runner.ts`：`ran` 先与 `selectedSides` 求交再做 ok/failed 分类；补一例未入选侧混入的负例 |
| GLM-02 | glm | nit | 接受 | 同 AGY-02，并增量给出「当前不可达但契约只活在装配事实里」的准确定性，以及第 3 步调用方会增多的前瞻 | 并入 AGY-02 落点；另在 `decideMode` 的 JSDoc 写明前置条件（**设防与声明都做，不二选一**） |
| GLM-01 | glm | minor | 接受 | 实读 `review.ts:213`：「skill 资产根」JSDoc 与 `effortFor` 的 JSDoc 连成两段，`resolveAssetRoot`（:246）上方无文档。我插入新函数时的位置失误 | `review.ts`：把 `effortFor` 整体移到 `resolveAssetRoot` **之后**，让原 JSDoc 与其函数体重新贴合 |
| GLM-03 | glm | nit | 接受 | 实读 `types.ts:45-47` 确为 `agentById(c)!.vendor as Vendor`，宽 union（`AgentVendor` 四值）断言到窄 union（`Vendor` 两值），恒编译通过。M8 扩 `CriticId` 时拿不到编译期防错——四处修法里唯独 vendor 链路防错强度不一致 | **本步不动代码**（`Vendor` 枚举属 run.v1 线契约，改它是第 3 步的事）。落点：写进 `BACKLOG.md` 的 EV 池，并在第 3 步 run.v2 清单里登记「vendor 枚举随注册表派生、派生处去 `as` 断言」 |
| GLM-04 | glm | nit | 接受 | 实读 `LLD_orchestrator.md:303-304`：表里只有 `weak_reason` 与 `joint_blocker_rejected`，实际枚举是四值——`parse_problem`（既有）与本次新增的 `degraded_round` 都不在表里 | `LLD_orchestrator.md`：补齐缺的两行，并标注该表以 `gate.ts` 的 `GateWarning` 联合类型为唯一来源 |

---

## 1. 逐条应答与修改方案

### AGY-02 / GLM-02 · 接受（两侧收敛）

**核实**：属实。`runner.ts:257` 的 `ran` 直接取键集。核实了 glm 给的「当前不可达」论证也成立——
`review.ts` 的 `sides` 与 `requests` 同源，`runBothSides` 对 fulfilled 与 rejected 两种结局都写 `results`。

**为什么选「设防」而不是「只声明」**：glm 给了二选一，我两个都做，但设防是主要的。
理由是本步的 §2.1 缺陷本身就是「判定少看了一个输入」——
`decideMode` 此前不知道「本该跑几侧」，于是单审与双审不可区分。
现在补上了那个输入，却让它对另一个方向的畸形输入保持沉默，
等于把同一类风险换个方向留着。**一个导出的纯函数，其输入契约不该靠调用方的装配事实来保证。**

**修改方案**：

```ts
// ran 先与 selectedSides 求交：判定的论域就是入选集合，两个方向都设防
const ran = (Object.keys(results) as CriticId[]).filter((c) => selectedSides.includes(c));
```

并在 `decideMode` 的 JSDoc 补一句前置条件：
「`results` 的键集应是 `selected` 的子集；多出的键会被**忽略**（不参与判定），
少的键进 `missingSides`。」——写明「忽略」而不是「报错」，是因为纯函数在判定路径上抛异常
会让一个本可继续的运行整次炸掉，而多余键本身不构成安全问题，忽略即可。

补一例负例：未入选侧的失败结果混入时，`mode` / `degraded` / `abort` **不受影响**。

### AGY-01 · 接受

**核实**：属实，且比意见描述的更值得记。`grep -c` 实测：`degraded: false` 21 处，`degraded: true` **0 处**。
这意味着我这次新增的 `degraded_round` 警告分支与 `loadRoundReviews` 的 `degraded` 返回值
**完全没有测试**——把那 8 行整段删掉，`npm run check` 依然 766/766 全绿。

这跟 §2.1 的既有缺陷是同一个形态：**既有测试全部只覆盖一种输入，于是缺陷带病通过**。
我在计划里引用过这条教训（「既有五例全部传入两侧，单键 results 没有任何用例」），
给 `runner` 补了 3 例，却没想到自己在 `gate` 侧留了一模一样的洞。

**修改方案**：`test/unit/gate.test.ts` 补两例——

1. `checkAdjudication` 在 `degraded: true` 时，`warnings` 含 `code: 'degraded_round'` 且 **`ok` 仍为 true**
   （断言 `ok` 是关键：它锁住「warning 不是 failure」这个刻意的强弱选择，防止日后被改成硬失败）；
2. `loadRoundReviews` 在 run 元数据 `degraded_reason` 有值时返回 `degraded: true`、为 null 时返回 false。

### GLM-01 · 接受

**核实**：属实，实读 `review.ts:211-250` 确认。这是我用 Edit 按函数签名行做锚点插入时，
没检查锚点上一行是什么造成的。

**修改方案**：把 `effortFor` 整体移到 `resolveAssetRoot` 函数**之后**，
让「skill 资产根」那行 JSDoc 与它的函数体重新相邻。移动函数位置、零行为变化。

### GLM-03 · 接受（本步不动代码）

**核实**：属实。`types.ts:46` 的 `agentById(c)!.vendor as Vendor` 把 `AgentVendor`（四值，
含 `'anthropic' | 'openai'`）断言成 `Vendor`（两值）。M8 接入 codex 时 `'openai'`
会被静默塞进 `Record<CriticId, Vendor>` 的值位，落盘后过不了 run.v1 的 vendor 枚举校验。

这条抓得准的地方在于：**我在 `review.ts` 的注释里宣称消除了「不会响亮失败」的隐患，
但只是在值层面消除了**（第三家会记真值而非错的 `zcode`）——类型层的防错并没有建立，
四处修法里唯独 vendor 链路在新增 `CriticId` 时拿不到编译期报错。注释的口径比实际强。

**为什么本步不改**：`Vendor` 是 `run.v1` 的线契约枚举，改它属于数据契约层改动，
正是 AGY-07 裁定第 1 步**不得触碰**的范围。glm 自己也写了「不必在本步动它」。

**落点**：①`BACKLOG.md` 登记为 EV-03；②在 `review.ts` 的注释里把口径改准——
说明「值层面已修、类型层的编译期防错待 run.v2 随 vendor 枚举派生一并建立」，
不让注释比代码承诺得多。

### GLM-04 · 接受

**核实**：属实。`LLD_orchestrator.md:303-304` 只列两行，实际 `GateWarning` 是四值。
`parse_problem` 是既有遗漏，`degraded_round` 是我这次新增没同步。

顺带认一条：glm 指出 `AGENTS.md` 的「改动同步清单」未显式覆盖 warning code、属灰色地带。
这话是对的——清单里有「四份 JSON Schema」「CLI 参数或退出码」，没有「gate 的 failure/warning 枚举」。

**修改方案**：补齐 LLD 表中缺的两行，并在表下标注
「本表以 `gate.ts` 的 `GateWarning` / `GateFailureCode` 联合类型为唯一来源」——
标注比穷举更可靠，下次扩枚举时不同步也不会让表**变错**（只是不全）。

---

## 2. 两侧共同确认、无需改动的部分

四个审查焦点两侧独立核实后均判成立：

- **焦点一（不动落盘）成立**。glm 给出了完整的等价性论证：`sides` 与 `requests` 同源
  → `ran == selected` 恒成立 → `missingSides` 在生产路径恒空 → `okSides` / `failedSides` /
  `mode` / `abort` / `degradedReason` 与旧逻辑**逐字段等价**；`abort` 的合并三元与旧两步 `if` 语义相同；
  三处落盘消费点（`meta.review_mode`、`meta.degraded_reason`、渲染横幅的 `degraded`）取值不变，
  其中横幅那处「`mode === 'single'` 改为 `mode.degraded`」在新逻辑内**两式恒等**。
  worker 路径的 `sides` 经交接文件序列化重建，等价性同样成立。
- **焦点二（degraded 的接法与强弱）成立**。旧表达式恒为 false 经两侧独立确认；
  生产侧读 `degraded_reason` 是 `decideMode` 写入的唯一凭据；
  run 元数据读不到时记 false 的保守选择有真实兜底（`missingSides` → `missing_review_json` failure）；
  出 warning 而非 failure 的理由两侧都认可——降级是关于**运行**的事实，Driver 改裁决件修不掉，
  且 degrade 策略与 `--allow-single` 本就是配置允许的路径，报 failure 等于把合法路径变成死闸门。
- **焦点三（四处三目）成立**，且 glm 把我的分类标准总结得比我自己写的清楚：
  **数据走注册表、逻辑走编译期穷尽**。vendor 与 `--only` 是映射与集合成员判定（数据问题）；
  `effort` 与 preflight 的分支体是两套无法登记为统一数据的**校验逻辑**
  （agy 目录硬校验 vs zcode 短名补全后比对）。「v1 配置 `critics.*` 是厂商专属形状」的理由经实读确认。
- **焦点四（无越界）成立**。两侧均确认 diff 严格落在第 1 步三条范围内，
  未触碰 schema / config v2 / `--critics` / 渲染文案 / 分歧度 / 桩夹具。
- **新增三例单测有效**：glm 逐例核实了它们各自能抓住哪种回退形态。
- **保留的字面量干净**：`effortFor` 的 case 与 `checkModelSlugs` 的 else-if 所在文件
  均在 `registry-parity` 的白名单内；`runner.ts` 与 `gate.ts` 不在白名单，但本次新增代码
  无带引号的 Agent 字面量。

## 3. 对两侧盲区的补充

glm 声明「未执行 typecheck/build/test，落盘不变是从调用链推得」。补上实测：
本轮改动后 **`npm run check` 766/766 全绿**（新增 3 例），
`git diff` 确认未触及 run.json 写入行与任何 schema 文件。

gemini 声明未执行构建与全量测试，同上。

两侧都未验证 M8～M11 的后续实现——那些尚未开工，本轮无从覆盖。
