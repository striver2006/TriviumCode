---
schema: trivium.disposition.v1
topic: M9-Driver旗标全链路与选侧收口
stage: code
role: claude
kind: response
run_id: 20260918T231928Z
addresses:
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-r3-codex.md
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-r3-gemini.md
  - 2026-09-19-M9-Driver旗标全链路与选侧收口-r3-glm.md
---

# 应答与修改方案：M9-Driver旗标全链路与选侧收口（代码审 第 3 轮）

- **运行**：`20260918T231928Z` ｜ **三侧一致 `approve-with-nits`**
- **共 11 条**（阻断 0 ｜ 重要 0 ｜ 次要 8 ｜ 吹毛求疵 3）
- **裁决结果**：**11 条全部接受**，无驳回、无暂缓。
- 本轮只审上一轮 12 条裁决落地后新增的那部分（源码可执行增量 28 行 + 测试 580 行）。

**收敛信号**：r1 三侧全 `request-changes`（13 条，含 4 条重要）→ r2 两侧 `request-changes`（12 条，含 5 条重要）→ **r3 三侧全 `approve-with-nits`，0 阻断 0 重要**。本轮 11 条里有 8 条集中在**同两件事**上。

---

## 0. 三条焦点的答案

### 焦点一 · 新加的 role↔driver 比对会不会误拒

**不会，而且三侧给的是结构性理由，不是「跑了没炸」。**

codex 的论证最完整：`disposition.v1.json` 把 `role` 钉成 `const: claude`，所以

- `driver` 为缺省值时 → `role` 与 `driver` **恒等**，判据永不生效；
- `driver ≠ claude` 时 → 它只在 **schema 已经放行**的那一格（文件名 `-revised-<driver>.md` + `role: claude`）判红。

三侧各自核了我点名的三条路径，结论一致：

| 我担心的路径 | 结论 | 依据 |
| :-- | :-- | :-- |
| 降级轮次 | 无交互 | 该判据只读被定位文件自身的 front-matter，与 `degraded` / `voidedSides` / `fallbackIds` 各走各的通道 |
| 跨轮次复用 | 已被挡住 | `(parsed.role, kind, rerunIndex)` 定位键 + `fm.run_id !== input.runId` 双重比对，本判据不改变这一格 |
| `run_id` 对不上 | 不会错位 | `--run-id` 钉住时 `driver` / `rerunIndex` / `runId` **同源自 pinned 的那份留痕** |

存量核对（两侧独立做的，数字略有出入是统计口径不同，结论一致）：**68 份裁决件 role 全为 `claude` 且与文件名后缀逐份一致；82 份运行元数据里 49 份 v2 的 `driver` 全为 claude，33 份 v1 经 `migrateRunMetaV1` 恒置缺省**。我自己核的 72 份也是全一致。

codex 另外验了一件我没想到要验的事：**T-11 第 2 格的 `/role=/` 断言是可分辨的**——schema 那条走 `formatErrors`，形如「role must be equal to constant」，**不含 `=`**；只有新判据的 `role=${…}（当轮 Driver 是 …）` 能满足。删掉新判据该格当场红，不是假证明。

### 焦点二 · 扫描器还有哪些形态会少剥或多剥

**比我知道的多得多，而且两个方向都坏。** 我按三侧点名的形态逐条复现，**七条全部成立**：

| 方向 | 形态 | 剥离结果 |
| :-- | :-- | :-- |
| 少剥（→ 假绿） | `}` 之后 | `if (x) { y(); } /driver/.test(s);` 原样保留 |
| 少剥 | `]` 之后 | `const a = arr[0]` 换行后的 `/driver/` 原样保留 |
| 少剥 | `throw` 之后 | `throw /driver/;` 原样保留 |
| 多剥（→ 假红） | `++` 之后 | `n++ / total / 2` → `n++ "<re>" 2` |
| 多剥 | TS 非空断言 `!` | `obj.val! / driver / scale` → `obj.val! "<re>" scale` |
| 多剥 | 属性名撞关键字 | `o.in / total / 2` → `o.in "<re>" 2` |
| 多剥 | 模板插值含花括号 | `` log(`${fn("}")} driver`) `` → `log("<str>" {fn("<str>" )` —— **连花括号都漏出来了** |

CODEX-01 指出的那句最要命，我认：我在文档块里写「宁可少剥，不可跑偏」，而文件开头追的性质是「判据写错时倒向红」——**这两句在 `/` 的歧义上直接矛盾**。判成除号时正则正文原样留在被扫文本里，`hasProperty` 就能从「不是代码的东西」里命中 `driver`。**这个守卫在最要紧的方向上是 fail-green，而它是这一步 12 处接线判据唯一的看守。**

