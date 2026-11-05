---
schema: trivium.disposition.v1
topic: VSCode插件Phase0-1
stage: code
role: glm
kind: response
run_id: 20261105T185028Z
addresses:
  - 2026-11-06-VSCode插件Phase0-1-r2-claude.md
  - 2026-11-06-VSCode插件Phase0-1-r2-gemini.md
  - 2026-11-06-VSCode插件Phase0-1-r2-codex.md
---

# 应答：VSCode插件Phase0-1（代码审第 2/5 轮）

三侧结论：claude `pass-after-changes`（6 条：重要 4 ｜ 次要 2）、gemini `pass-after-changes`（2 条：重要 1 ｜ 次要 1）、codex `reject`（5 条：重要 5）。共 **13 条：接受 13 ｜ 驳回 0 ｜ 暂缓 0**。

本轮三侧同点命中的两处：驾驶舱单例被面板关闭永久销毁（CLAUDE-01/AGY-r2-01/CODEX-01——第 1 轮生命周期修复的矫枉过正）与跨仓定位的单候选绕过（CLAUDE-02/CODEX-02）。codex 继续以内存桩复现全部 5 条。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点（修改计划） |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 属实：onDidDispose 调用永久 dispose，单例死锁 | 区分「面板关闭的临时清理」与「扩展停用的最终 dispose」：关闭仅 `cleanupPanel()`（清 runs/pending/panel 引用），实例与服务订阅保留、`disposed` 不置位，再次 open 重建面板与监控（订阅回放带回活跃 run）；最终 dispose 只在扩展停用。补「打开→关闭→再打开」集成测试与监听数不增断言 |
| AGY-r2-01 | gemini | major | 接受 | 同 CLAUDE-01 | 同上 |
| CODEX-01 | codex | major | 接受 | 同 CLAUDE-01（内存桩复现 panelsCreated=1） | 同上 |
| CLAUDE-02 | claude | major | 接受 | 属实：`pool.length===1` 分支绕过 topic 校验；桶前缀零命中时他仓单候选被兜底接管 | `locateRunDir` 收紧：给了 repoHint 且零命中 → 不接管（等本仓目录）；有命中时必须过 topic 比对（matched==0 → null）；仅无 repoHint 时单候选直取。补「单候选跨仓撞号」「matched=0」负向单测 |
| CODEX-02 | codex | major | 接受 | 同 CLAUDE-02（内存桩：OtherRepo 候选被接管） | 同上 |
| CLAUDE-03 | claude | major | 接受 | 属实：`--driver-model/--driver-provider` 漏出预检面，违反「与运行同组」 | 两个旗标纳入 `PREFLIGHT_FLAG_PREFIXES`（带值位）；扩展既有集成断言覆盖这两项 |
| CLAUDE-04 | claude | major | 接受 | 属实：零有效快照时回落路径不复核不清理 | 闸门回落收尾独立成路：`finalizeEndedRun`——无论 render 有无，调一次 `review --status`，成功按 CLI 构造终稿、失败注明，随后 dispose RunWatch/ReviewWatch；补「已 attach、零快照、闸门回 idle」集成测试（断言 watcher 清理） |
| CLAUDE-05 | claude | minor | 接受 | 属实：未 init 时树非空，viewsWelcome 永不出现 | HealthProvider 未 init 时返回空树（viewsWelcome 生效显示引导与手册链接）；inited 后才展示 meta/agent 项；补视图层测试 |
| CLAUDE-06 | claude | minor | 接受 | 属实：entry.note 只写不清，恢复后旧警示残留 | cockpit `onRender` 全量替换 `entry.note = extra.note ?? null`（endNote 独立）；补失联→恢复后 note 清空断言 |
| AGY-r2-02 | gemini | minor | 接受 | 属实：`&&` 误用，面板未开仍跑检索广播 | 改 `if (this.disposed || !this.panel) return;` |
| CODEX-03 | codex | major | 接受 | 属实：crossChecked 期间文件事件被丢，恢复后不重读 | RunWatch.refresh 在 crossChecked 期间置 `pendingRefresh`；复核「仍在运行」分支恢复监控时若 pendingRefresh 立即重读快照；补「复核延迟期间落盘终态」用例 |
| CODEX-04 | codex | major | 接受 | 属实：挂载重试每次 catch 新建 interval、句柄覆盖泄漏 | mountWatcher 收敛为**单例重试任务**（已有则不建；成功即停）；dispose 全清；补「目录晚建挂载成功」与「dispose 后无残留挂载任务」用例（暴露只读 `hasMountRetry` 供断言） |
| CODEX-05 | codex | major | 接受 | 属实：点火链 await 后不查生命周期，关闭后仍建终端注入 | handleIgnite 在每个 await 后复查 `disposed`（关闭即中止后续终端创建与注入）；随 CLAUDE-01 修复，「关闭」指扩展停用，面板关闭不销毁实例；补「认领等待期间停用」守卫断言 |

## 二、执行顺序

cockpit 生命周期（重开模型 + `||` 守卫 + note 替换 + 点火守卫 + 回落收尾）→ runDiscovery 归属收紧 → statusWatch（pendingRefresh + 单例挂载重试）→ prechain 旗标 → healthTree 空 → 测试补齐 → extension check 全绿 → 第 3/5 轮重审。
