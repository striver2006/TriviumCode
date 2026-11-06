---
topic: VSCode插件Phase2
stage: code
role: glm
kind: delivery-note
run_id: pending-S6
---

# VSCode插件Phase2 · S5 交付说明（Driver 留档）

- 日期：2026-11-06 ｜ Driver：glm（ZCode 桌面端会话）
- 计划定稿：`.reviews/VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-r2-glm.md`（计划审第 1/5 轮三侧 21 条全接受后合入）
- 本件是 S5 的 check 留档 + 入口保真比对结论 + P1 条件性验收清单（D10′ 分层）

## 一、verify 执行记录（S5 收口时点）

extension 侧（`npm run check --prefix extension`，0.2.0）：

| 命令 | 结果 | 明细 |
| :--- | :--- | :--- |
| `npm run typecheck` | ✅ 绿 | tsc strict + noUncheckedIndexedAccess + noUnused*，0 error |
| `npm run test:unit` | ✅ 107/107 | 第一批 59 + 本批 48（reviewParse 含真实工件三件与 v1 旧件降级、locationResolve 归一/fuzzy 全分支、annotationModel 区间/分层/阈值/标签、diffParse 含真实 changes.diff、runHistory 第一事实源、versionCheck review 项） |
| `npm run test:integration` | ✅ 57/57 | 第一批 34 + 本批 23：批注装配/分层不覆盖/区间贯通、severity 四档映射、漂移三态（越界无锚→文件级、有锚→nearby、多命中→歧义）、listOnly、逐家开关、切换 scope 全清无孤儿、服务级 metaWatch（无面板消费落盘+自动切新轮）、文件关闭重开恢复不重复、挂载后编辑重校验显式标注、静态一致性不误报、Diff 冻结基线/HEAD 前进/新增/删除/非成员/对象缺失、历史树两级+回放+归属纪律+v1 降级标注、驾驶舱 run 卡意见数据面 |
| `TRIVIUM_E2E=1 npm run e2e` | ✅ 2/2 | 真实 trivium.cjs 桩链路回归 |
| `npx vsce package` | ✅ | trivium-cockpit-0.2.0.vsix（99.64 KB，7 文件） |

主仓侧：`env -u ZCODE_BASE_URL npm run check` 回归（第一批登记的环境敏感项：ZCode 桌面端会话带 ZCODE_BASE_URL 时 zcode-full-copy-arm 测试误报；结论以干净环境为准）——结果见 §一补记。

## 二、入口解析保真比对（D10′-b 层，本主题真 dual-run 驱动）

比对对象：用户正文（会话消息原文）→ skill 转抄 → `topic resolve` → task_goal → 三家 BRIEF 附录。

**结论：逐字保真通过**，分层证据：

1. **BRIEF 附录全文锚点 9/9 全中**（`_meta/brief-{claude,gemini,codex}-20261105T230457Z.md` 的任务目标附录）：首段参数、任务目标句、范围句、花括号改法 ×2、单引号保留（`'trivium.review.v2'`）、硬约束、测试与验收、两个必答项——审查员实际读到的与用户正文一致。
2. **task_goal 存档字段为 201 字截断形态**（task.json 与 run.json 均是）——这是编排器 `clampGoal` 的**设计行为**（EV-210/设计 §9.4：>200 字截断并追加 `…` 显式标记，全文经计划附录送审），非静默丢失。
3. **两处已声明整形**（均经用户 AskUserQuestion 确认）：`.reviews/<主题>/<阶段>/…` 与 `run_root/<repoId>/` 的 ASCII 尖括号改花括号——原因是 TriviumCode Hook 的 Bash 写命令形态判定把 `>` 误当重定向（已知误拦，AGENTS.md 登记），任务目标须逐字转抄不可由 Driver 改写，故请用户定措辞。
4. 换行折叠（所有空白折成一个空格）为 foldGoal 设计口径。

覆盖边界（诚实声明）：本比对证明的是「入口命令 → resolve → 送审包」链路（b 层）。插件的「装配表单 → injectText 整形 → sendText → 真 CLI 会话」全链（c 层）未在本比对内——该层属真机注入矩阵用户执行项（§四）。

## 三、本批实现要点（对照 r2 计划）

