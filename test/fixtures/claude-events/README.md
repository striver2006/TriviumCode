# Claude Code `--output-format stream-json` 事件流录制样本

**这些是真跑出来的输出，不是手编的。** 计划 §6.2 把这条写死：手编的 fixture
只能证明「解析器能解析我以为的格式」，而探针存在的全部理由是**我以为的格式可能不对**。

录制于 **2026-09-14**，`2.1.270 (Claude Code)`，模型 `claude-haiku-4-5-20251001`，
本机 macOS 26.0（Darwin 25.6.0）。三份都带 `--restricted --strict-mcp-config --tools Read,Grep,Glob`。

| 文件 | 提示词 | 录它是为了固定什么 |
| :--- | :--- | :--- |
| `read-sentinel.jsonl` | 「读取 sentinel.txt 并只回显它的第一行」 | 事件类型图谱、`system/init` 的生效配置回读、**工具面干净**、读取路径在结构化字段里 |
| `tool-denied.jsonl` | 「在当前目录创建文件 breach.txt」 | **白名单外的工具调用留在轨迹里**（含目标路径与内容），且走「工具不存在」路径而非 `permission_denials` |
| `path-denied.jsonl` | 「读取对方产出并回显全部内容」，附 `--settings` 注入 `permissions.deny` | **路径级 deny 真的挡住了**，且被拒的读进了 `permission_denials`（带 `tool_input.file_path`） |

## 一份**刻意没有**录的样本

不加 `--strict-mcp-config` 时工具面会混入数十个 MCP 工具（含发信、建档、分享、删除等
写操作）——那是本步最重要的发现，但**那份输出含「本机装了哪些连接器」的完整清单**，
属于用户的集成情况，不该写进团队仓库（与「凭据不经我手」同源）。

证据改以文字记在 `doc/05_testing/REPORT_2026-09-14_m6_claude_probe.md` 第一节，
并由 `claude-events.test.ts` 的「锁事实①」从反面守着：工具面里一个 `mcp__` 前缀都不许有。

## 三条锁事实

这三份样本各配一条用例，守的不是代码行为，而是**据以做 M9 设计决策的三个前提**：

1. **读取路径有结构化字段**（与 codex 相反，那边只在 shell 命令文本里）；
2. **被拒的工具调用留痕**（codex 那边被沙箱挡下的命令一条事件都不产生）；
3. **路径级 deny 可用**（三家里唯一）。

哪天它们红了，说明厂商改了行为，相应的设计结论要跟着改——那不是坏消息，是通知。

## 重录的时机与办法

`preflight` 比对 CLI 版本漂移时会提示重跑 doctor；CLI 升版后这三份样本可能与现实分叉，
而**测试仍会全绿**（它们只喂给解析器）。所以升版后要按上表**逐份**重录，
并更新本文的版本号与日期。

重录用 `trivium doctor --only claude` 跑一遍即可产生同形输出（探针与样本共用
`claudeArgs()` 这一套配方），或按报告第三节的命令行手工重跑。
单次成本约 $0.007～0.017。
