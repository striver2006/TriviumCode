---
schema: trivium.disposition.v1
topic: VSCode插件Phase2
stage: code
role: glm
kind: response
run_id: 20261106T002819Z
addresses:
  - 2026-11-06-VSCode插件Phase2-claude.md
  - 2026-11-06-VSCode插件Phase2-gemini.md
  - 2026-11-06-VSCode插件Phase2-codex.md
---

# 代码审第 1/5 轮应答（Driver：glm）

三侧结论：claude `reject`（6 重要 + 5 次要）、gemini `pass-after-changes`（1 重要 + 2 次要 + 1 微瑕）、codex `reject`（7 重要）。共 **22 条：接受 22 ｜ 驳回 0 ｜ 暂缓 0**。

四处交叉命中（本轮必修）：**relPath 断链**（CLAUDE-01/AGY-01/CODEX-01——RunCard 遗漏 relPath，Diff 主入口静默失效）；**静态一致性管线三缺陷**（CODEX-04/CLAUDE-03 首次挂载 unknown 固化、CODEX-05 过早标记已校验、CODEX-06 缓存跨 run 串用）；**历史回放无意见列表**（CODEX-07/CLAUDE-04）；**行号 0/负数**（CLAUDE-09/AGY-02）。

设计级修正一条：**CLAUDE-02 静态基线语义**——changes.diff 的 `head` 是补丁生成时的 HEAD 提交，而缺省 code 审的被审内容是「base(=HEAD) → 工作树」的未提交改动，用工作区 vs head blob 比对必然把被审改动本身判成 mismatch。r2 计划 D2′ 写「工作区文件 vs 该 sha blob」时就把基线语义理解错了。修法见裁决表（重建送审工作树内容，而非换基线提交）。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 核实成立：findings 映射漏 relPath，cockpitHtml 读 f.relPath 为 undefined，open-diff 空路径静默 break | runCards 映射补 `relPath`；cockpitFindings 集成测试补「open-diff 消息携带真实 relPath 过守卫」断言 |
| CLAUDE-02 | claude | major | 接受 | 核实成立（设计级）：head 是补丁生成时 HEAD（review.ts:1021-1031 先 diffAgainst(base) 再记 headSha），工作区 vs head blob 必然 mismatch——把被审改动本身当漂移 | **重建送审工作树内容比对**：diffParse 保留各 hunk 正文行；静态校验改为「base blob（base 字面 HEAD 时即 head sha 冻结提交）+ apply 该文件补丁段 → 送审内容」与工作区文本归一化比对；变更集外文件无送审快照 → 诚实 unknown；补「默认 HEAD、工作区含待审改动 → consistent」「回放后工作区再改 → mismatch」两用例；r2 计划该处表述随交付说明更正（计划文件本身不改，差异在交付说明登记） |
| CLAUDE-03 | claude | major | 接受 | 核实成立：resolveLocation 在 ensureConsistencyChecked 之前执行，consistency 固化 unknown 不回流本次装配 | rebuild 管线重排：先收集涉及文件 → 静态校验 → 再 resolveLocation（consistency 回调查缓存已热）→ 装配；补「首次 setActiveRun 即见 mismatch/consistent」测试 |
| CLAUDE-04 | claude | major | 接受 | 核实成立：replayRun 只切 Hub，runCards 只遍历活跃 this.runs，重启后回放无意见卡 | runCards 末尾：hubState.runId 不在 this.runs 时由 Hub 数据追加一张「历史回放卡」（topic/stage/runId 来自 hubState，无中止按钮、phase 标「回放」，findings 数据同焦点路径）；补「新 Cockpit 无活跃 run → replayRun → cardsForTest 有回放卡含意见」集成测试 |
| CLAUDE-05 | claude | major | 接受 | 核实成立：base 字面 HEAD 缺省场景 head sha 恰为 base 提交（Diff 左侧现实现正确）；自定义 base 时 head ≠ base，Diff 展示错对象 | diffView：`base === 'HEAD'` → 左侧 head sha（现行为，正确）；base 为 40 位 sha → 直接用该 sha；其它 ref 字面量 → 无法冻结 → 降级打开文件 + 明示「自定义 base 未能冻结」；diffParse.base 已有消费者；补自定义 base（sha 形态/不可冻结形态）两测试 |
| CLAUDE-06 | claude | major | 接受 | 核实成立：deleted 分支在两次 showFile fallback 之后，降级会打开按定义已删除的工作区路径 | openDiffFor 分支重排：member.deleted 提前——git 可用且对象可读 → 打开基线只读；否则 showInformationMessage 明示（不 showFile）；夹具真实删除 gone.ts；补「git 可用基线打开」「不可用仅提示不抛」两路测试 |
| CLAUDE-07 | claude | minor | 接受 | 核实成立：maxTotalFindings 写死 2000，配置无消费方 | 与 maxThreadsPerFile 同款读配置；单测验证非默认值抑制行为 |
| CLAUDE-08 | claude | minor | 接受 | 核实成立：逗号多区间只留 ranges[0]，5-6 丢失 | resolveLocation 主锚点处理时把 a.ranges.slice(1) 各生成次级 AnchorResolution（界内 → line 级标注「次级区间」、越界 → file 级标注），不影响线程主锚；补 2-3,5-6 次级区间断言 |
| CLAUDE-09 | claude | minor | 接受 | 核实成立：0 进 line 分支、负数污染 relPath 成 missing-file | parseRanges 正则改 `[1-9]\d*`（拒 0）；resolve 前 start<1 → 文件级「未给行号」；normalizeSegment 在无 ranges 且尾巴呈 `:−数字/非数` 形态时剥离尾巴再判文件形态；补 0/负数/反向区间测试 |
| CLAUDE-10 | claude | minor | 接受 | 核实成立：layer/kind/confidence 表外值未被跳过，注释与契约不符 | reviewParse 增 LAYERS/KINDS/CONFIDENCES 枚举校验，表外 → skipped 计数；补逐字段表外值用例 |
| CLAUDE-11 | claude | minor | 接受 | 核实成立：overflow 与总量降级静默 | ScopeState 增 `notice`（单文件溢出 N 条仅 Problems / 总量超限仅 Problems）；驾驶舱卡显示 + 状态栏带提示；补两类超限用户可见断言 |
| AGY-01 | gemini | major | 接受 | 同 CLAUDE-01（交叉命中） | 同 CLAUDE-01 落点 |
| AGY-02 | gemini | minor | 接受 | 同 CLAUDE-09（交叉命中） | 同 CLAUDE-09 落点 |
| AGY-03 | gemini | minor | 接受 | 核实成立：简化 patch 无 --git 头时 `--- /dev/null` 在 current=null 处丢失 added | diffParse 增 pendingAdded 状态（见 /dev/null 时置位，后续 +++ 建文件时赋予）；补无 --git 头新增文件用例 |
| AGY-04 | gemini | nit | 接受 | 核实成立：activationEvents 缺 onView:triviumHistory | package.json 补 `onView:triviumHistory` |
| CODEX-01 | codex | major | 接受 | 同 CLAUDE-01（交叉命中，且实测复现） | 同 CLAUDE-01 落点 |
| CODEX-02 | codex | major | 接受 | 核实成立：ingest 在 readdir/readFile await 后不核对 scope，旧主题结果写入新 scope 缓存 | scope 增代次 scopeSeq（setScope 递增）；ingestMetaDir 开始捕获 {dir, seq}，await 后不符则整次丢弃；补「暂停 A 摄取 → setScope B → 恢复 A → B 缓存无 A 意见」单测（注入 readFile 延迟） |
| CODEX-03 | codex | major | 接受 | 核实成立：dispose 不递增 rebuildSeq，在途装配在 controller.dispose 后仍建线程 | dispose() 递增 rebuildSeq；rebuild 每个 await 边界后复查 `disposed || seq !== rebuildSeq` 即返；补「读取挂起时 dispose → 无对象创建」生命周期测试 |
| CODEX-04 | codex | major | 接受 | 同 CLAUDE-03（交叉命中，实测复现 displayed=unknown/cached=mismatch） | 同 CLAUDE-03 落点（管线重排） |
| CODEX-05 | codex | major | 接受 | 核实成立：无 diff/无文件也标记 run 已校验，迟到侧文件永不补检 | 改 per-file 进度：`checkedFiles: Set<runId:relPath>`，仅实际完成比对的文件记录；新文件落盘后续 ingest 自然补检；补「diff 先到 review 后到 → 后到意见也有一致性结论」测试 |
| CODEX-06 | codex | major | 接受 | 核实成立：consistency 缓存 key 仅 relPath，切 run 沿用上一轮结论 | 缓存 key 改 `runId:relPath`（edited 结论随之隔离到所属回放）；setActiveRun 重建时按新 run 取缓存；补「两轮同文件不同 blob → 切轮结论各自正确」测试 |
| CODEX-07 | codex | major | 接受 | 同 CLAUDE-04（交叉命中，实测复现 0 卡片） | 同 CLAUDE-04 落点（历史回放卡） |

