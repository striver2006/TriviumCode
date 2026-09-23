---
schema: trivium.disposition.v1
topic: EV-74-探针喂真实契约文件
stage: code
role: claude
kind: response
run_id: 20260923T004127Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - AGY-01
  - AGY-02
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
---

# EV-74 代码双审第 1 轮 · 逐条裁决

> 主题 EV-74-探针喂真实契约文件 ｜ 阶段 code ｜ 第 1 轮 ｜ run `20260923T004127Z`
> ｜ 被审对象：相对 HEAD 的 11 个文件变更（EV-74 计划 r5 稿获批后的代码实现）
> ｜ codex `request-changes`（阻断 0）、gemini `approve-with-nits`、glm `approve-with-nits`
> ｜ 共 15 条意见（codex 7 + gemini 2 + glm 6）

## 0. 结论

**15 条意见全部接受，无一驳回；其中 1 条（CODEX-06）暂缓，落点是记为残余而非本轮代码修改。**
三侧一致确认核心机制忠实于 r5 计划：`judgeJsonSchema` 七格互斥与求值次序、
`StructuredArmCause` 的成因区分、`resolveAssetRoot`/`resolveReviewSchemaPath` 合并无行为
变化、准入脚本五输入全接、架构契约允许清单、`claudeStructuredArmWarning` 文案互斥，均逐项
核实成立。缺口集中在两类：①验收面比计划声称的窄（§4.2 覆盖入参未接线、§5 用例 5/8 缺
测试落点）；②两处边角正确性问题（准入脚本 fail-fast 被吞、契约文件损坏时归因误导为
「CLI 拒绝」）。本轮已对可在不做 §4.2 实测的前提下修复的问题逐条落地，详见 §2。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | 次要 | 接受 | 核实属实：`execProbe`/`probeArgs` 的覆盖入参机制已建，但结构化臂调用点从未传入 `overrideBudgetUsd`/`overrideTimeoutMs`，§5 用例 8 与变异 11 未落地，`overrideTimeoutMs` 是零调用方的死参数；新增单测的标题名不副实（只测了 `probeArgs` 参数面，没测「调用点真的拨了旋钮」）。 | `execProbe` 上方补状态说明：机制已建、故意未接线，接线时机是 §4.2 实测完成之后；`probeArgs` 单测标题与注释改为如实描述范围（只守隔离性质，不等于用例 8） |
| AGY-01 | gemini | 次要 | 接受 | 与 CODEX-01/GLM-01 独立收敛，证据一致（`execProbe:604-630` 覆盖入参零调用方，`claude-structured-probe.test.ts` 无覆盖入参用例）。 | 同 CODEX-01 落点，不重复登记 |
| GLM-01 | glm | 次要 | 接受 | 与 CODEX-01/AGY-01 独立收敛；额外要求「把偏离显式化」。 | 同 CODEX-01 落点；状态说明与测试注释已显式记录偏离原因（§4.2 实测未做，EV-95 不能假装有结论） |
| CODEX-02 | codex | 次要 | 接受 | 核实属实：计划 §3.4.1 为兜底行与「不可 parse／缺键」两类结论各点了一句 note，实现只把成因经 `structuredArmCause` 送进 doctor 的 warnings 通道，`notes` 里只有取值本身，没有成因文案。 | `probes/claude.ts` 结构化输出块补 `causeNote` 映射，三类文案随 `--json-schema 强制结构化输出=<值>` 一并推入 notes，与 `claudeStructuredArmWarning` 同源但措辞更中性 |
| CODEX-03 | codex | 次要 | 接受 | 核实属实：新 fail-fast 抛在 `caseStdinParity` 内部，被 `main` 的逐用例 `try/catch` 吞成报告行、进程退 0，`--case all` 时其余三个真烧配额的用例照跑，与计划点名的 `assertProbeUsable` 先例（循环之外、顶层退 1）不同族。 | 把契约解析与 fail-fast 提到 `main` 的用例循环之前（`cases.includes('stdin-parity')` 才做），异常直接逃出到顶层 `catch` 退 1；`caseStdinParity` 改为消费已校验好的 `schema` 参数，不再自己 catch |
| GLM-03 | glm | 次要 | 接受 | 与 CODEX-03 独立收敛（fail-fast 语义），并额外指出用法说明缺运行前提（与 AGY-02 同一半）。 | fail-fast 部分同 CODEX-03 落点；用法说明部分同 AGY-02 落点 |
| AGY-02 | gemini | 吹毛求疵 | 接受 | 核实属实：脚本头部「## 用法」注释块未提运行前提（需已安装 dual-critic skill 或设 `TRIVIUM_ASSET_ROOT`），计划 §8 第 18 项承诺的同步项未兑现。 | 在「## 用法」块补一段运行前提说明 |
| CODEX-04 | codex | 次要 | 接受 | 核实属实：探针侧 `catch` 无绑定，把 ENOENT、EACCES、EISDIR、解码失败等一切读失败压成同一句「未找到…安装…」，原始错误丢失；脚本侧同一件事反而保留了证据，两侧口径不一致。 | `probes/claude.ts` 区分 `err.code === 'ENOENT'`（未安装，走指路句）与其它错误（带原始 message 的独立文案），与脚本侧对齐 |
| GLM-04 | glm | 次要 | 接受，且核实为比原描述更严重的真实 bug | 直读 `adapters/claude.ts:453-465` 确认 `stripMetaSchemaRef` 对坏 JSON 不抛、原样返回；探针侧因此会把「契约文件存在但已损坏」当成合法内容送去 CLI，CLI 拒绝后落 `clean-reject`，doctor 报「CLI 拒绝了本仓契约文件」——真因是本地资产损坏，指引却把人送去查 CLI 方言。 | `probes/claude.ts` 在 `readSchemaJson` 成功后立即 `JSON.parse` 前置校验，解析失败与 ENOENT 一样归入 `asset-root-missing`（不送去 CLI），note 文案区分「未安装」与「读取失败或已损坏」；准入脚本同一处加同样的前置校验（与 CODEX-03 的改动合并在同一次 `main()` 前置解析里） |
| CODEX-05 | codex | 吹毛求疵 | 接受 | 核实属实：三个端到端场景里 `read.completed` 恒为 true，把 `probeClaude` 里 `positiveControlOk: read.completed` 换成恒真常量，全套用例仍会绿——判别力缺口，与项目自己「旋钮被守着、拨没拨没人守」的教训同形。 | 假二进制补 `FAKE_CLAUDE_READ_MODE=fail`，新增测试「正对照真的取自读探针的 completed，不是恒真常量」：读探针失败时断言结构化臂落 `null`/`not-completed`，且调用仍真的发生了 |
| CODEX-06 | codex | 吹毛求疵 | 暂缓 | 核实属实：`claudeStructuredArmWarning` 的纯函数单测覆盖到位，但 `runDoctor` 里实际调用它、把结果 push 进 `warnings` 的那两行接线本身没有任何用例——删掉整段接线不会有测试变红。但要在 `runDoctor` 层真正断言，需要先给 `doctor.ts` 的 claude 段一个可注入的 `configuredBin`（`probeClaude(null, …)` 目前硬编码 `null`，与 agy/zcode/codex 三家经 `agentConfigOf(...).bin` 可注入不同）——这是先于 EV-74、与本主题无关的既有架构缺口，本轮不顺带改（避免范围蔓延）。 | 记为残余，登记进结案材料：`doctor.ts` claude 段的 `configuredBin` 硬编码 `null`，若要给 `runDoctor` 层补端到端测试需先补这个注入口，单独立项 |
| CODEX-07 | codex | 吹毛求疵 | 接受 | 核实属实：假二进制对「不带 `--verbose` 的 stream-json 调用」也回通用成功，与真实 CLI 的「当场拒绝」相反；文件头只写了「不断言它们的结论」，没写「这些结论在这个装置里会是错的」。 | 文件头补一节「这个装置不模拟的形态」，点名 `stream_json_requires_verbose` 在这个装置里会与真实 CLI 相反，提醒后来者扩测前先补这条形态 |
| GLM-02 | glm | 次要 | 接受 | 核实属实：`grep -rn` 全 `test/` 目录，没有任何断言涉及 `claude-admission-control.mjs` 的文本本身；脚本不进 `npm test`，"脚本臂被悄悄改回自造 schema" 目前不会被任何测试抓到。 | 新增 `test/contract/claude-admission-schema-source.test.ts`：grep 级契约断言脚本引用 `resolveAssetRoot`/`resolveReviewSchemaPath`/`readSchemaJson`、且不含内联迷你 schema 形状，配防空转腿 |
| GLM-05 | glm | 吹毛求疵 | 接受 | 核实属实：计划 §3.7 字面写死两个早退值（`uninstalled`/`not-attempted`），实现合并成单一 `carried-over`。核对无信息丢失（doctor 对两种早退处理相同，成因区分仍在 notes 两条不同文案里），但属于对计划字面的未声明偏离，理应显式裁决。 | r5 计划正文 §3.7 补一段「实现阶段改注」，记录合并决定与核实结论，回补计划与实现的落差 |
| GLM-06 | glm | 吹毛求疵 | 接受 | 核实属实：`adapters/claude.ts:126-127` 与 `claude-adapter.test.ts:670` 的理由句仍写着「绕过 readSchemaJson 的调用方（探针、准入脚本）」，而 EV-74 落地后两者都已改走 `readSchemaJson`，前提已不成立，断言本体仍对但理由句失实。 | 两处措辞改为「防未来新增调用方绕过 readSchemaJson，不是因为今天真有调用方绕过」 |

