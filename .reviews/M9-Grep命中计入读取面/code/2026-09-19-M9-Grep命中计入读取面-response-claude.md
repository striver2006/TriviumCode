---
schema: trivium.disposition.v1
topic: M9-Grep命中计入读取面
stage: code
role: claude
kind: response
run_id: 20260919T150901Z
addresses:
  - 2026-09-19-M9-Grep命中计入读取面-codex.md
  - 2026-09-19-M9-Grep命中计入读取面-gemini.md
  - 2026-09-19-M9-Grep命中计入读取面-glm.md
---

# 代码审应答：M9-Grep命中计入读取面

## 0. 应答总览

codex `request-changes`（4 条：重要 3 ｜ 次要 1）、gemini `approve-with-nits`（1 条）、glm `request-changes`（2 条：重要 1 ｜ 次要 1）。
共 7 条：**接受 7 ｜ 驳回 0 ｜ 暂缓 0**。

三个焦点三侧一致：分档在解析器与判定面一致、`listed` 没有漏进判定的路；措施 a 的接线功能上成立（codex 用产物实测命中对端件 → `peerArtifactRead: true`）；T7 集合断言与两次变异记录与代码事实相符。
挑出的是三处「线接了、锁没上」与一处事实错误：

1. **措施 a 并入搜索命中没有任何用例咬住**（CODEX-03 ≡ AGY-01 ≡ GLM-01，三侧独立）：删掉那条并集全仓照绿。这是安全判定面上的 fail-open 面。
2. **归一化不对称**（CODEX-02 ≡ GLM-02）：consulted 这轮加了 realpath 别名，措施 a 的 `checkPeerLeak` 仍只按字面根归一；`init.cwd` 是物理路径，符号链接根下新通道整族假阴性——正是 CODEX-07 修掉的那族问题在另一条通道上的残留。
3. **codex 侧「命令输出不进轨迹」是错的**（CODEX-01）：`codex-trace.ts:91` 把 `aggregated_output` 收进 `commands[].output`，`codex.ts:621` 原样落 trace.json。正确标签是「**未采集**」，不是「无此事实」；设计 §10.1 据此写的「检测不到」也要改成「未解析」。
4. 实现与已批准计划有三处形状偏离未回补（CODEX-04）。

