# TriviumCode 驾驶舱更新记录

## 0.3.4

- 修复 Windows 下驾驶舱调用 `.trivium/bin/trivium` 失败（退出码 `null`）的问题，改为解析 wrapper 内嵌 `node` 与 `trivium.cjs` 绝对路径直接执行（同时兼容 `.cmd` wrapper 与 `#!/usr/bin/env node`）。
- 修复 Windows 下自动发现优先命中 POSIX `zcode` 脚本导致能力查询 `--help` 报 `ENOENT` 的问题，优先定位 `bin/zcode.mjs` 并支持解析含 `$HOME` / `%USERPROFILE%` 的 sh 与 `.cmd` 包装器。
- 修复 Windows 下未设置 `HOME` 环境变量时 `~` 路径、默认运行根及 skill 目录解析为空的问题（回退到 `os.homedir()`），并修正静态重探失败横幅中的终端命令提示。
- 修复 Windows 下审查意见相对路径含反斜杠导致批注定位失败的问题。

## 0.3.3

- ZCode 主攻默认直接启动独立 CLI，并与核心 1.3.8 的后台审核共用该发行包。仅安装桌面版时，驾驶舱会提示安装独立 CLI 或指定交互入口。显式入口失效时显示路径和原因。

## 0.3.2

- 驾驶舱可在点火前选择 Driver 模型与思考强度，并随装配预设保存。原生终端按所选参数启动，预检后变更须重新检查。同主题再次点火遇到配置冲突时，可保留原会话或另开终端。

## 0.3.1

- 更新 Marketplace 页面和随包手册的首次使用说明。通过 VS Code 的「查看 → 命令面板」可运行「打开 Trivium 驾驶舱」和「打开 Trivium 驾驶舱使用手册」。macOS 快捷键为 `⌘⇧P`，Windows 和 Linux 为 `Ctrl+Shift+P`。