## 2. 需要展开的两条

### 2.1 CODEX-01 ≡ AGY-01 ≡ GLM-01：§4.2 覆盖入参为什么不现在就接线

三侧独立发现同一处："按臂覆盖预算/超时" 的机制（`execProbe`/`probeArgs` 的
`overrideBudgetUsd`/`overrideTimeoutMs`）已经建好，但没有任何调用点传入它——不是遗漏，
是计划 §4.2 本身要求「先做两次以上真实契约下的实测、取典型值定出上调目标的具体数」，
这一步需要真的花配额跑 claude CLI，本轮（以及此前的实现轮）都没有做，也不应该在没有
实测的前提下编一个数字接上去（EV-95 纪律）。三侧共同的顾虑是：**这个偏离此前没有被
显式记录**，`overrideTimeoutMs` 看起来像遗漏的死代码，新增单测的标题又暗示"用例 8 已
落地"。本轮把这个状态从隐性变成显性：`execProbe` 上方补了完整的状态说明，`probeArgs`
单测的标题与注释改为准确描述范围。真正的用例 8（伪 bin 录 argv，断言"结构化臂那次
带覆盖值、其余各臂不受影响"）留到 §4.2 实测完成、覆盖值真正接线之后再补，不在本轮
用编造的数据假装补上。