codex 还做了实证而非目测：他把我的状态机逐字复刻，用 `ts.createSourceFile` 造 oracle，对 `src/` 下 63 个 `.ts` 逐字符比对——**今天少剥 0、多剥 0**（所以是潜伏面不是活缺陷）；然后在内存里删掉 `newRunMeta` 实参块的真 `driver,`（判据转红），再补一行 `if (ok) /driver/.test(name)`，**判据重新转绿**。

**所以我采纳他的方向①：换成 TypeScript 官方词法器。** 理由不是「更好」，而是这一族根本不该手写——我已经在这个状态机上栽了两次（第一次是正则里的反引号，这次是七种形态），而 `typescript` 就在 `node_modules` 里，codex 这次正是拿它当 oracle 的。换掉之后这五条意见整体消失，代码还更短。

### 焦点三 · EV-67 的取舍成不成立

**取舍成立，但我写的理由是事实错误——三侧独立打中同一处。**

我写的是「收紧会与『`--model-<side>` 不带 `--critics` 必须放行』那条既有正例直接冲突」。我自己核了：

```
CRITICS         = claude,codex,gemini,glm
DEFAULT_CRITICS = codex,gemini,glm
SELECTABLE      = codex,gemini,glm
SELECTABLE[0]   = codex  ∈ DEFAULT_CRITICS ? true
```

那条正例采样 `SELECTABLE[0] = codex`，而 `--critics` 缺省回落就是含 codex 的 `DEFAULT_CRITICS`。**收紧到「已解析出的入选集合」之后它照样绿。** 我把「稻草人变体」（无显式 `--critics` 即全拒）当成了唯一实现方式。

glm 还补了一刀：三个入口都在 `assertModelOverrideKeys` **之前**就调了 `resolveCriticSelection`，入选集在判定点手边——**推迟是设计选择，不是接线约束**。

真正的开放问题只剩一个：**用户显式 `--critics` 排除掉的那一家，其模型覆盖该拒还是该警。** 那确实需要单独一轮验证（是行为变化，一批今天静默生效的写法会当场退 64）。

**处置**：按 glm 的建议「只改叙述不改行为」——EV-67 保持 todo，但把理由改准。留一句失实的冲突叙述在台账里，会让下一个人绕开一个不存在的约束、偏向更重的方案，这恰恰违背本仓「留痕里的失实断言先改再提交」。

