---
schema: trivium.disposition.v1
topic: 配置v2与动态多审
stage: code
role: claude
kind: response
run_id: 20260914T061843Z
addresses:
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
  - GLM-07
---

# 代码审查应答：配置v2与动态多审（M7b 第 5 步 · 第 5 轮）

> 两侧均判 `request-changes`，各一条 major——**AGY-01 与 GLM-01 是同一条**，第三次两侧独立收敛。
> 共 11 条意见，**全部接受**。major 已实测复现：按 SKILL.md 照抄透传，`--only` 场景**必然退 64**。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 已实测复现：`--only glm` 时 resolve 同时输出 `critics:["glm"]` 与 `only:"glm"`，照抄透传即触发互斥，`--start` 退 64。我在 SKILL.md 里写的「resolve 已经挡住了这种组合」**是错的**——它挡的是「用户同时给两个」，不是「resolve 自己同时输出两个」 | 三份 SKILL 第 3 步删去 `--only` 透传；`resolveTopicArgs` 在入选来自 `--only` 时把输出 `only` 置 null |
| GLM-01 | glm | major | 接受 | 与 AGY-01 同一缺陷。glm 补出两条关键推论：**设计 7.1 承诺「长期保留为别名」的 `--only`，在升级后的 skill 上一条都跑不通**；且「用户没写 `--critics`，报错却说他写了」 | 同 AGY-01；另按其建议给 flag-parity 补正文断言 |
| AGY-03 | gemini | minor | 接受 | 与 major 同源的测试盲区：三条集成用例都是 `--start` 直调，`topic resolve → --start` 的拼接从未被覆盖，所以这个 major 才能溜过去 | 补一条跨命令串联用例（resolve 输出照抄进 `--start` 应成功） |
| GLM-02 | glm | minor | 接受 | 属实的静默丢参：`/dual-run` 走 `--stage all`，而 `NAMED_FLAGS` 不分 scope——拼错则命令 A 当场退 64，**写对了反而被正文静默丢弃**。「错的报错、对的消失」 | `resolveTopicArgs` 对 `scope=all` 显式拒绝 `--critics` / `--only` 并说明适用范围 |
| AGY-02 | gemini | minor | 接受 | 属实：`legalList` 不排除当轮 Driver，M9/M10 后 Driver 那条报错会把 Driver 自己列进「当前可用」——正是上一轮 GLM-04「第一个错误把用户引向第二个错误」的同形 | `legalList` 接受 `driver` 参数并过滤 |
| GLM-03 | glm | minor | 接受 | 属实，且**是同一教训的第三次**：`--only + --allow-single` 的 note 仍说「降级本就必然发生」「不改变行为」，两句在新语义下都是假话。残留就在实现新语义的同一个函数里 | 重写该 note 对齐新口径 |
| AGY-04 | gemini | nit | 接受 | 属实：手册 §5.3 的 `default_critics` 仍写「当前只被校验、尚未接线」 | 更新该行 |
| GLM-04 | glm | minor | 接受 | 与 AGY-04 同一文档但更要害：**手册头部**仍断言「动态选 1～3 个审核者尚未实现，本手册不涉及」，而手册自我定位是「逐条完整契约、全部参数」——照它查参数的人根本不会知道 `--critics` 存在 | 头部补例外说明；命令参数章节补 `--critics` / `--only` 规则 |
| GLM-05 | glm | minor | 接受 | 属实的空真形态：`?? ` 不防空数组，直传 `critics: []` 会得到「零侧审查记 full 过闸」。当前生产路径不可达，但该字段的注释**恰恰邀请手工构造的调用方**使用它 | `prepareRun` 对空集合抛 `usageError`，并补直传空数组的负例 |
| GLM-06 | glm | nit | 接受 | 属实：FR-29 行尾标记仍是「待实施」，与同一 bullet 的正文及 AC-22 的标记自相矛盾。v1.4.3 的主题正是精确化达成口径，条目内部却留了新旧并存 | FR-29 行尾改拆分式标记 |
| GLM-07 | glm | nit | 接受 | 属实的未来接线缺口：`driver` 参数目前只有测试在传，两个生产调用点都用缺省值。M10 落地时若忘了接，这条检查会对着错误的 Agent 生效 | 在设计 16.1 的 M10 条目登记该接线要求 |

## 修改方案

### 一、AGY-01 ≡ GLM-01（major）：透传指令自相矛盾

**实测复现**：

```text
$ topic resolve … --only glm
  "only": "glm",
  "critics": ["glm"]        ← 两字段同时非空

$ review --start … --critics glm --only glm     ← Driver 照 SKILL 照抄的结果
  退出码: 64
  ✗ --critics 与 --only 不能同时给
```

**根因是我自己写的那句断言**。我在 SKILL.md 里写「resolve 已经挡住了这种组合，照抄它的输出不会撞上」——
`resolveCriticSelection` 挡的是**用户同时给两个旗标**；而这里是 **resolve 自己同时输出了两个字段**，
是完全不同的两件事。我把前者的保证当成了后者的保证。