### 2.2 GLM-04：契约文件损坏时的误导性归因，比字面描述更严重

GLM-04 原文focus 在"探针侧的错误处理没有区分未安装和读不到"，但我核实后发现根因更深：
`stripMetaSchemaRef`（`adapters/claude.ts:453-465`）对无法 `JSON.parse` 的输入**原样返回，
不抛错**——这是它一直以来的既有契约（JSDoc 写明"输入不是合法 JSON 时原样返回：那种情形
CLI 会用自己的报错拒掉，本层不替它改写错误形态"）。EV-74 之前，唯一消费方是
`buildClaudeArgs`，坏 JSON 送进 CLI 被拒是唯一合理的处理方式。EV-74 之后，
`readSchemaJson` 被 `probes/claude.ts` 直接用来读**本机文件系统上的真实文件**——
这份文件可能因为磁盘故障、并发写入中途、手误编辑等原因损坏，而损坏本身是
**spawn 前可判的确定性事实**，与"资产根未安装"同一性质，理应同样归入
`asset-root-missing` 分支、走指路句，而不是被当成合法内容送去 CLI、被拒后误报成
"CLI 不接受这份契约"。本轮在探针与准入脚本两处都加了 `JSON.parse` 前置校验，
把这类损坏提前拦截，不送出网络请求。

## 3. 本轮修改清单

1. `src/trivium/probes/claude.ts`：结构化输出块补 `JSON.parse` 前置校验（区分未安装/
   读取失败/损坏，CODEX-04≡GLM-04）；notes 补成因专属文案（CODEX-02）；`execProbe`
   上方补覆盖入参的状态说明（CODEX-01≡AGY-01≡GLM-01）。
2. `scripts/claude-admission-control.mjs`：契约解析与 fail-fast 提到 `main` 的用例循环
   之前，真正在异常时退出而非被逐用例 catch 吞掉（CODEX-03≡GLM-03）；同样补
   `JSON.parse` 前置校验（GLM-04）；「## 用法」补运行前提说明（AGY-02≡GLM-03）。
3. `src/trivium/adapters/claude.ts` + `test/unit/claude-adapter.test.ts`：两处过时理由句
   改准（GLM-06）。
4. `test/unit/claude-events.test.ts`：`probeArgs` 覆盖入参单测标题与注释改为如实描述
   范围（CODEX-01≡AGY-01≡GLM-01）。
5. `test/integration/claude-structured-probe.test.ts`：新增「正对照真的取自读探针的
   completed」测试（CODEX-05）；文件头补「这个装置不模拟的形态」一节（CODEX-07）。
6. `test/contract/claude-admission-schema-source.test.ts`（新文件）：grep 级契约测试，
   守准入脚本的 schema 来源不被悄悄改回自造（GLM-02）。
7. `.reviews/EV-74-探针喂真实契约文件/plan/2026-09-23-EV-74-探针喂真实契约文件-r5-claude.md`：
   §3.7 补实现阶段改注，记录 `StructuredArmCause` 合并决定（GLM-05）。
8. 残余登记（不改代码）：`doctor.ts` claude 段的 `configuredBin` 硬编码 `null`，
   若要给 §5 用例 7 补 `runDoctor` 层端到端测试需先补注入口，单独立项（CODEX-06）。

全部修改后 `tsc --noEmit` 与 `npm test` 均验证通过（1645/1647，0 失败，2 跳过与本次
改动无关）。