---

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | 次要 | 接受 | 两处都认。①「宁可少剥」与「判据写错时倒向红」自相矛盾，而少剥方向正是 fail-green；②他用 TS AST 做 oracle 逐字符比对 63 个文件、再用内存变异证明「删掉真传值 + 补一行 `if (ok) /driver/.test(name)` → 判据重新转绿」，这是实证不是推测。我已独立复现全部形态。采纳其**方向①**：手写词法器这条路我栽了两次，而 `typescript` 就在 `node_modules` 里。 | **M1**：`test/unit/driver-wiring.test.ts` 的 `stripNonCode` 整体换成 TypeScript 官方词法器（`ts.createSourceFile` + `createScanner`），按注释 / 字符串 / 模板（保留 `${…}`）/ 正则四类区间置空，删掉手写状态机与 `REGEX_PREV` / `REGEX_KEYWORD`。**M2**：把本轮复现的七条形态全部写成自测。 |
| AGY-01 | gemini | 次要 | 接受 | 少剥一族，实测成立：`REGEX_PREV` 只含开括号不含 `}`，而 JS 控制块后无需分号；`REGEX_KEYWORD` 漏了 `throw`。两者都让正则正文原样留下——若其中含 `driver` 即假绿。 | 并入 **M1**（AST 不区分前驱上下文，这一族整体消失）；形态进 **M2** 的自测清单。 |
| GLM-02 | glm | 次要 | 接受 | 与 AGY-01 同族并补全了清单：`)` / `]` / `}` 三格一起漏，且**空白不更新 `prevSig`**，所以换行后同样成立。他的第二句更重要：「该文件的全部立意就是把这类边界写成受测事实，清单本身漏了同族两格」——我只在注释里写了 `)` 一格，那是**已知边界写在注释里不算护栏**的又一次重演，而这句话是我自己上一轮写下的。 | 并入 **M1** / **M2**。**M2** 逐条钉死 `)` / `]` / `}` / `throw` 四格。 |
| AGY-02 | gemini | 次要 | 接受 | 多剥一族，实测三条全中：`REGEX_PREV` 含 `!` `+` `-`，于是 TS 非空断言 `obj.val! / driver / scale`、后缀 `n++ / total / 2` 被判成正则起点，把同行两个 `/` 之间的真代码整段吞掉。**模板插值那条最严重**：`${…}` 只做裸花括号深度计数，`` `${fn("}")}` `` 会提前闭合，实测输出连花括号都漏了出来。 | 并入 **M1**（AST 天然分得清一元/二元与插值边界）；三条形态进 **M2**。 |
| GLM-03 | glm | 吹毛求疵 | 接受 | 与 AGY-02 同族，另补一条我没想到的：`REGEX_KEYWORD` 的 `[^\w$]` 会匹配**成员访问的 `.`**，于是 `o.in / total / 2`、`o.of`、`x.return` 被当成关键字结尾。他对后果的分级也准确：多剥以假红为主（锚点计数变少、`argBlockAt` 判 null 即 fail-closed），唯一的假绿方向现实中构造不出来。 | 并入 **M1**；`o.in` 形态进 **M2**。 |
| CODEX-02 | codex | 次要 | 接受 | 事实错误，我已独立复核：`SELECTABLE[0] = codex ∈ DEFAULT_CRITICS = [codex,gemini,glm]`，那条正例在「实际入选 + 缺省回落」实现下**照样通过**。我把稻草人变体当成了唯一实现方式，于是一句不实的事实同时进了台账与集成用例注释。按本仓「留痕里的失实断言先改再提交」，这条必须本轮改。 | **M3**：`BACKLOG.md` 的 EV-67 与 `test/integration/driver-flag.test.ts` 的「论域边界」注释段，理由一律改准——收紧的真实代价是**行为变化**（一批今天静默生效的写法会当场退 64，需要单独一轮验证），不是「被一条测试挡住」。 |
| AGY-03 | gemini | 次要 | 接受 | 与 CODEX-02 同源、独立得出同一结论，并点明「各入口均已通过 `resolveCriticSelection` 计算出确定的入选集，不存在『不带 `--critics` 时语义未定』」——那正是我给自己找的第二个理由，同样不成立。 | 并入 **M3**。 |
| GLM-01 | glm | 次要 | 接受 | 与 CODEX-02 / AGY-03 同源，且给出了本条最该采纳的处置口径：**只改叙述不改行为**。他还指出真正的开放问题只剩「显式 `--critics` 排除侧的覆盖该拒该警」，而 EV-67 自己给的告警修法方向已经是对的。三侧独立收敛到同一判断，我不再自辩。 | 并入 **M3**；EV-67 维持 todo，修法方向保留「先落告警」。 |
| CODEX-03 | codex | 次要 | 接受 | 实核成立，而且正是我这轮宣称已经关掉的那一族。判定收口成了一份，但**收集面仍有两份**：`topic resolve` 遍历 `ALL_AGENT_IDS`，`review --start` / `preflight` 遍历 `CRITICS`。于是「已登记但未启用为审核者」的 `--model-<id>` 在后者**根本进不了 `Object.keys(modelOverrides)`**，`assertModelOverrideKeys` 看不到 → 不退 64、不留痕、不告警。今天不可达（四家全启用），但登记第五家而未启用它时立刻可达。**我新写的注释还宣称两个入口已同口径**——读的人会以为这族关掉了。 | **M4**：`collectModelOverrides` 的论域由 `CRITICS` 改为 `ALL_AGENT_IDS`（收集＝全部已登记，判据＝已收口的 `selectableCritics`），与 `topic-args.ts` 同口径；`cli.ts` 那段注释同步改准。 |
| CODEX-04 | codex | 吹毛求疵 | 接受 | 成立。`driverEnabled` 这个字段的存在理由就是「放行但如实标注」，而缺省取了**乐观**的一侧：`undefined` 与 `true` 一律按「已启用」呈现。将来任何新调用方传了 `driver` 却忘了 `driverEnabled`，那半句保留话术会静默消失——而 M9 只校验「已登记」这个口径，恰恰是必须由留痕与提示兜住的。 | **M5**：`preflight.ts` 把缺省翻到保守侧——除非显式 `=== true`，否则一律带上「该值仅用于选侧判定」的保留话术。 |
| GLM-04 | glm | 吹毛求疵 | 接受 | 成立，而且戳破了我自己写的一句不准确的注释。L13 的落地注释称「`--check` 那条早有同款提示」，实际指的是「找不到运行元数据」那条，**不含 `missing_disposition`**。于是 worker 中途崩溃留下骨架时，`gate --check` 落在 `missing_disposition`，文案只说「必须产出裁决件」，会把「其实想验上一轮」的人引去补一份不必要的裁决件。 | **M6**：`gate.ts` 的 `missing_disposition` 文案在**未给 `--run-id`** 时补一句同款出口；给了 `--run-id` 时不出现（避免上一轮 CODEX-06 指出的「劝人用已经用过的旗标」）。需给 `GateCheckInput` 加一个可选的「轮次是否被钉住」标志。 |

---

## 2. 落点汇总（审批后按此实施）