## 二、修改清单（S8 执行序）

1. diffParse：hunk 正文行保留 + base 消费 + pendingAdded（CLAUDE-02/05、AGY-03）；
2. locationResolve：0/负数/尾巴剥离 + 次级区间展开（CLAUDE-08/09、AGY-02）；
3. reviewParse：layer/kind/confidence 枚举（CLAUDE-10）；
4. annotationHub：scope 代次防污染（CODEX-02）、dispose 失效在途（CODEX-03）、管线重排「收集→静态校验→resolve→装配」（CLAUDE-03/CODEX-04）、per-file 校验进度（CODEX-05）、缓存 key 含 runId（CODEX-06）、送审内容重建比对（CLAUDE-02）、maxTotalFindings 配置（CLAUDE-07）、overflow/总量提示（CLAUDE-11）；
5. diffView：deleted 分支前置 + base 消费与自定义 base 降级（CLAUDE-05/06）；
6. cockpit/cockpitHtml：relPath 补传（CLAUDE-01）、历史回放卡（CLAUDE-04/CODEX-07）、超限提示显示（CLAUDE-11）；
7. package.json：activationEvents 补 onView:triviumHistory（AGY-04）；
8. 测试补齐：上表各落点对应单测/集成用例；extension check 全绿后送 S9。
