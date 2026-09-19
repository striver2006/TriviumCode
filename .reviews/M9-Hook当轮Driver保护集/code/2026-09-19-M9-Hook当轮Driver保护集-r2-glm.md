---
schema: trivium.review.v1
topic: M9-Hook当轮Driver保护集
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.5
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260919T085742Z
rerun_index: 2
snapshot_hash: sha256:65ad39c237a326ff84448824dfeeffc5f76664bdc3c9c65036a9fbd870f59c41
blind: true
started_at: 2026-09-19T08:57:42.868Z
finished_at: 2026-09-19T09:09:46.465Z
duration_s: 723
tool_calls:
  read: 12
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 9
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_6df89bb3-81fe-4685-8e37-ef55fbf2d17e
---

# 代码审查：M9-Hook当轮Driver保护集

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260919T085742Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

三焦点逐一实核：①「较新留痕读不出即判红」不会误拦正常流程——latestRunMeta 只扫 run-*.json（review-*.json/changes-*.diff 不进论域）、留痕经 writeAtomic 落盘（tmp 名不匹配扫描正则、rename 无撕裂读）、v1 有迁移路径，新增拦截面仅真损坏（有意 fail-closed）；但硬失败文案给的出口（修复/清理 _meta）对受话人是死路、与 cmdGate 同状态的出口（重跑）相反（GLM-02）。②与 gate 分叉的方向成立（拦截型判错代价不对称），但「Hook 没有任何跑后兜底」与设计 §8.4 自己两段前的 checkStageArtifacts 跑后核对表述相抵，准确弱点是流程依赖＋角色盲区（GLM-03）。③两种解析顺序行为等价的结论独立核过成立，但「表达性修正而非缺陷修复」的定性掩盖了两支共用的真缺口：realpath 解出归档根之外后回落词法定位，使当轮 Driver 的判定来源可被阶段目录软链引到归档外的伪留痕、攻击者自选 Driver 让伪审查件绕过保护（GLM-01，major）。上一轮 4 条意见的修复全部落地且形态正确。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:397-424（locateArchiveTarget / stageSegmentsUnder 的词法兜底）与 src/trivium/hooks.ts:341-362（resolveRoundDriver）` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：当轮 Driver 的判定来源可被软链重定向到归档之外，攻击者可自选 Driver 使伪造的审核者后缀文件绕过保护。链条每一环都逐行核过：⑴在归档外预置一份合法 trivium.run.v2 留痕（如 doc/evil/_meta/run-*.json，driver 任选）——Write 放行：looksLikeRoleArtifact 只认 -<role>.md 收尾、isOrchestratorOwned（hooks.ts:441-446）只查归档根内路径；⑵Bash `mkdir .reviews/t2 && ln -s <abs>/doc/evil .reviews/t2/code`——ln/mkdir 在 WRITE_LIKE 内但 bashTargetsProtected 全不命中：无后缀字面、.reviews/t2/code 不含 _meta/task.json/state.json/.trivium 字面，阶段目录本身不在 isOrchestratorOwnedPath 独占集（hooks.ts:702-716 只认 _meta 组件与 task.json），无写锁时放行；⑶Write .reviews/t2/code/2026-…-x-glm.md——短路两项命中（词法在归档内），locateArchiveTarget 的 realpath 分支解到 doc/evil/… 相对归档根为 ../.. → null，词法兜底给出 (t2, code)，resolveRoundDriver 经 metaDir 沿软链读到攻击者留痕、unreadable 为空 → 保护集＝全集减攻击者声明的 driver → 伪件放行。改动前该写入被静态保护集无条件拒绝，此通道是本 diff 引入「按留痕定 driver」后新增的。跑后核对也接不住：checkStageArtifacts 的未登记核对只在 gate --check-artifacts 触发（cli.ts:874-903），且 archive.ts:393 对 `!critics.includes(role)` 直接 continue——攻击者留痕的 critics_selected 不含伪件角色时该项跳过；提交锚 checkArchiveIntegrity（hooks.ts:1143-1237）不含该核对、git 锚对新增未跟踪文件失明、新主题无 task.json 登记与 state.json 闸门记录，伪档案可干净提交。isInsideArchiveResolved 对「归档内软链指向归档外」特意取词法∪realpath 并集拦下（hooks.ts:193-225），而 driver 来源却跟着软链走出归档——同一形态两处口径相反。

**依据**：src/trivium/hooks.ts:397-424（realpath 分支持 root= safeRealpath(archiveRoot)，stageSegmentsUnder 对 rel.startsWith('..') 返回 null 后无条件回落 stageSegmentsUnder(archiveRoot, lexical)）；hooks.ts:341-362（resolveRoundDriver 只消费 latestRunMeta 结果，不校验 metaDir 落点）；src/trivium/meta.ts:396-419（latestRunMeta 对 metaDir 直接 readdir，沿软链、不校验在归档内）；hooks.ts:702-716 与 :690（isOrchestratorOwnedPath / MENTIONS_OWNED 均不含阶段目录本身）；hooks.ts:628-643（WRITE_LIKE 含 ln/mkdir/rm）；hooks.ts:441-446（isOrchestratorOwned 对归档外路径恒 false）；src/trivium/archive.ts:42-43（metaDir 纯 path.join）、:390-400（未登记核对按 critics 过滤）；src/trivium/cli.ts:874-903（recorded 只接进 --check-artifacts 分支）；hooks.ts:1143-1237（checkArchiveIntegrity 无 checkStageArtifacts）。攻击链为静态推演，每一环均读到对应实现，未实跑构造（只读审查）。

**建议**：realpath 分支的解析结果落在归档根之外时不要回落词法定位——那正是 isInsideArchiveResolved 按并集拦的「归档内软链指向归档外」形态，可并入「定位不出」按缺省 Driver 判定（缺省下四家后缀三家受保护，伪件仍被拦）；或在 resolveRoundDriver 侧校验 realpath(metaDir) 仍在归档根内、否则按 corrupt 处理。修时顺带核对焦点三的注释表述：两种顺序等价的结论本身成立（词法 readdir 沿软链与 realpath 同目录、invalid 阶段名只有 realpath 支能给答案，均静态核实），但「表达性修正而非缺陷修复」一句建议补上「词法兜底不得把留痕来源引出归档根」的边界，免得后人把本条的收口当成可选优化回退掉。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:536-544（corrupt 分支 deny 文案末句）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：留痕损坏硬失败的出口指引是死路：文案让受话人「修复或清理该阶段 _meta/ 下的运行清单」，但受话人是 Driver，它对 _meta/ 下文件的任何写/删都会被同一 Hook 拒绝（Write/Edit 走 isOrchestratorOwned，Bash 走 MENTIONS_OWNED 命中 _meta）；且对已提交的 run-*.json，「清理」正撞提交锚（immutableChangeReason 判其不可变、checkRunManifests 报 manifest_missing）。cmdGate 对同一状态（全损）的出口经过第 2 轮代码双审专门纠正为「重跑该阶段双审」并明示「不要删除或改写这些 run-*.json」（cli.ts:825-852，理由就是『出口必须是走得通的那条』）；重跑也正是 Hook 侧的可行恢复路径——prepareRun 落一份更新的可读骨架后 latestRunMeta 即取它。新文案重蹈了 cmdGate 被纠正前的形态，两处同状态出口相反。

**依据**：src/trivium/hooks.ts:536-544（'请先修复或清理该阶段 _meta/ 下的运行清单'）；src/trivium/cli.ts:823-852（同状态硬失败文案：出口是重跑、明示不要删改 run-*.json、--run-id 在该格无用）；hooks.ts:573-580（isOrchestratorOwned 对 _meta 拒绝）与 :690（MENTIONS_OWNED 含 _meta）；hooks.ts:469-486（immutableChangeReason 对 _meta 内 run-*.json 判不可变）；hooks.ts:1199-1226（checkRunManifests 报 manifest_missing/不可读）。

**建议**：把 Hook 侧 corrupt 文案的出口句改为与 cmdGate 同款：指明「重跑一次该阶段双审即可恢复（新运行留痕最新且可读）」，并照抄「不要删除或改写 run-*.json（提交锚会拦）」的警示；不要让文案指向受话人无权执行的操作。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:328-335（resolveRoundDriver「与 cmdGate 有意分叉」注释）与 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md §8.4 新增分叉段` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：分叉理由「Hook 是拦截型、判错当场生效且没有任何跑后核对能追回来」与设计 §8.4 自己两段之前的表述相抵：§8.4 明写目录级搬运通道「由 archive.checkStageArtifacts 的『审核者工件须在 run.json.artifacts[] 登记内』跑后核对兜住——顺带补上了此前对新增未跟踪文件完全失明的缺口」，这正是 Hook 错误放行方向（伪审核者工件）的跑后核对，实核存在且已接线。它真正的弱点是另外三点：只在 gate --check-artifacts 路径触发（提交锚 checkArchiveIntegrity 不含它）、依赖流程继续走、且伪件角色不在 critics_selected 内时被跳过（archive.ts:393）。把这写成「没有任何跑后核对」，EV-73 未来的评估（自述要『连同提交锚的兜底强度一起判』）会从一个不准的存量清单出发。分叉本身（拦截型对 corrupt 判红）方向我认可，要修的是理由的准确性。