| 落点 | 文件 | 内容 | 对应意见 |
| :-- | :-- | :-- | :-- |
| M1 | `test/unit/driver-wiring.test.ts` | `stripNonCode` 换成 TypeScript 官方词法器，删手写状态机 | CODEX-01 / AGY-01 / AGY-02 / GLM-02 / GLM-03 |
| M2 | 同上 | 七条形态（`)` `]` `}` `throw` / `++` `!` `o.in` / 模板插值花括号）逐条写成自测 | 同上 |
| M3 | `doc/08_project/BACKLOG.md`、`test/integration/driver-flag.test.ts` | EV-67 的理由与用例注释改准 | CODEX-02 / AGY-03 / GLM-01 |
| M4 | `src/trivium/cli.ts` | `collectModelOverrides` 论域改为 `ALL_AGENT_IDS`，注释改准 | CODEX-03 |
| M5 | `src/trivium/preflight.ts` | `driverEnabled` 缺省翻到保守侧 | CODEX-04 |
| M6 | `src/trivium/gate.ts` | `missing_disposition` 文案按是否钉住轮次分两句 | GLM-04 |

**变异验证**（每条都该当场红）：

- 把 M1 的词法器换回手写状态机，并在某实参块里补 `if (ok) /driver/.test(name)` → M2 的少剥自测红（今天这条**是绿的**，正是 CODEX-01 的实证）
- 在实参块里写 `` `${fn("}")}` `` → M2 的模板自测红
- 把 M4 的论域改回 `CRITICS` → 需配一条「未启用为审核者的 id 也要退 64」的用例（用注入表构造第五家）
- 删 M6 的分档 → 对应文案断言红

**M1 的回归口径**：换词法器之后，12 条接线判据与 `RECONCILE` 对账的结果**必须与今天逐条相同**——codex 已经证明今天两者在 `src/` 全量上零差异，所以这是一次可对账的等价替换，不是重写。任何一条变了都要当场查清，不许直接改期望值。

---

## 3. 三侧确认正确、本轮不动的部分

- **焦点一整体**：三侧独立核过 role↔driver 比对无误拒路径，且理由是结构性的（schema 的 `const: claude` 使两者在缺省 Driver 下恒等）。存量留痕零影响，两侧各自实测过。
- **T-11 第 2 格的断言可分辨**（codex 专门验了 `/role=/` 不会被 schema 那条误满足）。
- **L7–L10 的落地质量**（glm 逐条核过）：`argBlockAt` fail-closed 并首次配自测；`DEFAULT_DRIVER` 负断言把豁免写成 `defaultOk` **数据**而不是注释；`RECONCILE` 用 `fn` 字段精确匹配、避开了 `locateSubjectReadOnly` 的前缀陷阱。
- **L11 / L12 / T-12**：真实语料回归把纪律换成机制；两处锚点负例补了「`indexOf` 命中先断言」；T-12 把出口口径钉成断言（含「`--run-id` 在该格必败」的实证）。
- **打包面无问题**（codex 专门核的，我没想到要看）：`isReviewArtifact` 的 `await import('./render.js')` 在单文件 CJS 产物里被 esbuild 内联成 `Promise.resolve().then(() => (init_render(), render_exports))`，不会在安装位置找 `render.js`；`meta.ts` 的 `await import('./archive.js')` 同理。
- **行终止符假设**（codex 专为扫描器核的）：`src/` 下 63 个 `.ts` 全为 LF、UTF-8 无 BOM、无 U+2028/2029。
- **`deny-matrix` 里那个简化剥离器**（glm 判定）：是冗余的第二道弱判据，`freeze` 块另有强剥离器看着，无净缺口——所以 M1 不必连它一起改。

---

## 4. 本轮核验降级说明

- **codex 侧被标了 7 条「疑似写入」**。从命令文本看，那是它复刻我的 `stripNonCode`、用 `ts.createSourceFile` 造 oracle 去逐字符比对 `src/` 全量源码的**只读分析脚本**（`node -e` + `fs.readFileSync`）。判定命中的是命令文本里含 `||` / `;` 掩码，不是真的写入。指纹比对无漂移（`drift: false`），我采信其结论——**而且这次它的核心证据正是靠这些脚本拿到的**。
- **codex 侧只读核验不可用**：该侧被拒的写操作不进轨迹，只读保障从三重降到两重（指纹比对仍有效）。
- **codex 侧路径核验无结构化输入**：禁读核验完全由命令文本字面扫描承担（已知形态必检，非完备）。
- **三侧 `consulted` 均无法与工具轨迹交叉核对**。
- **三侧都未实跑测试**（只读沙箱）。codex 在内存里复刻判定函数做了实证，gemini 与 glm 为静态核对 + grep 语料复核。M1 落地后我会实跑并对账。
