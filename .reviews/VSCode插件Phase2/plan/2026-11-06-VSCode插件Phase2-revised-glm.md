---
schema: trivium.disposition.v1
topic: VSCode插件Phase2
stage: plan
role: glm
kind: revised
run_id: 20261105T230457Z
addresses:
  - 2026-11-06-VSCode插件Phase2-claude.md
  - 2026-11-06-VSCode插件Phase2-gemini.md
  - 2026-11-06-VSCode插件Phase2-codex.md
---

# 裁决与修订计划：VSCode插件Phase2（计划审第 1/5 轮）

三侧结论：claude `pass-after-changes`（9 条：重要 4 ｜ 次要 5）、gemini `pass-after-changes`（6 条：重要 3 ｜ 次要 3）、codex `reject`（6 条：重要 5 ｜ 次要 1）。共 **21 条：接受 21 ｜ 驳回 0 ｜ 暂缓 0**。

三侧独立命中的三处要害（本轮必改，均已核实成立）：
1. **Diff 冻结基线**（CODEX-01 / CLAUDE-02 / AGY-06 交叉）：r1 用「查看时 HEAD + 当前工作区」承担不了回放语义——`# head:` 冻结 sha 就在 changes.diff 头部。r2 改为冻结 sha 基线 + 新增/删除/对象缺失三路降级。
2. **metaWatch 生命周期错位**（CODEX-03 / AGY-01 交叉）：挂在 cockpit.attachRun 上，面板一关（或 M3 从未打开）监听即死，与「批注独立于面板」自相矛盾。r2 提升至 AnnotationHub 服务级持有。
3. **快照一致性缺判据**（CODEX-02 / CLAUDE-01 / AGY-03 交叉）：r1「无锚文本界内即接受」无法区分「未变」与「已变但行数够」，违反漂移不静默；而反引号锚文本作否决条件又会大面积误杀。r2 改为两层一致性判据（git blob 静态比对 + 挂载后 hash 动态重校验），锚文本降为失配后的重定位启发式（空白归一化）。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 核实成立：v2 计划 §6.2 明确要求快照 hash 失配降级，run-*.json 的 snapshot 段实际存有 git_head/tree_hash/after_tree_hash，r1 未定义任何一致性判据与重校验触发器 | r2 D2′ 两层判据：挂载前静态比对（code 阶段 + git 可用 + run 有 head sha → 工作区文件 vs 该 sha blob，不一致→该文件意见整体标「⚠ 与送审版本不一致」）；挂载后动态校验（Hub 记每挂载文件内容 hash，onDidChange/SaveTextDocument 命中重算，失配触发重锚或标「⚠ 文件已编辑」）；「无锚文本+整体改写+行数仍够」进回归用例 |
| CLAUDE-02 | claude | major | 接受 | 核实成立：HEAD 是查看时活动引用，两份真实工件 base=head=7bae8100 而计划基线已 2be1ca88，字面 HEAD 必然随仓库演进漂移 | r2 D5′：Diff 左侧 = 该 run 冻结 head sha（changes.diff 头 `# head:` 经 git 扩展 toGitUri）；右侧当前文件并在标题明示；「HEAD 前进后回放同一 run」「--base 自定义送审」用例进 D9′ |
| CLAUDE-03 | claude | major | 接受 | 核实成立：任务书明列「文件关闭」触发面，r1 生命周期清单遗漏 | r2 D4′ 文件关闭语义澄清（Comments 线程随 VS Code 文档生命周期管理、Diagnostics 按 Problems 语义常驻，归属为 scope 非孤儿；主动清理只在 scope/run 切换与 dispose）+ 「关闭→重开→恢复且不重复、无残留」测试进 D9′ |
| CLAUDE-04 | claude | major | 接受 | 核实成立：D9 无任何 FR-6d 测试落点，风险表却承诺两路都测，自相矛盾 | r2 D9′ 新增 `diffParse.test` 单测（头部/分界/hunk/新增删除/多文件）与 `diffView.test` 集成（git 可用 + 三路降级 + 定位行号）；风险表与测试文件一一对应 |
| CLAUDE-05 | claude | minor | 接受 | 核实成立：endLine 解析后无消费者，23-29/104-131 区间折叠成首行 | r2 D3′：annotationModel 显式携带 [startLine,endLine]，thread.range 与 diagnostic.range 同源生成；漂移邻近按重定位行单行区间；文件级取首行；open-finding reveal 同区间；多行 location 断言进单测与集成 |
| CLAUDE-06 | claude | minor | 接受 | 核实成立：skipped/parse-error/unsupported-schema 只在解析层计数，UI 数据面无字段，降级与完整消费在界面不可分辨 | r2 D1′：逐文件状态模型 ReviewFileStatus{critic,runId,state:ok\|partial-skipped\|parse-error\|unsupported-schema\|unrecognized,actualSchema,skippedCount,notice}，reviewParse 输出、驾驶舱与历史树共同消费；三形态展示断言进集成 |
| CLAUDE-07 | claude | minor | 接受 | 核实成立：`..` 相对路径可逃逸工作区，与绝对路径边界处理不一致 | r2 D2′：统一 `path.resolve(workspaceRoot, rel)` 后 containment 判定，越界→只进意见列表标注「路径越界」；`../`、嵌套上溯、伪装前缀目录进单测；symlink 不解析（登记边界） |
| CLAUDE-08 | claude | minor | 接受 | 核实成立：多匹配取第一会挂错位置；0/负数/无行号语义未定义 | r2 D2′：多匹配→歧义降文件级+「多处命中」；line<1/非数字/有路径无行号→无行号文件级（标注「未给行号」，区别于漂移）；重复锚、0、负数用例进测试 |
| CLAUDE-09 | claude | minor | 接受 | 核实成立：README/描述/维护记录是用户可见能力说明，交付后会失实 | r2 实施步骤与交付清单加：extension/README.md 功能段（第一批表述注明时点保留）、package.json description、doc/08_project/README.md 维护记录两行；「改动 5 个既有文件」计数修正为实际清单 |
| AGY-01 | gemini | major | 接受 | 核实成立：cockpit.ts onDidDispose→disposeRuns 会销毁 attachRun 全部监听；M3「从未打开面板」场景更早暴露 | r2 D4′/D7′（同 CODEX-03 落点）：metaWatch 由 AnnotationHub 服务级持有，随 scope 启停；Cockpit 退化为 Hub 订阅者；补「面板关闭后侧完成落盘→批注仍更新、重开不重复挂载」集成测试 |
| AGY-02 | gemini | major | 接受 | 核实成立：真实工件实测 `cockpit.ts:418-424,524-530,533-546` 形态，r1 规则判「非数字」整段误降级 | r2 D2′：行号部分支持逗号分隔多区间/离散行，第一区间为主锚点、其余次级锚点列表；真实形态进单测夹具 |
| AGY-03 | gemini | major | 接受 | 核实成立：反引号常指「缺失的代码」（如「遗漏 --driver-model」在源码不存在），且 `pool.length===1` vs `pool.length === 1` 空白差异必误判——作否决条件会大面积误杀有效行级位置 | r2 D2′：锚文本降为「漂移重定位启发式」——只在确认失配（越界/文件已变）后辅助重定位，比对做空白归一化；行号有效性改由一致性判据承担（CLAUDE-01 落点），界内且（一致或无法判定）→ 信任行号 |
| AGY-04 | gemini | minor | 接受 | 核实成立：统一 diff 的 @@ 行不含文件路径，不解析 `diff --git`/`+++ b/` 则 hunk 无法归属文件 | r2 D5′：流式行状态机增加 `diff --git a/… b/…`（及 `+++ b/…` 兜底）前缀解析，维护当前文件上下文；用例进 diffParse 单测 |
| AGY-05 | gemini | minor | 接受 | 核实成立：run_root 是 30 天轮转清理的临时区（多机克隆必缺），已归档运行元数据在 `_meta/run-*.json` 完整保留 | r2 D6′：完结运行以 `_meta/run-*.json` + review-*.json 为第一事实源；run_root 仅活跃运行或归档缺失时探测；「run 目录未定位」不再作为已归档运行的异常标签 |
| AGY-06 | gemini | minor | 接受 | 核实成立：63 个变更文件中大量首轮新增，gitUri(HEAD) 对新增文件必 fatal（r2 改为 gitUri(head-sha) 同样成立） | r2 D5′（同 CODEX-01 落点）：`--- /dev/null` 判新增→打开文件+提示「本轮新增，无基线版本」；`+++ /dev/null` 判删除→打开 sha 侧只读基线+提示；进 diffView 集成 |
| CODEX-01 | codex | major | 接受 | 核实成立：review.ts 按 opts.diffBase 生成并逐轮冻结补丁、code-stage.ts 保存 base/head，r1 未消费该轮内容，历史回放开无关甚至空的 Diff | r2 D5′（同 CLAUDE-02 落点）：冻结 head sha 基线 + 新增/删除/head 对象缺失降级 + 「自定义 base、提交后回放、工作区继续编辑」测试 |
| CODEX-02 | codex | major | 接受 | 核实成立：run.v3 已提供 snapshot.tree_hash 而 r1 无快照一致性检查，D9 也未覆盖「无锚文本且文件变化但行数仍够」 | r2 D2′（同 CLAUDE-01 落点）：两层判据 + 回归用例；run snapshot 段作 run 身份展示，不复制编排器哈希算法 |
| CODEX-03 | codex | major | 接受 | 核实成立：面板关闭 disposeRuns 释放 run watcher，r1 把 metaWatch 接在同一生命周期，D4 未规定监控资源的服务级所有权 | r2 D4′/D7′（同 AGY-01 落点）：metaWatch 服务级 + Cockpit 订阅制 + 集成测试 |
| CODEX-04 | codex | major | 接受 | 核实成立：桌面端直发路径不经插件装配/injectText/sendText，r1 比对确实关闭不了插件注入链路遗留项 | r2 D10′ 入口保真拆三层并互不冒认：(a) 字节级通道（fakeTUI 已自动化）；(b) 入口解析保真（本主题真 dual-run 比对，Driver 执行零配额）；(c) 插件全链点火（GUI 真机，用户执行项）——(a)(b) 不宣称覆盖 (c) |
| CODEX-05 | codex | major | 接受 | 核实成立：任务书第 6 项要求「执行并记录」，r1 把完成条件改成材料入档属偷换；但 GUI/真机操作物理上无法由 Driver 代跑 | r2 验收清单将 P1 人工项列为**条件性验收**：S5 后 Driver 主动请用户执行（清单+模板）；执行并记录则关闭；用户明示延后则如实标「未执行、留待用户」；范围是否调整由用户决定——不把模板当通过 |
| CODEX-06 | codex | minor | 接受 | 同 CLAUDE-03（交叉命中）；services 固定首个 root 的 multi-root 边界一并登记 | r2 D4′（同 CLAUDE-03 落点）+ multi-root 登记后续批次 |

## 二、修订去向

逐条裁决已全部接受，修订完整落进 `2026-11-06-VSCode插件Phase2-r2-glm.md`（§〇 范围、§一 事实 22~25、§二 架构、§三 D1′~D11′、§四 步骤、§五 验收、§六 风险、§七 交付物）。本轮判「修改后通过 → proceed」，r2 即本主题计划定稿，S5 按它实施。

> 命名说明：本件曾误写为带轮次名 `…-r2-revised-glm.md`，闸门按本轮 rerun_index=1 要求无轮次名 `…-revised-glm.md`，本件为正名重建（内容一致）；带轮次名的误名原件已改为占位说明。
