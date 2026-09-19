---
schema: trivium.disposition.v1
topic: M9-Hook当轮Driver保护集
stage: code
role: claude
kind: response
run_id: 20260919T064055Z
addresses:
  - 2026-09-19-M9-Hook当轮Driver保护集-codex.md
  - 2026-09-19-M9-Hook当轮Driver保护集-gemini.md
  - 2026-09-19-M9-Hook当轮Driver保护集-glm.md
---

# 应答与修改方案：M9-Hook当轮Driver保护集（EV-68）

三侧结论：codex `approve-with-nits`、gemini `approve-with-nits`、glm `request-changes`。
共 12 条（重要 1 ｜ 次要 5 ｜ 吹毛求疵 6）。**接受 11 ｜ 驳回 1 ｜ 暂缓 0。**

最重要的一条由 **CODEX-01 ≡ GLM-01 独立收敛**：`latestRunMeta` 是 newest-first
**取第一份可读者**，于是「最新那份读不出、较旧一份可读」会返回 `{kind:'ok'}`，
Hook 拿**上一轮**的 driver 判当轮身份，而拦截文案还断言「取自该阶段最近一份运行留痕」——
那句在这一格是假的。我已逐行核实 [meta.ts:410-418](src/trivium/meta.ts#L410-L418) 成立。

**这一条必须修，因为它让本步的论证自相矛盾**：我否掉 `state.json` 闸门项的理由正是
「upsert 会沿用前一条的值，被当成权威值」，而这里是同一形态的留痕版。
错误放行方向（当轮受保护的 `-claude.md` 变成可伪造）落在安全面，且 Hook 是拦截型、
没有跑后兜底；`warn()` 走 stderr，退 0 路径上 Driver 完全看不见自己被判成了上一轮的人。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | major | 接受 | 已实核 [meta.ts:410-418](src/trivium/meta.ts#L410-L418)：`for (const id of ids) { const m = await readRunMeta(...); if (m) return { meta: m, scanned, unreadable } }`——跳过的**较新**项只进 `unreadable` 并 `warn`。我的 `resolveRoundDriver` 在 `r.meta` 非空时把 `r.unreadable` 整个丢弃，于是「最新一份坏了」会静默降级为上一轮 Driver。双向后果与本步否掉闸门项时列的两条逐字同形。指出「`warn` 在退 0 路径不可见」也成立（[util/log.ts](src/trivium/util/log.ts) 写 stderr）。 | §2.1 |
| CODEX-01 | codex | minor | 接受 | 与 GLM-01 同一缺口，两侧独立命中。它补充的两点我采纳：①`gate` 能容忍这种降级是因为另有提交锚跑后兜底（`checkRunManifests`），**Hook 没有**；②修法应在 Hook 侧收紧而不是动 `latestRunMeta`（`gate` 依赖逐个下试那层兜底）。这决定了修法是「Hook 侧独立收紧」而非「改公共函数」。 | §2.1 |
| CODEX-02 | codex | minor | 接受 | 已实核演进设计 §9.3 原文：「`isForgedRoleFile` / `bashTargetsProtected` 的字面集按 `--agent` 动态生成」——这半句对 Write 侧在本步之后已失实（改从留痕取，CLI 里也没有 `--agent`）。§8.5 与 §24 台账行同样仍挂着 `--agent` 那套。冲突裁定规则救不了，因为 §8.4 与 §8.5 都在主设计内部。M10 照 §9.3 施工会给同一条安全判据造出第二个事实源，而那正是 §8.4 刚在闸门项上明令禁止的形态。它顺带指出的「第四种结局（定位不出阶段）设计没写」也成立。 | §2.4 |
| CODEX-03 | codex | nit | 接受 | 已实核 [hooks.ts:146](src/trivium/hooks.ts#L146) 与 [:151](src/trivium/hooks.ts#L151)：这两行是**活注释**（描述现状结构），却仍写 `hasCriticRoleSuffix`「（本函数）」与 `ROLE_SUFFIX_ANYWHERE`——全仓已无这两个符号，按 grep 找的人一无所获，且与紧邻的「## 两种语义已在签名上分家」并存两个互斥的现状描述。BACKLOG EV-55 落点列同样残留旧名。**它对 `test/unit/hooks.test.ts:126` 的判断我同意可以留**：那处是「缺口本体长什么样」的历史叙述，不是现状描述。 | §2.3 |
| CODEX-04 | codex | nit | 接受 | 判据不对称属实：「在不在归档内」取词法 ∪ realpath 的并集，而「属于哪个主题/阶段」是先词法、命中即止。当 `<主题>` 或 `<阶段>` 那一级本身是软链时，写入实际落在 realpath 那侧，driver 却按词法那侧解析——用错阶段的留痕判身份。**我采纳它的第一个建议而非「注释写明取舍」**：`locateArchiveTarget` 要找的是**实际落点**，realpath 更接近实际落点，词法优先在语义上就是错的（不只是取舍）。 | §2.2 |
| CODEX-05 | codex | nit | 接受 | 与 GLM-03 同一处，两侧独立命中，见下条。 | §2.5 |
| GLM-03 | glm | minor | 接受 | 这条我自己犯了第二次：「普通业务文件不触发解析」用例**没有鉴别力**——把 `resolveRoundDriver` 无条件提到函数开头，`src/a.ts` 走 `locateArchiveTarget`→null→缺省 Driver→`hasProtectedRoleSuffix` false→ALLOW，退出码一字不变。而我在 [hooks.ts](src/trivium/hooks.ts) 注释里写了「该承诺已锁成断言」，**强于事实**。这与我在留痕损坏那条用例上犯的是同一族错（本轮 EV-68 关闭记录里自己刚写过）。GLM-03 给的构造（归档内**非角色工件**如 `<主题>/code/notes.txt` + 种一份损坏留痕）正确且有鉴别力，直接采用。 | §2.5 |
| AGY-01 | gemini | minor | 接受 | 属实：外层 `if` 已判过 `isInsideArchiveResolved`，内层 `isForgedRoleFile` 又调一次（它是 `hasProtectedRoleSuffix && isInsideArchiveResolved`），软链场景下 `safeRealpath` + `resolveExisting` 重复走。改为直接调 `hasProtectedRoleSuffix`。**`isForgedRoleFile` 本身保留**——它是导出的语义完整判据，测试与外部调用在用，不删。 | §2.2 |
| AGY-03 | gemini | nit | 接受 | 已实核 [hooks.test.ts:151](test/unit/hooks.test.ts#L151)：该段仍写「`driver` 参数自称是『M10 的接口』……到 M10 才发现它没接上就太晚了」，而生产注释已改成「EV-68 已接上，不再是 M10 的预留接口」。同一件事两处相反时间面表述。 | §2.3 |
| GLM-02 | glm | minor | 接受 | **这是我没做完自己承诺的事**：plan 阶段裁决件 §2.6 白纸黑字写着「双落点：BACKLOG 与主设计 §16.1（M9 第 6 步行 + M10 行）」，实际只改了 M9 行。已实核 §16.1 的 M10 行前置栏仍只有「agy skills 真实加载行为实测通过」，而 EV-55 / EV-71 / EV-72 三条在 BACKLOG 里都写明是「M10 第一次换 Driver 之前」的硬前置。按里程碑行圈范围的人会漏掉三道闸。 | §2.6 |
| GLM-04 | glm | nit | 接受 | 属实：计划 §2.5 写的是「夹具先落一轮真实留痕，**再以另一 Driver 起一轮**」，我交付的是用 `newRunMeta` 手写 `run-RDRV.json` 直落 `_meta/`。缓解是真的（写侧同一生产者 + `readRunMeta` 契约校验 + 真子进程读真文件），但确实偏离了已批准计划的措辞，而我在注释里把它当作 CODEX-03 的完整履行来叙述。**按它的要求只补声明、不返工**——真实起轮要点名每一侧桩配置，配额与复杂度不相称。 | §2.5 |
| AGY-02 | gemini | nit | 驳回 | **正则 memoization 在这里收益为零。** Hook 的每一次触发都是 `hooks.json` 起的一个**独立子进程**（`exec "$W" gate hook-pre-write`），进程内缓存活不过单次判定——`roleSuffixAnywhere()` 在一个进程里最多被调用一次。`hasProtectedRoleSuffix` 同理。该条依据写的「每次 `hookPreBash` 都会被调用」在**进程模型**这一层不成立：那个「每次」就是「每个进程一次」。而缓存会引入一个真实代价：`criticRoleSuffixes()` 从注册表派生，缓存等于在模块级固化取值——**那正是 EV-68 本次要消灭的形态**（`ROLE_SUFFIX_ANYWHERE` 原先就是模块级 `const`）。为一个不存在的热路径重新引入刚拆掉的固化，方向是反的。如果将来 Hook 改成常驻进程，这条可以重开。 | 不改 |

---

## 二、修改方案

### 2.1 `resolveRoundDriver`：把「较新的留痕读不出」升为硬失败（GLM-01 ≡ CODEX-01）

`latestRunMeta` 的返回里本来就带着 `unreadable`，我丢弃了它。改为：

```
if (r.meta && r.unreadable.length === 0) → { kind: 'ok', driver, fromDefault: false }
if (r.meta && r.unreadable.length  >  0) → { kind: 'corrupt', unreadable }   // 新增这一档
if (!r.meta && r.scanned > 0)            → { kind: 'corrupt', unreadable }
if (!r.meta && r.scanned === 0)          → { kind: 'ok', driver: DEFAULT_DRIVER, fromDefault: true }
```

判据是「**比被采信的那份更新**的留痕里有读不出的」——`latestRunMeta` 是 newest-first 且
命中即返回，所以 `unreadable` 里装的恰好全是比 `meta` 更新的那些，语义天然对齐，
不需要再比较 run_id。拦截文案列出被跳过的 run_id。

**这会让 Hook 与 `cmdGate` 在这一格口径分叉，是有意的**（GLM-01 提醒了这点）。理由：
`gate` 容忍降级是因为它另有提交锚 `checkRunManifests` 跑后兜底，而 Hook 是拦截型、
**没有任何跑后兜底**，错误放行当场生效且不可追。这条分叉理由要写进 `resolveRoundDriver`
的注释与设计 §8.4，免得后人以为是漏改。同时把 `gate` 侧的同形缺口**单独登记 EV-73**
（它是否也该收紧需要与提交锚的兜底强度一起评估，不在本步）。

### 2.2 路径定位改 realpath 优先，并去掉重复判定（CODEX-04 + AGY-01）

- `locateArchiveTarget`：先试 `resolveExisting(lexical)` 相对 realpath 归档根，
  取不到再回落纯词法。理由写进注释——它找的是**实际落点**，而写入会沿软链落到 realpath 那侧；
  这与 `isInsideArchiveResolved` 的并集语义不同，后者是 fail-closed 的「任一在内即算在内」，
  两者**有意不同源**，注释要写明以免被后人「对齐」掉。
- `hookPreWrite` 内层：`isForgedRoleFile(...)` → `hasProtectedRoleSuffix(target, driver)`，
  外层 `if` 已确立落在归档内。`isForgedRoleFile` 保留导出不删。
- 补一条用例：`<阶段>` 那一级是软链时，driver 按 realpath 侧的阶段留痕解析。

### 2.3 注释与落点的旧名清扫（CODEX-03 + AGY-03）

- [hooks.ts:146](src/trivium/hooks.ts#L146) / [:151](src/trivium/hooks.ts#L151)：上半段整体重写为拆分后的结构
  （或删去——下半段「两种语义已在签名上分家」已完整覆盖）。我取**删上半段**：两段并存本身就是这条意见的成因。
- [hooks.ts:112](src/trivium/hooks.ts#L112) 那句「它今天恒成立，改错了当场红」按用例自己的口径改为「恒成立但证伪力有限」。
- BACKLOG EV-55 落点列改名。
- [hooks.test.ts:151](test/unit/hooks.test.ts#L151) 段落改写：参数契约已于 M9 第 6 步前置接通（EV-68），
  该用例现在锁的是**源头**函数，缺口在下游消费点、由新增用例锁。

### 2.4 设计面：`--agent` 的裁定与第四种结局（CODEX-02）

- §8.4 补第四种结局：**定位不出 `<主题>/<阶段>`** 时按缺省 Driver 判定且一次留痕都不读
  （归档根两段式路径、`verify/` 下同形态文件属此列）；同时补 2.1 新增的「较新留痕损坏」档。
- §8.4 / §8.5 写明裁定：**当轮 Driver 的唯一来源是 `run.json.driver`**；
  `--agent` 若在 M10 落地，只用于**安装目标与会话身份声明**，**不得成为第二条判据源**。
- 演进设计 §9.3 的「字面集按 `--agent` 动态生成」半句标注为已被主设计 §8.4 取代
  （演进设计正文自 v1.0.0 冻结，按既有机制只在主设计侧落修正引文，与 §7.6「五件套 → 七件」同一做法）。
- §24 台账「8.4 / 8.5 Hook `--agent` 与多目标」行的状态注明 Write 侧判据已在 M9 第 6 步前置落地，
  该行剩余范围收窄为安装目标与多目标合并。

### 2.5 两条用例的鉴别力与忠实度（CODEX-05 ≡ GLM-03、GLM-04）

- 「不触发解析」用例按 GLM-03 的构造重写：该阶段 `_meta/` 种一份**损坏**的 `run-*.json`，
  再写归档内**非角色工件**（`<主题>/code/notes.txt`，`block_business_write=false`）。
  短路正确 → ALLOW；解析若被无条件前置 → 撞 corrupt 退 2。变异验证必须咬住，否则这条仍是空断言。
- [hooks.ts](src/trivium/hooks.ts) 那句「该承诺已锁成断言」改为如实表述：该性质由短路条件**结构性**保证，
  用例锁的是退出码不受影响。
- 集成用例注释补一句偏离声明：为何用 `newRunMeta` 直落而非真实起轮（桩配置须点名每一侧、配额成本），
  并说明它只解了 CODEX-03 关切的一半。

### 2.6 §16.1 M10 行补齐前置（GLM-02）

M10 行前置栏补 EV-55（跨时间面重写）、EV-71（会话载体拍板 + 实测写事件）、EV-72（主题级 driver 落盘），
各一句触发条件。这是 plan 阶段裁决件 §2.6 已承诺而未做完的那一半。

### 2.7 验证

1. `npm run check` 全绿，跳过数不增；
2. 2.1 新增档、2.2 realpath 优先、2.5 重写的用例**逐条变异验证**（改动前必红）——
   2.5 那条尤其要跑，它上一版就是没跑变异才漏过去的；
3. `npm run build && npm run install:local` 后在真实 Hook 路径复验两个方向。

---

## 三、对三侧盲区的回应

- codex 与 glm 都声明未跑测试与构建。本轮 diff 里的数字（1469 / 1467 pass / 0 fail / 2 skip）
  与变异验证是我实跑的；2.1～2.5 改完会重跑并把新数字写进提交说明。
- glm 声明未核实「重装才生效」一步。该步已执行（`install:local`），并在真实 Hook 路径上
  实测过两个方向（写 `-glm.md` 退 2 且文案显示「取自该阶段最近一份运行留痕」、写 `-revised-claude.md` 退 0）。
  **但这恰好也是 GLM-01 的现场**：那句文案在「较新留痕损坏」时会是假的，2.1 修完要一并复验。
- gemini 判「设计与时间推进严格吻合」，codex 与 glm 则各自指出了设计面的未同步（CODEX-02 的 `--agent`、
  GLM-02 的 M10 行）。三侧在这一点上结论不一致，我按 codex 与 glm 的具体证据处置——
  两条我都逐行核过，属实。
