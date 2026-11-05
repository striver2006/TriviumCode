# TriviumCode 驾驶舱（VS Code 插件）

TriviumCode「主攻 + 多审」双审流水线的 VS Code 前端。**集成面只有两条**：CLI
（`.trivium/bin/trivium --json` + 退出码协议）与文件面（只读 watcher）；不复制
编排器业务逻辑，阶段循环始终由终端里的 Driver 会话（入口 skill）驱动，插件只做
装配、注入、旁观渲染与中止。

## 功能（第一批：Phase 0 + Phase 1）

- **环境健康面板**（Activity Bar「Trivium」）：读取 `.trivium/config.local.yaml`
  探针结论展示四家 Agent 可用性 / 版本 / 入口；未 init 的工作区给出引导。
- **装配表单**：Driver 单选 / 审查者多选（探针驱动、自动排除与 Driver 同身份项）、
  入口 A/B/C/D、`--max-rounds`、模型档位高级折叠、context 路径选择。
- **前置链**：`topic resolve → preflight → 主题确认 → topic claim`（入口 A/B），
  全部经 wrapper 调用；退出码 64/65/69/70 语义化展示。
- **M1 终端协同**：按探针 entrypoint 拉起交互会话（命名终端、按
  `agent|topic|entry` 身份键复用），就绪延迟后注入入口命令；失败回退可复制命令条；
  输入框续话尽力中继；终端关闭自动降级为 M3 纯监控。
- **运行监控**：`state.json` 白名单发现 run → 运行目录 `status.json` watcher
  （阶段条、逐侧状态卡、30s 周期心跳失联重估）+ `worker.log` 尾随 +
  `--cancel` 中止按钮；侧完成即在 `.reviews/` 归档中列出审查正文入口。

## 平台边界

第一批的开发、测试与验收均在 **macOS**；Windows 适配为后续批次待办。

## 开发

```bash
npm install          # 安装依赖
npm run check        # typecheck + 打包 + 单测 + 集成测试（vscode-tests 起真实 extension host）
npm run package      # vsce 打包 .vsix
```

集成测试首次运行会下载 VS Code 测试运行时（缓存于 `.vscode-test/`，已 gitignore）。