- **FR-6a**：`reviews/reviewParse.ts`（review.v2 解析 + ReviewFileStatus 逐文件状态模型：ok/partial-skipped/parse-error/unsupported-schema/unrecognized，CLAUDE-06）+ 驾驶舱 run 卡意见列表（按审查者分组折叠、severity 四色徽标、降级与漂移标注、Diff 按钮）。
- **FR-6b**：`reviews/locationResolve.ts`（分号多文件/逗号多区间（AGY-02 真实形态）/引号/绝对路径截取/`..` 防逃逸（CLAUDE-07）；行号校验：一致性两层判据（git blob 静态比对 + 挂载 hash 动态重校验（CLAUDE-01/CODEX-02））+ 锚文本失配重定位启发式（AGY-03，空白归一化）+ 多命中歧义降级（CLAUDE-08））；`reviews/annotationHub.ts`（服务级，metaWatch 随 scope（CODEX-03/AGY-01））；线程粒度 (file,行区间)、同行多侧合 thread 分层、逐家开关全量重建。
- **FR-6c**：blocker/major→Error、minor→Warning、nit→Information；诊断与线程同源区间；漂移/一致性标注进 message。
- **FR-6d**：`reviews/diffParse.ts`（流式状态机：`#` 头/`diff --git`/`+++` 分界（AGY-04）/`@@` hunk/`/dev/null` 新增删除（AGY-06））+ `reviews/diffView.ts`（**冻结 head sha 基线**（CODEX-01/CLAUDE-02）+ 三路降级明示 + 右侧定位）。
- **FR-7**：`history/runHistory.ts`（完结运行 `_meta/run-*.json` 第一事实源（AGY-05），run_root 仅归档缺失时探测、归属纪律同 runDiscovery）+ `history/historyProvider.ts`（主题→运行两级树、逐轮意见数/严重度分布/verdict、点击回放）+ 状态栏（当前批注来源，点击 QuickPick 切轮）。
- **量级控制（D8′）**：`trivium.reviews.maxThreadsPerFile`（缺省 200，超出仅 Problems）、scope 总量 2000 上限、evidence 截断 500 字、metaWatch 随 scope 启停、历史惰性扫描、diff 只解析分界与 hunk 头。
- **集成测试环境事实**：`--disable-extensions` 连内置 git 扩展一并禁用——「git 可用」路径用注入伪 API 测编排逻辑（探测→diff→定位），降级路径真实覆盖；真实 git 语义进 F5 走查项。
- **文件关闭语义（CODEX-06/CLAUDE-03）**：Comments 线程随 VS Code 文档生命周期管理、Diagnostics 按 Problems 语义常驻（归属为 scope）；主动清理只在 scope/run 切换与 dispose——测试覆盖「关闭→重开→恢复且不重复、无残留」。

## 四、P1 条件性验收清单（D10′-c 层：需用户执行，如实记录）

> Driver 无法代跑 GUI/真机操作（CODEX-04/05 裁决）。以下清单按 r2 计划 D10′ 准备就绪；
> **执行并记录即关闭；明示延后则本表保持「未执行」状态，不视作已通过。**
>
> **用户决策（2026-11-06，S5 收口时）**：走查与真机矩阵在**代码双审与 S10 之后**执行——
> 本表保持「未执行、留待用户」直至用户执行并回填。

### F5 GUI 走查（装配→点火→看板至终态→审查正文，含 Phase 2 新路径）

> **⑤⑥⑦ 已于 2026-11-07 由 Driver 以 computer-use 自动走查完成（VS Code 真机实装
> trivium-cockpit-0.2.0.vsix，零配额路径用本仓真实归档），逐项取证记录如下；①~④（装配→点火链）
> 与注入矩阵仍为用户执行项。**

