---
schema: trivium.review.v1
topic: M10-任意Driver
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.155.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260922T032428Z
rerun_index: 6
snapshot_hash: sha256:d9c78ebb78e8e855489c3ad450641e962cdb312d5a23babc20cb6fe06f529a62
blind: true
started_at: 2026-09-22T03:24:29.664Z
finished_at: 2026-09-22T03:40:41.272Z
duration_s: 972
tool_calls:
  run_command: 34
  project_reads: 26
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 4
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0c724-c1a5-72c2-ad66-0fa19a7d39d3
---

# 计划审查：M10-任意Driver

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260922T032428Z` ｜ 第 6 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

拆分边界总体成立（M10b r1 稿实存且覆盖移交项，锚②减法归因经核实正确，_meta 排除集我用独立 grep 复核未发现第三项）。但有一处阻断级：§3.1.1 登记原稿的取值形态与本仓 artifacts[] 的路径解析约定冲突——按字面 push 绝对路径会逐字复现该节自己用来否决 request.subject_path 的「missing ⇒ 提交锚永久拦」故障，而成本判据说「多 push 一条即可」。另有四处实质问题：§2.3 分支 3 在零留痕窗口可反复翻转 Write 侧保护集（自声明边界分析只覆盖了单次声明）；failed/voided 轮次的原稿登记一格未判（drift 作废是该仓高频事件，登记仍绑死原稿且 §3.3 无用例）；§3.2.2「三处出口」漏掉同类的 gate.ts 运行时报错（它今天就教学一条必被 Bash 守卫拒的 git restore）；§7.1 计数论域自称 code 双审却含 plan 轮、第 5 步与前置小主题的 plan 轮未入账、台账起点与已耗 5 轮的取数来源没写死。

**结论**：`request-changes`

## 审查意见（共 8 条：阻断 1 ｜ 重要 4 ｜ 次要 3）

### CODEX-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§3.1.1（含 §9 A2、R-j）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：「--start 时把原稿的 path + sha256 登记进 artifacts[]」「取值改用 input.subjectPath（fs.exists 已验的真绝对路径）」「成本极小……多 push 一条即可」——与本仓 artifacts[].path 的解析约定冲突：核对侧把登记路径一律 join 到归档根下。把绝对路径原样 push 进去，解析结果是归档根下一个不存在的子路径 ⇒ checkRecordedArtifacts 判 missing ⇒ 自该 plan/bug 轮起，整个仓库每一次 git commit 都被拦且常规手段无法恢复。这与 §3.1.1 硬约束 2 否决 request.subject_path 所用的理由是**同一个故障**，只是换了取值来源就看不见；且与 R-j 自己写的「path = 该轮被审原稿的**归档相对路径**」跨节自相矛盾——两套规范并存正是本稿在 3.1.2 删第 1 条判据时援引的理由。

**依据**：实读 src/trivium/archive.ts：checkRecordedArtifacts 对每条登记做 path.join(layout.archiveRoot, a.path)（:449 附近），TamperedArtifact.relPath 注释明写「相对归档根的路径」；src/trivium/review.ts 现存全部登记项都是归档相对形态——writeMeta 返回 relPath=topic/stage/_meta/fileName（archive.ts:263），收尾追加时显式 path.relative(ctx.archiveRoot, p) 归一（review.ts:1485-1494）；prepareRun 的 meta.artifacts 在骨架期即被提交锚核对（checkArchiveIntegrity 只按 artifacts.length>0 过滤，hooks.ts:1264-1281）。§3.1.1 全文没有任何一处提到要做这个相对化转换。

**建议**：§3.1.1 把登记形态写死为 path.relative(archiveRoot, input.subjectPath)（结果形如 ../../doc/…），并把它升格为第三条硬约束；§3.3 加一条用例锁「登记路径以 .. 越出归档根 ⇒ 解析回项目内真路径、被改仍判 modified」；顺带核报错文案里 ../../ 形态的可读性。A2 的回退路径描述同步改（「撤则锚②对原稿恒不命中」成立的前提是登记项本身可撤）。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§2.3 分支 3 / §2.4「自声明边界」` |
| 类别 | security ｜ 层次 plan |
| 置信度 | medium |

**问题**：分支 3 使零留痕窗口内声明可**反复**改写，而声明经 §2.4 第 2 级直接决定 Write/Edit 侧保护集（全集减当轮 Driver）。组合序列：claim X ⇒ 以「X 是当轮 Driver」身份对归档写 X 后缀的原稿形态文件 ⇒ 分支 3 撤回改 claim Y ⇒ 再写 Y 后缀文件——同一个真实会话在首份留痕诞生前可以依次拿到**每一个** Agent 的后缀豁免。M10a 名义 Driver 语义（真载体在 M10b，实际执笔者永远是本会话）使「声明身份」与「执笔主体」之间没有任何机械绑定。§2.4 的自声明边界分析按「一次认领」写的，先例 ApprovalRecord.session_id 不成立：那个自声明只影响对账，不改变保护集。