后果比「一次报错」更重：设计 7.1 明写 `--only` **长期保留为别名**，理由是
「目标项目里的旧 SKILL.md 可能未同步升级」。结果新 skill 资产上这个别名一条都跑不通，
而且报错说的是「你不能同时给两个」——**用户根本没写 `--critics`**。

修法取两侧建议的**并集**（两者互补，只做一半仍有残留）：

1. **三份 SKILL 第 3 步删去 `--only` 透传**：`--critics` 已完整覆盖该意图（含单元素），
   保留两条透传指令本身就是冲突源；
2. **`resolveTopicArgs` 在入选来自 `--only` 时把输出 `only` 置 null**：
   下游就**没有第二个旗标可传**。即使有人照着旧说明改回去，也撞不上。

第 2 条是关键——第 1 条只是改文档，而文档会被抄错；第 2 条让错误形态在数据层面不可达。

### 二、AGY-03 ≡ GLM-01 的测试面：跨命令串联

major 能溜过去是因为**测试覆盖的是 `--start` 直调，而真实链路是 `resolve → Driver 拼装 → --start`**。
三条集成用例挡住了「接线漏传」，却挡不住「接线拼错」。

补一条跨命令串联用例：拿 `topic resolve` 的真实输出按透传规则组装成 `--start`，断言能启动。
分别覆盖 `--only` 与 `--critics` 两种输入。

同时按 glm 的建议给 `skill-flag-parity` 补一条与 `models` 同款的正文断言——
它现在只校验「槽位存在」，校验不了「正文有没有交代怎么填」，而 major 恰恰出在正文。

### 三、GLM-02：`/dual-run` 的静默丢参

`NAMED_FLAGS` 加 `critics` 时没分 scope，于是 `/dual-run --critics glm`：

- 拼错 → 命令 A 当场退 64（连方案都还没起草）；
- **写对 → 解析成功、进 resolve 输出、然后被 S2/S6 的交接说明静默丢弃**（那里只交代了 focus/context/models/profile）。

「错的报错、对的消失」。取 glm 的第二个方案：**`scope=all` 时显式拒绝并说明该旗标只适用于 B/C/D**。
不选第一个方案（给 dual-run 补声明与交接）的理由：命令 A 是「全流程不停闸门」，
它内部要跑 plan 与 code 两轮双审，「这一轮选哪几侧」的语义在命令 A 层面是模糊的——
与其定义一个我现在想不清楚的语义，不如明确拒绝。这条边界要写进设计 7.1。

### 四、AGY-02：`legalList` 未排除 Driver

当前不可达（claude 未进 `CRITICS`），但 M9/M10 后会复现上一轮刚修过的形态。
给 `legalList` 加 `driver` 参数并过滤。

### 五、GLM-03：第三次同形

`--only + --allow-single` 的 note 说「只跑一侧时降级本就必然发生」「`--allow-single` 不改变行为」——
本步之后两句都是假话：选一侧成功记 `full` 不写降级原因；而 `--allow-single` 实际改变失败分支。

**这是「改语义时凡断言该语义的文案都要一并过一遍」的第三次**（v1.3.2、v1.3.3 各记过一次），
而且这次残留就在实现新语义的同一个函数里。

我之前写过「下次改键名先 grep 全仓」——但这次改的不是键名而是**语义**，grep 不到。
真正该做的是：改语义时列出所有断言该语义的落点（代码文案、文档、测试名），逐个过。
这条我会写进设计的变更记录，作为纪律补充。

### 六、GLM-05：空数组的空真形态

`opts.critics ?? resolveCriticSelection(cfg)` 不防 `[]`。零侧运行会一路绿灯过闸——
`decideMode` 对空入选集按「全成功」记 `full`。

当前三个生产调用点都不可达，但**该字段的注释恰恰写着「使手工构造 ReviewOptions 的调用点
（测试、selftest）不必逐个补这个字段」**——我亲手邀请了最可能传错的调用方。
在 `prepareRun` 加非空断言，把判定处的不变式延伸到直接传参的调用方。

### 七、GLM-06、GLM-07（nit）

- FR-29 行尾标记改拆分式，与正文及 AC-22 对齐。
- 在设计 16.1 的 M10 条目登记「接入任意 Driver 时两个入口必须把当轮 driver 传进判定处」。

## 一条证据核验提示的处置

**`gemini` 侧 consulted 无法与工具轨迹交叉核对**（`consulted_unverified: true`）。
该侧轨迹解析的已知限制，先于本轮存在，不影响采信——且本轮 major 已由我实测复现，
不依赖任何一侧的自述。

## 不做的事

无驳回、无暂缓。11 条全部接受并在本轮落地。

**范围边界**：修复仍限于 M7b 第 5 步范围。桩六件套夹具属第 6 步；
第三家审核者接入属 M8 / M9，AC-22 的「选 3」分支在那之前不可达——本轮不改这条判断。