## 1. 逐条应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 已实核 `codex-trace.ts:91`（`output: String(item['aggregated_output'] ?? '')`）与 `codex.ts:621`（`commands: trace.commands` 落 trace.json）：命令 stdout 逐字在轨迹里。codex 记 `null` 的真实理由是**适配器未解析命令输出**（解析任意 shell 输出另是一档代价，属 EV-19 族），不是「该族无此事实」——按三态纪律这两者必须是不同观测。agy / zcode 的「无工具输出」我此前已核（`AgyToolCall` 只有 parameters / error；zcode 轨迹只有 input），那两家的标签不变 | `codex.ts:224` 注释改为「未采集：输出在 trace.json 的 `commands[].output`，未做命中解析」；设计 §10.1 新规则段与 BACKLOG EV-76 / EV-16 注记把「codex 的命令输出不进轨迹 / 检测不到」改为「未解析」，并明写「本条不对称的一侧实为未采集」；EV-78 落点栏补一句「codex 侧命令输出的命中解析若要做，另立条目」 |
| CODEX-02 | codex | major | 接受 | 已实核 `checkPeerLeak`（`base.ts:1010-1042`）两边都只 `normalizeAbs(x, projectRoot)`——只抹 `/private`，无 realpath；`projectRoots` 在 guard.ts 里只喂了 consulted。`parseGrepResults` 以 `init.cwd`（物理路径）为基准绝对化，符号链接根下 deny 条目是逻辑形态、命中是物理形态，恒不命中。注释写着「两边经同一份归一化」，实现没做到 | `judgeSide` 里把喂给措施 a 的路径集经 `toProjectRelative(p, projectRoots)` 生成项目相对别名并与原路径**一并**送入 `checkPeerLeak`（相对形态由它按字面根解析成逻辑形态；原路径保留是为了运行根等项目外 deny 条目仍能命中）；`read_paths` 与 `search_hit_paths` 同样处理，不只改新通道。补用例 T13：`projectRoots = [LINK, REAL]`、命中在 REAL 形态、deny 条目在 LINK 形态 → `peerArtifactRead === true` |
| GLM-02 | glm | minor | 接受 | 与 CODEX-02 独立收敛到同一不对称，且点明方向是安全要害（漏报该作废的侧） | 同 CODEX-02；注释改准 |
| CODEX-03 | codex | major | 接受 | 属实：grep-hits.test.ts 的 REQ `deny_paths: []`，guard-capability 的禁读用例只喂 `read_paths` / `command_texts`，stub 注入族不覆盖 `search_hit_paths`。删掉 guard.ts 的并集全仓照绿——新规则是 fail-open 面 | T12：REQ 带非空 `deny_paths`（一条对端审查件 + 一条 `.trivium/state.json`），`search_hit_paths` 分别命中两者，断言前者 `peerArtifactRead === true`、在 `peerHits` 里、`typedHits` 类别 `peer-artifact`；后者只进 `notedPaths`、不作废；`search_hit_paths: null` 时恢复 false。一条用例锁「接线」与「10.1.1 分档不误伤」 |
| AGY-01 | gemini | minor | 接受 | 与 CODEX-03 同一缺口，建议形态一致（T12 含 `typedHits` 分类断言与置空反例） | 同 CODEX-03 |
| GLM-01 | glm | major | 接受 | 同一缺口；多要一条「命中己方材料不作废」的反例——`own-run-material` 那档的路径要经 `classifyDenyPath` 按运行根与 critic 判，用例里用 `.trivium/state.json`（`orchestrator-state`）已能证「命中但不作废」这条分支；己方运行材料那格需要构造运行根路径，本批一并补进 T12（第三条路径） | 同 CODEX-03；T12 增第三条：运行根下己方材料 → 不作废、不进 notedPaths 之外的任何作废集 |
| CODEX-04 | codex | minor | 接受 | 三处偏离属实：①trace.json 落的是嵌套 `grep: {hits, listed, resultLines}`，计划 §2.4 写的是三格扁平键——嵌套是为了与 `denySettings` 同形，设计 §3.7 已按嵌套写，**以实现为准**；②`buildClaudeResult` 用可选 `opts.fallbackRoot` 而非计划 §2.6 的 `cwd` 入参——基准在 `parseGrepResults` 内择 `init.cwd ?? fallbackRoot`，可选是为了不动 14 处直调；③变异只做了两次——第一次（正则永不匹配）同时覆盖 T1 / T7 / T10，第二次覆盖 T11，计划 §2.7 的四条各一次已被两次合并覆盖，但没写明映射 | 本件记录偏离与理由（计划已冻结不回改）；用例文件头把「两次变异 ↔ 计划四条」的映射写明 |

**统计**：接受 7 ｜ 驳回 0 ｜ 暂缓 0。

## 2. 双方共同指出的问题

- **新规则无守卫**（CODEX-03 / AGY-01 / GLM-01）：T12 正反例 + 己方材料反例。
- **两条判定线的根口径不同步**（CODEX-02 / GLM-02）：措施 a 也吃 `projectRoots` 别名，T13 锁符号链接根。

## 3. 不予采纳的意见及其依据

无。

## 4. 本轮未覆盖

- 三侧均未实跑全量与变异（codex 单跑了 grep-hits 9/9）；本批补 T12 / T13 后再跑全量。
- `ClaudeTrace.toolResults` 保留全部成功结果文本的内存占用未量化（codex 盲区），本批不动，登记为观察。
- codex 侧命令输出的命中解析（解析任意 shell 输出）不在本批，随 CODEX-01 的措辞改准一并登记。