**依据**：实读 src/trivium/hooks.ts：hook-pre-write 规则 1 的保护集 = criticRoleSuffixes(当轮 Driver)（:527-531 注释），当轮 Driver 解析自 resolveRoundDriver（:354-375，零留痕回落 DEFAULT——本稿第 2 级就是插在这里的声明值）；归档内 Driver 后缀的原稿文件确属可写形态（本主题 r6 原稿就落在 .reviews/M10-任意Driver/plan/ 下）。被审文档 §2.4 仅要求 claimed_by 可见 + 留日志。

**建议**：二选一并写明：(a) hook-pre-write 判定走第 2 级（取自声明）时，比对 input.session_id 与 claimed_by，不符则回落全集保护（fail-closed，与 ApprovalRecord 的「靠守规矩」拉开档位差）；(b) 分支 3 加一次性约束（同阶段撤回计数 ≤1，或撤回后需人工确认）。若都留给 M10b/EV-77，则须像 R-e 那样把这个残余面如实登记进 §7.3，而不是让 §2.4 读起来像已闭合。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§3.1.4 / §3.1.5 / §3.3` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：行为表与用户出口只有「送审前 / 送审后」两态，没有「轮次作废（failed，尤其 subject_drift 整次作废）」这一格。登记发生在 --start（骨架期），而 subject_drift 的触发方式恰是「送审后原稿被改」——作废轮的原稿登记仍留在 run.json 里参与锚②核对，此后原地修原稿会让**全仓任意 git commit** 被拦（锚②核对所有主题所有登记项），唯一出口是永远不动那个旧文件、另起 -r 新稿。本主题 r1→r6 的工作流里「作废轮 + 继续改稿」是最高频事件，计划把它隐含在「另起 -r」里但从未点名 failed 轮；§3.3 的用例矩阵也没有这一格。

**依据**：实读 src/trivium/hooks.ts checkArchiveIntegrity：const runs = present.filter((r) => r.artifacts.length > 0)——无 status 过滤（:1264 附近）；src/trivium/review.ts:1499-1512：subject_drift ⇒ meta.status='failed' 后照常 writeRunMeta，artifacts 已含骨架登记；被审文档 §3.1.5 出口判据写的是「未进/已进 artifacts[]」而非「轮次是否完成」。

**建议**：明确拍板一态并写进行为表与用例：failed/skipped 轮次的**原稿条目**是否继续绑锚（若不绑，需说明与「谁登记了谁不可变」口径的边界及防伪影响——注意只豁免原稿条目，brief/review 条目维持）；若照绑，则把「作废轮后原地改稿 = 全仓提交被拦、出口只有新文件名」如实写进 §3.1.5 并配一条用例锁住行为。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§3.2.2（出口前移「三处」）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：「三处」漏了同类第四处：gate 侧「读不到 _meta/review-<侧>-<run_id>.json……请用 git restore 恢复」的失败文案。被教的那条命令路径含 _meta，命中 WRITE_LIKE(git restore) ∧ MENTIONS_OWNED，**在会话内今天就会被 Bash 守卫拒绝**——与 r5 CODEX-02 判定「两处同状态给相反出口、失效方向最坏（把排障者推向终端绕过）」的形态逐字同构，且它不在 D3 之后才坏，是现症。焦点六问「三处够不够」：按「枚举运行时出口文案」不够；本稿自己的药方（判据式表述）在这里的正确应用是「穷举论域用 grep 判据：凡教学 restore/checkout 类恢复命令的运行时文案」，而不是数到三。

**依据**：实读 src/trivium/gate.ts:344-352（missing_review_json 文案原文）；src/trivium/hooks.ts:734 MENTIONS_OWNED 正则含 _meta，:672-687 WRITE_LIKE 含 git restore，:850-854 bashTargetsProtected 先判 roleSuffixAnywhere 再逐 token 判 MENTIONS_OWNED；被审文档 §3.2.2 列出的三处为 CLAUDE.md、hooks.ts:913、hooks.ts:1289。

**建议**：§3.2.2 增列 gate.ts 该文案（同步明示「恢复动作需在终端完成」），并把「同类文案清单」的得出方式从人工数处改成一条可执行的 grep 判据（对 stderr 文案源串扫 git checkout|git restore），结果进 §3.3 用例或第 5 步回溯核对项。

### CODEX-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§7.1 / §7.2` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：台账口径按现文不可执行，且估算系统性漏项：①计数论域自称「代码双审轮次」，表内第一行却是 plan 档 6～7 轮——口径定义与用例互相打脸，「累计轮次 > 28」按哪套数没有答案；②前置小主题 EV-74/EV-79 若独立成主题，它自己的 plan 档双审未入账（EV-79 状态恰是「todo · 待双审」，2～3 轮的估法也没说是只数 code 档）；③第 5 步（纪律 6 回溯）在 §0.1 是正式一步，在 §7.1 表里**整行不存在**——回溯改动历来要过双审（本稿自己的脚注就引 M9「接线判据重写五版」先例）；④§7.2「起点写死为本稿落笔日」，但论域含已耗的 r1～r5 五轮——起线之前的数从哪进台账没写，机械追加填不出 15～21 这个盘。合计 15～21 在补上这三格后大概率抬升，1.33 倍裕量（且「>28」实际是 >27.93 取整、触发点 29 ≈ 1.38 倍）不一定够——焦点五问「是否仍偏乐观」：是，方向明确。

