---
schema: trivium.review.v1
topic: M9-Driver旗标全链路与选侧收口
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.16.5
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260918T160720Z
rerun_index: 2
snapshot_hash: sha256:f3a3735c9d0707cf1ca87699f44c6bd7efcf3403b9e86007d93ebcd4756d2eb0
blind: true
started_at: 2026-09-18T16:07:20.864Z
finished_at: 2026-09-18T16:21:48.551Z
duration_s: 868
tool_calls:
  read: 23
  grep: 10
  glob: 0
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 3
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_ee88bb7b-226d-4461-87d4-d8be0a96191d
---

# 计划审查：M9-Driver旗标全链路与选侧收口

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260918T160720Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

三条主要问题全部落在本轮新改形状的区域。§6.7 两遍取值链没有钉死控制流：复算若实现成不动点循环，在「最新一轮只剩 Driver 后缀工件」的归档上存在可构造的 2-循环；即便按两遍有界实现，同形态下终态落在旧轮次、以与事实相反的 missing_disposition 误导排障（GLM-01）。§6.9 换底方向正确且边界不炸——四类损坏形态全部坍缩为「无 schema」、不抛错——但 classifyArtifact 的三值词表是为禁读矩阵的 fail-closed 语义设计的：显式路径分支的 indeterminate 映射未定义，fail-closed 取向会误杀换 Driver 主题的显式原稿，恰是 R-1 自己留的逃生门（GLM-02）。§4.2 约束 2「一律匹配 await <fn>(」与 T-4 扫描集自相矛盾：七个目标里五个是同步调用、两个要扫进函数声明体内，按字面实现 T-4 恒红、被迫临场偏离（GLM-03）。开发者点名的变异第 14 行今天可区分，但靠注释现状的巧合而非规则保证（GLM-04）；另有 T-10 的不可构造臂与「六处」实为七处（GLM-05/06）。

**结论**：`request-changes`

## 审查意见（共 6 条：重要 3 ｜ 次要 2 ｜ 吹毛求疵 1）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6.7（取值链的先后）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：两遍取值链的控制流有三点未钉死。(a)「复算一次」没有排除被实现成「循环到不动点」：在「最新一轮的审查件全部缺席（两侧皆败的降级轮，或审查件被人工删除）、只余 Driver 后缀裁决件」的归档上存在可构造的 2-循环——第 2 轮 driver=gemini（目录里仅有 -r2-revised-gemini.md）、第 1 轮 driver=claude 时，(N=2, run2) 与 (N=1, run1) 互相指向：按缺省推得 N=2 → 从裁决件 front-matter 反查得 run2 → meta.driver=gemini → 复算得 N=1 → 反查得 run1 → meta.driver=claude → 回到 N=2。无上限的实现挂死，而这正是开发者自己点名的「归档被人工改动过」形态。(b) 即便按两遍有界实现，「两次结果不一致就以元数据为准」没有定义终态一致性：第二遍得到的 run1 其 meta.driver=claude ≠ 第一遍的 gemini，终态 (N=1, run1) 是已被超越的旧轮次——checkAdjudication 拿 driver=gemini 对第 1 轮找 -revised-gemini.md，报出与事实相反的 missing_disposition（真正的最新裁决件在 r2 且存在），排障者会被引向「缺裁决件」的错误方向；若改用重读的 claude 则静默去审旧轮。今天的单遍代码在同形态上同样失败，但本节承诺修复闸门区（C4/T-11），两遍法必须定义终止与旧态处置才算交付。(c) 有 --run-id 时「直接读元数据」未写 readRunMeta 返回 null（run.json 缺失、损坏、schema 不识三种形态都返回 null）时 driver 与 rerunIndex 各自回落到什么。

**依据**：src/trivium/gate.ts:725-741（inferLatestRunId：按 rerunIndex 过滤、跳过 role===driver、读 front-matter 取 run_id，裁决件也在其论域内）；src/trivium/gate.ts:196-198（裁决件 front-matter 带 run_id——第二遍能反查正是依赖它）；src/trivium/archive.ts:65-83（resolveRerunIndex 跳过当轮 Driver 的全部产出、含裁决件——降级/被删形态下最新轮被跳过）；src/trivium/cli.ts:731-732、:759-762、:775、:801-805、:866-880（现状调用链与三分支结构）；src/trivium/meta.ts:325-346（readRunMeta 三种返回 null 的形态）。2-循环与旧轮次终态由上述实读代码推演，未实跑。

**建议**：§6.7 钉死三点：①恰好两遍、显式禁止循环（或上限 2、超限显式失败而非继续）；②第二遍后若 runId 仍变，打告警并终止于第二遍结果，不再读新 meta 做第三次复核；③--run-id 且 meta 为 null 时写明回落（driver 取 DEFAULT_DRIVER、rerunIndex 取第一遍推算值）并打一行说明。T-11 之外补一条变异：构造「只剩裁决件的最新轮」夹具，断言两遍法在该形态下终止且不误报缺裁决件。

### GLM-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6.9（CODEX-07 判据换底）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：「复用 classifyArtifact」把一个为禁读矩阵设计的判定整体搬进选原稿语境，但两边的问题不同：禁读问「对 critic 是否必须屏蔽」（三值、fail-closed、判不出就禁），选原稿问「这份文件是不是审查件」（二值）。自动候选分支因既有 role===driver && kind===null 前置过滤，indeterminate 不可达、无恙；显式路径分支没有这层过滤，classifyArtifact 对「role ≠ 当轮 driver 且无可辨识 schema」的原稿/损坏件返回 indeterminate——计划只定义了「指向审查件→硬拒」，没定义 indeterminate 映射到拒还是放。两种取向各有实害：映射为拒（沿用 freeze 的 fail-closed 直觉是最自然的临场选择）则换过 Driver 的主题上 --plan-file 指向旧 Driver 后缀的原稿会被误判「审查件」退 65——这正是 R-1 描述的场景、其自留的显式逃生门；映射为放则 front-matter 被剥掉的审查件可显式入选。T-5a/T-5b 的断言列里没有「显式 + 后缀≠当轮 Driver 的原稿必须放行」这一臂，取向选错测试不红。另：classifyArtifact 是 freeze.ts 的模块私有函数（无 export），「复用」还需先导出，计划未提。

**依据**：src/trivium/freeze.ts:212-248（classifyArtifact：三值返回、无 export、fail-closed 注释「判不出就禁」）；src/trivium/render.ts:394-403（parseFrontMatter 对非 --- 开头、无闭合 ---、YAML 解析失败一律返回 null 且不抛错——开发者点名的缺失/损坏/非 UTF-8/空文件四类边界全部坍缩为「无 schema」，无崩溃风险）；src/trivium/topic.ts:97-107 与 src/trivium/topic-args.ts:555-563（两处自动候选的 role===driver && kind===null 前置过滤，indeterminate 在该分支不可达）；src/trivium/topic.ts:82-88 与 src/trivium/topic-args.ts:534-540（显式分支现状只查存在性）；被审计划 §6.9 规则两条与 T-5a/T-5b 断言列。

**建议**：§6.9 增补一句钉死映射：显式路径只对 schema === 'trivium.review.v1'（即 classifyArtifact === 'peer-review'）硬拒，indeterminate 与 own-or-driver 一律放行，理由写明「R-1 的显式逃生门优先于对可疑文件的防御」；或放弃整体搬 classifyArtifact、直接复用 parseFrontMatter 写二值谓词。无论哪种，给 T-5a/T-5b 补「显式指定旧 Driver 后缀原稿必须放行」一臂；若仍复用则写明需导出。

### GLM-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.2 约束 2 / §4.4 T-4` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：约束 2「锁调用点：一律匹配 await <fn>( 形态，不匹配函数声明」与 T-4 自己的扫描集矛盾。七个目标里约束字面只对两个成立：freeze（review.ts:650 await freeze({）与 locateSubjectReadOnly（topic-args.ts:473 await locateSubjectReadOnly）。其余五个全是同步调用：newRunMeta（review.ts:776 const meta = newRunMeta({）、cli.ts 两处 resolveCriticSelection（:470、:633，均 const critics = resolveCriticSelection(）、topic-args.ts:328 同款、isHeterogeneous（review.ts:1144，嵌在对象字面量里无 await）；writeHandoff 的 options 字面量与 rebuildContext 的 opts 映射更是要扫进函数声明体内——「不匹配函数声明」对这两个目标恰好反着。按字面实现，T-4 对这五个目标连调用点都定位不到、对正确代码恒红；实现者被迫临场偏离，而最省事的偏离（去掉 await 前缀）在 topic-args.ts 里会命中 :520 的 locateSubjectReadOnly 函数声明，正是 §4.1 第 3 条点名要防的假绿形态。「钉死，不留给实现者临场发明」在这条约束上没有兑现。

**依据**：src/trivium/review.ts:650（await freeze）、:776（newRunMeta 无 await）、:1144（isHeterogeneous 无 await）；src/trivium/cli.ts:470、:633（resolveCriticSelection 无 await）；src/trivium/topic-args.ts:328（无 await）、:473（await locateSubjectReadOnly）、:520-532（同名函数声明，即不锁调用点时的误命中目标）；src/trivium/run-protocol.ts:74-118（writeHandoff 函数体内的 options 字面量、rebuildContext 声明）；被审计划 §4.2 约束 2 与 T-4 扫描集。

**建议**：约束 2 改写为「逐目标钉死锚点形态、锚点不得命中声明行」：await 型用 await <fn>(，同步赋值型用 = <fn>(，isHeterogeneous 用「<fn>( 所在实参块内含属性位 overrideReason」，writeHandoff/rebuildContext 直接以函数体内的具名 literal 为锚；或统一为「匹配 <fn>( 后过滤行首为 function/export 的行」。变异表给五个同步目标各留一行确认红。

### GLM-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.2 约束 1 / §10 变异表第 14 行` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：开发者点名的「变异第 14 行能否区分注释里的 driver 与属性位的 driver」——今天能，但靠的是注释现状的两个巧合而非规则本身：review.ts:656-675 的注释全部是 * 前缀续行（规则可剥），且 :670 的 driver 带反引号（`driver` 后跟空格），属性位模式 driver, / driver: / driver } 即使不剥注释也匹配不到它。规则本身有两个盲区：块注释首行带内容（如 /* driver：见上 */，不以 * 开头、无 //，剥不掉——属性位模式会命中其中的 driver:）与不以 * 开头的块注释续行。将来注释换形时约束 1 静默失效、不报错，与「判据看起来对、实际永绿」同族。

**依据**：src/trivium/review.ts:656-675（freeze 实参块内注释逐行实读：全为 * 前缀；:670 为反引号包裹的 `driver`）；test/unit/deny-matrix.test.ts:386-409（既有骨架：matchAll /await freeze\(\{/g、实参块结尾定位、值表达式判据，尚无剥注释逻辑）；被审计划 §4.2 约束 1、§10 变异表末行。

**建议**：约束 1 升级为「先剥 /* … */ 整块与 // 行尾，再做属性位匹配」；或至少加一条防御判据「属性位所在行不得以 * 或 /* 开头」，让盲区形态直接红而不是绿。

### GLM-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.4 T-10` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：T-10 要求覆盖「非缺省已启用」与「非缺省未启用」两种取值，但注册表里 driverEnabled: true 只有 claude 一家（即缺省本尊），其余三家都是 false（注释 // M10 启用）。「非缺省已启用」今天不可构造：§6.1 的 resolveDriver 复用 agentById 读真实注册表、无注入口，预检侧同样没有。该臂要么写不出来、要么实现者临场造夹具绕注册表——又是一条留给临场发明的口子。

**依据**：src/trivium/agents/registry.ts:153（claude driverEnabled: true）、:204、:218、:232（其余三家 false，注释 M10 启用）；src/trivium/preflight.ts:604-640（预检 checks 结构，无注册表注入面）；被审计划 §6.1、§6.4、T-10。

**建议**：二选一写进计划：给 resolveDriver 开与 resolveCriticSelection 的 descriptors 同构注入口（critics.ts:23-41 已有先例与成文理由），T-10 两臂均用注入表构造；或把「非缺省已启用」臂标注 M10 才可达、本步 skip 并写明原因（与 EV-52 的 skip 口径同款）。

### GLM-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6.7 / §6.9` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：两处计数/行号失实：§6.7「覆盖六处」实为七处（checkAdjudication 两处 + checkStageArtifacts 一处 + inferLatestRunId 三处 + resolveRerunIndex 一处 = 7），「六处」若被当 checklist 用会少数一格；§6.9 引「freeze.ts:200-215」的 classifyArtifact 实际定义在 :212-248（200-215 只盖到文档块前半）。

**依据**：src/trivium/freeze.ts:212（classifyArtifact 定义起始）；被审计划 §6.7 覆盖清单（2+1+3+1=7）与 §6.9 引用行号；src/trivium/cli.ts:731、:759、:762、:775、:801、:866、:876（七个调用点逐一核对）。

**建议**：改为「七处」并修正引用行号。

## 认为正确的部分

- §3.4 新增核实成立：checkAdjudication 按 input.driver ?? DEFAULT 定位裁决件（gate.ts:151-153），cli.ts:801/:876 两处调用不传、cmdGate 无旗标可传，非缺省 Driver 下必 missing_disposition——把闸门区收进本步是对的，EV-58 收窄到「两次推断都落空」一格的分工也清晰。
- §3.1 的代价更正属实：review.ts:1065-1069 抬升时同步改写 meta.rerun_index、最终落盘与文件名一致，漏传 driver 的真实代价（骨架短暂失真 + 一次抬升告警 + 触发条件收窄）与代码相符。
- §6.9 换底的三条依据逐一实读成立：roleIsAllowedForWriter 即 writer==='driver' ? role===driver（naming.ts:158-164）；登记清单无产出方信息；裁决件与原稿不经编排器登记（freeze.ts 文档块同口径）。
- 开发者焦点一的边界问题可给肯定答案：classifyArtifact 对 front-matter 缺失/损坏/非 UTF-8/空文件都不抛错——parseFrontMatter 对三种损坏形态一律 null（render.ts:394-403），fs.readFile utf8 对非法字节做替换不抛——全部坍缩为「无 schema」走 role===driver 回落。换底不会引入崩溃型未知问题，真正的口子在 GLM-02 的 indeterminate 映射。
- §3.2/§6.2 EV-53 论证属实：critics.ts:57-73 的 legalList 减 Driver，topic-args.ts:448-459 的 CRITICS.includes 与 :455 的 CRITICS.join 都不减，两套论域实读确认；selectableCritics 源头合一而非抄两遍 filter 是正确做法。
- §6.4 预检提示必须 ok:true 的论证属实：preflight.ts:604-640 的 every 短路与 find(!c.ok) 定 exitCode 结构实读确认，T-10 的「不短路」断言点对了位置。
- §6.6 接线清单与理由改准均实读核实：:466 回落分支（review.ts:466 opts.critics ?? resolveCriticSelection(cfg) 不传 driver）确在；Handoff.options 结构（run-protocol.ts:74-88，critics/sessionId/allowSingle 必填同列）与 driver 改必填的 §4.3 一致；driverEnabled 的唯一来源在注册表。
- §3.3 属实：resolveDriver 全仓零命中；DRIVER_AGENT_IDS（registry.ts:338）除定义外零消费；USAGE 论域用 ALL_AGENT_IDS 而非 DRIVER_AGENT_IDS 的判断正确（后者今天只含 claude，写进帮助文本会与实际接受集不符）。
- STATIC_FLAGS 加 'driver'（topic-args.ts:31-35）与 scope==='all' 拒绝（:318-326 与 --critics/--only 拒绝理由逐字同构）核对无误；R-8 对 T-1/T-2/T-11 必须桩注入并断言指纹的配额口径正确。
- EV-53/EV-54 的 BACKLOG 出处核实（:150「触发条件：M9 第 5 步 --driver 全链路落地时」、:151「触发条件：M9 第 5/6 步」）；EV-61 的帮助文本失实确认（cli.ts:204 写死 --model-gemini/--model-glm 两家）。

## 未覆盖范围（本侧盲区）

- 162/162 等价性实测未复跑（属 r1 codex 侧的枚举结论，本轮按报告采信，未逐份读 84 份 run.json 与 162 条登记）。
- GLM-01 的 2-循环与旧轮次终态全部来自源码静态推演，未实跑流水线或变异验证复核。
- test/integration/gate-loop.test.ts 与 topic-resolve.test.ts 的既有用例体、adapters/stub.ts、skills/ 侧资产（SKILL.md、hooks.json）未读，T-11/T-5b 的落位主张取自计划文本。
- report.ts / naming.ts / hooks.ts 的 driver 消费面（R-3 具名的范围外三处）本轮未复审。
- gate.ts 裁决表逐条核对段（:260 之后）与 loadRoundReviews 内部逻辑未逐行读。
- doc/02_design 设计文档、PRD、M9 步骤表原文本轮未重读，J4/J8 判据按计划引述采信。
- 另一侧审查员的任何产出按禁读约束未读、未引用。

## 实际查阅的项目文件

- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r2-claude.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-glm.md`
- `src/trivium/freeze.ts`
- `src/trivium/topic.ts`
- `src/trivium/gate.ts`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/review.ts`
- `src/trivium/meta.ts`
- `src/trivium/render.ts`
- `src/trivium/critics.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/preflight.ts`
- `src/trivium/naming.ts`
- `src/trivium/agents/registry.ts`
- `test/unit/deny-matrix.test.ts`
- `test/unit/topic.test.ts`
- `doc/08_project/BACKLOG.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":23,"grep":10,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
