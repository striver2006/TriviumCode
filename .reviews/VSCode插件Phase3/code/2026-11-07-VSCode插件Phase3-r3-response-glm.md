---
schema: trivium.disposition.v1
topic: VSCode插件Phase3
stage: code
role: glm
kind: response
run_id: 20261107T024822Z
addresses:
  - 2026-11-07-VSCode插件Phase3-r3-claude.md
  - 2026-11-07-VSCode插件Phase3-r3-gemini.md
  - 2026-11-07-VSCode插件Phase3-r3-codex.md
---

# 代码审第 3/5 轮应答（Driver：glm）

三侧结论：claude `reject`（1 阻断 + 7 重要 + 2 次要）、gemini `pass`（2 微瑕）、codex `reject`（6 重要）。共 **17 条：接受 17 ｜ 驳回 0 ｜ 暂缓 0**。gemini 首张通过票；剩余意见集中在 surgery=null 闭环、保存代次与零意见首写三族——其中「零意见首写」上轮修复因文本比对未命中实际未生效，本轮以 Edit 直改并复核。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | blocker | 接受 | 成立：surgery=null 分支只重建 front-matter 与表头，表单确认的新增/修复/删除全部丢失，闭环断点 | 无表头重建改为：新 front-matter + 标准表头 + **本次表单全部裁决行**（修复行在坏表里本就解析不出，一律按新表重写），坏表原文剔除、其余表外正文保留；真实 gate 闭环用例覆盖（无表头修复件过真实闸门） |
| CLAUDE-02 | claude | major | 接受 | 成立：表头替换改变行数后再按旧下标过滤，删除错位误删合法行 | renderRepaired 调序：先按原下标完成删除，再重定位表头行做替换；补 unparsable+unknown 组合测试 |
| CLAUDE-03 | claude | major | 接受 | 成立：零意见首写仍被拦——上轮 emptyDraft 修复因 python 文本比对未命中实际未写入（本流程性失误连同修复一并如实记录） | validateDesk 以 Edit 直改补 emptyDraft 例外（draft 且 items 空即期望集真空，允许空表件）；单测覆盖 |
| CLAUDE-04 | claude | major | 接受 | 成立：插件按 run 状态非 ok 即读 F 清单，与 gate「当前解析器重试 parse_fallback」的实际口径有差（重试成功侧 F 行会成 unknown；failed 侧无清单语义） | allFallbackIds 收窄到仅 parse_fallback 侧（failed 不再纳入）；重试成功口径差以「fallback 行可删除 + 落盘后自动 gate 复核兜底」收口，UI 提示如实注明；差分用例入单测 |
| CLAUDE-05 | claude | major | 接受 | 成立：行控件无变更回传，预览后编辑不失效预览，宿主 hash 收不到 desk-update | 表格挂 input/change 事件委托统一 collectDesk 回传；保存按钮本地即时禁用、预览成功再启用；宿主 formHash 比对双保险保留 |
| CLAUDE-06 | claude | major | 接受 | 成立：身份检查与写回之间仍有窗口，旧快照可覆盖新保存 | restore 写回前最后核对快照仍为 map 当前值，过期放弃并提示；窗口未彻底消除的部分在注释与交付说明如实标注 |
| CLAUDE-07 | claude | minor | 接受 | 成立：读取失败/超时仍宣称「可一键恢复」误导用户 | 快照失败路径文案改为「本次未取到保存前基线，无法一键恢复；如需回退请用 git」 |
| CLAUDE-08 | claude | major | 接受 | 成立：hash 比对与 rename 之间的 TOCTOU 窗口客观存在，原子替换不覆盖此点 | saveDraft 注释如实标注「冲突检测而非完全防覆盖」，语义降级为检测；彻底消除需协作锁，超出插件集成面承诺（交付说明注明） |
| CLAUDE-09 | claude | minor | 接受 | 成立：real 对拍只核字段形状，未验证生成件能否过真实闸门——本轮多个闭环断点正是它会暴露的形态 | real 新增两个真实闭环用例：临时 git 仓（真实 wrapper + 模板化 run 元数据）首写件与无表头重建件分别经真实 gate --check 断言 ok=true；无 JSON 直接失败不跳过 |
| AGY-01 | gemini | nit | 接受 | 成立：重复 JSDoc 行 | 已删 |
| AGY-02 | gemini | nit | 接受 | 成立：runId 轮转时旧缓存条目残留 | 状态迁移清理时连旧 runId 键一并删除 |
| CODEX-01 | codex | major | 接受 | 成立：对象身份检查不覆盖外部修改（终端/其它窗口改文件不换对象） | 与 CLAUDE-06 同族：恢复前核对 map 当前值 + 写回前最后核对；外部修改的完全检测需版本比对，超出本轮承诺（交付说明注明残余风险） |
| CODEX-02 | codex | major | 接受 | 成立：关闭旧通知会无条件清掉新快照 | 「保留」分支改为仅当 map 当前值 === 该通知快照时才清（按身份清理） |
| CODEX-03 | codex | major | 接受 | 成立：固定 1.2s 超时不保证读取先于保存完成（预算共享，其它监听器耗时后保存可先完成），迟到读取污染后续 | 引入保存代次：onWillSave 取号、读取完成核对代次（已有新保存开始即整次丢弃）；超时清理限定代次 |
| CODEX-04 | codex | major | 接受 | 成立：追加行固定六列，短表/重排列的合法件会错位 | 新增 appendRowByColumns：追加行按原表列映射生成（与替换行同列序）；无表头分支按标准六列整表重建 |
| CODEX-05 | codex | major | 接受 | 成立：与 CLAUDE-01 同源（无表头分支丢 appendLines） | 同 CLAUDE-01 落点；真实 gate 闭环用例覆盖 |
| CODEX-06 | codex | major | 接受 | 成立：与 CLAUDE-03 同源（零意见首写被拦，上轮修复未生效） | 同 CLAUDE-03 落点（Edit 直改 + 单测） |