**依据**：被审文档 §7.1 首行自述「计数论域：代码双审轮次，含本计划自身」；§0.1 第 5 步在场而 §7.1 表无该行；doc/08_project/BACKLOG.md EV-79 行状态列「todo · 待双审」；§7.2 台账机制「收口前逐轮追加一行（run_id、轮次、墙钟日）」只覆盖起点之后的轮。

**建议**：三件：论域改名「双审轮次（plan+code 分栏计）」，台账每行记两列；§7.1 补第 5 步与前置小主题 plan 档两行（或书面裁定其搭车不计，M9 先例不支持不计）；「起点=本稿落笔日」之后给已耗 5 轮一个一次性初始化行（从 .reviews/M10-任意Driver/plan/_meta 的 run 数取），否则阈值比对的两端不同源。

### CODEX-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§3.2.2 条 1（「仓库根 CLAUDE.md 的误拦段」）与 §6.2` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：根 CLAUDE.md 的误拦段是手写的开发侧副本；**下游项目读到的误拦段来自 skills/dual-critic/protocol/CLAUDE.md.snippet**（init.ts 渲染注入，snippet 第 28-29 行同样写死「-gemini.md、_meta、task.json…」这份名单）。该 snippet 的回溯被演进设计 §17 台账第 18 行钉给「M10 入口资产单源多渲染」——即 M10b。于是 M10a 收口到 M10b 收口之间有一个比「窗口期跨多天」长一个量级的口径缺口：此间每次 trivium init 装出去的文档都少说一个 -claude.md，而 §3.2.2 提前改根 CLAUDE.md 的判据（「会按过时文档排障」）对这条同样成立。

**依据**：实读 skills/dual-critic/protocol/CLAUDE.md.snippet:26-34（误拦段含具体后缀枚举）；src/trivium/init.ts:387 按该 snippet 路径读取注入；doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md:789 台账 18「protocol/CLAUDE.md.snippet……随 M10 入口资产单源多渲染一并收口」。

