---
schema: trivium.disposition.v1
topic: M9-Hook当轮Driver保护集
stage: code
role: claude
kind: response
run_id: 20260919T085742Z
addresses:
  - 2026-09-19-M9-Hook当轮Driver保护集-r2-codex.md
  - 2026-09-19-M9-Hook当轮Driver保护集-r2-gemini.md
  - 2026-09-19-M9-Hook当轮Driver保护集-r2-glm.md
---

# 应答与修改方案（第 2 轮）：M9-Hook当轮Driver保护集

三侧结论：codex `request-changes`（**解析降级**，意见塌缩为 `CODEX-F01`）、gemini `approve-with-nits`、glm `request-changes`。
闸门要求裁决的编号 5 个。**全部接受，零驳回。**

这一轮比上一轮更该跑。两件事：

1. **GLM-01 是一个真的安全缺口，而且是我这次 diff 引入的。** 我已构造实测复现了整条链。
2. **我上一轮那条「两种解析顺序行为等价、属表达性修正」的结论是错的**，而且已经落进了代码注释与 BACKLOG。
   错因不是推理，是**实测没跑到它声称的机制上**：夹具用了 `t/mirror`，而 `mirror` 不是合法 Stage，
   词法分支恒为 null、必然回退 realpath——「调换顺序仍绿」靠的是这个，不是我写的「readdir 沿软链」。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | major | 接受 | **已构造实测复现，攻击链每一环都成立**：realpath 分支解到归档外 ⇒ `stageSegmentsUnder` 因 `rel.startsWith('..')` 返回 null ⇒ **词法兜底把定位拉回 `t2/code`** ⇒ `latestRunMeta` 经 `metaDir` 沿软链读到归档外的伪留痕（实测：读出 `run-EVIL.json`）⇒ 保护集 = 全集减攻击者自选的 driver ⇒ 伪件放行。**改动前这条通道不存在**（保护集是静态的、与留痕无关），是本 diff 引入「按留痕定 driver」后新增的。它点出的口径矛盾也成立：`isInsideArchiveResolved` 对「归档内软链指向归档外」特意取并集拦下，而 driver 来源却跟着软链走出归档。 | §2.1 |