- [x] **⑤ P2 路径** ✅（computer-use 走查，2026-11-07）：
  - 意见列表分组/徽标：回放卡「3 侧 · 13 条：阻断 0 重要 6 次要 7 微瑕 0」，claude·修改后通过·共 6 / codex·不通过·共 5 / gemini·修改后通过·共 2，与真实工件逐值一致；
  - location 跳转：点击 `historyProvider.ts:125` → 打开文件并定位 L125（状态栏「行 125，列 1」）；
  - Comments 面板：多侧分层线程完整（同位置 claude 线程含「来自 codex 的最新回复」；diffParse.ts 上 codex/gemini 两线程互不覆盖）；批注正文含问题/建议/证据/置信度与「**其余位置**：次级位置 L445-456」；
  - Problems：状态栏「错误 6 警告 7」= severity 映射精确（6 major→Error + 7 minor→Warning）；
  - Diff 按钮：点击生效，通知「Trivium Diff：本轮新增文件，无基线版本，直接打开」——本主题被审文件相对基线 HEAD 全为新增，**新增降级路径真机验证正确**（CLAUDE-02/AGY-06）。**已知边界**：「冻结基线 vs 当前文件」正常路径无真实数据可触发（两批真实意见引用的都是新增文件），其机器验证只到集成测试伪 git API 层，待未来修改存量代码的审查轮自然覆盖；
- [x] **⑥ P2 路径** ✅：运行历史树两级正确（Phase2 展开 8 节点、Phase0-1 展开 6 节点，逐轮统计与 verdict 精确）；点击 Phase0-1 code r2 → 状态栏整体切换「VSCode插件Phase0-1/code · 20261105T185028Z · 13 线程/13 诊断」、Comments/诊断/webview 意见列表全量切换无残留（走查中曾疑似 webview 数据滞留，经事实核对为两轮三家分布恰好相同的巧合 + AX 增量缓存假象，实际渲染已正确切换）；
- [x] **⑦ 逐家开关** ✅（控件层）/△（点击层）：分组头 checkbox 控件存在且带说明（AX 可见）；开关的过滤语义（关侧不列条目、全清=全部）由集成测试「逐家开关过滤列表（CLAUDE-05）」在真实宿主断言通过——computer-use 对 webview 内控件与 QuickPick 的点击自动化未成功（VS Code webview/QuickPick 的 AX 可达性限制，非产品缺陷证据）；
- [ ] ① 装配：驾驶舱表单选 Driver/审查者/入口/轮次，「执行前置链」三步绿、主题回显；
- [ ] ② 点火：终端拉起、命令注入、看板出现该 run 卡；
- [ ] ③ 看板至终态：侧状态卡推进 → 终态复核；
- [ ] ④ 打开审查正文：run 卡工件链接可开；

### 真机注入矩阵补齐（就绪延迟标定 + sendText 定档）

每家载体在 F5 宿主执行（建议用小型真任务或 dry 话题；记录写入下表）：

| 维度 | claude | codex | gemini(agy) | glm(zcode) | 方法 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 就绪延迟中位数 | __ms | __ms | __ms | __ms | 点火后观察注入是否被吞；调 `trivium.launch.readyDelayMs`（缺省 3000）二分定档 |
| sendText 模式定档 | execute/split/manual | | | | 缺省 execute；回车被吞或断行时改 `split`；TUI 异常时 `manual`；逐家写入 `trivium.launch.carrierOverrides`，如 `{"claude":{"readyDelayMs":5000,"sendMode":"split"}}` |
| 插件全链点火（c 层） | ① 装配→② 点火→③ 会话收到完整命令→④ `topic resolve` 的 task_goal 与表单正文一致（看终端回显或 `.reviews/<主题>/plan/_meta/brief-*.md` 附录） | 同左 | 同左 | 同左 | 一次即可；比对点同 §二 |

- [ ] 四家延迟标定完成并写入 carrierOverrides
- [ ] sendText 模式定档完成
- [ ] 插件全链点火（c 层）执行并比对 task_goal 保真

### 记录模板

每项执行后在本节追加一行：`｜ 日期 ｜ 项目 ｜ 载体 ｜ 结果/参数 ｜ 备注 ｜`。未执行项保持空表——交付状态如实。

## 五、已知局限（如实交付）