**依据**：src/trivium/hooks.ts:328-335（注释原文「没有任何跑后核对能追回来」）；changes-20260919T085742Z.diff 设计文档 hunk §8.4（同句分叉理由 + 两段之前「由 archive.checkStageArtifacts …跑后核对兜住」）；src/trivium/archive.ts:375-400（未登记核对实现，393 行按 critics 过滤）；src/trivium/cli.ts:874-903（recorded 仅接进 --check-artifacts 分支）；src/trivium/hooks.ts:1143-1237（checkArchiveIntegrity 只含 git 锚 + checkRunManifests + checkRecordedArtifacts，无 checkStageArtifacts）。

**建议**：改写注释与 §8.4 分叉段的理由：不写「没有任何跑后核对」，如实写「跑后核对存在（checkStageArtifacts 的未登记核对）但只在 gate --check-artifacts 路径在场、提交锚不含它、且对 critics_selected 之外的角色失明——兜底不是无条件在场，拦截侧判错的当场代价仍不对称，故判红」。EV-73 评估时以修正后的存量为准。

## 认为正确的部分

- 上一轮 4 条意见的修复全部落地且形态正确：unreadable 非空即 corrupt（含取到可读 meta 的中间格）；「不触发解析」用例按给出的构造重写（损坏留痕 + 归档内非角色工件 notes.txt），鉴别力成立；§16.1 M10 行补齐 EV-55/71/72 并注明「完整前置清单以 BACKLOG 为准」；集成用例补了对计划措辞的偏离声明且如实写明只解了 CODEX-03 的一半。
- 焦点一结论：新判据不误拦正常流程。meta.ts:405-409 只按 /^run-(.+)\.json$/ 取文件（review-*.json、changes-*.diff、brief 不进论域）；writeMeta 走 writeAtomic（archive.ts:260，tmp 名为 <target>.tmp-<pid>-<ts> 不匹配扫描正则，rename 无撕裂读）；v1 留痕经 migrateRunMetaV1 可读（meta.ts:438-440），不会把历史留痕误判为损坏。
- 焦点三前半结论：两种解析顺序行为等价的判断成立。词法侧 _meta 的 readdir 本身沿软链落到 realpath 同一物理目录（有效阶段名两支同源）；无效阶段名（mirror）只有 realpath 支能给答案，两序殊途同归——静态逐一情形核过，与变异验证记录一致。
- 「较新留痕损坏」用例目标取 -response-codex.md、全损用例取 -claude.md，两处后缀选择都有鉴别力（退回上一轮实现会放行、按缺省判实现会放行），注释把这一族坑写透；「归档外软链指向归档内」用例取 -claude.md 同理咬得住词法-only 退化。
- hasProtectedRoleSuffix 必填无默认值、跨时间面另立 hasRoleSuffixCrossTime/roleSuffixAnywhere 且口径一字未改（既有断言原样守住）、isForgedRoleFile 保留完整语义判据而内层只问后缀避免第三次 realpath——拆分与短路的结构都对。
- state.ts GateEntry.driver 注释把「缺失=无从得知」与「Hook 侧按缺省判定是可用性取舍」两层语义分开，避免了同文件两句方向相反的表述；设计 §8.4 四种结局、闸门项不作来源、--agent 不作第二判据源的裁定都写进了唯一实现依据。
- driver 权威来源弃闸门项改 run.json.driver 的论证链维持成立（state.ts:62-81 注释与 cli.ts:793-855 的取法同源一致）。