**建议**：不必把单源渲染拉回 M10a——改法二选一：第 2 步当步把 snippet 里那份后缀名单同步改判据式（纯文案改动，不依赖渲染机制）；或在 §7.3 如实登记「M10a→M10b 窗口，init 注入的误拦口径低报一个后缀」并在 §6.2 的 M10b 移交清单点名。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§0.3 首句` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：「翻 driverEnabled 之后，别家可以以名义 Driver 身份被指定（--driver codex 不再被 resolveDriver 拒绝）」与代码现状不符：resolveDriver 今天对 driverEnabled:false 就是「放行 + 标注」，不拒绝；M9 第 6 步已用 --driver codex 实跑过（BACKLOG EV-55 行与设计 M10 行前置③ 记载同文）。第 3 步的真实增量是「收紧成退 64（对未启用者）+ approve 复核」。错归因不炸代码，但会让 J2/预检验收用例把「放开」当 M10a 新行为去测——它测的是一条早已在场的路径（以及它今天仍是坏的：EV-72 未修前非缺省 Driver 写不出原稿，这恰是 §2.1 自述的问题）。

**依据**：实读 src/trivium/critics.ts:140-190（DriverResolution.enabledAsDriver 注释「false 不阻断——M9 只校验已登记」；resolveDriver 仅对未登记退 64）；doc/01_requirements/PRD_driver_dual_critic.md:18（「已于 M9 第 6 步以名义 Driver 真实审查一次」）；doc/08_project/BACKLOG.md EV-55 行。

**建议**：§0.3 改写为「M9 已放开名义指定、本稿补齐它欠的护栏；第 3 步的增量是收紧守卫与审批复核」，并让 J2 的验收语义落在收紧+复核上。

### CODEX-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `文档头「依据」行与 §6.2 主设计行` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：主设计 §16.1 M10 行的前置写着「**四条，缺一不可**」（①agy skills 实测、②EV-55、③EV-71、④EV-72）。本稿把 ① 整体移交 M10b 并在 M10a 翻 driverEnabled——边界论证（①只约束入口形态）我认可，这是对设计契约的**改**，不是设计里读得出的**解**。§6.2 的主设计回溯只写「拆为 M10a/M10b 两行并各记达成边界」，没点名前置清单的归属重排；按 AGENTS.md「与设计文档不一致的行为先回补修订」，漏这一条，下一位读 §16.1 的人会判 M10a 违约（或 M10b 接手人以为 ① 仍是谁的前置）。

**依据**：实读 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:2908（M10 行前置四条原文，① 含「P-05 教训」「实测通过才能拍板 §18.1 #16」）；被审文档头仅写「前置 ②④」。

**建议**：§6.2 主设计行加半句：「前置四条按 ②③④归 M10a / ①随入口资产归 M10b 重排」并进 §21 变更记录；§0.3 的自洽论证里把「① 不构成翻 driverEnabled 的前置」写成一句显式裁决，而不是靠依据行只列 ②④ 的默示。

## 认为正确的部分

- §3.1.2 的减法成立：锚②（checkArchiveIntegrity → checkRecordedArtifacts，hooks.ts:1274-1281 + archive.ts:436-466）确已按 sha256 校 missing/modified 且对全部主题全 run 生效，r4 的第 1 条判据确是重复实现；§3.3「不设去掉第 1 条的变异」随之正确。
- 焦点三我按自己的路径重核了 _meta 论域：writeMeta 全部调用点（review.ts:842/850/859/1184/1196/1260/1270、meta.ts:303、verify.ts:177/194）中固定名仅 'changes.diff' 一处，其余一律带 run_id；verify 的 run-*.json 状态恒为 success/failed 不落 running 例外、也不反复覆盖。**未发现第三个刻意可变项**——两排除项 + 求值顺序条款完备。
- §1.2 现状表的抽查项全部属实：IMMUTABLE_META 正则确不含 verify-（hooks.ts:486）、本仓确为 7 份 verify json、freeze.ts:447 的 _pending 逻辑路径属实、locateSubject 返回已验存在的路径属实、registry 三家 driverEnabled:false 恰三处（agents/registry.ts:204/218/232）、cli.ts:938-977 的 await-approval 有 runId 拒绝分支且无 sha256 抽核属实。
- §2.3 分支 1 提到首位消解 GLM-08 矛盾、AgentId 用 glm 而非 zcode、§2.5 用 Write/Edit 绕 MENTIONS_OWNED——均与代码对得上。
- 拆分边界的移交面不是纸面承诺：.reviews/M10b-入口资产与真载体验收/plan/ 已有 r1 稿，grep 核到 D4/guardLevel、AGY-05、EV-06/61/77/82、hooks --agent、两段式、AC-21 前半（J1）全部在场——焦点一第 1 问「移交会不会丢」在本次是可证的。

## 未覆盖范围（本侧盲区）

- 未跑 npm run check 复核 1566/1564 的基线声明；未核 r5 三侧 20 条「逐条落进本稿」的完整对应（只抽查了被引用的 CODEX-01/02/03、GLM-01/08、AGY-01 的落点）。
- 未评估 §4.3/4.4 抽取函数的内部设计（loadRoundReviews/checkAdjudication 的调用面细节属代码审档位）；未读 J1～J7 判据的完整定义文档逐条对表。
- M10b r1 稿只 grep 了移交项覆盖面，未审其内容质量——两稿互相引用的时点耦合（M10a 声明依赖 M10b 的 r1 实存）没有作为问题评估。
- 墙钟估算（每轮 30～45 分钟、r4 超时作废的复现概率）无可独立复算的数据面，未校。
- 第 4 步 EV-07 拆两件的 LITERAL_ALLOWLIST 豁免沿革仅按文档声明采信，未逐行核 registry-parity.test.ts。

## 实际查阅的项目文件

- `.reviews/M10-任意Driver/plan/2026-09-22-M10-任意Driver-r6-claude.md`
- `src/trivium/hooks.ts`
- `src/trivium/archive.ts`
- `src/trivium/review.ts`
- `src/trivium/verify.ts`
- `src/trivium/freeze.ts`
- `src/trivium/gate.ts`
- `src/trivium/critics.ts`
- `src/trivium/cli.ts`
- `src/trivium/meta.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/init.ts`
- `doc/08_project/BACKLOG.md`
- `doc/01_requirements/PRD_driver_dual_critic.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md`
- `doc/07_manuals/QUICKSTART.md`
- `skills/dual-critic/protocol/CLAUDE.md.snippet`
- `CLAUDE.md`
- `AGENTS.md`
- `.reviews/M10b-入口资产与真载体验收/plan/2026-09-22-M10b-入口资产与真载体验收-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":34,"project_reads":26}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