- 「git 可用」Diff 路径的自动化用的是注入伪 API（编排逻辑层）；真实 `git:` scheme 语义（blob 读取、GC 缺失）在降级路径已真实覆盖，正常路径依赖 F5/日常使用验证。
- 静态一致性比对仅 code 阶段、仅变更集内文件（D8′ 设计）；plan 阶段意见显示「一致性未校验」提示。
- multi-root 工作区固定首个 root（第一批边界沿用）；Windows 未适配（CODEX-04 边界）。
- Comments 视图的实际渲染形态（着色/折叠交互）无公开枚举 API，自动化以 threadsSnapshot 断言，视觉呈现进 F5 走查 ⑤。
- scope 内意见总量 >2000 时行内批注折叠为仅 Problems（阈值可配）——真实场景远低于此。

## 六、变更清单

- 新增 `extension/src/reviews/`（reviewParse / locationResolve / annotationModel / annotationHub / metaWatch / diffParse / diffView，7 文件）、`extension/src/history/`（runHistory / historyProvider，2 文件）；
- 改动既有：`env/versionCheck.ts`（review 支持项）、`ui/cockpit.ts`、`ui/cockpitHtml.ts`、`extension.ts`、`services.ts`、`package.json`（0.2.0 + 视图/命令/配置 + 描述同步）、`README.md`（CLAUDE-09）；
- 测试：单测 4 新文件 + versionCheck 扩展；集成 4 新文件 + fixtureLib 扩展（buildPhase2Fixture：git 冻结基线 + 三侧全形态工件 + 多 run 目录 + 撞号桶）；`test/integration/suite.ts` 登记新四件；
- **未改**：`src/**`、`skills-src/**`、`skills/**`、`test/**`（主仓）、主仓构建配置、`.trivium/config.yaml`（AGY-03 维持）。

## 一补记：主仓 check 结果

`env -u ZCODE_BASE_URL npm run check`：**通过（EXIT=0）**——typecheck ✓ + build ✓ + test ✓（tests 4046 / pass 4030 / fail 0 / skipped 16，16 项为平台性跳过，与第一批基线一致）。

**过程记录（存量问题处置）**：首轮主仓 check 因归档「真实语料」回归锁（`run-meta.test.ts:527`，M9/EV-66 起存在）红——论域含两个**误名占位件**（第一批 `2026-11-06-VSCode插件Phase0-1-revised-glm.md`，已随 2be1ca88 入库；本批 `2026-11-06-VSCode插件Phase2-r2-revised-glm.md`）。该红为**存量问题**（第一批占位件入库时基线即红，与本批代码无关），但本批占位件加重了坏件数。经用户确认，已在终端清理两个占位件（正本均完好），check 恢复绿。教训登记：占位件不可入库——后续误名场景应请用户当场清理而不是入库留档。

## 七、代码审第 2/5 轮修订记录（13 条全接受，见 r2-response 件）

第 2 轮判「修改后通过 → proceed」（claude/gemini 转通过，codex 仍列 3 major）。修订后 verify：**extension check 全绿（单测 121 + 集成 67）；vsce 重打包 0.2.0（103.17 KB）**。

- **AGY-01/CODEX-03（交叉，正确性）**：次级区间循环移到主锚点之后——anchors[0] 恒为主区间（原实现次级先入列，主批注位置漂移）。
- **AGY-02/CODEX-04（交叉，正确性）**：`\ No newline at end of file` 标记前置跳过（原为不可达死代码，hunk 被提前截断）；一致性比对加末尾换行容差（old/new 侧 no-newline 差异不构成 mismatch；精确 noNewline 传播以容差覆盖，取舍登记于 r2-response）。
- **CODEX-01（并发）**：requestSeq 保护 setActiveRun 链——交错回放（快速点击不同主题）时旧请求作废，焦点不被旧 run 劫持；集成测试「交错回放」确定性覆盖。
- **CODEX-02（并发/缓存）**：文件编辑使该路径**全部 run** 的一致性缓存与已检标记失效（原只改当前 run，切回旧轮结论过期）；重检**buffer 优先**（已打开未保存的编辑是用户当前所见——修复中发现的深层问题：重检读磁盘会漏掉未保存编辑）；集成测试 A→B→编辑→A 回归。
- **CODEX-05（资源）**：MetaWatch disposed 复查 + mount 拒绝已释放实例（rescan 在途返回后不再重挂 fs 句柄）。
- **CLAUDE-01（入口）**：历史树回放后执行 `trivium.openCockpit`——面板未开也能看到意见列表（回放卡）。
- **CLAUDE-02（入口）**：Diff 按钮条件从「line 级」解耦为「relPath 存在且在变更集」——删除文件（必为 missing-file）也能从意见列表打开只读基线；夹具补 X-06（指向真删的 gone.ts）端到端断言。
- **CLAUDE-03（贯通）**：次级位置进批注正文（「其余位置」段）与卡片/列表（secondary 字段 + ↳ 行）。
- **CLAUDE-04（契约）**：非数字行号尾巴（`:abc`/`:1x2`）剥离 → 文件级「未给行号」；尾巴含 `/` 或 `.` 保守不剥（诚实标缺失）。
- **CLAUDE-05（接线）**：驾驶舱分组头逐家开关 checkbox 接线（原 Webview 无控件，宿主 case 成死分支）；列表条目与批注同口径过滤，组头保留全量计数。
- **CLAUDE-06（契约）**：review.v2 根字段校验（findings 数组/verdict/summary 损坏 → parse-error 明示，不再静默当空意见）。
- 测试基建：夹具 changes.diff 改为**真实 git diff 生成**（hunks 与基线/工作区自洽——送审内容重建语义的前提）、真删 gone.ts、stale.ts 送审后漂移演示、.baseline 基线快照供伪 git API；「历史回放卡」用例稳态化（attach 链竞争是波动来源）。