| AGY-01 | gemini | nit | 接受 | **我的结论错了，实测为证**：文件级软链 `t/plan/x-claude.md -> t/code/x-claude.md` 下，词法定位 `t/plan`、realpath 定位 `t/code`，且两个 `_meta` 是**不同的物理目录**（实测分别读出 `run-A.json` / `run-B.json`）。所以 realpath 优先不是「表达性修正」，而是真的堵掉了「写入穿透到另一阶段、覆写受保护的审核者文件」。gemini 判 nit，但考虑到错误定性**已经写进代码注释与 BACKLOG**，我按实质处理。 | §2.2 |
| GLM-02 | glm | minor | 接受 | 已实核 [cli.ts:846-851](src/trivium/cli.ts#L846-L851)：同状态的正确口径是「出口是**重跑一次该阶段双审**」+「**不要删除或改写这些 run-\*.json**——它们是提交时留痕核对的锚，动了会让 git commit 被拦下」。我的 Hook 文案写的是「请先修复或清理该阶段 `_meta/` 下的运行清单」——正是 cmdGate 被第 2 轮双审纠正**之前**的那个形态，且受话人是 Driver，它对 `_meta/` 的任何写都会被**同一个 Hook** 拦死。两处同状态出口相反，是本仓最忌的「两条规范并行」。 | §2.3 |
| GLM-03 | glm | minor | 接受 | 已实核：`checkArchiveIntegrity`（[hooks.ts:1145](src/trivium/hooks.ts#L1145)）只 import `checkRecordedArtifacts` / `checkRunManifests` / `listRecordedRuns`，**不含** `checkStageArtifacts`；后者只在 [cli.ts:903](src/trivium/cli.ts#L903) 的 `--check-artifacts` 分支被调用。而 [hooks.ts:792](src/trivium/hooks.ts#L792) 自己的注释写着「改由 `archive.checkStageArtifacts` 的跑后核对兜住」——**我那句「没有任何跑后核对能追回来」与同一文件自相矛盾**。准确表述是：跑后核对存在，但不无条件在场（只在 `--check-artifacts` 路径、提交锚不含它、且对 `critics_selected` 之外的角色失明）。分叉方向不变，要修的是理由的准确性——EV-73 未来评估要从准确的存量出发。 | §2.4 |
| CODEX-F01 | codex | （降级） | 接受 | codex 侧输出是合法 JSON 但被双层 ``` 围栏包住，解析降级塌缩成本条。**内含三条，逐条处置**：**CODEX-01**（major，文案）≡ GLM-02，同一处置见 §2.3；它补充的一层我采纳——`readRunMeta` 对「schema 不识」与「文件损坏」同样返回 null，而两者处置相反（前者要重装使 Hook 与留痕版本一致，后者要恢复文件），只写「读不出来」会把排障带偏，且 AGENTS.md 把「装好的 Hook 落后于工作树」列为已知坑。**CODEX-02**（minor）≡ AGY-01，见 §2.2；它比 gemini 多指出一点且我已实测确认——**我那条用例压根没跑到注释声称的机制**（`mirror` 非合法 Stage ⇒ 词法分支不命中），所以「调换顺序仍绿」是巧合不是证据。**CODEX-03**（nit，源头函数仍留默认参数）取其建议①：去掉 `criticRoleSuffixes` 的默认值，三处跨时间调用点显式传 `DEFAULT_DRIVER`——与本步「漏传是编译期错误」的口径一致，留着默认值就是同一个坑的下一张入场券。 | §2.1～§2.5 |

**统计**：接受 5（含 CODEX-F01 内含三条）｜驳回 0 ｜暂缓 0。

---

## 二、修改方案

### 2.1 堵掉 driver 来源的软链逃逸（GLM-01）

`locateArchiveTarget` 的 realpath 分支解析结果**落在归档根之外时，不回落词法定位**：

```
const root = safeRealpath(archiveRoot);
if (root !== null) {
  const resolved = resolveExisting(lexical);
  if (!isInside(root, resolved)) return null;   // 软链逃逸 ⇒ 定位不出，不得按词法拉回来
  return stageSegmentsUnder(root, resolved);
}
return stageSegmentsUnder(archiveRoot, lexical);  // 归档根不可解析时才纯词法兜底
```

返回 null 即走既有的「定位不出 ⇒ 按缺省 Driver 判定」，缺省下 codex/gemini/glm 三家后缀受保护，
伪件仍被拦——**不需要新增拦截分支**，只要不把留痕来源引出归档根。

这条与 `isInsideArchiveResolved` 的并集口径**就此一致**：那边拦「归档内软链指向归档外」的写入，
这边拒绝采信归档外的留痕，同一形态两处不再相反。

**用例**（必须有，且要变异验证）：归档内阶段目录软链指向归档外、归档外预置一份合法 run 留痕
记 `driver: claude`，写 `-glm.md` 必须退 2。去掉 `isInside` 守卫则该用例变绿——这就是它的鉴别力。

### 2.2 更正「行为等价」的定性，并补上真有鉴别力的用例（AGY-01 ≡ CODEX-02）

三处落字都要改，**这是更正而不是补充**：

- [hooks.ts](src/trivium/hooks.ts) `locateArchiveTarget` 的「没有可观测的行为差异……别把它当成修了个洞」整段**删掉重写**：
  如实写明 realpath 优先堵的是「文件级软链让写入穿透到另一阶段、按错阶段的留痕判身份」，
  并给出实测数据（词法 `t/plan` vs realpath `t/code`，两个 `_meta` 是不同物理目录）。
  等价性只在**阶段目录整体是软链**那一格成立，要写清楚限定。
- BACKLOG EV-68 关闭记录里「③CODEX-04 的危害论述经实测不成立……属表达性修正而非缺陷修复」一句
  **改为**：上一轮的判断有误，错因是夹具用了非合法 Stage 名导致实测没跑到机制上；
  第 2 轮由 CODEX-02 ≡ AGY-01 指出并经构造实测更正。
  **把错因一并留下**——这条比结论本身更值得记。
- 用例 `阶段目录是软链…` 的注释里「调换顺序用例全绿」的表述删掉（它是巧合），
  夹具换成阶段名合法的 `t/plan -> t/code`，**另补**一条文件级软链用例：
  `t/plan/x-claude.md -> t/code/x-claude.md`，两阶段 driver 不同，断言按 realpath 侧判。
  变异（改回词法优先）必须让后者变红。

### 2.3 corrupt 文案照 cmdGate 口径重写（GLM-02 ≡ CODEX-01）

出口句改为「**重跑一次该阶段双审**」，并照抄 cmdGate 的警示「不要删除或改写这些 `run-*.json`
——它们是提交时留痕核对的锚」。再按 CODEX-01 补上成因区分：文件损坏 / schema 不识 / 不合契约，
其中 schema 不识的处置是重装使工具与留痕版本一致（AGENTS.md 的已知坑）。

**语义照抄，不另起一套。** 用例断言相应从 `/读不出来/` 改为断言出口句包含「重跑」，
避免下次改文案时又漂回死路。

### 2.4 分叉理由改准（GLM-03）

`resolveRoundDriver` 注释与设计 §8.4 的分叉段，把「没有任何跑后核对能追回来」改为如实表述：
跑后核对存在（`checkStageArtifacts` 的未登记核对），但**不无条件在场**——只在 `gate --check-artifacts`
路径触发、提交锚 `checkArchiveIntegrity` 不含它、且对 `critics_selected` 之外的角色失明。
分叉结论不变（拦截侧判错的当场代价仍不对称），改的是理由。EV-73 条目里的存量描述同步改准。

### 2.5 源头函数去掉默认参数（CODEX-03）

`criticRoleSuffixes(driver: AgentId = DEFAULT_DRIVER)` → 去掉默认值，三处跨时间调用点
（`hasRoleSuffixCrossTime`、`roleSuffixAnywhere`、Bash 文案）显式写 `criticRoleSuffixes(DEFAULT_DRIVER)`，
测试两处同步。与本步「漏传是编译期错误」的口径对齐。

### 2.6 验证

1. `npm run check` 全绿、跳过数不增；
2. §2.1 / §2.2 两条新用例**逐条变异验证**（去掉 `isInside` 守卫 ⇒ 前者红；改回词法优先 ⇒ 后者红）；
3. 重装后在真实 Hook 路径复验两个方向。

---

## 三、关于本轮的两点自评

**第一，我在同一格上连续两轮判断失误。** 第 1 轮我接受 CODEX-04 却断言「危害不成立」；
第 2 轮我拿一个跑不到机制的夹具当实测证据，把错误结论写进了代码注释和 BACKLOG。
两次的共同点是：**我用「变异后用例仍绿」当作等价性的证据，却没有验证那条用例是否真的覆盖了被变异的路径。**
这与本主题里已经犯过两次的「用例没有鉴别力」是同一个根因的不同表现形式。
§2.2 要求把错因写进 BACKLOG，就是为了让这条教训比结论活得久。

**第二，codex 侧的解析降级没有让它的意见贬值。** CODEX-02 是三侧里唯一指出
「夹具没跑到机制」这个**具体错因**的（gemini 指出了结论错、glm 反而认可了错误结论）。
本轮若按 `parse_fallback` 把它当降级侧轻处理，最有价值的一条就漏了。
`parse_fallback` 的正确含义是「该侧不参与阻断判定」，不是「该侧意见可以略读」。

## 四、对三侧盲区的回应

- 三侧均未实跑。GLM-01 的攻击链、AGY-01/CODEX-02 的文件级软链差异，**我都已构造实测**，
  结论见 §2.1 / §2.2，两处都与静态推演一致。
- glm 在焦点三上判「两种解析顺序行为等价的结论成立」，**这一条它判错了**：
  它的理由「词法侧 `_meta` 的 readdir 沿软链落到同一物理目录」只在阶段目录软链时成立，
  文件级软链下两个 `_meta` 是不同目录（实测）。同一个问题上 codex 与 gemini 判对、glm 判错，
  而 glm 另外独立发现了 GLM-01——这正是三侧异构的价值，不必因为它错一条就折价另一条。
