---
schema: trivium.disposition.v1
topic: M9-Hook当轮Driver保护集
stage: plan
role: claude
kind: revised
run_id: 20260919T060422Z
addresses:
  - 2026-09-19-M9-Hook当轮Driver保护集-codex.md
  - 2026-09-19-M9-Hook当轮Driver保护集-gemini.md
  - 2026-09-19-M9-Hook当轮Driver保护集-glm.md
---

# 裁决与修订计划：M9-Hook当轮Driver保护集（EV-68）

三侧均给出 `request-changes`，共 13 条意见（重要 6 ｜ 次要 6 ｜ 吹毛求疵 1）。
**全部接受**，其中 2 条在接受的同时修正了依据中的不实部分（AGY-01 的落点、AGY-02 的崩溃断言）。

最重要的收获：**CODEX-01 与 AGY-01 独立收敛到同一个阻断**——我在 §3.2 定的第 1 级来源
（`GateEntry.driver`）在唯一要紧的那个窗口里必然缺失或陈旧。我逐条核实了两侧给的行号，
结论成立，且比两侧描述的更糟：不只是「落空回落到第 2 级」，而是 upsert 会**沿用上一轮的值**
（[state.ts:226-227](src/trivium/state.ts#L226-L227)），于是陈旧值会被当成权威。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 已实核：`review.ts` 四处 `setGateChecked`（938 / 996 / 1512 / 1601）**全不传 driver**；唯一写闸门项 driver 的是 `cli.ts:1005` 与 `:1181`，两处都是 `state: 'awaiting_approval'`，后者更以 `result.ok && stopsForApproval && !alreadyDecided` 为前置——即**裁决件必须已经落盘**。而 Driver 写裁决件正发生在那之前。叠加 `state.ts:226-227` 的「沿用前一条的值」，同槽位重跑换 Driver 时拿到的是**上一轮**的 driver。方向①②在最需要时都反向，且 §3.5 用例手写 gate 值恰好测不出来。 | 修订方案 §2.1：**取消 gate 作为 driver 来源**，改 `latestRunMeta` 为第 1 级；§2.4 补 stale 翻转断言 |
| CODEX-02 | codex | major | 接受 | 已实核设计文档行 826（§6.2 角色后缀行）：「【待实施 · M10】起该判定按**当轮 Driver**（`run.json.driver`）泛化」——本步就是把这条提前。§8.4 的拦截 bullet 写的是「审核者角色后缀（`-gemini.md` / `-glm.md`，取值由 Agent 注册表派生）」，既漏 codex 也未记 driver 来源。两处会随本步合入当场失实。这一条还顺带印证了 CODEX-01：设计的既有口径本来就是 `run.json.driver`，我的计划把更弱的 state 项放在更高优先级，与设计相反。 | 修订方案 §2.6，改用 grep 共现行逐行判，不按记忆点名 |
| CODEX-03 | codex | major | 接受 | 本仓自己的教训，非推测：`test/integration/gate-loop.test.ts` 头部记着「单元测试直接调 hookXxx 并手工 setGate，**绕过了这个缺口**」。本步 driver 解析要跨两个真实文件面，单元夹具两份都是测试自己种的——正是 CODEX-01 能溜过去的结构性原因。 | 修订方案 §2.5：增集成层判据，沿用 `hook(root, name, input)` 真子进程路径 |
| CODEX-04 | codex | minor | 接受 | `.trivium/bin/trivium` exec 的是已安装副本而非工作树产物，不重装则真实会话仍按旧判据拦人。EV-68 要求「第 6 步开跑前实测一次写事件」，那一格若撞上旧副本会被误诊成「修复无效」。与 v1.3.29 台账记过的同类问题同源。 | 修订方案 §2.7 执行顺序末补重装步；§2.8 边界补「验收前必须已重装」 |
| CODEX-05 | codex | minor | 接受 | 已实核 [hooks.ts:369](src/trivium/hooks.ts#L369)：归档内写入在 `return ALLOW` 前**完全不读** state。改后若把解析写在函数开头，(a) 每次 Write/Edit 多付一次 state 读 + run 元数据扫描；(b) 更实质的是关掉写锁的项目今天在业务写入前根本不读 state，改后坏掉的 state 会让它们从退 0 变退 2。这确实不在我 §六 的「影响面实核」里。 | 修订方案 §2.2 写死短路顺序；§2.4 补「非角色后缀、归档外写入退出码不变」断言 |
| CODEX-06 | codex | minor | 接受 | 我自称「与 cmdGate 同源」却只取了取值方式、没取降级语义。`latestRunMeta` 的三元组明确区分「一份都没有」与「有但全读不出」（[meta.ts:396-419](src/trivium/meta.ts#L396-L419)），cmdGate 在后者硬失败。我的第 3 级会把那一格静默按缺省判，正是被点名的形态。计划没表态 = 留给实现期随手选，这是真缺陷。 | 修订方案 §2.1 第 3 级拆成两格并显式拍板 |
| AGY-01 | gemini | major | 接受 | 与 CODEX-01 独立收敛到同一事实，核实无误（`review.ts:938` 置 running、`:1512` 置 `review_done_awaiting_disposition`，均不传 driver）。**但落点我不采纳它的建议**：它主张补 `review.ts` 让闸门真的持有 driver，我改用 CODEX-01 的方案（取消 gate 来源、run 元数据升为第 1 级）。理由三条——①设计 §6.2 的既有口径就是 `run.json.driver`；②`cmdGate` 已经这么取（`cli.ts:855`）；③`run.v2` 里 driver 是**必填**，比可选的闸门项权威，且不动 `review.ts` 的状态迁移，范围更小。按新方案 gate 项的 driver 退化为纯留痕，不修也不影响正确性。 | 修订方案 §2.1；**不**改 `review.ts` |
| AGY-02 | gemini | major | 接受 | 守卫建议成立且与 CODEX-05 同源，接受。**但依据有一处不实，如实指出**：它断言「`task.json` 被误当 stage 传给 `latestRunMeta` 触发 ENOTDIR 异常」——实核 [meta.ts:397-401](src/trivium/meta.ts#L397-L401) 的 `readdir` 外有 catch，返回 `{meta:null,scanned:0}`，**不会抛**。所以这是多余开销与误判问题，不是崩溃问题。另：该条 evidence 引用的 `src/a.ts` 是假想文件名（编排器已报「引用但未列入 consulted」），是举例不是实读，不影响意见成立。 | 修订方案 §2.2 段数 + Stage 合法性校验 |
| AGY-03 | gemini | minor | 接受 | 原计划四条用例确实只覆盖第 1、3 级。方案改版后「run 元数据记有 driver」从第 2 级升为**第 1 级主用例**，这条意见的必要性反而更高。 | 修订方案 §2.4 用例表第 1～2 行 |
| AGY-04 | gemini | minor | 接受 | 与 CODEX-06 独立收敛到同一格（`scanned > 0 && !meta`），同一处置。两侧独立命中提高了可信度。 | 同 CODEX-06，修订方案 §2.1 |
| GLM-01 | glm | major | 接受 | EV-68 条目末段那句「第 6 步开跑前必须先定『非缺省 Driver 以何种会话载体运行』并实测一次写事件」，我的计划全文确实没承接，而 §九.6 又要把 EV-68 转 done——警示会随条目关闭失去载体。用户已定本轮只修 EV-68、验收另行发起，所以载体**决策**留到验收轮是对的，但**知识迁移**不能省。采纳它的③+②组合。 | 修订方案 §2.6：EV-68 关闭理由逐字保留该段并指向新条目；新条目同时写进主设计 §16.1 的 M9 行 |
| GLM-02 | glm | minor | 接受 | 一针见血：原回落用例只有正向断言，「按缺省 Driver 判定」与「回落即放行一切」在那条断言下不可区分。而第 3 级恰是 plan 原稿必经的最常用路径。这与我自己在 §3.4 写的「成对补翻转格、不要重言式」是同一条纪律，我没把它用到新用例上。 | 修订方案 §2.4 用例表「回落」两行成对 |
| GLM-03 | glm | nit | 接受 | `state.ts` 的「缺失即无从得知，不等于缺省 Driver」与本步实现「取不到即按缺省判」并存于同一文件，后来者会读到两句方向相反的话。我 §八.1 自己也承认「字面相抵」却只安排改四个字。 | 修订方案 §2.3：注释写明两层语义分工 |

**统计**：接受 13 ｜ 驳回 0 ｜ 暂缓 0。

---

## 二、修订后的方案

### 2.1 driver 取值：取消 gate 来源，改两级 + 一个硬失败格

原 §3.2 的三级作废。新取值链（论域为「已判定落在归档内、且文件名是角色工件形态」的目标）：

| 级 | 来源 | 取向 |
| :--- | :--- | :--- |
| 1 | `latestRunMeta(layout, stage).meta.driver` —— 由目标路径解析出主题与阶段后查询 | 采信。`run.v2` 里 `driver` 必填，与设计 §6.2、`cmdGate`（`cli.ts:855`）同源 |
| 2 | `scanned === 0`（该阶段从未跑过） | 回落 `DEFAULT_DRIVER`，拦截文案注明「按缺省 Driver 判定」 |
| — | `scanned > 0 && !meta`（扫到留痕却全读不出） | **硬失败退 2**，文案说明留痕坏了，与 `cmdGate` 同口径（CODEX-06 / AGY-04） |

**`GateEntry.driver` 不再作为来源。** 它在 Driver 写裁决件的窗口里恒缺失或陈旧（CODEX-01），
作为来源只会引入错误权威值。该字段维持现状为纯留痕面，`state.ts` 注释相应说明（§2.3）。

### 2.2 短路顺序写死，避免动到无关写入的退出码

`hookPreWrite` 内按此序，**命中才解析 driver**：

1. `looksLikeRoleArtifact(basename(target))` 为假 → 走原有路径，**一行 state 都不读**；
2. 不在归档内 → 同上；
3. 两条都命中 → 才解析主题/阶段并取 driver。

解析归档相对路径时校验：段数 ≥ 3、第 2 段 ∈ `{plan, code, bug}`，否则按现状行为安全回退
（`<主题>/task.json`、主题根直放文件、`_meta/` 下文件都落在这里）。

这样「非角色后缀或归档外的写入，其退出码不因本步新增的读取而改变」成为可断言的承诺（§2.4）。

### 2.3 `state.ts` 注释：写明两层语义分工

不只改「只记不读」四个字。要写清：字段缺失在**语义**上仍是「无从得知」（原注释为真），
而 Hook 侧在无从得知时**按缺省 Driver 判定并在文案注明**——这是可用性取舍，
不是把「缺失」重定义为「缺省」。同时注明本字段已**不是** Hook 的 driver 来源，
来源是 run 元数据，免得后来者照旧注释去接线。

### 2.4 用例（替换原 §3.5）

| 用例 | 构造 | 期望 |
| :--- | :--- | :--- |
| 方向① | `_meta/run-*.json` 记 `driver: codex`，写归档内 `…-response-codex.md` | 退 0 |
| 方向② | 同上留痕，写归档内 `…-claude.md` | 退 2 |
| **stale 翻转** | 闸门项记 `driver: claude`（上一轮遗留）而 run 元数据记 `driver: codex`，写 `…-response-codex.md` | 退 0 —— 锁死 CODEX-01 |
| 回落·正 | 该阶段无任何留痕（`scanned === 0`），写 `…-claude.md` | 退 0 |
| 回落·负 | 同上场景，写 `…-codex.md` | 退 2 —— 与上一行成对才钉得住「按缺省判定」（GLM-02） |
| 留痕损坏 | `_meta/` 下有 `run-*.json` 但全不合契约 | 退 2 且文案点明留痕坏了 |
| 退出码不变 | `block_business_write_when_awaiting_approval: false`，写 `src/` 下普通文件 | 与改动前逐字相同（CODEX-05） |
| 跨时间不变 | 提交锚与 Bash 侧各一条既有断言 | 与改动前逐字相同 |

前六条逐条做变异验证（改动前必红）。

### 2.5 集成层判据（新增，CODEX-03）

在 `test/integration/gate-loop.test.ts` 沿用既有的 `hook(root, name, input)` 真子进程路径，
落一条方向①②的端到端用例：夹具先落一轮真实留痕，再以另一 Driver 起一轮。
配额注意 `test/integration/driver-flag.test.ts:1-22` 的注记——桩配置必须点名本轮入选的每一侧，
否则每次 `npm run check` 会真拉厂商 CLI。

### 2.6 文档与台账同步面（扩大）

- 设计 §6.2 角色后缀行（行 826）与 §8.4 拦截 bullet：**本步就改，不等第 7 步**。
  清扫方式按 CODEX-02 的建议——grep「M10」与「当轮 Driver」共现的行逐行判，不按记忆点名；
- EV-68 转 done 时，**逐字保留**条目末段「必须先定会话载体并实测一次写事件」那句，
  并指向新登记的承接条目（GLM-01）；
- 新条目内容 = 原 §五 的 plan 阶段时序边界 + 会话载体待定与实测前置，
  双落点：BACKLOG 与主设计 §16.1（M9 第 6 步行 + M10 行）。

### 2.7 执行顺序（替换原 §九）

1. 拆函数 + 改签名，`tsc` 先红后绿；
2. 短路顺序 + 路径解构守卫（§2.2）；
3. driver 取值链（§2.1），含硬失败格；
4. 既有用例分两类改；
5. 新增八条用例，前六条逐条变异验证；
6. 集成层用例（§2.5）；
7. 注释与文案收口（§2.3 + `hooks.ts:113-121`）；
8. 文档与台账同步（§2.6）；
9. **`npm run build && node dist/install.cjs`**（CODEX-04）。

### 2.8 已知边界（扩充）

原 plan 阶段原稿时序那一格维持（按新方案，原稿写在 `review --start` 之前、
该阶段 `scanned === 0`，落第 2 级回落，非缺省 Driver 仍写不出 `-codex.md` 原稿）。
**新增两条**：

- 本步改动须重装才在真实会话生效，第 6 步验收前必须已重装（CODEX-04）；
- 会话载体未定：Hook 只挂 Claude Code 的 `PreToolUse`，若第 6 步让别家 Driver 在自己 CLI
  会话里执笔，本步修复不在验收路径上被触发（GLM-01）。**载体决策属验收轮，不在本步**。

---

## 三、对三侧盲区的回应

- codex 与 glm 都声明未跑 `npm run check`、基线数字采信计划自述。**我已实跑核实**：
  1459 tests / 1457 pass / 0 fail / 2 skip，与计划所引一致。
- glm 声明「`review --start` 是否写 driver 未逐行核实，结论不依赖它——第 2 级兜底覆盖该窗口」。
  这个免责判断**方向是对的但理由不成立**：正因为 review 侧不写，第 1 级才必须换成 run 元数据；
  若照原计划保留 gate 为第 1 级，陈旧值会先于「兜底」被采信。codex 与 gemini 读了 `review.ts`，
  glm 没读，这是本轮异构取证的实际收益。