## 八、S10 出口记录（如实：未通过——环境敏感的既有测试，非本批回归）

四次 verify（20261106T014624Z / r2 20261106T015554Z / r3 20261106T024330Z / r4 20261106T025331Z，报告均已落盘）：build（typecheck + build）四轮全绿；**npm test 四轮均失败**，失败项全部落在 `doctor-deadline.test.js` 的两个定时器时序用例：

- I4「兜底：段卡在不经 run() 的 await」（300ms 兜底窗）：r1-r3 断言 `hit/stuck` false、r4 断言 `sections[0].state` 得 `not_started`——**失败形态随负载漂移**；
- I6「段内不带 killTree 的派生」（r4 第二失败，同文件同形态）。

**定性证据链**：① 该用例单文件连跑 13/13 绿（多次）；② 本批主仓 `src/`、`test/`、`skills/`、`skills-src/` 零改动；③ S5 收口时同会话同命令全绿（tests 4046 / pass 4030 / fail 0）；④ 四次失败期间机器 5min 负载 11~14（10 核；ZCode 桌面端 + 本长会话工具链 + 用户侧 VS Code/Kimi 常驻），失败形态漂移是调度延迟特征；⑤ 第一批 S10 曾在同一用例上首次失败（其交付说明 §八登记「全量并发下的时序敏感」），其后无主仓改动。

**结论**：`doctor-deadline` 的 I4/I6 用例对 300~500ms 定时器窗口做硬断言，在 load>10 的多负载机器上不成立——**主仓既有测试的环境敏感缺陷，非本批回归**。按 FR-21 如实报告：**S10 未通过，全流程状态 failed，全部工件保留**；extension 侧（本批交付面）check 全绿不受影响。候选后续（各自另行立项，不在本批）：提高 I4/I6 定时器容差或改事件驱动断言（走主仓双审）；或在低负载时段复跑 `trivium verify --topic VSCode插件Phase2` 收口。

**用户收口决策（2026-11-06，S10 四次失败后）**：在低负载时段由用户在终端复跑 `env -u ZCODE_BASE_URL .trivium/bin/trivium verify --topic VSCode插件Phase2`（verify 幂等落盘 r5；通过即收口，Driver 届时把结果回填本节）。

**复跑结果（r5，20261106T150541Z，用户终端低负载时段）：通过 ✅**——typecheck ✓（2.3s）+ build ✓（3.1s）+ test ✓（342.3s），总计 348s；报告落盘 `.reviews/VSCode插件Phase2/verify/2026-11-06-VSCode插件Phase2-r5-verify.md`。doctor-deadline I4/I6 在低负载下如预期转绿——印证 §八的定性（环境负载敏感，非本批回归）。**S10 出口就此收口：全流程状态 success（此前四次失败均为同因环境敏感，已如实留痕 r1~r4）。**
