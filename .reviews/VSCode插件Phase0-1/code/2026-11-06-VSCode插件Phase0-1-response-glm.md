---
schema: trivium.disposition.v1
topic: VSCode插件Phase0-1
stage: code
role: glm
kind: response
run_id: 20261105T182415Z
addresses:
  - 2026-11-06-VSCode插件Phase0-1-claude.md
  - 2026-11-06-VSCode插件Phase0-1-gemini.md
  - 2026-11-06-VSCode插件Phase0-1-codex.md
---

# 应答：VSCode插件Phase0-1（代码审第 1/5 轮）

三侧结论：claude `reject`（8 条：阻断 1 ｜ 重要 7）、gemini `pass-after-changes`（4 条：重要 2 ｜ 次要 2）、codex `reject`（8 条：阻断 1 ｜ 重要 6 ｜ 次要 1）。共 **20 条：接受 20 ｜ 驳回 0 ｜ 暂缓 0**。

两条阻断同源且实锤（`env/` 无锚定规则吞掉 `extension/src/env/` 三模块，干净检出必挂）；codex 侧以内存桩逐条复现（跨仓 run_id 混淆、晚订阅丢失初始扫描、终态复核弃用 CLI 结果、并发 syncRuns 泄漏、分块 UTF-8 截断），全部成立。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点（修改计划） |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | blocker | 接受 | 实测证实：`.gitignore:99` 无锚定 `env/` 吞掉 `extension/src/env/` 三模块，补丁 0 个该目录文件，干净检出无法编译 | `.gitignore` 追加 `!extension/src/env/` 反忽略；`git check-ignore` 验证三模块不再命中；补丁再生后核对 |
| CODEX-01 | codex | blocker | 接受 | 与 CLAUDE-01 同源（codex 用 esbuild write:false 实证三 source omitted） | 同 CLAUDE-01 |
| AGY-01 | gemini | major | 接受 | 实测证实：86 个 `extension/out-test/` 编译产物混入补丁 | `.gitignore` 追加 `extension/out-test/`（生成物不入库） |
| CLAUDE-02 | claude | major | 接受 | 实测证实：zcode 探针 `version_probe.runner` 值为字面 `node`（能力标识非路径），现实现回落 PATH 违反 C1 | cockpit：仅 `path.isAbsolute(runner)` 时采用；否则解析 wrapper 内嵌 node；仍无则点火失败并明示（命令条兜底），不静默 PATH |
| CLAUDE-03 | claude | major | 接受 | preflight 丢 `--profile/--model-*` 等高级旗标，校验的不是实际运行配置 | `commands.preflight` 增加 flags 透传；prechain 把 profile/model/tier/effort/vendor-profile 类旗标传给 preflight（--topic/--max-rounds/--context 不传）；桩记录 argv、集成测试断言 |
| CLAUDE-04 | claude | major | 接受 | 重试耗尽后无持续发现，目录晚建则永久缺席 | cockpit：`pendingRuns` 登记 30s 低频重试（至发现或 dispose）；提示文案如实描述机制 |
| CLAUDE-05 | claude | major | 接受 | `--status` 的 artifacts 在嵌套 `status` 内（类型声明在根），复核结果未用于最终渲染 | `ReviewStatusOutput` 按真实形状声明（root.phase + status.phase/artifacts 防御式双读）；crossCheck 用 CLI phase/artifacts 构造最终 render；补不一致用例 |
| CODEX-04 | codex | major | 接受 | 比 CLAUDE-05 更强：CLI 复核为 running 时应恢复监控而非弃用+停表 | crossCheck：probe 终态 → 用 CLI 结果出终稿并 dispose；probe 仍在运行 → 恢复监控（不 dispose、待下次终态再复核）；probe 失败 → 文件快照为终稿+注明；补三态用例 |
| CLAUDE-06 | claude | major | 接受 | endNote 无 UI 消费、回落卡片仍显示运行中+中止按钮 | RunCard 增加 `ended` 标志；Webview note 恒展示；ended 且未终态时标「已结束（待复核）」并隐藏中止 |
| CLAUDE-07 | claude | major | 接受 | cockpit 监听不退订、openCockpit 每次 new | `StateWatch.onChange`/`TerminalRelay.onSessionClosed` 返回 Disposable；cockpit 持有并在 dispose/面板关闭时释放；extension.ts 单例 + reveal；补关闭后不再建 watch 的测试 |
| AGY-02 | gemini | major | 接受 | 与 CLAUDE-07 同源 | 同 CLAUDE-07 |
| CODEX-05 | codex | major | 接受 | 与 CLAUDE-07 同源并补充「关闭前已开始的异步发现在关闭后重装资源」 | 同 CLAUDE-07 + syncRuns 在每个 await 后复查 `disposed`，关闭后不安装任何资源 |
| CLAUDE-08 | claude | major | 接受 | 确认与点火未绑定，可认领 A 主题注入 B 主题 | 前置链成功时宿主冻结表单快照+主题；点火仅接受与快照一致的表单（宿主校验）；Webview 表单变更即禁用点火并提示重跑前置链 |
| CODEX-02 | codex | major | 接受 | 实验证实跨仓同秒 run_id 会取到别的仓库目录 | `locateRunDir` 收集全部命中，按「桶名前缀=工作区名」过滤 + 读候选 status.json 的 topic 与闸门主题比对；无法唯一确定即不接管并明示；补双桶同 runId 用例 |
| CODEX-03 | codex | major | 接受 | 实验证实晚订阅者收不到初始扫描 | `StateWatch.onChange` 订阅即回放最近快照（有则立即回调）；补晚订阅用例 |
| CODEX-06 | codex | major | 接受 | 实验证实并发 syncRuns 建两套 watcher 泄漏一套 | `discovering` 集合按 runId 去重（发现中直接跳过）；await 后复查归属与生命周期；补并发事件用例 |
| CODEX-07 | codex | major | 接受 | state/status 的 schemaReason 被丢弃，降级未贯通 | RunWatch 把 status 的 schema 结论上报（incompatible → 事件）；cockpit 汇总 config/state/status 三源 worstVerdict → 命中即降级只读（禁点火+横幅）；stateWatch 的 schemaReason 同步消费；补端到端降级用例 |
| AGY-04 | gemini | minor | 接受 | 与 CODEX-07 同源（worstVerdict 死代码） | 同 CODEX-07 |
| AGY-03 | gemini | minor | 接受 | 已退出终端被误复用 | `ensureSession` 命中后查 `exitStatus !== undefined` 即移除旧记录并新建 |
| CODEX-08 | codex | minor | 接受 | 实验证实分块 UTF-8 解码截断中文（topic 悄悄变字） | `TriviumCli.run` 收集 Buffer、结束时整体解码；补跨块中文用例（子进程逐字节输出） |

## 二、执行顺序

gitignore 双修 → CLI 层（UTF-8/preflight 旗标/状态形状）→ 监视层（locate 归属、晚订阅回放、终态复核三态、schema 贯通）→ 编排层（cockpit：单例/退订/并发守卫/表单冻结/降级/ended 卡片/pending 重试/node 绝对路径）→ Webview（note 恒显/ended/冻结失效）→ 桩记录 argv → 测试补齐 → extension check 全绿 + 主仓 check 复核 → 重审（S6 第 2/5 轮）。