## 未覆盖范围（本侧盲区）

- 只读审查：未运行 npm run check / build / 变异验证，diff 记录的 1471/1469/2 与变异结论未独立复跑；GLM-01 的攻击链是静态推演（每一环都读到对应实现），未构造软链夹具实跑复现。
- test/unit/hooks.test.ts 与 test/integration/gate-loop.test.ts 的新用例是经 changes-20260919T085742Z.diff 的完整 hunk 审读的，未再直接打开测试源文件逐行核对上下文。
- README.md、doc/README.md 等导航文档与 skills/ 资产（hooks.json、init.ts writeWrapper）本轮未重读——diff 未触及，沿上一轮实读结论；版本偏斜场景（未来 run.v3 留痕被旧 hook bundle 读成 unreadable 触发硬失败）只作登记性提示，未深究。
- EV-73 的 gate 侧收紧评估、EV-55 跨时间面重构、EV-71 会话载体决策均不在本轮范围，仅核实其登记与触发时点写得如实。

## 实际查阅的项目文件

- `.reviews/M9-Hook当轮Driver保护集/code/_meta/changes-20260919T085742Z.diff`
- `.reviews/M9-Hook当轮Driver保护集/code/2026-09-19-M9-Hook当轮Driver保护集-glm.md`
- `.reviews/M9-Hook当轮Driver保护集/code/2026-09-19-M9-Hook当轮Driver保护集-response-claude.md`
- `src/trivium/hooks.ts`
- `src/trivium/meta.ts`
- `src/trivium/state.ts`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/types.ts`
- `src/trivium/naming.ts`
- `src/trivium/util/fsx.ts`
- `CLAUDE.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":12,"grep":7,"glob":0,"run_command":0,"project_reads":9}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
